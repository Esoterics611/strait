import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useT } from '../lib/i18n';
import { useMemberAuth } from './MemberAuth';
import type { MsgKey } from '../lib/i18n';

export function LangToggle({ className = '' }: { className?: string }): JSX.Element {
  const { t, toggle } = useT();
  return (
    <button
      type="button"
      onClick={toggle}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 ${className}`}
    >
      {t('lang.toggle')}
    </button>
  );
}

const NAV: { to: string; key: MsgKey; glyph: string }[] = [
  { to: '/home', key: 'nav.home', glyph: '⌂' },
  { to: '/send', key: 'nav.send', glyph: '↗' },
  { to: '/activity', key: 'nav.activity', glyph: '≣' },
  { to: '/recipients', key: 'nav.recipients', glyph: '☷' },
  { to: '/profile', key: 'nav.profile', glyph: '☺' },
];

export function RequireMember(): JSX.Element {
  const { token, ready } = useMemberAuth();
  const loc = useLocation();
  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center text-slate-400">
        <span className="motion-safe:animate-pulse">…</span>
      </div>
    );
  }
  if (!token) return <Navigate to="/auth" replace state={{ from: loc.pathname }} />;
  return <MemberShell />;
}

function MemberShell(): JSX.Element {
  const { t } = useT();
  return (
    <div className="min-h-screen md:flex">
      {/* sidebar (>= md) */}
      <aside className="hidden w-56 shrink-0 border-e border-slate-200 bg-white/70 p-4 md:block">
        <div className="px-2 py-3 text-lg font-bold text-brand-700">
          {t('app.name')}
        </div>
        <nav className="mt-4 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              <span aria-hidden className="text-base">
                {n.glyph}
              </span>
              {t(n.key)}
            </NavLink>
          ))}
        </nav>
        <div className="mt-6 border-t border-slate-100 pt-4">
          <LangToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur md:hidden">
          <span className="font-bold text-brand-700">{t('app.name')}</span>
          <LangToggle />
        </header>

        <main className="flex-1 pb-24 md:pb-10">
          <Outlet />
        </main>

        {/* bottom nav (< md) */}
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white md:hidden">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
                  isActive ? 'text-brand-700' : 'text-slate-500'
                }`
              }
            >
              <span aria-hidden className="text-lg leading-none">
                {n.glyph}
              </span>
              {t(n.key)}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
