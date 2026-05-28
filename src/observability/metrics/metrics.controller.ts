import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ISecretProvider, SECRET_PROVIDER } from '../../secrets/secret-provider.interface';
import { MetricsService } from './metrics.service';

/**
 * Plain `/metrics` endpoint. NOT under the admin auth surface — Prometheus
 * scrapers don't speak our JWT scheme. Instead, IP-allowlisted per
 * `METRICS_ALLOWED_IPS` (comma-separated, default `127.0.0.1`). For real
 * deployments place this endpoint behind the VPC perimeter so allowlisting
 * by `127.0.0.1` (or the scraper subnet) is sufficient.
 */
@Controller('metrics')
export class MetricsController {
  constructor(
    @Inject(SECRET_PROVIDER) private readonly secrets: ISecretProvider,
    private readonly metrics: MetricsService,
  ) {}

  @Get()
  async scrape(@Req() req: Request, @Res() res: Response): Promise<void> {
    const allowedRaw = await this.safeGet('METRICS_ALLOWED_IPS');
    const allowed = (allowedRaw ?? '127.0.0.1,::1')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const ip = (req.ip ?? req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
    if (!allowed.includes(ip) && !allowed.includes('0.0.0.0')) {
      throw new ForbiddenException(`source IP ${ip} not in METRICS_ALLOWED_IPS`);
    }
    res.setHeader('Content-Type', this.metrics.contentType());
    res.status(200).send(await this.metrics.render());
  }

  private async safeGet(key: string): Promise<string | undefined> {
    try {
      return await this.secrets.get(key);
    } catch {
      return undefined;
    }
  }
}
