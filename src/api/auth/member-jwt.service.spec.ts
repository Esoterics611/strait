import { MemberJwtService } from './member-jwt.service';
import { ISecretProvider } from '../../secrets/secret-provider.interface';
import { UnauthorizedException } from '@nestjs/common';

class StubSecrets implements ISecretProvider {
  constructor(private value: string) {}
  async get(): Promise<string> {
    return this.value;
  }
  async set(): Promise<void> {
    /* noop */
  }
}

const MEMBER_ID = 'a0000000-0000-0000-0000-000000000001';

describe('MemberJwtService', () => {
  it('round-trips a token with aud=member', async () => {
    const svc = new MemberJwtService(new StubSecrets('s3cret-key-32-bytes-or-more-abcde'));
    const { token, claim } = await svc.mint(MEMBER_ID, 'user@example.com');
    expect(claim.aud).toBe('member');
    expect(claim.sub).toBe(MEMBER_ID);
    expect(token.split('.')).toHaveLength(3);

    const verified = await svc.verify(token);
    expect(verified.sub).toBe(MEMBER_ID);
    expect(verified.email).toBe('user@example.com');
    expect(verified.jti).toBe(claim.jti);
  });

  it('rejects when secret is wrong (signature mismatch)', async () => {
    const a = new MemberJwtService(new StubSecrets('secret-a-32-bytes-aaaaaaaaaaaaaa'));
    const b = new MemberJwtService(new StubSecrets('secret-b-32-bytes-bbbbbbbbbbbbbb'));
    const { token } = await a.mint(MEMBER_ID, 'u@e.com');
    await expect(b.verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a tampered payload', async () => {
    const svc = new MemberJwtService(new StubSecrets('secret-x-32-bytes-xxxxxxxxxxxxxx'));
    const { token } = await svc.mint(MEMBER_ID, 'u@e.com');
    const parts = token.split('.');
    // Flip one byte in the payload (Base64URL-decode, mutate, re-encode would
    // need exactness; instead just append a char which invalidates signature).
    const tampered = `${parts[0]}.${parts[1]}aa.${parts[2]}`;
    await expect(svc.verify(tampered)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects malformed tokens (wrong segment count)', async () => {
    const svc = new MemberJwtService(new StubSecrets('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'));
    await expect(svc.verify('two.parts')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.verify('a.b.c.d')).rejects.toBeInstanceOf(UnauthorizedException);
    // A 3-part garbage token doesn't decode cleanly — any error counts.
    await expect(svc.verify('only.one.dot')).rejects.toThrow();
  });

  it('rejects an admin-shaped token (audience guard)', async () => {
    const svc = new MemberJwtService(new StubSecrets('shared-secret-32-bytes-xxxxxxxxx'));
    // Build a hand-rolled HS256 token with aud:'admin' — should be rejected.
    const { createHmac } = await import('crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const claim = {
      sub: 'admin-1',
      email: 'a@a.com',
      aud: 'admin',
      type: 'access',
      exp: Math.floor(Date.now() / 1000) + 60,
      iat: Math.floor(Date.now() / 1000),
      jti: 'x',
    };
    const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
    const sig = createHmac('sha256', 'shared-secret-32-bytes-xxxxxxxxx')
      .update(`${header}.${payload}`).digest('base64url');
    const tok = `${header}.${payload}.${sig}`;
    await expect(svc.verify(tok)).rejects.toThrow(/Wrong audience/);
  });
});
