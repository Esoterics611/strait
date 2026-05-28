import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { BusinessLogger } from '@common/logging';

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface MagicLinkIssueResult {
  /** The plaintext token returned ONCE — emailed in production, logged in dev. */
  token: string;
  /** Always true. The caller never learns whether the email was a real member;
   *  unknown emails get a stub token that won't verify (anti-enumeration). */
  delivered: true;
}

export interface MagicLinkVerifyResult {
  memberId: string;
  email: string;
}

/**
 * Email-based magic-link issuance and verification.
 *
 * Issuance is symmetric for known + unknown emails to avoid enumeration: a
 * token is always generated, but for unknown emails it is bound to no member
 * (verify fails on the missing `member_id`). The plaintext token is returned
 * in the HTTP response in dev; in production a transactional email service
 * (out of scope for this session) would deliver it instead.
 *
 * Storage: SHA-256 hash of the token in `magic_link_tokens.token_hash`.
 * Single-use via UPDATE…RETURNING with a `consumed_at IS NULL` guard.
 */
@Injectable()
export class MagicLinkService {
  private readonly blog = new BusinessLogger('MagicLinkService');

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async issue(email: string): Promise<MagicLinkIssueResult> {
    const normalized = email.toLowerCase().trim();
    if (!normalized.includes('@')) {
      throw new UnauthorizedException('Invalid email');
    }
    const memberRows = await this.ds.query<{ member_id: string }[]>(
      `SELECT member_id FROM member_accounts WHERE LOWER(email) = $1`,
      [normalized],
    );
    const memberId = memberRows[0]?.member_id ?? null;

    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await this.ds.query(
      `INSERT INTO magic_link_tokens(email, token_hash, member_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [normalized, hash, memberId, expiresAt],
    );

    this.blog.info('issue', {
      memberId: memberId ?? undefined,
      detail: {
        email_known: memberId !== null,
        ttl_minutes: TOKEN_TTL_MS / 60_000,
      },
    });
    return { token, delivered: true };
  }

  async verify(token: string): Promise<MagicLinkVerifyResult> {
    if (!token || typeof token !== 'string' || token.length < 16) {
      throw new UnauthorizedException('Invalid token');
    }
    const hash = createHash('sha256').update(token).digest('hex');

    // Single-use claim via UPDATE … RETURNING with the "still pending" guard.
    const rows = await this.ds.query<
      { token_id: string; member_id: string | null; email: string }[]
    >(
      `UPDATE magic_link_tokens
          SET consumed_at = NOW()
        WHERE token_hash = $1
          AND consumed_at IS NULL
          AND expires_at > NOW()
        RETURNING token_id, member_id, email`,
      [hash],
    );
    if (rows.length === 0) {
      throw new UnauthorizedException('Token invalid or expired');
    }
    const row = rows[0];
    if (!row.member_id) {
      throw new UnauthorizedException('Token invalid or expired');
    }
    return { memberId: row.member_id, email: row.email };
  }
}
