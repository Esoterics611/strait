import { DataSource } from 'typeorm';
import { newDataSource } from './db';

// LOAD-BEARING INVARIANT (CLAUDE.md §4): the application role `strait_app`
// has SELECT,INSERT only on usdc_transactions — UPDATE/DELETE are revoked, so
// the ledger is append-only at the database privilege layer (not merely by
// code discipline). Asserted against the real Postgres grant catalog; this is
// the regression oracle for every later structural phase.
describe('INTEGRATION: usdc_transactions is append-only for strait_app', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = newDataSource();
    await ds.initialize();
  });
  afterAll(async () => {
    await ds.destroy();
  });

  async function may(table: string, priv: string): Promise<boolean> {
    const rows = await ds.query<{ ok: boolean }[]>(
      `SELECT has_table_privilege('strait_app', $1, $2) AS ok`,
      [table, priv],
    );
    return rows[0].ok === true;
  }

  it('strait_app MAY SELECT and INSERT usdc_transactions', async () => {
    expect(await may('usdc_transactions', 'SELECT')).toBe(true);
    expect(await may('usdc_transactions', 'INSERT')).toBe(true);
  });

  it('strait_app may NOT UPDATE or DELETE usdc_transactions (append-only)', async () => {
    expect(await may('usdc_transactions', 'UPDATE')).toBe(false);
    expect(await may('usdc_transactions', 'DELETE')).toBe(false);
  });

  it('the same append-only rule binds the ledger/event family', async () => {
    for (const t of ['tx_state_transitions', 'processed_webhooks']) {
      expect(await may(t, 'INSERT')).toBe(true);
      expect(await may(t, 'UPDATE')).toBe(false);
      expect(await may(t, 'DELETE')).toBe(false);
    }
  });

  it('control: member_accounts IS mutable for strait_app (the oracle discriminates)', async () => {
    expect(await may('member_accounts', 'UPDATE')).toBe(true);
    expect(await may('member_accounts', 'DELETE')).toBe(true);
  });
});
