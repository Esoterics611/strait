import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AdminRoleGuard, RequireRole } from '../auth/role.guard';
import { AuditLogRepository } from './audit-log.repository';

@Controller('admin/audit-log')
@UseGuards(AdminRoleGuard)
export class AuditController {
  constructor(private readonly audit: AuditLogRepository) {}

  @Get()
  @RequireRole('compliance', 'admin')
  async list(
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('action') action?: string,
    @Query('operatorId') operatorId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.audit.list({
      targetType,
      targetId,
      action,
      operatorId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: limit ? parseInt(limit, 10) : 200,
    });
  }

  @Get('export')
  @RequireRole('compliance', 'admin')
  async exportCsv(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const rows = await this.audit.list({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: 1000,
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="admin-audit-log.csv"`);
    res.write('entry_id,operator_id,action,target_type,target_id,occurred_at,metadata\n');
    for (const r of rows) {
      const meta = r.metadata ? JSON.stringify(r.metadata).replace(/"/g, '""') : '';
      res.write(
        `${r.entry_id},${r.operator_id ?? ''},${r.action},${r.target_type},${r.target_id ?? ''},${r.occurred_at.toISOString()},"${meta}"\n`,
      );
    }
    res.end();
  }
}
