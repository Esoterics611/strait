import { Module } from '@nestjs/common';
import { DomainEventEmitterService } from './domain-event-emitter.service';

@Module({
  providers: [DomainEventEmitterService],
  exports: [DomainEventEmitterService],
})
export class EventsModule {}
