import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminAuthedReq, AdminRoleGuard, RequireRole } from '../auth/role.guard';
import { MembersAdminService } from './members-admin.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditLogRepository } from '../audit/audit-log.repository';

interface KycBody { status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED' }
interface FreezeBody { reason: string }
interface ManualCreditBody { amountUnits: string; reason: string }

@Controller('admin/members')
@UseGuards(AdminRoleGuard)
@UseInterceptors(AuditInterceptor)
export class MembersAdminController {
  constructor(
    private readonly members: MembersAdminService,
    private readonly audit: AuditLogRepository,
  ) {}

  @Get()
  @RequireRole('viewer')
  async list(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('kyc') kyc?: string,
    @Query('path') path?: string,
  ) {
    return this.members.list(
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
      { kyc, path },
    );
  }

  @Get(':id')
  @RequireRole('viewer')
  async detail(@Param('id') id: string) {
    return this.members.detail(id);
  }

  @Get(':id/ledger')
  @RequireRole('viewer')
  async ledger(@Param('id') id: string) {
    return this.members.ledgerRows(id);
  }

  @Get(':id/transactions')
  @RequireRole('viewer')
  async transactions(@Param('id') id: string) {
    return this.members.transactions(id);
  }

  @Get(':id/audit-log')
  @RequireRole('compliance', 'admin')
  async auditLog(@Param('id') id: string) {
    return this.audit.list({ targetType: 'member', targetId: id, limit: 200 });
  }

  @Patch(':id/kyc-status')
  @RequireRole('compliance')
  async setKyc(@Param('id') id: string, @Body() body: KycBody, @Req() req: AdminAuthedReq) {
    return this.members.setKyc(id, body.status, req.adminUser.sub);
  }

  @Post(':id/freeze')
  @RequireRole('compliance')
  async freeze(@Param('id') id: string, @Body() body: FreezeBody, @Req() req: AdminAuthedReq) {
    if (!body.reason || body.reason.length < 5) {
      throw new HttpException('Freeze reason is required (min 5 chars)', 400);
    }
    return this.members.freeze(id, body.reason, req.adminUser.sub);
  }

  @Post(':id/unfreeze')
  @RequireRole('compliance')
  async unfreeze(@Param('id') id: string, @Req() req: AdminAuthedReq) {
    return this.members.unfreeze(id, req.adminUser.sub);
  }

  @Post(':id/manual-credit')
  @RequireRole('ops')
  async manualCredit(
    @Param('id') id: string,
    @Body() body: ManualCreditBody,
    @Req() req: AdminAuthedReq,
  ) {
    return this.members.requestManualCredit(
      id,
      BigInt(body.amountUnits),
      body.reason,
      req.adminUser.sub,
      req.adminUser.role,
    );
  }
}
