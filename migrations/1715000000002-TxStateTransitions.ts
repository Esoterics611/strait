import { MigrationInterface, QueryRunner } from 'typeorm';

export class TxStateTransitions1715000000002 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tx_state_transitions (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tx_id       UUID        NOT NULL REFERENCES usdc_transactions(tx_id),
        from_state  tx_state    NULL,
        to_state    tx_state    NOT NULL,
        metadata    JSONB       NULL,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_tx_state_transitions_tx_id_occurred
        ON tx_state_transitions(tx_id, occurred_at DESC)
    `);

    // View to surface the current state of each tx without ad-hoc ORDER BY scans.
    await queryRunner.query(`
      CREATE VIEW v_tx_current_state AS
        SELECT DISTINCT ON (tx_id) tx_id, to_state AS current_state, occurred_at
        FROM tx_state_transitions
        ORDER BY tx_id, occurred_at DESC
    `);

    await queryRunner.query(`
      GRANT SELECT, INSERT ON tx_state_transitions TO strait_app
    `);
    await queryRunner.query(`
      GRANT SELECT ON v_tx_current_state TO strait_app
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`REVOKE ALL ON v_tx_current_state FROM strait_app`);
    await queryRunner.query(`REVOKE ALL ON tx_state_transitions FROM strait_app`);
    await queryRunner.query(`DROP VIEW IF EXISTS v_tx_current_state`);
    await queryRunner.query(`DROP TABLE IF EXISTS tx_state_transitions`);
  }
}
