import { ConflictException, NotFoundException } from '@nestjs/common';
import { MembersAdminService } from './members-admin.service';

class FakeDS {
  rows: Array<Record<string, unknown>> = [];
  updateResults: Array<Array<{ member_id: string }>> = [];
  async query(sql: string, params?: unknown[]): Promise<unknown[]> {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('UPDATE member_accounts')) {
      if (this.updateResults.length === 0) return [];
      return this.updateResults.shift() as unknown[];
    }
    if (s.startsWith('SELECT member_id, email')) {
      return this.rows;
    }
    if (s.startsWith('SELECT * FROM member_accounts')) {
      const m = this.rows.find((r) => r.member_id === params?.[0]);
      return m ? [m] : [];
    }
    return [];
  }
}

class FakeLedger { async creditUsdc(): Promise<string> { return 'tx-mock'; } }
class FakeApprovals {
  handlers = new Map<string, unknown>();
  register(action: string, h: unknown): void { this.handlers.set(action, h); }
  async request(input: any): Promise<{ approval_id: string }> { return { approval_id: 'ap-1' }; }
}
class FakeAudit { entries: any[] = []; async write(e: any): Promise<void> { this.entries.push(e); } }

describe('MembersAdminService', () => {
  let ds: FakeDS;
  let ledger: FakeLedger;
  let approvals: FakeApprovals;
  let audit: FakeAudit;
  let svc: MembersAdminService;

  beforeEach(() => {
    ds = new FakeDS();
    ledger = new FakeLedger();
    approvals = new FakeApprovals();
    audit = new FakeAudit();
    svc = new MembersAdminService(ds as never, ledger as never, approvals as never, audit as never);
  });

  it('detail throws when member missing', async () => {
    await expect(svc.detail('not-here')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('detail returns the row when present', async () => {
    ds.rows.push({ member_id: 'm1', email: 'a@b.com', is_frozen: false });
    const r = await svc.detail('m1');
    expect(r.member_id).toBe('m1');
  });

  it('freeze writes audit + returns ok when row updated', async () => {
    ds.updateResults = [[{ member_id: 'm1' }]];
    const r = await svc.freeze('m1', 'compliance hold', 'op-1');
    expect(r.ok).toBe(true);
    expect(audit.entries[0].action).toBe('member.frozen');
  });

  it('freeze throws Conflict if already frozen', async () => {
    ds.updateResults = [[]]; // no row updated
    await expect(svc.freeze('m1', 'hold', 'op')).rejects.toBeInstanceOf(ConflictException);
  });

  it('small manual credit executes immediately', async () => {
    const r = await svc.requestManualCredit('m1', 50_000_000n, 'small comp', 'op-1', 'ops');
    expect(r.status).toBe('EXECUTED');
    expect(audit.entries[0].action).toBe('member.manual_credit');
  });

  it('large manual credit requires dual approval', async () => {
    const r = await svc.requestManualCredit('m1', 200_000_000n, 'large credit', 'op-1', 'ops');
    expect(r.status).toBe('PENDING_APPROVAL');
    expect((r as any).approvalId).toBe('ap-1');
  });

  it('rejects non-positive amounts', async () => {
    await expect(svc.requestManualCredit('m1', 0n, 'r', 'op-1', 'ops')).rejects.toThrow(/Amount must be positive/);
  });
});
