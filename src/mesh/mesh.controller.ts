import {
  Controller,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { WebhookProvider } from '../security/webhook-provider.decorator';
import { WebhookSignatureGuard } from '../security/webhook-signature.guard';
import { WebhookDeduplicationService } from '../webhooks/dedup.service';
import { MeshService, MeshWebhookEvent } from './mesh.service';
import { BusinessLogger, bindCorrelationId } from '@common/logging';

interface MeshWebhookBody {
  id?: string;
  type?: string;
  transfer_id?: string;
  external_reference?: string;
  on_chain_tx_hash?: string;
  chain_id?: number;
  confirmations?: number;
  amount?: string;
  currency?: string;
  reason?: string;
  failure_reason?: string;
}

@Controller('webhooks')
export class MeshController {
  private readonly blog = new BusinessLogger('MeshController');

  constructor(
    private readonly mesh: MeshService,
    private readonly dedup: WebhookDeduplicationService,
  ) {}

  @Post('mesh')
  @HttpCode(200)
  @WebhookProvider('MESH')
  @UseGuards(WebhookSignatureGuard)
  async handle(@Req() req: RawBodyRequest<Request>): Promise<{ ok: true }> {
    const body = req.body as MeshWebhookBody | undefined;
    const eventId = body?.id;
    if (!eventId) {
      this.blog.warn('webhookReceived', {
        detail: { provider: 'MESH', reason: 'missing_id' },
      });
      return { ok: true };
    }
    bindCorrelationId(eventId);

    const startedAt = Date.now();
    this.blog.info('webhookReceived', {
      detail: {
        provider: 'MESH',
        eventId,
        eventType: body?.type,
        rawBodySize: req.rawBody?.length ?? 0,
      },
    });

    const first = await this.dedup.markProcessed('MESH', eventId, req.rawBody);
    if (!first) return { ok: true };

    const event = this.parseEvent(body);
    await this.mesh.handleWebhookEvent(event);
    this.blog.info('webhookProcessed', {
      detail: { provider: 'MESH', eventId },
      durationMs: Date.now() - startedAt,
    });
    return { ok: true };
  }

  private parseEvent(body: MeshWebhookBody | undefined): MeshWebhookEvent {
    if (!body) return { type: 'IGNORE', reason: 'empty body' };
    const externalReference = body.external_reference ?? '';
    const transferId = body.transfer_id ?? '';
    if (!externalReference || !transferId) {
      return { type: 'IGNORE', reason: 'missing transfer_id or external_reference' };
    }

    switch (body.type) {
      case 'transfer.created':
        return {
          type: 'transfer.created',
          transferId,
          externalReference,
        };
      case 'transfer.settled':
        return {
          type: 'transfer.settled',
          transferId,
          externalReference,
          onChainTxHash: body.on_chain_tx_hash ?? '',
          chainId: body.chain_id ?? 0,
          confirmations: body.confirmations ?? 0,
          amountDecimal: String(body.amount ?? '0'),
        };
      case 'transfer.failed':
        return {
          type: 'transfer.failed',
          transferId,
          externalReference,
          reason: body.failure_reason ?? body.reason ?? 'unknown',
        };
      default:
        return {
          type: 'IGNORE',
          reason: `unhandled type=${body.type ?? '<missing>'}`,
        };
    }
  }
}
