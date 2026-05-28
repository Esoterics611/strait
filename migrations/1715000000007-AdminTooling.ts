import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminTooling1715000000007 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // ── Operators ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE admin_users (
        user_id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        email           VARCHAR(255) UNIQUE NOT NULL,
        password_hash   VARCHAR(255) NOT NULL,
        mfa_secret_enc  BYTEA,
        mfa_enrolled    BOOLEAN      NOT NULL DEFAULT FALSE,
        role            VARCHAR(32)  NOT NULL
                        CHECK (role IN ('viewer','support','ops','finance','compliance','admin')),
        is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        last_login_at   TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE ON admin_users TO strait_app
    `);

    // ── Append-only audit log ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE admin_audit_log (
        entry_id     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        operator_id  UUID         REFERENCES admin_users(user_id),
        action       VARCHAR(64)  NOT NULL,
        target_type  VARCHAR(32)  NOT NULL,
        target_id    VARCHAR(128),
        payload_hash VARCHAR(64),
        metadata     JSONB,
        ip           INET,
        user_agent   TEXT,
        occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_audit_log_target ON admin_audit_log(target_type, target_id, occurred_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_audit_log_action ON admin_audit_log(action, occurred_at DESC)
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT ON admin_audit_log TO strait_app
    `);

    // ── Approval queue ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE admin_pending_approvals (
        approval_id     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        action          VARCHAR(64)  NOT NULL,
        target_type     VARCHAR(32),
        target_id       VARCHAR(128),
        initiated_by    UUID         NOT NULL REFERENCES admin_users(user_id),
        required_role   VARCHAR(32)  NOT NULL,
        payload         JSONB        NOT NULL,
        status          VARCHAR(16)  NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED')),
        resolved_by     UUID         REFERENCES admin_users(user_id),
        resolution_note TEXT,
        result          JSONB,
        expires_at      TIMESTAMPTZ  NOT NULL,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        resolved_at     TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_approvals_status ON admin_pending_approvals(status, expires_at)
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE ON admin_pending_approvals TO strait_app
    `);

    // ── Domain events log (mirror of in-memory event bus for read paths) ──────
    await queryRunner.query(`
      CREATE TABLE domain_events_log (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        tx_id       UUID,
        event_type  VARCHAR(64)  NOT NULL,
        payload     JSONB        NOT NULL,
        occurred_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_domain_events_tx ON domain_events_log(tx_id, occurred_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_domain_events_type ON domain_events_log(event_type, occurred_at DESC)
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT ON domain_events_log TO strait_app
    `);

    // ── Refund queue (executors are Session 9+) ───────────────────────────────
    await queryRunner.query(`
      CREATE TABLE refund_jobs (
        job_id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        tx_id          UUID         NOT NULL REFERENCES usdc_transactions(tx_id),
        requested_by   UUID         REFERENCES admin_users(user_id),
        amount_units   NUMERIC(78,0) NOT NULL,
        status         VARCHAR(16)  NOT NULL DEFAULT 'QUEUED'
                        CHECK (status IN ('QUEUED','EXECUTING','DONE','BLOCKED','FAILED')),
        executor_path  VARCHAR(16),
        attempts       INT          NOT NULL DEFAULT 0,
        last_error     TEXT,
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        completed_at   TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX udx_refund_jobs_tx_active
        ON refund_jobs(tx_id) WHERE status IN ('QUEUED','EXECUTING')
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE ON refund_jobs TO strait_app
    `);

    // ── Provider health (populated by interceptor on each provider call) ──────
    await queryRunner.query(`
      CREATE TABLE provider_health (
        provider          VARCHAR(32) PRIMARY KEY,
        last_success_at   TIMESTAMPTZ,
        last_error_at     TIMESTAMPTZ,
        last_error_message TEXT,
        last_latency_ms   INT
      )
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE ON provider_health TO strait_app
    `);

    // ── Cron runs ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE cron_runs (
        cron_name      VARCHAR(64) PRIMARY KEY,
        last_fired_at  TIMESTAMPTZ,
        last_status    VARCHAR(16),
        last_error     TEXT
      )
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE ON cron_runs TO strait_app
    `);

    // ── Member account additions (KYC / OFAC / freeze / contact) ──────────────
    await queryRunner.query(`
      ALTER TABLE member_accounts
        ADD COLUMN email           VARCHAR(255),
        ADD COLUMN phone           VARCHAR(32),
        ADD COLUMN kyc_status      VARCHAR(16) NOT NULL DEFAULT 'PENDING'
                    CHECK (kyc_status IN ('PENDING','VERIFIED','REJECTED','EXPIRED')),
        ADD COLUMN kyc_verified_at TIMESTAMPTZ,
        ADD COLUMN ofac_status     VARCHAR(16) NOT NULL DEFAULT 'NOT_SCREENED'
                    CHECK (ofac_status IN ('NOT_SCREENED','CLEAR','HIT','OVERRIDE')),
        ADD COLUMN is_frozen       BOOLEAN     NOT NULL DEFAULT FALSE,
        ADD COLUMN frozen_at       TIMESTAMPTZ,
        ADD COLUMN frozen_reason   TEXT
    `);

    // ── Persist webhook raw bodies for replay ─────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE processed_webhooks
        ADD COLUMN raw_body BYTEA
    `);

    // ── Initial admin seed (env-driven; if ADMIN_BOOTSTRAP_EMAIL set, planted) ─
    // Bootstrap is intentionally skipped here; first user is created at app
    // boot by a one-shot routine that reads ADMIN_BOOTSTRAP_EMAIL +
    // ADMIN_BOOTSTRAP_PASSWORD and inserts on first run if admin_users is empty.
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE processed_webhooks DROP COLUMN IF EXISTS raw_body`);
    await queryRunner.query(`
      ALTER TABLE member_accounts
        DROP COLUMN IF EXISTS frozen_reason,
        DROP COLUMN IF EXISTS frozen_at,
        DROP COLUMN IF EXISTS is_frozen,
        DROP COLUMN IF EXISTS ofac_status,
        DROP COLUMN IF EXISTS kyc_verified_at,
        DROP COLUMN IF EXISTS kyc_status,
        DROP COLUMN IF EXISTS phone,
        DROP COLUMN IF EXISTS email
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS cron_runs`);
    await queryRunner.query(`DROP TABLE IF EXISTS provider_health`);
    await queryRunner.query(`DROP TABLE IF EXISTS refund_jobs`);
    await queryRunner.query(`DROP TABLE IF EXISTS domain_events_log`);
    await queryRunner.query(`DROP TABLE IF EXISTS admin_pending_approvals`);
    await queryRunner.query(`DROP TABLE IF EXISTS admin_audit_log`);
    await queryRunner.query(`DROP TABLE IF EXISTS admin_users`);
  }
}
