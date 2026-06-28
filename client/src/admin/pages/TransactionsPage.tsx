import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  cancelTx,
  fetchTx,
  fetchTxs,
  forceTransition,
  refundTx,
  refreshProvider,
  type TxRow,
} from '../lib/admin-api';
import { explorerUrl, fmtRelative, fmtTime, fmtUsdc, stateColor } from '../lib/format';
import { hasRole, useAdminAuth } from '../AdminAuthContext';
import { ErrorBanner } from './DashboardPage';

const STATES = [
  'MESH_PENDING', 'USDC_LOCKED', 'DISPATCHED', 'SETTLED',
  'FAILED', 'FAILED_DISPATCH', 'REFUND_QUEUED', 'REFUNDED',
];

export function TransactionsListPage(): JSX.Element {
  const [rows, setRows] = useState<TxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState('');
  const [sourceType, setSourceType] = useState('');

  useEffect(() => {
    fetchTxs({ state: state || undefined, sourceType: sourceType || undefined, limit: 100 })
      .then(setRows)
      .catch((err) => setError((err as Error).message));
  }, [state, sourceType]);

  if (error) return <ErrorBanner msg={error} />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Transactions</h1>
        <div className="flex gap-2">
          <select value={state} onChange={(e) => setState(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-sm">
            <option value="">All states</option>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-sm">
            <option value="">All sources</option>
            <option value="MESH">Mesh</option>
            <option value="ONRAMP_RAPYD">Rapyd</option>
            <option value="ONRAMP_BOG">BoG</option>
            <option value="SELF_ONRAIL">Path C</option>
          </select>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Member</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Dir</th>
              <th className="px-3 py-2 font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 font-medium">Tx</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((tx) => (
              <tr key={tx.tx_id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 text-slate-500">{fmtRelative(tx.created_at)}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  <Link className="text-sky-700 hover:underline" to={`/admin/members/${tx.member_id}`}>
                    {tx.member_id.slice(0, 8)}…
                  </Link>
                </td>
                <td className="px-3 py-2">{tx.source_type}</td>
                <td className="px-3 py-2">{tx.direction}</td>
                <td className="px-3 py-2 font-mono text-xs">{fmtUsdc(tx.amount_usdc_wei)}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${stateColor(tx.state)}`}>{tx.state}</span>
                </td>
                <td className="px-3 py-2">
                  <Link className="text-sky-700 hover:underline font-mono text-xs" to={`/admin/transactions/${tx.tx_id}`}>
                    {tx.tx_id.slice(0, 8)}…
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TransactionDetailPage(): JSX.Element {
  const { txId } = useParams<{ txId: string }>();
  const { user } = useAdminAuth();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchTx>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload(): Promise<void> {
    if (!txId) return;
    try {
      setData(await fetchTx(txId));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void reload();
  }, [txId]);

  async function onCancel(): Promise<void> {
    if (!txId) return;
    if (!confirm('Cancel this pending transaction?')) return;
    try {
      await cancelTx(txId);
      setNotice('Cancelled.');
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onRefund(): Promise<void> {
    if (!txId) return;
    try {
      const r = await refundTx(txId);
      setNotice(r.status === 'QUEUED' ? `Refund queued.` : `Refund pending approval: ${r.approvalId}`);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onForceTransition(): Promise<void> {
    if (!txId) return;
    const toState = window.prompt('Force to state (e.g. FAILED, USDC_LOCKED):');
    if (!toState) return;
    const reason = window.prompt('Reason (min 20 chars):');
    if (!reason || reason.length < 20) {
      setError('Reason must be at least 20 characters.');
      return;
    }
    try {
      const r = await forceTransition(txId, toState, reason);
      setNotice(`Force transition queued: ${JSON.stringify(r)}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onRefresh(): Promise<void> {
    if (!txId) return;
    try {
      await refreshProvider(txId);
      setNotice('Provider state refreshed.');
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (error) return <ErrorBanner msg={error} />;
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;

  const tx = data.tx;
  const canOps = hasRole(user?.role, 'ops');
  const canCompliance = hasRole(user?.role, 'compliance');

  return (
    <div className="space-y-6">
      <Link to="/admin/transactions" className="text-xs text-slate-500 hover:underline">← All transactions</Link>
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-2 rounded text-sm">{notice}</div>}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 font-mono">{tx.tx_id}</h1>
          <div className="text-sm text-slate-500 mt-1">
            {tx.source_type} · {tx.direction} · {fmtUsdc(tx.amount_usdc_wei)} · created {fmtTime(tx.created_at)}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canOps && <button onClick={onRefresh} className="border border-slate-300 px-3 py-1.5 rounded text-sm hover:bg-slate-50">Refresh provider</button>}
          {canOps && <button onClick={onCancel} className="border border-slate-300 px-3 py-1.5 rounded text-sm hover:bg-slate-50">Cancel</button>}
          {canOps && <button onClick={onRefund} className="border border-amber-300 text-amber-800 px-3 py-1.5 rounded text-sm hover:bg-amber-50">Refund</button>}
          {canCompliance && <button onClick={onForceTransition} className="border border-rose-400 text-rose-800 px-3 py-1.5 rounded text-sm hover:bg-rose-50">Force state</button>}
        </div>
      </div>
      <section>
        <h2 className="text-sm font-medium text-slate-700 mb-2">State timeline</h2>
        <div className="bg-white border border-slate-200 rounded">
          {data.timeline.length === 0 && <div className="px-3 py-4 text-sm text-slate-400">No transitions recorded.</div>}
          {data.timeline.map((t) => {
            const meta = (t.metadata ?? {}) as Record<string, unknown>;
            const hash = (meta['on_chain_tx_hash'] as string | undefined) ?? (meta['onChainTxHash'] as string | undefined);
            const chainId =
              typeof meta['chain_id'] === 'number' ? (meta['chain_id'] as number) :
              typeof meta['chainId'] === 'number' ? (meta['chainId'] as number) :
              undefined;
            return (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2 border-b border-slate-100 last:border-b-0 text-sm flex-wrap">
                <div className="text-xs text-slate-500 w-44">{fmtTime(t.occurred_at)}</div>
                <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${stateColor(t.from_state ?? '')}`}>{t.from_state ?? '∅'}</span>
                <span className="text-slate-400">→</span>
                <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${stateColor(t.to_state)}`}>{t.to_state}</span>
                {hash && (
                  <a
                    href={explorerUrl(hash, chainId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-sky-700 hover:underline font-mono text-xs"
                    title={`Open ${chainId === 1 ? 'Etherscan' : 'Basescan'}`}
                  >
                    {hash.slice(0, 10)}…↗
                  </a>
                )}
                {t.metadata && (
                  <details className="ml-auto text-xs text-slate-500">
                    <summary className="cursor-pointer">metadata</summary>
                    <pre className="text-[11px] mt-1 bg-slate-50 p-2 rounded">{JSON.stringify(t.metadata, null, 2)}</pre>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <section>
        <h2 className="text-sm font-medium text-slate-700 mb-2">Domain events</h2>
        <div className="bg-white border border-slate-200 rounded">
          {data.events.length === 0 && <div className="px-3 py-4 text-sm text-slate-400">No events recorded.</div>}
          {data.events.map((e) => (
            <div key={e.id} className="px-3 py-2 border-b border-slate-100 last:border-b-0 text-sm">
              <div className="flex items-center gap-3">
                <div className="text-xs text-slate-500 w-44">{fmtTime(e.occurred_at)}</div>
                <span className="font-mono text-xs">{e.event_type}</span>
              </div>
              <pre className="text-[11px] mt-1 bg-slate-50 p-2 rounded overflow-x-auto">{JSON.stringify(e.payload, null, 2)}</pre>
            </div>
          ))}
        </div>
      </section>
      {data.refunds.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-slate-700 mb-2">Refund jobs</h2>
          <div className="bg-white border border-slate-200 rounded">
            {data.refunds.map((r) => (
              <div key={r.job_id} className="px-3 py-2 border-b border-slate-100 last:border-b-0 text-sm flex items-center justify-between">
                <span className="font-mono text-xs">{r.job_id.slice(0, 8)}…</span>
                <span className="text-xs text-slate-500">{r.executor_path}</span>
                <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${stateColor(r.status)}`}>{r.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
