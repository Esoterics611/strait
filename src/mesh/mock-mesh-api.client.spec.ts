import { MockMeshApiClient } from './mock-mesh-api.client';
import { WebhookVerifier } from '../security/webhook-verifier.service';
import { ISecretProvider } from '../secrets/secret-provider.interface';

class StubSecretProvider implements ISecretProvider {
  constructor(private readonly map: Record<string, string>) {}
  async get(key: string): Promise<string> {
    const v = this.map[key];
    if (v === undefined) throw new Error(`Missing ${key}`);
    return v;
  }
  async set(key: string, value: string): Promise<void> {
    this.map[key] = value;
  }
}

describe('MockMeshApiClient', () => {
  const secret = 'mesh-secret-12345';
  let client: MockMeshApiClient;
  let secrets: StubSecretProvider;

  beforeEach(() => {
    secrets = new StubSecretProvider({
      MESH_WEBHOOK_SECRET: secret,
      WEBHOOK_BASE_URL: 'http://localhost:3000',
      MESH_MOCK_LATENCY_MS: '0',
    });
    client = new MockMeshApiClient(secrets);
  });

  it('connectMember returns deterministic meshAccountId for the same memberId', async () => {
    const a = await client.connectMember('m1', {
      authorizationCode: 'x',
      codeVerifier: 'y',
      redirectUri: 'z',
    });
    const b = await client.connectMember('m1', {
      authorizationCode: 'x',
      codeVerifier: 'y',
      redirectUri: 'z',
    });
    expect(a.meshAccountId).toBe(b.meshAccountId);
    expect(a.meshAccountId).toMatch(/^mesh_acct_[0-9a-f]{16}$/);
  });

  it('initiateTransfer fires transfer.created and transfer.settled webhooks, both signed', async () => {
    const verifier = new WebhookVerifier();
    const captured: { sig: string; body: Buffer; parsed: Record<string, unknown> }[] = [];

    const originalFetch = global.fetch;
    global.fetch = (async (
      _url: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const sig = (init?.headers as Record<string, string>)['mesh-signature'];
      const body = init?.body as Buffer;
      captured.push({
        sig,
        body,
        parsed: JSON.parse(body.toString('utf8')),
      });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      await client.initiateTransfer({
        correlationId: 'corr-1',
        meshAccountId: 'mesh_acct_x',
        amountUsdcUnits: 1_000_000n,
        destinationAddress: '0xabc',
        chainId: 8453,
        webhookUrl: 'http://localhost:3000/webhooks/mesh',
      });
      // Two webhook deliveries with a setTimeout in between — wait long enough.
      for (let i = 0; i < 20 && captured.length < 2; i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
    } finally {
      global.fetch = originalFetch;
    }

    expect(captured.length).toBe(2);

    // Both webhooks pass the production WebhookVerifier with the same secret.
    for (const c of captured) {
      expect(verifier.verify('MESH', c.body, c.sig, secret)).toBe(true);
    }

    // First webhook is transfer.created; second is transfer.settled.
    expect(captured[0].parsed.type).toBe('transfer.created');
    expect(captured[1].parsed.type).toBe('transfer.settled');

    // transfer.settled carries amount in 6-decimal string form and the required
    // confirmation depth for chain_id=8453.
    expect(captured[1].parsed.amount).toBe('1');
    expect(captured[1].parsed.confirmations).toBe(64);
    expect(captured[1].parsed.chain_id).toBe(8453);
    expect(String(captured[1].parsed.on_chain_tx_hash)).toMatch(
      /^0x[0-9a-f]{64}$/,
    );
    // external_reference is the correlationId we passed in (this is how the
    // webhook handler joins back to the usdc_transactions row).
    expect(captured[1].parsed.external_reference).toBe('corr-1');
  });

  it('uses ETH-mainnet threshold (12) when chainId=1', async () => {
    let settledBody: Record<string, unknown> | undefined;
    const originalFetch = global.fetch;
    global.fetch = (async (
      _url: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const body = init?.body as Buffer;
      const parsed = JSON.parse(body.toString('utf8'));
      if (parsed.type === 'transfer.settled') settledBody = parsed;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      await client.initiateTransfer({
        correlationId: 'corr-2',
        meshAccountId: 'mesh_acct_x',
        amountUsdcUnits: 1_000_000n,
        destinationAddress: '0xabc',
        chainId: 1,
        webhookUrl: 'http://localhost:3000/webhooks/mesh',
      });
      for (let i = 0; i < 20 && settledBody === undefined; i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
    } finally {
      global.fetch = originalFetch;
    }

    expect(settledBody?.confirmations).toBe(12);
    expect(settledBody?.chain_id).toBe(1);
  });
});
