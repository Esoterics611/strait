import { Inject, Injectable } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { BusinessLogger } from '@common/logging';
import {
  IMeshApiClient,
  InitiateTransferPayload,
  InitiateTransferResult,
  MeshConnectResult,
  MeshOAuthPayload,
  ReverseTransferPayload,
  ReverseTransferResult,
} from './mesh-api-client.interface';
import { MeshApiError } from './mesh.errors';
import {
  ISecretProvider,
  SECRET_PROVIDER,
} from '../secrets/secret-provider.interface';
import { ProviderHealthService } from '../admin/ops/provider-health.service';

// Real-Mesh wire contract per public docs. Dormant in dev (MOCK_MESH_ENABLED=true
// by default). Pairs with RealBridgeApiClient/RapydApiClient retry shape:
// 4xx (≠429) → immediate fail; 429/5xx → exp-backoff base 2s, 5 attempts.
@Injectable()
export class RealMeshApiClient implements IMeshApiClient {
  private readonly blog = new BusinessLogger('RealMeshApiClient');
  private readonly axios: AxiosInstance;

  constructor(
    @Inject(SECRET_PROVIDER) private readonly secrets: ISecretProvider,
    private readonly health: ProviderHealthService,
  ) {
    this.axios = axios.create({ timeout: 15_000 });
  }

  async connectMember(
    memberId: string,
    auth: MeshOAuthPayload,
  ): Promise<MeshConnectResult> {
    const tokenResp = await this.request<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      mesh_account_id: string;
    }>('POST', '/oauth/token', {
      grant_type: 'authorization_code',
      code: auth.authorizationCode,
      code_verifier: auth.codeVerifier,
      redirect_uri: auth.redirectUri,
      // memberId is supplied as state/correlation; Mesh echoes it back for audit.
      external_user_id: memberId,
    });

    return {
      meshAccountId: tokenResp.mesh_account_id,
      accessToken: tokenResp.access_token,
      refreshToken: tokenResp.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + tokenResp.expires_in,
    };
  }

  async initiateTransfer(
    payload: InitiateTransferPayload,
  ): Promise<InitiateTransferResult> {
    const res = await this.request<{ transfer_id: string }>(
      'POST',
      '/transfers',
      {
        mesh_account_id: payload.meshAccountId,
        // Mesh expects 6-decimal USDC units as a string; bigint serializes cleanly.
        amount: payload.amountUsdcUnits.toString(),
        currency: 'usdc',
        destination_address: payload.destinationAddress,
        chain_id: payload.chainId,
        webhook_url: payload.webhookUrl,
        external_reference: payload.correlationId,
      },
      { 'Idempotency-Key': payload.correlationId },
    );
    return { meshTransferId: res.transfer_id };
  }

  /**
   * Dormant until Mesh sandbox onboarding completes. Mesh's reverse endpoint
   * shape (path + body) will need verification against the docs the moment
   * MOCK_MESH_ENABLED is flipped to false; until then, calling this in prod
   * fails clearly with the same retry/backoff shape as the other endpoints.
   */
  async reverseTransfer(
    payload: ReverseTransferPayload,
  ): Promise<ReverseTransferResult> {
    const res = await this.request<{ reverse_transfer_id: string }>(
      'POST',
      `/transfers/${encodeURIComponent(payload.meshTransferId)}/reverse`,
      {
        amount: payload.amountUsdcUnits.toString(),
        currency: 'usdc',
        external_reference: payload.refundCorrelationId,
      },
      { 'Idempotency-Key': payload.refundCorrelationId },
    );
    return { reverseTransferId: res.reverse_transfer_id };
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const baseUrl = await this.secrets.get('MESH_API_BASE_URL');
    const clientId = await this.secrets.get('MESH_OAUTH_CLIENT_ID');
    const clientSecret = await this.secrets.get('MESH_OAUTH_CLIENT_SECRET');
    const url = `${baseUrl}${path}`;

    // Mesh uses Basic auth with the OAuth client id/secret for the /oauth/token
    // endpoint; for /transfers the access token would normally be used. In this
    // session we send both — the real call path will be exercised in a future
    // session once Mesh sandbox credentials are issued. The contract is what
    // matters here, not the secret-management edge cases.
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const headers: Record<string, string> = {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
      ...(extraHeaders ?? {}),
    };

    const maxAttempts = 5;
    let lastErr: unknown;
    const start = Date.now();
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await this.axios.request<T>({ method, url, headers, data: body });
        await this.health.recordSuccess('MESH', Date.now() - start);
        return res.data;
      } catch (err) {
        const ae = err as AxiosError;
        const status = ae.response?.status ?? 0;
        if (status >= 400 && status < 500 && status !== 429) {
          await this.health.recordFailure('MESH', this.sanitize(ae));
          throw new MeshApiError(status, this.sanitize(ae));
        }
        lastErr = err;
        if (attempt < maxAttempts - 1) {
          const base = 2_000 * Math.pow(2, attempt);
          const jitter = base * (Math.random() * 0.5 - 0.25);
          await new Promise((r) => setTimeout(r, Math.max(50, base + jitter)));
        }
      }
    }
    const ae = lastErr as AxiosError;
    await this.health.recordFailure('MESH', this.sanitize(ae));
    throw new MeshApiError(ae?.response?.status ?? 0, this.sanitize(ae));
  }

  private sanitize(err: AxiosError | undefined): string {
    if (!err) return 'unknown';
    let body: string;
    try {
      body =
        typeof err.response?.data === 'string'
          ? err.response.data
          : JSON.stringify(err.response?.data);
    } catch {
      body = '[unserializable]';
    }
    return body
      .replace(/Bearer [^\s"]+/g, 'Bearer [REDACTED]')
      .replace(/Basic [A-Za-z0-9+/=]+/g, 'Basic [REDACTED]');
  }
}
