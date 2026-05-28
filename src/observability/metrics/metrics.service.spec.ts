import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('initializes prom-client and exposes /metrics-rendered output', async () => {
    const m = new MetricsService();
    m.onModuleInit();
    expect(m.isAvailable()).toBe(true);

    m.recordStateTransition('USDC_LOCKED', 'BRIDGE_DISPATCHED', 'MESH');
    m.recordBridgeDispatchLatency(123);
    m.recordOutboundApiCall('bridge', 200);
    m.refundJobOutcome('MESH', 'DONE');
    m.recordRefundLatency('MESH', 250);
    m.setReservePoolBalance(10_000_000_000n);
    m.recordStaleStateAlert('BRIDGE_DISPATCHED', 'gt_30min');
    m.recordWebhookDuration('bridge', 'ok', 50);

    const out = await m.render();
    expect(out).toContain('lira_bridge_state_transitions_total');
    expect(out).toContain('lira_bridge_bridge_dispatch_latency_seconds');
    expect(out).toContain('lira_bridge_outbound_api_calls_total');
    expect(out).toContain('lira_bridge_refund_jobs_total');
    expect(out).toContain('lira_bridge_reserve_pool_usdc_units');
    expect(out).toContain('lira_bridge_stale_state_alerts_total');
    expect(out).toContain('lira_bridge_webhook_processing_duration_seconds');
  });

  it('returns the prom-client content type', async () => {
    const m = new MetricsService();
    m.onModuleInit();
    expect(m.contentType()).toMatch(/^text\/plain/);
  });

  it('all recording methods are no-ops when prom-client is unavailable', async () => {
    // Manually disable so the tests in this suite never accidentally rely on init.
    const m = new MetricsService();
    // Simulate "init failed" by NOT calling onModuleInit. All recordings should
    // be no-ops and render() returns the disabled sentinel.
    m.recordStateTransition('A', 'B', 'C');
    m.recordBridgeDispatchLatency(1);
    m.recordOutboundApiCall('p', 200);
    m.refundJobOutcome('x', 'y');
    m.recordRefundLatency('x', 1);
    m.setReservePoolBalance(0n);
    m.recordStaleStateAlert('a', 'b');
    m.recordWebhookDuration('p', 'o', 1);
    expect(m.isAvailable()).toBe(false);
    expect(await m.render()).toContain('metrics unavailable');
  });
});
