import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type RefundJobStatus = 'QUEUED' | 'EXECUTING' | 'DONE' | 'BLOCKED' | 'FAILED';

export interface RefundJobRow {
  job_id: string;
  tx_id: string;
  requested_by: string | null;
  amount_units: string;
  status: RefundJobStatus;
  executor_path: string | null;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  completed_at: Date | null;
}

@Injectable()
export class RefundJobsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Insert a new QUEUED refund job; returns existing active job if one already exists. */
  async enqueue(
    txId: string,
    requestedBy: string,
    amountUnits: bigint,
    executorPath: string,
  ): Promise<{ row: RefundJobRow; created: boolean }> {
    // Try to insert; on conflict with the partial unique index, return existing.
    const inserted = await this.dataSource.query<RefundJobRow[]>(
      `INSERT INTO refund_jobs(tx_id, requested_by, amount_units, executor_path)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [txId, requestedBy, amountUnits.toString(), executorPath],
    );
    if (inserted.length > 0) return { row: inserted[0], created: true };
    const existing = await this.dataSource.query<RefundJobRow[]>(
      `SELECT * FROM refund_jobs WHERE tx_id = $1 AND status IN ('QUEUED','EXECUTING')
        ORDER BY created_at DESC LIMIT 1`,
      [txId],
    );
    return { row: existing[0], created: false };
  }

  async listForTx(txId: string): Promise<RefundJobRow[]> {
    return this.dataSource.query<RefundJobRow[]>(
      `SELECT * FROM refund_jobs WHERE tx_id = $1 ORDER BY created_at DESC`,
      [txId],
    );
  }

  async listAll(limit = 100): Promise<RefundJobRow[]> {
    return this.dataSource.query<RefundJobRow[]>(
      `SELECT * FROM refund_jobs ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
  }
}
