import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useT } from '../../lib/i18n';
import { api, API_MODE, ApiError } from '../../lib/api';
import { Button, Segmented, TextInput } from '../../components/member';
import { useMemberAuth } from '../MemberAuth';

type Channel = 'email' | 'sms';
type Phase = 'address' | 'code';

export function AuthPage(): JSX.Element {
  const { t } = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const { signIn } = useMemberAuth();

  const [channel, setChannel] = useState<Channel>('email');
  const [address, setAddress] = useState('');
  const [phase, setPhase] = useState<Phase>('address');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const sendCode = async (): Promise<void> => {
    if (!address.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api.authStart({ channel, address: address.trim() });
      setPhase('code');
      setResendIn(28);
    } catch {
      setError(t('common.somethingWrong'));
    } finally {
      setSending(false);
    }
  };

  const verify = async (code: string): Promise<void> => {
    setVerifying(true);
    setError(null);
    try {
      const res = await api.authVerify({ address: address.trim(), code });
      signIn(res.token, res.member);
      const from = (loc.state as { from?: string } | null)?.from;
      nav(res.isNewMember ? '/auth/profile' : (from ?? '/home'), { replace: true });
    } catch (e) {
      const msg =
        e instanceof ApiError && e.code === 'AUTH'
          ? t('auth.err.badCode', { left: 2 })
          : t('common.somethingWrong');
      setError(msg);
      setShake(true);
      setTimeout(() => setShake(false), 400);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <h1 className="text-2xl font-bold text-slate-900">{t('auth.title')}</h1>

      {phase === 'address' && (
        <div className="mt-8 space-y-5">
          <Segmented<Channel>
            ariaLabel={t('auth.title')}
            value={channel}
            onChange={setChannel}
            options={[
              { value: 'email', label: t('auth.channel.email') },
              { value: 'sms', label: t('auth.channel.sms') },
            ]}
          />
          <TextInput
            label={
              channel === 'email' ? t('auth.address.email') : t('auth.address.sms')
            }
            type={channel === 'email' ? 'email' : 'tel'}
            inputMode={channel === 'email' ? 'email' : 'tel'}
            numeric={channel === 'sms'}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoComplete={channel === 'email' ? 'email' : 'tel'}
          />
          <Button full loading={sending} onClick={sendCode} disabled={!address.trim()}>
            {sending ? t('auth.sending') : t('auth.sendCode')}
          </Button>
        </div>
      )}

      {phase === 'code' && (
        <div className="mt-8 space-y-5">
          <p className="text-sm text-slate-600">
            {t('auth.codeSent', { addr: address.trim() })}
          </p>
          <OtpInput shake={shake} onComplete={verify} disabled={verifying} />
          <p aria-live="assertive" className="min-h-[1.25rem] text-xs text-rose-600">
            {error}
          </p>
          {API_MODE === 'mock' && (
            <p className="text-xs text-slate-400">
              {t('auth.devHint', { code: '424242' })}
            </p>
          )}
          <div className="flex items-center justify-between">
            <button
              type="button"
              disabled={resendIn > 0 || sending}
              onClick={sendCode}
              className="text-sm font-medium text-brand-700 disabled:text-slate-400"
            >
              {resendIn > 0
                ? t('auth.resendIn', { sec: `0:${String(resendIn).padStart(2, '0')}` })
                : t('auth.resend')}
            </button>
            {verifying && (
              <span className="text-xs text-slate-400">{t('auth.verifying')}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function OtpInput({
  onComplete,
  disabled,
  shake,
}: {
  onComplete: (code: string) => void;
  disabled: boolean;
  shake: boolean;
}): JSX.Element {
  const { t } = useT();
  const [cells, setCells] = useState<string[]>(['', '', '', '', '', '']);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (shake) refs.current[0]?.focus();
  }, [shake]);

  const set = (i: number, v: string): void => {
    const digit = v.replace(/\D/g, '').slice(-1);
    const next = [...cells];
    next[i] = digit;
    setCells(next);
    if (digit && i < 5) refs.current[i + 1]?.focus();
    if (next.every((c) => c !== '')) onComplete(next.join(''));
  };

  const onPaste = (e: React.ClipboardEvent): void => {
    const txt = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!txt) return;
    e.preventDefault();
    const next = txt.split('').concat(['', '', '', '', '', '']).slice(0, 6);
    setCells(next);
    if (next.every((c) => c !== '')) onComplete(next.join(''));
    else refs.current[txt.length]?.focus();
  };

  return (
    <div
      role="group"
      aria-label={t('auth.enterCode')}
      dir="ltr"
      className={`flex justify-between gap-2 ${
        shake ? 'motion-safe:animate-[fade-in_.12s_ease-out]' : ''
      }`}
    >
      {cells.map((c, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={c}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => set(i, e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !cells[i] && i > 0)
              refs.current[i - 1]?.focus();
          }}
          className={`h-14 w-12 rounded-xl border text-center text-xl font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500 ${
            shake ? 'border-rose-400' : 'border-slate-300'
          }`}
        />
      ))}
    </div>
  );
}
