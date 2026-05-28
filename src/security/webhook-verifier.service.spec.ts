import * as crypto from 'crypto';
import { WebhookVerifier } from './webhook-verifier.service';
import { RapydWebhookVerifier } from './rapyd-webhook-verifier.service';

describe('WebhookVerifier', () => {
  let verifier: WebhookVerifier;

  beforeEach(() => {
    verifier = new WebhookVerifier();
  });

  it('returns true for a correct payload and secret', () => {
    const secret = 'test-webhook-secret';
    const body = Buffer.from('{"event":"payment.success"}');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(verifier.verify('BRIDGE', body, sig, secret)).toBe(true);
  });

  it('returns false for a tampered payload', () => {
    const secret = 'test-webhook-secret';
    const body = Buffer.from('{"event":"payment.success"}');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const tampered = Buffer.from('{"event":"payment.tampered"}');
    expect(verifier.verify('BRIDGE', tampered, sig, secret)).toBe(false);
  });

  it('returns false for an incorrect signature', () => {
    const secret = 'test-webhook-secret';
    const body = Buffer.from('{"event":"payment.success"}');
    expect(verifier.verify('BRIDGE', body, 'a'.repeat(64), secret)).toBe(false);
  });

  it('returns false for a wrong secret', () => {
    const body = Buffer.from('{"event":"payment.success"}');
    const sig = crypto.createHmac('sha256', 'correct-secret').update(body).digest('hex');
    expect(verifier.verify('BRIDGE', body, sig, 'wrong-secret')).toBe(false);
  });

  it('calls crypto.timingSafeEqual (not ===)', () => {
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    const secret = 'test-secret';
    const body = Buffer.from('{"event":"test"}');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    verifier.verify('BRIDGE', body, sig, secret);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('works identically for MESH provider (mock-compatible)', () => {
    const secret = 'mesh-webhook-secret';
    const body = Buffer.from('{"type":"transfer.completed"}');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(verifier.verify('MESH', body, sig, secret)).toBe(true);
  });
});

describe('RapydWebhookVerifier', () => {
  let verifier: RapydWebhookVerifier;

  const makeRapydSig = (
    method: string,
    path: string,
    salt: string,
    timestamp: string,
    body: string,
    secret: string,
  ): string => {
    const toSign = method + path + salt + timestamp + body;
    return crypto.createHmac('sha256', secret).update(toSign, 'utf8').digest('base64');
  };

  beforeEach(() => {
    verifier = new RapydWebhookVerifier();
  });

  it('returns true for a correct Rapyd test vector', () => {
    const secret = 'rapyd_test_secret_key';
    const method = 'post';
    const path = '/webhooks/rapyd';
    const salt = 'abcd1234';
    const timestamp = '1620000000';
    const body = '{"type":"PAYMENT_SUCCEEDED"}';
    const sig = makeRapydSig(method, path, salt, timestamp, body, secret);
    expect(verifier.verify(method, path, salt, timestamp, body, sig, secret)).toBe(true);
  });

  it('returns false when the body is tampered', () => {
    const secret = 'rapyd_test_secret_key';
    const method = 'post';
    const path = '/webhooks/rapyd';
    const salt = 'abcd1234';
    const timestamp = '1620000000';
    const body = '{"type":"PAYMENT_SUCCEEDED"}';
    const sig = makeRapydSig(method, path, salt, timestamp, body, secret);
    expect(
      verifier.verify(method, path, salt, timestamp, '{"type":"TAMPERED"}', sig, secret),
    ).toBe(false);
  });

  it('returns false when the salt is tampered', () => {
    const secret = 'rapyd_test_secret_key';
    const method = 'post';
    const path = '/webhooks/rapyd';
    const salt = 'abcd1234';
    const timestamp = '1620000000';
    const body = '{"type":"PAYMENT_SUCCEEDED"}';
    const sig = makeRapydSig(method, path, salt, timestamp, body, secret);
    expect(verifier.verify(method, path, 'wrongsalt', timestamp, body, sig, secret)).toBe(false);
  });

  it('returns false when the timestamp is tampered', () => {
    const secret = 'rapyd_test_secret_key';
    const method = 'post';
    const path = '/webhooks/rapyd';
    const salt = 'abcd1234';
    const timestamp = '1620000000';
    const body = '{"type":"PAYMENT_SUCCEEDED"}';
    const sig = makeRapydSig(method, path, salt, timestamp, body, secret);
    expect(verifier.verify(method, path, salt, '9999999999', body, sig, secret)).toBe(false);
  });

  it('calls crypto.timingSafeEqual', () => {
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    const secret = 'rapyd_test_secret_key';
    const method = 'post';
    const path = '/webhooks/rapyd';
    const salt = 'abcd1234';
    const timestamp = '1620000000';
    const body = '{"type":"PAYMENT_SUCCEEDED"}';
    const sig = makeRapydSig(method, path, salt, timestamp, body, secret);
    verifier.verify(method, path, salt, timestamp, body, sig, secret);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
