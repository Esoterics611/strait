import { MemberAuthGuard } from './member-auth.guard';
import { MemberJwtService, MemberAccessClaim } from './member-jwt.service';
import { MemberSessionsRepository } from './member-sessions.repository';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

function ctxWith(authHeader: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: authHeader } }),
    }),
  } as unknown as ExecutionContext;
}

function ctxWithReq(req: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const CLAIM: MemberAccessClaim = {
  sub: 'm-1',
  email: 'u@e.com',
  aud: 'member',
  type: 'access',
  exp: Math.floor(Date.now() / 1000) + 60,
  iat: Math.floor(Date.now() / 1000),
  jti: 'jti-1',
};

describe('MemberAuthGuard', () => {
  it('rejects missing Authorization header', async () => {
    const g = new MemberAuthGuard(
      {} as unknown as MemberJwtService,
      {} as unknown as MemberSessionsRepository,
    );
    await expect(g.canActivate(ctxWith(undefined))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects malformed bearer prefix', async () => {
    const g = new MemberAuthGuard(
      {} as unknown as MemberJwtService,
      {} as unknown as MemberSessionsRepository,
    );
    await expect(g.canActivate(ctxWith('Basic abcdef'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects invalid JWT', async () => {
    const jwt = { verify: jest.fn().mockRejectedValue(new Error('bad sig')) } as unknown as MemberJwtService;
    const sessions = {} as unknown as MemberSessionsRepository;
    const g = new MemberAuthGuard(jwt, sessions);
    await expect(g.canActivate(ctxWith('Bearer x.y.z'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when session is revoked / not found', async () => {
    const jwt = { verify: jest.fn().mockResolvedValue(CLAIM) } as unknown as MemberJwtService;
    const sessions = { findActive: jest.fn().mockResolvedValue(null) } as unknown as MemberSessionsRepository;
    const g = new MemberAuthGuard(jwt, sessions);
    await expect(g.canActivate(ctxWith('Bearer x.y.z'))).rejects.toThrow(/Session revoked/);
  });

  it('rejects when session.member_id disagrees with claim.sub', async () => {
    const jwt = { verify: jest.fn().mockResolvedValue(CLAIM) } as unknown as MemberJwtService;
    const sessions = {
      findActive: jest.fn().mockResolvedValue({
        session_id: 's', member_id: 'someone-else', jti: 'jti-1',
        issued_at: new Date(), expires_at: new Date(Date.now() + 60_000),
        revoked_at: null, user_agent: null, ip: null,
      }),
    } as unknown as MemberSessionsRepository;
    const g = new MemberAuthGuard(jwt, sessions);
    await expect(g.canActivate(ctxWith('Bearer x.y.z'))).rejects.toThrow(/Session\/claim mismatch/);
  });

  it('happy path attaches req.member', async () => {
    const jwt = { verify: jest.fn().mockResolvedValue(CLAIM) } as unknown as MemberJwtService;
    const sessions = {
      findActive: jest.fn().mockResolvedValue({
        session_id: 's', member_id: 'm-1', jti: 'jti-1',
        issued_at: new Date(), expires_at: new Date(Date.now() + 60_000),
        revoked_at: null, user_agent: null, ip: null,
      }),
    } as unknown as MemberSessionsRepository;
    const g = new MemberAuthGuard(jwt, sessions);
    const req: { headers: { authorization?: string }; member?: unknown } = {
      headers: { authorization: 'Bearer good.token.here' },
    };
    const ok = await g.canActivate(ctxWithReq(req));
    expect(ok).toBe(true);
    expect(req.member).toEqual({ memberId: 'm-1', email: 'u@e.com', jti: 'jti-1' });
  });
});
