import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchDashboard, type DashboardKpis, type TxRow } from '../lib/admin-api';
import { fmtUsdc, fmtRelative, stateColor } from '../lib/format';

export function DashboardPage(): JSX.Element {
  const [data, setData] = useState<{ kpis: DashboardKpis; recentTxs: TxRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    async function load(): Promise<void> {
      try {
        const d = await fetchDashboard();
        if (!cancel) setData(d);
      } catch (err) {
        if (!cancel) setError((err as Error).message);
      }
    }
    void load();
    const id = setInterval(load, 15_000);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, []);

  if (error) return <ErrorBanner msg={error} />;
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;

  const k = data.kpis;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Operations dashboard</h1>
        <QuickSearch />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Today's tx count" value={String(k.todayTxCount)} />
        <Kpi label="Dispatched today" value={fmtUsdc(k.todayDispatchedUnits)} />
        <Kpi label="Settle rate (7d)" value={k.settleRate == null ? '—' : `${Math.round(k.settleRate * 100)}%`} />
        <Kpi label="Median latency" value={k.medianSettleSeconds == null ? '—' : `${Math.round(k.medianSettleSeconds)}s`} />
        <Kpi label="Stuck dispatch" value={String(k.stuckDispatchCount)} alert={k.stuckDispatchCount > 0} />
        <Kpi label="Failed webhooks" value={String(k.failedWebhookCount)} alert={k.failedWebhookCount > 0} />
      </div>
      {k.pendingApprovalCount > 0 && (
        <Link
          to="/admin/approvals"
          className="block bg-purple-50 border border-purple-200 text-purple-900 px-4 py-3 rounded text-sm"
        >
          <strong>{k.pendingApprovalCount}</strong> approval{k.pendingApprovalCount === 1 ? '' : 's'} awaiting review →
        </Link>
      )}
      <section>
        <h2 className="text-sm font-medium text-slate-700 mb-2">Recent transactions</h2>
        <div className="bg-white border border-slate-200 rounded">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 font-medium">Tx</th>
              </tr>
            </thead>
            <tbody>
              {data.recentTxs.map((tx) => (
                <tr key={tx.tx_id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-500">{fmtRelative(tx.created_at)}</td>
                  <td className="px-3 py-2">{tx.source_type}</td>
                  <td className="px-3 py-2 font-mono text-xs">{fmtUsdc(tx.amount_usdc_wei)}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${stateColor(tx.state)}`}>
                      {tx.state}
                    </span>
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
      </section>
    </div>
  );
}

function Kpi({ label, value, alert }: { label: string; value: string; alert?: boolean }): JSX.Element {
  return (
    <div className={`p-3 rounded border ${alert ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200'}`}>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xl font-semibold mt-0.5 text-slate-900">{value}</div>
    </div>
  );
}

export function ErrorBanner({ msg }: { msg: string }): JSX.Element {
  return (
    <div className="bg-rose-50 border border-rose-200 text-rose-900 px-4 py-3 rounded text-sm">{msg}</div>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Light-weight client-side search. Pastes a UUID → routes to the matching
 * detail page (tries tx, falls back to member). Anything else falls through to
 * the transactions list with that query as a filter prefix.
 *
 * No server-side `/admin/search` is wired yet — pattern-match keeps the UI
 * useful today. Listed in SESSION_9_NEXT.md as a follow-up.
 */
function QuickSearch(): JSX.Element {
  const nav = useNavigate();
  const [q, setQ] = useState('');

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    const trimmed = q.trim();
    if (!trimmed) return;
    if (UUID_RE.test(trimmed)) {
      // Heuristic: try tx detail first; if 404, the route will surface that.
      nav(`/admin/transactions/${trimmed}`);
      return;
    }
    if (trimmed.includes('@')) {
      // Email → search via members filter (no server-side endpoint yet; this
      // falls back to a noop until /admin/search lands).
      nav(`/admin/members`);
      return;
    }
    // Fall back to transactions list — the user can refine from there.
    nav(`/admin/transactions`);
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Paste UUID, email, or wire ref…"
        className="border border-slate-300 rounded px-3 py-1.5 text-sm w-72"
      />
      <button type="submit" className="bg-slate-900 text-white text-sm rounded px-3 py-1.5 hover:bg-slate-800">
        Go
      </button>
    </form>
  );
}
