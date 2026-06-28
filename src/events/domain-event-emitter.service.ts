import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IDomainEvent } from '@common/interfaces';

export const PAYMENT_EVENTS = {
  USDC_CREDITED: 'payment.usdc_credited',
  USDC_DEBITED: 'payment.usdc_debited',
  USDC_LOCKED: 'payment.usdc_locked',
  DISPATCHED: 'payment.dispatched',
  SETTLED: 'payment.settled',
  FAILED: 'payment.failed',
  REFUNDED: 'payment.refunded',
  DELAYED: 'payment.delayed',
  DISPATCH_DEFERRED: 'payment.dispatch_deferred',
  // Non-terminal: recipient Bridge registration not yet READY. No money moves;
  // the row stays USDC_LOCKED and is re-driven when the recipient is ready
  // (MEMBER_APP_DESIGN.md §6.5 / Appendix A).
  RECIPIENT_SETUP_PENDING: 'payment.recipient_setup_pending',
} as const;

export type PaymentEventName =
  (typeof PAYMENT_EVENTS)[keyof typeof PAYMENT_EVENTS];

@Injectable()
export class DomainEventEmitterService {
  constructor(private readonly emitter: EventEmitter2) {}

  emit<T>(eventName: PaymentEventName, event: IDomainEvent<T>): void {
    this.emitter.emit(eventName, event);
  }
}
