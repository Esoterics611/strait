import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PAYMENT_EVENTS } from '../../events/domain-event-emitter.service';
import { IDomainEvent } from '@common/interfaces';
import { BusinessLogger } from '@common/logging';

/**
 * Mirrors every payment.* domain event to the domain_events_log table so the
 * admin tx detail page can render the full event history per transaction.
 */
@Injectable()
export class DomainEventsLogger {
  private readonly blog = new BusinessLogger('DomainEventsLogger');

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @OnEvent(PAYMENT_EVENTS.USDC_CREDITED)
  @OnEvent(PAYMENT_EVENTS.USDC_DEBITED)
  @OnEvent(PAYMENT_EVENTS.USDC_LOCKED)
  @OnEvent(PAYMENT_EVENTS.DISPATCHED)
  @OnEvent(PAYMENT_EVENTS.SETTLED)
  @OnEvent(PAYMENT_EVENTS.FAILED)
  @OnEvent(PAYMENT_EVENTS.REFUNDED)
  @OnEvent(PAYMENT_EVENTS.DELAYED)
  @OnEvent(PAYMENT_EVENTS.DISPATCH_DEFERRED)
  async record(event: IDomainEvent<{ txId?: string }>): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO domain_events_log(tx_id, event_type, payload, occurred_at)
         VALUES ($1, $2, $3, $4)`,
        [
          event.payload?.txId ?? null,
          event.eventType,
          JSON.stringify(event.payload),
          event.occurredAt,
        ],
      );
    } catch (err) {
      // Logging failure must not break the event pipeline.
      this.blog.error('record', {
        txId: event.payload?.txId,
        detail: { eventType: event.eventType },
        error: err,
      });
    }
  }
}
