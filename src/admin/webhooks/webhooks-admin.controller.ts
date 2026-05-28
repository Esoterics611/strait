import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminAuthedReq, AdminRoleGuard, RequireRole } from '../auth/role.guard';
import { WebhooksAdminService, WebhookProvider } from './webhooks-admin.service';
import { AuditInterceptor } from '../audit/audit.interceptor';

interface BulkReplayBody { from: string; to: string }

@Controller('admin/webhooks')
@UseGuards(AdminRoleGuard)
@UseInterceptors(AuditInterceptor)
export class WebhooksAdminController {
  constructor(private readonly webhooks: WebhooksAdminService) {}

  @Get('processed')
  @RequireRole('viewer')
  async processed(
    @Query('provider') provider?: WebhookProvider,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.webhooks.listProcessed({
      provider,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Get('failed')
  @RequireRole('ops')
  async failed() {
    return this.webhooks.listFailed();
  }

  @Get('failed/stats')
  @RequireRole('viewer')
  async stats() {
    return this.webhooks.stats();
  }

  @Get('failed/:id')
  @RequireRole('ops')
  async failedDetail(@Param('id') id: string) {
    const row = await this.webhooks.failedDetail(id);
    return {
      ...row,
      raw_body: row.raw_body?.toString('utf8'),
    };
  }

  @Post('processed/:id/replay')
  @RequireRole('ops')
  async replayProcessed(@Param('id') id: string, @Req() req: AdminAuthedReq) {
    return this.webhooks.replayProcessed(id, req.adminUser.sub);
  }

  @Post('failed/:id/replay')
  @RequireRole('ops')
  async replayFailed(@Param('id') id: string, @Req() req: AdminAuthedReq) {
    return this.webhooks.replayFailed(id, req.adminUser.sub);
  }

  @Post('failed/bulk-replay')
  @RequireRole('ops')
  async bulkReplay(@Body() body: BulkReplayBody, @Req() req: AdminAuthedReq) {
    return this.webhooks.bulkReplayFailed(
      new Date(body.from),
      new Date(body.to),
      req.adminUser.sub,
    );
  }

  @Delete('failed/:id')
  @RequireRole('compliance', 'admin')
  async delFailed(@Param('id') id: string, @Req() req: AdminAuthedReq) {
    await this.webhooks.deleteFailed(id, req.adminUser.sub);
    return { ok: true };
  }
}
