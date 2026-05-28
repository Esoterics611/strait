import { Logger } from '@nestjs/common';
import { BusinessLogger } from './business-logger';
import { runWithCorrelation } from './correlation';
import { setLogProduction } from './logging-config';

type Captured = { level: 'log' | 'warn' | 'error' | 'debug'; line: string };

function spyAll(sink: Captured[]): jest.SpyInstance[] {
  return (['log', 'warn', 'error', 'debug'] as const).map((level) =>
    jest
      .spyOn(Logger.prototype, level)
      .mockImplementation((...args: unknown[]) => {
        sink.push({ level, line: String(args[0]) });
      }),
  );
}

describe('BusinessLogger', () => {
  let sink: Captured[];

  beforeEach(() => {
    sink = [];
    spyAll(sink);
    setLogProduction(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setLogProduction(false);
  });

  it('emits the fixed envelope as JSON with the required fields', () => {
    const blog = new BusinessLogger('BridgeService');
    blog.info('dispatchTransfer', {
      txId: 'tx-1',
      memberId: 'm-1',
      detail: { amount: '1000000', rail: 'rtp' },
      durationMs: 42,
    });

    expect(sink).toHaveLength(1);
    expect(sink[0].level).toBe('log');
    const env = JSON.parse(sink[0].line);
    expect(env.level).toBe('LOG');
    expect(env.module).toBe('BridgeService');
    expect(env.operation).toBe('dispatchTransfer');
    expect(env.txId).toBe('tx-1');
    expect(env.memberId).toBe('m-1');
    expect(env.detail).toEqual({ amount: '1000000', rail: 'rtp' });
    expect(env.durationMs).toBe(42);
    // ts is a valid ISO-8601 timestamp.
    expect(new Date(env.ts).toISOString()).toBe(env.ts);
  });

  it('routes each level to the matching NestJS Logger method', () => {
    const blog = new BusinessLogger('M');
    blog.info('op');
    blog.warn('op');
    blog.error('op');
    blog.debug('op');
    expect(sink.map((c) => c.level)).toEqual(['log', 'warn', 'error', 'debug']);
    expect(sink.map((c) => JSON.parse(c.line).level)).toEqual([
      'LOG',
      'WARN',
      'ERROR',
      'DEBUG',
    ]);
  });

  it('defaults detail to {} and omits undefined envelope keys', () => {
    new BusinessLogger('M').info('op');
    const env = JSON.parse(sink[0].line);
    expect(env.detail).toEqual({});
    expect('txId' in env).toBe(false);
    expect('memberId' in env).toBe(false);
    expect('durationMs' in env).toBe(false);
    expect('error' in env).toBe(false);
  });

  it('picks up correlationId from AsyncLocalStorage automatically', () => {
    runWithCorrelation('corr-123', () => {
      new BusinessLogger('M').info('op', { txId: 't' });
    });
    expect(JSON.parse(sink[0].line).correlationId).toBe('corr-123');
  });

  it('serializes errors to name+message and includes stack only in non-prod', () => {
    const err = new Error('boom');
    new BusinessLogger('M').error('op', { error: err });
    const env = JSON.parse(sink[0].line);
    expect(env.error.name).toBe('Error');
    expect(env.error.message).toBe('boom');
    expect(typeof env.error.stack).toBe('string');
  });

  it('omits the stack trace in production', () => {
    setLogProduction(true);
    new BusinessLogger('M').error('op', { error: new Error('boom') });
    const env = JSON.parse(sink[0].line);
    expect(env.error.name).toBe('Error');
    expect(env.error.message).toBe('boom');
    expect('stack' in env.error).toBe(false);
  });
});
