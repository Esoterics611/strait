import { IdempotencyService } from './idempotency.service';
import { SourceType } from '@common/enums';

describe('IdempotencyService', () => {
  const svc = new IdempotencyService();

  it('produces a 64-char lowercase hex string', () => {
    const key = svc.buildKey('member-1', SourceType.MESH, 'ref-1');
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same inputs produce the same key', () => {
    const a = svc.buildKey('member-1', SourceType.MESH, 'ref-1');
    const b = svc.buildKey('member-1', SourceType.MESH, 'ref-1');
    expect(a).toBe(b);
  });

  it('prevents delimiter-collision: (a, bc) ≠ (ab, c)', () => {
    const k1 = svc.buildKey('a', SourceType.MESH, 'bc');
    const k2 = svc.buildKey('ab', SourceType.MESH, 'c');
    expect(k1).not.toBe(k2);
  });

  it('different sourceType yields different key', () => {
    const k1 = svc.buildKey('m', SourceType.MESH, 'r');
    const k2 = svc.buildKey('m', SourceType.ONRAMP_RAPYD, 'r');
    expect(k1).not.toBe(k2);
  });
});
