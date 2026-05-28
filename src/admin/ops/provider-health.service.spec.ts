import { ProviderHealthService } from './provider-health.service';

class FakeDS {
  queries: Array<{ sql: string; params?: unknown[] }> = [];
  async query(sql: string, params?: unknown[]): Promise<unknown[]> {
    this.queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    return [];
  }
}

describe('ProviderHealthService', () => {
  let ds: FakeDS;
  let svc: ProviderHealthService;

  beforeEach(() => {
    ds = new FakeDS();
    svc = new ProviderHealthService(ds as never);
  });

  it('records success on a happy path call', async () => {
    const out = await svc.instrument('BRIDGE', async () => 42);
    expect(out).toBe(42);
    expect(ds.queries[0].sql).toMatch(/last_success_at/);
    expect(ds.queries[0].params?.[0]).toBe('BRIDGE');
    expect(Number(ds.queries[0].params?.[1])).toBeGreaterThanOrEqual(0);
  });

  it('records failure and rethrows', async () => {
    await expect(
      svc.instrument('RAPYD', async () => { throw new Error('downstream 502'); }),
    ).rejects.toThrow('downstream 502');
    expect(ds.queries[0].sql).toMatch(/last_error_at/);
    expect(ds.queries[0].params?.[1]).toBe('downstream 502');
  });

  it('recordSuccess + recordFailure work standalone', async () => {
    await svc.recordSuccess('MESH', 123);
    await svc.recordFailure('BOG', 'no-creds');
    expect(ds.queries[0].sql).toMatch(/last_success_at/);
    expect(ds.queries[1].sql).toMatch(/last_error_at/);
  });
});
