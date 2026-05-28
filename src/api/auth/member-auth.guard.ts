import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { MemberAccessClaim, MemberJwtService } from './member-jwt.service';
import { MemberSessionsRepository } from './member-sessions.repository';

export interface MemberAuthedReq extends Request {
  member: { memberId: string; email: string; jti: string };
}

/**
 * Verifies `Authorization: Bearer <jwt>` issued by `MemberJwtService` AND
 * cross-checks that the session row (`jti`) is still active. Revocation is
 * one DB UPDATE — the next request rejects without rotating any secret.
 *
 * `req.member.memberId` replaces the old `x-member-id` header trust seam
 * across `/api/recipients` and any future member endpoint.
 */
@Injectable()
export class MemberAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: MemberJwtService,
    private readonly sessions: MemberSessionsRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<MemberAuthedReq>();
    const header = req.headers['authorization'];
    if (!header || Array.isArray(header) || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    let claim: MemberAccessClaim;
    try {
      claim = await this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid member token');
    }
    const session = await this.sessions.findActive(claim.jti);
    if (!session) {
      throw new UnauthorizedException('Session revoked or expired');
    }
    if (session.member_id !== claim.sub) {
      throw new UnauthorizedException('Session/claim mismatch');
    }
    req.member = { memberId: claim.sub, email: claim.email, jti: claim.jti };
    return true;
  }
}
