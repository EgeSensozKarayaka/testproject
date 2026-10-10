import { useEffect, useState } from 'react';

import { apiRequest, type PublicStatusSnapshot } from './api-client.js';

function label(state: string): string {
  return (
    {
      DOWN: 'Outage',
      SUSPECT: 'Verifying',
      UNKNOWN: 'Unknown',
      UP: 'Operational',
    }[state] ?? state
  );
}

function instant(value: string | null): string {
  if (!value) return 'Not measured yet';
  return new Intl.DateTimeFormat('en-US', {
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
        if (active)
          setError(cause instanceof Error ? cause.message : 'Failed to load status page.');
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
        <h1>Status page not found</h1>
        <p>{error}</p>
      </section>
    );
  }
  if (!snapshot) return <p role="status">Loading public status…</p>;

  return (
    <article className="public-status">
      <header>
        <div className="brand-mark" aria-hidden="true">
          SM
        </div>
        <div>
          <p className="eyebrow">Public service status</p>
          <h1>{snapshot.title}</h1>
          <p>{snapshot.description}</p>
        </div>
        <span className={`public-overall health-${snapshot.overall_health_state.toLowerCase()}`}>
          {label(snapshot.overall_health_state)}
        </span>
      </header>
      {error && (
        <p className="message error" role="alert">
          Update delayed: {error}
        </p>
      )}
      <p className="public-updated" aria-live="polite">
        Last updated: {instant(snapshot.generated_at)} · Automatically refreshes
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
                <dt>Last check</dt>
                <dd>{instant(component.last_checked_at)}</dd>
              </div>
              {'last_response_time_ms' in component && (
                <div>
                  <dt>Response time</dt>
                  <dd>
                    {component.last_response_time_ms === null
                      ? '—'
                      : `${component.last_response_time_ms} ms`}
                  </dd>
                </div>
              )}
              <div>
                <dt>Scheduled maintenance</dt>
                <dd>{component.maintenance_active ? 'Active' : 'None'}</dd>
              </div>
            </dl>
            {component.incident_history && component.incident_history.length > 0 && (
              <details>
                <summary>Recent incidents ({component.incident_history.length})</summary>
                <ul>
                  {component.incident_history.map((incident) => (
                    <li key={`${incident.started_at}-${incident.ended_at}`}>
                      <span>{instant(incident.started_at)}</span>
                      <span>
                        {incident.ended_at ? `Resolved: ${instant(incident.ended_at)}` : 'Ongoing'}
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
        <p className="empty-state">No components published on this page.</p>
      )}
      <footer>
        Site Availability Monitor · Only information published by the page owner is shown.
      </footer>
    </article>
  );
}
