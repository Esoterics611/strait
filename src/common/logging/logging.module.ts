import { Global, Module, OnModuleInit } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { GlobalExceptionFilter } from './global-exception.filter';
import { setLogProduction } from './logging-config';

/**
 * Pushes the one bit of config BusinessLogger needs (prod ⇒ omit stack
 * traces) into the process-wide holder at boot — this is the DI-aware
 * boundary, so raw environment variables are never read outside the
 * sanctioned config factory. Also registers the catch-all
 * GlobalExceptionFilter app-wide.
 */
@Global()
@Module({
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class LoggingModule implements OnModuleInit {
  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    setLogProduction(
      this.config.get<string>('app.nodeEnv') === 'production',
    );
  }
}
