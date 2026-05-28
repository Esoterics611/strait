import { useEffect, useState } from 'react';
import {
  fetchFlags,
  fetchReserveBalance,
  fetchReserveLedger,
  requestReserveCredit,
  type ReservePoolBalance,
} from '../lib/admin-api';
import { fmtTime, fmtUsdc } from '../lib/format';
import { hasRole, useAdminAuth } from '../AdminAuthContext';
import { ErrorBanner } from './DashboardPage';

export function ReservePoolPage(): JSX.Element {
  const { user } = useAdminAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [balance, setBalance] = useState<ReservePoolBalance | null>(null);
  const [ledger, setLedger] = useState<Awaited<ReturnType<typeof fetchReserveLedger>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload(): Promise<void> {
    try {
      const flags = await fetchFlags();
      const on = flags['PATH_C_ENABLED'] === 'true';
      setEnabled(on);
      if (!on) return;
      const [b, l] = await Promise.all([fetchReserveBalance(), fetchReserveLedger()]);
      setBalance(b);
      setLedger(l);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  useEffect(() => { void reload(); }, []);

  async function onCredit(): Promise<void> {
    const amount = window.prompt('Credit amount (in USDC 6-decimal units, e.g. 1000000000 = 1,000 USDC):');
    if (!amount) return;
    const desc = window.prompt('Source description / hedge instrument id:');
    try {
      const r = await requestReserveCredit(amount, desc ?? '');
      setNotice(`Credit pending approval: ${r.approvalId}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (error) return <ErrorBanner msg={error} />;
  if (enabled === null) return <div className="text-sm text-slate-500">Loading…</div>;
  if (!enabled) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded p-6 text-sm text-slate-600">
        <h1 className="text-xl font-semibold text-slate-900 mb-2">Reserve pool</h1>
        Path C is disabled (PATH_C_ENABLED=false). Reserve pool admin endpoints return 404 to avoid leaking existence.
      </div>
    );
  }
  if (!balance) return <div className="text-sm text-slate-500">Loading…</div>;

  const canFinance = hasRole(user?.role, 'finance');
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Reserve pool</h1>
        {canFinance && (
          <button onClick={onCredit} className="border border-emerald-300 text-emerald-800 px-3 py-1.5 rounded text-sm hover:bg-emerald-50">
            Initiate credit
          </button>
        )}
      </div>
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-2 rounded text-sm">{notice}</div>}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card label="Balance">{fmtUsdc(balance.balanceUsdcUnits)}</Card>
        <Card label="Floor">{fmtUsdc(balance.floorUnits)}</Card>
        <Card label="Backend">{balance.backend}</Card>
        <Card label="Health">{balance.healthyAtMs === Infinity ? 'unhealthy' : `${balance.healthyAtMs}ms`}</Card>
      </div>
      <section>
        <h2 className="text-sm font-medium text-slate-700 mb-2">Ledger</h2>
        <div className="bg-white border border-slate-200 rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Pool after</th>
                <th className="px-3 py-2 font-medium">Related tx</th>
              </tr>
            </thead>
            <tbody>
              {ledger?.map((e) => (
                <tr key={e.entryId} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-500">{fmtTime(e.occurredAt)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{e.eventType}</td>
                  <td className="px-3 py-2 font-mono text-xs">{fmtUsdc(e.amountUsdcUnits)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{fmtUsdc(e.poolBalanceAfterUnits)}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {e.relatedTxId ? <a className="text-sky-700 hover:underline" href={`/admin/transactions/${e.relatedTxId}`}>{e.relatedTxId.slice(0, 8)}…</a> : '—'}
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

function Card({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="bg-white border border-slate-200 rounded p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xl font-semibold mt-0.5 text-slate-900 font-mono">{children}</div>
    </div>
  );
}
