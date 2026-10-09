import { serviceHealthSchema, type ServiceHealth } from '@site-monitor/contracts';
import { useEffect, useState } from 'react';

const apiBaseUrl = import.meta.env.VITE_PUBLIC_API_BASE_URL ?? 'http://localhost:13000';

type ApiState =
  { kind: 'checking' } | { health: ServiceHealth; kind: 'ready' } | { kind: 'unavailable' };

export function App() {
  const [apiState, setApiState] = useState<ApiState>({ kind: 'checking' });

  useEffect(() => {
    const controller = new AbortController();

    async function checkApi() {
      try {
        const response = await fetch(`${apiBaseUrl}/health/live`, { signal: controller.signal });
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const health = serviceHealthSchema.parse(await response.json());
        setApiState({ health, kind: 'ready' });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setApiState({ kind: 'unavailable' });
        }
      }
    }

    void checkApi();
    return () => controller.abort();
  }, []);

  return (
    <main className="shell">
      <section className="card" aria-labelledby="page-title">
        <p className="eyebrow">Platform foundation</p>
        <h1 id="page-title">Site Availability Monitor</h1>
        <p>Aşama 2 çalışma temeli hazır. İzleme ekranları sonraki ürün aşamalarında eklenecek.</p>
        <dl className="status-grid">
          <div>
            <dt>Frontend</dt>
            <dd className="status-ok">Hazır</dd>
          </div>
          <div>
            <dt>API</dt>
            <dd className={apiState.kind === 'ready' ? 'status-ok' : 'status-pending'}>
              {apiState.kind === 'checking' && 'Kontrol ediliyor'}
              {apiState.kind === 'ready' && `${apiState.health.service} erişilebilir`}
              {apiState.kind === 'unavailable' && 'Erişilemiyor'}
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
