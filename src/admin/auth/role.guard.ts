import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AdminRole, AdminAccessTokenClaim, JwtService } from './jwt.service';
import { AdminUsersRepository } from './admin-users.repository';

export interface AdminAuthedReq extends Request {
  adminUser: AdminAccessTokenClaim;
}

export const REQUIRE_ROLE_KEY = 'lirabridge:requireRole';
export const RequireRole = (...roles: AdminRole[]) => SetMetadata(REQUIRE_ROLE_KEY, roles);

const ROLE_LEVEL: Record<AdminRole, number> = {
  viewer: 0,
  support: 10,
  ops: 20,
  finance: 30,
  compliance: 40,
  admin: 100,
};

/**
 * AdminRoleGuard reads `Authorization: Bearer <jwt>`, validates it as an admin
 * access token, looks up the live role from `admin_users` (revocation-safe),
 * and rejects with 403 if the role does not satisfy any `@RequireRole(...)`
 * decorator on the route. Returns 403 (not 404) on role mismatch.
 */
@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly users: AdminUsersRepository,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AdminAuthedReq>();
    const header = req.headers['authorization'];
    if (!header || Array.isArray(header) || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    const claim = await this.jwt.verify(token);
    if (claim.type !== 'access') {
      throw new UnauthorizedException('Wrong token type');
    }
    const live = await this.users.findById(claim.sub);
    if (!live || !live.is_active) {
      throw new UnauthorizedException('Account inactive');
    }
    if (live.role !== claim.role) {
      throw new UnauthorizedException('Role changed; re-login required');
    }
    req.adminUser = { ...claim, role: live.role };

    const required = this.reflector.getAllAndOverride<AdminRole[]>(REQUIRE_ROLE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required && required.length > 0) {
      const have = ROLE_LEVEL[live.role];
      const need = Math.min(...required.map((r) => ROLE_LEVEL[r]));
      if (have < need) {
        throw new ForbiddenException(`Requires role: ${required.join(' or ')}`);
      }
    }
    return true;
  }
}

export function roleAtLeast(have: AdminRole, need: AdminRole): boolean {
  return ROLE_LEVEL[have] >= ROLE_LEVEL[need];
}
