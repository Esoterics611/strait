import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Strait recipients table — crypto-out targets.
 *
 * A recipient is one of two payout shapes:
 *   - WALLET_CHAIN: a direct on-chain USDC transfer to (chainId, walletAddress).
 *   - CUSTODIAL:    a third-party crypto pay-out provider holds funds for the
 *                   beneficiary; we send via an opaque providerKey + externalAccountId
 *                   token. `last4` is the only safe-to-display tail.
 *
 * The `recipients_method_shape` CHECK forbids mixing columns from the two
 * shapes, so `payout_method` is a single source of truth for which columns are
 * populated. Mirrors @strait/contract `Recipient` exactly (camelCase ↔
 * snake_case).
 *
 * `recipient_id` is added to `usdc_transactions` (nullable at the column level
 * — append-only history must remain insertable — but enforced at INSERT by the
 * runtime per CLAUDE §S-B3 contract).
 */
export class Recipients1715000000008 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // pgcrypto (gen_random_uuid) already installed by InitialSchema.
    await queryRunner.query(`
      CREATE TABLE recipients (
        recipient_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        member_id             UUID        NOT NULL REFERENCES member_accounts(member_id),
        display_name          TEXT        NOT NULL,
        relationship          TEXT,
        payout_method         TEXT        NOT NULL
                              CHECK (payout_method IN ('WALLET_CHAIN', 'CUSTODIAL')),
        -- WALLET_CHAIN columns
        wallet_chain_id       INT,
        wallet_address        TEXT,
        -- CUSTODIAL columns
        custodial_provider    TEXT,
        custodial_external_id TEXT,
        custodial_last4       TEXT,
        --
        dispatch_status       TEXT        NOT NULL DEFAULT 'UNREGISTERED'
                              CHECK (dispatch_status IN ('UNREGISTERED','REGISTERING','READY','FAILED')),
        dispatch_error        TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT recipients_method_shape CHECK (
          (payout_method = 'WALLET_CHAIN'
             AND wallet_chain_id    IS NOT NULL
             AND wallet_address     IS NOT NULL
             AND custodial_provider IS NULL
             AND custodial_external_id IS NULL)
          OR
          (payout_method = 'CUSTODIAL'
             AND custodial_provider    IS NOT NULL
             AND custodial_external_id IS NOT NULL
             AND wallet_chain_id IS NULL
             AND wallet_address  IS NULL)
        ),
        CONSTRAINT recipients_wallet_chain_id_supported
          CHECK (wallet_chain_id IS NULL OR wallet_chain_id IN (1, 8453))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_recipients_member ON recipients(member_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_recipients_member_active
        ON recipients(member_id, dispatch_status)
    `);

    // usdc_transactions.recipient_id — nullable at the column level (the
    // append-only ledger cannot retro-link historical rows), enforced at
    // INSERT in the runtime per CLAUDE §S-B3.
    await queryRunner.query(`
      ALTER TABLE usdc_transactions
        ADD COLUMN recipient_id UUID REFERENCES recipients(recipient_id)
    `);

    // recipients are MUTABLE (dispatch_status churns through the registration
    // lifecycle). usdc_transactions grants are unchanged (append-only).
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON recipients TO strait_app
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`REVOKE ALL ON recipients FROM strait_app`);
    await queryRunner.query(
      `ALTER TABLE usdc_transactions DROP COLUMN IF EXISTS recipient_id`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_recipients_member_active`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_recipients_member`);
    await queryRunner.query(`DROP TABLE IF EXISTS recipients`);
  }
}
