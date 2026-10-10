import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { apiRequest, type SessionView } from './api-client.js';
import { MonitoringDashboard } from './monitoring-ui.js';
import { PublicStatusPage } from './public-status-ui.js';

function takeFragmentToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  return token;
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function AuthCard({ onLogin }: { onLogin: (session: SessionView) => void }) {
  const [mode, setMode] = useState<'forgot' | 'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    const email = formText(form, 'email');
    try {
      if (mode === 'login') {
        onLogin(
          await apiRequest<SessionView>('/api/v1/auth/login', {
            body: JSON.stringify({ email, password: formText(form, 'password') }),
            method: 'POST',
          }),
        );
      } else if (mode === 'register') {
        await apiRequest('/api/v1/auth/register', {
          body: JSON.stringify({
            display_name: formText(form, 'display_name'),
            email,
            password: formText(form, 'password'),
          }),
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          method: 'POST',
        });
        setNotice('If eligible, a verification link has been sent to your email address.');
      } else {
        await apiRequest('/api/v1/auth/password-resets', {
          body: JSON.stringify({ email }),
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          method: 'POST',
        });
        setNotice('If eligible, a password reset link has been sent to your email address.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="brand-mark" aria-hidden="true">
        SM
      </div>
      <p className="eyebrow">Site Availability Monitor</p>
      <h1 id="auth-title">
        {mode === 'login' && 'Log in to your account'}
        {mode === 'register' && 'Start monitoring'}
        {mode === 'forgot' && 'Reset your password'}
      </h1>
      <p className="lede">
        {mode === 'login' && 'Manage your checks, incidents, and service health from one place.'}
        {mode === 'register' &&
          'Create your account; your workspace will be ready after verification.'}
        {mode === 'forgot' &&
          'Enter your email address. If an account matches, we will send a secure link.'}
      </p>

      <form onSubmit={(event) => void submit(event)}>
        {mode === 'register' && (
          <label>
            Display name
            <input name="display_name" autoComplete="name" maxLength={120} required />
          </label>
        )}
        <label>
          Email
          <input name="email" type="email" autoComplete="email" maxLength={254} required />
        </label>
        {mode !== 'forgot' && (
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'register' ? 15 : 1}
              maxLength={128}
              required
            />
            {mode === 'register' && (
              <span className="hint">At least 15 characters and hard to guess.</span>
            )}
          </label>
        )}
        {error && (
          <p className="message error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="message success" role="status">
            {notice}
          </p>
        )}
        <button className="primary" disabled={busy} type="submit">
          {busy
            ? 'Submitting…'
            : mode === 'login'
              ? 'Log in'
              : mode === 'register'
                ? 'Create account'
                : 'Send link'}
        </button>
      </form>

      <div className="auth-actions">
        {mode === 'login' ? (
          <>
            <button className="link-button" onClick={() => setMode('forgot')} type="button">
              Forgot password
            </button>
            <button className="link-button" onClick={() => setMode('register')} type="button">
              Create account
            </button>
          </>
        ) : (
          <button className="link-button" onClick={() => setMode('login')} type="button">
            Back to log in
          </button>
        )}
      </div>
    </section>
  );
}

function TokenAction({ kind }: { kind: 'reset' | 'verify' }) {
  const [token] = useState(takeFragmentToken);
  const [state, setState] = useState<'busy' | 'error' | 'ready' | 'success'>(() =>
    kind === 'verify' ? (token ? 'busy' : 'error') : 'ready',
  );
  const [message, setMessage] = useState(() =>
    kind === 'verify' && !token ? 'No token found in verification link.' : '',
  );

  useEffect(() => {
    if (kind !== 'verify') return;
    if (!token) return;
    void apiRequest('/api/v1/auth/email-verifications/confirm', {
      body: JSON.stringify({ token }),
      method: 'POST',
    })
      .then(() => {
        setState('success');
        setMessage('Your email address has been verified. You can now log in.');
      })
      .catch((cause: unknown) => {
        setState('error');
        setMessage(cause instanceof Error ? cause.message : 'Could not verify link.');
      });
  }, [kind, token]);

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setState('error');
      setMessage('No token found in reset link.');
      return;
    }
    setState('busy');
    const password = formText(new FormData(event.currentTarget), 'password');
    try {
      await apiRequest('/api/v1/auth/password-resets/confirm', {
        body: JSON.stringify({ password, token }),
        method: 'POST',
      });
      setState('success');
      setMessage('Your password has been changed. All previous sessions have been signed out.');
    } catch (cause) {
      setState('error');
      setMessage(cause instanceof Error ? cause.message : 'Could not change password.');
    }
  }

  return (
    <section className="auth-card" aria-labelledby="token-title">
      <div className="brand-mark" aria-hidden="true">
        SM
      </div>
      <h1 id="token-title">{kind === 'verify' ? 'Email verification' : 'New password'}</h1>
      {kind === 'reset' && state !== 'success' && (
        <form onSubmit={(event) => void resetPassword(event)}>
          <label>
            New password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={15}
              maxLength={128}
              required
            />
          </label>
          <button className="primary" disabled={state === 'busy'} type="submit">
            Change password
          </button>
        </form>
      )}
      {state === 'busy' && <p role="status">Verifying link…</p>}
      {message && (
        <p className={`message ${state}`} role={state === 'error' ? 'alert' : 'status'}>
          {message}
        </p>
      )}
      <a className="back-link" href="/">
        Back to log in
      </a>
    </section>
  );
}

export function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  const path = window.location.pathname;
  const publicToken = path.startsWith('/status/') ? decodeURIComponent(path.slice(8)) : null;
  const [checking, setChecking] = useState(path === '/');
  const sessionExpired = useCallback(() => setSession(null), []);

  useEffect(() => {
    if (path !== '/') return;
    void apiRequest<SessionView>('/api/v1/auth/session')
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setChecking(false));
  }, [path]);

  async function logout() {
    if (!session) return;
    await apiRequest('/api/v1/auth/logout', {
      body: JSON.stringify({}),
      headers: { 'X-CSRF-Token': session.csrf_token },
      method: 'POST',
    });
    setSession(null);
  }

  return (
    <main className="shell">
      {publicToken && <PublicStatusPage token={publicToken} />}
      {path === '/verify-email' && <TokenAction kind="verify" />}
      {path === '/reset-password' && <TokenAction kind="reset" />}
      {path === '/' && checking && <p role="status">Checking session…</p>}
      {path === '/' && !checking && session && (
        <MonitoringDashboard
          onLogout={() => void logout()}
          onSessionExpired={sessionExpired}
          session={session}
        />
      )}
      {path === '/' && !checking && !session && <AuthCard onLogin={setSession} />}
    </main>
  );
}
