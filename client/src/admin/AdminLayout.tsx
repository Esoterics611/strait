import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ReactNode, useEffect, useState } from 'react';
import { useAdminAuth, hasRole } from './AdminAuthContext';
import { fetchDashboard, fetchFailedWebhooks } from './lib/admin-api';

interface NavItem {
  to: string;
  label: string;
  minRole?: string;
  badgeKey?: 'approvals' | 'webhooks';
}

const NAV: NavItem[] = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/members', label: 'Members' },
  { to: '/admin/transactions', label: 'Transactions' },
  { to: '/admin/webhooks', label: 'Webhooks', minRole: 'ops', badgeKey: 'webhooks' },
  { to: '/admin/approvals', label: 'Approvals', badgeKey: 'approvals' },
  { to: '/admin/reserve-pool', label: 'Reserve Pool', minRole: 'viewer' },
  { to: '/admin/reports', label: 'Reports' },
  { to: '/admin/compliance', label: 'Compliance', minRole: 'compliance' },
  { to: '/admin/users', label: 'Operators', minRole: 'admin' },
  { to: '/admin/settings', label: 'Settings', minRole: 'admin' },
];

const ROLE_BADGE: Record<string, string> = {
  viewer: 'bg-slate-200 text-slate-700',
  support: 'bg-blue-100 text-blue-800',
  ops: 'bg-emerald-100 text-emerald-800',
  finance: 'bg-amber-100 text-amber-800',
  compliance: 'bg-purple-100 text-purple-800',
  admin: 'bg-rose-100 text-rose-800',
};

export function AdminLayout(): JSX.Element {
  const { user, loading, logout } = useAdminAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [badges, setBadges] = useState<{ approvals: number; webhooks: number }>({
    approvals: 0,
    webhooks: 0,
  });

  useEffect(() => {
    if (!loading && !user && !loc.pathname.startsWith('/admin/login')) {
      nav('/admin/login', { replace: true, state: { from: loc.pathname } });
    }
  }, [loading, user, loc.pathname, nav]);

  // Poll the badge counts every 30 s — light-weight, gives operators an
  // at-a-glance signal that work is queued up without jumping into the screen.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [d, fw] = await Promise.all([
          fetchDashboard().catch(() => null),
          hasRole(user?.role, 'ops') ? fetchFailedWebhooks().catch(() => []) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setBadges({
          approvals: d?.kpis.pendingApprovalCount ?? 0,
          webhooks: fw.length,
        });
      } catch {
        // silently ignore — badges are non-critical
      }
    }
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user]);

  if (loading) {
    return <Centered>Loading…</Centered>;
  }
  if (!user) return <></>;

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="w-56 bg-slate-900 text-slate-100 flex flex-col">
        <div className="px-4 py-4 border-b border-slate-800">
          <Link to="/admin" className="font-bold tracking-tight">Lira-Bridge</Link>
          <div className="text-xs text-slate-400 mt-0.5">admin console</div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.filter((item) => !item.minRole || hasRole(user.role, item.minRole)).map((item) => {
            const badge = item.badgeKey ? badges[item.badgeKey] : 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/admin'}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3 py-1.5 rounded text-sm ${
                    isActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'
                  }`
                }
              >
                <span>{item.label}</span>
                {badge > 0 && (
                  <span className="text-[10px] font-semibold bg-rose-500 text-white px-1.5 py-0.5 rounded-full">
                    {badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-slate-800 text-xs">
          <div className="truncate">{user.email}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${ROLE_BADGE[user.role] ?? 'bg-slate-700'}`}>
              {user.role}
            </span>
            <button onClick={logout} className="text-slate-400 hover:text-white text-xs ml-auto">
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="max-w-7xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function Centered({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">
      {children}
    </div>
  );
}
