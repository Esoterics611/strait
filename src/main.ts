import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // Env vars are read only by the two sanctioned boundaries (the
  // ISecretProvider impl and the ConfigModule factory); bootstrap pulls the
  // port from the typed config, not raw env (CLAUDE.md §12 / ARCH-1 Phase 2).
  const port = app.get(ConfigService).get<number>('app.port', 3000);
  await app.listen(port);
}

bootstrap();
