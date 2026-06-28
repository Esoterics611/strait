import * as crypto from 'crypto';
import { WebhookVerifier } from './webhook-verifier.service';

describe('WebhookVerifier', () => {
  let verifier: WebhookVerifier;

  beforeEach(() => {
    verifier = new WebhookVerifier();
  });

  it('returns true for a correct payload and secret', () => {
    const secret = 'test-webhook-secret';
    const body = Buffer.from('{"event":"payment.success"}');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(verifier.verify('MESH', body, sig, secret)).toBe(true);
  });

  it('returns false for a tampered payload', () => {
    const secret = 'test-webhook-secret';
    const body = Buffer.from('{"event":"payment.success"}');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const tampered = Buffer.from('{"event":"payment.tampered"}');
    expect(verifier.verify('MESH', tampered, sig, secret)).toBe(false);
  });

  it('returns false for an incorrect signature', () => {
    const secret = 'test-webhook-secret';
    const body = Buffer.from('{"event":"payment.success"}');
    expect(verifier.verify('MESH', body, 'a'.repeat(64), secret)).toBe(false);
  });

  it('returns false for a wrong secret', () => {
    const body = Buffer.from('{"event":"payment.success"}');
    const sig = crypto.createHmac('sha256', 'correct-secret').update(body).digest('hex');
    expect(verifier.verify('MESH', body, sig, 'wrong-secret')).toBe(false);
  });

  it('calls crypto.timingSafeEqual (not ===)', () => {
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    const secret = 'test-secret';
    const body = Buffer.from('{"event":"test"}');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    verifier.verify('MESH', body, sig, secret);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('works for CUSTODIAL provider', () => {
    const secret = 'custodial-webhook-secret';
    const body = Buffer.from('{"type":"transfer.completed"}');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(verifier.verify('CUSTODIAL', body, sig, secret)).toBe(true);
  });
});
