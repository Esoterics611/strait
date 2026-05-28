import { MemberFreezeChecker, rethrowFrozenAs423 } from './member-freeze.guard';
import { MemberFrozenError } from '@common/errors';
import { HttpException } from '@nestjs/common';

class FakeDS {
  rows: Array<{ member_id: string; is_frozen: boolean }> = [];
  async query(_sql: string, params?: unknown[]): Promise<unknown[]> {
    const r = this.rows.find((x) => x.member_id === params?.[0]);
    return r ? [{ is_frozen: r.is_frozen }] : [];
  }
}

describe('MemberFreezeChecker', () => {
  it('throws when member is frozen', async () => {
    const ds = new FakeDS();
    ds.rows.push({ member_id: 'm1', is_frozen: true });
    const checker = new MemberFreezeChecker(ds as never);
    await expect(checker.assertNotFrozen('m1')).rejects.toBeInstanceOf(MemberFrozenError);
  });

  it('passes when member is not frozen', async () => {
    const ds = new FakeDS();
    ds.rows.push({ member_id: 'm1', is_frozen: false });
    const checker = new MemberFreezeChecker(ds as never);
    await expect(checker.assertNotFrozen('m1')).resolves.toBeUndefined();
  });

  it('passes silently for unknown members (path layers handle 404)', async () => {
    const ds = new FakeDS();
    const checker = new MemberFreezeChecker(ds as never);
    await expect(checker.assertNotFrozen('missing')).resolves.toBeUndefined();
  });

  it('rethrowFrozenAs423 maps MemberFrozenError → HTTP 423', () => {
    try {
      rethrowFrozenAs423(new MemberFrozenError('m1'));
      fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(423);
    }
  });

  it('rethrowFrozenAs423 passes through unrelated errors', () => {
    try {
      rethrowFrozenAs423(new Error('boom'));
      fail('should throw');
    } catch (e) {
      expect((e as Error).message).toBe('boom');
    }
  });
});
