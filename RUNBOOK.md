# Strait — Local Development Runbook

## What this is

Strait is a crypto-in / crypto-out USDC payment orchestrator. Members fund via
on-chain USDC through Mesh Connect; recipients receive USDC via a direct wallet
transfer (ChainDispatcher) or a custodial provider (CustodialDispatcher). The
core is a NestJS modular monolith backed by a single PostgreSQL database.

**Everything in the default dev config runs mock/sandbox — no real chain calls,
no real Mesh calls, no real money moves.**

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node | 20+ | Runtime |
| npm | 10+ (comes with Node 20) | Package management |
| Docker + Docker Compose | any recent | PostgreSQL dev container |

---

## First-time setup

### 1. Install dependencies

```bash
# Root workspace (NestJS backend + contract package)
npm install

# React client
npm run client:install
```

### 2. Start PostgreSQL

```bash
docker compose up -d
```

This starts `postgres:16-alpine` on `localhost:5432` with:
- User / password / database all: `strait`
- Data persisted in the `pgdata` Docker volume

Wait a few seconds for the health check to pass:
```bash
docker compose ps   # should show "healthy"
```

### 3. Create your .env file

```bash
cp .env.example .env
```

The defaults in `.env.example` work out of the box for local dev. Nothing needs
changing unless you want to test a real chain or custodial provider.

**The only values you should add for a richer local session:**

```dotenv
# Seeds the first admin user on first boot (one-shot, skipped if admin_users
# already has a row)
ADMIN_BOOTSTRAP_EMAIL=admin@example.com
ADMIN_BOOTSTRAP_PASSWORD=changeme123
```

### 4. Run migrations

```bash
npm run migration:run
```

This creates all tables (member_accounts, usdc_transactions, recipients,
tx_state_transitions, outbox_events, admin_users, refund_jobs, …) and inserts
the dev seed member (UUID `a0000000-0000-0000-0000-000000000001`).

---

## Running the app

### Backend only (API server, port 3000)

```bash
npm run start:dev
```

Hot-reloads on file changes. JSON structured logs go to stdout.

### Frontend only (Vite dev server, port 5173)

```bash
npm run client:dev
```

Proxies `/api` and `/webhooks` to the backend on port 3000, so both servers
must be running for the UI to work.

### Running both

Open two terminals:

```
Terminal 1: npm run start:dev
Terminal 2: npm run client:dev
```

Then open **http://localhost:5173** (member UI) or **http://localhost:5173/admin**
(admin UI).

---

## Architecture in one page

```
Browser (port 5173)
  ├─ /            → Member UI  (React, Vite)
  └─ /admin       → Admin UI   (React, separate composition root)
        │ proxy /api + /webhooks
        ▼
NestJS (port 3000)
  ├─ /api/…        Member-facing REST + SSE
  ├─ /webhooks/…   Mesh + Custodial inbound webhooks (HMAC-signed)
  ├─ /admin/…      Admin operator surface
  ├─ /api/dev/…    Dev-tool simulation endpoints (DEV_TOOLS_ENABLED only)
  └─ /metrics      Prometheus scrape (IP-restricted)
        │
        ▼
PostgreSQL 16 (port 5432)
  Single DB, single migration history, single app role (strait_app).
  No second DB, no microservices.
```

**Key architectural rules (from CLAUDE.md §9):**
- One repo, one DB, one ordered migration history — no polyrepo, no microservices.
- `@strait/contract` is the only source for wire types shared between client and
  API — never re-declare a shape in `client/src` or `src/`.
- Raw `process.env` is only allowed in `src/secrets/env-secret.provider.ts` and
  `src/config/app-config.factory.ts`. Everything else reads through
  `ISecretProvider.get()`.

---

## Operator flags (env vars)

All flags have safe defaults for local dev. Flipping them moves the app toward
production readiness.

| Flag | Dev default | What it does |
|------|-------------|--------------|
| `MOCK_MESH_ENABLED` | `true` | Use mock Mesh client (no SDK calls) |
| `MOCK_DISPATCH_ENABLED` | `true` | Both ChainDispatcher and CustodialDispatcher use mock impls |
| `MOCK_DISPATCH_SETTLE_MS` | `250` | How fast the mock dispatcher "confirms" (ms) |
| `MOCK_DISPATCH_FAILURE_RATE` | `0` | 0–1 fraction of mock dispatches that fail |
| `RECIPIENT_DISPATCH_ENABLED` | `false` | Master gate — dispatch listener no-ops on USDC_LOCKED until `true` |
| `CHAIN_DISPATCHER_ENABLED` | `true` | Provision the on-chain USDC adapter |
| `CUSTODIAL_DISPATCHER_ENABLED` | `false` | Provision the custodial adapter |
| `DEV_TOOLS_ENABLED` | `true` | Expose `/api/dev/*` simulation endpoints |

**To simulate a full happy-path end-to-end in mock mode:**
1. Keep all `MOCK_*` flags on their defaults
2. Set `RECIPIENT_DISPATCH_ENABLED=true`
3. Restart the server — USDC_LOCKED events will now trigger dispatch

---

## Dev-tool endpoints (`DEV_TOOLS_ENABLED=true`)

These bypass the Mesh SDK and let you drive the state machine directly.
All require `DEV_TOOLS_ENABLED=true` (default in dev).

```
POST /api/dev/emit-locked
  Body: { memberId, amountUsdcUnits }
  Effect: inserts a USDC_LOCKED CREDIT row and fires the locked event,
          which triggers dispatch if RECIPIENT_DISPATCH_ENABLED=true.

POST /api/dev/mesh-connect
  Body: { memberId }
  Effect: synthetic Mesh OAuth connect (stores a mock meshAccountId).

POST /api/dev/mesh-initiate
  Body: { memberId, amountUsdcUnits, recipientId }
  Effect: runs the full Mesh initiate path with the mock client.
          The mock client self-delivers transfer.created + transfer.settled,
          which cascades through to DISPATCHED → SETTLED.
```

The seed dev member ID is `a0000000-0000-0000-0000-000000000001`.

---

## Auth

### Member auth (magic-link)

```
POST /api/auth/member/magic-link   { email }
  → { delivered: true, devToken? }
  In dev (DEV_TOOLS_ENABLED=true), the response includes devToken directly
  so you don't need an email server.

POST /api/auth/member/verify       { token }
  → { accessToken, member: { id, email } }
  Pass accessToken as: Authorization: Bearer <accessToken>
```

### Admin auth (password + TOTP MFA)

On first boot with `ADMIN_BOOTSTRAP_EMAIL` + `ADMIN_BOOTSTRAP_PASSWORD` set,
the app creates one `admin` role user.

```
POST /admin/auth/login   { email, password }
  → { challenge, requiresMfa }

POST /admin/auth/mfa     { challenge, code }
  → { accessToken, refreshToken }
```

TOTP enrollment is done via `POST /admin/auth/totp/setup` +
`POST /admin/auth/totp/enroll`. For dev you can skip MFA if you INSERT a
row with `mfa_enrolled = false` directly.

---

## Database

### Useful psql one-liners

```bash
# Connect
docker exec -it $(docker compose ps -q postgres) psql -U strait strait

# Current state of all transactions
SELECT tx_id, state, amount_usdc_wei FROM usdc_transactions ORDER BY created_at DESC LIMIT 20;

# Transaction state history
SELECT tx_id, from_state, to_state, occurred_at FROM tx_state_transitions ORDER BY occurred_at DESC LIMIT 30;

# Shadow ledger balance for the dev seed member
SELECT usdc_virtual_balance_wei FROM member_accounts
  WHERE member_id = 'a0000000-0000-0000-0000-000000000001';

# Outbox (should drain quickly in dev — the relay runs in-process)
SELECT id, event_type, dispatched_at FROM outbox_events ORDER BY created_at DESC LIMIT 10;
```

### USDC decimal convention

`amount_usdc_wei` stores **6-decimal USDC units** (the "wei" suffix is legacy
naming from upstream — ignore it):

```
1 USDC  = 1_000_000
10.50   = 10_500_000
```

Never store ETH-style 18-decimal wei in these columns.

### Migration commands

```bash
npm run migration:run       # apply all pending migrations
npm run migration:revert    # roll back the last migration
```

---

## State machine

Transactions move through exactly these 8 states:

```
MESH_PENDING ─→ USDC_LOCKED ─→ DISPATCHED ─→ SETTLED
     │               │               │
     └───────────────┴──── FAILED ───┘
                           FAILED_DISPATCH
                                │
                           REFUND_QUEUED ─→ REFUNDED
```

- `MESH_PENDING` — Mesh transfer initiated; waiting for on-chain confirmation
- `USDC_LOCKED` — USDC credited to shadow ledger; ready for outbound dispatch
- `DISPATCHED` — Sent to recipient; awaiting confirmation
- `SETTLED` — Confirmed received (terminal ✓)
- `FAILED` — Pre-dispatch failure (terminal ✗)
- `FAILED_DISPATCH` — Outbound dispatch failed (terminal ✗)
- `REFUND_QUEUED` — Refund initiated
- `REFUNDED` — Refund confirmed (terminal ✓)

`SETTLED` and `REFUNDED` are the only terminal states that accept no further
transitions. `FAILED` and `FAILED_DISPATCH` can move to `REFUND_QUEUED`.

---

## Running tests

```bash
# Unit tests (no DB required)
npm test

# Watch mode
npm run test:watch

# Integration tests (requires running PostgreSQL)
npm run test:integration

# Type check
npx tsc --project tsconfig.build.json --noEmit   # backend
cd client && npx tsc --noEmit                     # frontend

# Boundary / dependency lint
npm run lint:boundaries
```

---

## Production checklist (before going live)

- [ ] `MOCK_MESH_ENABLED=false` + real Mesh SDK credentials wired
- [ ] `MOCK_DISPATCH_ENABLED=false` + real ChainDispatcher tested in sandbox (CU-CHAIN-1)
- [ ] `CUSTODIAL_DISPATCHER_ENABLED=true` + custodial provider selected (CU-CUST-1) and webhook signing confirmed (CU-CUST-2)
- [ ] `RECIPIENT_DISPATCH_ENABLED=true`
- [ ] `DEV_TOOLS_ENABLED=false` (or not set — it defaults to false outside dev)
- [ ] `CHAIN_PRIVATE_KEY` coming from Vault (never from `.env` in prod)
- [ ] `MEMBER_JWT_SECRET` and `ADMIN_JWT_SECRET` replaced with strong random values
- [ ] `ADMIN_BOOTSTRAP_EMAIL/PASSWORD` removed from env after first admin user is set up and password changed
- [ ] PostgreSQL: `strait_app` role has only SELECT/INSERT on `usdc_transactions` (append-only enforcement)
- [ ] `/metrics` endpoint protected by VPC perimeter or `METRICS_ALLOWED_IPS`

---

## Open critical unknowns (from CLAUDE.md §6)

| ID | What's missing |
|----|---------------|
| CU-CHAIN-1 | Real `ChainDispatcher` impl (ethers/viem signer + ERC20.transfer); treasury hot-wallet provisioning + chain-tx watcher. Sandbox-verify before `MOCK_DISPATCH_ENABLED=false`. |
| CU-CUST-1 | Custodial provider selection (Bridge.xyz crypto API vs Fireblocks vs other). Pick before wiring real `CustodialDispatcher`. |
| CU-CUST-2 | Custodial webhook signing algorithm (provider-specific) — confirm in sandbox during real-impl wiring. |

Until these are resolved, the app runs fully in mock mode. All core
orchestration logic (shadow ledger, state machine, outbox, webhooks, auth,
admin surface, recipients) is complete and testable without real provider
credentials.
