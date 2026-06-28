import { Module } from '@nestjs/common';
import { SecretsModule } from '../secrets/secrets.module';
import { DatabaseModule } from '../database/database.module';
import { EventsModule } from '../events/events.module';
import { MembersController } from './members.controller';
import { TransactionsController } from './transactions.controller';
import { SessionStubGuard } from './session-stub.guard';

@Module({
  imports: [SecretsModule, DatabaseModule, EventsModule],
  controllers: [MembersController, TransactionsController],
  providers: [SessionStubGuard],
})
export class ApiModule {}
