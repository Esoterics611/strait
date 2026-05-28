import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { fromEvent, merge, Observable, Subject, timer } from 'rxjs';
import { filter, map, takeUntil } from 'rxjs/operators';
import { SessionStubGuard } from './session-stub.guard';
import { OnRampOrchestrator } from '../onramp/onramp.orchestrator';
import { TxState } from '@common/enums';
import { IDomainEvent } from '@common/interfaces';
import { PAYMENT_EVENTS } from '../events/domain-event-emitter.service';

interface InitiateBody {
  memberId: string;
  path: 'MESH' | 'ONRAMP' | 'SELF';
  amountUsdcUnits: string;
}

interface TxSnapshot {
  txId: string;
  state: TxState;
  amountUsdcUnits: string;
  sourceType: string;
  createdAt: string;
  bridgeTransferId: string | null;
  settledAt: string | null;
  railUsed: string | null;
  achEstimatedDate: string | null;
}

@Controller('api/transactions')
export class TransactionsController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly onramp: OnRampOrchestrator,
    private readonly emitter: EventEmitter2,
  ) {}

  // Initiates a tx. For ONRAMP, returns the virtual-account details (the actual
  // tx is webhook-initiated when Rapyd notifies us of the ILS payment). For MESH
  // and SELF, returns a 501 in this PoC build (Path A deferred; Path C built
  // in Session 7).
  @Post()
  @UseGuards(SessionStubGuard)
  async initiate(@Body() body: InitiateBody): Promise<{ kind: string; data: unknown }> {
    if (!body.memberId || !body.path) {
      throw new BadRequestException('memberId and path are required');
    }
    if (body.path === 'ONRAMP') {
      const details = await this.onramp.createVirtualAccount(body.memberId);
      return { kind: 'virtual_account', data: details };
    }
    if (body.path === 'MESH') {
      throw new HttpException(
        'Path A (Mesh) is not yet implemented in this build — coming soon.',
        501,
      );
    }
    throw new HttpException('Path C is not enabled in this environment.', 503);
  }

  @Get(':txId')
  @UseGuards(SessionStubGuard)
  async get(@Param('txId') txId: string): Promise<TxSnapshot> {
    return this.loadSnapshot(txId);
  }

  // SSE — no auth guard. The txId is unguessable (UUID v4) so this is acceptable
  // for the PoC. Browsers don't send arbitrary Authorization headers on EventSource
  // by default. Production should use a short-lived signed token in the query string.
  @Sse(':txId/status')
  status(@Param('txId') txId: string): Observable<MessageEvent> {
    const done = new Subject<void>();
    const eventNames = [
      PAYMENT_EVENTS.USDC_LOCKED,
      PAYMENT_EVENTS.BRIDGE_DISPATCHED,
      PAYMENT_EVENTS.SETTLED,
      PAYMENT_EVENTS.FAILED,
      PAYMENT_EVENTS.DELAYED,
      PAYMENT_EVENTS.REFUNDED,
      PAYMENT_EVENTS.DISPATCH_DEFERRED,
    ];

    // Snapshot first, then live events, then a 15s keep-alive ping.
    const snapshot$ = new Observable<TxSnapshot>((sub) => {
      this.loadSnapshot(txId)
        .then((s) => {
          sub.next(s);
          sub.complete();
        })
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
           SELECT t.metadata->>'bridge_transfer_id'
             FROM tx_state_transitions t
            WHERE t.tx_id = u.tx_id
              AND t.to_state = 'BRIDGE_DISPATCHED'
            ORDER BY t.occurred_at DESC
            LIMIT 1
         ) AS bridge_transfer_id,
         (
           SELECT t.metadata->>'settled_at'
             FROM tx_state_transitions t
            WHERE t.tx_id = u.tx_id
              AND t.to_state = 'SETTLED_USD'
            ORDER BY t.occurred_at DESC
            LIMIT 1
         ) AS settled_at,
         (
           SELECT t.metadata->>'rail_used'
             FROM tx_state_transitions t
            WHERE t.tx_id = u.tx_id
              AND t.to_state = 'SETTLED_USD'
            ORDER BY t.occurred_at DESC
            LIMIT 1
         ) AS rail_used
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
      bridgeTransferId: r.bridge_transfer_id,
      settledAt: r.settled_at,
      railUsed: r.rail_used,
      achEstimatedDate: null,
    };
  }
}

interface RawTxRow {
  tx_id: string;
  state: string;
  amount_usdc_wei: string;
  source_type: string;
  created_at: string;
  bridge_transfer_id: string | null;
  settled_at: string | null;
  rail_used: string | null;
}
