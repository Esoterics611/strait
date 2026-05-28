import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AdminAuthedReq, AdminRoleGuard, RequireRole } from '../auth/role.guard';

interface ExportBody { report: 'daily-volume' | 'settlement-rates' | 'fx-rates'; from: string; to: string }

interface ExportJob {
  jobId: string;
  report: string;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  rows?: unknown[];
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

@Controller('admin/reports')
@UseGuards(AdminRoleGuard)
export class ReportsController {
  // In-memory export jobs — sufficient for PoC; production swap is a job queue.
  private readonly jobs = new Map<string, ExportJob>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get('daily-volume')
  @RequireRole('viewer')
  async dailyVolume(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const f = from ? new Date(from) : new Date(Date.now() - 30 * 86400_000);
    const t = to ? new Date(to) : new Date();
    return this.dataSource.query(
      `SELECT date_trunc('day', created_at)::date AS day, source_type,
              COUNT(*) AS tx_count,
              SUM(amount_usdc_wei::numeric) AS amount_units
         FROM usdc_transactions
        WHERE direction = 'CREDIT' AND created_at BETWEEN $1 AND $2
        GROUP BY 1, 2 ORDER BY 1 DESC, 2`,
      [f, t],
    );
  }

  @Get('settlement-rates')
  @RequireRole('viewer')
  async settlementRates() {
    return this.dataSource.query(
      `WITH per_tx AS (
         SELECT u.tx_id, u.source_type,
                MIN(t.occurred_at) FILTER (WHERE t.to_state = 'USDC_LOCKED')      AS locked_at,
                MIN(t.occurred_at) FILTER (WHERE t.to_state = 'SETTLED_USD')     AS settled_at
           FROM usdc_transactions u
           LEFT JOIN tx_state_transitions t ON t.tx_id = u.tx_id
          WHERE u.created_at > NOW() - INTERVAL '30 days'
          GROUP BY u.tx_id, u.source_type
       )
       SELECT source_type,
              COUNT(*) FILTER (WHERE settled_at IS NOT NULL) AS settled,
              COUNT(*) AS total,
              percentile_disc(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM settled_at - locked_at)) AS p50_seconds,
              percentile_disc(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM settled_at - locked_at)) AS p95_seconds
         FROM per_tx GROUP BY source_type`,
    );
  }

  @Get('fx-rates')
  @RequireRole('viewer')
  async fxRates() {
    return this.dataSource.query(
      `SELECT date_trunc('day', created_at)::date AS day,
              MIN(fx_rate_snapshot) AS min_rate,
              percentile_disc(0.5) WITHIN GROUP (ORDER BY fx_rate_snapshot) AS median_rate,
              MAX(fx_rate_snapshot) AS max_rate,
              COUNT(*) AS tx_count
         FROM usdc_transactions
        WHERE fx_rate_snapshot IS NOT NULL
          AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY 1 ORDER BY 1 DESC`,
    );
  }

  @Get('failed-payments')
  @RequireRole('viewer')
  async failedPayments() {
    return this.dataSource.query(
      `SELECT source_type, COALESCE(metadata->>'reason', metadata->>'failure_reason', 'unknown') AS reason,
              COUNT(*) AS n
         FROM usdc_transactions u
         JOIN tx_state_transitions t ON t.tx_id = u.tx_id
        WHERE t.to_state IN ('FAILED','FAILED_BRIDGE')
          AND t.occurred_at > NOW() - INTERVAL '30 days'
        GROUP BY 1, 2 ORDER BY n DESC`,
    );
  }

  @Get('reserve-pool')
  @RequireRole('viewer')
  async reservePool() {
    return this.dataSource.query(
      `SELECT date_trunc('day', created_at)::date AS day,
              SUM(amount_usdc_wei::numeric) FILTER (WHERE event_type = 'CREDIT_FROM_CUSTODIAN') AS credits,
              SUM(amount_usdc_wei::numeric) FILTER (WHERE event_type = 'DEBIT_MEMBER_ONRAIL')   AS debits,
              MAX(pool_balance_after_wei::numeric)                                              AS ending_balance
         FROM reserve_pool_ledger
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY 1 ORDER BY 1 DESC`,
    );
  }

  @Post('export')
  @RequireRole('finance')
  async export(@Body() body: ExportBody, @Req() _req: AdminAuthedReq) {
    const job: ExportJob = {
      jobId: randomUUID(),
      report: body.report,
      status: 'RUNNING',
      createdAt: new Date(),
    };
    this.jobs.set(job.jobId, job);
    this.runExport(job, body).catch((err) => {
      job.status = 'FAILED';
      job.error = (err as Error).message;
      job.completedAt = new Date();
    });
    return { jobId: job.jobId };
  }

  @Get('export/:jobId/status')
  @RequireRole('finance')
  status(@Param('jobId') jobId: string) {
    const j = this.jobs.get(jobId);
    if (!j) throw new NotFoundException('Job not found');
    return {
      jobId: j.jobId,
      status: j.status,
      report: j.report,
      rowCount: j.rows?.length ?? 0,
      error: j.error,
      downloadUrl: j.status === 'DONE' ? `/admin/reports/export/${j.jobId}/download` : null,
    };
  }

  @Get('export/:jobId/download')
  @RequireRole('finance')
  download(@Param('jobId') jobId: string) {
    const j = this.jobs.get(jobId);
    if (!j || j.status !== 'DONE') throw new NotFoundException('Job not ready');
    return { rows: j.rows ?? [] };
  }

  private async runExport(job: ExportJob, body: ExportBody): Promise<void> {
    let rows: unknown[];
    switch (body.report) {
      case 'daily-volume':
        rows = await this.dailyVolume(body.from, body.to);
        break;
      case 'settlement-rates':
        rows = await this.settlementRates();
        break;
      case 'fx-rates':
        rows = await this.fxRates();
        break;
    }
    job.rows = rows;
    job.status = 'DONE';
    job.completedAt = new Date();
  }
}
