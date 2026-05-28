import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DualApprovalService } from './dual-approval.service';
import { PendingApprovalRow } from './pending-approval.repository';

class FakeApprovals {
  rows = new Map<string, PendingApprovalRow>();
  async create(input: any): Promise<PendingApprovalRow> {
    const row: PendingApprovalRow = {
      approval_id: `appr-${this.rows.size + 1}`,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      initiated_by: input.initiatedBy,
      required_role: input.requiredRole,
      payload: input.payload,
      status: 'PENDING',
      resolved_by: null,
      resolution_note: null,
      result: null,
      expires_at: new Date(Date.now() + 3600_000),
      created_at: new Date(),
      resolved_at: null,
    };
    this.rows.set(row.approval_id, row);
    return row;
  }
  async findById(id: string): Promise<PendingApprovalRow | null> {
    return this.rows.get(id) ?? null;
  }
  async resolve(id: string, by: string, status: any, note: string | null, result?: any): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.status !== 'PENDING') return false;
    r.status = status;
    r.resolved_by = by;
    r.resolution_note = note;
    r.result = result ?? null;
    r.resolved_at = new Date();
    return true;
  }
  async listForRole(): Promise<PendingApprovalRow[]> { return []; }
  async listHistory(): Promise<PendingApprovalRow[]> { return []; }
  async expireStale(): Promise<number> { return 0; }
}

class FakeAudit {
  entries: any[] = [];
  async write(input: any): Promise<void> { this.entries.push(input); }
  async list(): Promise<any[]> { return this.entries; }
}

describe('DualApprovalService', () => {
  let approvals: FakeApprovals;
  let audit: FakeAudit;
  let service: DualApprovalService;

  beforeEach(() => {
    approvals = new FakeApprovals();
    audit = new FakeAudit();
    service = new DualApprovalService(approvals as never, audit as never);
  });

  it('rejects request for unregistered action', async () => {
    await expect(service.request({
      action: 'nope',
      requiredRole: 'ops',
      initiatedBy: 'u1',
      initiatorRole: 'ops',
      payload: {},
    })).rejects.toThrow(/No handler registered/);
  });

  it('approval round-trip: request → approve → handler runs', async () => {
    const calls: Array<{ payload: any; approver: string }> = [];
    service.register('demo', async (payload, approver) => {
      calls.push({ payload, approver });
      return { ok: true };
    });
    const row = await service.request({
      action: 'demo',
      requiredRole: 'compliance',
      initiatedBy: 'alice',
      initiatorRole: 'ops',
      payload: { hello: 'world' },
    });
    const result = await service.approve(row.approval_id, 'bob', 'compliance');
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ payload: { hello: 'world' }, approver: 'bob' }]);
    const stored = await approvals.findById(row.approval_id);
    expect(stored!.status).toBe('APPROVED');
    expect(stored!.resolved_by).toBe('bob');
  });

  it('initiator cannot self-approve', async () => {
    service.register('demo', async () => ({ ok: true }));
    const row = await service.request({
      action: 'demo', requiredRole: 'compliance',
      initiatedBy: 'alice', initiatorRole: 'compliance', payload: {},
    });
    await expect(service.approve(row.approval_id, 'alice', 'compliance')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approver must have sufficient role', async () => {
    service.register('demo', async () => ({ ok: true }));
    const row = await service.request({
      action: 'demo', requiredRole: 'compliance',
      initiatedBy: 'alice', initiatorRole: 'ops', payload: {},
    });
    await expect(service.approve(row.approval_id, 'bob', 'ops')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejected requests cannot be re-approved', async () => {
    service.register('demo', async () => ({ ok: true }));
    const row = await service.request({
      action: 'demo', requiredRole: 'compliance',
      initiatedBy: 'alice', initiatorRole: 'ops', payload: {},
    });
    await service.reject(row.approval_id, 'bob', 'compliance', 'looks wrong');
    await expect(service.approve(row.approval_id, 'bob', 'compliance')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('handler failure does not resolve the approval', async () => {
    service.register('demo', async () => { throw new Error('boom'); });
    const row = await service.request({
      action: 'demo', requiredRole: 'compliance',
      initiatedBy: 'alice', initiatorRole: 'ops', payload: {},
    });
    await expect(service.approve(row.approval_id, 'bob', 'compliance')).rejects.toThrow('boom');
    const stored = await approvals.findById(row.approval_id);
    expect(stored!.status).toBe('PENDING');
  });

  it('non-existent approval throws NotFoundException', async () => {
    await expect(service.approve('missing', 'bob', 'admin')).rejects.toBeInstanceOf(NotFoundException);
  });
});
