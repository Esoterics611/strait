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
  [TxState.MESH_PENDING]:    [TxState.USDC_LOCKED, TxState.FAILED],
  [TxState.USDC_LOCKED]:     [TxState.DISPATCHED, TxState.FAILED_DISPATCH],
  [TxState.DISPATCHED]:      [TxState.SETTLED, TxState.FAILED_DISPATCH],
  [TxState.FAILED]:          [TxState.REFUND_QUEUED],
  [TxState.FAILED_DISPATCH]: [TxState.REFUND_QUEUED],
  [TxState.REFUND_QUEUED]:   [TxState.REFUNDED],
  // SETTLED and REFUNDED are terminal — no outbound edges.
};

const STATE_TO_EVENT: Partial<Record<TxState, string>> = {
  [TxState.USDC_LOCKED]:     PAYMENT_EVENTS.USDC_LOCKED,
  [TxState.DISPATCHED]:      PAYMENT_EVENTS.DISPATCHED,
  [TxState.SETTLED]:         PAYMENT_EVENTS.SETTLED,
  [TxState.FAILED]:          PAYMENT_EVENTS.FAILED,
  [TxState.FAILED_DISPATCH]: PAYMENT_EVENTS.FAILED,
  [TxState.REFUNDED]:        PAYMENT_EVENTS.REFUNDED,
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

    let outboxId: string;
    await this.dataSource.transaction(async (em) => {
      await em.query(transitionSql, transitionParams);
      outboxId = await this.outbox.writeInTransaction(em, eventName, event);
    });
    this.blog.debug('transition', {
      txId,
      detail: { outboxId: outboxId!, event: eventName },
    });

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
