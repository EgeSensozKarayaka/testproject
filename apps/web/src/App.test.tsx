// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';

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

    expect(await screen.findByRole('heading', { name: 'Hesabınıza giriş yapın' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Yeni hesap' }));
    expect(screen.getByRole('heading', { name: 'İzlemeye başlayın' })).toBeDefined();
    expect(screen.getByLabelText('Görünen ad')).toBeDefined();
  });

  it('renders the authenticated workspace returned by the session endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
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
        ),
      ),
    );
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Hoş geldiniz, Alice' })).toBeDefined();
    expect(screen.getByText('alice@example.test', { exact: false })).toBeDefined();
  });
});
