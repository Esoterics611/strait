import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { LedgerModule } from '../ledger/ledger.module';
import { StateMachineModule } from '../state-machine/state-machine.module';
import { MeshModule } from '../mesh/mesh.module';
import { ObservabilityModule } from '../observability/observability.module';

import { RefundExecutorRepository } from './refund-executor.repository';
import { RefundExecutorCron } from './refund-executor.cron';
import { PathAMeshRefundExecutor } from './path-a-mesh-refund.executor';

@Module({
  imports: [
    DatabaseModule,
    LedgerModule,
    StateMachineModule,
    MeshModule,
    ObservabilityModule,
  ],
  providers: [
    RefundExecutorRepository,
    RefundExecutorCron,
    PathAMeshRefundExecutor,
  ],
  exports: [RefundExecutorCron],
})
export class RefundsModule {}
