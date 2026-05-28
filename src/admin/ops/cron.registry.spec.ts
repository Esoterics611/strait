import { NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApprovalExpiryCron } from '../approvals/approval-expiry.cron';
import { StaleDispatchCron } from '../../bridge/stale-dispatch.cron';
import { OnRampTimeoutCron } from '../../onramp/onramp-timeout.cron';
import { IlsCollectionTimeoutCron } from '../../path-c/ils-collection-timeout.cron';
import { LowBalanceAlertCron } from '../../path-c/low-balance.cron';
import { CronRegistry } from './cron.registry';

describe('CronRegistry', () => {
  // Fake cron instances that record whether they were invoked.
  let approvalCalls = 0;
  let staleCalls = 0;
  let onrampCalls = 0;
  let ilsCalls = 0;
  let lowCalls = 0;

  const instances = new Map<unknown, unknown>([
    [ApprovalExpiryCron, { sweep: async () => { approvalCalls++; } }],
    [StaleDispatchCron, { run: async () => { staleCalls++; } }],
    [OnRampTimeoutCron, { run: async () => { onrampCalls++; } }],
    [IlsCollectionTimeoutCron, { run: async () => { ilsCalls++; } }],
    [LowBalanceAlertCron, { run: async () => { lowCalls++; } }],
  ]);

  const moduleRef = {
    get: (token: unknown) => {
      const inst = instances.get(token);
      if (!inst) throw new Error(`not found: ${(token as { name?: string }).name ?? token}`);
      return inst;
    },
  } as unknown as ModuleRef;

  beforeEach(() => {
    approvalCalls = staleCalls = onrampCalls = ilsCalls = lowCalls = 0;
  });

  it('list returns one entry per registered cron', () => {
    const reg = new CronRegistry(moduleRef);
    reg.onModuleInit();
    const names = reg.list().map((c) => c.name);
    expect(names).toContain(ApprovalExpiryCron.NAME);
    expect(names).toContain(StaleDispatchCron.NAME);
    expect(names).toContain(OnRampTimeoutCron.NAME);
    expect(names).toContain(IlsCollectionTimeoutCron.NAME);
    expect(names).toContain(LowBalanceAlertCron.NAME);
  });

  it('runNow invokes the matching cron', async () => {
    const reg = new CronRegistry(moduleRef);
    reg.onModuleInit();
    await reg.runNow(StaleDispatchCron.NAME);
    expect(staleCalls).toBe(1);
    await reg.runNow(LowBalanceAlertCron.NAME);
    expect(lowCalls).toBe(1);
  });

  it('runNow throws NotFoundException for unknown crons', async () => {
    const reg = new CronRegistry(moduleRef);
    reg.onModuleInit();
    await expect(reg.runNow('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('skips crons not available in the DI container', () => {
    const partialModuleRef = {
      get: (token: unknown) => {
        if (token === StaleDispatchCron || token === ApprovalExpiryCron) {
          throw new Error('not available');
        }
        return instances.get(token);
      },
    } as unknown as ModuleRef;
    const reg = new CronRegistry(partialModuleRef);
    reg.onModuleInit();
    const names = reg.list().map((c) => c.name);
    expect(names).not.toContain(StaleDispatchCron.NAME);
    expect(names).not.toContain(ApprovalExpiryCron.NAME);
    expect(names).toContain(LowBalanceAlertCron.NAME);
  });
});
