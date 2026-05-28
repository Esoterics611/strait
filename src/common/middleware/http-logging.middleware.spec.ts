import { HttpLoggingMiddleware } from './http-logging.middleware';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { EventEmitter } from 'events';

function makeConfig(nodeEnv: string): ConfigService {
  return { get: (_key: string) => nodeEnv } as unknown as ConfigService;
}

function makeRes(statusCode = 200): Response & EventEmitter {
  const emitter = new EventEmitter() as Response & EventEmitter;
  (emitter as any).statusCode = statusCode;
  return emitter;
}

function makeReq(method = 'GET', url = '/api/health'): Request {
  return { method, originalUrl: url } as Request;
}

describe('HttpLoggingMiddleware', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('logs after response finishes in dev mode', () => {
    const mw = new HttpLoggingMiddleware(makeConfig('development'));
    const res = makeRes(200);
    const next = jest.fn();

    mw.use(makeReq(), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled(); // not yet — response not finished

    res.emit('finish');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const msg: string = logSpy.mock.calls[0][0];
    expect(msg).toContain('GET');
    expect(msg).toContain('/api/health');
    expect(msg).toContain('200');
    expect(msg).not.toContain('"ts"'); // dev format is not JSON
  });

  it('logs structured JSON in production mode', () => {
    const mw = new HttpLoggingMiddleware(makeConfig('production'));
    const res = makeRes(404);
    mw.use(makeReq('POST', '/api/payments'), res, jest.fn());
    res.emit('finish');

    const raw: string = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(raw);
    expect(parsed.method).toBe('POST');
    expect(parsed.path).toBe('/api/payments');
    expect(parsed.status).toBe(404);
    expect(typeof parsed.ms).toBe('number');
    expect(typeof parsed.ts).toBe('string');
  });

  it('does not log before finish event', () => {
    const mw = new HttpLoggingMiddleware(makeConfig('development'));
    mw.use(makeReq(), makeRes(), jest.fn());
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('calls next() immediately', () => {
    const mw = new HttpLoggingMiddleware(makeConfig('development'));
    const next = jest.fn();
    mw.use(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
