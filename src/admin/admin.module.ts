import { Global, Module, forwardRef } from '@nestjs/common';
import { SecretsModule } from '../secrets/secrets.module';
import { LedgerModule } from '../ledger/ledger.module';
import { StateMachineModule } from '../state-machine/state-machine.module';
import { BridgeModule } from '../bridge/bridge.module';
import { PathCModule } from '../path-c/path-c.module';

// Session 7 legacy (kept for emergency synchronous dual-claim ceremony).
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminClaimsRepository } from './admin-claims.repository';

// Auth
import { AdminUsersRepository } from './auth/admin-users.repository';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { JwtService } from './auth/jwt.service';
import { PasswordService } from './auth/password.service';
import { TotpService } from './auth/totp.service';
import { AdminRoleGuard } from './auth/role.guard';

// Audit
import { AuditController } from './audit/audit.controller';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditLogRepository } from './audit/audit-log.repository';

// Approvals
import { ApprovalsController } from './approvals/approvals.controller';
import { ApprovalExpiryCron } from './approvals/approval-expiry.cron';
import { DualApprovalService } from './approvals/dual-approval.service';
import { PendingApprovalRepository } from './approvals/pending-approval.repository';

// Domain admins
import { MembersAdminController } from './members/members-admin.controller';
import { MembersAdminService } from './members/members-admin.service';
import { MemberFreezeChecker } from './members/member-freeze.guard';
import { TransactionsAdminController } from './transactions/transactions-admin.controller';
import { TransactionsAdminService } from './transactions/transactions-admin.service';
import { RefundJobsRepository } from './transactions/refund-jobs.repository';
import { WebhooksAdminController } from './webhooks/webhooks-admin.controller';
import { WebhooksAdminService } from './webhooks/webhooks-admin.service';
import { ReservePoolAdminController } from './reserve-pool/reserve-pool-admin.controller';
import { ReportsController } from './reports/reports.controller';
import { ComplianceController } from './compliance/compliance.controller';
import { AdminUsersController } from './users/admin-users.controller';
import { SettingsController } from './settings/settings.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { DomainEventsLogger } from './events/domain-events.logger';

// Ops (Session 9 polish — cron logger + provider health, registry + run-now endpoint)
import { CronRunLogger } from './ops/cron-run.logger';
import { ProviderHealthService } from './ops/provider-health.service';
import { CronRegistry } from './ops/cron.registry';

@Global()
@Module({
  imports: [
    SecretsModule,
    LedgerModule,
    StateMachineModule,
    forwardRef(() => BridgeModule),
    forwardRef(() => PathCModule),
  ],
  controllers: [
    AuthController,
    AuditController,
    ApprovalsController,
    MembersAdminController,
    TransactionsAdminController,
    WebhooksAdminController,
    ReservePoolAdminController,
    ReportsController,
    ComplianceController,
    AdminUsersController,
    SettingsController,
    DashboardController,
  ],
  providers: [
    // Session 7 legacy (synchronous dual-claim for on-chain custodian credit).
    AdminAuthGuard,
    AdminClaimsRepository,
    // Auth
    AdminUsersRepository,
    AuthService,
    JwtService,
    PasswordService,
    TotpService,
    AdminRoleGuard,
    // Audit
    AuditLogRepository,
    AuditInterceptor,
    // Approvals
    PendingApprovalRepository,
    DualApprovalService,
    ApprovalExpiryCron,
    // Domains
    MembersAdminService,
    MemberFreezeChecker,
    TransactionsAdminService,
    RefundJobsRepository,
    WebhooksAdminService,
    DomainEventsLogger,
    CronRunLogger,
    ProviderHealthService,
    CronRegistry,
  ],
  exports: [
    AdminAuthGuard,
    AdminClaimsRepository,
    AdminRoleGuard,
    AuditLogRepository,
    DualApprovalService,
    MemberFreezeChecker,
    CronRunLogger,
    ProviderHealthService,
    CronRegistry,
  ],
})
export class AdminModule {}
