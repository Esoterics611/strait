import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EventsModule } from '../events/events.module';
import { SecretsModule } from '../secrets/secrets.module';
import {
  ISecretProvider,
  SECRET_PROVIDER,
} from '../secrets/secret-provider.interface';
import { RecipientsController } from './recipients.controller';
import { RecipientsService } from './recipients.service';
import { RecipientsRepository } from './recipients.repository';
import { BRIDGE_RECIPIENT_CLIENT } from './bridge-recipient-client.interface';
import { MockBridgeRecipientClient } from './mock-bridge-recipient.client';
import { RealBridgeRecipientClient } from './real-bridge-recipient.client';

@Module({
  imports: [DatabaseModule, EventsModule, SecretsModule],
  controllers: [RecipientsController],
  providers: [
    RecipientsRepository,
    RecipientsService,
    MockBridgeRecipientClient,
    RealBridgeRecipientClient,
    {
      // mock-default, like BRIDGE_API_CLIENT / ONRAMP_ADAPTER. Shares the
      // MOCK_BRIDGE_ENABLED switch so recipient registration and transfer
      // dispatch flip to real Bridge together.
      provide: BRIDGE_RECIPIENT_CLIENT,
      inject: [SECRET_PROVIDER, MockBridgeRecipientClient, RealBridgeRecipientClient],
      useFactory: async (
        secrets: ISecretProvider,
        mock: MockBridgeRecipientClient,
        real: RealBridgeRecipientClient,
      ) => {
        let mockEnabled = true;
        try {
          mockEnabled = (await secrets.get('MOCK_BRIDGE_ENABLED')) !== 'false';
        } catch {
          mockEnabled = true;
        }
        return mockEnabled ? mock : real;
      },
    },
  ],
  exports: [RecipientsService, RecipientsRepository],
})
export class RecipientsModule {}
