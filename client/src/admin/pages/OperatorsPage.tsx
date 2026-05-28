import { useEffect, useState } from 'react';
import {
  deactivateAdminUser,
  fetchAdminUsers,
  inviteAdminUser,
  patchAdminUser,
  resetAdminMfa,
  type AdminRole,
  type AdminUserListItem,
} from '../lib/admin-api';
import { fmtRelative, fmtTime } from '../lib/format';
import { useAdminAuth } from '../AdminAuthContext';
import {
  Field,
  Modal,
  PrimaryButton,
  SecondaryButton,
  Select,
  TextInput,
} from '../components/Modal';
import { ErrorBanner } from './DashboardPage';

const ROLES: AdminRole[] = ['viewer', 'support', 'ops', 'finance', 'compliance', 'admin'];

const ROLE_BADGE: Record<string, string> = {
  viewer: 'bg-slate-200 text-slate-700',
  support: 'bg-blue-100 text-blue-800',
  ops: 'bg-emerald-100 text-emerald-800',
  finance: 'bg-amber-100 text-amber-800',
  compliance: 'bg-purple-100 text-purple-800',
  admin: 'bg-rose-100 text-rose-800',
};

export function OperatorsPage(): JSX.Element {
  const { user: currentUser } = useAdminAuth();
  const [rows, setRows] = useState<AdminUserListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [credential, setCredential] = useState<{ email: string; tempPassword: string } | null>(null);

  async function reload(): Promise<void> {
    try { setRows(await fetchAdminUsers()); } catch (err) { setError((err as Error).message); }
  }
  useEffect(() => { void reload(); }, []);

  async function onRoleChange(user: AdminUserListItem, role: AdminRole): Promise<void> {
    try {
      await patchAdminUser(user.userId, { role });
      setNotice(`Role for ${user.email} updated to ${role}.`);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onResetMfa(user: AdminUserListItem): Promise<void> {
    if (!confirm(`Reset MFA for ${user.email}? They will be forced to re-enroll on next login.`)) return;
    try {
      await resetAdminMfa(user.userId);
      setNotice(`MFA reset for ${user.email}.`);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onDeactivate(user: AdminUserListItem): Promise<void> {
    if (!confirm(`Deactivate ${user.email}? They will lose access immediately.`)) return;
    try {
      await deactivateAdminUser(user.userId);
      setNotice(`${user.email} deactivated.`);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onReactivate(user: AdminUserListItem): Promise<void> {
    try {
      await patchAdminUser(user.userId, { isActive: true });
      setNotice(`${user.email} reactivated.`);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (error) return <ErrorBanner msg={error} />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Operators</h1>
        <PrimaryButton onClick={() => setInviteOpen(true)}>Invite operator</PrimaryButton>
      </div>
      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-2 rounded text-sm">
          {notice}
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">MFA</th>
              <th className="px-3 py-2 font-medium">Last login</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((u) => {
              const isSelf = currentUser?.userId === u.userId;
              return (
                <tr key={u.userId} className="border-b border-slate-100">
                  <td className="px-3 py-2">{u.email}{isSelf && <span className="ml-1 text-xs text-slate-400">(you)</span>}</td>
                  <td className="px-3 py-2">
                    {isSelf || !u.isActive ? (
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${ROLE_BADGE[u.role] ?? 'bg-slate-100'}`}>
                        {u.role}
                      </span>
                    ) : (
                      <Select
                        value={u.role}
                        onChange={(e) => onRoleChange(u, e.target.value as AdminRole)}
                        className="w-32"
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </Select>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {u.mfaEnrolled ? (
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800">enrolled</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800">not enrolled</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500" title={u.lastLoginAt ? fmtTime(u.lastLoginAt) : ''}>
                    {u.lastLoginAt ? fmtRelative(u.lastLoginAt) : 'never'}
                  </td>
                  <td className="px-3 py-2">
                    {u.isActive ? (
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800">active</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-200 text-slate-700">inactive</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm space-x-3">
                    {!isSelf && u.isActive && (
                      <>
                        <button onClick={() => onResetMfa(u)} className="text-sky-700 hover:underline">Reset MFA</button>
                        <button onClick={() => onDeactivate(u)} className="text-rose-700 hover:underline">Deactivate</button>
                      </>
                    )}
                    {!u.isActive && (
                      <button onClick={() => onReactivate(u)} className="text-emerald-700 hover:underline">Reactivate</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={(c) => {
          setInviteOpen(false);
          setCredential(c);
          void reload();
        }}
      />
      <CredentialModal
        credential={credential}
        onClose={() => setCredential(null)}
      />
    </div>
  );
}

function InviteModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (c: { email: string; tempPassword: string }) => void;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const r = await inviteAdminUser(email, role);
      onCreated({ email: r.email, tempPassword: r.tempPassword });
      setEmail('');
      setRole('viewer');
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
      title="Invite operator"
      footer={
        <>
          <SecondaryButton onClick={onClose} disabled={busy}>Cancel</SecondaryButton>
          <PrimaryButton onClick={onSubmit} disabled={busy || !email || !role}>
            {busy ? 'Creating…' : 'Create'}
          </PrimaryButton>
        </>
      }
    >
      <Field label="Email">
        <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </Field>
      <Field label="Role">
        <Select value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
      </Field>
      {error && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 px-2 py-1 rounded">{error}</div>}
      <p className="text-[11px] text-slate-500 mt-2">
        The server generates a temporary password. It is displayed on the next screen <strong>once</strong>;
        share it through a secure channel.
      </p>
    </Modal>
  );
}

function CredentialModal({
  credential,
  onClose,
}: {
  credential: { email: string; tempPassword: string } | null;
  onClose: () => void;
}): JSX.Element {
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);

  function onCopy(): void {
    if (!credential) return;
    navigator.clipboard.writeText(credential.tempPassword).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }

  return (
    <Modal
      open={!!credential}
      onClose={() => { setAcknowledged(false); setCopied(false); onClose(); }}
      title={`Credentials for ${credential?.email ?? ''}`}
      maxWidth="max-w-lg"
      footer={
        <PrimaryButton
          onClick={() => { setAcknowledged(false); setCopied(false); onClose(); }}
          disabled={!acknowledged}
        >
          I have shared this securely
        </PrimaryButton>
      }
    >
      <p className="text-sm text-slate-700">
        This temporary password is shown <strong>once</strong>. The operator must enroll MFA on first login.
      </p>
      <div className="mt-3 bg-slate-50 border border-slate-200 rounded p-3 flex items-center justify-between">
        <code className="font-mono text-sm break-all">{credential?.tempPassword}</code>
        <SecondaryButton onClick={onCopy} className="ml-2 shrink-0">
          {copied ? 'Copied' : 'Copy'}
        </SecondaryButton>
      </div>
      <label className="flex items-start gap-2 mt-4 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5"
        />
        <span>I have securely transmitted this password to the operator and will not store it anywhere.</span>
      </label>
    </Modal>
  );
}
