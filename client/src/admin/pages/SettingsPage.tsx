import { useEffect, useState } from 'react';
import {
  fetchCrons,
  fetchFlags,
  fetchProviders,
  flipFlag,
  runCronNow,
  type CronRow,
  type ProviderHealthRow,
} from '../lib/admin-api';
import { fmtRelative, fmtTime } from '../lib/format';
import {
  Modal,
  PrimaryButton,
  SecondaryButton,
} from '../components/Modal';
import { ErrorBanner } from './DashboardPage';
import { hasRole, useAdminAuth } from '../AdminAuthContext';

type Section = 'flags' | 'providers' | 'crons';

export function SettingsPage(): JSX.Element {
  const [section, setSection] = useState<Section>('flags');
  const { user } = useAdminAuth();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
      <div className="flex gap-1">
        <TabBtn active={section === 'flags'} onClick={() => setSection('flags')}>Feature flags</TabBtn>
        <TabBtn active={section === 'providers'} onClick={() => setSection('providers')}>Providers</TabBtn>
        <TabBtn active={section === 'crons'} onClick={() => setSection('crons')}>Crons</TabBtn>
      </div>
      {section === 'flags' && <FlagsPanel canFlip={hasRole(user?.role, 'admin')} />}
      {section === 'providers' && <ProvidersPanel />}
      {section === 'crons' && <CronsPanel canRun={hasRole(user?.role, 'ops')} />}
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

// ── Flags ────────────────────────────────────────────────────────────────

function FlagsPanel({ canFlip }: { canFlip: boolean }): JSX.Element {
  const [flags, setFlags] = useState<Record<string, string | null> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flipping, setFlipping] = useState<{ name: string; targetValue: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload(): Promise<void> {
    try {
      setFlags(await fetchFlags());
    } catch (err) {
      setError((err as Error).message);
    }
  }
  useEffect(() => { void reload(); }, []);

  function targetFor(name: string, current: string | null): string {
    if (name === 'ONRAMP_PROVIDER') return current === 'RAPYD' ? 'BOG' : 'RAPYD';
    if (current === 'true') return 'false';
    return 'true';
  }

  async function confirmFlip(): Promise<void> {
    if (!flipping) return;
    setBusy(true);
    try {
      const r = await flipFlag(flipping.name, flipping.targetValue);
      setNotice(`Flag flip queued. Approval ${r.approvalId} — pending second signature.`);
      setFlipping(null);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBanner msg={error} />;
  if (!flags) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-3">
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-2 rounded text-sm">{notice}</div>}
      <div className="bg-white border border-slate-200 rounded">
        {Object.entries(flags).map(([name, value]) => {
          const target = targetFor(name, value);
          const isPathC = name === 'PATH_C_ENABLED';
          return (
            <div key={name} className="px-4 py-3 border-b border-slate-100 last:border-b-0 flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-mono text-sm text-slate-900">{name}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  current: <span className="font-mono">{value ?? '—'}</span>
                  {isPathC && <span className="ml-2 px-1.5 py-0.5 bg-purple-100 text-purple-800 rounded text-[10px]">dual approval required</span>}
                </div>
              </div>
              {canFlip && (
                <SecondaryButton onClick={() => setFlipping({ name, targetValue: target })}>
                  Flip to <span className="font-mono ml-1">{target}</span>
                </SecondaryButton>
              )}
            </div>
          );
        })}
      </div>
      <Modal
        open={!!flipping}
        onClose={() => setFlipping(null)}
        title={`Flip flag ${flipping?.name ?? ''}`}
        footer={
          <>
            <SecondaryButton onClick={() => setFlipping(null)} disabled={busy}>Cancel</SecondaryButton>
            <PrimaryButton onClick={confirmFlip} disabled={busy}>
              {busy ? 'Submitting…' : 'Queue flip'}
            </PrimaryButton>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          This submits a pending approval to set <code className="font-mono">{flipping?.name}</code>{' '}
          to <code className="font-mono">{flipping?.targetValue}</code>.
        </p>
        {flipping?.name === 'PATH_C_ENABLED' && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 mt-3 p-2 rounded">
            <strong>Caution:</strong> activates Path C. Verify the legal + custodian readiness
            from <code className="font-mono">PATH_C_DESIGN.md</code> before approving.
          </p>
        )}
      </Modal>
    </div>
  );
}

// ── Providers ────────────────────────────────────────────────────────────

function ProvidersPanel(): JSX.Element {
  const [data, setData] = useState<{ health: ProviderHealthRow[]; keysStatus: Record<string, 'set' | 'missing'> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchProviders().then(setData).catch((err) => setError((err as Error).message));
  }, []);
  if (error) return <ErrorBanner msg={error} />;
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;

  const all = ['BRIDGE', 'RAPYD', 'MESH', 'BOG'];
  const healthByProvider = new Map(data.health.map((h) => [h.provider, h]));
  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Last success</th>
              <th className="px-3 py-2 font-medium">Last error</th>
              <th className="px-3 py-2 font-medium">Latency</th>
              <th className="px-3 py-2 font-medium">Health</th>
            </tr>
          </thead>
          <tbody>
            {all.map((p) => {
              const h = healthByProvider.get(p);
              const ok =
                h?.last_success_at &&
                (!h.last_error_at || new Date(h.last_success_at) > new Date(h.last_error_at));
              return (
                <tr key={p} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-mono">{p}</td>
                  <td className="px-3 py-2 text-slate-500">{fmtRelative(h?.last_success_at)}</td>
                  <td className="px-3 py-2 text-rose-700 text-xs max-w-md truncate">
                    {h?.last_error_message ? (
                      <span title={h.last_error_message}>{h.last_error_message}</span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{h?.last_latency_ms ?? '—'} ms</td>
                  <td className="px-3 py-2">
                    {h?.last_success_at || h?.last_error_at ? (
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                        {ok ? 'OK' : 'DEGRADED'}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">no traffic yet</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="bg-white border border-slate-200 rounded p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">API keys (configured / missing)</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {Object.entries(data.keysStatus).map(([k, status]) => (
            <div key={k} className="flex items-center justify-between text-sm">
              <span className="font-mono text-xs text-slate-700">{k}</span>
              <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${status === 'set' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>
                {status}
              </span>
            </div>
          ))}
        </div>
        <div className="text-[11px] text-slate-400 mt-3">Key values are never displayed in the admin UI.</div>
      </div>
    </div>
  );
}

// ── Crons ────────────────────────────────────────────────────────────────

function CronsPanel({ canRun }: { canRun: boolean }): JSX.Element {
  const [rows, setRows] = useState<CronRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [runningName, setRunningName] = useState<string | null>(null);

  async function reload(): Promise<void> {
    try { setRows(await fetchCrons()); } catch (err) { setError((err as Error).message); }
  }
  useEffect(() => { void reload(); }, []);

  async function onRunNow(name: string): Promise<void> {
    setRunningName(name);
    try {
      const r = await runCronNow(name);
      setNotice(`${name} ran in ${r.elapsedMs} ms`);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunningName(null);
    }
  }

  if (error) return <ErrorBanner msg={error} />;
  if (!rows) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-3">
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-2 rounded text-sm">{notice}</div>}
      <div className="bg-white border border-slate-200 rounded">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 font-medium">Cron</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Schedule</th>
              <th className="px-3 py-2 font-medium">Last fired</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.name} className="border-b border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">{c.name}</td>
                <td className="px-3 py-2 text-slate-600 text-xs">{c.description}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{c.schedule}</td>
                <td className="px-3 py-2 text-xs">
                  {c.lastFiredAt ? <span title={fmtTime(c.lastFiredAt)}>{fmtRelative(c.lastFiredAt)}</span> : <span className="text-slate-400">never</span>}
                </td>
                <td className="px-3 py-2">
                  {c.lastStatus === 'OK' && <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800">OK</span>}
                  {c.lastStatus === 'FAIL' && <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-rose-100 text-rose-800" title={c.lastError ?? ''}>FAIL</span>}
                  {!c.lastStatus && <span className="text-slate-400 text-xs">—</span>}
                </td>
                <td className="px-3 py-2">
                  {canRun && (
                    <button
                      onClick={() => onRunNow(c.name)}
                      disabled={runningName === c.name}
                      className="text-sky-700 hover:underline text-sm disabled:opacity-50"
                    >
                      {runningName === c.name ? 'Running…' : 'Run now'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
