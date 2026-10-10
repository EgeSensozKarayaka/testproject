import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  type CheckListItem,
  type GroupListItem,
  type HistoryResponse,
  type Incident,
  type MaintenanceWindow,
  type NotificationPolicy,
  type NotificationRecipient,
  type PublicPage,
  type SessionView,
  monitoringApi,
} from './api-client.js';

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function instant(value: string | null): string {
  if (!value) return 'Devam ediyor';
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function duration(value: string): string {
  const minutes = Math.max(0, Math.round(Number(value) / 60_000));
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} sa ${minutes % 60} dk` : `${Math.floor(hours / 24)} gün`;
}

function percentage(value: number | null): string {
  return value === null ? 'Veri yok' : `%${(value * 100).toFixed(value > 0.99 ? 2 : 1)}`;
}

function hasStringField(value: unknown, field: string): boolean {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, field) === 'string'
  );
}

function HistoryChart({ history }: { history: HistoryResponse }) {
  const plotted = history.buckets
    .map((bucket, index) => ({ index, value: bucket.response_time_ms }))
    .filter((item): item is { index: number; value: number } => item.value !== null);
  const max = Math.max(1, ...plotted.map(({ value }) => value));
  const width = 720;
  const height = 180;
  const points = plotted
    .map(({ index, value }) => {
      const x = (index / Math.max(1, history.buckets.length - 1)) * width;
      const y = height - (value / max) * (height - 20) - 10;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  if (plotted.length === 0) {
    return <p className="empty-inline">Bu dönem için ölçülmüş yanıt süresi yok.</p>;
  }

  return (
    <div
      className="history-chart"
      role="img"
      aria-label={`Yanıt süresi grafiği, en yüksek ${max} ms`}
    >
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2={width} y1={height - 10} y2={height - 10} />
        <polyline points={points} />
      </svg>
      <span>0 ms</span>
      <strong>{max} ms tepe</strong>
    </div>
  );
}

export function OperationsWorkspace({
  checks,
  groups,
  onSessionExpired,
  session,
}: {
  checks: CheckListItem[];
  groups: GroupListItem[];
  onSessionExpired: (() => void) | undefined;
  session: SessionView;
}) {
  const [period, setPeriod] = useState<'day' | 'month' | 'week'>('day');
  const [selectedCheckId, setSelectedCheckId] = useState('');
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceWindow[]>([]);
  const [recipients, setRecipients] = useState<NotificationRecipient[]>([]);
  const [policy, setPolicy] = useState<NotificationPolicy | null>(null);
  const [publicPages, setPublicPages] = useState<PublicPage[]>([]);
  const [lastPublicUrl, setLastPublicUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const activeCheckId = checks.some(({ check }) => check.id === selectedCheckId)
    ? selectedCheckId
    : (checks[0]?.check.id ?? '');

  const loadOperations = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [incidentPage, maintenancePage, recipientPage, currentPolicy, publicPageList] =
        await Promise.all([
          monitoringApi.listIncidents(),
          monitoringApi.listMaintenanceWindows(),
          monitoringApi.listNotificationRecipients(),
          monitoringApi.getDefaultNotificationPolicy(),
          monitoringApi.listPublicPages(),
        ]);
      setIncidents(incidentPage.data.filter((item) => hasStringField(item, 'status')));
      setMaintenance(maintenancePage.data.filter((item) => hasStringField(item, 'state')));
      setRecipients(
        recipientPage.data.filter((item) => hasStringField(item, 'verification_state')),
      );
      setPolicy(hasStringField(currentPolicy, 'mode') ? currentPolicy : null);
      setPublicPages(publicPageList.data.filter((item) => hasStringField(item, 'state')));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onSessionExpired?.();
      setError(cause instanceof Error ? cause.message : 'Operasyon verileri yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (active) await loadOperations();
    });
    return () => {
      active = false;
    };
  }, [loadOperations]);

  useEffect(() => {
    if (!activeCheckId) return;
    let active = true;
    void monitoringApi
      .getHistory(activeCheckId, period)
      .then((value) => active && setHistory(Array.isArray(value.buckets) ? value : null))
      .catch((cause: unknown) => {
        if (!active) return;
        setHistory(null);
        setError(cause instanceof Error ? cause.message : 'Geçmiş yüklenemedi.');
      });
    return () => {
      active = false;
    };
  }, [activeCheckId, period]);

  async function command(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
      await loadOperations();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onSessionExpired?.();
      setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.');
    } finally {
      setBusy('');
    }
  }

  async function createMaintenance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const [targetType, targetId] = text(form, 'target').split(':');
    await command(
      'maintenance:create',
      () =>
        monitoringApi.createMaintenanceWindow(session, {
          ends_at: new Date(text(form, 'ends_at')).toISOString(),
          note: text(form, 'note') || null,
          starts_at: new Date(text(form, 'starts_at')).toISOString(),
          target_id: targetId ?? '',
          target_type: targetType as 'CHECK' | 'GROUP',
        }),
      'Bakım penceresi oluşturuldu.',
    );
  }

  async function createRecipient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await command(
      'recipient:create',
      () => monitoringApi.createNotificationRecipient(session, text(form, 'email')),
      'Adres eklendi; doğrulama e-postası Mailpit üzerinden gönderildi.',
    );
    formElement.reset();
  }

  async function updatePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy) return;
    const form = new FormData(event.currentTarget);
    await command(
      'policy:update',
      () =>
        monitoringApi.updateDefaultNotificationPolicy(session, policy, {
          mode: text(form, 'mode') as 'ACTIVE' | 'DISABLED',
          notify_down: form.has('notify_down'),
          notify_recovery: form.has('notify_recovery'),
          recipient_ids: form.getAll('recipient_ids').map(String),
        }),
      'Varsayılan bildirim politikası güncellendi.',
    );
  }

  async function createPublicPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy('public:create');
    setError('');
    setNotice('');
    try {
      const created = await monitoringApi.createPublicPage(session, {
        description: text(form, 'description') || null,
        title: text(form, 'title'),
      });
      const configured = await monitoringApi.replacePublicPageChecks(session, created, checks);
      const published = await monitoringApi.publishPublicPage(session, configured);
      setLastPublicUrl(published.public_url);
      setNotice('Public durum sayfası yayınlandı. Bağlantıyı şimdi kopyalayın.');
      formElement.reset();
      await loadOperations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Public sayfa yayınlanamadı.');
    } finally {
      setBusy('');
    }
  }

  const activeMaintenance = useMemo(
    () => maintenance.filter((window) => window.state === 'ACTIVE' || window.state === 'UPCOMING'),
    [maintenance],
  );

  return (
    <section className="operations-stack" aria-label="Operasyon merkezi">
      {(error || notice) && (
        <div className={`message ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>
          {error || notice}
        </div>
      )}
      {loading && <p role="status">Operasyon verileri yükleniyor…</p>}

      <section className="panel" aria-labelledby="history-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Geçmiş ve olaylar</p>
            <h2 id="history-title">Performans geçmişi</h2>
          </div>
          <div className="inline-controls">
            <label>
              Kontrol
              <select
                value={activeCheckId}
                onChange={(event) => setSelectedCheckId(event.target.value)}
              >
                {checks.length === 0 && <option value="">Kontrol yok</option>}
                {checks.map(({ check }) => (
                  <option key={check.id} value={check.id}>
                    {check.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Dönem
              <select
                value={period}
                onChange={(event) => setPeriod(event.target.value as typeof period)}
              >
                <option value="day">24 saat</option>
                <option value="week">7 gün</option>
                <option value="month">30 gün</option>
              </select>
            </label>
          </div>
        </div>
        {history ? (
          <>
            <dl className="history-summary">
              <div>
                <dt>Uptime</dt>
                <dd>{percentage(history.availability_ratio)}</dd>
              </div>
              <div>
                <dt>Kapsama</dt>
                <dd>{percentage(history.coverage_ratio)}</dd>
              </div>
              <div>
                <dt>Çözünürlük</dt>
                <dd>{history.resolution === 'minute' ? 'Dakika' : 'Saat'}</dd>
              </div>
              <div>
                <dt>Veri sonu</dt>
                <dd>{instant(history.data_through)}</dd>
              </div>
            </dl>
            <HistoryChart history={history} />
          </>
        ) : (
          <p className="empty-inline">Bir kontrol seçildiğinde geçmiş burada gösterilir.</p>
        )}

        <h3 className="subsection-title">Olay günlüğü</h3>
        {incidents.length === 0 ? (
          <p className="empty-inline">Henüz doğrulanmış incident yok.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Kontrol</th>
                  <th>Durum</th>
                  <th>Başlangıç</th>
                  <th>Bitiş</th>
                  <th>Süre</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((incident) => (
                  <tr key={incident.id}>
                    <td>{incident.check_name}</td>
                    <td>
                      <span className={`status-badge status-${incident.status.toLowerCase()}`}>
                        {incident.status === 'OPEN' ? 'Açık' : 'Kapandı'}
                      </span>
                    </td>
                    <td>{instant(incident.started_at)}</td>
                    <td>{instant(incident.ended_at)}</td>
                    <td>{duration(incident.wall_duration_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="maintenance-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Planlı çalışma</p>
            <h2 id="maintenance-title">Bakım pencereleri</h2>
          </div>
          <span className="count-pill">{activeMaintenance.length} açık</span>
        </div>
        <form
          className="resource-form maintenance-form"
          onSubmit={(event) => void createMaintenance(event)}
        >
          <label>
            Hedef
            <select name="target" required defaultValue="">
              <option value="" disabled>
                Kontrol veya grup seçin
              </option>
              {checks.map(({ check }) => (
                <option key={check.id} value={`CHECK:${check.id}`}>
                  Kontrol · {check.name}
                </option>
              ))}
              {groups.map(({ group }) => (
                <option key={group.id} value={`GROUP:${group.id}`}>
                  Grup · {group.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Başlangıç
            <input name="starts_at" type="datetime-local" required />
          </label>
          <label>
            Bitiş
            <input name="ends_at" type="datetime-local" required />
          </label>
          <label>
            Not
            <input name="note" maxLength={1000} placeholder="Planlı bakım" />
          </label>
          <div className="form-actions">
            <button
              className="primary compact"
              disabled={busy === 'maintenance:create'}
              type="submit"
            >
              Bakım planla
            </button>
          </div>
        </form>
        {maintenance.length === 0 ? (
          <p className="empty-inline">Bakım penceresi yok.</p>
        ) : (
          <ul className="compact-list">
            {maintenance.map((window) => (
              <li key={window.id}>
                <div>
                  <strong>{window.target_type === 'CHECK' ? 'Kontrol' : 'Grup'} bakımı</strong>
                  <span>
                    {instant(window.starts_at)} – {instant(window.ends_at)} ·{' '}
                    {window.note || 'Not yok'}
                  </span>
                </div>
                <div className="row-actions">
                  <Status state={window.state} />
                  {['ACTIVE', 'UPCOMING'].includes(window.state) && (
                    <button
                      className="danger compact"
                      disabled={busy === `maintenance:${window.id}`}
                      onClick={() =>
                        void command(
                          `maintenance:${window.id}`,
                          () => monitoringApi.cancelMaintenanceWindow(session, window),
                          'Bakım penceresi iptal edildi.',
                        )
                      }
                      type="button"
                    >
                      İptal et
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" aria-labelledby="notifications-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">E-posta</p>
            <h2 id="notifications-title">Bildirim ayarları</h2>
          </div>
          <span className="count-pill">{recipients.length} adres</span>
        </div>
        <form className="inline-form" onSubmit={(event) => void createRecipient(event)}>
          <label>
            E-posta adresi
            <input name="email" type="email" required maxLength={254} />
          </label>
          <button className="primary compact" disabled={busy === 'recipient:create'} type="submit">
            Adres ekle
          </button>
        </form>
        {recipients.length === 0 ? (
          <p className="empty-inline">Bildirim adresi eklenmedi.</p>
        ) : (
          <ul className="compact-list">
            {recipients.map((recipient) => (
              <li key={recipient.id}>
                <div>
                  <strong>{recipient.email}</strong>
                  <span>
                    {recipient.verification_state === 'VERIFIED'
                      ? 'Doğrulandı'
                      : recipient.verification_state === 'PENDING'
                        ? 'Doğrulama bekliyor'
                        : 'Devre dışı'}
                  </span>
                </div>
                <div className="row-actions">
                  {recipient.verification_state === 'PENDING' && (
                    <button
                      className="ghost compact"
                      onClick={() =>
                        void command(
                          `recipient:verify:${recipient.id}`,
                          () => monitoringApi.resendNotificationVerification(session, recipient),
                          'Doğrulama e-postası yeniden gönderildi.',
                        )
                      }
                      type="button"
                    >
                      Doğrulamayı gönder
                    </button>
                  )}
                  {recipient.verification_state === 'VERIFIED' && (
                    <button
                      className="ghost compact"
                      onClick={() =>
                        void command(
                          `recipient:test:${recipient.id}`,
                          () => monitoringApi.sendNotificationTest(session, recipient),
                          'Test e-postası gönderildi.',
                        )
                      }
                      type="button"
                    >
                      Test e-postası
                    </button>
                  )}
                  {recipient.verification_state !== 'DISABLED' && (
                    <button
                      className="danger compact"
                      onClick={() =>
                        void command(
                          `recipient:delete:${recipient.id}`,
                          () => monitoringApi.deleteNotificationRecipient(session, recipient),
                          'Bildirim adresi devre dışı bırakıldı.',
                        )
                      }
                      type="button"
                    >
                      Kaldır
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {policy && (
          <form className="policy-form" onSubmit={(event) => void updatePolicy(event)}>
            <h3>Varsayılan politika</h3>
            <label>
              Mod
              <select name="mode" defaultValue={policy.mode}>
                <option value="ACTIVE">Aktif</option>
                <option value="DISABLED">Kapalı</option>
              </select>
            </label>
            <label className="check-option">
              <input
                name="notify_down"
                type="checkbox"
                defaultChecked={policy.notify_down === true}
              />{' '}
              Kesinti e-postası
            </label>
            <label className="check-option">
              <input
                name="notify_recovery"
                type="checkbox"
                defaultChecked={policy.notify_recovery === true}
              />{' '}
              Kurtarma e-postası
            </label>
            <fieldset>
              <legend>Alıcılar</legend>
              {recipients
                .filter((recipient) => recipient.verification_state === 'VERIFIED')
                .map((recipient) => (
                  <label className="check-option" key={recipient.id}>
                    <input
                      name="recipient_ids"
                      value={recipient.id}
                      type="checkbox"
                      defaultChecked={policy.recipient_ids.includes(recipient.id)}
                    />{' '}
                    {recipient.email}
                  </label>
                ))}
            </fieldset>
            <button className="primary compact" disabled={busy === 'policy:update'} type="submit">
              Politikayı kaydet
            </button>
          </form>
        )}
      </section>

      <section className="panel" aria-labelledby="public-page-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Giriş gerektirmez</p>
            <h2 id="public-page-title">Public durum sayfası</h2>
            <p>Yalnız seçilen yayın alanları gösterilir; URL'ler varsayılan olarak gizlidir.</p>
          </div>
          <span className="count-pill">{publicPages.length} sayfa</span>
        </div>
        <form
          className="inline-form public-page-form"
          onSubmit={(event) => void createPublicPage(event)}
        >
          <label>
            Sayfa başlığı
            <input name="title" required maxLength={160} placeholder="Servis durumu" />
          </label>
          <label>
            Sayfa açıklaması
            <input
              name="description"
              maxLength={2000}
              placeholder="Güncel servis sağlık bilgileri"
            />
          </label>
          <button
            className="primary compact"
            disabled={busy === 'public:create' || checks.length === 0}
            type="submit"
          >
            Tüm kontrollerle yayınla
          </button>
        </form>
        {checks.length === 0 && (
          <p className="empty-inline">Public sayfa yayınlamak için önce bir kontrol ekleyin.</p>
        )}
        {lastPublicUrl && (
          <div className="public-link-result" role="group" aria-label="Public durum bağlantısı">
            <strong>Tek sefer gösterilen bağlantı</strong>
            <a href={lastPublicUrl} target="_blank" rel="noreferrer">
              {lastPublicUrl}
            </a>
          </div>
        )}
        {publicPages.length > 0 && (
          <ul className="compact-list">
            {publicPages.map((page) => (
              <li key={page.id}>
                <div>
                  <strong>{page.title}</strong>
                  <span>
                    {page.components.length} bileşen ·{' '}
                    {page.state === 'PUBLISHED'
                      ? 'Yayında'
                      : page.state === 'DISABLED'
                        ? 'Kapalı'
                        : 'Taslak'}
                  </span>
                </div>
                <div className="row-actions">
                  {page.state === 'PUBLISHED' ? (
                    <>
                      <button
                        className="ghost compact"
                        onClick={() =>
                          void command(
                            `public:rotate:${page.id}`,
                            async () => {
                              const result = await monitoringApi.rotatePublicPageLink(
                                session,
                                page,
                              );
                              setLastPublicUrl(result.public_url);
                            },
                            'Bağlantı yenilendi; eski bağlantı artık geçersiz.',
                          )
                        }
                        type="button"
                      >
                        Bağlantıyı yenile
                      </button>
                      <button
                        className="danger compact"
                        onClick={() =>
                          void command(
                            `public:disable:${page.id}`,
                            () => monitoringApi.disablePublicPage(session, page),
                            'Public sayfa kapatıldı.',
                          )
                        }
                        type="button"
                      >
                        Yayını kapat
                      </button>
                    </>
                  ) : (
                    <button
                      className="primary compact"
                      onClick={() =>
                        void command(
                          `public:publish:${page.id}`,
                          async () => {
                            const result = await monitoringApi.publishPublicPage(session, page);
                            setLastPublicUrl(result.public_url);
                          },
                          'Public sayfa yeniden yayınlandı.',
                        )
                      }
                      type="button"
                    >
                      Yayınla
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function Status({ state }: { state: string }) {
  const labels: Record<string, string> = {
    ACTIVE: 'Aktif',
    CANCELLED: 'İptal',
    ENDED: 'Bitti',
    UPCOMING: 'Yaklaşan',
  };
  return (
    <span className={`status-badge status-${state.toLowerCase()}`}>{labels[state] ?? state}</span>
  );
}
