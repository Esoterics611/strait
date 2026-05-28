import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { BusinessLogger } from '@common/logging';
import { Direction, SourceType, TxState, RailUsed } from '@common/enums';
import type { IDomainEvent } from '@common/interfaces';
import { ShadowLedgerService } from '../ledger/shadow-ledger.service';
import { StateMachineService } from '../state-machine/state-machine.service';
import {
  DomainEventEmitterService,
  PAYMENT_EVENTS,
} from '../events/domain-event-emitter.service';
import { WebhookDeduplicationService } from '../webhooks/dedup.service';
import { SECRET_PROVIDER, ISecretProvider } from '../secrets/secret-provider.interface';
import { RecipientsRepository } from '../recipients/recipients.repository';
import {
  IOutboundDispatcher,
  OUTBOUND_DISPATCHERS,
  PayoutMethod,
} from './outbound-dispatcher.interface';
import {
  DispatchError,
  RecipientNotReadyError,
  UnsupportedPayoutMethodError,
} from './dispatch.errors';

const DISPATCH_FLOOR_UNITS = 1_000_000n; // 1 USDC

interface TxRow {
  tx_id: string;
  member_id: string;
  amount_usdc_wei: string;
  direction: Direction;
  idempotency_key: string;
  recipient_id: string | null;
}

// Generic settlement webhook envelope — what every custodial provider's
// adapter normalizes its incoming webhook payload to before calling
// handleCustodialSettlementWebhook. Chain settlement (post-confirmation)
// uses the same shape via a chain watcher.
export interface SettlementWebhookBody {
  // Unique webhook event id (provider-side). Used for dedup.
  id: string;
  type: 'transfer.settled' | 'transfer.failed';
  providerRef: string;
  settledAt: string; // ISO
  failureReason?: string;
}

@Injectable()
export class DispatchService {
  private readonly blog = new BusinessLogger('DispatchService');
  private readonly dispatchers: Map<PayoutMethod, IOutboundDispatcher>;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(OUTBOUND_DISPATCHERS) dispatchers: IOutboundDispatcher[],
    private readonly ledger: ShadowLedgerService,
    private readonly stateMachine: StateMachineService,
    private readonly events: DomainEventEmitterService,
    private readonly dedup: WebhookDeduplicationService,
    @Inject(SECRET_PROVIDER) private readonly secrets: ISecretProvider,
    private readonly recipients: RecipientsRepository,
  ) {
    this.dispatchers = new Map(dispatchers.map((d) => [d.method, d]));
  }

  // Per-call read, never cached (CLAUDE.md secret-flag discipline). Default
  // false ⇒ dispatch is a no-op until the operator flips the flag.
  private async recipientDispatchEnabled(): Promise<boolean> {
    try {
      return (await this.secrets.get('RECIPIENT_DISPATCH_ENABLED')) === 'true';
    } catch {
      return false;
    }
  }

  private emitRecipientSetupPending(
    txId: string,
    memberId: string,
    recipientId: string | null,
  ): void {
    const event: IDomainEvent<{
      txId: string;
      memberId: string;
      recipientId: string | null;
    }> = {
      eventId: randomUUID(),
      occurredAt: new Date(),
      aggregateId: txId,
      aggregateType: 'UsdcTransaction',
      eventType: PAYMENT_EVENTS.RECIPIENT_SETUP_PENDING,
      payload: { txId, memberId, recipientId },
    };
    this.events.emit(PAYMENT_EVENTS.RECIPIENT_SETUP_PENDING, event);
  }

  async dispatchTransfer(txId: string): Promise<void> {
    const state = await this.stateMachine.getCurrentState(txId);
    if (state !== TxState.USDC_LOCKED) {
      this.blog.warn('dispatchTransfer', {
        txId,
        detail: { skipped: true, state },
      });
      return;
    }

    const dispatchEnabled = await this.recipientDispatchEnabled();
    if (!dispatchEnabled) {
      this.blog.info('dispatchTransfer', {
        txId,
        detail: { skipped: true, reason: 'RECIPIENT_DISPATCH_ENABLED=false' },
      });
      return;
    }

    const txRows = await this.dataSource.query<TxRow[]>(
      `SELECT tx_id, member_id, amount_usdc_wei, direction, idempotency_key, recipient_id
         FROM usdc_transactions WHERE tx_id = $1`,
      [txId],
    );
    if (txRows.length === 0) throw new Error(`Tx not found: ${txId}`);
    const tx = txRows[0];

    if (tx.direction !== Direction.CREDIT) {
      this.blog.warn('dispatchTransfer', {
        txId,
        memberId: tx.member_id,
        detail: { skipped: true, reason: 'non_credit', direction: tx.direction },
      });
      return;
    }

    if (!tx.recipient_id) {
      this.blog.error('dispatchTransfer', {
        txId,
        memberId: tx.member_id,
        detail: { reason: 'missing_recipient_id', outcome: 'recipient_setup_pending' },
      });
      this.emitRecipientSetupPending(txId, tx.member_id, null);
      return;
    }

    const amount = BigInt(tx.amount_usdc_wei);
    const balance = await this.ledger.getBalance(tx.member_id);
    if (balance < DISPATCH_FLOOR_UNITS) {
      this.blog.info('dispatchTransfer', {
        txId,
        memberId: tx.member_id,
        detail: {
          balance: balance.toString(),
          floor: DISPATCH_FLOOR_UNITS.toString(),
          outcome: 'dispatch_deferred',
        },
      });
      const event: IDomainEvent<{ txId: string; memberId: string; balance: string }> = {
        eventId: randomUUID(),
        occurredAt: new Date(),
        aggregateId: txId,
        aggregateType: 'UsdcTransaction',
        eventType: PAYMENT_EVENTS.DISPATCH_DEFERRED,
        payload: { txId, memberId: tx.member_id, balance: balance.toString() },
      };
      this.events.emit(PAYMENT_EVENTS.DISPATCH_DEFERRED, event);
      return;
    }

    const recipient = await this.recipients.findById(tx.recipient_id);
    if (!recipient || recipient.dispatch_status !== 'READY') {
      this.blog.info('dispatchTransfer', {
        txId,
        memberId: tx.member_id,
        recipientId: tx.recipient_id,
        detail: {
          dispatchStatus: recipient?.dispatch_status ?? 'MISSING',
          outcome: 'recipient_setup_pending',
        },
      });
      this.emitRecipientSetupPending(txId, tx.member_id, tx.recipient_id);
      return;
    }

    const dispatcher = this.dispatchers.get(recipient.payout_method);
    if (!dispatcher) {
      throw new UnsupportedPayoutMethodError(recipient.payout_method);
    }

    this.blog.info('dispatchTransfer', {
      txId,
      memberId: tx.member_id,
      recipientId: tx.recipient_id,
      detail: {
        phase: 'start',
        amount: amount.toString(),
        payoutMethod: recipient.payout_method,
      },
    });

    let result;
    const startedAt = Date.now();
    try {
      result = await dispatcher.dispatch({
        idempotencyKey: tx.idempotency_key,
        recipient,
        amountUsdcUnits: amount,
        txId: tx.tx_id,
      });
    } catch (err) {
      this.blog.error('dispatchTransfer', {
        txId,
        memberId: tx.member_id,
        recipientId: tx.recipient_id,
        detail: { phase: 'dispatcher_call', payoutMethod: recipient.payout_method },
        error: err,
        durationMs: Date.now() - startedAt,
      });
      await this.stateMachine.transition(txId, TxState.FAILED_DISPATCH, {
        error: err instanceof Error ? err.message : String(err),
        payout_method: recipient.payout_method,
      });
      return;
    }

    this.blog.info('dispatchTransfer', {
      txId,
      memberId: tx.member_id,
      recipientId: tx.recipient_id,
      detail: {
        phase: 'dispatcher_call',
        idempotencyKey: tx.idempotency_key,
        providerRef: result.providerRef,
        payoutMethod: recipient.payout_method,
        duplicate: result.duplicate,
      },
      durationMs: Date.now() - startedAt,
    });

    if (!result.duplicate) {
      await this.ledger.debitUsdc(
        tx.member_id,
        amount,
        txId,
        `${tx.idempotency_key}:debit`,
      );
    }

    await this.stateMachine.transition(txId, TxState.DISPATCHED, {
      provider_ref: result.providerRef,
      payout_method: recipient.payout_method,
      duplicate: result.duplicate,
    });
  }

  // Settlement webhook handler — provider-agnostic, called by the
  // custodial-webhook controller after signature verification. Chain
  // settlement can call this same method from a tx-receipt watcher.
  async handleSettlementWebhook(
    provider: 'CUSTODIAL' | 'CHAIN',
    body: SettlementWebhookBody,
  ): Promise<void> {
    const first = await this.dedup.markProcessed(provider, body.id);
    if (!first) {
      this.blog.debug('handleSettlementWebhook', {
        detail: { provider, webhookId: body.id, outcome: 'already_processed' },
      });
      return;
    }

    const txRows = await this.dataSource.query<{
      tx_id: string;
      member_id: string;
      amount_usdc_wei: string;
      idempotency_key: string;
      recipient_id: string | null;
    }[]>(
      `SELECT u.tx_id, u.member_id, u.amount_usdc_wei, u.idempotency_key, u.recipient_id
         FROM tx_state_transitions t
         JOIN usdc_transactions u ON u.tx_id = t.tx_id
        WHERE t.to_state = 'DISPATCHED'
          AND t.metadata->>'provider_ref' = $1
        ORDER BY t.occurred_at DESC
        LIMIT 1`,
      [body.providerRef],
    );
    if (txRows.length === 0) {
      this.blog.error('handleSettlementWebhook', {
        detail: {
          provider,
          webhookId: body.id,
          providerRef: body.providerRef,
          reason: 'no_tx_for_provider_ref',
        },
      });
      return;
    }
    const tx = txRows[0];

    if (body.type === 'transfer.settled') {
      // Look up the recipient's payout_method for railUsed metadata.
      let railUsed: RailUsed | null = null;
      if (tx.recipient_id) {
        const r = await this.recipients.findById(tx.recipient_id);
        if (r) {
          railUsed = r.payout_method === 'WALLET_CHAIN' ? RailUsed.WALLET_CHAIN : RailUsed.CUSTODIAL;
        }
      }
      await this.stateMachine.transition(tx.tx_id, TxState.SETTLED, {
        provider_ref: body.providerRef,
        settled_at: body.settledAt,
        rail_used: railUsed,
      });
      this.blog.info('handleSettlementWebhook', {
        txId: tx.tx_id,
        memberId: tx.member_id,
        detail: {
          provider,
          providerRef: body.providerRef,
          railUsed,
          settledAt: body.settledAt,
          outcome: 'settled',
        },
      });
      return;
    }

    // transfer.failed — reverse the debit and move to FAILED_DISPATCH.
    this.blog.error('handleSettlementWebhook', {
      txId: tx.tx_id,
      memberId: tx.member_id,
      detail: {
        provider,
        providerRef: body.providerRef,
        failureReason: body.failureReason ?? 'unknown',
        outcome: 'failed',
      },
    });
    await this.stateMachine.transition(tx.tx_id, TxState.FAILED_DISPATCH, {
      provider_ref: body.providerRef,
      failure_reason: body.failureReason ?? 'unknown',
    });
    await this.ledger.creditUsdc(
      tx.member_id,
      BigInt(tx.amount_usdc_wei),
      SourceType.MESH,
      `${tx.idempotency_key}:reversal`,
      `${tx.idempotency_key}:reversal`,
      { reversal_of: tx.tx_id },
    );
  }
}
