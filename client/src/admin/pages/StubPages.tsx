/**
 * Stubs for pages whose UI is deferred to the next session. The BACKEND is fully
 * wired — these pages just need the React surface. See NEXT_STEPS_ADMIN_UI.md for
 * the detailed specification of each page.
 */

export function ReportsPage(): JSX.Element {
  return (
    <StubScreen
      title="Reports"
      endpoints={[
        'GET /admin/reports/daily-volume',
        'GET /admin/reports/settlement-rates',
        'GET /admin/reports/fx-rates',
        'GET /admin/reports/failed-payments',
        'GET /admin/reports/reserve-pool',
        'POST /admin/reports/export → job, GET /admin/reports/export/:id/status',
      ]}
    />
  );
}

export function CompliancePage(): JSX.Element {
  return (
    <StubScreen
      title="Compliance"
      endpoints={[
        'GET /admin/compliance/kyc-queue',
        'GET /admin/compliance/ofac-review-queue',
        'POST /admin/compliance/ofac-override (dual-approval)',
        'GET /admin/compliance/blocklist',
        'PATCH /admin/compliance/blocklist (dual-approval)',
        'GET /admin/compliance/audit-export',
      ]}
    />
  );
}

export function OperatorsPage(): JSX.Element {
  return (
    <StubScreen
      title="Operators (admin users)"
      endpoints={[
        'GET /admin/users',
        'POST /admin/users (invite)',
        'PATCH /admin/users/:id',
        'POST /admin/users/:id/reset-mfa',
        'DELETE /admin/users/:id',
      ]}
    />
  );
}

export function SettingsPage(): JSX.Element {
  return (
    <StubScreen
      title="Settings"
      endpoints={[
        'GET /admin/settings/flags',
        'GET /admin/settings/providers',
        'GET /admin/settings/crons',
        'POST /admin/settings/flags/:name (dual-approval for PATH_C_ENABLED)',
      ]}
    />
  );
}

function StubScreen({ title, endpoints }: { title: string; endpoints: string[] }): JSX.Element {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm">
        <p className="text-amber-900">
          UI deferred to the next session — backend endpoints are live and ready to wire up.
          See <code className="bg-amber-100 px-1 rounded">NEXT_STEPS_ADMIN_UI.md</code> for the detailed page spec.
        </p>
      </div>
      <div className="bg-white border border-slate-200 rounded p-4">
        <div className="text-xs uppercase text-slate-500 mb-2">Available endpoints</div>
        <ul className="space-y-1 font-mono text-xs">
          {endpoints.map((e) => <li key={e}>{e}</li>)}
        </ul>
      </div>
    </div>
  );
}
