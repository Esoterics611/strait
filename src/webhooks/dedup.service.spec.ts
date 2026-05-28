import { WebhookDeduplicationService } from './dedup.service';
import { DataSource } from 'typeorm';

// These tests exercise the ON CONFLICT dedup semantics.
// For full concurrency coverage (Promise.all race) run against a real PostgreSQL
// instance (docker-compose up postgres). The mock below validates the surface contract.

function makeDataSource(rowCount: number) {
  return {
    query: jest.fn().mockResolvedValue({ rowCount }),
  } as unknown as DataSource;
}

describe('WebhookDeduplicationService — unit', () => {
  it('isProcessed returns true when a matching row exists', async () => {
    const ds = {
      query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    } as unknown as DataSource;
    const svc = new WebhookDeduplicationService(ds);
    expect(await svc.isProcessed('BRIDGE', 'evt-1')).toBe(true);
  });

  it('isProcessed returns false when no matching row', async () => {
    const ds = {
      query: jest.fn().mockResolvedValue([]),
    } as unknown as DataSource;
    const svc = new WebhookDeduplicationService(ds);
    expect(await svc.isProcessed('BRIDGE', 'evt-1')).toBe(false);
  });

  it('markProcessed returns true on first insert (rowCount=1)', async () => {
    const svc = new WebhookDeduplicationService(makeDataSource(1));
    expect(await svc.markProcessed('BRIDGE', 'evt-1')).toBe(true);
  });

  it('markProcessed returns false on conflict (rowCount=0)', async () => {
    const svc = new WebhookDeduplicationService(makeDataSource(0));
    expect(await svc.markProcessed('BRIDGE', 'evt-1')).toBe(false);
  });

  it('concurrent markProcessed — exactly one wins (simulated)', async () => {
    // First call wins (rowCount=1), second loses (rowCount=0).
    const ds = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 0 }),
    } as unknown as DataSource;
    const svc = new WebhookDeduplicationService(ds);
    const [r1, r2] = await Promise.all([
      svc.markProcessed('BRIDGE', 'evt-1'),
      svc.markProcessed('BRIDGE', 'evt-1'),
    ]);
    const trueCount = [r1, r2].filter(Boolean).length;
    expect(trueCount).toBe(1);
  });
});
