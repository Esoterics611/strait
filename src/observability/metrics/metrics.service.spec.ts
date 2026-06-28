import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('initializes prom-client and exposes /metrics-rendered output', async () => {
    const m = new MetricsService();
    m.onModuleInit();
    expect(m.isAvailable()).toBe(true);

    m.recordStateTransition('USDC_LOCKED', 'DISPATCHED', 'MESH');
    m.recordDispatchLatency(123);
    m.recordOutboundApiCall('custodial', 200);
    m.refundJobOutcome('MESH', 'DONE');
    m.recordRefundLatency('MESH', 250);
    m.recordStaleStateAlert('DISPATCHED', 'gt_30min');
    m.recordWebhookDuration('mesh', 'ok', 50);

    const out = await m.render();
    expect(out).toContain('strait_state_transitions_total');
    expect(out).toContain('strait_dispatch_latency_seconds');
    expect(out).toContain('strait_outbound_api_calls_total');
    expect(out).toContain('strait_refund_jobs_total');
    expect(out).toContain('strait_stale_state_alerts_total');
    expect(out).toContain('strait_webhook_processing_duration_seconds');
  });

  it('returns the prom-client content type', async () => {
    const m = new MetricsService();
    m.onModuleInit();
    expect(m.contentType()).toMatch(/^text\/plain/);
  });

  it('all recording methods are no-ops when prom-client is unavailable', async () => {
    const m = new MetricsService();
    m.recordStateTransition('A', 'B', 'C');
    m.recordDispatchLatency(1);
    m.recordOutboundApiCall('p', 200);
    m.refundJobOutcome('x', 'y');
    m.recordRefundLatency('x', 1);
    m.recordStaleStateAlert('a', 'b');
    m.recordWebhookDuration('p', 'o', 1);
    expect(m.isAvailable()).toBe(false);
    expect(await m.render()).toContain('metrics unavailable');
  });
});
