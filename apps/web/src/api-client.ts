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

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues: Problem['errors'];

  constructor(problem: Partial<Problem>, status: number) {
    super(problem.detail ?? 'İstek tamamlanamadı.');
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

  listChecks(cursor?: string): Promise<CheckPage> {
    return apiRequest(pagePath('/api/v1/checks', cursor));
  },

  listGroups(cursor?: string): Promise<GroupPage> {
    return apiRequest(pagePath('/api/v1/groups', cursor));
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

  resumeCheck(session: SessionView, check: Check): Promise<Check> {
    return apiRequest(`/api/v1/checks/${check.id}/resume`, {
      headers: commandHeaders(session, { version: check.resource_version }),
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
};
