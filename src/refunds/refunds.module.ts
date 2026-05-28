import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { LedgerModule } from '../ledger/ledger.module';
import { StateMachineModule } from '../state-machine/state-machine.module';
import { MeshModule } from '../mesh/mesh.module';
import { OnRampModule } from '../onramp/onramp.module';
import { PathCModule } from '../path-c/path-c.module';
import { ObservabilityModule } from '../observability/observability.module';

import { RefundExecutorRepository } from './refund-executor.repository';
import { RefundExecutorCron } from './refund-executor.cron';
import { PathAMeshRefundExecutor } from './path-a-mesh-refund.executor';
import { PathBRapydRefundExecutor } from './path-b-rapyd-refund.executor';
import { PathCWireRefundExecutor } from './path-c-wire-refund.executor';
import { WIRE_OUT_ADAPTER } from './wire-out-adapter.interface';
import { StubWireOutAdapter } from './stub-wire-out.adapter';

@Module({
  imports: [
    DatabaseModule,
    LedgerModule,
    StateMachineModule,
    MeshModule,
    OnRampModule,
    forwardRef(() => PathCModule),
    ObservabilityModule,
  ],
  providers: [
    RefundExecutorRepository,
    RefundExecutorCron,
    PathAMeshRefundExecutor,
    PathBRapydRefundExecutor,
    PathCWireRefundExecutor,
    StubWireOutAdapter,
    {
      provide: WIRE_OUT_ADAPTER,
      useExisting: StubWireOutAdapter,
    },
  ],
  exports: [RefundExecutorCron],
})
export class RefundsModule {}
