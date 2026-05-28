import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  fetchMembers,
  fetchMember,
  fetchMemberLedger,
  freezeMember,
  unfreezeMember,
  manualCredit,
  setKyc,
  type MemberRow,
  type TxRow,
} from '../lib/admin-api';
import { fmtUsdc, fmtTime, stateColor } from '../lib/format';
import { useAdminAuth, hasRole } from '../AdminAuthContext';
import { ErrorBanner } from './DashboardPage';
import {
  Field,
  Modal,
  PrimaryButton,
  SecondaryButton,
  TextArea,
  TextInput,
} from '../components/Modal';

export function MembersListPage(): JSX.Element {
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterKyc, setFilterKyc] = useState('');

  useEffect(() => {
    fetchMembers({ kyc: filterKyc || undefined })
      .then(setRows)
      .catch((err) => setError((err as Error).message));
  }, [filterKyc]);

  if (error) return <ErrorBanner msg={error} />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Members</h1>
        <select
          value={filterKyc}
          onChange={(e) => setFilterKyc(e.target.value)}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        >
          <option value="">All KYC statuses</option>
          <option value="PENDING">Pending</option>
          <option value="VERIFIED">Verified</option>
          <option value="REJECTED">Rejected</option>
          <option value="EXPIRED">Expired</option>
        </select>
      </div>
      <div className="bg-white border border-slate-200 rounded">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 font-medium">Member</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Path</th>
              <th className="px-3 py-2 font-medium">Balance</th>
              <th className="px-3 py-2 font-medium">KYC</th>
              <th className="px-3 py-2 font-medium">OFAC</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((m) => (
              <tr key={m.member_id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link to={`/admin/members/${m.member_id}`} className="text-sky-700 hover:underline">
                    {m.member_id.slice(0, 8)}…
                  </Link>
                </td>
                <td className="px-3 py-2">{m.email ?? '—'}</td>
                <td className="px-3 py-2">{m.preferred_inbound_path}</td>
                <td className="px-3 py-2 font-mono text-xs">{fmtUsdc(m.usdc_virtual_balance_wei)}</td>
                <td className="px-3 py-2"><Badge value={m.kyc_status} /></td>
                <td className="px-3 py-2"><Badge value={m.ofac_status} /></td>
                <td className="px-3 py-2">
                  {m.is_frozen ? (
                    <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-rose-100 text-rose-800">FROZEN</span>
                  ) : (
                    <span className="text-slate-400 text-xs">active</span>
                  )}
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400 text-sm">No members.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Badge({ value }: { value: string }): JSX.Element {
  const color =
    value === 'VERIFIED' || value === 'CLEAR'
      ? 'bg-emerald-100 text-emerald-800'
      : value === 'REJECTED' || value === 'HIT'
      ? 'bg-rose-100 text-rose-800'
      : value === 'PENDING' || value === 'NOT_SCREENED'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-slate-100 text-slate-700';
  return <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${color}`}>{value}</span>;
}

export function MemberDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { user } = useAdminAuth();
  const [member, setMember] = useState<MemberRow | null>(null);
  const [ledger, setLedger] = useState<TxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualCreditOpen, setManualCreditOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload(): Promise<void> {
    if (!id) return;
    try {
      const [m, l] = await Promise.all([fetchMember(id), fetchMemberLedger(id)]);
      setMember(m);
      setLedger(l);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void reload();
  }, [id]);

  async function onFreeze(): Promise<void> {
    if (!id) return;
    const reason = window.prompt('Freeze reason (min 5 chars):');
    if (!reason || reason.length < 5) return;
    setBusy(true);
    try {
      await freezeMember(id, reason);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onUnfreeze(): Promise<void> {
    if (!id) return;
    setBusy(true);
    try {
      await unfreezeMember(id);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSetKyc(status: string): Promise<void> {
    if (!id) return;
    setBusy(true);
    try {
      await setKyc(id, status);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBanner msg={error} />;
  if (!member) return <div className="text-sm text-slate-500">Loading…</div>;

  const canCompliance = hasRole(user?.role, 'compliance');
  const canOps = hasRole(user?.role, 'ops');
  return (
    <div className="space-y-6">
      <Link to="/admin/members" className="text-xs text-slate-500 hover:underline">← All members</Link>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 font-mono">{member.member_id}</h1>
          <div className="text-sm text-slate-500 mt-1">
            {member.email ?? 'no email on file'} · created {fmtTime(member.created_at)}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canOps && (
            <SecondaryButton onClick={() => setManualCreditOpen(true)} disabled={busy}>
              Manual credit
            </SecondaryButton>
          )}
          {canCompliance && (
            <>
              {member.is_frozen ? (
                <SecondaryButton onClick={onUnfreeze} disabled={busy}>Unfreeze</SecondaryButton>
              ) : (
                <button
                  onClick={onFreeze}
                  disabled={busy}
                  className="border border-rose-300 text-rose-700 text-sm rounded px-3 py-1.5 hover:bg-rose-50 disabled:opacity-50"
                >
                  Freeze
                </button>
              )}
              <select
                value={member.kyc_status}
                onChange={(e) => onSetKyc(e.target.value)}
                disabled={busy}
                className="border border-slate-300 rounded px-2 py-1 text-sm"
              >
                <option value="PENDING">KYC: Pending</option>
                <option value="VERIFIED">KYC: Verified</option>
                <option value="REJECTED">KYC: Rejected</option>
                <option value="EXPIRED">KYC: Expired</option>
              </select>
            </>
          )}
        </div>
      </div>
      <ManualCreditModal
        open={manualCreditOpen}
        memberId={id ?? ''}
        onClose={() => setManualCreditOpen(false)}
        onSuccess={(notice) => {
          setManualCreditOpen(false);
          setNotice(notice);
          void reload();
        }}
      />
      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-2 rounded text-sm">
          {notice}
        </div>
      )}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card label="Balance">{fmtUsdc(member.usdc_virtual_balance_wei)}</Card>
        <Card label="KYC"><Badge value={member.kyc_status} /></Card>
        <Card label="OFAC"><Badge value={member.ofac_status} /></Card>
      </section>
      <section>
        <h2 className="text-sm font-medium text-slate-700 mb-2">Ledger</h2>
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Dir</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 font-medium">Tx</th>
              </tr>
            </thead>
            <tbody>
              {ledger?.map((tx) => (
                <tr key={tx.tx_id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-500">{fmtTime(tx.created_at)}</td>
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
      </section>
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="bg-white border border-slate-200 rounded p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-semibold mt-0.5 text-slate-900">{children}</div>
    </div>
  );
}

function ManualCreditModal({
  open,
  memberId,
  onClose,
  onSuccess,
}: {
  open: boolean;
  memberId: string;
  onClose: () => void;
  onSuccess: (notice: string) => void;
}): JSX.Element {
  const [amountUsd, setAmountUsd] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setAmountUsd('');
    setReason('');
    setError(null);
  }

  async function submit(): Promise<void> {
    setError(null);
    const usdAmount = Number(amountUsd);
    if (!isFinite(usdAmount) || usdAmount <= 0) {
      setError('Enter a positive USDC amount.');
      return;
    }
    if (reason.trim().length < 5) {
      setError('Reason must be at least 5 characters.');
      return;
    }
    setBusy(true);
    try {
      const amountUnits = BigInt(Math.round(usdAmount * 1_000_000)).toString();
      const r = await manualCredit(memberId, amountUnits, reason);
      const notice =
        r.status === 'EXECUTED'
          ? `Credited $${usdAmount.toFixed(2)} (tx ${r.txId?.slice(0, 8) ?? '—'}).`
          : `Credit pending approval ${r.approvalId} — large amounts require compliance signature.`;
      onSuccess(notice);
      reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const overThreshold = Number(amountUsd) >= 100;
  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Manual credit"
      footer={
        <>
          <SecondaryButton onClick={() => { reset(); onClose(); }} disabled={busy}>Cancel</SecondaryButton>
          <PrimaryButton onClick={submit} disabled={busy || !amountUsd || !reason}>
            {busy ? 'Submitting…' : overThreshold ? 'Queue for approval' : 'Credit now'}
          </PrimaryButton>
        </>
      }
    >
      <p className="text-xs text-slate-500 mb-3">
        Credit USDC to this member's virtual balance. Amounts ≥ $100 require dual approval.
      </p>
      <Field label="Amount (USDC)">
        <TextInput
          type="number"
          inputMode="decimal"
          step="0.01"
          value={amountUsd}
          onChange={(e) => setAmountUsd(e.target.value)}
          placeholder="e.g. 25.00"
          autoFocus
        />
      </Field>
      <Field label="Reason (≥ 5 chars)">
        <TextArea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Support case #..., refund of failed onramp..."
        />
      </Field>
      {overThreshold && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 rounded mb-2">
          ≥ $100 — will queue as a pending approval. A second compliance operator must approve before the credit lands.
        </div>
      )}
      {error && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2 rounded">
          {error}
        </div>
      )}
    </Modal>
  );
}
