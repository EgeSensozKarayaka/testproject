// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  Check,
  CheckListItem,
  CurrentStatus,
  GroupListItem,
  SessionView,
} from './api-client.js';
import { formatDuration, MonitoringDashboard } from './monitoring-ui.js';

const session: SessionView = {
  csrf_token: 'v1.csrf-token',
  expires_at: '2026-10-11T00:00:00.000Z',
  user: {
    created_at: '2026-10-10T00:00:00.000Z',
    display_name: 'Alice',
    email: 'alice@example.test',
    email_verified: true,
    id: '00000000-0000-4000-8000-000000000001',
    resource_version: '1',
  },
};

function checkFixture(
  overrides: Partial<Check> = {},
  statusOverrides: Partial<CurrentStatus> = {},
): CheckListItem {
  const check: Check = {
    created_at: '2026-10-10T00:00:00.000Z',
    execution_state: 'ACTIVE',
    expected_body_substring: null,
    expected_status_code: 200,
    group_id: null,
    id: '00000000-0000-4000-8000-000000000201',
    interval_seconds: 30,
    name: 'Primary site',
    probe_generation: '1',
    resource_version: '1',
    schedule_generation: '1',
    timeout_ms: 5000,
    updated_at: '2026-10-10T00:00:00.000Z',
    url: 'https://example.com/health',
    ...overrides,
  };
  return {
    check,
    status: {
      check_id: check.id,
      current_incident: null,
      execution_state: check.execution_state,
      freshness_state: 'STALE',
      health_state: 'UNKNOWN',
      last_checked_at: null,
      last_response_time_ms: null,
      maintenance: { active: false, until: null },
      state_version: '1',
      ...statusOverrides,
    },
  };
}

function pageResponse<T>(data: T[], nextCursor: string | null = null): Response {
  return new Response(
    JSON.stringify({
      data,
      page: { has_more: nextCursor !== null, next_cursor: nextCursor },
    }),
    { status: 200 },
  );
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MonitoringDashboard', () => {
  it('formats current incident durations without negative values', () => {
    expect(formatDuration(-1)).toBe('0 sn');
    expect(formatDuration(125_000)).toBe('2 dk 5 sn');
    expect(formatDuration(7_380_000)).toBe('2 sa 3 dk');
    expect(formatDuration(93_600_000)).toBe('1 gün 2 sa');
  });

  it('summarizes live health and filters the status dashboard', async () => {
    const startedAt = new Date(Date.now() - 125_000).toISOString();
    const items = [
      checkFixture(
        { id: '00000000-0000-4000-8000-000000000211', name: 'Healthy service' },
        {
          freshness_state: 'FRESH',
          health_state: 'UP',
          last_checked_at: new Date().toISOString(),
          last_response_time_ms: 42,
        },
      ),
      checkFixture(
        { id: '00000000-0000-4000-8000-000000000212', name: 'Down service' },
        {
          current_incident: {
            confirmed_at: startedAt,
            id: '00000000-0000-4000-8000-000000000301',
            observation_mode: 'OBSERVED',
            observed_duration_ms: '120000',
            started_at: startedAt,
          },
          freshness_state: 'FRESH',
          health_state: 'DOWN',
          last_checked_at: new Date().toISOString(),
          last_response_time_ms: 900,
          maintenance: { active: true, until: new Date(Date.now() + 3_600_000).toISOString() },
        },
      ),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes('/api/v1/groups')) return Promise.resolve(pageResponse([]));
        return Promise.resolve(pageResponse(items));
      }),
    );

    render(<MonitoringDashboard onLogout={() => undefined} session={session} />);
    const overview = await screen.findByRole('region', { name: 'Sistem durumu' });
    expect(within(overview).getByText('Healthy service')).toBeDefined();
    expect(within(overview).getByText('Down service')).toBeDefined();
    expect(within(overview).getByText(/2 dk/u)).toBeDefined();
    expect(within(overview).getByText('Aktif olay').parentElement).toHaveTextContent('1');
    expect(within(overview).getByText('Operasyonel').parentElement).toHaveTextContent('1');

    fireEvent.click(within(overview).getByRole('button', { name: 'Aktif olaylar' }));
    expect(within(overview).queryByText('Healthy service')).toBeNull();
    expect(within(overview).getByText('Down service')).toBeDefined();
  });

  it('creates a group with CSRF and idempotency headers and refreshes the empty state', async () => {
    let groups: GroupListItem[] = [];
    let createHeaders: Headers | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.includes('/api/v1/checks')) return Promise.resolve(pageResponse([]));
        if (init?.method === 'POST') {
          createHeaders = new Headers(init.headers);
          const group = {
            created_at: '2026-10-10T00:00:00.000Z',
            description: 'Critical services',
            id: '00000000-0000-4000-8000-000000000101',
            name: 'Operations',
            resource_version: '1',
            updated_at: '2026-10-10T00:00:00.000Z',
          };
          groups = [
            {
              group,
              status: {
                down: 0,
                health_state: 'UNKNOWN',
                paused: 0,
                suspect: 0,
                unknown: 0,
                up: 0,
              },
            },
          ];
          return Promise.resolve(new Response(JSON.stringify(group), { status: 201 }));
        }
        return Promise.resolve(pageResponse(groups));
      }),
    );

    render(<MonitoringDashboard onLogout={() => undefined} session={session} />);
    expect(await screen.findByText('Henüz grup yok')).toBeDefined();

    fireEvent.click(screen.getByText('Yeni grup oluştur'));
    fireEvent.change(screen.getByLabelText('Grup adı'), { target: { value: 'Operations' } });
    fireEvent.change(screen.getByLabelText(/Açıklama/), {
      target: { value: 'Critical services' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Grup oluştur' }));

    expect(await screen.findByRole('heading', { name: 'Operations' })).toBeDefined();
    expect(createHeaders?.get('X-CSRF-Token')).toBe(session.csrf_token);
    expect(createHeaders?.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('runs and pauses a check through versioned command requests', async () => {
    let item = checkFixture();
    const commandHeaders: Headers[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.includes('/api/v1/groups')) return Promise.resolve(pageResponse([]));
        if (!init?.method || init.method === 'GET') return Promise.resolve(pageResponse([item]));
        commandHeaders.push(new Headers(init.headers));
        if (url.endsWith('/runs')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                check_id: item.check.id,
                disposition: 'ENQUEUED',
                mode: 'STATEFUL',
                request_id: '00000000-0000-7000-8000-000000000001',
                requested_at: '2026-10-10T00:01:00.000Z',
              }),
              { status: 202 },
            ),
          );
        }
        item = checkFixture({ execution_state: 'PAUSED', resource_version: '2' });
        return Promise.resolve(new Response(JSON.stringify(item.check), { status: 200 }));
      }),
    );

    render(<MonitoringDashboard onLogout={() => undefined} session={session} />);
    expect(await screen.findByRole('heading', { name: 'Primary site' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Şimdi çalıştır' }));
    expect(await screen.findByText('Manuel kontrol kuyruğa alındı.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Duraklat' }));
    expect(await screen.findByRole('button', { name: 'Devam ettir' })).toBeDefined();

    expect(commandHeaders[0]?.get('If-Match')).toBe('"rv-1"');
    expect(commandHeaders[0]?.get('Idempotency-Key')).toBeTruthy();
    expect(commandHeaders[1]?.get('If-Match')).toBe('"rv-1"');
    expect(
      commandHeaders.every((headers) => headers.get('X-CSRF-Token') === session.csrf_token),
    ).toBe(true);
  });

  it('reloads a stale resource and explains a 412 conflict', async () => {
    let item = checkFixture();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.includes('/api/v1/groups')) return Promise.resolve(pageResponse([]));
        if (init?.method === 'PATCH') {
          item = checkFixture({ name: 'Updated in another tab', resource_version: '2' });
          return Promise.resolve(
            new Response(
              JSON.stringify({ code: 'resource_version_mismatch', detail: 'Version mismatch.' }),
              { status: 412 },
            ),
          );
        }
        return Promise.resolve(pageResponse([item]));
      }),
    );

    render(<MonitoringDashboard onLogout={() => undefined} session={session} />);
    expect(await screen.findByRole('heading', { name: 'Primary site' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Düzenle' }));
    fireEvent.change(screen.getByLabelText('Kontrol adı'), { target: { value: 'My edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kontrolü güncelle' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('başka bir oturumda değiştirildi');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Updated in another tab' })).toBeDefined();
    });
  });

  it('keeps a 500-check fixture behind bounded 100-item UI pages', async () => {
    const items = Array.from({ length: 500 }, (_, index) =>
      checkFixture({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        name: `Capacity ${index + 1}`,
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(requestUrl(input));
        if (url.pathname.endsWith('/groups')) return Promise.resolve(pageResponse([]));
        const offset = Number(url.searchParams.get('cursor') ?? '0');
        const nextOffset = offset + 100;
        return Promise.resolve(
          pageResponse(
            items.slice(offset, nextOffset),
            nextOffset < items.length ? String(nextOffset) : null,
          ),
        );
      }),
    );

    render(<MonitoringDashboard onLogout={() => undefined} session={session} />);
    expect(await screen.findByRole('heading', { name: 'Capacity 100' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Capacity 101' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Daha fazla kontrol yükle' }));
    expect(await screen.findByRole('heading', { name: 'Capacity 200' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Capacity 201' })).toBeNull();
    expect(screen.getByText('200 kontrol')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Daha fazla kontrol yükle' })).toBeDefined();
  }, 15_000);
});
