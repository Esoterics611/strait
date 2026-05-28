import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1715000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // ── Enum types ────────────────────────────────────────────────────────────
    // Strait is crypto-in / crypto-out: USDC funded via Mesh (Path A), USDC
    // dispatched to recipients via on-chain wallet transfer or a custodial
    // pay-out provider. No ILS. No fiat rails.
    await queryRunner.query(`
      CREATE TYPE preferred_inbound_path AS ENUM ('MESH', 'SELF')
    `);
    await queryRunner.query(`
      CREATE TYPE source_type AS ENUM ('MESH', 'SELF')
    `);
    await queryRunner.query(`
      CREATE TYPE direction AS ENUM ('CREDIT', 'DEBIT')
    `);
    await queryRunner.query(`
      CREATE TYPE tx_state AS ENUM (
        'MESH_PENDING',
        'USDC_LOCKED',
        'DISPATCHED',
        'SETTLED',
        'FAILED',
        'FAILED_DISPATCH',
        'REFUND_QUEUED',
        'REFUNDED'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE rail_used AS ENUM ('WALLET_CHAIN', 'CUSTODIAL')
    `);

    // ── member_accounts ───────────────────────────────────────────────────────
    // `usdc_virtual_balance_wei` keeps the legacy "wei" suffix (per CLAUDE §6)
    // but stores 6-decimal USDC minor units (1 USDC = 1_000_000). The CHECK
    // forbids a negative balance; the chain_id CHECK pins on-chain USDC to the
    // chains we have a USDC contract address for (1 = Ethereum mainnet, 8453 =
    // Base) — matching `ChainId` in @strait/contract.
    await queryRunner.query(`
      CREATE TABLE member_accounts (
        member_id                UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
        bridge_liquid_address    VARCHAR(42)            UNIQUE NOT NULL,
        bridge_customer_id       VARCHAR(64)            NOT NULL,
        usdc_virtual_balance_wei NUMERIC(78, 0)         NOT NULL DEFAULT 0,
        preferred_inbound_path   preferred_inbound_path NOT NULL,
        chain_id                 INTEGER                NOT NULL,
        created_at               TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_chain_id            CHECK (chain_id IN (1, 8453)),
        CONSTRAINT chk_no_negative_balance CHECK (usdc_virtual_balance_wei >= 0)
      )
    `);

    // ── usdc_transactions (append-only: strait_app role has INSERT only) ──────
    await queryRunner.query(`
      CREATE TABLE usdc_transactions (
        tx_id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
        member_id          UUID           NOT NULL REFERENCES member_accounts(member_id),
        source_type        source_type    NOT NULL,
        mesh_transfer_id   VARCHAR(128)   UNIQUE,
        dispatch_tx_id     VARCHAR(128)   UNIQUE,
        amount_usdc_wei    NUMERIC(78, 0) NOT NULL,
        direction          direction      NOT NULL,
        state              tx_state       NOT NULL,
        idempotency_key    VARCHAR(128)   UNIQUE NOT NULL,
        on_chain_tx_hash   VARCHAR(66),
        rail_used          rail_used,
        settled_at         TIMESTAMPTZ,
        created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW()
      )
    `);

    // Per-member partial unique indexes (enforce source-type exclusivity per member)
    await queryRunner.query(`
      CREATE UNIQUE INDEX udx_tx_member_mesh
        ON usdc_transactions(member_id, mesh_transfer_id)
        WHERE mesh_transfer_id IS NOT NULL
    `);

    // ── processed_webhooks ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE processed_webhooks (
        id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        provider     VARCHAR(32)  NOT NULL,
        event_id     VARCHAR(128) NOT NULL,
        processed_at TIMESTAMPTZ  NOT NULL,
        CONSTRAINT uq_processed_webhooks UNIQUE (provider, event_id)
      )
    `);

    // ── failed_webhooks ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE failed_webhooks (
        id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        provider          VARCHAR(32)  NOT NULL,
        event_id          VARCHAR(128) NOT NULL,
        raw_body          BYTEA        NOT NULL,
        error_message     TEXT,
        retry_count       INT          NOT NULL DEFAULT 0,
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        last_attempted_at TIMESTAMPTZ
      )
    `);

    // ── App role (no UPDATE/DELETE on usdc_transactions) ─────────────────────
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM pg_catalog.pg_roles WHERE rolname = 'strait_app'
        ) THEN
          CREATE ROLE strait_app LOGIN;
        END IF;
      END
      $$
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON member_accounts    TO strait_app
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT                  ON usdc_transactions  TO strait_app
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT                  ON processed_webhooks TO strait_app
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE          ON failed_webhooks    TO strait_app
    `);
    await queryRunner.query(`
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO strait_app
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`REVOKE ALL ON member_accounts    FROM strait_app`);
    await queryRunner.query(`REVOKE ALL ON usdc_transactions  FROM strait_app`);
    await queryRunner.query(`REVOKE ALL ON processed_webhooks FROM strait_app`);
    await queryRunner.query(`REVOKE ALL ON failed_webhooks    FROM strait_app`);

    await queryRunner.query(`DROP TABLE IF EXISTS failed_webhooks`);
    await queryRunner.query(`DROP TABLE IF EXISTS processed_webhooks`);
    await queryRunner.query(`DROP TABLE IF EXISTS usdc_transactions`);
    await queryRunner.query(`DROP TABLE IF EXISTS member_accounts`);

    await queryRunner.query(`DROP TYPE IF EXISTS rail_used`);
    await queryRunner.query(`DROP TYPE IF EXISTS tx_state`);
    await queryRunner.query(`DROP TYPE IF EXISTS direction`);
    await queryRunner.query(`DROP TYPE IF EXISTS source_type`);
    await queryRunner.query(`DROP TYPE IF EXISTS preferred_inbound_path`);
  }
}
