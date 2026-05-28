import { useEffect, useState } from 'react';
import {
  approveRequest,
  fetchApprovalHistory,
  fetchPendingApprovals,
  rejectRequest,
  type ApprovalRow,
} from '../lib/admin-api';
import { fmtRelative, fmtTime } from '../lib/format';
import { ErrorBanner } from './DashboardPage';

export function ApprovalsPage(): JSX.Element {
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [pending, setPending] = useState<ApprovalRow[] | null>(null);
  const [history, setHistory] = useState<ApprovalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload(): Promise<void> {
    try {
      const [p, h] = await Promise.all([fetchPendingApprovals(), fetchApprovalHistory()]);
      setPending(p);
      setHistory(h);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  useEffect(() => { void reload(); }, []);

  async function onApprove(id: string): Promise<void> {
    if (!confirm('Approve this request? The handler runs immediately.')) return;
    try {
      await approveRequest(id);
      setNotice('Approved.');
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function onReject(id: string): Promise<void> {
    const note = window.prompt('Rejection note (min 5 chars):');
    if (!note || note.length < 5) return;
    try {
      await rejectRequest(id, note);
      setNotice('Rejected.');
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (error) return <ErrorBanner msg={error} />;
  const rows = tab === 'pending' ? pending : history;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Approvals</h1>
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-2 rounded text-sm">{notice}</div>}
      <div className="flex gap-1">
        <TabBtn active={tab === 'pending'} onClick={() => setTab('pending')}>
          Pending {pending && <span className="ml-1 text-xs">({pending.length})</span>}
        </TabBtn>
        <TabBtn active={tab === 'history'} onClick={() => setTab('history')}>
          History
        </TabBtn>
      </div>
      <div className="bg-white border border-slate-200 rounded">
        {rows?.length === 0 && <div className="px-3 py-8 text-center text-slate-400 text-sm">No approvals.</div>}
        {rows?.map((row) => (
          <div key={row.approval_id} className="border-b border-slate-100 last:border-b-0 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900">{row.action}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {row.target_type ?? 'system'}
                  {row.target_id && <span> · <span className="font-mono">{row.target_id.slice(0, 12)}…</span></span>}
                  · requires {row.required_role}
                  · initiated <span className="font-mono">{row.initiated_by.slice(0, 8)}…</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {tab === 'pending' ? <>expires {fmtRelative(row.expires_at)}</> : <>{row.status} at {fmtTime(row.created_at)}</>}
                </div>
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-slate-500">payload</summary>
                  <pre className="bg-slate-50 p-2 rounded text-[11px] mt-1 overflow-x-auto">{JSON.stringify(row.payload, null, 2)}</pre>
                </details>
              </div>
              {tab === 'pending' && (
                <div className="flex flex-col gap-2 shrink-0">
                  <button onClick={() => onApprove(row.approval_id)} className="border border-emerald-300 text-emerald-800 px-3 py-1.5 rounded text-sm hover:bg-emerald-50">Approve</button>
                  <button onClick={() => onReject(row.approval_id)} className="border border-rose-300 text-rose-700 px-3 py-1.5 rounded text-sm hover:bg-rose-50">Reject</button>
                </div>
              )}
              {tab === 'history' && (
                <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                  row.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800'
                  : row.status === 'REJECTED' ? 'bg-rose-100 text-rose-800'
                  : 'bg-slate-100 text-slate-700'
                }`}>{row.status}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded text-sm ${active ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
      {children}
    </button>
  );
}
