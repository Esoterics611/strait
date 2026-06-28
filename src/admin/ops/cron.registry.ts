import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { BusinessLogger } from '@common/logging';
import { ApprovalExpiryCron } from '../approvals/approval-expiry.cron';

/**
 * Registry of every scheduled cron the platform runs, plus a `runNow(name)`
 * helper. Used by `POST /admin/crons/:name/run-now` for ops recovery.
 * Each cron exposes a static `NAME` and a public `run()` / `sweep()` method.
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

    this.entries = [
      approval && {
        name: ApprovalExpiryCron.NAME,
        description: 'Expire stale pending approvals (24h TTL)',
        schedule: 'every 10 minutes',
        invoke: () => approval.sweep(),
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
