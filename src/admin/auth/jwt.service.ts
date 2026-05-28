import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { ISecretProvider, SECRET_PROVIDER } from '../../secrets/secret-provider.interface';

export type AdminRole = 'viewer' | 'support' | 'ops' | 'finance' | 'compliance' | 'admin';

export interface AdminAccessTokenClaim {
  sub: string;           // admin_users.user_id
  email: string;
  role: AdminRole;
  admin: true;
  type: 'access';
  exp: number;
  iat: number;
  jti: string;
}

export interface AdminRefreshTokenClaim {
  sub: string;
  type: 'refresh';
  admin: true;
  exp: number;
  iat: number;
  jti: string;
}

export interface AdminTempChallengeClaim {
  sub: string;
  email: string;
  type: 'mfa_challenge';
  admin: true;
  exp: number;
  iat: number;
  jti: string;
}

type AdminClaimUnion = AdminAccessTokenClaim | AdminRefreshTokenClaim | AdminTempChallengeClaim;

const ACCESS_TTL_SECONDS = 60 * 60;       // 1 h
const REFRESH_TTL_SECONDS = 60 * 60 * 12; // 12 h
const CHALLENGE_TTL_SECONDS = 5 * 60;     // 5 min

@Injectable()
export class JwtService {
  constructor(@Inject(SECRET_PROVIDER) private readonly secrets: ISecretProvider) {}

  async mintAccess(userId: string, email: string, role: AdminRole): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const claim: AdminAccessTokenClaim = {
      sub: userId,
      email,
      role,
      admin: true,
      type: 'access',
      exp: now + ACCESS_TTL_SECONDS,
      iat: now,
      jti: randomUUID(),
    };
    return this.sign(claim);
  }

  async mintRefresh(userId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const claim: AdminRefreshTokenClaim = {
      sub: userId,
      type: 'refresh',
      admin: true,
      exp: now + REFRESH_TTL_SECONDS,
      iat: now,
      jti: randomUUID(),
    };
    return this.sign(claim);
  }

  async mintChallenge(userId: string, email: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const claim: AdminTempChallengeClaim = {
      sub: userId,
      email,
      type: 'mfa_challenge',
      admin: true,
      exp: now + CHALLENGE_TTL_SECONDS,
      iat: now,
      jti: randomUUID(),
    };
    return this.sign(claim);
  }

  async verify(token: string): Promise<AdminClaimUnion> {
    const secret = await this.secrets.get('ADMIN_JWT_SECRET');
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Malformed JWT');
    const [encHeader, encPayload, encSig] = parts;

    const header = JSON.parse(b64UrlDecode(encHeader).toString('utf8')) as { alg?: string };
    if (header.alg !== 'HS256') throw new UnauthorizedException('Unsupported alg');

    const expected = createHmac('sha256', secret).update(`${encHeader}.${encPayload}`).digest();
    const provided = b64UrlDecode(encSig);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      throw new UnauthorizedException('Signature mismatch');
    }

    const claim = JSON.parse(b64UrlDecode(encPayload).toString('utf8')) as Partial<AdminClaimUnion>;
    const now = Math.floor(Date.now() / 1000);
    if (!claim.exp || claim.exp < now) throw new UnauthorizedException('Token expired');
    if (claim.admin !== true) throw new UnauthorizedException('admin claim required');
    return claim as AdminClaimUnion;
  }

  private async sign(claim: AdminClaimUnion): Promise<string> {
    const secret = await this.secrets.get('ADMIN_JWT_SECRET');
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
