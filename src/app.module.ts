import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { HttpLoggingMiddleware } from './common/middleware/http-logging.middleware';
import { CorrelationMiddleware } from './common/logging/correlation.middleware';
import { LoggingModule } from './common/logging/logging.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'fs';
import { join } from 'path';
import { ConfigModule } from './config/config.module';
import { SecretsModule } from './secrets/secrets.module';
import { SecurityModule } from './security/security.module';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { LedgerModule } from './ledger/ledger.module';
import { StateMachineModule } from './state-machine/state-machine.module';
import { BridgeModule } from './bridge/bridge.module';
import { RecipientsModule } from './recipients/recipients.module';
import { OnRampModule } from './onramp/onramp.module';
import { MeshModule } from './mesh/mesh.module';
import { ApiModule } from './api/api.module';
import { AdminModule } from './admin/admin.module';
import { PathCModule } from './path-c/path-c.module';
import { DevToolsModule } from './dev-tools/dev-tools.module';
import { ObservabilityModule } from './observability/observability.module';
import { RefundsModule } from './refunds/refunds.module';
import { MemberAuthModule } from './api/auth/member-auth.module';
import { SECRET_PROVIDER } from './secrets/secret-provider.interface';
import { ISecretProvider } from './secrets/secret-provider.interface';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    SecretsModule,
    SecurityModule,
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [SECRET_PROVIDER],
      useFactory: async (secretProvider: ISecretProvider) => ({
        type: 'postgres' as const,
        url: await secretProvider.get('DATABASE_URL'),
        entities: [],
        synchronize: false,
      }),
    }),
    DatabaseModule,
    EventsModule,
    IdempotencyModule,
    WebhooksModule,
    LedgerModule,
    StateMachineModule,
    BridgeModule,
    RecipientsModule,
    OnRampModule,
    MeshModule,
    AdminModule,
    PathCModule,
    DevToolsModule,
    ObservabilityModule,
    MemberAuthModule,
    RefundsModule,
    ApiModule,
    ...(existsSync(join(__dirname, '..', '..', 'dist', 'client', 'index.html'))
      ? [ServeStaticModule.forRoot({
          rootPath: join(__dirname, '..', '..', 'dist', 'client'),
          // NOTE: do NOT exclude /admin/{*splat} here. Admin API routes are matched
          // by Nest controllers first; any remaining /admin/* GET falls through to
          // the SPA so React Router can render /admin/login, /admin/members, etc.
          exclude: ['/api/{*splat}', '/webhooks/{*splat}', '/metrics'],
          serveStaticOptions: { fallthrough: true },
        })]
      : []),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorrelationMiddleware, HttpLoggingMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
