import {
  ConflictException,
  Inject,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ISecretProvider, SECRET_PROVIDER } from '../../secrets/secret-provider.interface';
import { BusinessLogger } from '@common/logging';
import { AdminUsersRepository } from './admin-users.repository';
import { PasswordService } from './password.service';
import { TotpService } from './totp.service';
import { AdminRole, JwtService } from './jwt.service';

export interface LoginInitiateResult {
  status: 'tokens' | 'mfa_required' | 'mfa_setup_required';
  access?: string;
  refresh?: string;
  challenge?: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly blog = new BusinessLogger('AuthService');

  constructor(
    @Inject(SECRET_PROVIDER) private readonly secrets: ISecretProvider,
    private readonly users: AdminUsersRepository,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly jwt: JwtService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.bootstrapInitialAdmin().catch((err) =>
      this.blog.warn('bootstrapInitialAdmin', {
        detail: { outcome: 'skipped' },
        error: err,
      }),
    );
  }

  /**
   * One-shot: if admin_users is empty AND ADMIN_BOOTSTRAP_EMAIL+ADMIN_BOOTSTRAP_PASSWORD
   * are set in the environment, create the first admin operator. This lets the
   * system come up locked from day one without manual psql.
   */
  private async bootstrapInitialAdmin(): Promise<void> {
    const count = await this.users.countActive();
    if (count > 0) return;
    const email = await this.safeGet('ADMIN_BOOTSTRAP_EMAIL');
    const password = await this.safeGet('ADMIN_BOOTSTRAP_PASSWORD');
    if (!email || !password) return;
    const hash = await this.passwords.hash(password);
    await this.users.insert(email, hash, 'admin');
    this.blog.info('bootstrapInitialAdmin', {
      detail: {
        email,
        outcome: 'first_admin_bootstrapped',
        note: 'change password immediately',
      },
    });
  }

  async login(email: string, password: string): Promise<LoginInitiateResult> {
    const user = await this.users.findByEmail(email);
    if (!user || !user.is_active) {
      this.blog.warn('login', {
        detail: { email, outcome: 'failed', reason: 'invalid_credentials' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await this.passwords.verify(password, user.password_hash);
    if (!ok) {
      this.blog.warn('login', {
        detail: { email, outcome: 'failed', reason: 'invalid_credentials' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.mfa_enrolled && user.mfa_secret_enc) {
      const challenge = await this.jwt.mintChallenge(user.user_id, user.email);
      this.blog.info('login', {
        detail: {
          email,
          adminUserId: user.user_id,
          outcome: 'mfa_challenge_issued',
        },
      });
      return { status: 'mfa_required', challenge };
    }

    // Ops+ roles MUST enroll MFA — refuse to issue tokens without it. The UI
    // distinguishes this from `mfa_required` so it can show the QR + first-code
    // flow instead of the regular code-entry screen.
    if (['ops', 'finance', 'compliance', 'admin'].includes(user.role) && !user.mfa_enrolled) {
      const challenge = await this.jwt.mintChallenge(user.user_id, user.email);
      this.blog.info('login', {
        detail: {
          email,
          adminUserId: user.user_id,
          outcome: 'mfa_setup_required',
        },
      });
      return { status: 'mfa_setup_required', challenge };
    }

    await this.users.touchLogin(user.user_id);
    this.blog.info('login', {
      detail: {
        email,
        adminUserId: user.user_id,
        outcome: 'success',
        role: user.role,
      },
    });
    return {
      status: 'tokens',
      access: await this.jwt.mintAccess(user.user_id, user.email, user.role),
      refresh: await this.jwt.mintRefresh(user.user_id),
    };
  }

  async completeMfa(challengeToken: string, code: string): Promise<{ access: string; refresh: string }> {
    const claim = await this.jwt.verify(challengeToken);
    if (claim.type !== 'mfa_challenge') throw new UnauthorizedException('Invalid challenge');
    const user = await this.users.findById(claim.sub);
    if (!user || !user.is_active) throw new UnauthorizedException('Invalid challenge');
    if (!user.mfa_secret_enc) {
      // Setup hasn't run yet — caller should use /admin/auth/mfa/setup first.
      throw new UnauthorizedException('MFA not initialised — call /admin/auth/mfa/setup');
    }
    const key = await this.mfaKey();
    const secret = this.totp.decryptSecret(user.mfa_secret_enc, key);
    if (!this.totp.verify(secret, code)) {
      this.blog.warn('completeMfa', {
        detail: { adminUserId: user.user_id, outcome: 'invalid_totp' },
      });
      throw new UnauthorizedException('Invalid MFA code');
    }

    // First successful verify after setup flips enrolled=true permanently.
    if (!user.mfa_enrolled) {
      await this.users.markMfaConfirmed(user.user_id);
    }
    await this.users.touchLogin(user.user_id);
    this.blog.info('completeMfa', {
      detail: { adminUserId: user.user_id, outcome: 'mfa_verified' },
    });
    return {
      access: await this.jwt.mintAccess(user.user_id, user.email, user.role),
      refresh: await this.jwt.mintRefresh(user.user_id),
    };
  }

  /** Returns the otpauth:// URL for QR-scanning + caches an encrypted secret pending verification. */
  async enrollMfa(userId: string): Promise<{ otpauthUrl: string; secretBase32: string }> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');
    if (user.mfa_enrolled) throw new ConflictException('MFA already enrolled');
    const { raw, base32 } = this.totp.generateSecret();
    const key = await this.mfaKey();
    const enc = this.totp.encryptSecret(raw, key);
    await this.users.updateMfa(userId, enc);
    // updateMfa marks mfa_enrolled=true; we revert that here — the user is not
    // truly "enrolled" until they verify the first code. The next code-verify
    // succeeds with the stored secret; if they never verify, an admin resetMfa
    // wipes the half-set row.
    await this.users.markMfaPendingVerification(userId);
    return {
      otpauthUrl: this.totp.otpauthUrl(base32, user.email),
      secretBase32: base32,
    };
  }

  /**
   * Public enrollment entry point keyed off an mfa_setup_required challenge.
   * Used during first-time login by ops+ users who have no access token yet.
   */
  async enrollWithChallenge(challengeToken: string): Promise<{ otpauthUrl: string; secretBase32: string }> {
    const claim = await this.jwt.verify(challengeToken);
    if (claim.type !== 'mfa_challenge') throw new UnauthorizedException('Invalid challenge');
    return this.enrollMfa(claim.sub);
  }

  async refresh(refreshToken: string): Promise<{ access: string; refresh: string }> {
    const claim = await this.jwt.verify(refreshToken);
    if (claim.type !== 'refresh') throw new UnauthorizedException('Wrong token type');
    const user = await this.users.findById(claim.sub);
    if (!user || !user.is_active) throw new UnauthorizedException('Account inactive');
    this.blog.debug('refresh', {
      detail: { adminUserId: user.user_id },
    });
    return {
      access: await this.jwt.mintAccess(user.user_id, user.email, user.role),
      refresh: await this.jwt.mintRefresh(user.user_id),
    };
  }

  private async safeGet(key: string): Promise<string> {
    try {
      return await this.secrets.get(key);
    } catch {
      return '';
    }
  }

  private async mfaKey(): Promise<Buffer> {
    const hex = await this.safeGet('ADMIN_MFA_KEY_HEX');
    if (!hex) throw new Error('ADMIN_MFA_KEY_HEX not configured');
    return Buffer.from(hex, 'hex');
  }
}
