import { Module } from '@nestjs/common';
import { SecretsModule } from '../secrets/secrets.module';
import { LedgerModule } from '../ledger/ledger.module';
import { EventsModule } from '../events/events.module';
import { MeshModule } from '../mesh/mesh.module';
import { DevToolsService } from './dev-tools.service';
import { DevToolsController } from './dev-tools.controller';
import { DevToolsGuard } from './dev-tools.guard';

// Always imported in AppModule; the per-request DevToolsGuard short-circuits
// every endpoint with 403 when NODE_ENV='production' OR DEV_TOOLS_ENABLED is
// empty/unset. The module is loadable in production but operationally inert.
@Module({
  imports: [SecretsModule, LedgerModule, EventsModule, MeshModule],
  controllers: [DevToolsController],
  providers: [DevToolsService, DevToolsGuard],
})
export class DevToolsModule {}
