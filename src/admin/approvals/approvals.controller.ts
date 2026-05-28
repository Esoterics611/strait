import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthedReq, AdminRoleGuard, RequireRole } from '../auth/role.guard';
import { DualApprovalService } from './dual-approval.service';

interface ResolveBody { note?: string }

@Controller('admin/approvals')
@UseGuards(AdminRoleGuard)
export class ApprovalsController {
  constructor(private readonly approvals: DualApprovalService) {}

  @Get('pending')
  @RequireRole('viewer')
  async pending(@Req() req: AdminAuthedReq) {
    return this.approvals.listPending(req.adminUser.role);
  }

  @Get('history')
  @RequireRole('viewer')
  async history() {
    return this.approvals.listHistory(200);
  }

  @Post(':id/approve')
  @RequireRole('viewer')
  async approve(
    @Param('id') id: string,
    @Req() req: AdminAuthedReq,
    @Body() body: ResolveBody,
  ) {
    return this.approvals.approve(id, req.adminUser.sub, req.adminUser.role, body.note);
  }

  @Post(':id/reject')
  @RequireRole('viewer')
  async reject(
    @Param('id') id: string,
    @Req() req: AdminAuthedReq,
    @Body() body: ResolveBody,
  ) {
    if (!body.note || body.note.length < 5) {
      throw new Error('Rejection note is required (min 5 chars)');
    }
    await this.approvals.reject(id, req.adminUser.sub, req.adminUser.role, body.note);
    return { ok: true };
  }

  @Post(':id/cancel')
  @RequireRole('viewer')
  async cancel(@Param('id') id: string, @Req() req: AdminAuthedReq) {
    await this.approvals.cancel(id, req.adminUser.sub);
    return { ok: true };
  }
}
