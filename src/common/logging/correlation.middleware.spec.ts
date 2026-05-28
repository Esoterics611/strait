import { CorrelationMiddleware } from './correlation.middleware';
import {
  getCorrelationId,
  bindCorrelationId,
  runWithCorrelation,
} from './correlation';
import { Request, Response } from 'express';

function makeReq(headers: Record<string, string | string[]> = {}): Request {
  return { headers } as unknown as Request;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('CorrelationMiddleware', () => {
  const mw = new CorrelationMiddleware();

  it('honours an inbound x-correlation-id header for the downstream chain', () => {
    let seen: string | undefined;
    mw.use(makeReq({ 'x-correlation-id': 'abc-123' }), {} as Response, () => {
      seen = getCorrelationId();
    });
    expect(seen).toBe('abc-123');
  });

  it('generates a fresh UUID when no header is present', () => {
    let seen: string | undefined;
    mw.use(makeReq(), {} as Response, () => {
      seen = getCorrelationId();
    });
    expect(seen).toMatch(UUID_RE);
  });

  it('treats a blank header as absent and generates a UUID', () => {
    let seen: string | undefined;
    mw.use(makeReq({ 'x-correlation-id': '   ' }), {} as Response, () => {
      seen = getCorrelationId();
    });
    expect(seen).toMatch(UUID_RE);
  });

  it('does not leak a correlationId outside the request scope', () => {
    mw.use(makeReq({ 'x-correlation-id': 'scoped' }), {} as Response, () => {
      // inside scope
    });
    expect(getCorrelationId()).toBeUndefined();
  });

  it('bindCorrelationId rebinds the active context (webhook event-id seam)', () => {
    let before: string | undefined;
    let after: string | undefined;
    runWithCorrelation('entry-uuid', () => {
      before = getCorrelationId();
      bindCorrelationId('evt_real_id');
      after = getCorrelationId();
    });
    expect(before).toBe('entry-uuid');
    expect(after).toBe('evt_real_id');
  });
});
