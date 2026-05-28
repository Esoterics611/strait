import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SecretsModule } from '../../secrets/secrets.module';
import { MagicLinkService } from './magic-link.service';
import { MemberJwtService } from './member-jwt.service';
import { MemberSessionsRepository } from './member-sessions.repository';
import { MemberAuthGuard } from './member-auth.guard';
import { MemberAuthController } from './member-auth.controller';

/**
 * @Global so any controller (RecipientsController, future TransfersController,
 * etc.) can `@UseGuards(MemberAuthGuard)` without re-importing this module.
 */
@Global()
@Module({
  imports: [DatabaseModule, SecretsModule],
  controllers: [MemberAuthController],
  providers: [
    MagicLinkService,
    MemberJwtService,
    MemberSessionsRepository,
    MemberAuthGuard,
  ],
  exports: [
    MagicLinkService,
    MemberJwtService,
    MemberSessionsRepository,
    MemberAuthGuard,
  ],
})
export class MemberAuthModule {}
