import { Module } from '@nestjs/common';
import { SecretsModule } from '../secrets/secrets.module';
import { WebhookVerifier } from './webhook-verifier.service';
import { RapydWebhookVerifier } from './rapyd-webhook-verifier.service';
import { WebhookSignatureGuard } from './webhook-signature.guard';

@Module({
  imports: [SecretsModule],
  providers: [WebhookVerifier, RapydWebhookVerifier, WebhookSignatureGuard],
  exports: [WebhookVerifier, RapydWebhookVerifier, WebhookSignatureGuard],
})
export class SecurityModule {}
