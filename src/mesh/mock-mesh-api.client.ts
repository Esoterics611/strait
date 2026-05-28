import { Inject, Injectable } from '@nestjs/common';
import { BusinessLogger } from '@common/logging';
import * as crypto from 'crypto';
import { usdcUnitsToDecimal } from '../common/util/usdc-decimal';
import {
  IMeshApiClient,
  InitiateTransferPayload,
  InitiateTransferResult,
  MeshConnectResult,
  MeshOAuthPayload,
  ReverseTransferPayload,
  ReverseTransferResult,
} from './mesh-api-client.interface';
import {
  ISecretProvider,
  SECRET_PROVIDER,
} from '../secrets/secret-provider.interface';

// MockMeshApiClient simulates the Mesh Connect lifecycle locally for dev demos
// and tests. It fires two webhooks back into our own /webhooks/mesh endpoint —
// transfer.created, then transfer.settled — signed with the same HMAC-SHA256
// hex scheme real Mesh uses, so WebhookSignatureGuard cannot distinguish mock
// from real. Confirmations are pre-loaded above the chain threshold (12 ETH /
// 64 Base) so the controller transitions to USDC_LOCKED without waiting.
//
// Flip MOCK_MESH_ENABLED=false (and populate MESH_API_* secrets) to swap to
// RealMeshApiClient. No other code changes.
@Injectable()
export class MockMeshApiClient implements IMeshApiClient {
  private readonly blog = new BusinessLogger('MockMeshApiClient');

  constructor(
    @Inject(SECRET_PROVIDER) private readonly secrets: ISecretProvider,
  ) {}

  async connectMember(
    memberId: string,
    _auth: MeshOAuthPayload,
  ): Promise<MeshConnectResult> {
    // Deterministic per memberId so re-connects in dev are stable.
    const meshAccountId = `mesh_acct_${crypto
      .createHash('sha256')
      .update(memberId)
      .digest('hex')
      .slice(0, 16)}`;
    return {
      meshAccountId,
      accessToken: `mesh_access_${crypto.randomUUID()}`,
      refreshToken: `mesh_refresh_${crypto.randomUUID()}`,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
  }

  async initiateTransfer(
    payload: InitiateTransferPayload,
  ): Promise<InitiateTransferResult> {
    const meshTransferId = `mesh_tr_${crypto.randomUUID()}`;

    // Fire-and-forget the lifecycle. Errors logged; do not block the caller.
    void this.scheduleWebhooks(meshTransferId, payload);

    return { meshTransferId };
  }

  /**
   * Mock reverse: returns a deterministic id from the refund correlation,
   * pretends the on-chain reverse completed successfully. No webhook is
   * self-delivered — the refund executor performs the compensating ledger
   * credit + state transition inline because the call is initiator-driven
   * (admin), not provider-driven (Mesh).
   */
  async reverseTransfer(
    payload: ReverseTransferPayload,
  ): Promise<ReverseTransferResult> {
    const reverseTransferId = `mesh_rev_${crypto
      .createHash('sha256')
      .update(payload.refundCorrelationId)
      .digest('hex')
      .slice(0, 24)}`;
    this.blog.info('reverseTransfer', {
      detail: {
        provider: 'MESH',
        meshTransferId: payload.meshTransferId,
        reverseTransferId,
        amountUsdcUnits: payload.amountUsdcUnits.toString(),
        outcome: 'mock_reverse_simulated',
      },
    });
    return { reverseTransferId };
  }

  private async scheduleWebhooks(
    meshTransferId: string,
    payload: InitiateTransferPayload,
  ): Promise<void> {
    const latencyMs = parseInt(
      (await this.safeGet('MESH_MOCK_LATENCY_MS')) ?? '500',
      10,
    );

    // Required confirmation depth per chain. Mock fires at exactly the threshold
    // so the controller's "below threshold" gate is not tripped.
    const requiredConfs = payload.chainId === 1 ? 12 : 64;

    const onChainTxHash = `0x${crypto.randomBytes(32).toString('hex')}`;

    // 1) transfer.created — establishes the real Mesh transfer id so the
    //    controller can stamp it into tx_state_transitions metadata.
    await this.deliverWebhook({
      id: `evt_mesh_${crypto.randomUUID()}`,
      type: 'transfer.created',
      transfer_id: meshTransferId,
      external_reference: payload.correlationId,
      mesh_account_id: payload.meshAccountId,
    });

    // 2) transfer.settled — fires after configured latency.
    await new Promise((r) => setTimeout(r, latencyMs));
    await this.deliverWebhook({
      id: `evt_mesh_${crypto.randomUUID()}`,
      type: 'transfer.settled',
      transfer_id: meshTransferId,
      external_reference: payload.correlationId,
      mesh_account_id: payload.meshAccountId,
      on_chain_tx_hash: onChainTxHash,
      chain_id: payload.chainId,
      confirmations: requiredConfs,
      amount: usdcUnitsToDecimal(payload.amountUsdcUnits),
      currency: 'usdc',
    });
  }

  private async deliverWebhook(body: Record<string, unknown>): Promise<void> {
    const baseUrl = await this.secrets.get('WEBHOOK_BASE_URL');
    const secret = await this.secrets.get('MESH_WEBHOOK_SECRET');

    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const signatureHex = crypto
      .createHmac('sha256', secret)
      .update(raw)
      .digest('hex');

    try {
      const res = await fetch(`${baseUrl}/webhooks/mesh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'mesh-signature': signatureHex,
        },
        body: raw,
      });
      if (!res.ok) {
        throw new Error(`POST /webhooks/mesh → ${res.status}`);
      }
    } catch (err) {
      this.blog.error('selfDeliverWebhook', {
        detail: { provider: 'MESH' },
        error: err,
      });
    }
  }

  private async safeGet(key: string): Promise<string | undefined> {
    try {
      return await this.secrets.get(key);
    } catch {
      return undefined;
    }
  }
}
