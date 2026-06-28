import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EventsModule } from '../events/events.module';
import { RecipientsController } from './recipients.controller';
import { RecipientsService } from './recipients.service';
import { RecipientsRepository } from './recipients.repository';

@Module({
  imports: [DatabaseModule, EventsModule],
  controllers: [RecipientsController],
  providers: [RecipientsRepository, RecipientsService],
  exports: [RecipientsService, RecipientsRepository],
})
export class RecipientsModule {}
