import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { OutboxRepository, OutboxRow } from './outbox.repository';
import {
  DomainEventEmitterService,
  PaymentEventName,
} from '../events/domain-event-emitter.service';
import { IDomainEvent } from '@common/interfaces';
import { BusinessLogger } from '@common/logging';

const SWEEP_BATCH = 200;

// ARCH-1 Phase 3 — in-process outbox relay (DESIGNED-FOR, not built, as a
// separate deployable). On the happy path StateMachineService already emitted
// the in-memory event (byte-identical to pre-outbox behaviour) and retired
// the row synchronously, so the sweep only ever sees rows the process failed
// to deliver (crash between COMMIT and emit). Re-delivery is safe: every
// consumer is idempotent (webhook dedup, idempotency_key, append-only state
// guards). To scale out later, run the SAME image with a flag that starts
// ONLY this sweep against the SAME database — ops change, not a rewrite.
@Injectable()
export class OutboxRelay {
  private readonly blog = new BusinessLogger('OutboxRelay');
  private emptyTicks = 0;

  constructor(
    private readonly repo: OutboxRepository,
    private readonly events: DomainEventEmitterService,
  ) {}

  @Interval('outbox-sweep', 5000)
  async sweep(): Promise<number> {
    let rows: OutboxRow[];
    try {
      rows = await this.repo.fetchStuckPending(SWEEP_BATCH);
    } catch (err) {
      this.blog.warn('sweep', {
        detail: { phase: 'fetch_stuck_pending' },
        error: err,
      });
      return 0;
    }

    if (rows.length === 0) {
      this.emptyTicks++;
      // Throttle the clean-sweep line — every 10th empty tick only.
      if (this.emptyTicks % 10 === 0) {
        this.blog.debug('sweep', {
          detail: { outcome: 'no_stuck_events', emptyTicks: this.emptyTicks },
        });
      }
      return 0;
    }
    this.emptyTicks = 0;

    this.blog.warn('sweep', {
      detail: {
        outcome: 'found_stuck',
        count: rows.length,
        oldestOutboxId: rows[0].id,
        oldestEventAt: rows[0].payload.occurredAt,
      },
    });

    let delivered = 0;
    for (const row of rows) {
      try {
        await this.deliver(row);
        delivered++;
        this.blog.info('sweep', {
          detail: {
            outcome: 're_delivered',
            outboxId: row.id,
            eventName: row.event_name,
            aggregateId: row.payload.aggregateId,
          },
        });
      } catch (err) {
        this.blog.error('sweep', {
          detail: {
            outcome: 're_delivery_failed',
            outboxId: row.id,
            eventName: row.event_name,
            note: 'will retry next sweep',
          },
          error: err,
        });
      }
    }
    if (delivered > 0) {
      this.blog.warn('sweep', {
        detail: {
          outcome: 'recovered',
          delivered,
          note: 'stuck by a prior crash',
        },
      });
    }
    return delivered;
  }

  // Reconstructs the event faithfully (occurredAt JSON string -> Date) and
  // emits it on the SAME bus the in-process emit uses, then retires the row.
  async deliver(row: OutboxRow): Promise<void> {
    const raw = row.payload;
    const event: IDomainEvent<unknown> = {
      eventId: raw.eventId,
      occurredAt: new Date(raw.occurredAt),
      aggregateId: raw.aggregateId,
      aggregateType: raw.aggregateType,
      eventType: raw.eventType,
      payload: raw.payload,
    };
    this.events.emit(row.event_name as PaymentEventName, event);
    await this.repo.markDispatched(row.id);
  }
}
