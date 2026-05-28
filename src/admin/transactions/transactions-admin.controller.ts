import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminAuthedReq, AdminRoleGuard, RequireRole } from '../auth/role.guard';
import { TransactionsAdminService } from './transactions-admin.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { TxState } from '@common/enums';

interface ForceTransitionBody { toState: TxState; reason: string }

@Controller('admin/transactions')
@UseGuards(AdminRoleGuard)
@UseInterceptors(AuditInterceptor)
export class TransactionsAdminController {
  constructor(
    private readonly txs: TransactionsAdminService,
    private readonly audit: AuditLogRepository,
  ) {}

  @Get()
  @RequireRole('viewer')
  async list(
    @Query('state') state?: string,
    @Query('sourceType') sourceType?: string,
    @Query('memberId') memberId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.txs.list({
      state,
      sourceType,
      memberId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Get(':txId')
  @RequireRole('viewer')
  async detail(@Param('txId') txId: string) {
    return this.txs.detail(txId);
  }

  @Get(':txId/timeline')
  @RequireRole('viewer')
  async timeline(@Param('txId') txId: string) {
    return this.txs.timeline(txId);
  }

  @Get(':txId/audit-log')
  @RequireRole('compliance', 'admin')
  async auditLog(@Param('txId') txId: string) {
    return this.audit.list({ targetType: 'tx', targetId: txId, limit: 200 });
  }

  @Post(':txId/cancel')
  @RequireRole('ops')
  async cancel(@Param('txId') txId: string, @Req() req: AdminAuthedReq) {
    return this.txs.cancel(txId, req.adminUser.sub);
  }

  @Post(':txId/refund')
  @RequireRole('ops')
  async refund(@Param('txId') txId: string, @Req() req: AdminAuthedReq) {
    return this.txs.requestRefund(txId, req.adminUser.sub, req.adminUser.role);
  }

  @Post(':txId/state-transition')
  @RequireRole('compliance')
  async forceTransition(
    @Param('txId') txId: string,
    @Body() body: ForceTransitionBody,
    @Req() req: AdminAuthedReq,
  ) {
    return this.txs.requestForceTransition(
      txId,
      body.toState,
      body.reason,
      req.adminUser.sub,
      req.adminUser.role,
    );
  }

  @Post(':txId/refresh-provider')
  @RequireRole('ops')
  async refresh(@Param('txId') txId: string, @Req() req: AdminAuthedReq) {
    return this.txs.refreshProvider(txId, req.adminUser.sub);
  }
}
