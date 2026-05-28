import { DataSource } from 'typeorm';
import { newDataSource, seedMember, cleanupMember } from './db';
import { DbService } from '../../src/database/db.service';
import { ShadowLedgerService } from '../../src/ledger/shadow-ledger.service';
import { SourceType } from '../../src/common/enums';
import { InsufficientBalanceError } from '../../src/common/errors';
import { randomUUID } from 'crypto';

// The shadow ledger's correctness model is Postgres SERIALIZABLE + a
// per-member `SELECT ... FOR UPDATE`. This oracle drives the REAL service
// (real DbService, real DataSource, real Postgres) under contention and
// asserts the end-state is exactly correct: no lost updates, append-only one
// row per effective op. The invariant under test is end-state correctness,
// not abort-freedom — Postgres may still raise 40001 under heavy single-row
// contention beyond DbService's single retry, so each op is wrapped in a
// bounded retry to keep the oracle deterministic.
const noEvents = { emit: (): void => undefined } as unknown as never;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const code =
        (err as { code?: string })?.code ??
        (err as { driverError?: { code?: string } })?.driverError?.code;
      // 40001 serialization_failure, 23505 unique_violation (idempotency race)
      if ((code === '40001' || code === '23505') && attempt < 12) {
        continue;
      }
      throw err;
    }
  }
}

describe('INTEGRATION: shadow ledger SERIALIZABLE credit/debit under concurrency', () => {
  let ds: DataSource;
  let ledger: ShadowLedgerService;
  let memberId: string;

  beforeAll(async () => {
    ds = newDataSource();
    await ds.initialize();
    ledger = new ShadowLedgerService(
      new DbService(ds as never),
      noEvents as never,
    );
  });
  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    ({ memberId } = await seedMember(ds));
  });
  afterEach(async () => {
    await cleanupMember(ds, memberId);
  });

  it('N concurrent credits lose no updates (balance == sum; one row each)', async () => {
    const N = 8;
    const unit = 1_000_000n;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        withRetry(() =>
          ledger.creditUsdc(
            memberId,
            unit,
            SourceType.MESH,
            `ref-${i}-${randomUUID()}`,
            `idem-credit-${i}-${memberId}`,
          ),
        ),
      ),
    );
    expect(await ledger.getBalance(memberId)).toBe(unit * BigInt(N));
    const rows = await ds.query<{ c: number }[]>(
      `SELECT count(*)::int AS c FROM usdc_transactions
        WHERE member_id = $1 AND direction = 'CREDIT'`,
      [memberId],
    );
    expect(rows[0].c).toBe(N);
  });

  it('idempotency key collapses a repeated credit to a single row', async () => {
    const unit = 5_000_000n;
    const key = `idem-dup-${memberId}`;
    const a = await ledger.creditUsdc(memberId, unit, SourceType.MESH, 'r1', key);
    const b = await ledger.creditUsdc(memberId, unit, SourceType.MESH, 'r2', key);
    expect(b).toBe(a); // same tx_id returned on the dedup short-circuit
    expect(await ledger.getBalance(memberId)).toBe(unit);
  });

  it('concurrent debits never over-draw; an over-debit throws InsufficientBalanceError', async () => {
    const unit = 1_000_000n;
    await ledger.creditUsdc(
      memberId,
      unit * 10n,
      SourceType.MESH,
      'seed',
      `idem-seed-${memberId}`,
    );
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        withRetry(() =>
          ledger.debitUsdc(
            memberId,
            unit,
            randomUUID(),
            `idem-debit-${i}-${memberId}`,
          ),
        ),
      ),
    );
    expect(await ledger.getBalance(memberId)).toBe(0n);
    await expect(
      ledger.debitUsdc(memberId, unit, randomUUID(), `idem-od-${memberId}`),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);
  });
});
