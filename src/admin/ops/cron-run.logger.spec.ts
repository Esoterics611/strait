import { CronRunLogger } from './cron-run.logger';

class FakeDS {
  queries: Array<{ sql: string; params?: unknown[] }> = [];
  failNext = false;
  async query(sql: string, params?: unknown[]): Promise<unknown[]> {
    this.queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (this.failNext) {
      this.failNext = false;
      throw new Error('db down');
    }
    return [];
  }
}

describe('CronRunLogger', () => {
  let ds: FakeDS;
  let logger: CronRunLogger;

  beforeEach(() => {
    ds = new FakeDS();
    logger = new CronRunLogger(ds as never);
  });

  it('records success when the wrapped work resolves', async () => {
    let called = false;
    await logger.wrap('demo', async () => { called = true; });
    expect(called).toBe(true);
    expect(ds.queries[0].sql).toMatch(/cron_runs.*'OK'/);
    expect(ds.queries[0].params?.[0]).toBe('demo');
  });

  it('records failure when the wrapped work rejects and rethrows', async () => {
    await expect(
      logger.wrap('demo', async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    expect(ds.queries[0].sql).toMatch(/cron_runs.*'FAIL'/);
    expect(ds.queries[0].params?.[1]).toBe('boom');
  });

  it('does not crash when the cron_runs upsert itself fails', async () => {
    ds.failNext = true;
    await expect(logger.wrap('demo', async () => { /* ok */ })).resolves.toBeUndefined();
  });

  it('long error messages are truncated to 1000 chars', async () => {
    const long = 'x'.repeat(1500);
    await expect(
      logger.wrap('demo', async () => { throw new Error(long); }),
    ).rejects.toThrow();
    const stored = ds.queries[0].params?.[1] as string;
    expect(stored.length).toBe(1000);
  });
});
