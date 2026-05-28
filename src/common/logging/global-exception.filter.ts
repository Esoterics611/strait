import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { BusinessLogger } from './business-logger';

/**
 * Catch-all filter: logs EVERY unhandled exception as one structured line
 * (correlationId + txId from request context, error name/message, stack in
 * non-prod) before responding. It then reproduces Nest's DEFAULT HTTP
 * behaviour byte-for-byte — HttpException keeps its own status + response
 * body, anything else is a generic 500 — so API contracts are unchanged.
 * This is logging-only; it adds no new error semantics.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly blog = new BusinessLogger('UnhandledException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttp
      ? exception.getResponse()
      : { statusCode: status, message: 'Internal server error' };

    // 5xx = something the app did not anticipate → ERROR (investigate).
    // 4xx = a handled, expected rejection (auth/validation) → WARN.
    const level = status >= HttpStatus.INTERNAL_SERVER_ERROR ? 'error' : 'warn';
    this.blog[level]('unhandledException', {
      txId: txIdFromRequest(req),
      detail: {
        method: req?.method,
        path: req?.originalUrl,
        status,
      },
      error: exception,
    });

    res.status(status).json(body);
  }
}

function txIdFromRequest(req: Request | undefined): string | undefined {
  if (!req) return undefined;
  const fromParams = (req.params as Record<string, unknown> | undefined)?.[
    'txId'
  ];
  if (typeof fromParams === 'string') return fromParams;
  const body = req.body as Record<string, unknown> | undefined;
  const fromBody = body?.['txId'] ?? body?.['tx_id'];
  return typeof fromBody === 'string' ? fromBody : undefined;
}
