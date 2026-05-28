import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AdminAuthedReq, AdminRoleGuard, RequireRole } from '../auth/role.guard';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { ISecretProvider, SECRET_PROVIDER } from '../../secrets/secret-provider.interface';
import { DualApprovalService } from '../approvals/dual-approval.service';
import { CronRegistry } from '../ops/cron.registry';

const FLAG_FLIP_ACTION = 'settings.flag_flip';

const TOGGLEABLE_FLAGS = [
  'PATH_C_ENABLED',
  'MOCK_BRIDGE_ENABLED',
  'MOCK_MESH_ENABLED',
  'ONRAMP_PROVIDER',
  'DEV_TOOLS_ENABLED',
] as const;

interface FlagFlipBody { value: string }

@Controller('admin/settings')
@UseGuards(AdminRoleGuard)
@UseInterceptors(AuditInterceptor)
export class SettingsController {
  constructor(
    @Inject(SECRET_PROVIDER) private readonly secrets: ISecretProvider,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly approvals: DualApprovalService,
    private readonly audit: AuditLogRepository,
    private readonly crons: CronRegistry,
  ) {
    this.approvals.register(FLAG_FLIP_ACTION, async (payload, approverId) => {
      const name = payload['name'] as string;
      const value = payload['value'] as string;
      await this.secrets.set(name, value);
      await this.audit.write({
        operatorId: approverId,
        action: 'settings.flag_flipped',
        targetType: 'flag',
        targetId: name,
        metadata: { value, restartRequired: true },
      });
      return { name, value, restartRequired: true };
    });
  }

  @Get('flags')
  @RequireRole('viewer')
  async flags() {
    const out: Record<string, string | null> = {};
    for (const name of TOGGLEABLE_FLAGS) {
      try {
        out[name] = await this.secrets.get(name);
      } catch {
        out[name] = null;
      }
    }
    return out;
  }

  @Get('providers')
  @RequireRole('viewer')
  async providers() {
    const rows = await this.dataSource.query(
      `SELECT provider, last_success_at, last_error_at, last_error_message, last_latency_ms
         FROM provider_health`,
    );
    // Also tell the operator whether keys are configured (set/not set, never the value).
    const keysStatus: Record<string, 'set' | 'missing'> = {};
    for (const k of ['BRIDGE_API_KEY', 'RAPYD_ACCESS_KEY', 'MESH_OAUTH_CLIENT_ID']) {
      try {
        const v = await this.secrets.get(k);
        keysStatus[k] = v ? 'set' : 'missing';
      } catch {
        keysStatus[k] = 'missing';
      }
    }
    return { health: rows, keysStatus };
  }

  @Get('crons')
  @RequireRole('viewer')
  async cronsList() {
    // Merge the runtime registry (name + schedule + description) with last-fired data.
    const runs: Array<{ cron_name: string; last_fired_at: Date | null; last_status: string | null; last_error: string | null }> =
      await this.dataSource.query(
        `SELECT cron_name, last_fired_at, last_status, last_error FROM cron_runs`,
      );
    const runMap = new Map(runs.map((r) => [r.cron_name, r]));
    return this.crons.list().map((c) => {
      const run = runMap.get(c.name);
      return {
        name: c.name,
        description: c.description,
        schedule: c.schedule,
        lastFiredAt: run?.last_fired_at ?? null,
        lastStatus: run?.last_status ?? null,
        lastError: run?.last_error ?? null,
      };
    });
  }

  @Post('crons/:name/run-now')
  @RequireRole('ops')
  async runCronNow(@Param('name') name: string, @Req() req: AdminAuthedReq) {
    if (!this.crons.has(name)) {
      throw new Error(`Cron ${name} not found in registry`);
    }
    const start = Date.now();
    await this.crons.runNow(name);
    const elapsedMs = Date.now() - start;
    await this.audit.write({
      operatorId: req.adminUser.sub,
      action: 'cron.run_now',
      targetType: 'cron',
      targetId: name,
      metadata: { elapsedMs },
    });
    return { ok: true, elapsedMs };
  }

  @Post('flags/:name')
  @RequireRole('admin')
  async flipFlag(
    @Param('name') name: string,
    @Body() body: FlagFlipBody,
    @Req() req: AdminAuthedReq,
  ) {
    if (!(TOGGLEABLE_FLAGS as readonly string[]).includes(name)) {
      throw new Error(`Flag ${name} is not toggleable from admin UI`);
    }
    // PATH_C_ENABLED must always go through dual approval.
    const requiredRole = name === 'PATH_C_ENABLED' ? 'compliance' : 'admin';
    const approval = await this.approvals.request({
      action: FLAG_FLIP_ACTION,
      requiredRole,
      initiatedBy: req.adminUser.sub,
      initiatorRole: req.adminUser.role,
      targetType: 'flag',
      targetId: name,
      payload: { name, value: body.value, initiatorId: req.adminUser.sub },
    });
    return { status: 'PENDING_APPROVAL', approvalId: approval.approval_id };
  }
}
