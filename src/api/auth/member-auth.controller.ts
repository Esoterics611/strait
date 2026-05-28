import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { MagicLinkService } from './magic-link.service';
import { MemberJwtService } from './member-jwt.service';
import { MemberSessionsRepository } from './member-sessions.repository';
import { MemberAuthedReq, MemberAuthGuard } from './member-auth.guard';

interface IssueBody { email: string }
interface VerifyBody { token: string }

/**
 * Magic-link issuance + verification endpoints. Both are HTTP 200 on
 * happy path; both refuse to leak whether an email maps to a real member.
 *
 *   POST /api/auth/member/magic-link  { email }       → { delivered: true, devToken? }
 *   POST /api/auth/member/verify      { token }       → { accessToken, member: { id, email } }
 *   POST /api/auth/member/logout      (Bearer …)      → 204
 */
@Controller('api/auth/member')
export class MemberAuthController {
  constructor(
    private readonly magic: MagicLinkService,
    private readonly jwt: MemberJwtService,
    private readonly sessions: MemberSessionsRepository,
  ) {}

  @Post('magic-link')
  @HttpCode(200)
  async issue(@Body() body: IssueBody) {
    if (!body?.email) throw new UnauthorizedException('email required');
    const res = await this.magic.issue(body.email);
    // dev: return the token in the response so the test harness / local dev can
    // exercise the verify endpoint without a real email service. Production
    // should strip this field (the email side-channel is the only delivery).
    return { delivered: res.delivered, devToken: res.token };
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: VerifyBody, @Req() req: Request) {
    if (!body?.token) throw new UnauthorizedException('token required');
    const { memberId, email } = await this.magic.verify(body.token);
    const { token, claim } = await this.jwt.mint(memberId, email);
    await this.sessions.create({
      memberId,
      jti: claim.jti,
      expiresAt: new Date(claim.exp * 1000),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      ip: req.ip ?? req.socket?.remoteAddress ?? undefined,
    });
    return {
      accessToken: token,
      member: { id: memberId, email },
      expiresAt: new Date(claim.exp * 1000).toISOString(),
    };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(MemberAuthGuard)
  async logout(@Req() req: MemberAuthedReq): Promise<void> {
    await this.sessions.revoke(req.member.jti);
  }
}
