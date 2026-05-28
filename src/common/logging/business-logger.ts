import { Logger } from '@nestjs/common';
import { getCorrelationId } from './correlation';
import { isLogProduction } from './logging-config';

/**
 * Strict financial-app log levels:
 *  - ERROR : money could be wrong, a human must investigate
 *  - WARN  : unexpected but handled, no money at risk
 *  - LOG   : normal business operation completed
 *  - DEBUG : internal detail useful during active debugging
 */
export type BusinessLogLevel = 'ERROR' | 'WARN' | 'LOG' | 'DEBUG';

/** The fixed, machine-parseable envelope every structured log line follows. */
export interface BusinessLog {
  ts: string;
  level: BusinessLogLevel;
  module: string;
  operation: string;
  correlationId?: string;

  txId?: string;
  memberId?: string;
  recipientId?: string;
  sourceType?: string;

  detail: Record<string, unknown>;

  durationMs?: number;

  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/** Per-call business context. correlationId is auto-filled from AsyncLocalStorage. */
export interface BusinessLogFields {
  correlationId?: string;
  txId?: string;
  memberId?: string;
  recipientId?: string;
  sourceType?: string;
  detail?: Record<string, unknown>;
  durationMs?: number;
  error?: unknown;
}

function serializeError(err: unknown): BusinessLog['error'] | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      ...(isLogProduction() ? {} : { stack: err.stack }),
    };
  }
  return { name: 'NonError', message: String(err) };
}

/**
 * Thin wrapper around the NestJS Logger that enforces the BusinessLog
 * envelope. NOT a replacement for Logger — it delegates to one (NestJS owns
 * stdout transport). One per service:
 *
 *   private readonly blog = new BusinessLogger('BridgeService');
 *   this.blog.info('dispatchTransfer', { txId, memberId, detail: { rail } });
 *   this.blog.error('dispatchTransfer', { txId, error: err, durationMs });
 *
 * The serialized JSON is parseable by any aggregator (grep/jq now, Elastic /
 * Datadog later). No new dependencies.
 */
export class BusinessLogger {
  private readonly logger: Logger;

  constructor(private readonly module: string) {
    this.logger = new Logger(module);
  }

  info(operation: string, fields: BusinessLogFields = {}): void {
    this.emit('LOG', operation, fields);
  }

  warn(operation: string, fields: BusinessLogFields = {}): void {
    this.emit('WARN', operation, fields);
  }

  error(operation: string, fields: BusinessLogFields = {}): void {
    this.emit('ERROR', operation, fields);
  }

  debug(operation: string, fields: BusinessLogFields = {}): void {
    this.emit('DEBUG', operation, fields);
  }

  private emit(
    level: BusinessLogLevel,
    operation: string,
    fields: BusinessLogFields,
  ): void {
    const envelope: BusinessLog = {
      ts: new Date().toISOString(),
      level,
      module: this.module,
      operation,
      correlationId: fields.correlationId ?? getCorrelationId(),
      txId: fields.txId,
      memberId: fields.memberId,
      recipientId: fields.recipientId,
      sourceType: fields.sourceType,
      detail: fields.detail ?? {},
      durationMs: fields.durationMs,
      error: serializeError(fields.error),
    };

    // JSON.stringify drops undefined-valued keys, keeping the line tight.
    const line = JSON.stringify(envelope);

    switch (level) {
      case 'ERROR':
        this.logger.error(line);
        break;
      case 'WARN':
        this.logger.warn(line);
        break;
      case 'DEBUG':
        this.logger.debug(line);
        break;
      default:
        this.logger.log(line);
    }
  }
}
