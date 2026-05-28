import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RefundJobClaim, RefundOutcomeKind } from './refund-executor.types';
import { SourceType } from '@common/enums';

interface ClaimRow {
  job_id: string;
  tx_id: string;
  amount_units: string;
  executor_path: string;
  attempts: number;
  requested_by: string | null;
  source_type: SourceType;
}

/**
 * Race-safe job claim for the refund executor cron. A single
 * `UPDATE … SET status='EXECUTING' … RETURNING …` is the only safe way to
 * pick a QUEUED job in the presence of multiple sweep workers — Postgres
 * resolves the lock for us.
 *
 * The partial unique index `udx_refund_jobs_tx_active` (status IN
 * ('QUEUED','EXECUTING')) prevents two active jobs per tx by design — the
 * QUEUEING side of the workflow is also race-safe by the same index.
 */
@Injectable()
export class RefundExecutorRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * Atomically pick up to `limit` QUEUED jobs whose `next_attempt_at` has
   * elapsed, flip them to EXECUTING, bump `attempts`, and return their
   * payload joined with the originating tx's source_type so the dispatcher
   * can route to the right executor.
   */
  async claimBatch(limit: number): Promise<RefundJobClaim[] & { sourceType?: SourceType }[]> {
    const rows = await this.ds.query<ClaimRow[]>(
      `WITH picked AS (
         SELECT job_id FROM refund_jobs
          WHERE status = 'QUEUED' AND next_attempt_at <= NOW()
          ORDER BY next_attempt_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE refund_jobs r
          SET status = 'EXECUTING', attempts = attempts + 1
         FROM picked, usdc_transactions u
        WHERE r.job_id = picked.job_id
          AND u.tx_id = r.tx_id
        RETURNING r.job_id, r.tx_id, r.amount_units, r.executor_path,
                  r.attempts, r.requested_by, u.source_type`,
      [limit],
    );
    return rows.map<RefundJobClaim & { sourceType: SourceType }>((r) => ({
      jobId: r.job_id,
      txId: r.tx_id,
      amountUnits: BigInt(r.amount_units),
      executorPath: r.executor_path,
      attempts: r.attempts,
      requestedBy: r.requested_by,
      sourceType: r.source_type,
    })) as RefundJobClaim[] & { sourceType?: SourceType }[];
  }

  async markDone(jobId: string, externalRefundId: string | undefined): Promise<void> {
    await this.ds.query(
      `UPDATE refund_jobs
          SET status = 'DONE', completed_at = NOW(),
              last_error = $2
        WHERE job_id = $1`,
      [jobId, externalRefundId ? `done:${externalRefundId}` : null],
    );
  }

  /**
   * Park a job — no further automatic retries. Used when the executor sees a
   * known-irrecoverable condition (e.g. tx already REFUNDED). A human can flip
   * it back to QUEUED via admin tooling if appropriate.
   */
  async markBlocked(jobId: string, reason: string): Promise<void> {
    await this.ds.query(
      `UPDATE refund_jobs
          SET status = 'BLOCKED', last_error = $2, completed_at = NOW()
        WHERE job_id = $1`,
      [jobId, reason.slice(0, 1000)],
    );
  }

  /**
   * Transient failure — bump attempts, set next_attempt_at to a backoff,
   * and either re-queue (attempts < max) or FAIL terminally.
   */
  async markFailedOrRequeue(
    jobId: string,
    errorMessage: string,
    attempts: number,
    maxAttempts: number,
  ): Promise<RefundOutcomeKind> {
    if (attempts >= maxAttempts) {
      await this.ds.query(
        `UPDATE refund_jobs
            SET status = 'FAILED', last_error = $2, completed_at = NOW()
          WHERE job_id = $1`,
        [jobId, errorMessage.slice(0, 1000)],
      );
      return 'FAILED';
    }
    // Exponential backoff: 2^attempts minutes, capped at 30.
    const minutes = Math.min(30, Math.pow(2, attempts));
    await this.ds.query(
      `UPDATE refund_jobs
          SET status = 'QUEUED', last_error = $2,
              next_attempt_at = NOW() + ($3 || ' minutes')::interval
        WHERE job_id = $1`,
      [jobId, errorMessage.slice(0, 1000), minutes.toString()],
    );
    return 'FAILED';
  }
}
