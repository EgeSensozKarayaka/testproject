import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { apiRequest, type SessionView } from './api-client.js';
import { MonitoringDashboard } from './monitoring-ui.js';

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
        setNotice('Uygunsa doğrulama bağlantısı e-posta adresinize gönderildi.');
      } else {
        await apiRequest('/api/v1/auth/password-resets', {
          body: JSON.stringify({ email }),
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          method: 'POST',
        });
        setNotice('Uygunsa parola sıfırlama bağlantısı e-posta adresinize gönderildi.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'İstek tamamlanamadı.');
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
        {mode === 'login' && 'Hesabınıza giriş yapın'}
        {mode === 'register' && 'İzlemeye başlayın'}
        {mode === 'forgot' && 'Parolanızı sıfırlayın'}
      </h1>
      <p className="lede">
        {mode === 'login' && 'Kontrollerinizi, olayları ve servis sağlığını tek yerden yönetin.'}
        {mode === 'register' &&
          'Hesabınızı oluşturun; doğrulamadan sonra çalışma alanınız hazır olacak.'}
        {mode === 'forgot' && 'Adresinizi girin. Hesap uygunsa güvenli bir bağlantı göndereceğiz.'}
      </p>

      <form onSubmit={(event) => void submit(event)}>
        {mode === 'register' && (
          <label>
            Görünen ad
            <input name="display_name" autoComplete="name" maxLength={120} required />
          </label>
        )}
        <label>
          E-posta
          <input name="email" type="email" autoComplete="email" maxLength={254} required />
        </label>
        {mode !== 'forgot' && (
          <label>
            Parola
            <input
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'register' ? 15 : 1}
              maxLength={128}
              required
            />
            {mode === 'register' && (
              <span className="hint">En az 15 karakter ve tahmin edilmesi güç bir ifade.</span>
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
            ? 'Gönderiliyor…'
            : mode === 'login'
              ? 'Giriş yap'
              : mode === 'register'
                ? 'Hesap oluştur'
                : 'Bağlantı gönder'}
        </button>
      </form>

      <div className="auth-actions">
        {mode === 'login' ? (
          <>
            <button className="link-button" onClick={() => setMode('forgot')} type="button">
              Parolamı unuttum
            </button>
            <button className="link-button" onClick={() => setMode('register')} type="button">
              Yeni hesap
            </button>
          </>
        ) : (
          <button className="link-button" onClick={() => setMode('login')} type="button">
            Giriş ekranına dön
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
    kind === 'verify' && !token ? 'Doğrulama bağlantısında token bulunamadı.' : '',
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
        setMessage('E-posta adresiniz doğrulandı. Artık giriş yapabilirsiniz.');
      })
      .catch((cause: unknown) => {
        setState('error');
        setMessage(cause instanceof Error ? cause.message : 'Bağlantı doğrulanamadı.');
      });
  }, [kind, token]);

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setState('error');
      setMessage('Sıfırlama bağlantısında token bulunamadı.');
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
      setMessage('Parolanız değiştirildi. Tüm eski oturumlar kapatıldı.');
    } catch (cause) {
      setState('error');
      setMessage(cause instanceof Error ? cause.message : 'Parola değiştirilemedi.');
    }
  }

  return (
    <section className="auth-card" aria-labelledby="token-title">
      <div className="brand-mark" aria-hidden="true">
        SM
      </div>
      <h1 id="token-title">{kind === 'verify' ? 'E-posta doğrulama' : 'Yeni parola'}</h1>
      {kind === 'reset' && state !== 'success' && (
        <form onSubmit={(event) => void resetPassword(event)}>
          <label>
            Yeni parola
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
            Parolayı değiştir
          </button>
        </form>
      )}
      {state === 'busy' && <p role="status">Bağlantı doğrulanıyor…</p>}
      {message && (
        <p className={`message ${state}`} role={state === 'error' ? 'alert' : 'status'}>
          {message}
        </p>
      )}
      <a className="back-link" href="/">
        Giriş ekranına dön
      </a>
    </section>
  );
}

export function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  const path = window.location.pathname;
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
      {path === '/verify-email' && <TokenAction kind="verify" />}
      {path === '/reset-password' && <TokenAction kind="reset" />}
      {path === '/' && checking && <p role="status">Oturum kontrol ediliyor…</p>}
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
