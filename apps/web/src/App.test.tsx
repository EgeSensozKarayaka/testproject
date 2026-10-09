// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders the platform status and API health', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              service: 'api',
              status: 'ok',
              timestamp: '2026-10-09T17:00:00.000Z',
              version: '0.1.0',
            }),
            { status: 200 },
          ),
        ),
      ),
    );

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Site Availability Monitor' })).toBeDefined();
    expect(await screen.findByText('api erişilebilir')).toBeDefined();
  });
});
