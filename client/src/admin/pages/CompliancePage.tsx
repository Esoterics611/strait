import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchAuditExport,
  fetchBlocklist,
  fetchKycQueue,
  fetchOfacQueue,
  patchBlocklist,
  requestOfacOverride,
  setKyc,
} from '../lib/admin-api';
import { fmtRelative, fmtTime } from '../lib/format';
import {
  Field,
  Modal,
  PrimaryButton,
  SecondaryButton,
  TextArea,
} from '../components/Modal';
import { ErrorBanner } from './DashboardPage';

type Tab = 'kyc' | 'ofac' | 'blocklist' | 'audit';

export function CompliancePage(): JSX.Element {
  const [tab, setTab] = useState<Tab>('kyc');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Compliance</h1>
      <div className="flex gap-1 flex-wrap">
        <TabBtn active={tab === 'kyc'} onClick={() => setTab('kyc')}>KYC queue</TabBtn>
        <TabBtn active={tab === 'ofac'} onClick={() => setTab('ofac')}>OFAC review</TabBtn>
        <TabBtn active={tab === 'blocklist'} onClick={() => setTab('blocklist')}>Blocklist</TabBtn>
        <TabBtn active={tab === 'audit'} onClick={() => setTab('audit')}>Audit export</TabBtn>
      </div>
      {tab === 'kyc' && <KycQueuePanel />}
      {tab === 'ofac' && <OfacQueuePanel />}
      {tab === 'blocklist' && <BlocklistPanel />}
      {tab === 'audit' && <AuditExportPanel />}
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

// ── KYC queue ────────────────────────────────────────────────────────────

function KycQueuePanel(): JSX.Element {
  const [rows, setRows] = useState<Array<{ member_id: string; email: string | null; created_at: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload(): Promise<void> {
    try { setRows(await fetchKycQueue()); } catch (err) { setError((err as Error).message); }
  }
  useEffect(() => { void reload(); }, []);

  async function onSet(memberId: string, status: 'VERIFIED' | 'REJECTED'): Promise<void> {
    try {
      await setKyc(memberId, status);
      setNotice(`Member ${memberId.slice(0, 8)} marked ${status}.`);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (error) return <ErrorBanner msg={error} />;
  return (
    <div className="space-y-3">
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-2 rounded text-sm">{notice}</div>}
      <div className="bg-white border border-slate-200 rounded">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 font-medium">Member</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Submitted</th>
              <th className="px-3 py-2 font-medium">Decision</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((m) => (
              <tr key={m.member_id} className="border-b border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link to={`/admin/members/${m.member_id}`} className="text-sky-700 hover:underline">{m.member_id.slice(0, 8)}…</Link>
                </td>
                <td className="px-3 py-2">{m.email ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{fmtRelative(m.created_at)}</td>
                <td className="px-3 py-2 space-x-2">
                  <button onClick={() => onSet(m.member_id, 'VERIFIED')} className="text-emerald-700 hover:underline text-sm">Verify</button>
                  <button onClick={() => onSet(m.member_id, 'REJECTED')} className="text-rose-700 hover:underline text-sm">Reject</button>
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-400 text-sm">No members awaiting KYC.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── OFAC queue ───────────────────────────────────────────────────────────

function OfacQueuePanel(): JSX.Element {
  const [rows, setRows] = useState<Array<{ entry_id: string; metadata: Record<string, unknown> | null; occurred_at: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overriding, setOverriding] = useState<{ memberId: string } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function reload(): Promise<void> {
    try { setRows(await fetchOfacQueue()); } catch (err) { setError((err as Error).message); }
  }
  useEffect(() => { void reload(); }, []);

  async function submitOverride(): Promise<void> {
    if (!overriding) return;
    if (reason.length < 20) {
      setError('Reason must be at least 20 characters.');
      return;
    }
    setBusy(true);
    try {
      const r = await requestOfacOverride(overriding.memberId, reason);
      setNotice(`Override pending approval ${r.approvalId}.`);
      setOverriding(null);
      setReason('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBanner msg={error} />;
  return (
    <div className="space-y-3">
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-2 rounded text-sm">{notice}</div>}
      <div className="bg-white border border-slate-200 rounded">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Member</th>
              <th className="px-3 py-2 font-medium">Reason</th>
              <th className="px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => {
              const memberId = (r.metadata?.['memberId'] as string | undefined) ?? '';
              const cat = (r.metadata?.['category'] as string | undefined) ?? '';
              const reason = (r.metadata?.['reason'] as string | undefined) ?? '';
              return (
                <tr key={r.entry_id} className="border-b border-slate-100">
                  <td className="px-3 py-2 text-xs text-slate-500">{fmtRelative(r.occurred_at)}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {memberId ? (
                      <Link to={`/admin/members/${memberId}`} className="text-sky-700 hover:underline">{memberId.slice(0, 8)}…</Link>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {cat && <span className="font-mono text-[10px] mr-2 text-slate-400">{cat}</span>}
                    {reason}
                  </td>
                  <td className="px-3 py-2">
                    {memberId && (
                      <button onClick={() => setOverriding({ memberId })} className="text-sky-700 hover:underline text-sm">
                        Override block
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows && rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-400 text-sm">No OFAC events.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Modal
        open={!!overriding}
        onClose={() => { setOverriding(null); setReason(''); }}
        title="Override OFAC block"
        maxWidth="max-w-lg"
        footer={
          <>
            <SecondaryButton onClick={() => { setOverriding(null); setReason(''); }} disabled={busy}>Cancel</SecondaryButton>
            <PrimaryButton onClick={submitOverride} disabled={busy || reason.length < 20}>
              {busy ? 'Submitting…' : 'Queue override'}
            </PrimaryButton>
          </>
        }
      >
        <p className="text-sm text-slate-700 mb-3">
          Override the OFAC block for member <code className="font-mono">{overriding?.memberId.slice(0, 8)}…</code>.
          Requires a second compliance approval. Logged loudly in the audit log.
        </p>
        <Field label="Reason (≥ 20 chars)">
          <TextArea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder="Describe why this block is a false positive (compliance memo / case ID / etc.)"
          />
        </Field>
      </Modal>
    </div>
  );
}

// ── Blocklist editor ─────────────────────────────────────────────────────

function BlocklistPanel(): JSX.Element {
  const [list, setList] = useState<{ entries: Array<{ addressHash: string }>; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function reload(): Promise<void> {
    try { setList(await fetchBlocklist()); } catch (err) { setError((err as Error).message); }
  }
  useEffect(() => { void reload(); }, []);

  async function submitEdit(): Promise<void> {
    setBusy(true);
    try {
      const r = await patchBlocklist(draft);
      setNotice(`Blocklist update pending approval ${r.approvalId}.`);
      setEditorOpen(false);
      setDraft('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBanner msg={error} />;
  return (
    <div className="space-y-3">
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-2 rounded text-sm">{notice}</div>}
      <div className="bg-white border border-slate-200 rounded p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-medium text-slate-900">OFAC blocklist</div>
            <div className="text-xs text-slate-500">{list?.count ?? 0} entries — addresses shown as SHA-256 hash prefix only</div>
          </div>
          <PrimaryButton onClick={() => setEditorOpen(true)}>Edit blocklist</PrimaryButton>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {list?.entries.map((e) => (
            <div key={e.addressHash} className="bg-slate-50 border border-slate-200 rounded p-2 font-mono text-xs">
              {e.addressHash}…
            </div>
          ))}
          {list && list.entries.length === 0 && <div className="text-slate-400 text-sm">Empty.</div>}
        </div>
      </div>
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title="Edit OFAC blocklist"
        maxWidth="max-w-2xl"
        footer={
          <>
            <SecondaryButton onClick={() => setEditorOpen(false)} disabled={busy}>Cancel</SecondaryButton>
            <PrimaryButton onClick={submitEdit} disabled={busy || !draft}>
              {busy ? 'Submitting…' : 'Queue update'}
            </PrimaryButton>
          </>
        }
      >
        <p className="text-xs text-slate-500 mb-2">
          Comma-separated addresses (lowercase 0x…). The value is stored via SECRET_PROVIDER.
          Requires compliance approval before it takes effect.
        </p>
        <TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          placeholder="0xabc...,0xdef..."
        />
      </Modal>
    </div>
  );
}

// ── Audit export ─────────────────────────────────────────────────────────

function AuditExportPanel(): JSX.Element {
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    setBusy(true);
    try {
      setRows(await fetchAuditExport(from, to));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function download(): void {
    if (!rows) return;
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `admin-audit-${from}_${to}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) return <ErrorBanner msg={error} />;
  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded p-4 flex items-end gap-3 flex-wrap">
        <Field label="From">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-sm" />
        </Field>
        <Field label="To">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-sm" />
        </Field>
        <PrimaryButton onClick={load} disabled={busy}>{busy ? 'Loading…' : 'Load audit log'}</PrimaryButton>
        {rows && <SecondaryButton onClick={download}>Download JSON</SecondaryButton>}
      </div>
      {rows && (
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <div className="text-xs text-slate-500 px-3 py-2 border-b border-slate-200">
            {rows.length} rows from {fmtTime(from)} to {fmtTime(to)}
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Operator</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r) => {
                const targetId = typeof r['target_id'] === 'string' ? (r['target_id'] as string) : null;
                return (
                  <tr key={r['entry_id'] as string} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-xs text-slate-500">{fmtTime(r['occurred_at'] as string)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{((r['operator_id'] as string | null) ?? '—').slice(0, 8)}…</td>
                    <td className="px-3 py-2 font-mono text-xs">{r['action'] as string}</td>
                    <td className="px-3 py-2 text-xs">
                      {(r['target_type'] as string) ?? '—'}
                      {targetId && <span className="font-mono ml-1 text-slate-500">{targetId.slice(0, 8)}…</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > 200 && (
            <div className="text-xs text-slate-500 px-3 py-2 border-t border-slate-200">
              Showing first 200 rows. Use Download JSON for the full export.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
