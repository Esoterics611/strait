import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { newCorrelationId, runWithCorrelation } from './correlation';

/**
 * Establishes the correlation context at request entry. Honours an inbound
 * `x-correlation-id` (set by callers / upstream services / load tests) so a
 * trace can span process hops; otherwise mints a fresh UUID. Webhook handlers
 * later rebind to the provider event id via `bindCorrelationId` once the body
 * is parsed, so a webhook's whole lifecycle correlates on its business id.
 *
 * Wrapping `next()` inside runWithCorrelation puts the ENTIRE downstream async
 * chain (guards, controllers, services, listeners awaited in-request) under
 * the same AsyncLocalStorage store — BusinessLogger reads it automatically.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers['x-correlation-id'];
    const inbound = Array.isArray(header) ? header[0] : header;
    const correlationId =
      inbound && inbound.trim().length > 0 ? inbound.trim() : newCorrelationId();
    runWithCorrelation(correlationId, () => next());
  }
}
