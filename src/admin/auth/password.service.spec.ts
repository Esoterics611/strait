import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hash/verify round-trips', async () => {
    const hash = await svc.hash('correct-horse-battery-staple');
    expect(await svc.verify('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('rejects wrong passwords', async () => {
    const hash = await svc.hash('p@ssw0rd');
    expect(await svc.verify('p@SSw0rd', hash)).toBe(false);
    expect(await svc.verify('', hash)).toBe(false);
  });

  it('rejects malformed hashes', async () => {
    expect(await svc.verify('any', 'garbage')).toBe(false);
    expect(await svc.verify('any', 's2$abc$def')).toBe(false);
  });

  it('produces unique salts per call', async () => {
    const a = await svc.hash('same-password');
    const b = await svc.hash('same-password');
    expect(a).not.toEqual(b);
  });
});
