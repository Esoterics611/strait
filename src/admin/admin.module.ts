import { Global, Module } from '@nestjs/common';
import { SecretsModule } from '../secrets/secrets.module';
import { LedgerModule } from '../ledger/ledger.module';
import { StateMachineModule } from '../state-machine/state-machine.module';

import { AdminUsersRepository } from './auth/admin-users.repository';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { JwtService } from './auth/jwt.service';
import { PasswordService } from './auth/password.service';
import { TotpService } from './auth/totp.service';
import { AdminRoleGuard } from './auth/role.guard';

import { AuditController } from './audit/audit.controller';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditLogRepository } from './audit/audit-log.repository';

import { ApprovalsController } from './approvals/approvals.controller';
import { ApprovalExpiryCron } from './approvals/approval-expiry.cron';
import { DualApprovalService } from './approvals/dual-approval.service';
import { PendingApprovalRepository } from './approvals/pending-approval.repository';

import { MembersAdminController } from './members/members-admin.controller';
import { MembersAdminService } from './members/members-admin.service';
import { MemberFreezeChecker } from './members/member-freeze.guard';
import { TransactionsAdminController } from './transactions/transactions-admin.controller';
import { TransactionsAdminService } from './transactions/transactions-admin.service';
import { RefundJobsRepository } from './transactions/refund-jobs.repository';
import { WebhooksAdminController } from './webhooks/webhooks-admin.controller';
import { WebhooksAdminService } from './webhooks/webhooks-admin.service';
import { ReportsController } from './reports/reports.controller';
import { ComplianceController } from './compliance/compliance.controller';
import { AdminUsersController } from './users/admin-users.controller';
import { SettingsController } from './settings/settings.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { DomainEventsLogger } from './events/domain-events.logger';

import { CronRunLogger } from './ops/cron-run.logger';
import { ProviderHealthService } from './ops/provider-health.service';
import { CronRegistry } from './ops/cron.registry';

@Global()
@Module({
  imports: [
    SecretsModule,
    LedgerModule,
    StateMachineModule,
  ],
  controllers: [
    AuthController,
    AuditController,
    ApprovalsController,
    MembersAdminController,
    TransactionsAdminController,
    WebhooksAdminController,
    ReportsController,
    ComplianceController,
    AdminUsersController,
    SettingsController,
    DashboardController,
  ],
  providers: [
    AdminUsersRepository,
    AuthService,
    JwtService,
    PasswordService,
    TotpService,
    AdminRoleGuard,
    AuditLogRepository,
    AuditInterceptor,
    PendingApprovalRepository,
    DualApprovalService,
    ApprovalExpiryCron,
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
