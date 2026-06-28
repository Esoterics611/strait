import { Module } from '@nestjs/common';
import { SecretsModule } from '../secrets/secrets.module';
import { WebhookVerifier } from './webhook-verifier.service';
import { WebhookSignatureGuard } from './webhook-signature.guard';

@Module({
  imports: [SecretsModule],
  providers: [WebhookVerifier, WebhookSignatureGuard],
  exports: [WebhookVerifier, WebhookSignatureGuard],
})
export class SecurityModule {}
