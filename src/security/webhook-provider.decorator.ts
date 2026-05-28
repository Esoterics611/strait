import { SetMetadata } from '@nestjs/common';

export const WEBHOOK_PROVIDER_KEY = 'webhook_provider';
export const WebhookProvider = (provider: string) =>
  SetMetadata(WEBHOOK_PROVIDER_KEY, provider);
