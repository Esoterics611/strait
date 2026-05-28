import { useEffect, useMemo, useState } from 'react';
import {
  exportDownload,
  exportStatus,
  fetchDailyVolume,
  fetchFailedPayments,
  fetchFlags,
  fetchFxRatesReport,
  fetchReservePoolReport,
  fetchSettlementRates,
  startExport,
} from '../lib/admin-api';
import { fmtTime, fmtUsdc } from '../lib/format';
import { GroupedBarChart, LineChart, type SeriesPoint } from '../components/BarChart';
import { SecondaryButton } from '../components/Modal';
import { hasRole, useAdminAuth } from '../AdminAuthContext';
import { ErrorBanner } from './DashboardPage';

type Tab = 'daily-volume' | 'settlement-rates' | 'fx-rates' | 'failed-payments' | 'reserve-pool';

export function ReportsPage(): JSX.Element {
  const { user } = useAdminAuth();
  const [tab, setTab] = useState<Tab>('daily-volume');
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [pathCEnabled, setPathCEnabled] = useState(false);

  useEffect(() => {
    fetchFlags().then((f) => setPathCEnabled(f['PATH_C_ENABLED'] === 'true')).catch(() => {});
  }, []);

  const canExport = hasRole(user?.role, 'finance');

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
      <div className="bg-white border border-slate-200 rounded p-3 flex items-end gap-3 flex-wrap">
        <DateField label="From" value={from} onChange={setFrom} />
        <DateField label="To" value={to} onChange={setTo} />
        <div className="text-xs text-slate-400 ml-auto">Data as of {fmtTime(new Date())}</div>
      </div>
      <div className="flex gap-1 flex-wrap">
        <TabBtn active={tab === 'daily-volume'} onClick={() => setTab('daily-volume')}>Daily volume</TabBtn>
        <TabBtn active={tab === 'settlement-rates'} onClick={() => setTab('settlement-rates')}>Settlement rates</TabBtn>
        <TabBtn active={tab === 'fx-rates'} onClick={() => setTab('fx-rates')}>FX rates</TabBtn>
        <TabBtn active={tab === 'failed-payments'} onClick={() => setTab('failed-payments')}>Failed payments</TabBtn>
        {pathCEnabled && (
          <TabBtn active={tab === 'reserve-pool'} onClick={() => setTab('reserve-pool')}>Reserve pool</TabBtn>
        )}
      </div>
      {tab === 'daily-volume' && <DailyVolumePanel from={from} to={to} canExport={canExport} />}
      {tab === 'settlement-rates' && <SettlementPanel canExport={canExport} from={from} to={to} />}
      {tab === 'fx-rates' && <FxRatesPanel canExport={canExport} from={from} to={to} />}
      {tab === 'failed-payments' && <FailedPaymentsPanel />}
      {tab === 'reserve-pool' && pathCEnabled && <ReservePoolReportPanel />}
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }): JSX.Element {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-700 mb-1">{label}</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-sm" />
    </label>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded text-sm ${active ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
      {children}
    </button>
  );
}

// ── Daily volume ─────────────────────────────────────────────────────────

function DailyVolumePanel({ from, to, canExport }: { from: string; to: string; canExport: boolean }): JSX.Element {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchDailyVolume>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDailyVolume(from, to).then(setRows).catch((err) => setError((err as Error).message));
  }, [from, to]);

  const chartData: SeriesPoint[] = useMemo(() => {
    if (!rows) return [];
    const byDay = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const day = r.day.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, {});
      byDay.get(day)![r.source_type] = Number(r.amount_units) / 1_000_000;
    }
    return Array.from(byDay.entries())
      .map(([day, values]) => ({ label: day.slice(5), values }))
      .reverse();
  }, [rows]);

  if (error) return <ErrorBanner msg={error} />;
  if (!rows) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded p-3">
        <div className="text-sm font-medium text-slate-700 mb-2">Volume by day (USDC, stacked by source)</div>
        <GroupedBarChart data={chartData} yFormat={(n) => `$${n.toLocaleString()}`} />
      </div>
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
          <div className="text-xs uppercase text-slate-500">Detail ({rows.length} rows)</div>
          {canExport && <ExportButton report="daily-volume" from={from} to={to} />}
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 font-medium">Day</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Tx count</th>
              <th className="px-3 py-2 font-medium">Total USDC</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="px-3 py-2 text-xs text-slate-500">{r.day.slice(0, 10)}</td>
                <td className="px-3 py-2 text-xs">{r.source_type}</td>
                <td className="px-3 py-2 text-xs font-mono">{r.tx_count}</td>
                <td className="px-3 py-2 text-xs font-mono">{fmtUsdc(r.amount_units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Settlement rates ─────────────────────────────────────────────────────

function SettlementPanel({ from, to, canExport }: { from: string; to: string; canExport: boolean }): JSX.Element {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchSettlementRates>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettlementRates().then(setRows).catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <ErrorBanner msg={error} />;
  if (!rows) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
        <div className="text-xs uppercase text-slate-500">Last 30 days</div>
        {canExport && <ExportButton report="settlement-rates" from={from} to={to} />}
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
          <tr>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Settled / Total</th>
            <th className="px-3 py-2 font-medium w-1/3">Settle %</th>
            <th className="px-3 py-2 font-medium">p50 latency</th>
            <th className="px-3 py-2 font-medium">p95 latency</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const settled = Number(r.settled);
            const total = Number(r.total);
            const pct = total === 0 ? 0 : (settled / total) * 100;
            return (
              <tr key={i} className="border-b border-slate-100">
                <td className="px-3 py-2 text-xs">{r.source_type}</td>
                <td className="px-3 py-2 text-xs font-mono">{settled} / {total}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-100 rounded h-2 overflow-hidden">
                      <div className="bg-emerald-500 h-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-mono w-12 text-right">{pct.toFixed(1)}%</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs font-mono">{r.p50_seconds ? `${Math.round(Number(r.p50_seconds))}s` : '—'}</td>
                <td className="px-3 py-2 text-xs font-mono">{r.p95_seconds ? `${Math.round(Number(r.p95_seconds))}s` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── FX rates ─────────────────────────────────────────────────────────────

function FxRatesPanel({ from, to, canExport }: { from: string; to: string; canExport: boolean }): JSX.Element {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchFxRatesReport>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFxRatesReport().then(setRows).catch((err) => setError((err as Error).message));
  }, []);

  const lineData = useMemo(() => {
    if (!rows) return [];
    return [...rows].reverse().map((r) => ({
      label: r.day.slice(5, 10),
      min: Number(r.min_rate ?? 0),
      median: Number(r.median_rate ?? 0),
      max: Number(r.max_rate ?? 0),
    }));
  }, [rows]);

  if (error) return <ErrorBanner msg={error} />;
  if (!rows) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded p-3">
        <div className="text-sm font-medium text-slate-700 mb-2">ILS→USDC rate (Path B fx_rate_snapshot per tx, daily aggregate)</div>
        <LineChart data={lineData} />
      </div>
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
          <div className="text-xs uppercase text-slate-500">Detail</div>
          {canExport && <ExportButton report="fx-rates" from={from} to={to} />}
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 font-medium">Day</th>
              <th className="px-3 py-2 font-medium">Min</th>
              <th className="px-3 py-2 font-medium">Median</th>
              <th className="px-3 py-2 font-medium">Max</th>
              <th className="px-3 py-2 font-medium">Tx</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="px-3 py-2 text-xs text-slate-500">{r.day.slice(0, 10)}</td>
                <td className="px-3 py-2 text-xs font-mono">{r.min_rate}</td>
                <td className="px-3 py-2 text-xs font-mono">{r.median_rate}</td>
                <td className="px-3 py-2 text-xs font-mono">{r.max_rate}</td>
                <td className="px-3 py-2 text-xs font-mono">{r.tx_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Failed payments ──────────────────────────────────────────────────────

function FailedPaymentsPanel(): JSX.Element {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchFailedPayments>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchFailedPayments().then(setRows).catch((err) => setError((err as Error).message));
  }, []);
  if (error) return <ErrorBanner msg={error} />;
  if (!rows) return <div className="text-sm text-slate-500">Loading…</div>;

  const sorted = [...rows].sort((a, b) => Number(b.n) - Number(a.n));
  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
          <tr>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Reason</th>
            <th className="px-3 py-2 font-medium text-right">Count</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="px-3 py-2 text-xs">{r.source_type}</td>
              <td className="px-3 py-2 text-xs font-mono">{r.reason}</td>
              <td className="px-3 py-2 text-xs font-mono text-right">{r.n}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={3} className="px-3 py-8 text-center text-slate-400 text-sm">No failures in the last 30 days.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Reserve pool report ──────────────────────────────────────────────────

function ReservePoolReportPanel(): JSX.Element {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchReservePoolReport>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchReservePoolReport().then(setRows).catch((err) => setError((err as Error).message));
  }, []);

  const chartData: SeriesPoint[] = useMemo(() => {
    if (!rows) return [];
    return [...rows].reverse().map((r) => ({
      label: r.day.slice(5, 10),
      values: {
        Credits: Number(r.credits ?? 0) / 1_000_000,
        Debits: Number(r.debits ?? 0) / 1_000_000,
      },
    }));
  }, [rows]);

  if (error) return <ErrorBanner msg={error} />;
  if (!rows) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded p-3">
        <div className="text-sm font-medium text-slate-700 mb-2">Reserve pool daily movement (USDC)</div>
        <GroupedBarChart data={chartData} yFormat={(n) => `$${n.toLocaleString()}`} />
      </div>
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 font-medium">Day</th>
              <th className="px-3 py-2 font-medium">Credits</th>
              <th className="px-3 py-2 font-medium">Debits</th>
              <th className="px-3 py-2 font-medium">Ending balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="px-3 py-2 text-xs text-slate-500">{r.day.slice(0, 10)}</td>
                <td className="px-3 py-2 text-xs font-mono">{fmtUsdc(r.credits ?? '0')}</td>
                <td className="px-3 py-2 text-xs font-mono">{fmtUsdc(r.debits ?? '0')}</td>
                <td className="px-3 py-2 text-xs font-mono">{fmtUsdc(r.ending_balance ?? '0')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Export button (with polling + CSV download) ──────────────────────────

function ExportButton({
  report,
  from,
  to,
}: {
  report: 'daily-volume' | 'settlement-rates' | 'fx-rates';
  from: string;
  to: string;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function onExport(): Promise<void> {
    setBusy(true);
    setError(null);
    setProgress('Queueing…');
    try {
      const { jobId } = await startExport(report, from, to);
      setProgress('Running…');
      let attempts = 0;
      while (attempts < 60) {
        await new Promise((r) => setTimeout(r, 1000));
        const status = await exportStatus(jobId);
        if (status.status === 'DONE') {
          setProgress('Downloading…');
          const { rows } = await exportDownload(jobId);
          downloadAsCsv(`${report}-${from}-to-${to}.csv`, rows as Array<Record<string, unknown>>);
          setProgress(null);
          setBusy(false);
          return;
        }
        if (status.status === 'FAILED') {
          throw new Error(status.error ?? 'export failed');
        }
        attempts++;
      }
      throw new Error('export timed out');
    } catch (err) {
      setError((err as Error).message);
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {error && <span className="text-rose-700 text-xs">{error}</span>}
      {progress && <span className="text-slate-500 text-xs">{progress}</span>}
      <SecondaryButton onClick={onExport} disabled={busy}>
        {busy ? 'Exporting…' : 'Export CSV'}
      </SecondaryButton>
    </div>
  );
}

function downloadAsCsv(filename: string, rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) {
    alert('No rows to export.');
    return;
  }
  const keys = Object.keys(rows[0]);
  const csv = [
    keys.join(','),
    ...rows.map((r) =>
      keys
        .map((k) => {
          const v = r[k];
          const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
          return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    ),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
