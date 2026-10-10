export interface paths {
  '/health/live': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getLiveness'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/health/ready': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getReadiness'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/register': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Creates a pending account and queues a verification email. The same 202 response is returned when the address is already registered. Requires an exact trusted Origin (or same-origin Referer fallback), Fetch Metadata validation, and application/json. */
    post: operations['register'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/login': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Creates an opaque server-side session. Unknown accounts, invalid passwords, pending verification, and disabled accounts all return the same invalid_credentials response. */
    post: operations['login'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/logout': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Idempotently clears the browser cookie. A valid presented session is revoked after CSRF validation; an absent or invalid session still returns 204. */
    post: operations['logout'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/session': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getSession'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/email-verifications': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Queues a verification email when eligible and always returns the same accepted response. The endpoint applies anonymous origin, media-type, idempotency, and rate-limit controls. */
    post: operations['requestEmailVerification'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/email-verifications/confirm': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Consumes a single-use verification token. Invalid, expired, or already-consumed tokens return invalid_or_expired_token without revealing token state. */
    post: operations['confirmEmailVerification'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/password-resets': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Queues a reset email when eligible and always returns the same accepted response. The endpoint applies anonymous origin, media-type, idempotency, and rate-limit controls. */
    post: operations['requestPasswordReset'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/password-resets/confirm': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Consumes a single-use reset token, changes the password, and revokes every session. An invalid, expired, or consumed token returns invalid_or_expired_token. */
    post: operations['confirmPasswordReset'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/me': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getMe'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** @description Requires a valid session, matching session-bound CSRF token, and current strong ETag. */
    patch: operations['updateMe'];
    trace?: never;
  };
  '/api/v1/dashboard': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getDashboard'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/checks': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['listChecks'];
    put?: never;
    post: operations['createCheck'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/checks/{check_id}': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        check_id: components['parameters']['CheckId'];
      };
      cookie?: never;
    };
    get: operations['getCheck'];
    put?: never;
    post?: never;
    delete: operations['deleteCheck'];
    options?: never;
    head?: never;
    patch: operations['updateCheck'];
    trace?: never;
  };
  '/api/v1/checks/{check_id}/pause': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['pauseCheck'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/checks/{check_id}/resume': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['resumeCheck'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/checks/{check_id}/runs': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        check_id: components['parameters']['CheckId'];
      };
      cookie?: never;
    };
    get: operations['listCheckRuns'];
    put?: never;
    post: operations['requestManualRun'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/checks/{check_id}/history': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getCheckHistory'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/checks/{check_id}/prediction': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getCheckPrediction'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/groups': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['listGroups'];
    put?: never;
    post: operations['createGroup'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/groups/{group_id}': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        group_id: components['parameters']['GroupId'];
      };
      cookie?: never;
    };
    get: operations['getGroup'];
    put?: never;
    post?: never;
    delete: operations['deleteGroup'];
    options?: never;
    head?: never;
    patch: operations['updateGroup'];
    trace?: never;
  };
  '/api/v1/incidents': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['listIncidents'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/incidents/{incident_id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getIncident'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/maintenance-windows': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['listMaintenanceWindows'];
    put?: never;
    post: operations['createMaintenanceWindow'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/maintenance-windows/{window_id}': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        window_id: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    get: operations['getMaintenanceWindow'];
    put?: never;
    post?: never;
    delete: operations['cancelMaintenanceWindow'];
    options?: never;
    head?: never;
    patch: operations['updateMaintenanceWindow'];
    trace?: never;
  };
  '/api/v1/notification-recipients': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['listNotificationRecipients'];
    put?: never;
    post: operations['createNotificationRecipient'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/notification-recipients/{recipient_id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete: operations['deleteNotificationRecipient'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/notification-recipients/{recipient_id}/verification': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['resendNotificationRecipientVerification'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/notification-recipients/{recipient_id}/test-email': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['sendNotificationRecipientTestEmail'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/notification-recipient-verifications/confirm': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['confirmNotificationRecipientVerification'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/notification-policies/default': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getDefaultNotificationPolicy'];
    put: operations['replaceDefaultNotificationPolicy'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/groups/{group_id}/notification-policy': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        group_id: components['parameters']['GroupId'];
      };
      cookie?: never;
    };
    get: operations['getGroupNotificationPolicy'];
    put: operations['replaceGroupNotificationPolicy'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/public-pages': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['listPublicPages'];
    put?: never;
    post: operations['createPublicPage'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/public-pages/{page_id}': {
    parameters: {
      query?: never;
      header?: never;
      path: {
        page_id: components['parameters']['PageId'];
      };
      cookie?: never;
    };
    get: operations['getPublicPage'];
    put?: never;
    post?: never;
    delete: operations['deletePublicPage'];
    options?: never;
    head?: never;
    patch: operations['updatePublicPage'];
    trace?: never;
  };
  '/api/v1/public-pages/{page_id}/components': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put: operations['replacePublicPageComponents'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/public-pages/{page_id}/publish': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['publishPublicPage'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/public-pages/{page_id}/disable': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['disablePublicPage'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/public-pages/{page_id}/rotate-link': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['rotatePublicPageLink'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/events': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['streamPrivateEvents'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/public/v1/status-pages/{public_token}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getPublicStatusPage'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/public/v1/status-pages/{public_token}/events': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['streamPublicStatusPageEvents'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    /** Format: uuid */
    Uuid: string;
    /** Format: date-time */
    Instant: string;
    ResourceVersion: string;
    NonNegativeIntegerString: string;
    ServiceHealth: {
      service: string;
      /** @enum {string} */
      status: 'ok' | 'unavailable';
      /** Format: date-time */
      timestamp: string;
      version: string;
    };
    AcceptedResponse: {
      /** @constant */
      accepted: true;
    };
    ValidationIssue: {
      pointer: string;
      code: string;
      message: string;
    };
    Problem: {
      /** Format: uri */
      type: string;
      title: string;
      status: number;
      detail: string;
      instance: string;
      code: string;
      /** Format: uuid */
      request_id: string;
      retryable: boolean;
      retry_after_seconds?: number;
      errors?: components['schemas']['ValidationIssue'][];
    };
    PageMeta: {
      next_cursor: string | null;
      has_more: boolean;
    };
    RegisterRequest: {
      /** Format: email */
      email: string;
      password: string;
      display_name: string;
    };
    LoginRequest: {
      /** Format: email */
      email: string;
      password: string;
    };
    EmailRequest: {
      /** Format: email */
      email: string;
    };
    TokenRequest: {
      token: string;
    };
    PasswordResetConfirmRequest: {
      token: string;
      password: string;
    };
    User: {
      id: components['schemas']['Uuid'];
      /** Format: email */
      email: string;
      display_name: string;
      email_verified: boolean;
      resource_version: components['schemas']['ResourceVersion'];
      created_at: components['schemas']['Instant'];
    };
    UserPatch: {
      display_name?: string;
    };
    SessionView: {
      user: components['schemas']['User'];
      expires_at: components['schemas']['Instant'];
      /** @description Session-bound bootstrap value; never logged or persisted by the client */
      csrf_token: string;
    };
    /** @enum {string} */
    ExecutionState: 'ACTIVE' | 'PAUSED';
    /** @enum {string} */
    HealthState: 'UNKNOWN' | 'UP' | 'SUSPECT' | 'DOWN';
    /** @enum {string} */
    FreshnessState: 'FRESH' | 'STALE';
    CurrentIncidentSummary: {
      id: components['schemas']['Uuid'];
      started_at: components['schemas']['Instant'];
      confirmed_at: components['schemas']['Instant'];
      /** @enum {string} */
      observation_mode: 'OBSERVED' | 'UNOBSERVED';
      observed_duration_ms: components['schemas']['NonNegativeIntegerString'];
    };
    CurrentStatus: {
      check_id: components['schemas']['Uuid'];
      health_state: components['schemas']['HealthState'];
      execution_state: components['schemas']['ExecutionState'];
      freshness_state: components['schemas']['FreshnessState'];
      maintenance: {
        active: boolean;
        until: components['schemas']['Instant'] | null;
      };
      last_response_time_ms: number | null;
      last_checked_at: components['schemas']['Instant'] | null;
      current_incident: components['schemas']['CurrentIncidentSummary'] | null;
      state_version: components['schemas']['ResourceVersion'];
    };
    CheckWriteFields: {
      name?: string;
      /**
       * Format: uri
       * @description Absolute HTTP(S) URL. Credentials are forbidden. The fragment is removed during canonicalization and the canonical UTF-8 serialization must not exceed 4096 bytes.
       */
      url?: string;
      interval_seconds?: number;
      timeout_ms?: number;
      expected_status_code?: number;
      /** @description Case-sensitive literal substring. In addition to this character bound, the API enforces a 2048-byte UTF-8 limit. Null disables body matching. */
      expected_body_substring?: string | null;
      group_id?: components['schemas']['Uuid'] | null;
    };
    CheckCreate: components['schemas']['CheckWriteFields'] & Record<string, never>;
    CheckPatch: components['schemas']['CheckWriteFields'] & Record<string, never>;
    Check: {
      id: components['schemas']['Uuid'];
      name: string;
      /** Format: uri */
      url: string;
      interval_seconds: number;
      timeout_ms: number;
      expected_status_code: number;
      expected_body_substring: string | null;
      group_id: components['schemas']['Uuid'] | null;
      execution_state: components['schemas']['ExecutionState'];
      resource_version: components['schemas']['ResourceVersion'];
      probe_generation: components['schemas']['ResourceVersion'];
      schedule_generation: components['schemas']['ResourceVersion'];
      created_at: components['schemas']['Instant'];
      updated_at: components['schemas']['Instant'];
    };
    CheckListItem: {
      check: components['schemas']['Check'];
      status: components['schemas']['CurrentStatus'];
    };
    CheckPage: {
      data: components['schemas']['CheckListItem'][];
      page: components['schemas']['PageMeta'];
    };
    GroupStatus: {
      health_state: components['schemas']['HealthState'];
      up: number;
      suspect: number;
      down: number;
      unknown: number;
      paused: number;
    };
    GroupWrite: {
      name: string;
      description?: string | null;
    };
    GroupPatch: {
      name?: string;
      description?: string | null;
    };
    Group: {
      id: components['schemas']['Uuid'];
      name: string;
      description: string | null;
      resource_version: components['schemas']['ResourceVersion'];
      created_at: components['schemas']['Instant'];
      updated_at: components['schemas']['Instant'];
    };
    GroupListItem: {
      group: components['schemas']['Group'];
      status: components['schemas']['GroupStatus'];
    };
    GroupPage: {
      data: components['schemas']['GroupListItem'][];
      page: components['schemas']['PageMeta'];
    };
    DashboardPage: {
      generated_at: components['schemas']['Instant'];
      checks: components['schemas']['CheckListItem'][];
      groups: components['schemas']['GroupListItem'][];
      page: components['schemas']['PageMeta'];
    };
    ManualRunReceipt: {
      request_id: components['schemas']['Uuid'];
      check_id: components['schemas']['Uuid'];
      /** @enum {string} */
      disposition: 'ENQUEUED' | 'COALESCED';
      /** @enum {string} */
      mode: 'STATEFUL' | 'DIAGNOSTIC';
      requested_at: components['schemas']['Instant'];
    };
    CheckRun: {
      id: components['schemas']['Uuid'];
      /** @enum {string} */
      trigger_kind: 'SCHEDULED' | 'MANUAL';
      /** @enum {string|null} */
      manual_mode: 'STATEFUL' | 'DIAGNOSTIC' | null;
      started_at: components['schemas']['Instant'];
      finished_at: components['schemas']['Instant'];
      /** @enum {string} */
      outcome: 'PASS' | 'FAIL';
      accepted: boolean;
      rejection_reason: string | null;
      response_time_ms: number | null;
      status_code: number | null;
      failure_category: string | null;
    };
    CheckRunPage: {
      data: components['schemas']['CheckRun'][];
      page: components['schemas']['PageMeta'];
    };
    HistoryBucket: {
      from: components['schemas']['Instant'];
      to: components['schemas']['Instant'];
      response_time_ms: number | null;
      availability_ratio: number | null;
      coverage_ratio: number;
      /** @enum {string} */
      classification: 'UP' | 'DOWN' | 'UNKNOWN' | 'PROVISIONAL' | 'MIXED';
      sample_count: number;
    };
    HistoryResponse: {
      check_id: components['schemas']['Uuid'];
      /** @enum {string} */
      period: 'day' | 'week' | 'month';
      from: components['schemas']['Instant'];
      to: components['schemas']['Instant'];
      /** @enum {string} */
      resolution: 'minute' | 'hour';
      availability_ratio: number | null;
      coverage_ratio: number;
      observed_up_ms: components['schemas']['NonNegativeIntegerString'];
      observed_down_ms: components['schemas']['NonNegativeIntegerString'];
      unknown_ms: components['schemas']['NonNegativeIntegerString'];
      buckets: components['schemas']['HistoryBucket'][];
    };
    PredictionModel: {
      name: string;
      version: string;
    };
    PredictionResponse: {
      check_id: components['schemas']['Uuid'];
      /** @enum {string} */
      status: 'AVAILABLE' | 'UNAVAILABLE' | 'STALE' | 'INSUFFICIENT_DATA';
      risk_score: number | null;
      /** @enum {string|null} */
      risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | null;
      valid_until: components['schemas']['Instant'] | null;
      computed_at: components['schemas']['Instant'] | null;
      horizon_seconds: number | null;
      model: components['schemas']['PredictionModel'] | null;
      reason_codes: string[];
    };
    /** @enum {string} */
    IncidentState: 'OPEN' | 'CLOSED';
    /** @enum {string} */
    ObservationMode: 'OBSERVED' | 'UNOBSERVED';
    Incident: {
      id: components['schemas']['Uuid'];
      check_id: components['schemas']['Uuid'];
      status: components['schemas']['IncidentState'];
      observation_mode: components['schemas']['ObservationMode'];
      started_at: components['schemas']['Instant'];
      confirmed_at: components['schemas']['Instant'];
      ended_at: components['schemas']['Instant'] | null;
      /** @enum {string|null} */
      closure_reason: 'RECOVERED' | 'CONFIG_CHANGED' | 'CHECK_DELETED' | 'ADMINISTRATIVE' | null;
      observed_duration_ms: components['schemas']['NonNegativeIntegerString'] | null;
      wall_duration_ms: components['schemas']['NonNegativeIntegerString'] | null;
    };
    IncidentSegment: {
      starts_at: components['schemas']['Instant'];
      ends_at: components['schemas']['Instant'] | null;
      /** @enum {string} */
      kind: 'OBSERVED_DOWN' | 'UNOBSERVED';
    };
    IncidentDetail: {
      id: components['schemas']['Uuid'];
      check_id: components['schemas']['Uuid'];
      status: components['schemas']['IncidentState'];
      observation_mode: components['schemas']['ObservationMode'];
      started_at: components['schemas']['Instant'];
      confirmed_at: components['schemas']['Instant'];
      ended_at: components['schemas']['Instant'] | null;
      /** @enum {string|null} */
      closure_reason: 'RECOVERED' | 'CONFIG_CHANGED' | 'CHECK_DELETED' | 'ADMINISTRATIVE' | null;
      observed_duration_ms: components['schemas']['NonNegativeIntegerString'] | null;
      wall_duration_ms: components['schemas']['NonNegativeIntegerString'] | null;
      segments: components['schemas']['IncidentSegment'][];
    };
    IncidentPage: {
      data: components['schemas']['Incident'][];
      page: components['schemas']['PageMeta'];
    };
    /** @enum {string} */
    MaintenanceState: 'UPCOMING' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
    MaintenanceWindowWrite: {
      /** @enum {string} */
      target_type: 'CHECK' | 'GROUP';
      target_id: components['schemas']['Uuid'];
      starts_at: components['schemas']['Instant'];
      ends_at: components['schemas']['Instant'];
      note?: string | null;
    };
    /** @description The target is immutable; cancel and recreate to change target. */
    MaintenanceWindowPatch: {
      starts_at?: components['schemas']['Instant'];
      ends_at?: components['schemas']['Instant'];
      note?: string | null;
    };
    MaintenanceWindow: {
      id: components['schemas']['Uuid'];
      /** @enum {string} */
      target_type: 'CHECK' | 'GROUP';
      target_id: components['schemas']['Uuid'];
      starts_at: components['schemas']['Instant'];
      ends_at: components['schemas']['Instant'];
      note: string | null;
      state: components['schemas']['MaintenanceState'];
      resource_version: components['schemas']['ResourceVersion'];
      created_at: components['schemas']['Instant'];
      updated_at: components['schemas']['Instant'];
    };
    MaintenanceWindowPage: {
      data: components['schemas']['MaintenanceWindow'][];
      page: components['schemas']['PageMeta'];
    };
    NotificationRecipient: {
      id: components['schemas']['Uuid'];
      /** Format: email */
      email: string;
      /** @enum {string} */
      verification_state: 'PENDING' | 'VERIFIED' | 'DISABLED';
      resource_version: components['schemas']['ResourceVersion'];
      created_at: components['schemas']['Instant'];
    };
    NotificationRecipientPage: {
      data: components['schemas']['NotificationRecipient'][];
      page: components['schemas']['PageMeta'];
    };
    NotificationPolicyWrite: {
      /** @enum {string} */
      mode: 'INHERIT' | 'ACTIVE' | 'DISABLED';
      notify_down: boolean | null;
      notify_recovery: boolean | null;
      recipient_ids: components['schemas']['Uuid'][];
    } & unknown;
    DefaultNotificationPolicyWrite: {
      /** @enum {string} */
      mode: 'ACTIVE' | 'DISABLED';
      notify_down: boolean | null;
      notify_recovery: boolean | null;
      recipient_ids: components['schemas']['Uuid'][];
    } & unknown;
    NotificationPolicy: {
      id: components['schemas']['Uuid'];
      /** @enum {string} */
      scope_type: 'DEFAULT' | 'GROUP';
      scope_id: components['schemas']['Uuid'] | null;
      /** @enum {string} */
      mode: 'INHERIT' | 'ACTIVE' | 'DISABLED';
      notify_down: boolean | null;
      notify_recovery: boolean | null;
      recipient_ids: components['schemas']['Uuid'][];
      effective_recipient_ids: components['schemas']['Uuid'][];
      effective_policy_id: components['schemas']['Uuid'];
      /** @enum {string} */
      effective_mode: 'ACTIVE' | 'DISABLED';
      effective_notify_down: boolean | null;
      effective_notify_recovery: boolean | null;
      effective_policy_version: components['schemas']['ResourceVersion'];
      resource_version: components['schemas']['ResourceVersion'];
    };
    /** @enum {string} */
    PublicPageState: 'DRAFT' | 'PUBLISHED' | 'DISABLED';
    PublicPageWrite: {
      title: string;
      description?: string | null;
    };
    PublicPagePatch: {
      title?: string;
      description?: string | null;
    };
    PublicComponentWrite: {
      /** @enum {string} */
      kind: 'CHECK' | 'GROUP';
      source_id: components['schemas']['Uuid'];
      display_name: string | null;
      position: number;
      show_url: boolean;
      show_response_time: boolean;
      show_incident_history: boolean;
    };
    PublicComponent: {
      id: components['schemas']['Uuid'];
      /** @enum {string} */
      kind: 'CHECK' | 'GROUP';
      source_id: components['schemas']['Uuid'];
      display_name: string | null;
      position: number;
      show_url: boolean;
      show_response_time: boolean;
      show_incident_history: boolean;
    };
    PublicPage: {
      id: components['schemas']['Uuid'];
      title: string;
      description: string | null;
      state: components['schemas']['PublicPageState'];
      components: components['schemas']['PublicComponent'][];
      resource_version: components['schemas']['ResourceVersion'];
      page_revision: components['schemas']['ResourceVersion'] | null;
      created_at: components['schemas']['Instant'];
      updated_at: components['schemas']['Instant'];
    };
    PublicPagePage: {
      data: components['schemas']['PublicPage'][];
      page: components['schemas']['PageMeta'];
    };
    PublicLinkResult: {
      page: components['schemas']['PublicPage'];
      /**
       * Format: uri
       * @description Contains the raw token and is returned only on publish/rotation
       */
      public_url: string;
    };
    PublicStatusComponent: {
      id: components['schemas']['Uuid'];
      /** @enum {string} */
      kind: 'CHECK' | 'GROUP';
      display_name: string;
      /**
       * Format: uri
       * @description Present only when this component explicitly allows URL publication.
       */
      url?: string;
      health_state: components['schemas']['HealthState'];
      maintenance_active: boolean;
      /** @description Omitted unless this component allows response-time publication; null means no observed sample. */
      last_response_time_ms?: number | null;
      last_checked_at: components['schemas']['Instant'] | null;
      /** @description Omitted unless this component explicitly allows incident-history publication. */
      incident_history?: {
        started_at: components['schemas']['Instant'];
        ended_at: components['schemas']['Instant'] | null;
        observed_duration_ms: components['schemas']['NonNegativeIntegerString'];
      }[];
    };
    PublicStatusSnapshot: {
      title: string;
      description: string | null;
      page_revision: components['schemas']['ResourceVersion'];
      generated_at: components['schemas']['Instant'];
      overall_health_state: components['schemas']['HealthState'];
      components: components['schemas']['PublicStatusComponent'][];
    };
  };
  responses: {
    /** @description Accepted without revealing account existence */
    Accepted: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['AcceptedResponse'];
      };
    };
    /** @description Current check after idempotent command */
    CheckCommandResult: {
      headers: {
        ETag: components['headers']['ETag'];
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Check'];
      };
    };
    /** @description Current private public-page configuration */
    PublicPageCommandResult: {
      headers: {
        ETag: components['headers']['ETag'];
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['PublicPage'];
      };
    };
    /** @description Invalid request or cursor */
    BadRequestProblem: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Authentication required or credentials invalid */
    AuthenticationProblem: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description CSRF or origin verification failed */
    CsrfProblem: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Resource absent, deleted, or owned by another user */
    NotFoundProblem: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Public page absent, disabled, or token invalid */
    PublicNotFoundProblem: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Domain, idempotency, or resource conflict */
    ConflictProblem: {
      headers: {
        /** @description Present for idempotency_in_progress */
        'Retry-After'?: number;
        [name: string]: unknown;
      };
      content: {
        'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description If-Match does not match current resource version */
    PreconditionFailed: {
      headers: {
        ETag: components['headers']['ETag'];
        [name: string]: unknown;
      };
      content: {
        'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Request validation or configuration failed */
    ValidationProblem: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description If-Match header is required */
    PreconditionRequired: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Rate limit exceeded */
    RateLimitProblem: {
      headers: {
        'Retry-After'?: number;
        [name: string]: unknown;
      };
      content: {
        'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Required dependency or schema is unavailable */
    ServiceUnavailable: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/problem+json': components['schemas']['Problem'];
      };
    };
  };
  parameters: {
    CsrfToken: string;
    IdempotencyKey: string;
    IfMatch: string;
    LastEventId: string;
    Cursor: string;
    Limit: number;
    CheckId: components['schemas']['Uuid'];
    GroupId: components['schemas']['Uuid'];
    PageId: components['schemas']['Uuid'];
    /** @description Opaque secret; must be redacted from logs and telemetry */
    PublicToken: string;
  };
  requestBodies: never;
  headers: {
    /** @description Strong resource or projection version tag */
    ETag: string;
    /** @description Canonical resource URI */
    Location: string;
    /** @description Request correlation identifier */
    RequestId: string;
  };
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  getLiveness: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Process is alive */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ServiceHealth'];
        };
      };
    };
  };
  getReadiness: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Service is ready */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ServiceHealth'];
        };
      };
      /** @description Service is not ready */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ServiceHealth'];
        };
      };
    };
  };
  register: {
    parameters: {
      query?: never;
      header: {
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RegisterRequest'];
      };
    };
    responses: {
      202: components['responses']['Accepted'];
      422: components['responses']['ValidationProblem'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  login: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['LoginRequest'];
      };
    };
    responses: {
      /** @description Authenticated; session cookie is set */
      200: {
        headers: {
          'Set-Cookie'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SessionView'];
        };
      };
      401: components['responses']['AuthenticationProblem'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  logout: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Session revoked or already absent */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      403: components['responses']['CsrfProblem'];
    };
  };
  getSession: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Current session and user */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SessionView'];
        };
      };
      401: components['responses']['AuthenticationProblem'];
    };
  };
  requestEmailVerification: {
    parameters: {
      query?: never;
      header: {
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['EmailRequest'];
      };
    };
    responses: {
      202: components['responses']['Accepted'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  confirmEmailVerification: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['TokenRequest'];
      };
    };
    responses: {
      /** @description Verification consumed or already confirmed */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      422: components['responses']['ValidationProblem'];
    };
  };
  requestPasswordReset: {
    parameters: {
      query?: never;
      header: {
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['EmailRequest'];
      };
    };
    responses: {
      202: components['responses']['Accepted'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  confirmPasswordReset: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PasswordResetConfirmRequest'];
      };
    };
    responses: {
      /** @description Password changed and previous sessions revoked */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      422: components['responses']['ValidationProblem'];
    };
  };
  getMe: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description User profile */
      200: {
        headers: {
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['User'];
        };
      };
      401: components['responses']['AuthenticationProblem'];
    };
  };
  updateMe: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['UserPatch'];
      };
    };
    responses: {
      /** @description Updated profile */
      200: {
        headers: {
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['User'];
        };
      };
      401: components['responses']['AuthenticationProblem'];
      403: components['responses']['CsrfProblem'];
      412: components['responses']['PreconditionFailed'];
      422: components['responses']['ValidationProblem'];
      428: components['responses']['PreconditionRequired'];
    };
  };
  getDashboard: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Owner-scoped current-state snapshot */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['DashboardPage'];
        };
      };
      400: components['responses']['BadRequestProblem'];
    };
  };
  listChecks: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
        group_id?: components['schemas']['Uuid'];
        health?: components['schemas']['HealthState'];
        execution_state?: components['schemas']['ExecutionState'];
        freshness?: components['schemas']['FreshnessState'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Check page */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CheckPage'];
        };
      };
      400: components['responses']['BadRequestProblem'];
    };
  };
  createCheck: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CheckCreate'];
      };
    };
    responses: {
      /** @description Check created */
      201: {
        headers: {
          Location: components['headers']['Location'];
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Check'];
        };
      };
      409: components['responses']['ConflictProblem'];
      422: components['responses']['ValidationProblem'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  getCheck: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        check_id: components['parameters']['CheckId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Check configuration; current status is a separate projection */
      200: {
        headers: {
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Check'];
        };
      };
      404: components['responses']['NotFoundProblem'];
    };
  };
  deleteCheck: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
      };
      path: {
        check_id: components['parameters']['CheckId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Check soft-deleted */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      404: components['responses']['NotFoundProblem'];
      412: components['responses']['PreconditionFailed'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  updateCheck: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
      };
      path: {
        check_id: components['parameters']['CheckId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CheckPatch'];
      };
    };
    responses: {
      /** @description Check updated */
      200: {
        headers: {
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Check'];
        };
      };
      404: components['responses']['NotFoundProblem'];
      412: components['responses']['PreconditionFailed'];
      422: components['responses']['ValidationProblem'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  pauseCheck: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
      };
      path: {
        check_id: components['parameters']['CheckId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: components['responses']['CheckCommandResult'];
      404: components['responses']['NotFoundProblem'];
      409: components['responses']['ConflictProblem'];
      412: components['responses']['PreconditionFailed'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  resumeCheck: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
      };
      path: {
        check_id: components['parameters']['CheckId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: components['responses']['CheckCommandResult'];
      404: components['responses']['NotFoundProblem'];
      409: components['responses']['ConflictProblem'];
      412: components['responses']['PreconditionFailed'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  listCheckRuns: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
      };
      header?: never;
      path: {
        check_id: components['parameters']['CheckId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Diagnostic run page */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CheckRunPage'];
        };
      };
      404: components['responses']['NotFoundProblem'];
    };
  };
  requestManualRun: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path: {
        check_id: components['parameters']['CheckId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Durable manual run request accepted or coalesced */
      202: {
        headers: {
          /** @description Manual command receipts are private and must not be cached */
          'Cache-Control'?: 'no-store';
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ManualRunReceipt'];
        };
      };
      404: components['responses']['NotFoundProblem'];
      409: components['responses']['ConflictProblem'];
      412: components['responses']['PreconditionFailed'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  getCheckHistory: {
    parameters: {
      query: {
        period: 'day' | 'week' | 'month';
      };
      header?: never;
      path: {
        check_id: components['parameters']['CheckId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Bounded history aggregate */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HistoryResponse'];
        };
      };
      404: components['responses']['NotFoundProblem'];
    };
  };
  getCheckPrediction: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        check_id: components['parameters']['CheckId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Optional prediction state; unavailable is not an HTTP error */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PredictionResponse'];
        };
      };
      404: components['responses']['NotFoundProblem'];
    };
  };
  listGroups: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Group page */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GroupPage'];
        };
      };
    };
  };
  createGroup: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['GroupWrite'];
      };
    };
    responses: {
      /** @description Group created */
      201: {
        headers: {
          Location: components['headers']['Location'];
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Group'];
        };
      };
      409: components['responses']['ConflictProblem'];
      422: components['responses']['ValidationProblem'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  getGroup: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        group_id: components['parameters']['GroupId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Group */
      200: {
        headers: {
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Group'];
        };
      };
      404: components['responses']['NotFoundProblem'];
    };
  };
  deleteGroup: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
      };
      path: {
        group_id: components['parameters']['GroupId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Group deleted; checks become ungrouped */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      404: components['responses']['NotFoundProblem'];
      412: components['responses']['PreconditionFailed'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  updateGroup: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
      };
      path: {
        group_id: components['parameters']['GroupId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['GroupPatch'];
      };
    };
    responses: {
      /** @description Group updated */
      200: {
        headers: {
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Group'];
        };
      };
      404: components['responses']['NotFoundProblem'];
      412: components['responses']['PreconditionFailed'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  listIncidents: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
        check_id?: components['schemas']['Uuid'];
        group_id?: components['schemas']['Uuid'];
        status?: components['schemas']['IncidentState'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Incident page */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['IncidentPage'];
        };
      };
    };
  };
  getIncident: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        incident_id: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Incident with observation segments */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['IncidentDetail'];
        };
      };
      404: components['responses']['NotFoundProblem'];
    };
  };
  listMaintenanceWindows: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
        state?: components['schemas']['MaintenanceState'];
        check_id?: components['schemas']['Uuid'];
        group_id?: components['schemas']['Uuid'];
        /** @description Return windows that start before this exclusive UTC boundary. */
        starts_before?: components['schemas']['Instant'];
        /** @description Return windows that end after this exclusive UTC boundary. */
        ends_after?: components['schemas']['Instant'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Maintenance window page */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MaintenanceWindowPage'];
        };
      };
    };
  };
  createMaintenanceWindow: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['MaintenanceWindowWrite'];
      };
    };
    responses: {
      /** @description Maintenance window created */
      201: {
        headers: {
          Location: components['headers']['Location'];
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MaintenanceWindow'];
        };
      };
      404: components['responses']['NotFoundProblem'];
      409: components['responses']['ConflictProblem'];
      422: components['responses']['ValidationProblem'];
    };
  };
  getMaintenanceWindow: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        window_id: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Maintenance window */
      200: {
        headers: {
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MaintenanceWindow'];
        };
      };
      404: components['responses']['NotFoundProblem'];
    };
  };
  cancelMaintenanceWindow: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
      };
      path: {
        window_id: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Maintenance window cancelled */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      404: components['responses']['NotFoundProblem'];
      409: components['responses']['ConflictProblem'];
      412: components['responses']['PreconditionFailed'];
      428: components['responses']['PreconditionRequired'];
    };
  };
  updateMaintenanceWindow: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
      };
      path: {
        window_id: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['MaintenanceWindowPatch'];
      };
    };
    responses: {
      /** @description Maintenance window updated */
      200: {
        headers: {
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MaintenanceWindow'];
        };
      };
      404: components['responses']['NotFoundProblem'];
      409: components['responses']['ConflictProblem'];
      412: components['responses']['PreconditionFailed'];
      422: components['responses']['ValidationProblem'];
      428: components['responses']['PreconditionRequired'];
    };
  };
  listNotificationRecipients: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Notification recipients */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['NotificationRecipientPage'];
        };
      };
    };
  };
  createNotificationRecipient: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['EmailRequest'];
      };
    };
    responses: {
      /** @description Recipient created; verification scheduled */
      201: {
        headers: {
          Location: components['headers']['Location'];
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['NotificationRecipient'];
        };
      };
      409: components['responses']['ConflictProblem'];
      422: components['responses']['ValidationProblem'];
    };
  };
  deleteNotificationRecipient: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
      };
      path: {
        recipient_id: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Recipient disabled */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      404: components['responses']['NotFoundProblem'];
      409: components['responses']['ConflictProblem'];
      412: components['responses']['PreconditionFailed'];
      428: components['responses']['PreconditionRequired'];
    };
  };
  resendNotificationRecipientVerification: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path: {
        recipient_id: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      202: components['responses']['Accepted'];
      404: components['responses']['NotFoundProblem'];
      409: components['responses']['ConflictProblem'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  sendNotificationRecipientTestEmail: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path: {
        recipient_id: components['schemas']['Uuid'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      202: components['responses']['Accepted'];
      404: components['responses']['NotFoundProblem'];
      409: components['responses']['ConflictProblem'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  confirmNotificationRecipientVerification: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['TokenRequest'];
      };
    };
    responses: {
      /** @description Recipient verified */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      422: components['responses']['ValidationProblem'];
    };
  };
  getDefaultNotificationPolicy: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Default notification policy */
      200: {
        headers: {
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['NotificationPolicy'];
        };
      };
    };
  };
  replaceDefaultNotificationPolicy: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['DefaultNotificationPolicyWrite'];
      };
    };
    responses: {
      /** @description Policy replaced */
      200: {
        headers: {
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['NotificationPolicy'];
        };
      };
      412: components['responses']['PreconditionFailed'];
      422: components['responses']['ValidationProblem'];
      428: components['responses']['PreconditionRequired'];
    };
  };
  getGroupNotificationPolicy: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        group_id: components['parameters']['GroupId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Effective group notification policy */
      200: {
        headers: {
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['NotificationPolicy'];
        };
      };
    };
  };
  replaceGroupNotificationPolicy: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
      };
      path: {
        group_id: components['parameters']['GroupId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['NotificationPolicyWrite'];
      };
    };
    responses: {
      /** @description Group policy replaced */
      200: {
        headers: {
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['NotificationPolicy'];
        };
      };
      404: components['responses']['NotFoundProblem'];
      412: components['responses']['PreconditionFailed'];
      422: components['responses']['ValidationProblem'];
      428: components['responses']['PreconditionRequired'];
    };
  };
  listPublicPages: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor'];
        limit?: components['parameters']['Limit'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Owner public-page configurations */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PublicPagePage'];
        };
      };
    };
  };
  createPublicPage: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PublicPageWrite'];
      };
    };
    responses: {
      /** @description Draft page created */
      201: {
        headers: {
          Location: components['headers']['Location'];
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PublicPage'];
        };
      };
    };
  };
  getPublicPage: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        page_id: components['parameters']['PageId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Private page configuration */
      200: {
        headers: {
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PublicPage'];
        };
      };
      404: components['responses']['NotFoundProblem'];
    };
  };
  deletePublicPage: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
      };
      path: {
        page_id: components['parameters']['PageId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Page deleted and public access closed */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      412: components['responses']['PreconditionFailed'];
      428: components['responses']['PreconditionRequired'];
    };
  };
  updatePublicPage: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
      };
      path: {
        page_id: components['parameters']['PageId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PublicPagePatch'];
      };
    };
    responses: {
      200: components['responses']['PublicPageCommandResult'];
      412: components['responses']['PreconditionFailed'];
      428: components['responses']['PreconditionRequired'];
    };
  };
  replacePublicPageComponents: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
      };
      path: {
        page_id: components['parameters']['PageId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          items: components['schemas']['PublicComponentWrite'][];
        };
      };
    };
    responses: {
      200: components['responses']['PublicPageCommandResult'];
      412: components['responses']['PreconditionFailed'];
      428: components['responses']['PreconditionRequired'];
    };
  };
  publishPublicPage: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path: {
        page_id: components['parameters']['PageId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Page published; raw link token is shown once */
      200: {
        headers: {
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PublicLinkResult'];
        };
      };
      412: components['responses']['PreconditionFailed'];
      428: components['responses']['PreconditionRequired'];
    };
  };
  disablePublicPage: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
      };
      path: {
        page_id: components['parameters']['PageId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: components['responses']['PublicPageCommandResult'];
      412: components['responses']['PreconditionFailed'];
      428: components['responses']['PreconditionRequired'];
    };
  };
  rotatePublicPageLink: {
    parameters: {
      query?: never;
      header: {
        'X-CSRF-Token': components['parameters']['CsrfToken'];
        'If-Match': components['parameters']['IfMatch'];
        'Idempotency-Key': components['parameters']['IdempotencyKey'];
      };
      path: {
        page_id: components['parameters']['PageId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Link rotated atomically; raw token is shown once */
      200: {
        headers: {
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PublicLinkResult'];
        };
      };
      412: components['responses']['PreconditionFailed'];
      428: components['responses']['PreconditionRequired'];
    };
  };
  streamPrivateEvents: {
    parameters: {
      query?: never;
      header?: {
        'Last-Event-ID'?: components['parameters']['LastEventId'];
      };
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Owner-scoped, non-durable SSE invalidation stream */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/event-stream': string;
        };
      };
      401: components['responses']['AuthenticationProblem'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  getPublicStatusPage: {
    parameters: {
      query?: never;
      header?: {
        'If-None-Match'?: string;
      };
      path: {
        /** @description Opaque secret; must be redacted from logs and telemetry */
        public_token: components['parameters']['PublicToken'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Allowlisted public projection */
      200: {
        headers: {
          ETag: components['headers']['ETag'];
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PublicStatusSnapshot'];
        };
      };
      /** @description Projection has not changed */
      304: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      404: components['responses']['PublicNotFoundProblem'];
      429: components['responses']['RateLimitProblem'];
    };
  };
  streamPublicStatusPageEvents: {
    parameters: {
      query?: never;
      header?: {
        'Last-Event-ID'?: components['parameters']['LastEventId'];
      };
      path: {
        /** @description Opaque secret; must be redacted from logs and telemetry */
        public_token: components['parameters']['PublicToken'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Page-scoped, non-durable SSE invalidation stream */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/event-stream': string;
        };
      };
      404: components['responses']['PublicNotFoundProblem'];
      429: components['responses']['RateLimitProblem'];
    };
  };
}
