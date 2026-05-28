import { useEffect, useState } from 'react';
import {
  bulkReplayWebhooks,
  fetchFailedWebhooks,
  fetchProcessedWebhooks,
  replayFailedWebhook,
  replayProcessedWebhook,
  type FailedWebhookListItem,
  type ProcessedWebhookListItem,
} from '../lib/admin-api';
import { fmtTime } from '../lib/format';
import { ErrorBanner } from './DashboardPage';
import {
  Field,
  Modal,
  PrimaryButton,
  SecondaryButton,
} from '../components/Modal';

export function WebhooksPage(): JSX.Element {
  const [tab, setTab] = useState<'failed' | 'processed'>('failed');
  const [failed, setFailed] = useState<FailedWebhookListItem[] | null>(null);
  const [processed, setProcessed] = useState<ProcessedWebhookListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  async function reload(): Promise<void> {
    try {
      const [f, p] = await Promise.all([fetchFailedWebhooks(), fetchProcessedWebhooks()]);
      setFailed(f);
      setProcessed(p);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  useEffect(() => { void reload(); }, []);

  async function onReplay(provider: 'failed' | 'processed', id: string): Promise<void> {
    if (!confirm('Replay this webhook? Will re-run all side effects.')) return;
    try {
      const r = provider === 'failed' ? await replayFailedWebhook(id) : await replayProcessedWebhook(id);
      setNotice(`Replay status: ${JSON.stringify(r)}`);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (error) return <ErrorBanner msg={error} />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Webhooks</h1>
        <SecondaryButton onClick={() => setBulkOpen(true)} disabled={!failed || failed.length === 0}>
          Bulk replay…
        </SecondaryButton>
      </div>
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-2 rounded text-sm">{notice}</div>}
      <div className="flex gap-1">
        <TabBtn active={tab === 'failed'} onClick={() => setTab('failed')}>
          Failed {failed && <span className="ml-1 text-xs">({failed.length})</span>}
        </TabBtn>
        <TabBtn active={tab === 'processed'} onClick={() => setTab('processed')}>
          Processed {processed && <span className="ml-1 text-xs">({processed.length})</span>}
        </TabBtn>
      </div>
      <BulkReplayModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onDone={(msg) => {
          setBulkOpen(false);
          setNotice(msg);
          void reload();
        }}
      />
      <div className="bg-white border border-slate-200 rounded">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Event ID</th>
              <th className="px-3 py-2 font-medium">{tab === 'failed' ? 'Last attempt' : 'Processed'}</th>
              <th className="px-3 py-2 font-medium">{tab === 'failed' ? 'Retries' : 'Replayable'}</th>
              <th className="px-3 py-2 font-medium">Error</th>
              <th className="px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {tab === 'failed' ? failed?.map((w) => (
              <tr key={w.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">{w.provider}</td>
                <td className="px-3 py-2 font-mono text-xs">{w.event_id}</td>
                <td className="px-3 py-2 text-slate-500">{fmtTime(w.last_attempted_at ?? w.created_at)}</td>
                <td className="px-3 py-2">{w.retry_count}</td>
                <td className="px-3 py-2 text-rose-700 text-xs max-w-md truncate">{w.error_message ?? '—'}</td>
                <td className="px-3 py-2">
                  <button onClick={() => onReplay('failed', w.id)} className="text-sky-700 hover:underline text-sm">Replay</button>
                </td>
              </tr>
            )) : processed?.map((w) => (
              <tr key={w.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">{w.provider}</td>
                <td className="px-3 py-2 font-mono text-xs">{w.event_id}</td>
                <td className="px-3 py-2 text-slate-500">{fmtTime(w.processed_at)}</td>
                <td className="px-3 py-2">{w.replayable ? 'yes' : 'no body'}</td>
                <td className="px-3 py-2 text-slate-400">—</td>
                <td className="px-3 py-2">
                  {w.replayable ? (
                    <button onClick={() => onReplay('processed', w.id)} className="text-sky-700 hover:underline text-sm">Replay</button>
                  ) : (
                    <span className="text-slate-400 text-xs">no body</span>
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

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded text-sm ${active ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
      {children}
    </button>
  );
}

function BulkReplayModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
}): JSX.Element {
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const r = await bulkReplayWebhooks(from, to);
      onDone(`Bulk replay: ${r.succeeded}/${r.attempted} succeeded`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bulk replay failed webhooks"
      footer={
        <>
          <SecondaryButton onClick={onClose} disabled={busy}>Cancel</SecondaryButton>
          <PrimaryButton onClick={submit} disabled={busy}>
            {busy ? 'Replaying…' : 'Replay all in range'}
          </PrimaryButton>
        </>
      }
    >
      <p className="text-xs text-slate-500 mb-3">
        Replays every failed webhook created in the date range. Each replay re-runs the original
        side effects (state transitions, ledger writes). Use carefully.
      </p>
      <Field label="From (UTC date)">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-sm" />
      </Field>
      <Field label="To (UTC date)">
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-sm" />
      </Field>
      {error && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2 rounded">
          {error}
        </div>
      )}
    </Modal>
  );
}
