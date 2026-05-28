import { Outlet, Route, Routes } from 'react-router-dom';
import { AdminAuthProvider } from './admin/AdminAuthContext';
import { AdminLayout } from './admin/AdminLayout';
import { LoginPage } from './admin/pages/LoginPage';
import { DashboardPage } from './admin/pages/DashboardPage';
import { MembersListPage, MemberDetailPage } from './admin/pages/MembersPage';
import { TransactionsListPage, TransactionDetailPage } from './admin/pages/TransactionsPage';
import { WebhooksPage } from './admin/pages/WebhooksPage';
import { ApprovalsPage } from './admin/pages/ApprovalsPage';
import { ReservePoolPage } from './admin/pages/ReservePoolPage';
import { ReportsPage } from './admin/pages/ReportsPage';
import { CompliancePage } from './admin/pages/CompliancePage';
import { OperatorsPage } from './admin/pages/OperatorsPage';
import { SettingsPage } from './admin/pages/SettingsPage';

import { I18nProvider, useT } from './lib/i18n';
import { ToastProvider } from './components/member';
import { MemberAuthProvider } from './member/MemberAuth';
import { RequireMember } from './member/MemberShell';
import { LandingPage } from './member/pages/LandingPage';
import { AuthPage } from './member/pages/AuthPage';
import { ProfileSetupPage } from './member/pages/ProfileSetupPage';
import { HomePage } from './member/pages/HomePage';
import {
  RecipientsListPage,
  RecipientFormPage,
  RecipientDetailPage,
} from './member/pages/RecipientsPage';
import { SendWizard } from './member/pages/SendWizard';
import { FundPage } from './member/pages/FundPage';
import { TrackingPage } from './member/pages/TrackingPage';
import { ActivityPage, ActivityDetailPage } from './member/pages/ActivityPage';
import { ProfilePage } from './member/pages/ProfilePage';

export default function App(): JSX.Element {
  return (
    <AdminAuthProvider>
      <Routes>
        {/* Admin — identical to the pre-existing structure, untouched */}
        <Route path="/admin/login" element={<LoginPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="members" element={<MembersListPage />} />
          <Route path="members/:id" element={<MemberDetailPage />} />
          <Route path="transactions" element={<TransactionsListPage />} />
          <Route path="transactions/:txId" element={<TransactionDetailPage />} />
          <Route path="webhooks" element={<WebhooksPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="reserve-pool" element={<ReservePoolPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="compliance" element={<CompliancePage />} />
          <Route path="users" element={<OperatorsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        {/* Member-facing app — providers scoped via a pathless layout route */}
        <Route element={<MemberProviders />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/auth/profile" element={<ProfileSetupPage />} />

          <Route element={<RequireMember />}>
            <Route path="/home" element={<HomePage />} />
            <Route path="/send" element={<SendWizard />} />
            <Route path="/send/:txId/fund" element={<FundPage />} />
            <Route path="/t/:txId" element={<TrackingPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/activity/:txId" element={<ActivityDetailPage />} />
            <Route path="/recipients" element={<RecipientsListPage />} />
            <Route path="/recipients/new" element={<RecipientFormPage />} />
            <Route path="/recipients/:id" element={<RecipientDetailPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AdminAuthProvider>
  );
}

function MemberProviders(): JSX.Element {
  return (
    <I18nProvider>
      <ToastProvider>
        <MemberAuthProvider>
          <Outlet />
        </MemberAuthProvider>
      </ToastProvider>
    </I18nProvider>
  );
}

function NotFound(): JSX.Element {
  const { t } = useT();
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
      <h1 className="text-2xl font-bold text-slate-900">404</h1>
      <p className="mt-2">
        <a className="text-brand-700 hover:underline" href="/home">
          {t('nav.home')}
        </a>
      </p>
    </div>
  );
}
