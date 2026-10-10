import { useEffect, useState } from 'react';

import { apiRequest, type PublicStatusSnapshot } from './api-client.js';

function label(state: string): string {
  return (
    {
      DOWN: 'Kesinti',
      SUSPECT: 'Doğrulanıyor',
      UNKNOWN: 'Bilinmiyor',
      UP: 'Operasyonel',
    }[state] ?? state
  );
}

function instant(value: string | null): string {
  if (!value) return 'Henüz ölçülmedi';
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function PublicStatusPage({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<PublicStatusSnapshot | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const value = await apiRequest<PublicStatusSnapshot>(
          `/api/public/v1/status-pages/${encodeURIComponent(token)}`,
        );
        if (active) {
          setSnapshot(value);
          setError('');
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Durum sayfası yüklenemedi.');
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [token]);

  if (error && !snapshot) {
    return (
      <section className="public-status public-error">
        <h1>Durum sayfası bulunamadı</h1>
        <p>{error}</p>
      </section>
    );
  }
  if (!snapshot) return <p role="status">Public durum yükleniyor…</p>;

  return (
    <article className="public-status">
      <header>
        <div className="brand-mark" aria-hidden="true">
          SM
        </div>
        <div>
          <p className="eyebrow">Public servis durumu</p>
          <h1>{snapshot.title}</h1>
          <p>{snapshot.description}</p>
        </div>
        <span className={`public-overall health-${snapshot.overall_health_state.toLowerCase()}`}>
          {label(snapshot.overall_health_state)}
        </span>
      </header>
      {error && (
        <p className="message error" role="alert">
          Güncelleme gecikti: {error}
        </p>
      )}
      <p className="public-updated" aria-live="polite">
        Son güncelleme: {instant(snapshot.generated_at)} · Otomatik yenilenir
      </p>
      <ul className="public-components">
        {snapshot.components.map((component) => (
          <li key={component.id}>
            <div className="public-component-heading">
              <div>
                <span
                  aria-hidden="true"
                  className={`health-indicator health-${component.health_state.toLowerCase()}`}
                />
                <strong>{component.display_name}</strong>
              </div>
              <span className={`status-badge status-${component.health_state.toLowerCase()}`}>
                {label(component.health_state)}
              </span>
            </div>
            {component.url && (
              <a href={component.url} rel="noreferrer" target="_blank">
                {component.url}
              </a>
            )}
            <dl>
              <div>
                <dt>Son kontrol</dt>
                <dd>{instant(component.last_checked_at)}</dd>
              </div>
              {'last_response_time_ms' in component && (
                <div>
                  <dt>Yanıt süresi</dt>
                  <dd>
                    {component.last_response_time_ms === null
                      ? '—'
                      : `${component.last_response_time_ms} ms`}
                  </dd>
                </div>
              )}
              <div>
                <dt>Planlı bakım</dt>
                <dd>{component.maintenance_active ? 'Aktif' : 'Yok'}</dd>
              </div>
            </dl>
            {component.incident_history && component.incident_history.length > 0 && (
              <details>
                <summary>Son olaylar ({component.incident_history.length})</summary>
                <ul>
                  {component.incident_history.map((incident) => (
                    <li key={`${incident.started_at}-${incident.ended_at}`}>
                      <span>{instant(incident.started_at)}</span>
                      <span>
                        {incident.ended_at
                          ? `Kapandı: ${instant(incident.ended_at)}`
                          : 'Devam ediyor'}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
      {snapshot.components.length === 0 && (
        <p className="empty-state">Bu sayfada yayınlanan bileşen yok.</p>
      )}
      <footer>
        Site Availability Monitor · Yalnız sayfa sahibinin yayınladığı bilgiler gösterilir.
      </footer>
    </article>
  );
}
