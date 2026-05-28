import { TotpService } from './totp.service';
import { randomBytes, createHmac } from 'crypto';

describe('TotpService', () => {
  const svc = new TotpService();
  const key = randomBytes(32);

  it('generates a base32 secret + otpauth url', () => {
    const { base32 } = svc.generateSecret();
    expect(base32).toMatch(/^[A-Z2-7]+$/);
    const url = svc.otpauthUrl(base32, 'op@example.com');
    expect(url.startsWith('otpauth://totp/')).toBe(true);
    expect(url).toContain(`secret=${base32}`);
  });

  it('encryptSecret + decryptSecret round-trips', () => {
    const raw = randomBytes(20);
    const enc = svc.encryptSecret(raw, key);
    const dec = svc.decryptSecret(enc, key);
    expect(dec.equals(raw)).toBe(true);
  });

  it('rejects tampered ciphertext', () => {
    const raw = randomBytes(20);
    const enc = svc.encryptSecret(raw, key);
    enc[40] = enc[40] ^ 0xff;
    expect(() => svc.decryptSecret(enc, key)).toThrow();
  });

  it('verify accepts a freshly-generated code', () => {
    const raw = randomBytes(20);
    // Build the expected current code using the same algorithm.
    const counter = Math.floor(Date.now() / 1000 / 30);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const hmac = createHmac('sha1', raw).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code =
      (((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff)) %
      1_000_000;
    expect(svc.verify(raw, String(code).padStart(6, '0'))).toBe(true);
  });

  it('rejects clearly wrong codes', () => {
    const raw = randomBytes(20);
    expect(svc.verify(raw, '000000')).toBe(false);
    expect(svc.verify(raw, 'not-numeric')).toBe(false);
  });
});
