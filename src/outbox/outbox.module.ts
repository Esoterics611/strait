import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { OutboxRepository } from './outbox.repository';
import { OutboxRelay } from './outbox.relay';

// ARCH-1 Phase 3. OutboxRepository is the transactional writer (used by
// StateMachineService inside the state-transition tx); OutboxRelay is the
// in-process crash-recovery sweep. The future scale-out (separate process,
// same image, same DB, runs only the sweep) is an ops change — see §10h.
@Module({
  imports: [EventsModule],
  providers: [OutboxRepository, OutboxRelay],
  exports: [OutboxRepository, OutboxRelay],
})
export class OutboxModule {}
