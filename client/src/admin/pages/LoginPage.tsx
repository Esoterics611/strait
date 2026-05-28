import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { completeMfa, login, setAccessTokens, setupMfa } from '../lib/admin-api';
import { useAdminAuth } from '../AdminAuthContext';

type Step = 'credentials' | 'mfa_code' | 'mfa_setup';

export function LoginPage(): JSX.Element {
  const nav = useNavigate();
  const { reload } = useAdminAuth();
  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<{ otpauthUrl: string; secretBase32: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmitCredentials(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await login(email, password);
      if (res.status === 'tokens' && res.access && res.refresh) {
        setAccessTokens(res.access, res.refresh);
        await reload();
        nav('/admin', { replace: true });
        return;
      }
      if (res.status === 'mfa_required' && res.challenge) {
        setChallenge(res.challenge);
        setStep('mfa_code');
        return;
      }
      if (res.status === 'mfa_setup_required' && res.challenge) {
        setChallenge(res.challenge);
        const enrol = await setupMfa(res.challenge);
        setEnrollment(enrol);
        setStep('mfa_setup');
        return;
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitCode(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!challenge) return;
    setError(null);
    setBusy(true);
    try {
      const tokens = await completeMfa(challenge, code);
      setAccessTokens(tokens.access, tokens.refresh);
      await reload();
      nav('/admin', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function backToCredentials(): void {
    setStep('credentials');
    setChallenge(null);
    setEnrollment(null);
    setCode('');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-8 w-full max-w-md">
        <div className="mb-6">
          <div className="text-lg font-semibold text-slate-900">Lira-Bridge admin</div>
          <div className="text-xs text-slate-500">
            {step === 'mfa_setup' ? 'Enroll MFA — required for ops roles' :
             step === 'mfa_code'  ? 'Verify MFA' :
             'Operator console — sign in'}
          </div>
        </div>
        {step === 'credentials' && (
          <CredentialsForm
            email={email} setEmail={setEmail}
            password={password} setPassword={setPassword}
            busy={busy} error={error}
            onSubmit={onSubmitCredentials}
          />
        )}
        {step === 'mfa_setup' && enrollment && (
          <SetupForm
            enrollment={enrollment}
            code={code} setCode={setCode}
            busy={busy} error={error}
            onSubmit={onSubmitCode}
            onBack={backToCredentials}
          />
        )}
        {step === 'mfa_code' && (
          <CodeForm
            code={code} setCode={setCode}
            busy={busy} error={error}
            onSubmit={onSubmitCode}
            onBack={backToCredentials}
          />
        )}
      </div>
    </div>
  );
}

interface FormProps {
  busy: boolean;
  error: string | null;
  onSubmit: (e: FormEvent) => Promise<void>;
}

function CredentialsForm({
  email, setEmail, password, setPassword, busy, error, onSubmit,
}: FormProps & {
  email: string; setEmail: (s: string) => void;
  password: string; setPassword: (s: string) => void;
}): JSX.Element {
  return (
    <form onSubmit={onSubmit}>
      <Field label="Email">
        <input
          type="email"
          className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus required
        />
      </Field>
      <Field label="Password">
        <input
          type="password"
          className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>
      {error && <ErrorMsg msg={error} />}
      <SubmitButton busy={busy}>Sign in</SubmitButton>
    </form>
  );
}

function CodeForm({
  code, setCode, busy, error, onSubmit, onBack,
}: FormProps & {
  code: string; setCode: (s: string) => void;
  onBack: () => void;
}): JSX.Element {
  return (
    <form onSubmit={onSubmit}>
      <Field label="MFA code (6 digits)">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          className="w-full border border-slate-300 rounded px-3 py-2 text-lg tracking-widest text-center"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus required
        />
      </Field>
      {error && <ErrorMsg msg={error} />}
      <SubmitButton busy={busy}>Verify</SubmitButton>
      <BackLink onClick={onBack} />
    </form>
  );
}

function SetupForm({
  enrollment, code, setCode, busy, error, onSubmit, onBack,
}: FormProps & {
  enrollment: { otpauthUrl: string; secretBase32: string };
  code: string; setCode: (s: string) => void;
  onBack: () => void;
}): JSX.Element {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(enrollment.otpauthUrl)}`;
  return (
    <form onSubmit={onSubmit}>
      <div className="text-xs text-slate-600 mb-3">
        Scan this QR code with Google Authenticator / 1Password / Authy, then enter the 6-digit code to finish setup.
      </div>
      <div className="flex flex-col items-center mb-4">
        <img src={qrUrl} alt="MFA QR" className="border border-slate-200 rounded" width={200} height={200} />
        <details className="mt-2 text-xs text-slate-500 self-stretch">
          <summary className="cursor-pointer">Can't scan? Show secret</summary>
          <code className="block bg-slate-50 border border-slate-200 rounded p-2 mt-1 font-mono text-[11px] break-all">
            {enrollment.secretBase32}
          </code>
        </details>
      </div>
      <Field label="Enter the first 6-digit code">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          className="w-full border border-slate-300 rounded px-3 py-2 text-lg tracking-widest text-center"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus required
        />
      </Field>
      {error && <ErrorMsg msg={error} />}
      <SubmitButton busy={busy}>Finish setup &amp; sign in</SubmitButton>
      <BackLink onClick={onBack} />
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-slate-700 mb-1">{label}</span>
      {children}
    </label>
  );
}

function ErrorMsg({ msg }: { msg: string }): JSX.Element {
  return (
    <div className="mb-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2 rounded">
      {msg}
    </div>
  );
}

function SubmitButton({ busy, children }: { busy: boolean; children: React.ReactNode }): JSX.Element {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full bg-slate-900 text-white text-sm rounded py-2 disabled:opacity-50 hover:bg-slate-800"
    >
      {busy ? 'Working…' : children}
    </button>
  );
}

function BackLink({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block mx-auto mt-3 text-xs text-slate-500 hover:text-slate-700"
    >
      ← Back
    </button>
  );
}
