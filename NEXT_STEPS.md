# NEXT_STEPS.md — finish the meridian → strait extraction

This repo is a **partial extraction** from `/home/nexus/code/meridian` (Lira-Bridge). The crypto-only fork plan is locked, the new core is written, but the bulk-copied legacy files still contain ILS / Rapyd / Path-C / Bridge.xyz-fiat-out code. **The repo does not compile yet.** This document is the punch-list to take it the rest of the way.

---

## What is done (do NOT redo)

Authoritative new files — already aligned with the crypto-only contract:

| Area | File | Status |
|---|---|---|
| Scaffold | `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `.gitignore`, `.gitattributes`, `docker-compose.yml`, `.env.example`, `README.md`, `CLAUDE.md` | ✅ written |
| Module boundaries | `.dependency-cruiser.cjs` | ✅ rewritten (only `dispatch.service.ts` + `state-machine.service.ts` are now exempt) |
| Wire contract | `packages/contract/package.json` (renamed `@strait/contract`) and `packages/contract/src/index.ts` | ✅ rewritten with new TxState / PayoutMethod / Recipient shape |
| Config | `src/config/app-config.interface.ts`, `src/config/app-config.factory.ts` | ✅ rewritten (no fiat fields; `mesh` / `dispatch` / `chain` / `custodial` / `memberAuth` / `admin` / `devTools`) |
| Enums | `src/common/enums/{tx-state,inbound-path,source-type,rail-used,index}.enum.ts` | ✅ rewritten. `reserve-event-type.enum.ts` deleted |
| Crypto-out | `src/dispatch/` (8 files: interface, errors, two adapters, service, listener, module, spec) | ✅ written from scratch |
| Recipient shape | `src/recipients/recipient.types.ts` | ✅ written (canonical snake_case row shape) |
| Deleted dirs | `src/onramp/`, `src/path-c/`, `src/bridge/`, `contracts/` (Hardhat reserve-pool) | ✅ gone from the file tree |
| Deleted files | `migrations/1715000000003-OnrampAccountPayload.ts`, `migrations/1715000000005-PathCIndexes.ts`, `src/refunds/path-b-rapyd-refund.executor*.ts`, `src/refunds/path-c-wire-refund.executor*.ts`, `src/refunds/{wire-out-adapter.interface,stub-wire-out.adapter}.ts`, `src/common/enums/reserve-event-type.enum.ts` | ✅ gone |

---

## What is NOT done (the punch-list)

### Phase A — Strip fiat from `src/` (legacy copy still has it)

The following files were copied verbatim from meridian and still reference dropped state names, dropped modules, or `@lira/contract`. Fix them in order:

1. **`src/app.module.ts`** — drop `import { OnRampModule }`, `import { PathCModule }`, `import { BridgeModule }` and their entries in `imports:`. Add `import { DispatchModule } from './dispatch/dispatch.module';` and `DispatchModule` in `imports:` (between `StateMachineModule` and `RecipientsModule`).

2. **`src/events/domain-event-emitter.service.ts`** — in the `PAYMENT_EVENTS` constants, rename `BRIDGE_DISPATCHED` → `DISPATCHED`. Keep `USDC_LOCKED`, `SETTLED` (rename if it's `SETTLED_USD`), `FAILED`, `RECIPIENT_SETUP_PENDING`, `DISPATCH_DEFERRED`, `REFUNDED`. Drop any path-B / path-C-specific event names.

3. **`src/state-machine/state-machine.service.ts`** — rewrite the `TRANSITIONS` map and `STATE_TO_EVENT` map to use only the 8 surviving states (`MESH_PENDING | USDC_LOCKED | DISPATCHED | SETTLED | FAILED | FAILED_DISPATCH | REFUND_QUEUED | REFUNDED`). Drop all `ILS_*` and `BRIDGE_DISPATCHED` / `SETTLED_USD` / `FAILED_BRIDGE` entries.

4. **`src/state-machine/state-machine.service.spec.ts`** — update or delete tests that exercised dropped transitions. Preserve test intent for the surviving transitions.

5. **`src/recipients/`** — this is the messiest. Delete `bank-tokenizer.ts`, `bridge-recipient-client.interface.ts`, `mock-bridge-recipient.client.ts`, `real-bridge-recipient.client.ts`. Rewrite `recipients.repository.ts` to read/write the new columns (`payout_method`, `wallet_chain_id`, `wallet_address`, `custodial_provider`, `custodial_external_id`, `custodial_last4`, `dispatch_status`, `dispatch_error`). Rewrite `recipients.service.ts` to accept the new `CreateRecipientReq` from `@strait/contract` (no `BankInput`). Update `recipients.controller.ts` similarly. Update `recipients.service.spec.ts`.

6. **`src/refunds/refunds.module.ts`** — drop the providers for the deleted Path-B/Path-C executors. Keep only `path-a-mesh-refund.executor`, `refund-executor.cron`, `refund-executor.repository`, `refund-executor.types`.

7. **`src/refunds/refund-executor.cron.ts`** — drop the scheduling calls for the deleted executors.

8. **`src/api/`, `src/admin/`, `src/observability/`, `src/mesh/`, `src/webhooks/`, `src/dev-tools/`** — scan for and fix:
   - `from '@lira/contract'` → `from '@strait/contract'` (every file, every import)
   - `TxState.BRIDGE_DISPATCHED` → `TxState.DISPATCHED`
   - `TxState.SETTLED_USD` → `TxState.SETTLED`
   - `TxState.FAILED_BRIDGE` → `TxState.FAILED_DISPATCH`
   - `TxState.ILS_PENDING_ONRAMP` / `ILS_SWAP_PROCESSING` / `ILS_PENDING_COLLECTION` / `ILS_WIRE_CONFIRMED` → delete the branches that mention them
   - `BridgeService` / `IBridgeApiClient` / `IBridgeRecipientClient` → re-point to `DispatchService` / `IOutboundDispatcher` from `src/dispatch/` (or delete the caller if the call site only existed for fiat-out)
   - `PayoutMethod` values `BANK_RTP` / `BANK_FEDNOW` / `BANK_ACH` → use `WALLET_CHAIN` (default) or `CUSTODIAL`
   - Anything mentioning `Rapyd`, `BoG`, `pathC`, `reservePool`, `tokenizeBank`, `bank_account_last4`, `onramp` — delete or rewrite

9. **`src/dev-tools/`** — delete controller endpoints that simulate on-ramp or Path-C events. Keep mesh simulators.

10. **`src/webhooks/`** — drop Rapyd-specific signing logic (the `rapyd-salt` / `rapyd-timestamp` BASE64-HMAC path). Keep generic `HMAC-SHA256(rawBody, secret) → hex` for `mesh` and add `custodial` as a registered provider.

11. **Final grep across `src/`** for: `Rapyd`, `BoG`, `ILS`, `pathC`, `PATH_C`, `reservePool`, `on-ramp`, `onramp`, `BRIDGE_DISPATCHED`, `SETTLED_USD`, `FAILED_BRIDGE`, `@lira/contract`, `BANK_RTP`, `BANK_FEDNOW`, `BANK_ACH`, `bank_account_last4`, `lirabridge`. Every hit must be resolved.

### Phase B — Migrations

The numbered migration files at `/c/code/strait/migrations/` are unchanged from meridian (minus the two on-ramp / Path-C ones I already deleted). Rewrite the surviving ones:

1. **`1715000000000-InitialSchema.ts`** — drop the `reserve_pool_ledger` table block entirely. Drop any on-ramp columns on `usdc_transactions` (look for `onramp_provider`, `rapyd_payment_id`, `bog_*`, `ils_amount_*`). Update the `state` CHECK constraint to `('MESH_PENDING','USDC_LOCKED','DISPATCHED','SETTLED','FAILED','FAILED_DISPATCH','REFUND_QUEUED','REFUNDED')`. Rename the Postgres role `lirabridge_app` → `strait_app`. Rename DB name / owner `lirabridge` → `strait`. Preserve the append-only invariant: `strait_app` has only `SELECT, INSERT` on `usdc_transactions`.

2. **`1715000000001-Seed.ts`** — strip reserve-pool / Path-C / Rapyd seed inserts. If the file becomes empty, leave a no-op migration (don't change the filename / timestamp).

3. **`1715000000002-TxStateTransitions.ts`** — confirm the `v_tx_current_state` view and any CHECK constraints reference only the 8 surviving states.

4. **`1715000000008-Recipients.ts`** — rewrite the table to the canonical shape locked in `src/recipients/recipient.types.ts`:

```sql
CREATE TABLE recipients (
  recipient_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES member_accounts(member_id),
  display_name TEXT NOT NULL,
  relationship TEXT,
  payout_method TEXT NOT NULL CHECK (payout_method IN ('WALLET_CHAIN','CUSTODIAL')),
  wallet_chain_id INT,
  wallet_address TEXT,
  custodial_provider TEXT,
  custodial_external_id TEXT,
  custodial_last4 TEXT,
  dispatch_status TEXT NOT NULL DEFAULT 'UNREGISTERED'
    CHECK (dispatch_status IN ('UNREGISTERED','REGISTERING','READY','FAILED')),
  dispatch_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT recipients_method_shape CHECK (
    (payout_method = 'WALLET_CHAIN' AND wallet_chain_id IS NOT NULL AND wallet_address IS NOT NULL
       AND custodial_provider IS NULL AND custodial_external_id IS NULL) OR
    (payout_method = 'CUSTODIAL' AND custodial_provider IS NOT NULL AND custodial_external_id IS NOT NULL
       AND wallet_chain_id IS NULL AND wallet_address IS NULL)
  )
);
CREATE INDEX idx_recipients_member ON recipients(member_id);
CREATE INDEX idx_recipients_member_active ON recipients(member_id, dispatch_status);
```

5. **`1715000000010-RefundExecutorAndMetrics.ts`** — drop tables/indexes specific to Path-B Rapyd or Path-C wire refunds. Keep Path-A Mesh refund tables and the generic heartbeat/lease columns.

6. **`1715000000011-MemberAuth.ts`** — likely no changes (magic-link table is generic).

7. **`database/data-source.ts`** — rename `lirabridge` → `strait` in DB URL defaults; confirm `migrations: ['migrations/*.ts']`.

8. **`test/integration/`** — drop tests for dropped paths. For tests that asserted on `BridgeService`, retarget them to `DispatchService` or convert to `it.todo(...)` placeholders.

### Phase C — Client

`/c/code/strait/client/` was copied verbatim and is the largest single piece of work.

1. **`client/package.json`** — rename to `strait-client`.
2. **`client/index.html`** — title `Strait` (not `Lira-Bridge`).
3. **`client/tsconfig.json`** / **`client/vite.config.ts`** — replace `@lira/contract` alias with `@strait/contract`.
4. **All `client/src/**/*.{ts,tsx}`** — `from '@lira/contract'` → `from '@strait/contract'`.
5. **TxState renames** — `BRIDGE_DISPATCHED → DISPATCHED`, `SETTLED_USD → SETTLED`, `FAILED_BRIDGE → FAILED_DISPATCH`; delete branches for `ILS_*` states.
6. **Member tree (`client/src/member/`)**:
   - Delete pages that let the user choose between ILS-onramp / IL-bank / mesh — the only pay-in method is now Mesh.
   - Quote page: drop FX / `fxRate` field; everything is USDC.
   - Recipient form: replace bank fields (`accountNumber`/`routingNumber`/`accountType`) with the discriminator UI:
     - `payoutMethod: WALLET_CHAIN` → `chainId` (dropdown: 1 / 8453) + `walletAddress` (0x-validated)
     - `payoutMethod: CUSTODIAL` → `providerKey` + `externalAccountId`
   - Status / SSE: rename `bridgeTransferId` → `dispatchTxHash`; drop `achEstimatedDate` UI; `railUsed: PayoutMethod`.
   - `state-labels.ts`: see CLAUDE.md §4 for the 8 surviving states.
7. **Admin tree (`client/src/admin/`)**:
   - Delete reserve-pool, Rapyd, BoG, on-ramp, Bridge-fiat-out settings pages.
   - Replace fiat-dispatch settings with a "Dispatch settings" placeholder page.
   - Compliance/audit/approvals/operator pages — keep, just update TxState references.
8. **`client/src/App.tsx` / `main.tsx`** — drop routes for deleted pages.
9. **Final grep across `client/src/**`** for the same string list as Phase A #11, plus `accountNumber`, `routingNumber`, `bank_account_last4`, `tokenizeBank`.

### Phase D — Verify

```bash
cd /c/code/strait
npm install
npm run client:install
npm run build           # nest build
npm run lint:boundaries # depcruise + check-no-process-env
npm test                # unit
npm run build:client    # vite
docker compose up -d postgres
npm run migration:run
npm run test:integration
```

Each must be green before commit. Expect 5-10 type errors after Phase A — fix them iteratively.

### Phase E — Commit

```bash
cd /c/code/strait
git init
git add .
git commit -m "$(cat <<'EOF'
Initial commit — Strait crypto-only fork of Lira-Bridge

Crypto-in / crypto-out USDC payment orchestrator. Forked from
Lira-Bridge after the ILS on-ramp (Rapyd/BoG) and Bridge.xyz fiat-out
(RTP/FedNow) paths were dropped. Retains shadow ledger, state machine,
transactional outbox, magic-link auth, admin operator surface.

New crypto-out seam: IOutboundDispatcher with ChainDispatcher
(direct on-chain USDC transfer) and CustodialDispatcher (third-party
crypto pay-out provider). Both mock-default behind MOCK_DISPATCH_ENABLED;
master gate RECIPIENT_DISPATCH_ENABLED defaults false.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Hand-off note to the next session

Three background agents were dispatched in the prior session to do Phases A / B / C in parallel. **All three hit the Anthropic session-limit reset and produced no edits** — only the new files I wrote directly are present. The bulk-copied legacy files in `src/api`, `src/admin`, `src/mesh`, `src/recipients`, `src/state-machine`, `src/events`, `src/refunds`, `src/webhooks`, `src/dev-tools`, the migrations (except the two I deleted), and the entire `client/src` tree are **still fiat-shaped** and won't typecheck.

Recommended approach for next session:
1. Run Phase A first (longest, biggest blast radius). One agent can do this if dispatched carefully — the prompt in the original session is preserved on disk at `C:\Users\Nexus\AppData\Local\Temp\claude\…\tasks\aa1fc3fcef234bc3a.output` but the agent didn't actually execute; re-issue the prompt.
2. Phase B and Phase C can run in parallel after Phase A — they don't share files.
3. Phase D is iterative typecheck-fix-typecheck. Don't delegate; do inline.
4. Phase E is one bash invocation.

Locked design decisions (do NOT renegotiate):
- Repo name: **Strait**, package: `strait`, contract package: `@strait/contract`
- Path: `C:\code\strait`
- Fresh git history (no meridian commits preserved)
- TxState (8 values): `MESH_PENDING | USDC_LOCKED | DISPATCHED | SETTLED | FAILED | FAILED_DISPATCH | REFUND_QUEUED | REFUNDED`
- PayoutMethod (2 values): `WALLET_CHAIN | CUSTODIAL`
- Crypto-out architecture: adapter pattern behind `IOutboundDispatcher`, both adapters mock-default, recipient row chooses adapter via `payout_method` discriminator
- Recipient table uses snake_case columns (DB) projected to camelCase wire contract by `RecipientsService.toPublic()`
- Postgres role: `strait_app` (replaces `lirabridge_app`), append-only grants preserved on `usdc_transactions`
