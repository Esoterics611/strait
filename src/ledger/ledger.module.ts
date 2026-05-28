import { Module } from '@nestjs/common';
import { ShadowLedgerService } from './shadow-ledger.service';
import { DatabaseModule } from '../database/database.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [DatabaseModule, EventsModule],
  providers: [ShadowLedgerService],
  exports: [ShadowLedgerService],
})
export class LedgerModule {}
