// The single UI <-> backend seam. One typed `MemberApi`, implemented twice:
// `liveApi` (fetch + member JWT) and `mockApi` (in-memory, deterministic,
// scripted SSE). `VITE_API_MODE` selects.

import { stageFor, type TxState } from './state-labels';
import type {
  AuthStartResp,
  AuthVerifyResp,
  ConnectionState,
  CreateRecipientReq,
  CreateTransferReq,
  Member,
  PayInInstructions,
  PayInOption,
  PayoutMethod,
  Quote,
  QuoteReq,
  Recipient,
  StatusSnapshot,
  Transfer,
  TransferListItem,
  TransferPage,
  UpdateRecipientReq,
} from './contract';

export const TOKEN_KEY = 'strait.member.token';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: 'BELOW_FLOOR' | 'DUPLICATE' | 'QUOTE_EXPIRED' | 'AUTH' | 'GENERIC',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface StatusHandlers {
  onFrame: (s: StatusSnapshot) => void;
  onConn: (c: ConnectionState) => void;
}

export type MockScenario =
  | 'happy'
  | 'failed'
  | 'failed_dispatch'
  | 'reversed';

export interface MemberApi {
  authStart(req: { channel: 'email' | 'sms'; address: string }): Promise<AuthStartResp>;
  authVerify(req: { address: string; code: string }): Promise<AuthVerifyResp>;
  me(): Promise<Member>;
  updateMe(patch: Partial<Member>): Promise<Member>;
  listRecipients(): Promise<Recipient[]>;
  createRecipient(req: CreateRecipientReq): Promise<Recipient>;
  getRecipient(id: string): Promise<Recipient>;
  updateRecipient(id: string, req: UpdateRecipientReq): Promise<Recipient>;
  deleteRecipient(id: string): Promise<void>;
  payInOptions(recipientId: string): Promise<PayInOption[]>;
  createQuote(req: QuoteReq): Promise<Quote>;
  getQuote(id: string): Promise<Quote>;
  createTransfer(req: CreateTransferReq): Promise<Transfer>;
  listTransfers(opts: { limit: number; cursor?: string }): Promise<TransferPage>;
  getTransfer(id: string): Promise<Transfer>;
  subscribeStatus(txId: string, h: StatusHandlers): () => void;
  // Mock-only timeline control; undefined on liveApi.
  mock?: {
    scenario: MockScenario;
    setScenario(s: MockScenario): void;
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const USDC_MINOR = 1_000_000; // USDC 6-dp
const DISPATCH_FLOOR_USDC_MINOR = 1_000_000n; // 1.00 USDC

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// mock implementation
// ---------------------------------------------------------------------------

function makeMockApi(): MemberApi {
  let member: Member = {
    memberId: 'm-0001',
    email: 'dana@example.com',
    phone: null,
    displayName: 'Dana',
    country: 'IL',
    kycStatus: 'NONE',
    createdAt: '2026-04-01T09:00:00.000Z',
  };
  const knownAddresses = new Set<string>(['dana@example.com']);
  let lastCode = '424242';

  const recipients = new Map<string, Recipient>();
  const seed: Recipient[] = [
    {
      recipientId: 'r-ready',
      displayName: 'Maya Cohen',
      relationship: 'Sister',
      payoutMethod: 'WALLET_CHAIN',
      wallet: {
        chainId: 8453,
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
      },
      custodial: null,
      dispatchStatus: 'READY',
      dispatchError: null,
      createdAt: '2026-04-02T10:00:00.000Z',
    },
    {
      recipientId: 'r-reg',
      displayName: 'David Levi',
      relationship: 'Father',
      payoutMethod: 'CUSTODIAL',
      wallet: null,
      custodial: { providerKey: 'coinbase', last4: '8899' },
      dispatchStatus: 'REGISTERING',
      dispatchError: null,
      createdAt: '2026-05-10T10:00:00.000Z',
    },
    {
      recipientId: 'r-failed',
      displayName: 'Noa Bar',
      relationship: null,
      payoutMethod: 'WALLET_CHAIN',
      wallet: {
        chainId: 1,
        walletAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      },
      custodial: null,
      dispatchStatus: 'FAILED',
      dispatchError: 'Wallet could not be verified.',
      createdAt: '2026-05-12T10:00:00.000Z',
    },
  ];
  for (const r of seed) recipients.set(r.recipientId, r);
  // r-reg auto-resolves to READY (deterministic background completion)
  setTimeout(() => {
    const r = recipients.get('r-reg');
    if (r && r.dispatchStatus === 'REGISTERING') {
      recipients.set('r-reg', { ...r, dispatchStatus: 'READY' });
    }
  }, 4000);

  const quotes = new Map<string, Quote>();
  const quoteRecipient = new Map<string, string>();
  const transfers = new Map<string, Transfer>();
  let seq = 1;

  function seedTransfer(
    txId: string,
    recipientId: string,
    sendMinor: string,
    state: TxState,
    createdAt: string,
  ): void {
    const r = recipients.get(recipientId)!;
    const q = buildQuote({
      recipientId,
      send: { currency: 'USDC', minor: sendMinor },
      payInMethod: 'MESH',
      payOutMethod: r.payoutMethod,
    });
    transfers.set(txId, {
      txId,
      recipient: r,
      quote: { ...q, quoteId: `seed-${txId}` },
      state,
      createdAt,
      payIn: instructionsFor(txId),
    });
  }
  seedTransfer('tx-seed-1', 'r-ready', '80000000', 'SETTLED', '2026-05-09T08:30:00.000Z');
  seedTransfer('tx-seed-2', 'r-ready', '120000000', 'FAILED', '2026-05-14T14:10:00.000Z');

  function buildQuote(req: QuoteReq): Quote {
    const sendUsdc = Number(BigInt(req.send.minor)) / USDC_MINOR;
    // 0.5% network fee, min 0.10 USDC
    const feeUsdc = Math.max(0.1, Math.round(sendUsdc * 0.005 * 100) / 100);
    const receiveUsdc = Math.max(0, sendUsdc - feeUsdc);
    const receiveMinor = BigInt(Math.round(receiveUsdc * USDC_MINOR));
    const start = new Date();
    const earliest = new Date(start.getTime() + 1 * 60_000);
    const latest = new Date(start.getTime() + 10 * 60_000);
    return {
      quoteId: `q-${seq++}`,
      send: req.send,
      fee: { currency: 'USDC', minor: String(Math.round(feeUsdc * USDC_MINOR)) },
      receive: { currency: 'USDC', minor: receiveMinor.toString() },
      payInMethod: req.payInMethod,
      payOutMethod: req.payOutMethod,
      etaText: 'Arrives in minutes',
      etaEarliest: earliest.toISOString(),
      etaLatest: latest.toISOString(),
      expiresAt: new Date(start.getTime() + 90_000).toISOString(),
    };
  }

  function instructionsFor(txId: string): PayInInstructions {
    return {
      method: 'MESH',
      mesh: { connectUrl: `https://connect.mesh.example/${txId}` },
    };
  }

  function delay<T>(v: T, ms = 280): Promise<T> {
    return new Promise((res) => setTimeout(() => res(v), ms));
  }

  function snap(
    state: TxState,
    extra: Partial<StatusSnapshot> = {},
  ): StatusSnapshot {
    return {
      state,
      stage: stageFor(state),
      etaText: null,
      dispatchTxHash: null,
      settledAt: null,
      payoutMethodUsed: null,
      failureReason: null,
      refundExpectedBy: null,
      ...extra,
    };
  }

  function timeline(tx: Transfer, scenario: MockScenario): StatusSnapshot[] {
    const rail = tx.quote.payOutMethod;
    const frames: StatusSnapshot[] = [snap('MESH_PENDING')];
    frames.push(snap('USDC_LOCKED'));
    const dispatchHash = `0x${tx.txId.replace(/\W/g, '').padEnd(64, '0').slice(0, 64)}`;

    if (scenario === 'failed') {
      frames[frames.length - 1] = snap('FAILED', {
        failureReason: 'Your funding did not arrive in time.',
      });
      return frames;
    }
    frames.push(snap('DISPATCHED', { dispatchTxHash: dispatchHash }));

    if (scenario === 'failed_dispatch' || scenario === 'reversed') {
      const refundBy = new Date(Date.now() + 3 * 86_400_000).toISOString();
      frames.push(
        snap('FAILED_DISPATCH', {
          dispatchTxHash: dispatchHash,
          failureReason: "The recipient's wallet/provider rejected the transfer.",
          refundExpectedBy: refundBy,
        }),
      );
      if (scenario === 'reversed') {
        frames.push(
          snap('REFUND_QUEUED', { dispatchTxHash: dispatchHash, refundExpectedBy: refundBy }),
        );
        frames.push(snap('REFUNDED', { dispatchTxHash: dispatchHash }));
      }
      return frames;
    }

    const settledAt = new Date().toISOString();
    frames.push(
      snap('SETTLED', {
        dispatchTxHash: dispatchHash,
        settledAt,
        payoutMethodUsed: rail,
      }),
    );
    return frames;
  }

  const control: NonNullable<MemberApi['mock']> = {
    scenario: 'happy',
    setScenario(s) {
      this.scenario = s;
    },
  };

  return {
    mock: control,

    async authStart(req) {
      lastCode = '424242';
      return delay({ challengeId: `ch-${seq++}`, channel: req.channel });
    },
    async authVerify(req) {
      if (req.code !== lastCode) {
        await delay(null, 250);
        throw new ApiError('That code did not match.', 'AUTH');
      }
      const isNew = !knownAddresses.has(req.address);
      knownAddresses.add(req.address);
      if (isNew) {
        member = {
          ...member,
          memberId: `m-${seq++}`,
          email: req.address.includes('@') ? req.address : null,
          phone: req.address.includes('@') ? null : req.address,
          displayName: null,
        };
      }
      return delay({ token: `mock.${member.memberId}`, member, isNewMember: isNew });
    },
    async me() {
      return delay(member);
    },
    async updateMe(patch) {
      member = { ...member, ...patch };
      return delay(member);
    },
    async listRecipients() {
      return delay([...recipients.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
    },
    async createRecipient(req) {
      // dedupe: same display name + same wallet address (or custodial id)
      const walletAddr = req.wallet?.walletAddress.toLowerCase();
      const custId = req.custodial?.externalAccountId;
      for (const r of recipients.values()) {
        const sameName = r.displayName.toLowerCase() === req.displayName.toLowerCase();
        if (!sameName) continue;
        if (walletAddr && r.wallet?.walletAddress.toLowerCase() === walletAddr) {
          throw new ApiError(`duplicate:${r.displayName}`, 'DUPLICATE');
        }
        if (custId && r.custodial && req.custodial?.providerKey === r.custodial.providerKey) {
          throw new ApiError(`duplicate:${r.displayName}`, 'DUPLICATE');
        }
      }
      const id = `r-${seq++}`;
      const rec: Recipient = {
        recipientId: id,
        displayName: req.displayName,
        relationship: req.relationship ?? null,
        payoutMethod: req.payoutMethod,
        wallet: req.payoutMethod === 'WALLET_CHAIN' && req.wallet ? req.wallet : null,
        custodial:
          req.payoutMethod === 'CUSTODIAL' && req.custodial
            ? {
                providerKey: req.custodial.providerKey,
                last4: req.custodial.externalAccountId.slice(-4),
              }
            : null,
        dispatchStatus: 'REGISTERING',
        dispatchError: null,
        createdAt: nowIso(),
      };
      recipients.set(id, rec);
      setTimeout(() => {
        const cur = recipients.get(id);
        if (cur) recipients.set(id, { ...cur, dispatchStatus: 'READY' });
      }, 3500);
      return delay(rec);
    },
    async getRecipient(id) {
      const r = recipients.get(id);
      if (!r) throw new ApiError('Recipient not found.', 'GENERIC');
      return delay(r, 120);
    },
    async updateRecipient(id, req) {
      const r = recipients.get(id);
      if (!r) throw new ApiError('Recipient not found.', 'GENERIC');
      const next: Recipient = {
        ...r,
        displayName: req.displayName ?? r.displayName,
        relationship: req.relationship ?? r.relationship,
      };
      recipients.set(id, next);
      return delay(next);
    },
    async deleteRecipient(id) {
      recipients.delete(id);
      return delay(undefined);
    },
    async payInOptions() {
      return delay<PayInOption[]>([
        {
          method: 'MESH',
          available: true,
          unavailableReason: null,
          speedText: 'Instant',
          feeNote: 'No on-ramp fee',
        },
      ]);
    },
    async createQuote(req) {
      const q = buildQuote(req);
      if (BigInt(q.receive.minor) < DISPATCH_FLOOR_USDC_MINOR) {
        throw new ApiError('below_floor', 'BELOW_FLOOR');
      }
      quotes.set(q.quoteId, q);
      quoteRecipient.set(q.quoteId, req.recipientId);
      return delay(q, 220);
    },
    async getQuote(id) {
      const q = quotes.get(id);
      if (!q) throw new ApiError('Quote not found.', 'GENERIC');
      return delay(q, 120);
    },
    async createTransfer(req) {
      const q = quotes.get(req.quoteId);
      if (!q) throw new ApiError('Quote not found.', 'GENERIC');
      if (new Date(q.expiresAt).getTime() < Date.now()) {
        throw new ApiError('Quote expired.', 'QUOTE_EXPIRED');
      }
      const txId = `tx-${String(seq++).padStart(4, '0')}`;
      const rid = quoteRecipient.get(q.quoteId);
      const r = rid ? recipients.get(rid) : undefined;
      if (!r) throw new ApiError('Recipient not found.', 'GENERIC');
      const tx: Transfer = {
        txId,
        recipient: r,
        quote: q,
        state: 'MESH_PENDING',
        createdAt: nowIso(),
        payIn: instructionsFor(txId),
      };
      transfers.set(txId, tx);
      return delay(tx, 320);
    },
    async listTransfers(opts) {
      const all = [...transfers.values()].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1,
      );
      const start = opts.cursor ? Number(opts.cursor) : 0;
      const slice = all.slice(start, start + opts.limit);
      const items: TransferListItem[] = slice.map((t) => ({
        txId: t.txId,
        recipientName: t.recipient.displayName,
        send: t.quote.send,
        receive: t.quote.receive,
        state: t.state,
        createdAt: t.createdAt,
      }));
      const next = start + opts.limit < all.length ? String(start + opts.limit) : null;
      return delay({ items, nextCursor: next });
    },
    async getTransfer(id) {
      const t = transfers.get(id);
      if (!t) throw new ApiError('Transfer not found.', 'GENERIC');
      // reflect any recipient lifecycle change
      const r = recipients.get(t.recipient.recipientId);
      const fresh = r ? { ...t, recipient: r } : t;
      transfers.set(id, fresh);
      return delay(fresh, 150);
    },
    subscribeStatus(txId, h) {
      let cancelled = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      h.onConn('connecting');
      const t = transfers.get(txId);
      if (!t) {
        timers.push(setTimeout(() => h.onConn('closed'), 200));
        return () => timers.forEach(clearTimeout);
      }
      const frames = timeline(t, control.scenario);
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          h.onConn('live');
        }, 400),
      );
      frames.forEach((f, i) => {
        timers.push(
          setTimeout(
            () => {
              if (cancelled) return;
              transfers.set(txId, { ...transfers.get(txId)!, state: f.state });
              h.onFrame(f);
            },
            700 + i * 2200,
          ),
        );
      });
      return () => {
        cancelled = true;
        timers.forEach(clearTimeout);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// live implementation (fetch + member JWT)
// ---------------------------------------------------------------------------

function makeLiveApi(): MemberApi {
  function token(): string | null {
    return sessionStorage.getItem(TOKEN_KEY);
  }
  async function req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (res.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      if (typeof window !== 'undefined') window.location.assign('/auth');
      throw new ApiError('Session expired.', 'AUTH');
    }
    if (!res.ok) throw new ApiError(`${path} ${res.status}`, 'GENERIC');
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  return {
    authStart: (b) => req('/auth/start', { method: 'POST', body: JSON.stringify(b) }),
    authVerify: (b) => req('/auth/verify', { method: 'POST', body: JSON.stringify(b) }),
    me: () => req('/me'),
    updateMe: (p) => req('/me', { method: 'PATCH', body: JSON.stringify(p) }),
    listRecipients: () => req('/recipients'),
    createRecipient: (b) => req('/recipients', { method: 'POST', body: JSON.stringify(b) }),
    getRecipient: (id) => req(`/recipients/${id}`),
    updateRecipient: (id, b) => req(`/recipients/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    deleteRecipient: (id) => req(`/recipients/${id}`, { method: 'DELETE' }),
    payInOptions: (rid) => req(`/pay-in-options?recipientId=${encodeURIComponent(rid)}`),
    createQuote: (b) => req('/quotes', { method: 'POST', body: JSON.stringify(b) }),
    getQuote: (id) => req(`/quotes/${id}`),
    createTransfer: (b) => req('/transfers', { method: 'POST', body: JSON.stringify(b) }),
    listTransfers: ({ limit, cursor }) =>
      req(`/transfers?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`),
    getTransfer: (id) => req(`/transfers/${id}`),
    subscribeStatus(txId, h) {
      let es: EventSource | null = null;
      let cancelled = false;
      let retry = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const open = (): void => {
        h.onConn(retry === 0 ? 'connecting' : 'reconnecting');
        es = new EventSource(`/api/transfers/${txId}/status`);
        es.onopen = () => {
          retry = 0;
          h.onConn('live');
        };
        es.onmessage = (ev) => {
          try {
            h.onFrame(JSON.parse(ev.data as string) as StatusSnapshot);
          } catch {
            /* ignore malformed frame */
          }
        };
        es.onerror = () => {
          if (cancelled) return;
          es?.close();
          es = null;
          h.onConn('reconnecting');
          timer = setTimeout(open, Math.min(5_000, 250 * 2 ** retry++));
        };
      };
      open();
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        es?.close();
      };
    },
  };
}

const MODE = import.meta.env.VITE_API_MODE ?? 'mock';
export const mockApi: MemberApi = makeMockApi();
export const liveApi: MemberApi = makeLiveApi();
export const api: MemberApi = MODE === 'live' ? liveApi : mockApi;
export const API_MODE = MODE;

export function payoutMethodLabelKey(
  m: PayoutMethod,
): 'payout.WALLET_CHAIN' | 'payout.CUSTODIAL' {
  return m === 'WALLET_CHAIN' ? 'payout.WALLET_CHAIN' : 'payout.CUSTODIAL';
}
