import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PendingApprovalRepository } from './pending-approval.repository';
import { CronRunLogger } from '../ops/cron-run.logger';
import { BusinessLogger } from '@common/logging';

@Injectable()
export class ApprovalExpiryCron {
  static readonly NAME = 'approval_expiry';
  private readonly blog = new BusinessLogger('ApprovalExpiryCron');

  constructor(
    private readonly approvals: PendingApprovalRepository,
    private readonly runs: CronRunLogger,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep(): Promise<void> {
    await this.runs.wrap(ApprovalExpiryCron.NAME, async () => {
      const n = await this.approvals.expireStale();
      if (n > 0) {
        this.blog.info('expireStale', { detail: { count: n } });
      }
    });
  }
}
