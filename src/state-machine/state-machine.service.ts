import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TxState } from '@common/enums';
import { DomainEventEmitterService, PAYMENT_EVENTS } from '../events/domain-event-emitter.service';
import { InvalidTransitionError, TransactionNotFoundError } from '@common/errors';
import { IDomainEvent } from '@common/interfaces';
import { OutboxRepository } from '../outbox/outbox.repository';
import { BusinessLogger } from '@common/logging';
import { randomUUID } from 'crypto';

type TransitionMap = Partial<Record<TxState, TxState[]>>;

const TRANSITIONS: TransitionMap = {
  [TxState.MESH_PENDING]:           [TxState.USDC_LOCKED, TxState.FAILED],
  [TxState.ILS_PENDING_ONRAMP]:     [TxState.ILS_SWAP_PROCESSING, TxState.FAILED],
  [TxState.ILS_SWAP_PROCESSING]:    [TxState.USDC_LOCKED, TxState.FAILED],
  [TxState.ILS_PENDING_COLLECTION]: [TxState.ILS_WIRE_CONFIRMED, TxState.FAILED],
  [TxState.ILS_WIRE_CONFIRMED]:     [TxState.USDC_LOCKED, TxState.FAILED],
  [TxState.USDC_LOCKED]:            [TxState.BRIDGE_DISPATCHED, TxState.FAILED_BRIDGE],
  [TxState.BRIDGE_DISPATCHED]:      [TxState.SETTLED_USD, TxState.FAILED_BRIDGE],
  [TxState.FAILED]:                 [TxState.REFUND_QUEUED],
  [TxState.FAILED_BRIDGE]:          [TxState.REFUND_QUEUED],
  [TxState.REFUND_QUEUED]:          [TxState.REFUNDED],
  // SETTLED_USD and REFUNDED are terminal — no outbound edges.
};

const STATE_TO_EVENT: Partial<Record<TxState, string>> = {
  [TxState.USDC_LOCKED]:       PAYMENT_EVENTS.USDC_LOCKED,
  [TxState.BRIDGE_DISPATCHED]: PAYMENT_EVENTS.BRIDGE_DISPATCHED,
  [TxState.SETTLED_USD]:       PAYMENT_EVENTS.SETTLED,
  [TxState.FAILED]:            PAYMENT_EVENTS.FAILED,
  [TxState.FAILED_BRIDGE]:     PAYMENT_EVENTS.FAILED,
  [TxState.REFUNDED]:          PAYMENT_EVENTS.REFUNDED,
};

@Injectable()
export class StateMachineService {
  private readonly blog = new BusinessLogger('StateMachineService');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly events: DomainEventEmitterService,
    private readonly outbox: OutboxRepository,
  ) {}

  async transition(
    txId: string,
    toState: TxState,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const startedAt = Date.now();
    const currentState = await this.getCurrentState(txId);

    const allowed = TRANSITIONS[currentState] ?? [];
    if (!allowed.includes(toState)) {
      this.blog.warn('transition', {
        txId,
        detail: { fromState: currentState, attemptedState: toState },
      });
      throw new InvalidTransitionError(txId, currentState, toState);
    }

    const metadataKeys = metadata ? Object.keys(metadata) : [];

    const transitionSql = `INSERT INTO tx_state_transitions(id, tx_id, from_state, to_state, metadata, occurred_at)
       VALUES(gen_random_uuid(), $1, $2, $3, $4, NOW())`;
    const transitionParams = [
      txId,
      currentState,
      toState,
      metadata ? JSON.stringify(metadata) : null,
    ];

    const eventName = STATE_TO_EVENT[toState];

    // Non-event transitions are byte-for-byte unchanged: a single autocommit
    // INSERT, no outbox, no emit.
    if (!eventName) {
      await this.dataSource.query(transitionSql, transitionParams);
      this.blog.info('transition', {
        txId,
        detail: { fromState: currentState, toState, metadataKeys, event: null },
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const event: IDomainEvent<{ txId: string; fromState: TxState; toState: TxState; metadata?: Record<string, unknown> }> = {
      eventId: randomUUID(),
      occurredAt: new Date(),
      aggregateId: txId,
      aggregateType: 'UsdcTransaction',
      eventType: eventName,
      payload: { txId, fromState: currentState, toState, metadata },
    };

    // ARCH-1 Phase 3: the state-transition row and the outbox event row
    // commit ATOMICALLY — the event can no longer be lost if the process
    // dies after the transition (closes the gap noted in CLAUDE.md §10e).
    let outboxId: string;
    await this.dataSource.transaction(async (em) => {
      await em.query(transitionSql, transitionParams);
      outboxId = await this.outbox.writeInTransaction(em, eventName, event);
    });
    this.blog.debug('transition', {
      txId,
      detail: { outboxId: outboxId!, event: eventName },
    });

    // Happy path: emit the in-memory event on the same bus, exactly as
    // before the outbox existed — same object, same synchronous delivery to
    // listeners, same transition() completion semantics. The outbox row is
    // then retired; a failure here is non-fatal (the sweep re-delivers, and
    // every consumer is idempotent), so transition() still succeeds once the
    // state change is durably committed — unchanged behaviour.
    this.events.emit(eventName as Parameters<typeof this.events.emit>[0], event);
    try {
      await this.outbox.markDispatched(outboxId!);
    } catch (err) {
      this.blog.warn('transition', {
        txId,
        detail: { outboxId: outboxId!, phase: 'mark_dispatched', note: 'sweep will retire it' },
        error: err,
      });
    }

    this.blog.info('transition', {
      txId,
      detail: { fromState: currentState, toState, metadataKeys, event: eventName },
      durationMs: Date.now() - startedAt,
    });
  }

  async getCurrentState(txId: string): Promise<TxState> {
    // Try tx_state_transitions first (subsequent transitions).
    const rows = await this.dataSource.query<{ current_state: TxState }[]>(
      `SELECT current_state FROM v_tx_current_state WHERE tx_id = $1`,
      [txId],
    );
    if (rows.length > 0) {
      this.blog.debug('getCurrentState', {
        txId,
        detail: { state: rows[0].current_state, source: 'view' },
      });
      return rows[0].current_state;
    }

    // Fall back to usdc_transactions.state (the immutable initial state at insert).
    const txRows = await this.dataSource.query<{ state: TxState }[]>(
      `SELECT state FROM usdc_transactions WHERE tx_id = $1`,
      [txId],
    );
    if (txRows.length === 0) throw new TransactionNotFoundError(txId);
    this.blog.debug('getCurrentState', {
      txId,
      detail: { state: txRows[0].state, source: 'initial' },
    });
    return txRows[0].state;
  }
}
