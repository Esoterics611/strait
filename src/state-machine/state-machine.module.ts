import { Module } from '@nestjs/common';
import { StateMachineService } from './state-machine.service';
import { EventsModule } from '../events/events.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [EventsModule, OutboxModule],
  providers: [StateMachineService],
  exports: [StateMachineService],
})
export class StateMachineModule {}
