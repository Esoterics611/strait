import { Module } from '@nestjs/common';
import { SecurityModule } from '../security/security.module';
import { SecretsModule } from '../secrets/secrets.module';
import { LedgerModule } from '../ledger/ledger.module';
import { StateMachineModule } from '../state-machine/state-machine.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { EventsModule } from '../events/events.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { DatabaseModule } from '../database/database.module';
import { RecipientsModule } from '../recipients/recipients.module';
import { DispatchService } from './dispatch.service';
import { DispatchListener } from './dispatch.listener';
import { ChainDispatcher } from './chain-dispatcher.adapter';
import { CustodialDispatcher } from './custodial-dispatcher.adapter';
import { OUTBOUND_DISPATCHERS } from './outbound-dispatcher.interface';

@Module({
  imports: [
    SecurityModule,
    SecretsModule,
    LedgerModule,
    StateMachineModule,
    IdempotencyModule,
    EventsModule,
    WebhooksModule,
    DatabaseModule,
    RecipientsModule,
  ],
  providers: [
    ChainDispatcher,
    CustodialDispatcher,
    {
      provide: OUTBOUND_DISPATCHERS,
      inject: [ChainDispatcher, CustodialDispatcher],
      useFactory: (chain: ChainDispatcher, custodial: CustodialDispatcher) => [
        chain,
        custodial,
      ],
    },
    DispatchService,
    DispatchListener,
  ],
  exports: [DispatchService],
})
export class DispatchModule {}
