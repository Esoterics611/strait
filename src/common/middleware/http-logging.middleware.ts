import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { getCorrelationId } from '../logging/correlation';

/**
 * Logs every inbound HTTP request once the response is finished.
 *
 * Dev  : coloured one-liner  →  GET /api/health 200 4ms
 * Prod : structured JSON     →  {"ts":"…","method":"GET","path":"/api/health","status":200,"ms":4}
 *
 * Uses NestJS built-in Logger — zero extra dependencies.
 */
@Injectable()
export class HttpLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');
  private readonly isProd: boolean;

  constructor(private readonly config: ConfigService) {
    this.isProd = this.config.get<string>('app.nodeEnv') === 'production';
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl } = req;
    const start = Date.now();

    res.on('finish', () => {
      const ms = Date.now() - start;
      const { statusCode } = res;
      const correlationId = getCorrelationId();

      if (this.isProd) {
        // Structured JSON — pipe to any log aggregator (Datadog, CloudWatch, etc.)
        this.logger.log(
          JSON.stringify({
            ts: new Date().toISOString(),
            method,
            path: originalUrl,
            status: statusCode,
            ms,
            correlationId,
          }),
        );
      } else {
        // ANSI colour: green 2xx, cyan 3xx, yellow 4xx, red 5xx
        const code =
          statusCode >= 500 ? 31
          : statusCode >= 400 ? 33
          : statusCode >= 300 ? 36
          : 32;
        const cid = correlationId ? ` cid=${correlationId}` : '';
        this.logger.log(
          `\x1b[${code}m${method}\x1b[0m ${originalUrl} \x1b[${code}m${statusCode}\x1b[0m ${ms}ms${cid}`,
        );
      }
    });

    next();
  }
}
