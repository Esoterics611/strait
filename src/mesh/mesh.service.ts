import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { BusinessLogger } from '@common/logging';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  IMeshApiClient,
  MESH_API_CLIENT,
  MeshConnectResult,
  MeshOAuthPayload,
} from './mesh-api-client.interface';
import {
  IOFACScreener,
  OFAC_SCREENER,
} from './ofac-screener.service';
import {
  BlockedAddressError,
  InvalidConfirmationDepthError,
} from './mesh.errors';
import { usdcDecimalToUnits } from '../common/util/usdc-decimal';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { DbService } from '../database/db.service';
import { StateMachineService } from '../state-machine/state-machine.service';
import {
  DomainEventEmitterService,
  PAYMENT_EVENTS,
} from '../events/domain-event-emitter.service';
import {
  ISecretProvider,
  SECRET_PROVIDER,
} from '../secrets/secret-provider.interface';
import { SourceType, Direction, TxState } from '@common/enums';
import { IDomainEvent } from '@common/interfaces';
import { MemberFrozenError, TransferRequiresRecipientError } from '@common/errors';

// Required on-chain confirmation depth before a Mesh transfer.settled webhook
// is honored. Path A is single-row: transfer.settled atomically credits the
// member balance and transitions MESH_PENDING → USDC_LOCKED. Below threshold,
// the webhook is acknowledged but no state change fires — Mesh re-delivers as
// confirmations accrue.
const CONFIRMATION_DEPTH: Record<number, number> = {
  1: 12, // Ethereum mainnet
  8453: 64, // Base
};

export interface MeshTransferCreated {
  type: 'transfer.created';
  transferId: string;
  externalReference: string;
}

export interface MeshTransferSettled {
  type: 'transfer.settled';
  transferId: string;
  externalReference: string;
  onChainTxHash: string;
  chainId: number;
  confirmations: number;
  amountDecimal: string;
}

export interface MeshTransferFailed {
  type: 'transfer.failed';
  transferId: string;
  externalReference: string;
  reason: string;
}

export type MeshWebhookEvent =
  | MeshTransferCreated
  | MeshTransferSettled
  | MeshTransferFailed
  | { type: 'IGNORE'; reason: string };

@Injectable()
export class MeshService {
  private readonly blog = new BusinessLogger('MeshService');

  constructor(
    @Inject(MESH_API_CLIENT) private readonly meshClient: IMeshApiClient,
    @Inject(OFAC_SCREENER) private readonly ofac: IOFACScreener,
    @Inject(SECRET_PROVIDER) private readonly secrets: ISecretProvider,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly db: DbService,
    private readonly stateMachine: StateMachineService,
    private readonly events: DomainEventEmitterService,
  ) {}

  // Exchanges Mesh's OAuth authorization code for tokens and persists them via
  // SECRET_PROVIDER under key MESH_TOKENS__{memberId}. Tokens NEVER live in the
  // DB; in production, swap SECRET_PROVIDER to a Vault impl and the storage
  // location changes with zero code edits here.
  async connectMember(
    memberId: string,
    auth: MeshOAuthPayload,
  ): Promise<{ meshAccountId: string }> {
    const result: MeshConnectResult = await this.meshClient.connectMember(
      memberId,
      auth,
    );
    await this.secrets.set(
      `MESH_TOKENS__${memberId}`,
      JSON.stringify({
        access: result.accessToken,
        refresh: result.refreshToken,
        exp: result.expiresAt,
        meshAccountId: result.meshAccountId,
      }),
    );
    this.blog.info('connectMember', {
      memberId,
      detail: { meshAccountId: result.meshAccountId },
    });
    return { meshAccountId: result.meshAccountId };
  }

  // Initiates a Mesh USDC pull from the member's connected wallet/CEX into
  // their Bridge liquid address. Order matters: OFAC screen first (no DB
  // writes, no API calls if hit), then INSERT MESH_PENDING row, then Mesh API
  // call. If the Mesh API throws, the row remains MESH_PENDING and the
  // onramp-timeout-style cleanup or a future retry cron handles it. We do NOT
  // transition to FAILED on Mesh-API exceptions during initiation — the
  // server may have accepted the request even though our client failed to
  // read the response (e.g., network blip). Mesh's idempotency key (our
  // correlationId) guarantees a retry is safe.
  async initiateTransfer(
    memberId: string,
    amountUnits: bigint,
    recipientId: string,
  ): Promise<{ txId: string; correlationId: string; meshTransferId: string }> {
    if (amountUnits <= 0n) {
      throw new Error('amountUnits must be positive');
    }
    // S-B3: every new transfer carries a recipient_id at INSERT. The
    // recipient_id column on usdc_transactions stays nullable for historical
    // rows; enforcement is service-level here, so legacy data is untouched.
    if (!recipientId || typeof recipientId !== 'string') {
      throw new TransferRequiresRecipientError(memberId, SourceType.MESH);
    }

    const memberRows = await this.dataSource.query<
      { bridge_liquid_address: string; chain_id: number; is_frozen: boolean }[]
    >(
      `SELECT bridge_liquid_address, chain_id, is_frozen
         FROM member_accounts WHERE member_id = $1`,
      [memberId],
    );
    if (memberRows.length === 0) throw new Error(`Member not found: ${memberId}`);
    if (memberRows[0].is_frozen) throw new MemberFrozenError(memberId);
    const { bridge_liquid_address: liquidAddress, chain_id: chainId } =
      memberRows[0];

    this.blog.info('initiateTransfer', {
      memberId,
      sourceType: SourceType.MESH,
      detail: { phase: 'start', amountUnits: amountUnits.toString(), chainId },
    });

    const screen = await this.ofac.screenAddress(liquidAddress);
    if (screen.blocked) {
      // No address in the log line — auditors join via memberId + category.
      this.blog.error('initiateTransfer', {
        memberId,
        sourceType: SourceType.MESH,
        detail: { category: 'ofac_block', reason: screen.reason },
      });
      throw new BlockedAddressError(liquidAddress, screen.reason ?? 'blocked');
    }

    const correlationId = randomUUID();
    const idemKey = this.idempotency.buildKey(
      memberId,
      SourceType.MESH,
      correlationId,
    );

    const inserted = await this.dataSource.query<{ tx_id: string }[]>(
      `INSERT INTO usdc_transactions
         (tx_id, member_id, source_type, direction,
          amount_usdc_wei, state, idempotency_key, mesh_transfer_id,
          recipient_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING tx_id`,
      [
        memberId,
        SourceType.MESH,
        Direction.CREDIT,
        amountUnits.toString(),
        TxState.MESH_PENDING,
        idemKey,
        correlationId,
        recipientId,
      ],
    );
    const txId = inserted[0].tx_id;

    this.blog.info('initiateTransfer', {
      txId,
      memberId,
      sourceType: SourceType.MESH,
      correlationId,
      detail: { phase: 'insert_mesh_pending', idempotencyKey: idemKey },
    });

    // meshAccountId comes from prior connectMember; in tests/mock-only flows
    // tokens can be pre-seeded. If missing, surface a clear error rather than
    // silently failing the Mesh call.
    const meshAccountId = await this.resolveMeshAccountId(memberId);

    const webhookBaseUrl = await this.secrets.get('WEBHOOK_BASE_URL');

    const apiStartedAt = Date.now();
    const result = await this.meshClient.initiateTransfer({
      correlationId,
      meshAccountId,
      amountUsdcUnits: amountUnits,
      destinationAddress: liquidAddress,
      chainId,
      webhookUrl: `${webhookBaseUrl}/webhooks/mesh`,
    });

    this.blog.info('initiateTransfer', {
      txId,
      memberId,
      sourceType: SourceType.MESH,
      correlationId,
      detail: { phase: 'mesh_api_response', meshTransferId: result.meshTransferId },
      durationMs: Date.now() - apiStartedAt,
    });

    return { txId, correlationId, meshTransferId: result.meshTransferId };
  }

  async handleWebhookEvent(event: MeshWebhookEvent): Promise<void> {
    switch (event.type) {
      case 'transfer.created':
        return this.handleCreated(event);
      case 'transfer.settled':
        return this.handleSettled(event);
      case 'transfer.failed':
        return this.handleFailed(event);
      case 'IGNORE':
        this.blog.info('handleWebhookEvent', {
          detail: { outcome: 'ignored', reason: event.reason },
        });
        return;
    }
  }

  private async handleCreated(event: MeshTransferCreated): Promise<void> {
    // transfer.created carries Mesh's authoritative transfer id but does not
    // change state (still MESH_PENDING). Log for audit; the real Mesh id is
    // recorded into tx_state_transitions metadata when settle fires.
    this.blog.debug('handleCreated', {
      correlationId: event.externalReference,
      detail: { meshTransferId: event.transferId },
    });
  }

  private async handleSettled(event: MeshTransferSettled): Promise<void> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(event.onChainTxHash)) {
      this.blog.warn('handleSettled', {
        correlationId: event.externalReference,
        detail: {
          reason: 'malformed_on_chain_tx_hash',
          onChainTxHash: event.onChainTxHash,
        },
      });
      return;
    }

    const required = CONFIRMATION_DEPTH[event.chainId];
    if (required === undefined) {
      this.blog.warn('handleSettled', {
        correlationId: event.externalReference,
        detail: { reason: 'unsupported_chain', chainId: event.chainId },
      });
      return;
    }
    if (event.confirmations < required) {
      // NOT a failure — Mesh re-delivers as confirmations accrue.
      this.blog.debug('handleSettled', {
        correlationId: event.externalReference,
        detail: {
          outcome: 'below_confirmation_depth',
          chainId: event.chainId,
          required,
          observed: event.confirmations,
        },
      });
      return;
    }

    const amountUnits = usdcDecimalToUnits(event.amountDecimal);

    // Lookup-then-credit happens in one SERIALIZABLE transaction:
    //   1. resolve tx_id by correlationId,
    //   2. ensure current state is MESH_PENDING (idempotency vs guard against
    //      a duplicate event with a different webhook event_id),
    //   3. SELECT FOR UPDATE on member balance,
    //   4. UPDATE member balance += amount,
    //   5. INSERT into tx_state_transitions(MESH_PENDING → USDC_LOCKED, metadata).
    // The transition event is emitted AFTER commit so subscribers (Bridge
    // dispatch) never see an uncommitted state.
    const result = await this.db.runInSerializableTransaction(
      async (em: EntityManager) => {
        const txRows = await em.query<
          { tx_id: string; member_id: string; amount_usdc_wei: string }[]
        >(
          `SELECT tx_id, member_id, amount_usdc_wei
             FROM usdc_transactions
            WHERE mesh_transfer_id = $1`,
          [event.externalReference],
        );
        if (txRows.length === 0) {
          this.blog.warn('handleSettled', {
            correlationId: event.externalReference,
            detail: { reason: 'unknown_correlation_id' },
          });
          return null;
        }
        const { tx_id: txId, member_id: memberId, amount_usdc_wei: storedAmount } =
          txRows[0];

        // Cross-check the amount Mesh settled with what we initiated. A mismatch
        // here means upstream tampering or a Mesh bug — bail loudly rather than
        // crediting an arbitrary value.
        if (BigInt(storedAmount) !== amountUnits) {
          this.blog.error('handleSettled', {
            txId,
            memberId,
            correlationId: event.externalReference,
            detail: {
              reason: 'amount_mismatch',
              expected: storedAmount,
              observed: amountUnits.toString(),
            },
          });
          return null;
        }

        const currentStateRows = await em.query<{ current_state: TxState }[]>(
          `SELECT current_state FROM v_tx_current_state WHERE tx_id = $1`,
          [txId],
        );
        const currentState =
          currentStateRows.length > 0
            ? currentStateRows[0].current_state
            : (
                await em.query<{ state: TxState }[]>(
                  `SELECT state FROM usdc_transactions WHERE tx_id = $1`,
                  [txId],
                )
              )[0]?.state;

        if (currentState !== TxState.MESH_PENDING) {
          this.blog.debug('handleSettled', {
            txId,
            memberId,
            correlationId: event.externalReference,
            detail: {
              outcome: 'already_past_mesh_pending',
              currentState,
            },
          });
          return null;
        }

        await em.query(
          `SELECT usdc_virtual_balance_wei FROM member_accounts
             WHERE member_id = $1 FOR UPDATE`,
          [memberId],
        );

        await em.query(
          `UPDATE member_accounts
              SET usdc_virtual_balance_wei = usdc_virtual_balance_wei + $1::numeric,
                  updated_at = NOW()
            WHERE member_id = $2`,
          [amountUnits.toString(), memberId],
        );

        const metadata = {
          on_chain_tx_hash: event.onChainTxHash,
          confirmations: event.confirmations,
          chain_id: event.chainId,
          mesh_transfer_id: event.transferId,
        };

        await em.query(
          `INSERT INTO tx_state_transitions
             (id, tx_id, from_state, to_state, metadata, occurred_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
          [
            txId,
            TxState.MESH_PENDING,
            TxState.USDC_LOCKED,
            JSON.stringify(metadata),
          ],
        );

        return { txId, memberId, metadata };
      },
    );

    if (!result) return;

    this.blog.info('handleSettled', {
      txId: result.txId,
      memberId: result.memberId,
      sourceType: SourceType.MESH,
      correlationId: event.externalReference,
      detail: {
        outcome: 'credited_and_locked',
        amountUnits: amountUnits.toString(),
        chainId: event.chainId,
        confirmations: event.confirmations,
        onChainTxHash: event.onChainTxHash,
      },
    });

    const lockedEvent: IDomainEvent<{
      txId: string;
      fromState: TxState;
      toState: TxState;
      metadata?: Record<string, unknown>;
    }> = {
      eventId: randomUUID(),
      occurredAt: new Date(),
      aggregateId: result.txId,
      aggregateType: 'UsdcTransaction',
      eventType: PAYMENT_EVENTS.USDC_LOCKED,
      payload: {
        txId: result.txId,
        fromState: TxState.MESH_PENDING,
        toState: TxState.USDC_LOCKED,
        metadata: result.metadata,
      },
    };
    this.events.emit(PAYMENT_EVENTS.USDC_LOCKED, lockedEvent);
  }

  private async handleFailed(event: MeshTransferFailed): Promise<void> {
    const rows = await this.dataSource.query<{ tx_id: string }[]>(
      `SELECT tx_id FROM usdc_transactions WHERE mesh_transfer_id = $1`,
      [event.externalReference],
    );
    if (rows.length === 0) {
      this.blog.warn('handleFailed', {
        correlationId: event.externalReference,
        detail: { reason: 'unknown_correlation_id' },
      });
      return;
    }
    try {
      await this.stateMachine.transition(rows[0].tx_id, TxState.FAILED, {
        reason: event.reason,
        mesh_transfer_id: event.transferId,
      });
      this.blog.warn('handleFailed', {
        txId: rows[0].tx_id,
        correlationId: event.externalReference,
        detail: { reason: event.reason, meshTransferId: event.transferId },
      });
    } catch (err) {
      // Most likely InvalidTransitionError because this tx already advanced
      // past MESH_PENDING (e.g., settle and fail crossed). Log and ack 200.
      this.blog.warn('handleFailed', {
        txId: rows[0].tx_id,
        correlationId: event.externalReference,
        detail: { outcome: 'transition_skipped' },
        error: err,
      });
    }
  }

  private async resolveMeshAccountId(memberId: string): Promise<string> {
    const raw = await this.safeGet(`MESH_TOKENS__${memberId}`);
    if (!raw) {
      throw new Error(
        `Member ${memberId} is not connected to Mesh — call connectMember first`,
      );
    }
    try {
      const parsed = JSON.parse(raw) as { meshAccountId?: string };
      if (!parsed.meshAccountId) {
        throw new Error(`MESH_TOKENS__${memberId} payload missing meshAccountId`);
      }
      return parsed.meshAccountId;
    } catch (err) {
      throw new Error(
        `MESH_TOKENS__${memberId} is not valid JSON: ${(err as Error).message}`,
      );
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
