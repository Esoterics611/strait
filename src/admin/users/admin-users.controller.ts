import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminAuthedReq, AdminRoleGuard, RequireRole } from '../auth/role.guard';
import { AdminUsersRepository } from '../auth/admin-users.repository';
import { PasswordService } from '../auth/password.service';
import { AdminRole } from '../auth/jwt.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { randomBytes } from 'crypto';

interface InviteBody { email: string; role: AdminRole; password?: string }
interface PatchBody { role?: AdminRole; isActive?: boolean }

@Controller('admin/users')
@UseGuards(AdminRoleGuard)
@UseInterceptors(AuditInterceptor)
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersRepository,
    private readonly passwords: PasswordService,
    private readonly audit: AuditLogRepository,
  ) {}

  @Get()
  @RequireRole('admin')
  async list() {
    const rows = await this.users.list();
    return rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      role: r.role,
      isActive: r.is_active,
      mfaEnrolled: r.mfa_enrolled,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
    }));
  }

  @Post()
  @RequireRole('admin')
  async invite(@Body() body: InviteBody, @Req() req: AdminAuthedReq) {
    if (!body.email || !body.role) throw new Error('email and role required');
    // Generate a temporary password if none supplied; operator passes it to invitee out-of-band.
    const temp = body.password ?? randomBytes(12).toString('base64url');
    const hash = await this.passwords.hash(temp);
    const row = await this.users.insert(body.email, hash, body.role);
    await this.audit.write({
      operatorId: req.adminUser.sub,
      action: 'admin.user.invite',
      targetType: 'admin_user',
      targetId: row.user_id,
      metadata: { email: body.email, role: body.role },
    });
    return {
      userId: row.user_id,
      email: row.email,
      role: row.role,
      tempPassword: temp,
      note: 'Share tempPassword via secure channel; user must enroll MFA on first login.',
    };
  }

  @Patch(':id')
  @RequireRole('admin')
  async patch(@Param('id') id: string, @Body() body: PatchBody, @Req() req: AdminAuthedReq) {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundException('User not found');
    if (body.role) await this.users.updateRole(id, body.role);
    if (typeof body.isActive === 'boolean') await this.users.setActive(id, body.isActive);
    await this.audit.write({
      operatorId: req.adminUser.sub,
      action: 'admin.user.update',
      targetType: 'admin_user',
      targetId: id,
      metadata: { role: body.role, isActive: body.isActive },
    });
    return { ok: true };
  }

  @Post(':id/reset-mfa')
  @RequireRole('admin')
  async resetMfa(@Param('id') id: string, @Req() req: AdminAuthedReq) {
    await this.users.resetMfa(id);
    await this.audit.write({
      operatorId: req.adminUser.sub,
      action: 'admin.user.reset_mfa',
      targetType: 'admin_user',
      targetId: id,
    });
    return { ok: true };
  }

  @Delete(':id')
  @RequireRole('admin')
  async deactivate(@Param('id') id: string, @Req() req: AdminAuthedReq) {
    if (id === req.adminUser.sub) {
      throw new Error('Cannot deactivate yourself');
    }
    await this.users.setActive(id, false);
    await this.audit.write({
      operatorId: req.adminUser.sub,
      action: 'admin.user.deactivate',
      targetType: 'admin_user',
      targetId: id,
    });
    return { ok: true };
  }
}
