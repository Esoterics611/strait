import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

// PoC-only auth stub. Real session/JWT auth is post-PoC.
// Header format: `Authorization: Bearer dev-<memberId>`
// On success: attaches `req.memberId` for downstream consumers.
@Injectable()
export class SessionStubGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { memberId?: string }>();
    const raw = req.headers['authorization'];
    if (!raw || Array.isArray(raw)) throw new UnauthorizedException();

    const m = raw.match(/^Bearer dev-([0-9a-f-]{8,})$/i);
    if (!m) throw new UnauthorizedException();
    req.memberId = m[1];
    return true;
  }
}
