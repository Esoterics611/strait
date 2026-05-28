import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from './jwt.service';

class FakeSecrets {
  private vals: Record<string, string> = { ADMIN_JWT_SECRET: 'test-jwt-secret-deadbeef' };
  async get(k: string): Promise<string> {
    const v = this.vals[k];
    if (v === undefined) throw new Error(`missing ${k}`);
    return v;
  }
  async set(k: string, v: string): Promise<void> { this.vals[k] = v; }
}

describe('JwtService', () => {
  const secrets = new FakeSecrets();
  const svc = new JwtService(secrets as unknown as never);

  it('round-trips an access token with role', async () => {
    const tok = await svc.mintAccess('u1', 'op@example.com', 'compliance');
    const claim = await svc.verify(tok);
    expect(claim.type).toBe('access');
    expect(claim.sub).toBe('u1');
    if (claim.type === 'access') {
      expect(claim.role).toBe('compliance');
      expect(claim.email).toBe('op@example.com');
    }
  });

  it('rejects a tampered token', async () => {
    const tok = await svc.mintAccess('u1', 'a@b.com', 'ops');
    const tampered = tok.slice(0, -2) + 'AA';
    await expect(svc.verify(tampered)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed with a different secret', async () => {
    const tok = await svc.mintAccess('u1', 'a@b.com', 'ops');
    await secrets.set('ADMIN_JWT_SECRET', 'different');
    await expect(svc.verify(tok)).rejects.toBeInstanceOf(UnauthorizedException);
    await secrets.set('ADMIN_JWT_SECRET', 'test-jwt-secret-deadbeef');
  });

  it('mints distinct refresh tokens', async () => {
    const r1 = await svc.mintRefresh('u1');
    const r2 = await svc.mintRefresh('u1');
    expect(r1).not.toEqual(r2);
    const claim = await svc.verify(r1);
    expect(claim.type).toBe('refresh');
  });

  it('mints an mfa challenge', async () => {
    const tok = await svc.mintChallenge('u1', 'x@y.com');
    const claim = await svc.verify(tok);
    expect(claim.type).toBe('mfa_challenge');
  });
});
