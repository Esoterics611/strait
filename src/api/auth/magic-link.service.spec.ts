import { MagicLinkService } from './magic-link.service';
import { DataSource } from 'typeorm';
import { UnauthorizedException } from '@nestjs/common';

function makeDs(rows: unknown[]): DataSource {
  const fn = jest.fn();
  rows.forEach((r) => fn.mockResolvedValueOnce(r));
  return { query: fn } as unknown as DataSource;
}

describe('MagicLinkService.issue', () => {
  it('issues a token for a known email and persists the hash', async () => {
    const ds = makeDs([
      [{ member_id: 'm-1' }], // SELECT member by lower(email)
      undefined,              // INSERT
    ]);
    const svc = new MagicLinkService(ds);
    const res = await svc.issue('Foo@Example.com');
    expect(res.delivered).toBe(true);
    expect(typeof res.token).toBe('string');
    expect(res.token.length).toBeGreaterThan(30);

    const insertCall = (ds.query as jest.Mock).mock.calls[1];
    expect(insertCall[0]).toMatch(/INSERT INTO magic_link_tokens/);
    expect(insertCall[1][0]).toBe('foo@example.com'); // normalized
    expect(insertCall[1][2]).toBe('m-1'); // member id
  });

  it('issues a stub token for unknown email (anti-enumeration)', async () => {
    const ds = makeDs([[], undefined]);
    const svc = new MagicLinkService(ds);
    const res = await svc.issue('nobody@example.com');
    expect(res.delivered).toBe(true);
    const insertCall = (ds.query as jest.Mock).mock.calls[1];
    expect(insertCall[1][2]).toBeNull(); // no member_id
  });

  it('rejects invalid email shape', async () => {
    const svc = new MagicLinkService(makeDs([]));
    await expect(svc.issue('not-an-email')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('MagicLinkService.verify', () => {
  it('returns memberId on first verify (single-use UPDATE…RETURNING)', async () => {
    const ds = makeDs([
      // UPDATE … RETURNING — row found
      [{ token_id: 't-1', member_id: 'm-2', email: 'a@b.com' }],
    ]);
    const svc = new MagicLinkService(ds);
    const res = await svc.verify('a'.repeat(40));
    expect(res.memberId).toBe('m-2');
    expect(res.email).toBe('a@b.com');
  });

  it('rejects when no row matched (expired or already consumed)', async () => {
    const ds = makeDs([[]]);
    const svc = new MagicLinkService(ds);
    await expect(svc.verify('b'.repeat(40))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when token mapped to unknown email (no member)', async () => {
    const ds = makeDs([
      [{ token_id: 't-1', member_id: null, email: 'nobody@x' }],
    ]);
    const svc = new MagicLinkService(ds);
    await expect(svc.verify('c'.repeat(40))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects very short tokens before any DB roundtrip', async () => {
    const ds = makeDs([]);
    const svc = new MagicLinkService(ds);
    await expect(svc.verify('short')).rejects.toBeInstanceOf(UnauthorizedException);
    expect((ds.query as jest.Mock)).not.toHaveBeenCalled();
  });
});
