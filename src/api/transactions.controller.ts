import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { fromEvent, merge, Observable, Subject, timer } from 'rxjs';
import { filter, map, takeUntil } from 'rxjs/operators';
import { SessionStubGuard } from './session-stub.guard';
import { TxState } from '@common/enums';
import { IDomainEvent } from '@common/interfaces';
import { PAYMENT_EVENTS } from '../events/domain-event-emitter.service';

interface TxSnapshot {
  txId: string;
  state: TxState;
  amountUsdcUnits: string;
  sourceType: string;
  createdAt: string;
  dispatchTxHash: string | null;
  settledAt: string | null;
  payoutMethodUsed: string | null;
}

@Controller('api/transactions')
export class TransactionsController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly emitter: EventEmitter2,
  ) {}

  @Get(':txId')
  @UseGuards(SessionStubGuard)
  async get(@Param('txId') txId: string): Promise<TxSnapshot> {
    return this.loadSnapshot(txId);
  }

  @Sse(':txId/status')
  status(@Param('txId') txId: string): Observable<MessageEvent> {
    const done = new Subject<void>();
    const eventNames = [
      PAYMENT_EVENTS.USDC_LOCKED,
      PAYMENT_EVENTS.DISPATCHED,
      PAYMENT_EVENTS.SETTLED,
      PAYMENT_EVENTS.FAILED,
      PAYMENT_EVENTS.DELAYED,
      PAYMENT_EVENTS.REFUNDED,
      PAYMENT_EVENTS.DISPATCH_DEFERRED,
    ];

    const snapshot$ = new Observable<TxSnapshot>((sub) => {
      this.loadSnapshot(txId)
        .then((s) => { sub.next(s); sub.complete(); })
        .catch((err) => sub.error(err));
    }).pipe(map((s) => this.frame('snapshot', s)));

    const live$ = merge(
      ...eventNames.map((name) =>
        fromEvent<IDomainEvent<{ txId?: string }>>(this.emitter, name).pipe(
          filter((e) => e.aggregateId === txId || e.payload?.txId === txId),
          map((e) => this.frame(name, { ...e.payload, eventType: name })),
        ),
      ),
    );

    const ping$ = timer(15_000, 15_000).pipe(map(() => this.frame('ping', { t: Date.now() })));

    return merge(snapshot$, live$, ping$).pipe(takeUntil(done));
  }

  private frame(type: string, data: unknown): MessageEvent {
    return { data: JSON.stringify({ type, payload: data }) } as MessageEvent;
  }

  private async loadSnapshot(txId: string): Promise<TxSnapshot> {
    const rows = await this.dataSource.query<RawTxRow[]>(
      `SELECT
         u.tx_id,
         COALESCE(v.current_state, u.state) AS state,
         u.amount_usdc_wei,
         u.source_type,
         u.created_at,
         (
           SELECT t.metadata->>'dispatch_tx_hash'
             FROM tx_state_transitions t
            WHERE t.tx_id = u.tx_id
              AND t.to_state = 'DISPATCHED'
            ORDER BY t.occurred_at DESC
            LIMIT 1
         ) AS dispatch_tx_hash,
         (
           SELECT t.occurred_at::text
             FROM tx_state_transitions t
            WHERE t.tx_id = u.tx_id
              AND t.to_state = 'SETTLED'
            ORDER BY t.occurred_at DESC
            LIMIT 1
         ) AS settled_at,
         (
           SELECT t.metadata->>'payout_method_used'
             FROM tx_state_transitions t
            WHERE t.tx_id = u.tx_id
              AND t.to_state = 'SETTLED'
            ORDER BY t.occurred_at DESC
            LIMIT 1
         ) AS payout_method_used
       FROM usdc_transactions u
       LEFT JOIN v_tx_current_state v ON v.tx_id = u.tx_id
       WHERE u.tx_id = $1`,
      [txId],
    );
    if (rows.length === 0) throw new NotFoundException(`tx ${txId} not found`);
    const r = rows[0];
    return {
      txId: r.tx_id,
      state: r.state as TxState,
      amountUsdcUnits: r.amount_usdc_wei,
      sourceType: r.source_type,
      createdAt: r.created_at,
      dispatchTxHash: r.dispatch_tx_hash,
      settledAt: r.settled_at,
      payoutMethodUsed: r.payout_method_used,
    };
  }
}

interface RawTxRow {
  tx_id: string;
  state: string;
  amount_usdc_wei: string;
  source_type: string;
  created_at: string;
  dispatch_tx_hash: string | null;
  settled_at: string | null;
  payout_method_used: string | null;
}
