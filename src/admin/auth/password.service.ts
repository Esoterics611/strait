import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 64;
const SALT_LEN = 16;
const VERSION = 's1';

/**
 * Password hashing via node:crypto scrypt (memory-hard, no native deps).
 * Hash format: `s1$<salt_hex>$<hash_hex>`.
 */
@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    const salt = randomBytes(SALT_LEN);
    const hash = await scryptAsync(plain, salt, KEY_LEN);
    return `${VERSION}$${salt.toString('hex')}$${hash.toString('hex')}`;
  }

  async verify(plain: string, encoded: string): Promise<boolean> {
    const parts = encoded.split('$');
    if (parts.length !== 3 || parts[0] !== VERSION) return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const got = await scryptAsync(plain, salt, expected.length);
    return got.length === expected.length && timingSafeEqual(got, expected);
  }
}
