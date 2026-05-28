# Strait

A crypto-in / crypto-out USDC payment orchestrator. Members fund on-chain via Mesh (Path A); recipients receive USDC by direct on-chain transfer or via a third-party custodial pay-out provider. One ordered state machine, append-only shadow ledger, transactional outbox.

Forked from the [Lira-Bridge](../meridian) middleware after the ILS on-ramp paths (Rapyd, BoG) and the Bridge.xyz fiat-out path (RTP / FedNow) were dropped. Same orchestration core — narrower scope, no fiat.

## Quick start

```bash
npm install
npm run client:install
docker compose up -d           # Postgres only
cp .env.example .env           # then fill in MEMBER_JWT_SECRET, ADMIN_JWT_SECRET
npm run migration:run
npm run start:dev              # API on :3000
npm run client:dev             # Vite on :5173 (separate terminal)
```

## Architecture

Modular monolith, NestJS + TypeScript strict + PostgreSQL 16. Same binding decision as Lira-Bridge §10h: **no microservices, no polyrepo, no database-per-service.** The correctness model (append-only tables, Postgres SERIALIZABLE, transactional outbox) only holds against one DB in one service.

### Inbound

- **Mesh** (`src/mesh/`) — Member CEX/wallet → Mesh Connect SDK → on-chain USDC → shadow-ledger credit. Mock-default in dev via `MOCK_MESH_ENABLED=true`.

### Outbound

The outbound seam is `IOutboundDispatcher` (`src/dispatch/outbound-dispatcher.interface.ts`). Two adapters implement it, selected per-recipient based on the `payout_method` discriminator:

- **ChainDispatcher** (`WALLET_CHAIN`) — direct on-chain USDC transfer to the recipient's wallet on Ethereum mainnet or Base.
- **CustodialDispatcher** (`CUSTODIAL`) — third-party crypto pay-out provider (Bridge.xyz crypto API, Fireblocks, etc.). Webhook-based settlement.

Both adapters are mock-default. Real impls live behind the same interface — flip `MOCK_DISPATCH_ENABLED=false` to swap them in. `RECIPIENT_DISPATCH_ENABLED=true` is the master gate that lets the dispatch listener act on `USDC_LOCKED` events.

### State machine

```
MESH_PENDING ──► USDC_LOCKED ──► DISPATCHED ──► SETTLED
        │              │                │
        └──► FAILED    └──► FAILED_DISPATCH
                              │
                              └──► REFUND_QUEUED ──► REFUNDED
```

Single source: `src/common/enums/tx-state.enum.ts` (server) + `packages/contract/src/index.ts` (wire). A breaking edit fails both type-checks.

### Money

USDC has **6 decimals**. The `amount_usdc_wei` column stores 6-decimal units (legacy column name from the upstream repo — ignore the "wei" suffix; it's USDC minor units, not ETH wei).

```
1 USDC          = 1_000_000
10.50 USDC      = 10_500_000
10,000 USDC     = 10_000_000_000
```

## Verification

```bash
npm test                      # unit
npm run test:integration      # integration (needs Postgres)
npm run lint:boundaries       # depcruise + no-process-env check
npm run build:all             # api + client
```

## Binding rules (carried over from upstream)

1. **No microservices.** One repo, one DB, one ordered migration history.
2. **`@strait/contract` is the only source of UI↔API wire types.** Never redeclare a shape in `client/src` or `src/`.
3. **Module boundaries machine-enforced** (`.dependency-cruiser.cjs`):
   - Member web tree and admin web tree must not import each other.
   - `src/` modules consume each other through Nest-exported services, never by reaching into `*.repository.ts` (with explicit exempt list).
   - Raw `process.env` is forbidden outside `src/secrets/env-secret.provider.ts` and `src/config/app-config.factory.ts`.
4. **Webhooks**: `@WebhookProvider(...)` + `WebhookSignatureGuard` on every webhook route. `rawBody: true` set in `main.ts`.
5. **Secrets**: `ISecretProvider.get(...)` only. `EnvSecretProvider` in dev; swap a Vault impl in prod.
