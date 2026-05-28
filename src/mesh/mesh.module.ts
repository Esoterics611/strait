import { Module } from '@nestjs/common';
import { SecurityModule } from '../security/security.module';
import { SecretsModule } from '../secrets/secrets.module';
import { LedgerModule } from '../ledger/ledger.module';
import { StateMachineModule } from '../state-machine/state-machine.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { EventsModule } from '../events/events.module';
import { DatabaseModule } from '../database/database.module';
import { MeshService } from './mesh.service';
import { MeshController } from './mesh.controller';
import { RealMeshApiClient } from './real-mesh-api.client';
import { MockMeshApiClient } from './mock-mesh-api.client';
import { StubOFACScreener, OFAC_SCREENER } from './ofac-screener.service';
import { MESH_API_CLIENT } from './mesh-api-client.interface';
import {
  ISecretProvider,
  SECRET_PROVIDER,
} from '../secrets/secret-provider.interface';

@Module({
  imports: [
    SecurityModule,
    SecretsModule,
    LedgerModule,
    StateMachineModule,
    IdempotencyModule,
    WebhooksModule,
    EventsModule,
    DatabaseModule,
  ],
  controllers: [MeshController],
  providers: [
    RealMeshApiClient,
    MockMeshApiClient,
    StubOFACScreener,
    {
      provide: OFAC_SCREENER,
      useExisting: StubOFACScreener,
    },
    {
      provide: MESH_API_CLIENT,
      inject: [SECRET_PROVIDER, MockMeshApiClient, RealMeshApiClient],
      useFactory: async (
        secrets: ISecretProvider,
        mock: MockMeshApiClient,
        real: RealMeshApiClient,
      ) => {
        let mockEnabled = true;
        try {
          mockEnabled = (await secrets.get('MOCK_MESH_ENABLED')) !== 'false';
        } catch {
          mockEnabled = true;
        }
        return mockEnabled ? mock : real;
      },
    },
    MeshService,
  ],
  exports: [MeshService, MESH_API_CLIENT, OFAC_SCREENER],
})
export class MeshModule {}
