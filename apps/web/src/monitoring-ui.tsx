import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  type Check,
  type CheckListItem,
  type CheckWriteInput,
  type Group,
  type GroupListItem,
  type GroupWriteInput,
  type SessionView,
  monitoringApi,
} from './api-client.js';
import { PrivateRealtimeSync, type RealtimeConnectionState } from './realtime-client.js';

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function formatInstant(value: string | null): string {
  if (!value) return 'Henüz çalışmadı';
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days} gün ${hours} sa`;
  if (hours > 0) return `${hours} sa ${minutes} dk`;
  if (minutes > 0) return `${minutes} dk ${seconds} sn`;
  return `${seconds} sn`;
}

const stateLabels: Record<string, string> = {
  ACTIVE: 'Aktif',
  DOWN: 'Erişilemiyor',
  FRESH: 'Güncel',
  PAUSED: 'Duraklatıldı',
  STALE: 'Gecikmiş veri',
  SUSPECT: 'Doğrulanıyor',
  UNKNOWN: 'Bilinmiyor',
  UP: 'Çalışıyor',
};

function needsAttention({ check, status }: CheckListItem): boolean {
  if (check.execution_state === 'PAUSED') return false;
  return (
    status.current_incident !== null ||
    status.freshness_state === 'STALE' ||
    ['DOWN', 'SUSPECT', 'UNKNOWN'].includes(status.health_state)
  );
}

function GroupForm({
  busy,
  initial,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  initial?: Group;
  onCancel?: () => void;
  onSubmit: (input: GroupWriteInput) => Promise<boolean>;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const description = formText(form, 'description');
    const saved = await onSubmit({
      description: description === '' ? null : description,
      name: formText(form, 'name'),
    });
    if (saved && !initial) formElement.reset();
  }

  return (
    <form className="resource-form" onSubmit={(event) => void submit(event)}>
      <label>
        Grup adı
        <input defaultValue={initial?.name} maxLength={120} name="name" required />
      </label>
      <label>
        Açıklama <span className="optional">(isteğe bağlı)</span>
        <textarea defaultValue={initial?.description ?? ''} maxLength={500} name="description" />
      </label>
      <div className="form-actions">
        <button className="primary compact" disabled={busy} type="submit">
          {busy ? 'Kaydediliyor…' : initial ? 'Grubu güncelle' : 'Grup oluştur'}
        </button>
        {onCancel && (
          <button className="ghost" disabled={busy} onClick={onCancel} type="button">
            Vazgeç
          </button>
        )}
      </div>
    </form>
  );
}

function CheckForm({
  busy,
  groups,
  initial,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  groups: GroupListItem[];
  initial?: Check;
  onCancel?: () => void;
  onSubmit: (input: CheckWriteInput) => Promise<boolean>;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const expectedBody = formText(form, 'expected_body_substring');
    const groupId = formText(form, 'group_id');
    const saved = await onSubmit({
      expected_body_substring: expectedBody === '' ? null : expectedBody,
      expected_status_code: Number(formText(form, 'expected_status_code')),
      group_id: groupId === '' ? null : groupId,
      interval_seconds: Number(formText(form, 'interval_seconds')),
      name: formText(form, 'name'),
      timeout_ms: Number(formText(form, 'timeout_ms')),
      url: formText(form, 'url'),
    });
    if (saved && !initial) formElement.reset();
  }

  return (
    <form className="resource-form check-form" onSubmit={(event) => void submit(event)}>
      <label>
        Kontrol adı
        <input defaultValue={initial?.name} maxLength={160} name="name" required />
      </label>
      <label className="wide-field">
        URL
        <input
          defaultValue={initial?.url}
          inputMode="url"
          maxLength={2048}
          name="url"
          placeholder="https://example.com/health"
          required
          type="url"
        />
      </label>
      <label>
        Kontrol aralığı (saniye)
        <input
          defaultValue={initial?.interval_seconds ?? 30}
          max={3600}
          min={30}
          name="interval_seconds"
          required
          type="number"
        />
      </label>
      <label>
        Zaman aşımı (ms)
        <input
          defaultValue={initial?.timeout_ms ?? 5000}
          max={60000}
          min={100}
          name="timeout_ms"
          required
          type="number"
        />
      </label>
      <label>
        Beklenen HTTP kodu
        <input
          defaultValue={initial?.expected_status_code ?? 200}
          max={599}
          min={100}
          name="expected_status_code"
          required
          type="number"
        />
      </label>
      <label>
        Grup
        <select defaultValue={initial?.group_id ?? ''} name="group_id">
          <option value="">Grupsuz</option>
          {groups.map(({ group }) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>
      <label className="wide-field">
        Beklenen metin <span className="optional">(isteğe bağlı, büyük/küçük harfe duyarlı)</span>
        <input
          defaultValue={initial?.expected_body_substring ?? ''}
          maxLength={2048}
          name="expected_body_substring"
        />
      </label>
      <div className="form-actions wide-field">
        <button className="primary compact" disabled={busy} type="submit">
          {busy ? 'Kaydediliyor…' : initial ? 'Kontrolü güncelle' : 'Kontrol ekle'}
        </button>
        {onCancel && (
          <button className="ghost" disabled={busy} onClick={onCancel} type="button">
            Vazgeç
          </button>
        )}
      </div>
    </form>
  );
}

function StatusBadge({ state }: { state: string }) {
  return (
    <span className={`status-badge status-${state.toLowerCase()}`}>
      {stateLabels[state] ?? state}
    </span>
  );
}

type DashboardFilter = 'all' | 'attention' | 'incident' | 'maintenance' | 'paused';

export function MonitoringDashboard({
  onLogout,
  onSessionExpired,
  session,
}: {
  onLogout: () => void;
  onSessionExpired?: () => void;
  session: SessionView;
}) {
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [checks, setChecks] = useState<CheckListItem[]>([]);
  const [groupCursor, setGroupCursor] = useState<string | null>(null);
  const [checkCursor, setCheckCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState<'checks' | 'groups' | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCheckForm, setShowCheckForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editingCheck, setEditingCheck] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [realtimeState, setRealtimeState] = useState<RealtimeConnectionState>('connecting');
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>('all');
  const [now, setNow] = useState(Date.now);

  const dashboard = useMemo(() => {
    const active = checks.filter(({ check }) => check.execution_state === 'ACTIVE');
    const operational = active.filter(
      ({ status }) => status.health_state === 'UP' && status.freshness_state === 'FRESH',
    ).length;
    const incidents = checks.filter(({ status }) => status.current_incident !== null).length;
    const maintenance = checks.filter(({ status }) => status.maintenance.active).length;
    const attention = checks.filter(needsAttention).length;
    const visible = checks
      .filter((item) => {
        if (dashboardFilter === 'attention') return needsAttention(item);
        if (dashboardFilter === 'incident') return item.status.current_incident !== null;
        if (dashboardFilter === 'maintenance') return item.status.maintenance.active;
        if (dashboardFilter === 'paused') return item.check.execution_state === 'PAUSED';
        return true;
      })
      .sort((left, right) => {
        const score = (item: CheckListItem) =>
          item.status.current_incident !== null
            ? 0
            : needsAttention(item)
              ? 1
              : item.status.maintenance.active
                ? 2
                : item.check.execution_state === 'PAUSED'
                  ? 3
                  : 4;
        return score(left) - score(right) || left.check.name.localeCompare(right.check.name, 'tr');
      });
    return { active: active.length, attention, incidents, maintenance, operational, visible };
  }, [checks, dashboardFilter]);

  const reload = useCallback(async (showLoading = true, propagateError = false) => {
    if (showLoading) setLoading(true);
    try {
      const [groupPage, checkPage] = await Promise.all([
        monitoringApi.listGroups(),
        monitoringApi.listChecks(),
      ]);
      setGroups(groupPage.data);
      setChecks(checkPage.data);
      setGroupCursor(groupPage.page.next_cursor);
      setCheckCursor(checkPage.page.next_cursor);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kaynaklar yüklenemedi.');
      if (propagateError) throw cause;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void reload();
    });
    return () => {
      active = false;
    };
  }, [reload]);

  useEffect(() => {
    const realtime = new PrivateRealtimeSync({
      onAuthLost: () => onSessionExpired?.(),
      onState: setRealtimeState,
      reconcile: () => reload(false, true),
    });
    realtime.start();
    return () => realtime.stop();
  }, [onSessionExpired, reload]);

  useEffect(() => {
    if (!checks.some(({ status }) => status.current_incident !== null)) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [checks]);

  async function perform(
    key: string,
    action: () => Promise<unknown>,
    successMessage: string,
  ): Promise<boolean> {
    setBusyKey(key);
    setError('');
    setNotice('');
    try {
      await action();
      await reload(false);
      if (successMessage) setNotice(successMessage);
      setEditingCheck(null);
      setEditingGroup(null);
      setConfirmDelete(null);
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 412) {
        await reload(false);
        setEditingCheck(null);
        setEditingGroup(null);
        setError(
          'Bu kaynak başka bir oturumda değiştirildi. Güncel veriler yüklendi; değişikliği yeniden gözden geçirin.',
        );
      } else {
        setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.');
      }
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function loadMoreGroups() {
    if (!groupCursor) return;
    setLoadingMore('groups');
    try {
      const page = await monitoringApi.listGroups(groupCursor);
      setGroups((current) => [...current, ...page.data]);
      setGroupCursor(page.page.next_cursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gruplar yüklenemedi.');
    } finally {
      setLoadingMore(null);
    }
  }

  async function loadMoreChecks() {
    if (!checkCursor) return;
    setLoadingMore('checks');
    try {
      const page = await monitoringApi.listChecks(checkCursor);
      setChecks((current) => [...current, ...page.data]);
      setCheckCursor(page.page.next_cursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kontroller yüklenemedi.');
    } finally {
      setLoadingMore(null);
    }
  }

  return (
    <div className="workspace">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Site Availability Monitor</p>
          <h1>Hoş geldiniz, {session.user.display_name}</h1>
          <p className="workspace-subtitle">{session.user.email}</p>
        </div>
        <div className="header-controls">
          <span
            aria-label="Canlı veri durumu"
            className={`realtime-state realtime-${realtimeState}`}
          >
            <span aria-hidden="true" className="realtime-dot" />
            {realtimeState === 'live' && 'Canlı güncellemeler etkin'}
            {realtimeState === 'connecting' && 'Canlı bağlantı kuruluyor'}
            {realtimeState === 'reconnecting' && 'Canlı bağlantı yeniden kuruluyor'}
            {realtimeState === 'polling' && 'Periyodik yenileme etkin'}
          </span>
          <button className="secondary header-action" onClick={onLogout} type="button">
            Çıkış yap
          </button>
        </div>
      </header>

      {error && (
        <div className="message error workspace-message" role="alert">
          <span>{error}</span>
          <button className="link-button" onClick={() => void reload()} type="button">
            Yeniden dene
          </button>
        </div>
      )}
      {notice && (
        <p className="message success workspace-message" role="status">
          {notice}
        </p>
      )}

      {loading ? (
        <section className="panel loading-panel" aria-busy="true">
          <p role="status">Kontroller ve gruplar yükleniyor…</p>
        </section>
      ) : (
        <>
          <section className="panel overview-panel" aria-labelledby="overview-title">
            <div className="section-heading overview-heading">
              <div>
                <p className="eyebrow">Canlı görünüm</p>
                <h2 id="overview-title">Sistem durumu</h2>
                <p>Yüklenen kontrollerin güncel sağlık, olay ve bakım özeti.</p>
              </div>
              <span className="count-pill">{checks.length} kontrol yüklendi</span>
            </div>

            <dl className="overview-grid" aria-label="Sistem durum özeti">
              <div className="metric-card metric-neutral">
                <dt>Aktif izleme</dt>
                <dd>{dashboard.active}</dd>
              </div>
              <div className="metric-card metric-up">
                <dt>Operasyonel</dt>
                <dd>{dashboard.operational}</dd>
              </div>
              <div className="metric-card metric-down">
                <dt>Aktif olay</dt>
                <dd>{dashboard.incidents}</dd>
              </div>
              <div className="metric-card metric-maintenance">
                <dt>Bakımda</dt>
                <dd>{dashboard.maintenance}</dd>
              </div>
              <div className="metric-card metric-warning">
                <dt>Dikkat gerekli</dt>
                <dd>{dashboard.attention}</dd>
              </div>
            </dl>

            <div className="dashboard-filters" aria-label="Durum görünümü filtresi" role="group">
              {(
                [
                  ['all', 'Tümü'],
                  ['attention', 'Dikkat gerekli'],
                  ['incident', 'Aktif olaylar'],
                  ['maintenance', 'Bakımda'],
                  ['paused', 'Duraklatılmış'],
                ] as const
              ).map(([value, label]) => (
                <button
                  aria-pressed={dashboardFilter === value}
                  className="filter-button"
                  key={value}
                  onClick={() => setDashboardFilter(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            {dashboard.visible.length === 0 ? (
              <div className="empty-state compact-empty">
                <h3>Bu görünümde kontrol yok</h3>
                <p>Başka bir durum filtresi seçebilir veya yeni bir kontrol ekleyebilirsiniz.</p>
              </div>
            ) : (
              <ul className="status-list">
                {dashboard.visible.map(({ check, status }) => (
                  <li
                    className={
                      needsAttention({ check, status }) ? 'status-row has-problem' : 'status-row'
                    }
                    key={check.id}
                  >
                    <div className="status-primary">
                      <span
                        aria-hidden="true"
                        className={`health-indicator health-${status.health_state.toLowerCase()}`}
                      />
                      <div>
                        <strong>{check.name}</strong>
                        <span>{check.url}</span>
                      </div>
                    </div>
                    <div className="status-signals">
                      <StatusBadge state={status.health_state} />
                      {status.freshness_state === 'STALE' && <StatusBadge state="STALE" />}
                      {status.maintenance.active && (
                        <span className="maintenance-badge">Bakımda</span>
                      )}
                    </div>
                    <dl className="status-facts">
                      <div>
                        <dt>Yanıt</dt>
                        <dd>
                          {status.last_response_time_ms === null
                            ? '—'
                            : `${status.last_response_time_ms} ms`}
                        </dd>
                      </div>
                      <div>
                        <dt>Son kontrol</dt>
                        <dd>{formatInstant(status.last_checked_at)}</dd>
                      </div>
                      <div>
                        <dt>Mevcut kesinti</dt>
                        <dd className={status.current_incident ? 'incident-duration' : undefined}>
                          {status.current_incident
                            ? formatDuration(now - Date.parse(status.current_incident.started_at))
                            : 'Yok'}
                        </dd>
                      </div>
                    </dl>
                    <a className="detail-link" href={`#check-${check.id}`}>
                      Ayrıntı ve yönetim
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="groups-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Düzen</p>
                <h2 id="groups-title">Gruplar</h2>
                <p>Kontrolleri servis veya ürün sınırlarına göre düzenleyin.</p>
              </div>
              <span className="count-pill">{groups.length} grup</span>
            </div>

            <details className="create-box">
              <summary>Yeni grup oluştur</summary>
              <GroupForm
                busy={busyKey === 'group:create'}
                onSubmit={(input) =>
                  perform(
                    'group:create',
                    () => monitoringApi.createGroup(session, input),
                    'Grup oluşturuldu.',
                  )
                }
              />
            </details>

            {groups.length === 0 ? (
              <div className="empty-state">
                <h3>Henüz grup yok</h3>
                <p>
                  Gruplar zorunlu değildir. Kontrolleri daha sonra da bir gruba taşıyabilirsiniz.
                </p>
              </div>
            ) : (
              <ul className="resource-grid group-grid">
                {groups.map(({ group, status }) => (
                  <li className="resource-card" key={group.id}>
                    {editingGroup === group.id ? (
                      <GroupForm
                        busy={busyKey === `group:update:${group.id}`}
                        initial={group}
                        onCancel={() => setEditingGroup(null)}
                        onSubmit={(input) =>
                          perform(
                            `group:update:${group.id}`,
                            () => monitoringApi.updateGroup(session, group, input),
                            'Grup güncellendi.',
                          )
                        }
                      />
                    ) : (
                      <>
                        <div className="card-heading">
                          <div>
                            <h3>{group.name}</h3>
                            <p>{group.description ?? 'Açıklama eklenmemiş.'}</p>
                          </div>
                          <StatusBadge state={status.health_state} />
                        </div>
                        <dl className="compact-stats">
                          <div>
                            <dt>Yukarıda</dt>
                            <dd>{status.up}</dd>
                          </div>
                          <div>
                            <dt>Aşağıda</dt>
                            <dd>{status.down}</dd>
                          </div>
                          <div>
                            <dt>Bilinmiyor</dt>
                            <dd>{status.unknown}</dd>
                          </div>
                          <div>
                            <dt>Duraklatılmış</dt>
                            <dd>{status.paused}</dd>
                          </div>
                        </dl>
                        <div className="card-actions">
                          <button
                            className="ghost"
                            onClick={() => setEditingGroup(group.id)}
                            type="button"
                          >
                            Düzenle
                          </button>
                          {confirmDelete === `group:${group.id}` ? (
                            <>
                              <button
                                className="danger"
                                disabled={busyKey === `group:delete:${group.id}`}
                                onClick={() =>
                                  void perform(
                                    `group:delete:${group.id}`,
                                    () => monitoringApi.deleteGroup(session, group),
                                    'Grup silindi; bağlı kontroller grupsuz bırakıldı.',
                                  )
                                }
                                type="button"
                              >
                                Silmeyi onayla
                              </button>
                              <button
                                className="ghost"
                                onClick={() => setConfirmDelete(null)}
                                type="button"
                              >
                                Vazgeç
                              </button>
                            </>
                          ) : (
                            <button
                              className="danger-link"
                              onClick={() => setConfirmDelete(`group:${group.id}`)}
                              type="button"
                            >
                              Sil
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {groupCursor && (
              <button
                className="ghost load-more"
                disabled={loadingMore === 'groups'}
                onClick={() => void loadMoreGroups()}
                type="button"
              >
                {loadingMore === 'groups' ? 'Yükleniyor…' : 'Daha fazla grup yükle'}
              </button>
            )}
          </section>

          <section className="panel" aria-labelledby="checks-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">İzleme</p>
                <h2 id="checks-title">Kontroller</h2>
                <p>Hedefleri yönetin ve gerektiğinde manuel bir çalışma talep edin.</p>
              </div>
              <div className="heading-actions">
                <span className="count-pill">{checks.length} kontrol</span>
                <button
                  className="primary compact"
                  onClick={() => setShowCheckForm((value) => !value)}
                  type="button"
                >
                  {showCheckForm ? 'Formu kapat' : 'Kontrol ekle'}
                </button>
              </div>
            </div>

            {showCheckForm && (
              <div className="create-box expanded">
                <h3>Yeni kontrol</h3>
                <CheckForm
                  busy={busyKey === 'check:create'}
                  groups={groups}
                  onCancel={() => setShowCheckForm(false)}
                  onSubmit={async (input) => {
                    const saved = await perform(
                      'check:create',
                      () => monitoringApi.createCheck(session, input),
                      'Kontrol oluşturuldu.',
                    );
                    if (saved) setShowCheckForm(false);
                    return saved;
                  }}
                />
              </div>
            )}

            {checks.length === 0 ? (
              <div className="empty-state">
                <h3>Henüz kontrol yok</h3>
                <p>İlk URL'nizi ekleyerek kullanılabilirlik yapılandırmasını başlatın.</p>
              </div>
            ) : (
              <ul className="resource-grid check-grid">
                {checks.map(({ check, status }) => (
                  <li className="resource-card check-card" id={`check-${check.id}`} key={check.id}>
                    {editingCheck === check.id ? (
                      <CheckForm
                        busy={busyKey === `check:update:${check.id}`}
                        groups={groups}
                        initial={check}
                        onCancel={() => setEditingCheck(null)}
                        onSubmit={(input) =>
                          perform(
                            `check:update:${check.id}`,
                            () => monitoringApi.updateCheck(session, check, input),
                            'Kontrol güncellendi.',
                          )
                        }
                      />
                    ) : (
                      <>
                        <div className="card-heading">
                          <div>
                            <h3>{check.name}</h3>
                            <a
                              className="target-url"
                              href={check.url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {check.url}
                            </a>
                          </div>
                          <div className="status-stack">
                            <StatusBadge state={status.health_state} />
                            <StatusBadge state={status.freshness_state} />
                            <StatusBadge state={check.execution_state} />
                            {status.maintenance.active && (
                              <span className="maintenance-badge">Bakımda</span>
                            )}
                          </div>
                        </div>
                        <dl className="check-details">
                          <div>
                            <dt>Son kontrol</dt>
                            <dd>{formatInstant(status.last_checked_at)}</dd>
                          </div>
                          <div>
                            <dt>Yanıt süresi</dt>
                            <dd>
                              {status.last_response_time_ms === null
                                ? '—'
                                : `${status.last_response_time_ms} ms`}
                            </dd>
                          </div>
                          <div>
                            <dt>Aralık / timeout</dt>
                            <dd>
                              {check.interval_seconds} sn / {check.timeout_ms} ms
                            </dd>
                          </div>
                          <div>
                            <dt>Beklenen kod</dt>
                            <dd>{check.expected_status_code}</dd>
                          </div>
                          <div>
                            <dt>Mevcut kesinti</dt>
                            <dd
                              className={status.current_incident ? 'incident-duration' : undefined}
                            >
                              {status.current_incident
                                ? formatDuration(
                                    now - Date.parse(status.current_incident.started_at),
                                  )
                                : 'Yok'}
                            </dd>
                          </div>
                          <div>
                            <dt>Bakım bitişi</dt>
                            <dd>
                              {status.maintenance.active
                                ? formatInstant(status.maintenance.until)
                                : 'Bakımda değil'}
                            </dd>
                          </div>
                        </dl>
                        <div className="card-actions check-actions">
                          <button
                            className="primary compact"
                            disabled={busyKey === `check:manual:${check.id}`}
                            onClick={() =>
                              void perform(
                                `check:manual:${check.id}`,
                                async () => {
                                  const receipt = await monitoringApi.requestManualRun(
                                    session,
                                    check,
                                  );
                                  setNotice(
                                    receipt.disposition === 'ENQUEUED'
                                      ? 'Manuel kontrol kuyruğa alındı.'
                                      : 'Manuel kontrol mevcut çalışmanın arkasına birleştirildi.',
                                  );
                                },
                                '',
                              )
                            }
                            type="button"
                          >
                            Şimdi çalıştır
                          </button>
                          <button
                            className="ghost"
                            disabled={busyKey === `check:state:${check.id}`}
                            onClick={() =>
                              void perform(
                                `check:state:${check.id}`,
                                () =>
                                  check.execution_state === 'ACTIVE'
                                    ? monitoringApi.pauseCheck(session, check)
                                    : monitoringApi.resumeCheck(session, check),
                                check.execution_state === 'ACTIVE'
                                  ? 'Kontrol duraklatıldı.'
                                  : 'Kontrol devam ettirildi.',
                              )
                            }
                            type="button"
                          >
                            {check.execution_state === 'ACTIVE' ? 'Duraklat' : 'Devam ettir'}
                          </button>
                          <button
                            className="ghost"
                            onClick={() => setEditingCheck(check.id)}
                            type="button"
                          >
                            Düzenle
                          </button>
                          {confirmDelete === `check:${check.id}` ? (
                            <>
                              <button
                                className="danger"
                                disabled={busyKey === `check:delete:${check.id}`}
                                onClick={() =>
                                  void perform(
                                    `check:delete:${check.id}`,
                                    () => monitoringApi.deleteCheck(session, check),
                                    'Kontrol silindi.',
                                  )
                                }
                                type="button"
                              >
                                Silmeyi onayla
                              </button>
                              <button
                                className="ghost"
                                onClick={() => setConfirmDelete(null)}
                                type="button"
                              >
                                Vazgeç
                              </button>
                            </>
                          ) : (
                            <button
                              className="danger-link"
                              onClick={() => setConfirmDelete(`check:${check.id}`)}
                              type="button"
                            >
                              Sil
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {checkCursor && (
              <button
                className="ghost load-more"
                disabled={loadingMore === 'checks'}
                onClick={() => void loadMoreChecks()}
                type="button"
              >
                {loadingMore === 'checks' ? 'Yükleniyor…' : 'Daha fazla kontrol yükle'}
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
