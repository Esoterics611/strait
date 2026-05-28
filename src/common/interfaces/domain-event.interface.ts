export interface IDomainEvent<TPayload = unknown> {
  eventId: string;
  occurredAt: Date;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  payload: TPayload;
}
