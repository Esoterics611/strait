import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useT } from '../../lib/i18n';
import { Button } from '../../components/member';
import { useMemberAuth } from '../MemberAuth';

export function LandingPage(): JSX.Element {
  const { t } = useT();
  const nav = useNavigate();
  const { token, ready } = useMemberAuth();

  if (ready && token) return <Navigate to="/home" replace />;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4">
      <header className="flex items-center justify-between py-5">
        <span className="text-lg font-bold text-brand-700">{t('app.name')}</span>
        <Link
          to="/auth"
          className="text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          {t('landing.signin')}
        </Link>
      </header>

      <div className="flex flex-1 flex-col justify-center py-10">
        <h1 className="max-w-xl text-3xl font-bold leading-tight text-slate-900 motion-safe:animate-[fade-in_.25s_ease-out] sm:text-4xl">
          {t('landing.headline')}
        </h1>
        <div className="mt-8">
          <Button onClick={() => nav('/auth')} className="px-8">
            {t('landing.cta')}
          </Button>
        </div>
        <ul className="mt-10 flex flex-wrap gap-3">
          {(
            [
              'landing.trust.regulated',
              'landing.trust.fee',
              'landing.trust.tracking',
            ] as const
          ).map((k) => (
            <li
              key={k}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
            >
              {t(k)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
