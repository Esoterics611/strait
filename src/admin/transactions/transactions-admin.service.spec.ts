import { NotFoundException } from '@nestjs/common';
import { TransactionsAdminService } from './transactions-admin.service';
import { TxState, SourceType } from '@common/enums';

class FakeDS {
  txByTxId = new Map<string, { amount_usdc_wei: string; source_type: SourceType }>();
  inserts: Array<{ sql: string; params: unknown[] }> = [];
  async query(sql: string, params?: unknown[]): Promise<unknown[]> {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT amount_usdc_wei, source_type FROM usdc_transactions')) {
      const tx = this.txByTxId.get(params?.[0] as string);
      return tx ? [tx] : [];
    }
    if (s.startsWith('SELECT source_type, bridge_transfer_id')) {
      const tx = this.txByTxId.get(params?.[0] as string);
      return tx ? [{ source_type: tx.source_type, bridge_transfer_id: null }] : [];
    }
    if (s.startsWith('INSERT INTO tx_state_transitions')) {
      this.inserts.push({ sql: s, params: params ?? [] });
      return [];
    }
    return [];
  }
}
class FakeBridge {}
class FakeStateMachine {
  states = new Map<string, TxState>();
  async getCurrentState(txId: string): Promise<TxState> {
    return this.states.get(txId) ?? TxState.USDC_LOCKED;
  }
  async transition(_txId: string, _to: TxState): Promise<void> {}
}
class FakeApprovals {
  handlers = new Map<string, unknown>();
  register(action: string, h: unknown): void { this.handlers.set(action, h); }
  async request(input: any): Promise<{ approval_id: string }> { return { approval_id: 'ap-tx' }; }
}
class FakeAudit { entries: any[] = []; async write(e: any): Promise<void> { this.entries.push(e); } }
class FakeRefunds {
  jobs: Array<{ txId: string; amount: bigint }> = [];
  async enqueue(txId: string, _by: string, amount: bigint, executor: string): Promise<any> {
    this.jobs.push({ txId, amount });
    return { row: { job_id: `job-${this.jobs.length}`, status: 'QUEUED', executor_path: executor }, created: true };
  }
}

describe('TransactionsAdminService', () => {
  let ds: FakeDS;
  let sm: FakeStateMachine;
  let approvals: FakeApprovals;
  let audit: FakeAudit;
  let refunds: FakeRefunds;
  let svc: TransactionsAdminService;

  beforeEach(() => {
    ds = new FakeDS();
    sm = new FakeStateMachine();
    approvals = new FakeApprovals();
    audit = new FakeAudit();
    refunds = new FakeRefunds();
    svc = new TransactionsAdminService(
      ds as never,
      new FakeBridge() as never,
      sm as never,
      approvals as never,
      audit as never,
      refunds as never,
    );
  });

  it('refund < $100 enqueues immediately', async () => {
    ds.txByTxId.set('tx1', { amount_usdc_wei: '50000000', source_type: SourceType.MESH });
    const r = await svc.requestRefund('tx1', 'op1', 'ops');
    expect(r.status).toBe('QUEUED');
    expect(refunds.jobs[0].amount).toBe(50_000_000n);
    expect(audit.entries.find((e) => e.action === 'tx.refund_queued')).toBeTruthy();
  });

  it('refund >= $100 requests dual approval', async () => {
    ds.txByTxId.set('tx1', { amount_usdc_wei: '500000000', source_type: SourceType.ONRAMP_RAPYD });
    const r = await svc.requestRefund('tx1', 'op1', 'ops');
    expect(r.status).toBe('PENDING_APPROVAL');
    expect((r as any).approvalId).toBe('ap-tx');
  });

  it('refund of missing tx throws', async () => {
    await expect(svc.requestRefund('missing', 'op1', 'ops')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('force transition rejects short reasons', async () => {
    await expect(svc.requestForceTransition('tx1', TxState.FAILED, 'too short', 'op1', 'compliance')).rejects.toThrow(/at least 20/);
  });

  it('force transition with valid reason queues an approval', async () => {
    const r = await svc.requestForceTransition(
      'tx1',
      TxState.FAILED,
      'manual override after provider outage on 2026-05-15',
      'op1',
      'compliance',
    );
    expect(r.status).toBe('PENDING_APPROVAL');
    expect((r as any).approvalId).toBe('ap-tx');
  });

  it('cancel rejects from terminal states', async () => {
    sm.states.set('tx1', TxState.SETTLED_USD);
    await expect(svc.cancel('tx1', 'op1')).rejects.toThrow(/Cannot cancel/);
  });

  it('cancel succeeds from MESH_PENDING', async () => {
    sm.states.set('tx1', TxState.MESH_PENDING);
    const r = await svc.cancel('tx1', 'op1');
    expect(r.ok).toBe(true);
    expect(audit.entries[0].action).toBe('tx.cancel');
  });
});
