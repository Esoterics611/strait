import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AdminRoleGuard, AdminAuthedReq } from './role.guard';

interface LoginBody { email: string; password: string }
interface MfaBody { challenge: string; code: string }
interface RefreshBody { refresh: string }
interface EnrollBody { code: string }
interface SetupBody { challenge: string }

@Controller('admin/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(@Body() body: LoginBody) {
    return this.auth.login(body.email, body.password);
  }

  @Post('mfa')
  async mfa(@Body() body: MfaBody) {
    return this.auth.completeMfa(body.challenge, body.code);
  }

  @Post('refresh')
  async refresh(@Body() body: RefreshBody) {
    return this.auth.refresh(body.refresh);
  }

  @Post('logout')
  @UseGuards(AdminRoleGuard)
  async logout() {
    // Stateless JWT; clients discard. For revocation post-MVP wire a deny-list.
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AdminRoleGuard)
  me(@Req() req: AdminAuthedReq) {
    return {
      userId: req.adminUser.sub,
      email: req.adminUser.email,
      role: req.adminUser.role,
    };
  }

  @Post('mfa/enroll')
  @UseGuards(AdminRoleGuard)
  async enroll(@Req() req: AdminAuthedReq, @Body() _body: EnrollBody) {
    return this.auth.enrollMfa(req.adminUser.sub);
  }

  /**
   * Public first-time setup: caller supplies the mfa_challenge JWT received from
   * /admin/auth/login (status=mfa_setup_required). Returns the otpauth URL and
   * stores the encrypted secret with mfa_enrolled=FALSE; the first successful
   * /admin/auth/mfa call flips mfa_enrolled=TRUE.
   */
  @Post('mfa/setup')
  async setup(@Body() body: SetupBody) {
    return this.auth.enrollWithChallenge(body.challenge);
  }
}
