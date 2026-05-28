import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { ISecretProvider, SECRET_PROVIDER } from '../../secrets/secret-provider.interface';

export interface MemberAccessClaim {
  /** member_accounts.member_id */
  sub: string;
  email: string;
  /** Always 'member' — keeps the admin guard from accepting a member token. */
  aud: 'member';
  type: 'access';
  exp: number;
  iat: number;
  jti: string;
}

const ACCESS_TTL_SECONDS = 60 * 60 * 8; // 8h — single-session app, refresh via magic link.

/**
 * Distinct from `admin/auth/jwt.service.ts` on purpose:
 *   - Different audience (`aud: 'member'`) so an admin token cannot be replayed
 *     at a member endpoint and vice versa.
 *   - Different secret env var (`MEMBER_JWT_SECRET`) so blast radius is
 *     contained on a leak.
 *   - No refresh token (the member re-auths via magic link, 8h TTL is the
 *     PoC's tradeoff between convenience and security).
 */
@Injectable()
export class MemberJwtService {
  constructor(@Inject(SECRET_PROVIDER) private readonly secrets: ISecretProvider) {}

  async mint(memberId: string, email: string): Promise<{ token: string; claim: MemberAccessClaim }> {
    const now = Math.floor(Date.now() / 1000);
    const claim: MemberAccessClaim = {
      sub: memberId,
      email,
      aud: 'member',
      type: 'access',
      exp: now + ACCESS_TTL_SECONDS,
      iat: now,
      jti: randomUUID(),
    };
    const token = await this.sign(claim);
    return { token, claim };
  }

  async verify(token: string): Promise<MemberAccessClaim> {
    const secret = await this.secrets.get('MEMBER_JWT_SECRET');
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Malformed member JWT');
    const [encHeader, encPayload, encSig] = parts;

    const header = JSON.parse(b64UrlDecode(encHeader).toString('utf8')) as { alg?: string };
    if (header.alg !== 'HS256') throw new UnauthorizedException('Unsupported alg');

    const expected = createHmac('sha256', secret).update(`${encHeader}.${encPayload}`).digest();
    const provided = b64UrlDecode(encSig);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      throw new UnauthorizedException('Signature mismatch');
    }

    const claim = JSON.parse(b64UrlDecode(encPayload).toString('utf8')) as Partial<MemberAccessClaim>;
    const now = Math.floor(Date.now() / 1000);
    if (!claim.exp || claim.exp < now) throw new UnauthorizedException('Token expired');
    if (claim.aud !== 'member') throw new UnauthorizedException('Wrong audience');
    if (claim.type !== 'access') throw new UnauthorizedException('Wrong token type');
    if (!claim.sub) throw new UnauthorizedException('Missing subject');
    return claim as MemberAccessClaim;
  }

  private async sign(claim: MemberAccessClaim): Promise<string> {
    const secret = await this.secrets.get('MEMBER_JWT_SECRET');
    const header = b64UrlEncode(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const payload = b64UrlEncode(Buffer.from(JSON.stringify(claim)));
    const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
    return `${header}.${payload}.${b64UrlEncode(sig)}`;
  }
}

function b64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}
