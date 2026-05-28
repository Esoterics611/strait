import { Module } from '@nestjs/common';
import { WebhookDeduplicationService } from './dedup.service';

@Module({
  providers: [WebhookDeduplicationService],
  exports: [WebhookDeduplicationService],
})
export class WebhooksModule {}
