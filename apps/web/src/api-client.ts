import type { components } from '@site-monitor/contracts/openapi';

const apiBaseUrl = import.meta.env.VITE_PUBLIC_API_BASE_URL ?? 'http://localhost:13000';

export function apiUrl(path: string): string {
  return `${apiBaseUrl}${path}`;
}

type Schemas = components['schemas'];

export type SessionView = Schemas['SessionView'];
export type Check = Schemas['Check'];
export type CheckListItem = Schemas['CheckListItem'];
export type CheckPage = Schemas['CheckPage'];
export type CurrentStatus = Schemas['CurrentStatus'];
export type Group = Schemas['Group'];
export type GroupListItem = Schemas['GroupListItem'];
export type GroupPage = Schemas['GroupPage'];
export type ManualRunReceipt = Schemas['ManualRunReceipt'];
export type HistoryResponse = Schemas['HistoryResponse'];
export type Incident = Schemas['Incident'];
export type IncidentPage = Schemas['IncidentPage'];
export type MaintenanceWindow = Schemas['MaintenanceWindow'];
export type MaintenanceWindowPage = Schemas['MaintenanceWindowPage'];
export type NotificationRecipient = Schemas['NotificationRecipient'];
export type NotificationRecipientPage = Schemas['NotificationRecipientPage'];
export type NotificationPolicy = Schemas['NotificationPolicy'];
export type PublicPage = Schemas['PublicPage'];
export type PublicPagePage = Schemas['PublicPagePage'];
export type PublicLinkResult = Schemas['PublicLinkResult'];
export type PublicStatusSnapshot = Schemas['PublicStatusSnapshot'];
export type Problem = Schemas['Problem'];

export interface CheckWriteInput {
  expected_body_substring?: string | null;
  expected_status_code: number;
  group_id?: string | null;
  interval_seconds: number;
  name: string;
  timeout_ms: number;
  url: string;
}

export interface GroupWriteInput {
  description?: string | null;
  name: string;
}

export interface MaintenanceWriteInput {
  ends_at: string;
  note?: string | null;
  starts_at: string;
  target_id: string;
  target_type: 'CHECK' | 'GROUP';
}

export interface NotificationPolicyWriteInput {
  mode: 'ACTIVE' | 'DISABLED';
  notify_down: boolean | null;
  notify_recovery: boolean | null;
  recipient_ids: string[];
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues: Problem['errors'];

  constructor(problem: Partial<Problem>, status: number) {
    super(problem.detail ?? 'Request failed.');
    this.name = 'ApiError';
    this.code = problem.code ?? 'request_failed';
    this.status = status;
    this.issues = problem.errors;
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers,
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as Partial<Problem>;
    throw new ApiError(problem, response.status);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

function commandHeaders(
  session: SessionView,
  options: { idempotent?: boolean; version?: string } = {},
): HeadersInit {
  return {
    ...(options.idempotent ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    ...(options.version ? { 'If-Match': `"rv-${options.version}"` } : {}),
    'X-CSRF-Token': session.csrf_token,
  };
}

function pagePath(path: string, cursor?: string): string {
  const query = new URLSearchParams({ limit: '100' });
  if (cursor) query.set('cursor', cursor);
  return `${path}?${query.toString()}`;
}

export const monitoringApi = {
  cancelMaintenanceWindow(session: SessionView, window: MaintenanceWindow): Promise<void> {
    return apiRequest(`/api/v1/maintenance-windows/${window.id}`, {
      headers: commandHeaders(session, { version: window.resource_version }),
      method: 'DELETE',
    });
  },

  createCheck(session: SessionView, input: CheckWriteInput): Promise<Check> {
    return apiRequest('/api/v1/checks', {
      body: JSON.stringify(input),
      headers: commandHeaders(session, { idempotent: true }),
      method: 'POST',
    });
  },

  createGroup(session: SessionView, input: GroupWriteInput): Promise<Group> {
    return apiRequest('/api/v1/groups', {
      body: JSON.stringify(input),
      headers: commandHeaders(session, { idempotent: true }),
      method: 'POST',
    });
  },

  createMaintenanceWindow(
    session: SessionView,
    input: MaintenanceWriteInput,
  ): Promise<MaintenanceWindow> {
    return apiRequest('/api/v1/maintenance-windows', {
      body: JSON.stringify(input),
      headers: commandHeaders(session, { idempotent: true }),
      method: 'POST',
    });
  },

  createNotificationRecipient(session: SessionView, email: string): Promise<NotificationRecipient> {
    return apiRequest('/api/v1/notification-recipients', {
      body: JSON.stringify({ email }),
      headers: commandHeaders(session, { idempotent: true }),
      method: 'POST',
    });
  },

  createPublicPage(
    session: SessionView,
    input: { description?: string | null; title: string },
  ): Promise<PublicPage> {
    return apiRequest('/api/v1/public-pages', {
      body: JSON.stringify(input),
      headers: commandHeaders(session, { idempotent: true }),
      method: 'POST',
    });
  },

  deleteCheck(session: SessionView, check: Check): Promise<void> {
    return apiRequest(`/api/v1/checks/${check.id}`, {
      headers: commandHeaders(session, { version: check.resource_version }),
      method: 'DELETE',
    });
  },

  deleteGroup(session: SessionView, group: Group): Promise<void> {
    return apiRequest(`/api/v1/groups/${group.id}`, {
      headers: commandHeaders(session, { version: group.resource_version }),
      method: 'DELETE',
    });
  },

  deleteNotificationRecipient(
    session: SessionView,
    recipient: NotificationRecipient,
  ): Promise<void> {
    return apiRequest(`/api/v1/notification-recipients/${recipient.id}`, {
      headers: commandHeaders(session, { version: recipient.resource_version }),
      method: 'DELETE',
    });
  },

  getDefaultNotificationPolicy(): Promise<NotificationPolicy> {
    return apiRequest('/api/v1/notification-policies/default');
  },

  getHistory(checkId: string, period: 'day' | 'month' | 'week'): Promise<HistoryResponse> {
    return apiRequest(`/api/v1/checks/${checkId}/history?period=${period}`);
  },

  listChecks(cursor?: string): Promise<CheckPage> {
    return apiRequest(pagePath('/api/v1/checks', cursor));
  },

  listGroups(cursor?: string): Promise<GroupPage> {
    return apiRequest(pagePath('/api/v1/groups', cursor));
  },

  listIncidents(): Promise<IncidentPage> {
    return apiRequest('/api/v1/incidents?limit=50');
  },

  listMaintenanceWindows(): Promise<MaintenanceWindowPage> {
    return apiRequest('/api/v1/maintenance-windows?limit=100');
  },

  listNotificationRecipients(): Promise<NotificationRecipientPage> {
    return apiRequest('/api/v1/notification-recipients?limit=100');
  },

  listPublicPages(): Promise<PublicPagePage> {
    return apiRequest('/api/v1/public-pages?limit=100');
  },

  pauseCheck(session: SessionView, check: Check): Promise<Check> {
    return apiRequest(`/api/v1/checks/${check.id}/pause`, {
      headers: commandHeaders(session, { version: check.resource_version }),
      method: 'POST',
    });
  },

  requestManualRun(session: SessionView, check: Check): Promise<ManualRunReceipt> {
    return apiRequest(`/api/v1/checks/${check.id}/runs`, {
      headers: commandHeaders(session, {
        idempotent: true,
        version: check.resource_version,
      }),
      method: 'POST',
    });
  },

  resendNotificationVerification(
    session: SessionView,
    recipient: NotificationRecipient,
  ): Promise<{ accepted: boolean }> {
    return apiRequest(`/api/v1/notification-recipients/${recipient.id}/verification`, {
      headers: commandHeaders(session, { idempotent: true }),
      method: 'POST',
    });
  },

  resumeCheck(session: SessionView, check: Check): Promise<Check> {
    return apiRequest(`/api/v1/checks/${check.id}/resume`, {
      headers: commandHeaders(session, { version: check.resource_version }),
      method: 'POST',
    });
  },

  sendNotificationTest(
    session: SessionView,
    recipient: NotificationRecipient,
  ): Promise<{ accepted: boolean }> {
    return apiRequest(`/api/v1/notification-recipients/${recipient.id}/test-email`, {
      headers: commandHeaders(session, { idempotent: true }),
      method: 'POST',
    });
  },

  disablePublicPage(session: SessionView, page: PublicPage): Promise<PublicPage> {
    return apiRequest(`/api/v1/public-pages/${page.id}/disable`, {
      headers: commandHeaders(session, { version: page.resource_version }),
      method: 'POST',
    });
  },

  publishPublicPage(session: SessionView, page: PublicPage): Promise<PublicLinkResult> {
    return apiRequest(`/api/v1/public-pages/${page.id}/publish`, {
      headers: commandHeaders(session, { idempotent: true, version: page.resource_version }),
      method: 'POST',
    });
  },

  replacePublicPageChecks(
    session: SessionView,
    page: PublicPage,
    checks: CheckListItem[],
  ): Promise<PublicPage> {
    return apiRequest(`/api/v1/public-pages/${page.id}/components`, {
      body: JSON.stringify({
        items: checks.map(({ check }, position) => ({
          display_name: check.name,
          kind: 'CHECK',
          position,
          show_incident_history: true,
          show_response_time: true,
          show_url: false,
          source_id: check.id,
        })),
      }),
      headers: commandHeaders(session, { version: page.resource_version }),
      method: 'PUT',
    });
  },

  rotatePublicPageLink(session: SessionView, page: PublicPage): Promise<PublicLinkResult> {
    return apiRequest(`/api/v1/public-pages/${page.id}/rotate-link`, {
      headers: commandHeaders(session, { idempotent: true, version: page.resource_version }),
      method: 'POST',
    });
  },

  updateCheck(session: SessionView, check: Check, input: CheckWriteInput): Promise<Check> {
    return apiRequest(`/api/v1/checks/${check.id}`, {
      body: JSON.stringify(input),
      headers: commandHeaders(session, { version: check.resource_version }),
      method: 'PATCH',
    });
  },

  updateGroup(session: SessionView, group: Group, input: GroupWriteInput): Promise<Group> {
    return apiRequest(`/api/v1/groups/${group.id}`, {
      body: JSON.stringify(input),
      headers: commandHeaders(session, { version: group.resource_version }),
      method: 'PATCH',
    });
  },

  updateDefaultNotificationPolicy(
    session: SessionView,
    policy: NotificationPolicy,
    input: NotificationPolicyWriteInput,
  ): Promise<NotificationPolicy> {
    return apiRequest('/api/v1/notification-policies/default', {
      body: JSON.stringify(input),
      headers: commandHeaders(session, { version: policy.resource_version }),
      method: 'PUT',
    });
  },
};
