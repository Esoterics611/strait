import { Global, Module } from '@nestjs/common';
import { SecretsModule } from '../secrets/secrets.module';
import { MetricsService } from './metrics/metrics.service';
import { MetricsController } from './metrics/metrics.controller';

@Global()
@Module({
  imports: [SecretsModule],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class ObservabilityModule {}
