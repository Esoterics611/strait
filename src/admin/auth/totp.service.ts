import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

const STEP_SECONDS = 30;
const DIGITS = 6;
const TOLERANCE = 1; // accept ±1 step (~30s before/after) — clock skew tolerance

/**
 * RFC 6238 TOTP (HMAC-SHA1) — 30s step, 6 digits, ±1 step tolerance.
 * Secret stored in admin_users.mfa_secret_enc as AES-GCM ciphertext.
 */
@Injectable()
export class TotpService {
  /** Generate a fresh random 20-byte (base32-encoded) secret for enrollment. */
  generateSecret(): { base32: string; raw: Buffer } {
    const raw = randomBytes(20);
    return { raw, base32: base32Encode(raw) };
  }

  /** otpauth:// URL for authenticator app QR provisioning. */
  otpauthUrl(secretBase32: string, accountEmail: string, issuer = 'LiraBridge'): string {
    const params = new URLSearchParams({
      secret: secretBase32,
      issuer,
      algorithm: 'SHA1',
      digits: String(DIGITS),
      period: String(STEP_SECONDS),
    });
    return `otpauth://totp/${encodeURIComponent(`${issuer}:${accountEmail}`)}?${params.toString()}`;
  }

  /** Verify a 6-digit code against the secret (±1 step tolerance). */
  verify(secret: Buffer, code: string): boolean {
    const trimmed = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(trimmed)) return false;
    const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
    for (let i = -TOLERANCE; i <= TOLERANCE; i++) {
      if (generateAt(secret, counter + i) === trimmed) return true;
    }
    return false;
  }

  /** Encrypt the raw secret for storage. */
  encryptSecret(rawSecret: Buffer, key: Buffer): Buffer {
    if (key.length !== 32) throw new Error('ADMIN_MFA_KEY must be 32 bytes (64 hex chars)');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(rawSecret), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]);
  }

  /** Decrypt the stored secret for verification. */
  decryptSecret(blob: Buffer, key: Buffer): Buffer {
    if (key.length !== 32) throw new Error('ADMIN_MFA_KEY must be 32 bytes (64 hex chars)');
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const enc = blob.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]);
  }
}

function generateAt(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(DIGITS, '0');
}

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}
