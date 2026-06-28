import { Injectable, OnModuleInit } from '@nestjs/common';
import { BusinessLogger } from '@common/logging';

/**
 * Prom-compatible metrics, registered lazily so the `prom-client` package is
 * an optional dep. If `prom-client` is missing, every recording method becomes
 * a no-op and /metrics returns an empty registry.
 *
 * Counters / histograms:
 *   - strait_state_transitions_total{from,to,source_type}
 *   - strait_webhook_processing_duration_seconds{provider,outcome}
 *   - strait_dispatch_latency_seconds
 *   - strait_outbound_api_calls_total{provider,status_code}
 *   - strait_refund_jobs_total{source,outcome}
 *   - strait_refund_latency_seconds{source}
 *   - strait_stale_state_alerts_total{state,age_bucket}
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly blog = new BusinessLogger('MetricsService');
  private available = false;
  private prom: typeof import('prom-client') | undefined;
  private registry: import('prom-client').Registry | undefined;

  private stateTransitionsCtr?: import('prom-client').Counter<string>;
  private webhookDurationHist?: import('prom-client').Histogram<string>;
  private dispatchLatencyHist?: import('prom-client').Histogram<string>;
  private outboundApiCallsCtr?: import('prom-client').Counter<string>;
  private refundJobsCtr?: import('prom-client').Counter<string>;
  private refundLatencyHist?: import('prom-client').Histogram<string>;
  private staleStateAlertsCtr?: import('prom-client').Counter<string>;

  onModuleInit(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.prom = require('prom-client') as typeof import('prom-client');
    } catch (err) {
      this.blog.warn('onModuleInit', {
        detail: { outcome: 'prom_client_unavailable_metrics_disabled' },
        error: err,
      });
      this.available = false;
      return;
    }
    this.registry = new this.prom.Registry();
    this.prom.collectDefaultMetrics({ register: this.registry });

    this.stateTransitionsCtr = new this.prom.Counter({
      name: 'strait_state_transitions_total',
      help: 'Count of usdc_transactions state transitions',
      labelNames: ['from_state', 'to_state', 'source_type'],
      registers: [this.registry],
    });
    this.webhookDurationHist = new this.prom.Histogram({
      name: 'strait_webhook_processing_duration_seconds',
      help: 'Duration of inbound webhook handling',
      labelNames: ['provider', 'outcome'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });
    this.dispatchLatencyHist = new this.prom.Histogram({
      name: 'strait_dispatch_latency_seconds',
      help: 'USDC_LOCKED → DISPATCHED elapsed time',
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
      registers: [this.registry],
    });
    this.outboundApiCallsCtr = new this.prom.Counter({
      name: 'strait_outbound_api_calls_total',
      help: 'Outbound provider API call count',
      labelNames: ['provider', 'status_code'],
      registers: [this.registry],
    });
    this.refundJobsCtr = new this.prom.Counter({
      name: 'strait_refund_jobs_total',
      help: 'Refund job outcomes by path',
      labelNames: ['source', 'outcome'],
      registers: [this.registry],
    });
    this.refundLatencyHist = new this.prom.Histogram({
      name: 'strait_refund_latency_seconds',
      help: 'Refund executor elapsed time per job',
      labelNames: ['source'],
      buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120],
      registers: [this.registry],
    });
    this.staleStateAlertsCtr = new this.prom.Counter({
      name: 'strait_stale_state_alerts_total',
      help: 'Alerts from cron sweeps for stuck states',
      labelNames: ['state', 'age_bucket'],
      registers: [this.registry],
    });

    this.available = true;
  }

  isAvailable(): boolean {
    return this.available;
  }

  async render(): Promise<string> {
    if (!this.available || !this.registry) return '# metrics unavailable\n';
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry?.contentType ?? 'text/plain';
  }

  recordStateTransition(fromState: string, toState: string, sourceType: string): void {
    this.stateTransitionsCtr?.inc({ from_state: fromState, to_state: toState, source_type: sourceType });
  }

  recordWebhookDuration(provider: string, outcome: string, ms: number): void {
    this.webhookDurationHist?.observe({ provider, outcome }, ms / 1000);
  }

  recordDispatchLatency(ms: number): void {
    this.dispatchLatencyHist?.observe(ms / 1000);
  }

  recordOutboundApiCall(provider: string, statusCode: number | string): void {
    this.outboundApiCallsCtr?.inc({ provider, status_code: String(statusCode) });
  }

  refundJobOutcome(source: string, outcome: string): void {
    this.refundJobsCtr?.inc({ source, outcome });
  }

  recordRefundLatency(source: string, ms: number): void {
    this.refundLatencyHist?.observe({ source }, ms / 1000);
  }

  recordStaleStateAlert(state: string, ageBucket: string): void {
    this.staleStateAlertsCtr?.inc({ state, age_bucket: ageBucket });
  }
}
