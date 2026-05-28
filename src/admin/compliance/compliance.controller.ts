import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ISecretProvider, SECRET_PROVIDER } from '../../secrets/secret-provider.interface';
import { AdminAuthedReq, AdminRoleGuard, RequireRole } from '../auth/role.guard';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { DualApprovalService } from '../approvals/dual-approval.service';

const BLOCKLIST_UPDATE_ACTION = 'compliance.blocklist_update';
const OFAC_OVERRIDE_ACTION = 'compliance.ofac_override';

interface OfacOverrideBody { memberId: string; reason: string }
interface BlocklistBody    { csv: string }

@Controller('admin/compliance')
@UseGuards(AdminRoleGuard)
@UseInterceptors(AuditInterceptor)
export class ComplianceController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(SECRET_PROVIDER) private readonly secrets: ISecretProvider,
    private readonly approvals: DualApprovalService,
    private readonly audit: AuditLogRepository,
  ) {
    this.approvals.register(BLOCKLIST_UPDATE_ACTION, async (payload, approverId) => {
      const csv = payload['csv'] as string;
      await this.secrets.set('OFAC_BLOCKLIST_CSV', csv);
      return { entries: csv.split(',').filter(Boolean).length, approverId };
    });
    this.approvals.register(OFAC_OVERRIDE_ACTION, async (payload, approverId) => {
      const memberId = payload['memberId'] as string;
      await this.dataSource.query(
        `UPDATE member_accounts SET ofac_status = 'OVERRIDE', updated_at = NOW()
           WHERE member_id = $1`,
        [memberId],
      );
      await this.audit.write({
        operatorId: approverId,
        action: 'compliance.ofac_override.applied',
        targetType: 'member',
        targetId: memberId,
        metadata: { reason: payload['reason'] },
      });
      return { memberId, status: 'OVERRIDE' };
    });
  }

  @Get('kyc-queue')
  @RequireRole('compliance', 'admin')
  async kycQueue() {
    return this.dataSource.query(
      `SELECT member_id, email, created_at FROM member_accounts
        WHERE kyc_status = 'PENDING' ORDER BY created_at ASC LIMIT 200`,
    );
  }

  @Get('ofac-review-queue')
  @RequireRole('compliance', 'admin')
  async ofacQueue() {
    // Read from admin_audit_log entries categorised as ofac_block.
    return this.dataSource.query(
      `SELECT entry_id, metadata, occurred_at FROM admin_audit_log
        WHERE action LIKE 'ofac%' OR (metadata->>'category') = 'ofac_block'
        ORDER BY occurred_at DESC LIMIT 200`,
    );
  }

  @Post('ofac-override')
  @RequireRole('compliance')
  async requestOverride(@Body() body: OfacOverrideBody, @Req() req: AdminAuthedReq) {
    if (!body.reason || body.reason.length < 20) {
      throw new Error('OFAC override requires a reason of at least 20 chars');
    }
    const approval = await this.approvals.request({
      action: OFAC_OVERRIDE_ACTION,
      requiredRole: 'compliance',
      initiatedBy: req.adminUser.sub,
      initiatorRole: req.adminUser.role,
      targetType: 'member',
      targetId: body.memberId,
      payload: { memberId: body.memberId, reason: body.reason, initiatorId: req.adminUser.sub },
    });
    return { status: 'PENDING_APPROVAL', approvalId: approval.approval_id };
  }

  @Get('blocklist')
  @RequireRole('compliance', 'admin')
  async blocklist() {
    let csv = '';
    try { csv = await this.secrets.get('OFAC_BLOCKLIST_CSV'); } catch { csv = ''; }
    const entries = csv.split(',').filter(Boolean);
    return {
      entries: entries.map((addr) => ({
        addressHash: createHash('sha256').update(addr.toLowerCase()).digest('hex').slice(0, 16),
      })),
      count: entries.length,
    };
  }

  @Patch('blocklist')
  @RequireRole('admin')
  async updateBlocklist(@Body() body: BlocklistBody, @Req() req: AdminAuthedReq) {
    const approval = await this.approvals.request({
      action: BLOCKLIST_UPDATE_ACTION,
      requiredRole: 'compliance',
      initiatedBy: req.adminUser.sub,
      initiatorRole: req.adminUser.role,
      targetType: 'flag',
      targetId: 'OFAC_BLOCKLIST_CSV',
      payload: { csv: body.csv, initiatorId: req.adminUser.sub },
    });
    return { status: 'PENDING_APPROVAL', approvalId: approval.approval_id };
  }

  @Get('audit-export')
  @RequireRole('compliance', 'admin')
  async auditExport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.audit.list({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: 1000,
    });
  }
}
