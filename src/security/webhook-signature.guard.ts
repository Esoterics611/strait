import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ISecretProvider, SECRET_PROVIDER } from '../secrets/secret-provider.interface';
import { WebhookVerifier } from './webhook-verifier.service';
import { WEBHOOK_PROVIDER_KEY } from './webhook-provider.decorator';
import { BusinessLogger } from '@common/logging';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly blog = new BusinessLogger('WebhookSignatureGuard');

  constructor(
    private readonly reflector: Reflector,
    private readonly webhookVerifier: WebhookVerifier,
    @Inject(SECRET_PROVIDER) private readonly secretProvider: ISecretProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const provider = this.reflector.get<string>(WEBHOOK_PROVIDER_KEY, context.getHandler());
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    if (!provider) {
      this.logFailure(req, 'unknown', 'no_provider_metadata');
      throw new UnauthorizedException();
    }

    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      this.logFailure(req, provider, 'missing_raw_body');
      throw new UnauthorizedException();
    }

    try {
      const verified = await this.verifyGeneric(provider, req, rawBody);
      if (!verified) {
        this.logFailure(req, provider, 'signature_mismatch');
        throw new UnauthorizedException();
      }
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logFailure(req, provider, 'verification_error');
      throw new UnauthorizedException();
    }
  }

  private logFailure(
    req: RawBodyRequest<Request>,
    provider: string,
    reason: string,
  ): void {
    const eventId = (req?.body as { id?: string } | undefined)?.id;
    this.blog.warn('verifySignature', {
      detail: {
        provider,
        eventId,
        reason,
        ip: req?.ip,
        outcome: 'signature_verification_failed',
      },
    });
  }

  private async verifyGeneric(
    provider: string,
    req: RawBodyRequest<Request>,
    rawBody: Buffer,
  ): Promise<boolean> {
    const secretKeyMap: Record<string, string> = {
      MESH: 'MESH_WEBHOOK_SECRET',
      CUSTODIAL: 'CUSTODIAL_WEBHOOK_SECRET',
    };
    const headerMap: Record<string, string> = {
      MESH: 'mesh-signature',
      CUSTODIAL: 'custodial-signature',
    };

    const secretKey = secretKeyMap[provider];
    const headerName = headerMap[provider];
    if (!secretKey || !headerName) return false;

    const rawSig = req.headers[headerName];
    if (!rawSig) return false;
    const signature = Array.isArray(rawSig) ? rawSig[0] : rawSig;

    const secret = await this.secretProvider.get(secretKey);
    return this.webhookVerifier.verify(provider, rawBody, signature, secret);
  }
}
