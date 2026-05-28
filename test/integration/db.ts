import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

// docker-compose.yml / .env.example default. The integration oracle runs
// against a REAL Postgres (docker-compose `postgres`, or a local cluster with
// the same db/role) — never mocks. Override with DATABASE_URL.
export const DEFAULT_DATABASE_URL =
  'postgresql://strait:strait@localhost:5432/strait';

export function databaseUrl(): string {
  return process.env['DATABASE_URL'] || DEFAULT_DATABASE_URL;
}

export function newDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    url: databaseUrl(),
    synchronize: false,
    logging: false,
    entities: [],
  });
}

export interface SeededMember {
  memberId: string;
  bridgeCustomerId: string;
  bridgeLiquidAddress: string;
}

// Inserts a self-contained member with a unique, already-provisioned Bridge
// identity (so the legacy sender-loop path short-circuits provisionMember).
export async function seedMember(
  ds: DataSource,
  opts: { balanceUnits?: bigint; chainId?: number } = {},
): Promise<SeededMember> {
  const memberId = randomUUID();
  const hex = memberId.replace(/-/g, '');
  const bridgeLiquidAddress = '0x' + (hex + hex).slice(0, 40);
  const bridgeCustomerId = 'cust_' + hex.slice(0, 16);
  await ds.query(
    `INSERT INTO member_accounts
       (member_id, bridge_liquid_address, bridge_customer_id,
        usdc_virtual_balance_wei, preferred_inbound_path, chain_id)
     VALUES ($1, $2, $3, $4, 'MESH', $5)`,
    [
      memberId,
      bridgeLiquidAddress,
      bridgeCustomerId,
      (opts.balanceUnits ?? 0n).toString(),
      opts.chainId ?? 1,
    ],
  );
  return { memberId, bridgeCustomerId, bridgeLiquidAddress };
}

// Owner-role cleanup (strait owns the tables — the append-only grant
// restriction only binds strait_app). Tests must not leak rows into the
// shared dev database.
export async function cleanupMember(
  ds: DataSource,
  memberId: string,
): Promise<void> {
  await ds.query(
    `DELETE FROM outbox_events
      WHERE aggregate_id IN (SELECT tx_id FROM usdc_transactions WHERE member_id = $1)`,
    [memberId],
  );
  await ds.query(
    `DELETE FROM tx_state_transitions
      WHERE tx_id IN (SELECT tx_id FROM usdc_transactions WHERE member_id = $1)`,
    [memberId],
  );
  await ds.query(`DELETE FROM usdc_transactions WHERE member_id = $1`, [
    memberId,
  ]);
  await ds.query(`DELETE FROM member_accounts WHERE member_id = $1`, [memberId]);
}
