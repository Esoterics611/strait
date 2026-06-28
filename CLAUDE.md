# CLAUDE.md — Strait

## 0. Git Workflow (READ FIRST — binding)

Remote: **`https://github.com/Esoterics611/strait`** (private). Every session MUST:
1. Work on `main` directly. Do not create per-session branches; the harness `claude/*` worktree branch is disposable.
2. End the session with the work committed on `main` (one coherent commit, `Co-Authored-By` trailer). Never leave a session with uncommitted deliverables.
3. To ship: push a single well-named feature branch from `main` and open a PR (`gh pr create --base main`).
4. Branches are disposable; commits/tags are forever. Before deleting any branch with unique commits, `git tag archive/<name> <branch>` first.
5. `.claude/` is git-ignored. Never `git add` it.

`.gitattributes` (`eol=lf`) is committed — the CRLF "phantom diff" problem from upstream is already solved here. Do not reintroduce it.

## 1. Project Overview

Strait is a crypto-in / crypto-out USDC payment orchestrator. ILS on-ramp + USD fiat-out paths from the upstream Lira-Bridge code are **dropped**. The orchestration core (shadow ledger, state machine, transactional outbox, idempotent webhooks, admin operator surface, member magic-link auth) is retained.

- **Inbound (crypto)**: Member wallet/CEX → Mesh Connect SDK → on-chain USDC → shadow-ledger credit.
- **Outbound (crypto)**: Shadow-ledger debit → `IOutboundDispatcher` adapter (ChainDispatcher = direct on-chain USDC transfer; CustodialDispatcher = third-party crypto pay-out provider) → recipient.

## 2. Tech Stack

- Node 20, NestJS 10, TypeScript strict, CommonJS
- PostgreSQL 16 via TypeORM 0.3 (raw SQL migrations, no entity decorators)
- React + Vite + Tailwind for `client/`
- `@strait/contract` (type-only) is the single source of UI↔API wire types
- Boundary lint: `npm run lint:boundaries` (dependency-cruiser + no-process-env scanner)

## 3. DB Tables (kept)

| Table | Key invariants |
|---|---|
| `member_accounts` | `usdc_virtual_balance_wei >= 0` CHECK; chain_id IN supported set |
| `usdc_transactions` | Append-only — `strait_app` role has SELECT, INSERT only (no UPDATE/DELETE). Partial unique indexes enforce per-member exclusivity on external reference IDs. |
| `recipients` | New shape: `payout_method` discriminator (`WALLET_CHAIN`/`CUSTODIAL`) with method-specific columns enforced by CHECK constraint. |
| `processed_webhooks` | Idempotency: `UNIQUE(provider, event_id)` |
| `failed_webhooks` | Dead-letter for webhook retry |
| `outbox_events` | Phase-3 transactional outbox — event row commits atomically with the state-transition row |
| `tx_state_transitions` | Append-only history; `v_tx_current_state` projects the latest. |

## 4. State Machine

| State | Meaning |
|---|---|
| `MESH_PENDING` | Path A initiated; awaiting Mesh transfer confirmation |
| `USDC_LOCKED` | USDC credited to shadow ledger; ready for dispatch |
| `DISPATCHED` | Dispatched to recipient (on-chain or custodial); awaiting confirmation |
| `SETTLED` | Confirmed received by recipient |
| `FAILED` | Terminal failure (pre-dispatch — funding side) |
| `FAILED_DISPATCH` | Terminal failure at outbound dispatch |
| `REFUND_QUEUED` | Refund initiated; awaiting processing |
| `REFUNDED` | Refund confirmed complete |

## 5. USDC Decimal Convention

USDC has **6 decimals**. The `amount_usdc_wei` column stores 6-decimal units (column name is a legacy from upstream — ignore the "wei" suffix).

- `1 USDC = 1_000_000`
- `10.50 USDC = 10_500_000`

Never store ETH-style 18-decimal wei in these columns.

## 6. Open Critical Unknowns

| ID | Status | Blocker |
|---|---|---|
| **CU-CHAIN-1** | Open | Real `ChainDispatcher` impl (ethers/viem signer + ERC20.transfer); treasury hot-wallet provisioning + chain-tx watcher. Sandbox-verify before `MOCK_DISPATCH_ENABLED=false`. |
| **CU-CUST-1** | Open | Custodial provider selection (Bridge.xyz crypto API vs Fireblocks vs other). Pick before wiring real `CustodialDispatcher`. |
| **CU-CUST-2** | Open | Custodial webhook signing algorithm (provider-specific) — confirm in sandbox during real-impl wiring. |

## 7. Webhook Signing Reference

| Provider | Algorithm | Signature header | Secret env var |
|---|---|---|---|
| Mesh | `HMAC-SHA256(rawBody, secret)` → hex | `mesh-signature` | `MESH_WEBHOOK_SECRET` |
| Custodial (placeholder) | TBD per provider | TBD | `CUSTODIAL_WEBHOOK_SECRET` |

All webhook routes use `@WebhookProvider(...)` + `WebhookSignatureGuard`. `rawBody: true` is set in `main.ts`.

## 8. Module Map

```
src/
  config/ secrets/         Typed AppConfig + ISecretProvider (Vault swap point)
  common/                  Enums, interfaces, errors, USDC decimal util, logging, middleware
  database/ events/        DbService (SERIALIZABLE), DomainEventEmitter
  idempotency/ webhooks/   SHA-256 idempotency key, webhook dedup + signature guard
  ledger/ state-machine/   ShadowLedger + append-only StateMachine (atomic with outbox)
  security/                WebhookVerifier + WebhookSignatureGuard
  outbox/                  Transactional outbox (in-process relay)
  mesh/                    Path-in: Mesh mock-default + OFAC pre-screen
  dispatch/                Path-out: IOutboundDispatcher + ChainDispatcher + CustodialDispatcher
  recipients/              Sender-owned payees (wallet/custodial discriminator)
  refunds/                 Refund executors (Mesh refund only)
  observability/           Prometheus /metrics
  api/                     Member-facing HTTP API + magic-link auth
  admin/                   Admin operator surface (auth/audit/approvals/settings)
  dev-tools/               /api/dev/* — DEV_TOOLS_ENABLED gate only
client/
  src/member/              Member UI (Mesh fund, recipient mgmt, transfer status)
  src/admin/               Admin UI (separate composition root)
packages/contract/         @strait/contract — single source for §7 wire types
migrations/                Raw SQL TypeORM migrations
test/integration/          Real-Postgres regression oracle
.dependency-cruiser.cjs    Module boundary lint (npm run lint:boundaries)
scripts/check-no-process-env.js  Companion lint: no raw process.env outside seams
docker-compose.yml         PostgreSQL 16 dev container
```

## 9. Architecture binding rules

- **No microservices.** Append-only tables + Postgres `SERIALIZABLE` only hold against one DB in one service.
- **Modular monolith, not polyrepo.** One repo, one DB, one ordered migration history.
- **`@strait/contract` is the only contract source.** Never re-declare a wire shape in `client/src` or `src/`; always import from the package.
- **Module boundaries are machine-enforced** via `.dependency-cruiser.cjs` + `scripts/check-no-process-env.js`. Three rules:
  - Member web tree and admin web tree must not import each other.
  - `src/` modules consume each other via Nest-exported services, never by reaching into `*.repository.ts` (with explicit exempt list).
  - Raw `process.env` is forbidden outside `src/secrets/env-secret.provider.ts` and `src/config/app-config.factory.ts`.
- **The transactional outbox is the one deliberately-deferred service seam.** Event-bearing state transitions write an `outbox_events` row in the SAME transaction as the state-transition row. Future scale-out is a *deployment* change against the SAME DB — run the same image with a flag that starts only the relay. No saga, no second DB.

## 10. SecretProvider Contract

`ISecretProvider` is the Vault swap point. `EnvSecretProvider` reads `process.env`. No other module may access `process.env` directly — all secret reads go through `ISecretProvider.get()`. The `SECRET_PROVIDER` token is provided globally by `SecretsModule` (imported in `AppModule`).

## 11. Operator-facing flags

| Flag | Default | Purpose |
|---|---|---|
| `MOCK_MESH_ENABLED` | `true` (dev) / `false` (prod) | Use mock Mesh client instead of real SDK |
| `MOCK_DISPATCH_ENABLED` | `true` | Both adapters use mock impl (no real chain calls / no real provider calls) |
| `RECIPIENT_DISPATCH_ENABLED` | `false` | Master gate — DispatchListener no-ops on USDC_LOCKED until this is true |
| `CHAIN_DISPATCHER_ENABLED` | `true` | Provision ChainDispatcher adapter |
| `CUSTODIAL_DISPATCHER_ENABLED` | `false` | Provision CustodialDispatcher adapter |
| `DEV_TOOLS_ENABLED` | `true` (dev only) | `/api/dev/*` simulation endpoints |
