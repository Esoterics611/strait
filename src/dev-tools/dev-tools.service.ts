import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BusinessLogger } from '@common/logging';
import { ShadowLedgerService } from '../ledger/shadow-ledger.service';
import {
  DomainEventEmitterService,
  PAYMENT_EVENTS,
} from '../events/domain-event-emitter.service';
import { MeshService } from '../mesh/mesh.service';
import { SourceType, TxState } from '@common/enums';
import { IDomainEvent } from '@common/interfaces';

// Dev-only helpers that drive the full pipeline without external providers.
// Surfaces three actions; all gated by DevToolsGuard at the controller level.
//
//   1. emitLocked       — INSERTs a USDC_LOCKED CREDIT row, bumps the member's
//                         balance, and emits payment.usdc_locked. Drives the
//                         Bridge listener directly. Used for mock-Bridge
//                         cascade demos that don't need an inbound trigger.
//
//   2. meshConnect      — wraps MeshService.connectMember with a synthetic
//                         OAuth payload. With MOCK_MESH_ENABLED=true (default),
//                         MockMeshApiClient ignores the payload and returns a
//                         deterministic meshAccountId. Required before
//                         meshInitiate because initiateTransfer reads tokens
//                         from MESH_TOKENS__{memberId}.
//
//   3. meshInitiate     — wraps MeshService.initiateTransfer. The mock Mesh
//                         client self-delivers transfer.created +
//                         transfer.settled, which cascades through to
//                         BRIDGE_DISPATCHED → SETTLED_USD.
@Injectable()
export class DevToolsService {
  private readonly blog = new BusinessLogger('DevToolsService');

  constructor(
    private readonly ledger: ShadowLedgerService,
    private readonly events: DomainEventEmitterService,
    private readonly mesh: MeshService,
  ) {}

  async emitLocked(
    memberId: string,
    amountUnits: bigint,
  ): Promise<{ txId: string }> {
    if (amountUnits <= 0n) {
      throw new Error('amountUsdcUnits must be positive');
    }
    const idempotencyKey = `dev-emit-${randomUUID()}`;
    // creditUsdc inserts at state=USDC_LOCKED, updates the balance under a
    // serializable lock, and emits payment.usdc_credited. We then emit
    // payment.usdc_locked separately so the BridgeDispatchListener fires.
    const txId = await this.ledger.creditUsdc(
      memberId,
      amountUnits,
      SourceType.MESH,
      `dev-emit:${idempotencyKey}`,
      idempotencyKey,
      { source: 'dev-tools.emitLocked' },
    );

    const event: IDomainEvent<{
      txId: string;
      fromState: TxState | null;
      toState: TxState;
      metadata?: Record<string, unknown>;
    }> = {
      eventId: randomUUID(),
      occurredAt: new Date(),
      aggregateId: txId,
      aggregateType: 'UsdcTransaction',
      eventType: PAYMENT_EVENTS.USDC_LOCKED,
      payload: {
        txId,
        fromState: null,
        toState: TxState.USDC_LOCKED,
        metadata: { source: 'dev-tools.emitLocked' },
      },
    };
    this.events.emit(PAYMENT_EVENTS.USDC_LOCKED, event);

    return { txId };
  }

  async meshConnect(memberId: string): Promise<{ meshAccountId: string }> {
    return this.mesh.connectMember(memberId, {
      authorizationCode: 'dev-stub',
      codeVerifier: 'dev-stub',
      redirectUri: 'http://localhost:5173/mesh/callback',
    });
  }

  async meshInitiate(
    memberId: string,
    amountUnits: bigint,
    recipientId: string,
  ): Promise<{ txId: string; correlationId: string; meshTransferId: string }> {
    return this.mesh.initiateTransfer(memberId, amountUnits, recipientId);
  }
}
