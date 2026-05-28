// Admin API client. Reads JWT from sessionStorage; redirects to /admin/login on
// 401 expiry. All endpoints are under /admin/*.

const TOKEN_KEY = 'lirabridge.admin.access';
const REFRESH_KEY = 'lirabridge.admin.refresh';

export type AdminRole =
  | 'viewer'
  | 'support'
  | 'ops'
  | 'finance'
  | 'compliance'
  | 'admin';

export interface MeResponse {
  userId: string;
  email: string;
  role: AdminRole;
}

export function getAccessToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setAccessTokens(access: string, refresh: string): void {
  sessionStorage.setItem(TOKEN_KEY, access);
  sessionStorage.setItem(REFRESH_KEY, refresh);
}
export function clearTokens(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  if (res.status === 401) {
    clearTokens();
    if (!location.pathname.startsWith('/admin/login')) {
      location.href = '/admin/login';
    }
    throw new ApiError(401, null, 'Unauthorized');
  }
  if (res.status === 503) {
    throw new ApiError(503, null, 'Path C disabled');
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (!res.ok) {
    const msg =
      (parsed && typeof parsed === 'object' && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : `HTTP ${res.status}`);
    throw new ApiError(res.status, parsed, msg);
  }
  return parsed as T;
}

// ── Auth ────────────────────────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<{
  status: 'tokens' | 'mfa_required' | 'mfa_setup_required';
  access?: string;
  refresh?: string;
  challenge?: string;
}> {
  return request('/admin/auth/login', {
    method: 'POST',
    body: { email, password },
  });
}

export async function setupMfa(challenge: string): Promise<{
  otpauthUrl: string;
  secretBase32: string;
}> {
  return request('/admin/auth/mfa/setup', {
    method: 'POST',
    body: { challenge },
  });
}

export async function completeMfa(
  challenge: string,
  code: string,
): Promise<{ access: string; refresh: string }> {
  return request('/admin/auth/mfa', {
    method: 'POST',
    body: { challenge, code },
  });
}

export async function enrollMfa(): Promise<{ otpauthUrl: string; secretBase32: string }> {
  return request('/admin/auth/mfa/enroll', { method: 'POST', body: { code: '' } });
}

export async function me(): Promise<MeResponse> {
  return request('/admin/auth/me');
}

// ── Dashboard / Members / Transactions / Webhooks / Approvals / Reserve ─────

export interface DashboardKpis {
  todayTxCount: number;
  todayDispatchedUnits: string;
  settleRate: number | null;
  medianSettleSeconds: number | null;
  stuckDispatchCount: number;
  failedWebhookCount: number;
  pendingApprovalCount: number;
}
export async function fetchDashboard(): Promise<{ kpis: DashboardKpis; recentTxs: TxRow[] }> {
  return request('/admin/dashboard');
}

export interface MemberRow {
  member_id: string;
  email: string | null;
  phone: string | null;
  preferred_inbound_path: 'MESH' | 'ONRAMP' | 'SELF';
  kyc_status: string;
  ofac_status: string;
  is_frozen: boolean;
  usdc_virtual_balance_wei: string;
  created_at: string;
}
export async function fetchMembers(params: { kyc?: string; path?: string } = {}): Promise<MemberRow[]> {
  const qs = new URLSearchParams();
  if (params.kyc) qs.set('kyc', params.kyc);
  if (params.path) qs.set('path', params.path);
  return request(`/admin/members?${qs.toString()}`);
}
export async function fetchMember(id: string): Promise<MemberRow & Record<string, unknown>> {
  return request(`/admin/members/${id}`);
}
export async function fetchMemberLedger(id: string): Promise<TxRow[]> {
  return request(`/admin/members/${id}/ledger`);
}
export async function setKyc(id: string, status: string): Promise<unknown> {
  return request(`/admin/members/${id}/kyc-status`, { method: 'PATCH', body: { status } });
}
export async function freezeMember(id: string, reason: string): Promise<unknown> {
  return request(`/admin/members/${id}/freeze`, { method: 'POST', body: { reason } });
}
export async function unfreezeMember(id: string): Promise<unknown> {
  return request(`/admin/members/${id}/unfreeze`, { method: 'POST', body: {} });
}

export interface TxRow {
  tx_id: string;
  member_id: string;
  source_type: string;
  direction: 'CREDIT' | 'DEBIT';
  amount_usdc_wei: string;
  state: string;
  idempotency_key?: string;
  mesh_transfer_id?: string | null;
  onramp_payment_id?: string | null;
  ils_wire_reference?: string | null;
  fx_rate_snapshot?: string | null;
  created_at: string;
}
export async function fetchTxs(params: {
  state?: string;
  sourceType?: string;
  memberId?: string;
  limit?: number;
}): Promise<TxRow[]> {
  const qs = new URLSearchParams();
  if (params.state) qs.set('state', params.state);
  if (params.sourceType) qs.set('sourceType', params.sourceType);
  if (params.memberId) qs.set('memberId', params.memberId);
  if (params.limit) qs.set('limit', String(params.limit));
  return request(`/admin/transactions?${qs.toString()}`);
}
export async function fetchTx(txId: string): Promise<{
  tx: TxRow;
  timeline: Array<{ id: string; from_state: string | null; to_state: string; metadata: Record<string, unknown> | null; occurred_at: string }>;
  events: Array<{ id: string; event_type: string; payload: Record<string, unknown>; occurred_at: string }>;
  refunds: Array<{ job_id: string; status: string; executor_path: string }>;
}> {
  return request(`/admin/transactions/${txId}`);
}
export async function cancelTx(txId: string): Promise<unknown> {
  return request(`/admin/transactions/${txId}/cancel`, { method: 'POST', body: {} });
}
export async function refundTx(txId: string): Promise<{ status: string; approvalId?: string }> {
  return request(`/admin/transactions/${txId}/refund`, { method: 'POST', body: {} });
}
export async function forceTransition(txId: string, toState: string, reason: string): Promise<unknown> {
  return request(`/admin/transactions/${txId}/state-transition`, {
    method: 'POST',
    body: { toState, reason },
  });
}
export async function refreshProvider(txId: string): Promise<unknown> {
  return request(`/admin/transactions/${txId}/refresh-provider`, { method: 'POST', body: {} });
}

// Webhooks
export interface ProcessedWebhookListItem {
  id: string;
  provider: string;
  event_id: string;
  processed_at: string;
  replayable: boolean;
}
export interface FailedWebhookListItem {
  id: string;
  provider: string;
  event_id: string;
  retry_count: number;
  error_message: string | null;
  created_at: string;
  last_attempted_at: string | null;
}
export async function fetchProcessedWebhooks(): Promise<ProcessedWebhookListItem[]> {
  return request('/admin/webhooks/processed?limit=200');
}
export async function fetchFailedWebhooks(): Promise<FailedWebhookListItem[]> {
  return request('/admin/webhooks/failed');
}
export async function replayProcessedWebhook(id: string): Promise<unknown> {
  return request(`/admin/webhooks/processed/${id}/replay`, { method: 'POST', body: {} });
}
export async function replayFailedWebhook(id: string): Promise<unknown> {
  return request(`/admin/webhooks/failed/${id}/replay`, { method: 'POST', body: {} });
}

// Approvals
export interface ApprovalRow {
  approval_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  initiated_by: string;
  required_role: AdminRole;
  payload: Record<string, unknown>;
  status: string;
  resolved_by: string | null;
  resolution_note: string | null;
  expires_at: string;
  created_at: string;
}
export async function fetchPendingApprovals(): Promise<ApprovalRow[]> {
  return request('/admin/approvals/pending');
}
export async function fetchApprovalHistory(): Promise<ApprovalRow[]> {
  return request('/admin/approvals/history');
}
export async function approveRequest(id: string, note?: string): Promise<unknown> {
  return request(`/admin/approvals/${id}/approve`, { method: 'POST', body: { note } });
}
export async function rejectRequest(id: string, note: string): Promise<unknown> {
  return request(`/admin/approvals/${id}/reject`, { method: 'POST', body: { note } });
}
export async function cancelRequest(id: string): Promise<unknown> {
  return request(`/admin/approvals/${id}/cancel`, { method: 'POST', body: {} });
}

// Reserve pool
export interface ReservePoolBalance {
  balanceUsdcUnits: string;
  floorUnits: string;
  utilizationPct: number;
  backend: 'PG' | 'ONCHAIN';
  healthyAtMs: number;
}
export async function fetchReserveBalance(): Promise<ReservePoolBalance> {
  return request('/admin/reserve-pool/balance');
}
export async function fetchReserveLedger(): Promise<Array<{
  entryId: string;
  eventType: string;
  amountUsdcUnits: string;
  poolBalanceAfterUnits: string;
  relatedTxId: string | null;
  occurredAt: string;
}>> {
  return request('/admin/reserve-pool/ledger');
}
export async function requestReserveCredit(amountUsdcUnits: string, sourceDescription: string): Promise<{ status: string; approvalId: string }> {
  return request('/admin/reserve-pool/credit', { method: 'POST', body: { amountUsdcUnits, sourceDescription } });
}

// Settings
export async function fetchFlags(): Promise<Record<string, string | null>> {
  return request('/admin/settings/flags');
}

export interface ProviderHealthRow {
  provider: string;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  last_latency_ms: number | null;
}
export async function fetchProviders(): Promise<{
  health: ProviderHealthRow[];
  keysStatus: Record<string, 'set' | 'missing'>;
}> {
  return request('/admin/settings/providers');
}

export interface CronRow {
  name: string;
  description: string;
  schedule: string;
  lastFiredAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}
export async function fetchCrons(): Promise<CronRow[]> {
  return request('/admin/settings/crons');
}
export async function runCronNow(name: string): Promise<{ ok: boolean; elapsedMs: number }> {
  return request(`/admin/settings/crons/${encodeURIComponent(name)}/run-now`, {
    method: 'POST',
    body: {},
  });
}
export async function flipFlag(name: string, value: string): Promise<{
  status: string;
  approvalId: string;
}> {
  return request(`/admin/settings/flags/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: { value },
  });
}

// ── Operators (admin users) ──
export interface AdminUserListItem {
  userId: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  mfaEnrolled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}
export async function fetchAdminUsers(): Promise<AdminUserListItem[]> {
  return request('/admin/users');
}
export async function inviteAdminUser(email: string, role: AdminRole): Promise<{
  userId: string;
  email: string;
  role: AdminRole;
  tempPassword: string;
  note: string;
}> {
  return request('/admin/users', { method: 'POST', body: { email, role } });
}
export async function patchAdminUser(
  id: string,
  patch: { role?: AdminRole; isActive?: boolean },
): Promise<unknown> {
  return request(`/admin/users/${id}`, { method: 'PATCH', body: patch });
}
export async function resetAdminMfa(id: string): Promise<unknown> {
  return request(`/admin/users/${id}/reset-mfa`, { method: 'POST', body: {} });
}
export async function deactivateAdminUser(id: string): Promise<unknown> {
  return request(`/admin/users/${id}`, { method: 'DELETE' });
}

// ── Compliance ──
export async function fetchKycQueue(): Promise<Array<{
  member_id: string;
  email: string | null;
  created_at: string;
}>> {
  return request('/admin/compliance/kyc-queue');
}
export async function fetchOfacQueue(): Promise<Array<{
  entry_id: string;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
}>> {
  return request('/admin/compliance/ofac-review-queue');
}
export async function requestOfacOverride(memberId: string, reason: string): Promise<{
  status: string;
  approvalId: string;
}> {
  return request('/admin/compliance/ofac-override', {
    method: 'POST',
    body: { memberId, reason },
  });
}
export async function fetchBlocklist(): Promise<{
  entries: Array<{ addressHash: string }>;
  count: number;
}> {
  return request('/admin/compliance/blocklist');
}
export async function patchBlocklist(csv: string): Promise<{
  status: string;
  approvalId: string;
}> {
  return request('/admin/compliance/blocklist', { method: 'PATCH', body: { csv } });
}
export async function fetchAuditExport(
  from?: string,
  to?: string,
): Promise<Array<Record<string, unknown>>> {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  return request(`/admin/compliance/audit-export?${qs.toString()}`);
}

// ── Reports ──
export async function fetchDailyVolume(from?: string, to?: string): Promise<Array<{
  day: string;
  source_type: string;
  tx_count: string;
  amount_units: string;
}>> {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  return request(`/admin/reports/daily-volume?${qs.toString()}`);
}
export async function fetchSettlementRates(): Promise<Array<{
  source_type: string;
  settled: string;
  total: string;
  p50_seconds: string | null;
  p95_seconds: string | null;
}>> {
  return request('/admin/reports/settlement-rates');
}
export async function fetchFxRatesReport(): Promise<Array<{
  day: string;
  min_rate: string | null;
  median_rate: string | null;
  max_rate: string | null;
  tx_count: string;
}>> {
  return request('/admin/reports/fx-rates');
}
export async function fetchFailedPayments(): Promise<Array<{
  source_type: string;
  reason: string;
  n: string;
}>> {
  return request('/admin/reports/failed-payments');
}
export async function fetchReservePoolReport(): Promise<Array<{
  day: string;
  credits: string | null;
  debits: string | null;
  ending_balance: string | null;
}>> {
  return request('/admin/reports/reserve-pool');
}
export async function startExport(
  report: 'daily-volume' | 'settlement-rates' | 'fx-rates',
  from: string,
  to: string,
): Promise<{ jobId: string }> {
  return request('/admin/reports/export', {
    method: 'POST',
    body: { report, from, to },
  });
}
export async function exportStatus(jobId: string): Promise<{
  jobId: string;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  report: string;
  rowCount: number;
  error?: string;
  downloadUrl: string | null;
}> {
  return request(`/admin/reports/export/${jobId}/status`);
}
export async function exportDownload(jobId: string): Promise<{ rows: unknown[] }> {
  return request(`/admin/reports/export/${jobId}/download`);
}

// ── Auth extras (MFA enrollment) ──
export async function manualCredit(
  memberId: string,
  amountUnits: string,
  reason: string,
): Promise<{ status: string; approvalId?: string; txId?: string }> {
  return request(`/admin/members/${memberId}/manual-credit`, {
    method: 'POST',
    body: { amountUnits, reason },
  });
}
export async function bulkReplayWebhooks(
  from: string,
  to: string,
): Promise<{ attempted: number; succeeded: number }> {
  return request('/admin/webhooks/failed/bulk-replay', {
    method: 'POST',
    body: { from, to },
  });
}
