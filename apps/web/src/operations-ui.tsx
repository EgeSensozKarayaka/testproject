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
  if (!value) return 'Ongoing';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function duration(value: string): string {
  const minutes = Math.max(0, Math.round(Number(value) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d`;
}

function percentage(value: number | null): string {
  return value === null ? 'No data' : `${(value * 100).toFixed(value > 0.99 ? 2 : 1)}%`;
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
    return <p className="empty-inline">No response time measured for this period.</p>;
  }

  return (
    <div
      className="history-chart"
      role="img"
      aria-label={`Response time chart, peak ${max} ms`}
    >
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2={width} y1={height - 10} y2={height - 10} />
        <polyline points={points} />
      </svg>
      <span>0 ms</span>
      <strong>{max} ms peak</strong>
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
      setError(cause instanceof Error ? cause.message : 'Failed to load operations data.');
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
        setError(cause instanceof Error ? cause.message : 'Failed to load history.');
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
      setError(cause instanceof Error ? cause.message : 'Operation could not be completed.');
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
      'Maintenance window created.',
    );
  }

  async function createRecipient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await command(
      'recipient:create',
      () => monitoringApi.createNotificationRecipient(session, text(form, 'email')),
      'Address added; verification email sent via Mailpit.',
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
      'Default notification policy updated.',
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
      setNotice('Public status page published. Copy the link now.');
      formElement.reset();
      await loadOperations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to publish public page.');
    } finally {
      setBusy('');
    }
  }

  const activeMaintenance = useMemo(
    () => maintenance.filter((window) => window.state === 'ACTIVE' || window.state === 'UPCOMING'),
    [maintenance],
  );

  return (
    <section className="operations-stack" aria-label="Operations center">
      {(error || notice) && (
        <div className={`message ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>
          {error || notice}
        </div>
      )}
      {loading && <p role="status">Loading operations data…</p>}

      <section className="panel" aria-labelledby="history-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">History & incidents</p>
            <h2 id="history-title">Performance history</h2>
          </div>
          <div className="inline-controls">
            <label>
              Check
              <select
                value={activeCheckId}
                onChange={(event) => setSelectedCheckId(event.target.value)}
              >
                {checks.length === 0 && <option value="">No checks</option>}
                {checks.map(({ check }) => (
                  <option key={check.id} value={check.id}>
                    {check.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Period
              <select
                value={period}
                onChange={(event) => setPeriod(event.target.value as typeof period)}
              >
                <option value="day">24 hours</option>
                <option value="week">7 days</option>
                <option value="month">30 days</option>
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
                <dt>Coverage</dt>
                <dd>{percentage(history.coverage_ratio)}</dd>
              </div>
              <div>
                <dt>Resolution</dt>
                <dd>{history.resolution === 'minute' ? 'Minute' : 'Hour'}</dd>
              </div>
              <div>
                <dt>Data through</dt>
                <dd>{instant(history.data_through)}</dd>
              </div>
            </dl>
            <HistoryChart history={history} />
          </>
        ) : (
          <p className="empty-inline">History will be displayed here once a check is selected.</p>
        )}

        <h3 className="subsection-title">Incident log</h3>
        {incidents.length === 0 ? (
          <p className="empty-inline">No confirmed incidents yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Ended</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((incident) => (
                  <tr key={incident.id}>
                    <td>{incident.check_name}</td>
                    <td>
                      <span className={`status-badge status-${incident.status.toLowerCase()}`}>
                        {incident.status === 'OPEN' ? 'Open' : 'Closed'}
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
            <p className="eyebrow">Scheduled maintenance</p>
            <h2 id="maintenance-title">Maintenance windows</h2>
          </div>
          <span className="count-pill">{activeMaintenance.length} open</span>
        </div>
        <form
          className="resource-form maintenance-form"
          onSubmit={(event) => void createMaintenance(event)}
        >
          <label>
            Target
            <select name="target" required defaultValue="">
              <option value="" disabled>
                Select check or group
              </option>
              {checks.map(({ check }) => (
                <option key={check.id} value={`CHECK:${check.id}`}>
                  Check · {check.name}
                </option>
              ))}
              {groups.map(({ group }) => (
                <option key={group.id} value={`GROUP:${group.id}`}>
                  Group · {group.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Starts at
            <input name="starts_at" type="datetime-local" required />
          </label>
          <label>
            Ends at
            <input name="ends_at" type="datetime-local" required />
          </label>
          <label>
            Note
            <input name="note" maxLength={1000} placeholder="Scheduled maintenance" />
          </label>
          <div className="form-actions">
            <button
              className="primary compact"
              disabled={busy === 'maintenance:create'}
              type="submit"
            >
              Schedule maintenance
            </button>
          </div>
        </form>
        {maintenance.length === 0 ? (
          <p className="empty-inline">No maintenance windows.</p>
        ) : (
          <ul className="compact-list">
            {maintenance.map((window) => (
              <li key={window.id}>
                <div>
                  <strong>{window.target_type === 'CHECK' ? 'Check' : 'Group'} maintenance</strong>
                  <span>
                    {instant(window.starts_at)} – {instant(window.ends_at)} ·{' '}
                    {window.note || 'No note'}
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
                          'Maintenance window cancelled.',
                        )
                      }
                      type="button"
                    >
                      Cancel
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
            <p className="eyebrow">Email</p>
            <h2 id="notifications-title">Notification settings</h2>
          </div>
          <span className="count-pill">{recipients.length} {recipients.length === 1 ? 'address' : 'addresses'}</span>
        </div>
        <form className="inline-form" onSubmit={(event) => void createRecipient(event)}>
          <label>
            Email address
            <input name="email" type="email" required maxLength={254} />
          </label>
          <button className="primary compact" disabled={busy === 'recipient:create'} type="submit">
            Add address
          </button>
        </form>
        {recipients.length === 0 ? (
          <p className="empty-inline">No notification addresses added.</p>
        ) : (
          <ul className="compact-list">
            {recipients.map((recipient) => (
              <li key={recipient.id}>
                <div>
                  <strong>{recipient.email}</strong>
                  <span>
                    {recipient.verification_state === 'VERIFIED'
                      ? 'Verified'
                      : recipient.verification_state === 'PENDING'
                        ? 'Pending verification'
                        : 'Disabled'}
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
                          'Verification email resent.',
                        )
                      }
                      type="button"
                    >
                      Resend verification
                    </button>
                  )}
                  {recipient.verification_state === 'VERIFIED' && (
                    <button
                      className="ghost compact"
                      onClick={() =>
                        void command(
                          `recipient:test:${recipient.id}`,
                          () => monitoringApi.sendNotificationTest(session, recipient),
                          'Test email sent.',
                        )
                      }
                      type="button"
                    >
                      Test email
                    </button>
                  )}
                  {recipient.verification_state !== 'DISABLED' && (
                    <button
                      className="danger compact"
                      onClick={() =>
                        void command(
                          `recipient:delete:${recipient.id}`,
                          () => monitoringApi.deleteNotificationRecipient(session, recipient),
                          'Notification address disabled.',
                        )
                      }
                      type="button"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {policy && (
          <form className="policy-form" onSubmit={(event) => void updatePolicy(event)}>
            <h3>Default policy</h3>
            <label>
              Mode
              <select name="mode" defaultValue={policy.mode}>
                <option value="ACTIVE">Active</option>
                <option value="DISABLED">Disabled</option>
              </select>
            </label>
            <label className="check-option">
              <input
                name="notify_down"
                type="checkbox"
                defaultChecked={policy.notify_down === true}
              />{' '}
              Down notification
            </label>
            <label className="check-option">
              <input
                name="notify_recovery"
                type="checkbox"
                defaultChecked={policy.notify_recovery === true}
              />{' '}
              Recovery email
            </label>
            <fieldset>
              <legend>Recipients</legend>
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
              Save policy
            </button>
          </form>
        )}
      </section>

      <section className="panel" aria-labelledby="public-page-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">No login required</p>
            <h2 id="public-page-title">Public status page</h2>
            <p>Only selected published fields are shown; URLs are hidden by default.</p>
          </div>
          <span className="count-pill">{publicPages.length} {publicPages.length === 1 ? 'page' : 'pages'}</span>
        </div>
        <form
          className="inline-form public-page-form"
          onSubmit={(event) => void createPublicPage(event)}
        >
          <label>
            Page title
            <input name="title" required maxLength={160} placeholder="Service status" />
          </label>
          <label>
            Page description
            <input
              name="description"
              maxLength={2000}
              placeholder="Current service health information"
            />
          </label>
          <button
            className="primary compact"
            disabled={busy === 'public:create' || checks.length === 0}
            type="submit"
          >
            Publish with all checks
          </button>
        </form>
        {checks.length === 0 && (
          <p className="empty-inline">Add a check before publishing a public page.</p>
        )}
        {lastPublicUrl && (
          <div className="public-link-result" role="group" aria-label="Public status link">
            <strong>One-time displayed link</strong>
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
                    {page.components.length} {page.components.length === 1 ? 'component' : 'components'} ·{' '}
                    {page.state === 'PUBLISHED'
                      ? 'Published'
                      : page.state === 'DISABLED'
                        ? 'Disabled'
                        : 'Draft'}
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
                            'Link rotated; the previous link is now invalid.',
                          )
                        }
                        type="button"
                      >
                        Rotate link
                      </button>
                      <button
                        className="danger compact"
                        onClick={() =>
                          void command(
                            `public:disable:${page.id}`,
                            () => monitoringApi.disablePublicPage(session, page),
                            'Public page disabled.',
                          )
                        }
                        type="button"
                      >
                        Disable page
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
                          'Public page republished.',
                        )
                      }
                      type="button"
                    >
                      Publish
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
    ACTIVE: 'Active',
    CANCELLED: 'Cancelled',
    ENDED: 'Ended',
    UPCOMING: 'Upcoming',
  };
  return (
    <span className={`status-badge status-${state.toLowerCase()}`}>{labels[state] ?? state}</span>
  );
}
