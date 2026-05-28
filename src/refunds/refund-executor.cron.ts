import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BusinessLogger } from '@common/logging';
import { SourceType } from '@common/enums';
import { CronRunLogger } from '../admin/ops/cron-run.logger';
import { MetricsService } from '../observability/metrics/metrics.service';
import { RefundExecutorRepository } from './refund-executor.repository';
import { IRefundExecutor, RefundJobClaim } from './refund-executor.types';
import { PathAMeshRefundExecutor } from './path-a-mesh-refund.executor';
import { PathBRapydRefundExecutor } from './path-b-rapyd-refund.executor';
import { PathCWireRefundExecutor } from './path-c-wire-refund.executor';

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;

/**
 * Refund executor cron — every minute, claims up to BATCH_SIZE QUEUED jobs
 * whose `next_attempt_at` has elapsed, dispatches each to its path-specific
 * executor, and records the outcome. Race-safe via `FOR UPDATE SKIP LOCKED`
 * in `claimBatch` so multiple cron pods (future) coexist without double-work.
 *
 * Outcome handling:
 *   DONE    → markDone(externalRefundId)
 *   BLOCKED → markBlocked(reason)        — no retry, surfaced in admin UI.
 *   FAILED  → markFailedOrRequeue(...)   — exp-backoff up to MAX_ATTEMPTS.
 */
@Injectable()
export class RefundExecutorCron {
  static readonly NAME = 'refund_executor';
  private readonly blog = new BusinessLogger('RefundExecutorCron');
  private readonly executorsBySource: Map<SourceType, IRefundExecutor>;

  constructor(
    private readonly runs: CronRunLogger,
    private readonly metrics: MetricsService,
    private readonly repo: RefundExecutorRepository,
    private readonly pathA: PathAMeshRefundExecutor,
    private readonly pathB: PathBRapydRefundExecutor,
    private readonly pathC: PathCWireRefundExecutor,
  ) {
    this.executorsBySource = new Map<SourceType, IRefundExecutor>([
      [SourceType.MESH, pathA],
      [SourceType.ONRAMP_RAPYD, pathB],
      // BoG is stubbed at the adapter level; if a BoG refund ever lands the
      // adapter throws and the job will fail and surface to operations.
      [SourceType.ONRAMP_BOG, pathB],
      [SourceType.SELF_ONRAIL, pathC],
    ]);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async scan(): Promise<void> {
    await this.runs.wrap(RefundExecutorCron.NAME, () => this.run());
  }

  async run(): Promise<void> {
    const jobs = await this.repo.claimBatch(BATCH_SIZE) as (RefundJobClaim & {
      sourceType?: SourceType;
    })[];
    if (jobs.length === 0) return;

    for (const job of jobs) {
      const sourceType = job.sourceType;
      const startedAt = Date.now();
      const executor = sourceType ? this.executorsBySource.get(sourceType) : undefined;
      if (!executor) {
        await this.repo.markBlocked(
          job.jobId,
          `no_executor_for_source:${sourceType ?? 'unknown'}`,
        );
        this.metrics.refundJobOutcome(sourceType ?? 'unknown', 'BLOCKED');
        continue;
      }

      let result;
      try {
        result = await executor.execute(job);
      } catch (err) {
        const msg = (err as Error).message;
        const next = await this.repo.markFailedOrRequeue(
          job.jobId,
          `executor_threw: ${msg}`,
          job.attempts,
          MAX_ATTEMPTS,
        );
        this.metrics.refundJobOutcome(sourceType ?? 'unknown', next);
        this.metrics.recordRefundLatency(sourceType ?? 'unknown', Date.now() - startedAt);
        this.blog.error('execute', {
          txId: job.txId,
          detail: { jobId: job.jobId, sourceType, attempts: job.attempts },
          error: err,
        });
        continue;
      }

      switch (result.outcome) {
        case 'DONE':
          await this.repo.markDone(job.jobId, result.externalRefundId);
          this.metrics.refundJobOutcome(sourceType ?? 'unknown', 'DONE');
          break;
        case 'BLOCKED':
          await this.repo.markBlocked(job.jobId, result.blockedReason ?? 'blocked');
          this.metrics.refundJobOutcome(sourceType ?? 'unknown', 'BLOCKED');
          break;
        case 'FAILED':
          await this.repo.markFailedOrRequeue(
            job.jobId,
            result.errorMessage ?? 'failed',
            job.attempts,
            MAX_ATTEMPTS,
          );
          this.metrics.refundJobOutcome(sourceType ?? 'unknown', 'FAILED');
          break;
      }
      this.metrics.recordRefundLatency(sourceType ?? 'unknown', Date.now() - startedAt);
    }
  }
}
