import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Strait refund executor + observability columns.
 *
 * Adds `next_attempt_at` to refund_jobs so the executor cron can skip jobs
 * whose backoff hasn't elapsed. Defaults to NOW() so existing QUEUED rows are
 * picked up immediately. The status CHECK (QUEUED/EXECUTING/DONE/BLOCKED/FAILED)
 * is already in place from migration 1715000000007.
 *
 * Strait is crypto-out: the only refund executor class is "Path-A Mesh refund"
 * — credit USDC back to the sender's funding wallet via the same dispatcher
 * machinery. Reserve-pool refunds (Path C) and Rapyd refunds (Path B) are
 * removed; no extra reserve_event_type values are needed.
 */
export class RefundExecutorAndMetrics1715000000010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE refund_jobs
        ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_refund_jobs_queued_next_attempt
        ON refund_jobs(next_attempt_at)
        WHERE status = 'QUEUED'
    `);
    // strait_app already has SELECT, INSERT, UPDATE on refund_jobs (granted by
    // migration 1715000000007). Re-grant defensively to cover the new column.
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE ON refund_jobs TO strait_app
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_refund_jobs_queued_next_attempt`);
    await queryRunner.query(`ALTER TABLE refund_jobs DROP COLUMN IF EXISTS next_attempt_at`);
  }
}
