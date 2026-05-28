// k6 load script — Strait
//
// Target: sustain 100 RPS on the mock-default money path for 60 seconds.
//   - p95 transaction-create latency < 500 ms
//   - 0 HTTP 5xx
//
// HOW TO RUN (mock providers, local Postgres):
//   1. cp .env.example .env  # mock defaults are fine
//   2. docker compose up -d postgres   (or use the native PG on :5432)
//   3. npm run migration:run
//   4. npm run start
//   5. k6 run -e BASE_URL=http://localhost:3000 test/load/transactions.js
//
// Results land in stdout; capture into docs/LOAD_TEST_RESULTS.md when iterating
// on the rate / concurrency configuration before launch (CU-09 sign-off).

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SEEDED_MEMBER_ID =
  __ENV.MEMBER_ID || 'a0000000-0000-0000-0000-000000000001';

const errorRate = new Rate('errors');
const txCreateLatency = new Trend('tx_create_latency_ms');

export const options = {
  scenarios: {
    sustained_100_rps: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    'tx_create_latency_ms': ['p(95)<500'],
    'errors': ['rate<0.01'],
    'http_req_failed': ['rate<0.01'],
  },
};

const params = {
  headers: {
    'Content-Type': 'application/json',
    // SessionStubGuard format. The transactions endpoint is what we're hammering.
    Authorization: `Bearer dev-${SEEDED_MEMBER_ID}`,
  },
};

export default function () {
  // Path A (Mesh) crypto-in transfer — the only inbound path in Strait.
  // No real money moves; mock providers are the default.
  const res = http.post(
    `${BASE_URL}/api/transactions`,
    JSON.stringify({
      memberId: SEEDED_MEMBER_ID,
      path: 'MESH',
      amountUsdcUnits: '5000000',
    }),
    params,
  );

  txCreateLatency.add(res.timings.duration);
  const ok = check(res, {
    'status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    'no 5xx': (r) => r.status < 500,
  });
  if (!ok) errorRate.add(1);

  sleep(0.01);
}

export function handleSummary(data) {
  const p95 = data.metrics.tx_create_latency_ms.values['p(95)'];
  const errPct = (data.metrics.errors?.values?.rate ?? 0) * 100;
  // eslint-disable-next-line no-console
  console.log(
    `\n=== Lira-Bridge load summary ===\n  p95 tx_create: ${p95.toFixed(1)} ms\n  error rate:    ${errPct.toFixed(2)}%\n  total reqs:    ${data.metrics.http_reqs.values.count}\n`,
  );
  return {
    'stdout': JSON.stringify(data, null, 2),
  };
}
