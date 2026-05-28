import { ForbiddenException, UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRoleGuard, REQUIRE_ROLE_KEY } from './role.guard';
import { JwtService } from './jwt.service';

class FakeJwt {
  constructor(private claim: Record<string, unknown> | null) {}
  async verify(_token: string): Promise<unknown> {
    if (!this.claim) throw new UnauthorizedException('bad');
    return this.claim;
  }
}
class FakeUsers {
  constructor(public row: { user_id: string; role: string; is_active: boolean } | null) {}
  async findById(_id: string): Promise<unknown> { return this.row; }
}

function makeCtx(headers: Record<string, string>, requiredRoles?: string[]): { ctx: ExecutionContext; reflector: Reflector } {
  const req: { headers: Record<string, string>; adminUser?: unknown } = { headers };
  const reflector = {
    getAllAndOverride: () => requiredRoles,
  } as unknown as Reflector;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

describe('AdminRoleGuard', () => {
  it('rejects missing bearer token', async () => {
    const jwt = new FakeJwt({ type: 'access', sub: 'u1', role: 'ops', admin: true, exp: 9, iat: 0, jti: 'j' });
    const users = new FakeUsers({ user_id: 'u1', role: 'ops', is_active: true });
    const { ctx, reflector } = makeCtx({});
    const guard = new AdminRoleGuard(jwt as unknown as JwtService, users as never, reflector);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects non-access token type', async () => {
    const jwt = new FakeJwt({ type: 'refresh', sub: 'u1' });
    const users = new FakeUsers({ user_id: 'u1', role: 'ops', is_active: true });
    const { ctx, reflector } = makeCtx({ authorization: 'Bearer x.y.z' });
    const guard = new AdminRoleGuard(jwt as unknown as JwtService, users as never, reflector);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when live role differs from claim role', async () => {
    const jwt = new FakeJwt({ type: 'access', sub: 'u1', role: 'admin', admin: true, exp: Math.floor(Date.now() / 1000) + 100, iat: 0, jti: 'j' });
    const users = new FakeUsers({ user_id: 'u1', role: 'ops', is_active: true });
    const { ctx, reflector } = makeCtx({ authorization: 'Bearer x.y.z' });
    const guard = new AdminRoleGuard(jwt as unknown as JwtService, users as never, reflector);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when role too low for @RequireRole', async () => {
    const jwt = new FakeJwt({ type: 'access', sub: 'u1', role: 'ops', admin: true, exp: Math.floor(Date.now() / 1000) + 100, iat: 0, jti: 'j' });
    const users = new FakeUsers({ user_id: 'u1', role: 'ops', is_active: true });
    const { ctx, reflector } = makeCtx({ authorization: 'Bearer x.y.z' }, ['compliance']);
    const guard = new AdminRoleGuard(jwt as unknown as JwtService, users as never, reflector);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows when role meets the requirement', async () => {
    const jwt = new FakeJwt({ type: 'access', sub: 'u1', role: 'compliance', admin: true, exp: Math.floor(Date.now() / 1000) + 100, iat: 0, jti: 'j' });
    const users = new FakeUsers({ user_id: 'u1', role: 'compliance', is_active: true });
    const { ctx, reflector } = makeCtx({ authorization: 'Bearer x.y.z' }, ['compliance']);
    const guard = new AdminRoleGuard(jwt as unknown as JwtService, users as never, reflector);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('admin role outranks all others', async () => {
    const jwt = new FakeJwt({ type: 'access', sub: 'u1', role: 'admin', admin: true, exp: Math.floor(Date.now() / 1000) + 100, iat: 0, jti: 'j' });
    const users = new FakeUsers({ user_id: 'u1', role: 'admin', is_active: true });
    const { ctx, reflector } = makeCtx({ authorization: 'Bearer x.y.z' }, ['compliance']);
    const guard = new AdminRoleGuard(jwt as unknown as JwtService, users as never, reflector);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects inactive users', async () => {
    const jwt = new FakeJwt({ type: 'access', sub: 'u1', role: 'admin', admin: true, exp: Math.floor(Date.now() / 1000) + 100, iat: 0, jti: 'j' });
    const users = new FakeUsers({ user_id: 'u1', role: 'admin', is_active: false });
    const { ctx, reflector } = makeCtx({ authorization: 'Bearer x.y.z' });
    const guard = new AdminRoleGuard(jwt as unknown as JwtService, users as never, reflector);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
