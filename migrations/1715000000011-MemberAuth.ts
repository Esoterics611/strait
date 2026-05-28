import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * S-B2 — member-facing magic-link auth.
 *
 * Two tables:
 *   - magic_link_tokens — short-lived (15 min), single-use, opaque, hashed at
 *     rest. The plaintext token is only ever returned in the issuance HTTP
 *     response (and emailed in production); a successful `verify` consumes it.
 *   - member_sessions   — long-lived sessions identified by JWT `jti`.
 *     Revocation-safe: deleting / marking a row revoked-at causes the next
 *     MemberAuthGuard check to reject the token.
 *
 * No PII besides the existing `member_accounts.email` is added; the magic
 * link table stores `email` so an unknown email can be issued a stub link
 * (preventing user enumeration via the response shape).
 *
 * `strait_app` gets full DML on both tables.
 */
export class MemberAuth1715000000011 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE magic_link_tokens (
        token_id      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        email         VARCHAR(320) NOT NULL,
        token_hash    VARCHAR(128) NOT NULL UNIQUE,
        member_id     UUID         REFERENCES member_accounts(member_id),
        expires_at    TIMESTAMPTZ  NOT NULL,
        consumed_at   TIMESTAMPTZ,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await qr.query(`CREATE INDEX idx_magic_link_tokens_email ON magic_link_tokens(email)`);
    await qr.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON magic_link_tokens TO strait_app`);

    await qr.query(`
      CREATE TABLE member_sessions (
        session_id    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        member_id     UUID         NOT NULL REFERENCES member_accounts(member_id),
        jti           VARCHAR(64)  NOT NULL UNIQUE,
        issued_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        expires_at    TIMESTAMPTZ  NOT NULL,
        revoked_at    TIMESTAMPTZ,
        user_agent    VARCHAR(512),
        ip            VARCHAR(64)
      )
    `);
    await qr.query(`CREATE INDEX idx_member_sessions_member_id ON member_sessions(member_id)`);
    await qr.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON member_sessions TO strait_app`);

    // ─── Recipient pinning across the Mesh webhook gap ───────────────────────
    // Path A (Mesh) is webhook-driven — the recipient choice the member made
    // at transfer-initiation time must survive until the Mesh transfer-completed
    // webhook arrives and the ledger credit is INSERTed. `pending_recipient_id`
    // carries that choice on the member row so MeshService can pin it on the
    // ledger INSERT. Nullable so historical members are untouched.
    await qr.query(`
      ALTER TABLE member_accounts
        ADD COLUMN IF NOT EXISTS pending_recipient_id UUID
          REFERENCES recipients(recipient_id)
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE member_accounts DROP COLUMN IF EXISTS pending_recipient_id`);
    await qr.query(`DROP TABLE IF EXISTS member_sessions`);
    await qr.query(`DROP TABLE IF EXISTS magic_link_tokens`);
  }
}
