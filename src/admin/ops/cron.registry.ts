import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { BusinessLogger } from '@common/logging';
import { ApprovalExpiryCron } from '../approvals/approval-expiry.cron';
import { StaleDispatchCron } from '../../bridge/stale-dispatch.cron';
import { OnRampTimeoutCron } from '../../onramp/onramp-timeout.cron';
import { IlsCollectionTimeoutCron } from '../../path-c/ils-collection-timeout.cron';
import { LowBalanceAlertCron } from '../../path-c/low-balance.cron';

/**
 * Registry of every scheduled cron the platform runs, plus a `runNow(name)`
 * helper. Used by `POST /admin/crons/:name/run-now` for ops recovery and by
 * tests. Each cron exposes a static `NAME` and a public `run()` (or `sweep()`)
 * method that the scheduled `@Cron` method delegates to.
 *
 * Uses ModuleRef.get to avoid forcing every cron-owning module to export its
 * cron — keeps the DI graph local while still giving us a one-stop registry.
 */
@Injectable()
export class CronRegistry implements OnModuleInit {
  private readonly blog = new BusinessLogger('CronRegistry');
  private entries: Array<{
    name: string;
    description: string;
    schedule: string;
    invoke: () => Promise<void>;
  }> = [];

  constructor(private readonly moduleRef: ModuleRef) {}

  onModuleInit(): void {
    const approval = this.tryGet(ApprovalExpiryCron);
    const stale = this.tryGet(StaleDispatchCron);
    const onramp = this.tryGet(OnRampTimeoutCron);
    const ilsTimeout = this.tryGet(IlsCollectionTimeoutCron);
    const lowBalance = this.tryGet(LowBalanceAlertCron);

    this.entries = [
      approval && {
        name: ApprovalExpiryCron.NAME,
        description: 'Expire stale pending approvals (24h TTL)',
        schedule: 'every 10 minutes',
        invoke: () => approval.sweep(),
      },
      stale && {
        name: StaleDispatchCron.NAME,
        description: 'Alert on Bridge dispatches stuck > 30 min',
        schedule: 'every 5 minutes',
        invoke: () => stale.run(),
      },
      onramp && {
        name: OnRampTimeoutCron.NAME,
        description: 'Fail ILS_PENDING_ONRAMP rows older than 4h',
        schedule: 'every 5 minutes',
        invoke: () => onramp.run(),
      },
      ilsTimeout && {
        name: IlsCollectionTimeoutCron.NAME,
        description: 'Fail ILS_PENDING_COLLECTION rows older than 72h (Path C)',
        schedule: 'every 30 minutes',
        invoke: () => ilsTimeout.run(),
      },
      lowBalance && {
        name: LowBalanceAlertCron.NAME,
        description: 'Emit LOW_BALANCE_ALERT when pool < 2× floor (Path C)',
        schedule: 'every minute',
        invoke: () => lowBalance.run(),
      },
    ].filter(Boolean) as typeof this.entries;
  }

  private tryGet<T>(token: { new (...args: never[]): T }): T | undefined {
    try {
      return this.moduleRef.get(token, { strict: false });
    } catch (err) {
      this.blog.warn('tryGet', {
        detail: { token: token.name, outcome: 'not_available' },
        error: err,
      });
      return undefined;
    }
  }

  list(): Array<{ name: string; description: string; schedule: string }> {
    return this.entries.map(({ name, description, schedule }) => ({
      name,
      description,
      schedule,
    }));
  }

  has(name: string): boolean {
    return this.entries.some((e) => e.name === name);
  }

  async runNow(name: string): Promise<void> {
    const entry = this.entries.find((e) => e.name === name);
    if (!entry) throw new NotFoundException(`Cron ${name} not found`);
    await entry.invoke();
  }
}
