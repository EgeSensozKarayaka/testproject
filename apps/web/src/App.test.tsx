// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('App authentication shell', () => {
  it('renders the login and registration controls for an anonymous user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 401 }))),
    );
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Log in to your account' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('heading', { name: 'Start monitoring' })).toBeDefined();
    expect(screen.getByLabelText('Display name')).toBeDefined();
  });

  it('renders the authenticated workspace returned by the session endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (!requestUrl(input).includes('/auth/session')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ data: [], page: { has_more: false, next_cursor: null } }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              csrf_token: 'v1.csrf',
              expires_at: '2026-10-11T00:00:00.000Z',
              user: {
                created_at: '2026-10-10T00:00:00.000Z',
                display_name: 'Alice',
                email: 'alice@example.test',
                email_verified: true,
                id: '00000000-0000-4000-8000-000000000001',
                resource_version: '1',
              },
            }),
            { status: 200 },
          ),
        );
      }),
    );
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Welcome, Alice' })).toBeDefined();
    expect(screen.getByText('alice@example.test', { exact: false })).toBeDefined();
  });
});
