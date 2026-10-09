# Veritabanı Şema ve Kolon Sözlüğü

**Durum:** Uygulandı ve migration entegrasyon testleriyle doğrulandı
**Bağlı belge:** [`DATABASE.md`](./DATABASE.md)

Bu sözlük başlangıç migration'ının normatif veri modelidir. Kolon adlarında küçük uygulama ayrıntıları implementation sırasında değişebilir; sahiplik, bütünlük, durum ve zaman semantiği ancak yeni karar kaydıyla değiştirilebilir.

## 1. Ortak Kurallar

### 1.1 Tipler ve varsayılanlar

| Kavram | PostgreSQL karşılığı    | Kural                                                      |
| ------ | ----------------------- | ---------------------------------------------------------- |
| Kimlik | `uuid`                  | Aggregate/event için `DEFAULT uuidv7()`                    |
| Sahip  | `owner_id uuid`         | Private satırda normalde `NOT NULL`; `auth.users(id)` kökü |
| An     | `timestamptz`           | UTC; iş kuralı anları açık isimli                          |
| Süre   | `integer` veya `bigint` | Milisaniye; negatif olamaz                                 |
| Sürüm  | `bigint`                | `>= 1`; atomik artar                                       |
| Durum  | `text`                  | İsimlendirilmiş `CHECK` ile kapalı küme                    |
| Digest | `bytea`                 | Ham secret/token tutulmaz                                  |
| JSON   | `jsonb`                 | Şema sürümlü, bounded ve canonical object                  |

`updated_at` otomatik trigger ile gizlice değiştirilmez; repository her mutation'da açıkça günceller. Optimistic update biçimi `WHERE id = ? AND resource_version = ?` olur ve aynı statement yeni sürümü döndürür.

### 1.2 Ortak constraint ilkeleri

- Tenant ebeveynleri `UNIQUE (owner_id, id)` taşır.
- Tenant çocukları hem `owner_id` hem parent id taşır ve composite foreign key kullanır.
- Child satır aynı parent zincirinden birden çok kimliği denormalize ediyorsa yalnız ayrı owner FK'leriyle yetinmez; tam lineage anahtarı kullanır. Örneğin job `UNIQUE(owner_id,check_id,id)`, attempt `(owner_id,check_id,job_id)` FK ve run `(owner_id,check_id,job_id,attempt_id)` FK taşır.
- Foreign key'ler isimlendirilir; silme davranışı açıkça seçilir, varsayılana bırakılmaz.
- High-volume/history tablolarında geniş cascade yoktur. Purge servis işlemiyle yapılır.
- `created_at <= updated_at`, `start < end`, sayaç/süre `>= 0` gibi satır-içi kurallar CHECK ile korunur.
- URL protokolü, e-posta normalizasyonu ve JSON semantiği application validation'a ek olarak integration test ile doğrulanır; karmaşık regex constraint kullanılmaz.
- PII veya secret içeren kolonlar log/audit payload'ına kopyalanmaz.

## 2. `infra` Şeması

### 2.1 `infra.schema_migrations`

Migration geçmişinin değişmez ledger'ıdır.

| Kolon             | Tip           | Kural/anlam                                   |
| ----------------- | ------------- | --------------------------------------------- |
| `version`         | `bigint`      | PK; monoton migration numarası                |
| `name`            | `text`        | İnsan okunur dosya adı                        |
| `checksum_sha256` | `bytea`       | Uygulanan dosyanın digest'i; drift hata verir |
| `transactional`   | `boolean`     | Migration transaction içinde miydi            |
| `applied_at`      | `timestamptz` | DB zamanı                                     |
| `execution_ms`    | `bigint`      | Operasyon kanıtı                              |
| `app_build`       | `text`        | Uygulayan build/commit, varsa                 |

Bu tablo yalnız migrator tarafından yazılır; runtime tarafından yalnız readiness için okunur.

### 2.2 `infra.schema_compatibility`

Tek satırlı (`singleton_id=true`) uygulama/şema uyumluluk kontratıdır.

| Kolon                 | Tip           | Kural/anlam                                |
| --------------------- | ------------- | ------------------------------------------ |
| `singleton_id`        | `boolean`     | PK, yalnız `true`                          |
| `current_revision`    | `bigint`      | Son tamamlanan migration                   |
| `compatibility_epoch` | `bigint`      | Contract kıran geçişte artar               |
| `minimum_app_epoch`   | `bigint`      | Çalışabilecek en eski app contract epoch'u |
| `updated_at`          | `timestamptz` | Son değişim                                |

### 2.3 `infra.outbox_events`

Domain transaction'ıyla atomik yazılan, append-only event envelope'udur.

| Kolon               | Tip           | Kural/anlam                                   |
| ------------------- | ------------- | --------------------------------------------- |
| `id`                | `uuid`        | PK, UUIDv7                                    |
| `owner_id`          | `uuid NULL`   | Tenant olayıysa zorunlu; system olayıysa null |
| `event_type`        | `text`        | Version'sız semantik ad                       |
| `schema_version`    | `smallint`    | `>=1`                                         |
| `aggregate_type`    | `text`        | Aggregate sınıfı                              |
| `aggregate_id`      | `uuid`        | Aggregate kimliği                             |
| `aggregate_version` | `bigint NULL` | İlgili resource/state sürümü                  |
| `correlation_id`    | `uuid`        | Request/job zinciri                           |
| `causation_id`      | `uuid NULL`   | Önceki command/event                          |
| `occurred_at`       | `timestamptz` | Domain olayı anı                              |
| `payload`           | `jsonb`       | Redacted, şema doğrulanmış, en fazla 32 KiB   |
| `created_at`        | `timestamptz` | DB insert anı                                 |

Payload update edilmez. Event type + version'a ait şema contract package içinde bulunur.

### 2.4 `infra.outbox_dispatches`

Bir event'in bir hedef consumer'a dayanıklı teslim durumudur.

| Kolon              | Tip                | Kural/anlam                                                |
| ------------------ | ------------------ | ---------------------------------------------------------- |
| `event_id`         | `uuid`             | `outbox_events` FK                                         |
| `destination`      | `text`             | `REALTIME`, `NOTIFICATION`, `PREDICTION`, `AUDIT`          |
| `state`            | `text`             | `PENDING`, `PROCESSING`, `RETRY_WAIT`, `COMPLETED`, `DEAD` |
| `available_at`     | `timestamptz`      | Claim edilebilecek en erken an                             |
| `attempt_count`    | `integer`          | `>=0`                                                      |
| `lease_owner`      | `text NULL`        | Worker instance id                                         |
| `lease_expires_at` | `timestamptz NULL` | Süreli sahiplik                                            |
| `fencing_token`    | `bigint`           | Her claim'de artar                                         |
| `last_error_code`  | `text NULL`        | Bounded/sanitized sınıf                                    |
| `completed_at`     | `timestamptz NULL` | Terminal an                                                |

PK `(event_id, destination)`; lease alanları yalnız aktif durumlarda dolu olur. Realtime dispatch tamamlandıktan sonra event kaçırılsa bile istemci current state'i yeniden çeker.

### 2.5 `infra.api_idempotency_records`

Retry edilebilir HTTP create/command işlemlerinin bounded sonuç makbuzudur. Raw idempotency anahtarı, e-posta, parola veya token saklamaz.

| Kolon                    | Tip           | Kural/anlam                                                          |
| ------------------------ | ------------- | -------------------------------------------------------------------- |
| `id`                     | `uuid`        | PK, UUIDv7                                                           |
| `owner_id`               | `uuid NULL`   | Authenticated owner; anonymous akışta null                           |
| `subject_digest`         | `bytea`       | 32-byte server-HMAC subject scope                                    |
| `operation`              | `text`        | Stabil operation scope                                               |
| `key_digest`             | `bytea`       | 32-byte server-HMAC idempotency key digest                           |
| `request_hash`           | `bytea`       | 32-byte canonical method/path/body hash                              |
| `response_status`        | `smallint`    | Yalnız `200..499`; `5xx` başarı olarak cache edilmez                 |
| `response_headers`       | `jsonb`       | En fazla 2 KiB; yalnız `Location` ve `ETag`                          |
| `response_body`          | `jsonb NULL`  | Secret içermeyen object response; en fazla 64 KiB                    |
| `encrypted_response`     | `bytea NULL`  | Tek-seferlik link gibi secret-bearing replay için ciphertext         |
| `encryption_key_version` | `text NULL`   | Ciphertext ile birlikte zorunlu key sürümü                           |
| `created_at`             | `timestamptz` | Commit zamanı                                                        |
| `expires_at`             | `timestamptz` | `created_at` sonrası, en fazla yedi gün; varsayılan politika 24 saat |

`UNIQUE(subject_digest, operation, key_digest)` yarışmayı DB'de tekilleştirir. Authenticated kayıtlar FORCE RLS ile yalnız current owner'a görünür. Anonymous satırlar doğrudan API RLS erişimine kapalıdır; Aşama 5'te yalnız tam HMAC scope'u kabul eden dar `security_api` fonksiyonu kullanılacaktır.

## 3. `auth` Şeması

### 3.1 `auth.users`

| Kolon                      | Tip                | Kural/anlam                                                        |
| -------------------------- | ------------------ | ------------------------------------------------------------------ |
| `id`                       | `uuid`             | PK ve owner kökü                                                   |
| `email_normalized`         | `varchar(320)`     | Unique; trim/lower normalizasyon çıktısı                           |
| `email_display`            | `varchar(320)`     | Kullanıcıya gösterilecek adres                                     |
| `display_name`             | `varchar(120)`     | Boş olamaz                                                         |
| `status`                   | `text`             | `PENDING_VERIFICATION`, `ACTIVE`, `DISABLED`, `DELETION_REQUESTED` |
| `email_verified_at`        | `timestamptz NULL` | Doğrulama kanıtı                                                   |
| `resource_version`         | `bigint`           | Optimistic concurrency                                             |
| `deletion_requested_at`    | `timestamptz NULL` | Durumla tutarlı                                                    |
| `created_at`, `updated_at` | `timestamptz`      | Audit zamanları                                                    |

Status ve verification/deletion kolonları arasında CHECK bulunur. E-posta global unique'dir; hesap enumerasyonu API hata sözleşmesiyle engellenir.

### 3.2 `auth.password_credentials`

| Kolon              | Tip           | Kural/anlam                          |
| ------------------ | ------------- | ------------------------------------ |
| `owner_id`         | `uuid`        | PK ve user FK                        |
| `password_hash`    | `text`        | Argon2id encoded hash; plaintext yok |
| `password_version` | `integer`     | Parola/parametre değişiminde artar   |
| `changed_at`       | `timestamptz` | Session invalidation karşılaştırması |

`ON DELETE RESTRICT`; user purge akışı açıkça önce credential'ı temizler.

### 3.3 `auth.sessions`

| Kolon                      | Tip                | Kural/anlam                   |
| -------------------------- | ------------------ | ----------------------------- |
| `id`                       | `uuid`             | PK                            |
| `owner_id`                 | `uuid`             | User composite FK             |
| `token_digest`             | `bytea`            | Global unique; ham cookie yok |
| `issued_password_version`  | `integer`          | Credential version snapshot   |
| `created_at`, `expires_at` | `timestamptz`      | `expires_at > created_at`     |
| `last_seen_at`             | `timestamptz NULL` | Rate-limited touch            |
| `revoked_at`               | `timestamptz NULL` | Null değilse geçersiz         |
| `revoke_reason`            | `text NULL`        | Bounded category              |
| `rotated_from_session_id`  | `uuid NULL`        | Güvenli rotation zinciri      |

Token lookup yalnız dar güvenlik fonksiyonuyla yapılır. Session metadata v1'de zorunlu değildir; user-agent/IP saklanırsa açık privacy kararı gerekir.

### 3.4 `auth.one_time_tokens`

| Kolon                      | Tip                | Kural/anlam                              |
| -------------------------- | ------------------ | ---------------------------------------- |
| `id`                       | `uuid`             | PK                                       |
| `owner_id`                 | `uuid`             | User composite FK                        |
| `purpose`                  | `text`             | `VERIFY_ACCOUNT_EMAIL`, `RESET_PASSWORD` |
| `token_digest`             | `bytea`            | Global unique                            |
| `created_at`, `expires_at` | `timestamptz`      | Geçerlilik aralığı                       |
| `consumed_at`              | `timestamptz NULL` | Tek kullanımlılık                        |

Aynı kullanıcı/purpose için birden fazla açık token üretildiğinde eskileri transaction içinde consume/revoke edilir.

## 4. `app` Şeması

### 4.1 `app.check_groups`

| Kolon                      | Tip                | Kural/anlam                           |
| -------------------------- | ------------------ | ------------------------------------- |
| `id`                       | `uuid`             | PK                                    |
| `owner_id`                 | `uuid`             | User composite FK                     |
| `name`                     | `varchar(160)`     | Aynı owner altında duplicate olabilir |
| `resource_version`         | `bigint`           | Optimistic concurrency                |
| `created_at`, `updated_at` | `timestamptz`      | Audit zamanları                       |
| `deleted_at`               | `timestamptz NULL` | Soft delete                           |

`UNIQUE(owner_id,id)` sahiplik FK hedefidir. Group silme transaction'ı live check'lerde `group_id=NULL` yapar.

### 4.2 `app.checks`

| Kolon                      | Tip                  | Kural/anlam                                        |
| -------------------------- | -------------------- | -------------------------------------------------- |
| `id`                       | `uuid`               | PK                                                 |
| `owner_id`                 | `uuid`               | User composite FK                                  |
| `group_id`                 | `uuid NULL`          | `(owner_id,group_id)` → group                      |
| `name`                     | `varchar(160)`       | Boş olamaz                                         |
| `url`                      | `varchar(4096)`      | Normalize edilmiş HTTP/HTTPS URL                   |
| `interval_seconds`         | `smallint`           | `30..3600`                                         |
| `timeout_ms`               | `integer`            | `1..300000`; deployment limiti daha düşük olabilir |
| `expected_status_code`     | `smallint`           | `100..599`                                         |
| `expected_body_substring`  | `varchar(2048) NULL` | Response body'nin kendisi saklanmaz                |
| `lifecycle_state`          | `text`               | `LIVE`, `DELETED`                                  |
| `execution_state`          | `text`               | `ACTIVE`, `PAUSED`                                 |
| `resource_version`         | `bigint`             | Her görünür edit                                   |
| `probe_generation`         | `bigint`             | Probe anlamını değiştiren edit                     |
| `schedule_generation`      | `bigint`             | Cadence/pause/resume değişimi                      |
| `cadence_anchor_at`        | `timestamptz`        | Drift üretmeyen cadence kökü                       |
| `next_run_at`              | `timestamptz NULL`   | Yalnız LIVE+ACTIVE için dolu                       |
| `manual_requested_at`      | `timestamptz NULL`   | Coalesced tek manual niyet                         |
| `next_fencing_token`       | `bigint`             | Claim sırasında atomik alınır ve artar             |
| `created_at`, `updated_at` | `timestamptz`        | Audit zamanları                                    |
| `deleted_at`               | `timestamptz NULL`   | Lifecycle ile tutarlı                              |

`UNIQUE(owner_id,id)` bulunur. Probe anlamı URL, timeout, expected code/body değişimidir. İsim/group değişimi probe generation'ı artırmaz. ACTIVE interval değişimi schedule generation'ı artırır ve `fresh_until` yeniden hesaplanır.

### 4.3 `app.maintenance_windows`

| Kolon                      | Tip                | Kural/anlam                        |
| -------------------------- | ------------------ | ---------------------------------- |
| `id`                       | `uuid`             | PK                                 |
| `owner_id`                 | `uuid`             | User composite FK                  |
| `check_id`                 | `uuid NULL`        | Check hedefi                       |
| `group_id`                 | `uuid NULL`        | Group hedefi                       |
| `name`                     | `varchar(160)`     | Kullanıcı etiketi                  |
| `starts_at`, `ends_at`     | `timestamptz`      | `[starts_at,ends_at)`, start < end |
| `state`                    | `text`             | `SCHEDULED`, `CANCELLED`           |
| `cancelled_at`             | `timestamptz NULL` | State ile tutarlı                  |
| `resource_version`         | `bigint`           | Optimistic concurrency             |
| `created_at`, `updated_at` | `timestamptz`      | Audit zamanları                    |

`num_nonnulls(check_id,group_id)=1`. Her iki olası hedef composite owner FK ile korunur. `ACTIVE`/`ENDED` saklanmaz, DB zamanı ve aralıktan türetilir. Örtüşen maintenance pencerelerine izin verilir; etkinlik union semantiğidir.

## 5. `monitoring` Şeması

### 5.1 `monitoring.check_current_states`

Check başına tek hızlı dashboard projection'ıdır.

| Kolon                                | Tip                | Kural/anlam                                 |
| ------------------------------------ | ------------------ | ------------------------------------------- |
| `check_id`                           | `uuid`             | PK                                          |
| `owner_id`                           | `uuid`             | Check composite FK                          |
| `health_state`                       | `text`             | `UNKNOWN`, `UP`, `SUSPECT`, `DOWN`          |
| `freshness_state`                    | `text`             | `FRESH`, `STALE`                            |
| `consecutive_failure_count`          | `integer`          | `>=0`                                       |
| `candidate_started_at`               | `timestamptz NULL` | İlk eşik-altı FAIL anı                      |
| `candidate_run_id`                   | `uuid NULL`        | Run locator'ın id parçası                   |
| `candidate_run_finished_at`          | `timestamptz NULL` | Run locator'ın partition parçası            |
| `open_incident_id`                   | `uuid NULL`        | Aynı owner/check incident FK                |
| `last_accepted_run_id`               | `uuid NULL`        | Son accepted run                            |
| `last_accepted_run_finished_at`      | `timestamptz NULL` | Composite run FK                            |
| `last_accepted_fencing_token`        | `bigint`           | Eski attempt reddi için monoton değer       |
| `last_success_at`, `last_failure_at` | `timestamptz NULL` | Accepted observation anları                 |
| `last_response_time_ms`              | `integer NULL`     | `>=0`                                       |
| `last_status_code`                   | `smallint NULL`    | HTTP code, varsa                            |
| `last_failure_category`              | `text NULL`        | Taxonomy değeri                             |
| `fresh_until`                        | `timestamptz NULL` | Bu andan sonra effective STALE              |
| `stale_reconciled_at`                | `timestamptz NULL` | Interval/incident reconciliation checkpoint |
| `state_version`                      | `bigint`           | Her görünür projection değişiminde artar    |
| `updated_at`                         | `timestamptz`      | Son projection yazımı                       |

Candidate run çiftinin iki kolonu birlikte null/dolu olur; aynı kural last accepted run için de geçerlidir. Foreign key gerçekte satırdaki `owner_id` ve `check_id` ile birlikte `(owner_id, check_id, run_finished_at, run_id)` dörtlüsünü kullanır. `freshness_state` kalıcı projection'dır, fakat okuma katmanı `fresh_until <= now()` ise reconciler gecikse dahi effective STALE döndürür.

### 5.2 `monitoring.check_jobs`

| Kolon                              | Tip                | Kural/anlam                                                      |
| ---------------------------------- | ------------------ | ---------------------------------------------------------------- |
| `id`                               | `uuid`             | PK                                                               |
| `owner_id`, `check_id`             | `uuid`             | Composite check FK                                               |
| `trigger_kind`                     | `text`             | `SCHEDULED`, `MANUAL`                                            |
| `manual_mode`                      | `text NULL`        | `STATEFUL`, `DIAGNOSTIC`; yalnız manual                          |
| `scheduled_for`                    | `timestamptz`      | Cadence/manual talep anı                                         |
| `available_at`                     | `timestamptz`      | Retry/backoff dahil claim zamanı                                 |
| `priority`                         | `smallint`         | Manual/scheduled adalet girdisi                                  |
| `state`                            | `text`             | `PENDING`, `LEASED`, `RUNNING`, `COMPLETED`, `CANCELLED`, `DEAD` |
| `config_snapshot`                  | `jsonb`            | URL/probe ayarı; en fazla 16 KiB; secret yok                     |
| `resource_version`                 | `bigint`           | Enqueue snapshot                                                 |
| `probe_generation`                 | `bigint`           | Acceptance snapshot                                              |
| `schedule_generation`              | `bigint`           | Acceptance snapshot                                              |
| `attempt_count`, `max_attempts`    | `smallint`         | `0 <= attempt_count <= max_attempts`                             |
| `lease_owner`                      | `text NULL`        | Instance id                                                      |
| `lease_expires_at`, `heartbeat_at` | `timestamptz NULL` | Aktif lease                                                      |
| `fencing_token`                    | `bigint NULL`      | Son claim token'ı                                                |
| `started_at`, `completed_at`       | `timestamptz NULL` | Yaşam döngüsü                                                    |
| `terminal_reason`                  | `text NULL`        | Bounded category                                                 |
| `created_at`, `updated_at`         | `timestamptz`      | Operasyon zamanları                                              |

Check başına aktif/queued kombinasyonu partial unique index ile tekilleşir. `UNIQUE(owner_id,check_id,id)` attempt lineage FK'sinin hedefidir. Lease reclaim aynı job üzerinde yeni attempt ve daha yüksek fencing token üretir.

### 5.3 `monitoring.check_job_attempts`

| Kolon                             | Tip                | Kural/anlam                                                        |
| --------------------------------- | ------------------ | ------------------------------------------------------------------ |
| `id`                              | `uuid`             | PK                                                                 |
| `owner_id`, `check_id`, `job_id`  | `uuid`             | Composite sahiplik ve job FK                                       |
| `attempt_number`                  | `smallint`         | Job içinde 1'den başlar; unique                                    |
| `worker_id`                       | `text`             | Instance identity                                                  |
| `fencing_token`                   | `bigint`           | Attempt'a ayrılan monoton token                                    |
| `lease_acquired_at`, `started_at` | `timestamptz`      | Başlangıç anları                                                   |
| `last_heartbeat_at`               | `timestamptz NULL` | Operasyon kanıtı                                                   |
| `ended_at`                        | `timestamptz NULL` | Terminal an                                                        |
| `terminal_reason`                 | `text NULL`        | `RESULT_RECORDED`, `LEASE_LOST`, `INTERNAL_ERROR`, `CANCELLED` vb. |
| `result_recorded_at`              | `timestamptz NULL` | Tek sonuç insert guard'ı                                           |

Attempt, `(owner_id,check_id,job_id)` ile tam job lineage FK'sine bağlıdır ve run için `UNIQUE(owner_id,check_id,job_id,id)` hedefi sağlar. `UNIQUE(job_id,attempt_number)` ve `UNIQUE(job_id,fencing_token)` bulunur. Attempt row lock altında `result_recorded_at IS NULL` kontrolü duplicate result'ı engeller.

### 5.4 `monitoring.check_runs` — aylık partition

Her tamamlanmış probe için immutable gözlem/diagnostic kaydıdır. Response body saklanmaz.

| Kolon                                                         | Tip                  | Kural/anlam                                            |
| ------------------------------------------------------------- | -------------------- | ------------------------------------------------------ |
| `finished_at`                                                 | `timestamptz`        | Partition key ve PK parçası                            |
| `id`                                                          | `uuid`               | PK parçası                                             |
| `owner_id`, `check_id`                                        | `uuid`               | Owner PK parçası ve composite check FK                 |
| `job_id`, `attempt_id`                                        | `uuid`               | Kaynak job/attempt                                     |
| `trigger_kind`                                                | `text`               | Snapshot                                               |
| `manual_mode`                                                 | `text NULL`          | Diagnostic ayrımı                                      |
| `resource_version`, `probe_generation`, `schedule_generation` | `bigint`             | Kabul girdileri                                        |
| `fencing_token`                                               | `bigint`             | Kabul sırası                                           |
| `scheduled_for`, `started_at`                                 | `timestamptz`        | Timing                                                 |
| `dns_ms`, `connect_ms`, `tls_ms`, `ttfb_ms`, `total_ms`       | `integer NULL`       | Non-negative; ölçülebilen aşamalar                     |
| `status_code`                                                 | `smallint NULL`      | HTTP response varsa                                    |
| `body_match`                                                  | `boolean NULL`       | Expected substring ayarlıysa                           |
| `outcome`                                                     | `text`               | `PASS`, `FAIL`                                         |
| `failure_category`                                            | `text NULL`          | DNS, CONNECT, TLS, TIMEOUT, STATUS, BODY, PROTOCOL vb. |
| `diagnostic`                                                  | `varchar(1024) NULL` | Sanitized; body/secret yok                             |
| `accepted_for_state`                                          | `boolean`            | Current state'e uygulanıp uygulanmadı                  |
| `rejection_reason`                                            | `text NULL`          | Generation/fence/pause/delete sebebi                   |
| `recorded_at`                                                 | `timestamptz`        | DB insert anı                                          |

PK `(owner_id,check_id,finished_at,id)` olur. Run satırı full lineage foreign key'leriyle doğru check/job/attempt zincirine bağlanır. Run'a sonraki referanslar `(owner_id,check_id,run_finished_at,run_id)` dört kolonlu FK'sini taşır. Diagnostic manual run `accepted_for_state=false` olur. Outcome FAIL job'ın teknik olarak başarısız olduğu anlamına gelmez; probe sonucu başarıyla kaydedilmiş COMPLETED job'dır.

### 5.5 `monitoring.open_health_intervals`

Check başına tam bir açık/provisional interval tutar; global “tek açık interval” kuralını partition sınırından bağımsız uygular.

| Kolon                                     | Tip           | Kural/anlam                                                |
| ----------------------------------------- | ------------- | ---------------------------------------------------------- |
| `check_id`                                | `uuid`        | PK                                                         |
| `owner_id`                                | `uuid`        | Composite check FK                                         |
| `id`                                      | `uuid`        | Kapanınca history kimliği                                  |
| `classification`                          | `text`        | `UP`, `DOWN`, `UNKNOWN`, `PROVISIONAL`                     |
| `started_at`                              | `timestamptz` | Aralık başlangıcı                                          |
| `probe_generation`                        | `bigint`      | Semantik sınır                                             |
| `source_kind`                             | `text`        | `RUN`, `FRESHNESS`, `PAUSE`, `RESUME`, `CONFIG`, `STARTUP` |
| `source_run_id`, `source_run_finished_at` | nullable pair | Kaynak run, varsa                                          |
| `updated_at`                              | `timestamptz` | Son reconciliation                                         |

`id` ayrıca unique'dir. Yeni state başladığında eski open row aynı transaction'da history'ye taşınır ve yeni open row upsert edilir.

### 5.6 `monitoring.health_intervals` — aylık partition

Finalize edilmiş, yarı açık availability timeline'ıdır.

| Kolon                                     | Tip           | Kural/anlam                                               |
| ----------------------------------------- | ------------- | --------------------------------------------------------- |
| `started_at`, `id`                        | zaman + uuid  | Composite PK; start partition key                         |
| `owner_id`, `check_id`                    | `uuid`        | Composite check FK                                        |
| `ended_at`                                | `timestamptz` | `ended_at > started_at`                                   |
| `classification`                          | `text`        | `UP`, `DOWN`, `UNKNOWN`; `PROVISIONAL` kapanırken çözülür |
| `probe_generation`                        | `bigint`      | Config sınırı                                             |
| `source_kind`                             | `text`        | Başlatan olay                                             |
| `source_run_id`, `source_run_finished_at` | nullable pair | Kaynak run                                                |
| `finalized_at`                            | `timestamptz` | Kararın verildiği an                                      |

DOWN süreleri incident segmentleriyle eşleşir; UNKNOWN availability paydasına girmez. Aralıklar check satırı/incident row lock altında seri üretildiği için overlap transaction protokolüyle engellenir ve test edilir.

### 5.7 `monitoring.incidents`

| Kolon                                                   | Tip                | Kural/anlam                                                      |
| ------------------------------------------------------- | ------------------ | ---------------------------------------------------------------- |
| `id`                                                    | `uuid`             | PK                                                               |
| `owner_id`, `check_id`                                  | `uuid`             | Composite check FK                                               |
| `status`                                                | `text`             | `OPEN`, `CLOSED`                                                 |
| `observation_mode`                                      | `text`             | `OBSERVED`, `UNOBSERVED`                                         |
| `first_failure_run_id`, `first_failure_run_finished_at` | pair               | İlk FAIL run FK                                                  |
| `confirmation_run_id`, `confirmation_run_finished_at`   | pair               | Eşiği geçen FAIL run FK                                          |
| `started_at`, `confirmed_at`                            | `timestamptz`      | Başlangıç ilk failure anıdır                                     |
| `closed_at`                                             | `timestamptz NULL` | CLOSED ise zorunlu                                               |
| `closure_reason`                                        | `text NULL`        | `RECOVERED`, `CONFIG_CHANGED`, `CHECK_DELETED`, `ADMINISTRATIVE` |
| `observed_duration_ms`                                  | `bigint`           | Segment toplamı; gap hariç                                       |
| `last_failure_category`                                 | `text NULL`        | Son accepted FAIL sınıfı                                         |
| `resource_version`                                      | `bigint`           | Incident mutation sırası                                         |
| `created_at`, `updated_at`                              | `timestamptz`      | Audit zamanları                                                  |

`UNIQUE(owner_id,check_id,id)` segment ve notification lineage FK'lerinin hedefidir. Check başına en fazla bir `OPEN` incident partial unique index ile korunur. `closed_at >= started_at`; elapsed wall-clock ile observed duration ayrı kalır.

### 5.8 `monitoring.incident_segments`

| Kolon                                   | Tip                | Kural/anlam                                                 |
| --------------------------------------- | ------------------ | ----------------------------------------------------------- |
| `id`                                    | `uuid`             | PK                                                          |
| `owner_id`, `check_id`, `incident_id`   | `uuid`             | Composite sahiplik FKs                                      |
| `started_at`                            | `timestamptz`      | Observed DOWN başlangıcı                                    |
| `ended_at`                              | `timestamptz NULL` | Null ise aktif observed segment                             |
| `start_run_id`, `start_run_finished_at` | pair               | Segmenti açan FAIL                                          |
| `end_run_id`, `end_run_finished_at`     | nullable pair      | PASS varsa; freshness kapanışında null olabilir             |
| `close_reason`                          | `text NULL`        | `RECOVERED`, `STALE`, `PAUSED`, `CONFIG_CHANGED`, `DELETED` |
| `created_at`, `updated_at`              | `timestamptz`      | Audit zamanları                                             |

Incident başına tek açık segment partial unique index ile korunur. Segment işlemleri incident row lock altında olduğundan overlap engellenir.

### 5.9 `monitoring.rollups_minute` ve `monitoring.rollups_hour`

İki tablo aynı ölçü kolonlarını taşır; minute aylık, hour yıllık range partition edilir.

| Kolon                                              | Tip            | Kural/anlam                         |
| -------------------------------------------------- | -------------- | ----------------------------------- |
| `bucket_start`                                     | `timestamptz`  | Partition ve PK parçası; UTC hizalı |
| `owner_id`, `check_id`                             | `uuid`         | Composite check FK                  |
| `probe_generation`                                 | `bigint`       | Config sınırı; PK parçası           |
| `accepted_run_count`, `pass_count`, `fail_count`   | `integer`      | Non-negative                        |
| `response_sample_count`                            | `integer`      | Latency örneği sayısı               |
| `response_sum_ms`                                  | `bigint`       | Average için                        |
| `response_min_ms`, `response_max_ms`               | `integer NULL` | Sample yoksa null                   |
| `up_ms`, `down_ms`, `unknown_ms`, `provisional_ms` | `bigint`       | Bucket'a kırpılmış süreler          |
| `computed_through`                                 | `timestamptz`  | Watermark                           |
| `revision`                                         | `bigint`       | Late correction'da artar            |
| `updated_at`                                       | `timestamptz`  | Projection zamanı                   |

PK `(bucket_start,check_id,probe_generation)`. Availability `up_ms / (up_ms + down_ms)`; coverage `(up_ms + down_ms) / istenen_aralık_ms`. UNKNOWN ve provisional availability paydasına girmez.

### 5.10 `monitoring.rollup_checkpoints`

| Kolon             | Tip           | Kural/anlam                    |
| ----------------- | ------------- | ------------------------------ |
| `processor_name`  | `text`        | PK; minute/hour/reconciliation |
| `watermark_at`    | `timestamptz` | Kesin işlenmiş sınır           |
| `last_partition`  | `text NULL`   | Operasyon görünürlüğü          |
| `updated_at`      | `timestamptz` | Heartbeat                      |
| `last_error_code` | `text NULL`   | Sanitized                      |

## 6. `notification` Şeması

### 6.1 `notification.recipients`

| Kolon                               | Tip                | Kural/anlam                                    |
| ----------------------------------- | ------------------ | ---------------------------------------------- |
| `id`                                | `uuid`             | PK                                             |
| `owner_id`                          | `uuid`             | User composite FK                              |
| `email_normalized`, `email_display` | `varchar(320)`     | Owner içinde unique normal adres               |
| `status`                            | `text`             | `PENDING_VERIFICATION`, `VERIFIED`, `DISABLED` |
| `verified_at`, `disabled_at`        | `timestamptz NULL` | Status ile tutarlı                             |
| `resource_version`                  | `bigint`           | Optimistic concurrency                         |
| `created_at`, `updated_at`          | `timestamptz`      | Audit zamanları                                |

Yalnız VERIFIED recipient için delivery materialize edilir.

### 6.2 `notification.recipient_verification_tokens`

`id`, `owner_id`, `recipient_id`, unique `token_digest`, `created_at`, `expires_at`, nullable `consumed_at` taşır. Ham token saklanmaz; açık token rotation transaction'ında öncekiler consume edilir.

### 6.3 `notification.policies`

| Kolon                            | Tip            | Kural/anlam                          |
| -------------------------------- | -------------- | ------------------------------------ |
| `id`                             | `uuid`         | PK                                   |
| `owner_id`                       | `uuid`         | User composite FK                    |
| `group_id`                       | `uuid NULL`    | Null=user default; dolu=group policy |
| `mode`                           | `text`         | `ACTIVE`, `INHERIT`, `DISABLED`      |
| `notify_down`, `notify_recovery` | `boolean NULL` | ACTIVE ise zorunlu; INHERIT ise null |
| `resource_version`               | `bigint`       | Optimistic concurrency               |
| `created_at`, `updated_at`       | `timestamptz`  | Audit zamanları                      |

`UNIQUE NULLS NOT DISTINCT(owner_id,group_id)` her kullanıcı için tek default ve her group için tek policy sağlar. User default `INHERIT` olamaz. Group `INHERIT` ise recipient bağlantısı taşımaz.

### 6.4 `notification.policy_recipients`

`owner_id`, `policy_id`, `recipient_id`, `created_at` taşır. PK `(policy_id,recipient_id)`; iki taraf da aynı owner'a composite FK ile bağlıdır.

### 6.5 `notification.intents`

| Kolon                                        | Tip                | Kural/anlam                                                                                |
| -------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `id`                                         | `uuid`             | PK                                                                                         |
| `owner_id`, `check_id`, `incident_id`        | `uuid`             | Composite kaynak FKs                                                                       |
| `source_event_id`                            | `uuid`             | Outbox event unique FK                                                                     |
| `event_kind`                                 | `text`             | `INCIDENT_OPENED`, `INCIDENT_RECOVERED`                                                    |
| `state`                                      | `text`             | `PENDING_EVALUATION`, `DEFERRED_MAINTENANCE`, `MATERIALIZED`, `CANCELLED`, `NO_RECIPIENTS` |
| `maintenance_until`                          | `timestamptz NULL` | Deferred tekrar değerlendirme alt sınırı                                                   |
| `policy_version_snapshot`                    | `bigint NULL`      | Materialization kanıtı                                                                     |
| `created_at`, `evaluated_at`, `completed_at` | `timestamptz NULL` | Yaşam döngüsü                                                                              |

`UNIQUE(incident_id,event_kind)` aynı incident geçiş niyetini tekilleştirir. Policy ve recipient'lar materialization anında çözülür.

### 6.6 `notification.deliveries`

| Kolon                                   | Tip                | Kural/anlam                                                                              |
| --------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| `id`                                    | `uuid`             | PK                                                                                       |
| `owner_id`, `intent_id`, `recipient_id` | `uuid`             | Composite FKs                                                                            |
| `incident_id`                           | `uuid`             | Idempotency sorgusu için denormalize                                                     |
| `event_kind`                            | `text`             | Intent snapshot                                                                          |
| `recipient_address_snapshot`            | `varchar(320)`     | Gönderim kanıtı; recipient sonradan değişebilir                                          |
| `state`                                 | `text`             | `PENDING`, `PROCESSING`, `RETRY_WAIT`, `SENT`, `FAILED`, `DELIVERY_UNKNOWN`, `CANCELLED` |
| `attempt_count`, `max_attempts`         | `smallint`         | Bounded retry                                                                            |
| `available_at`, `next_attempt_at`       | `timestamptz`      | Claim planı                                                                              |
| `lease_owner`, `lease_expires_at`       | nullable           | Süreli sahiplik                                                                          |
| `fencing_token`                         | `bigint`           | Claim sırası                                                                             |
| `provider_message_id`                   | `text NULL`        | Mailpit/SMTP adapter sonucu                                                              |
| `last_result_code`, `last_error_detail` | `text NULL`        | Sanitized ve bounded                                                                     |
| `sent_at`, `completed_at`               | `timestamptz NULL` | Terminal zamanlar                                                                        |
| `created_at`, `updated_at`              | `timestamptz`      | Operasyon zamanları                                                                      |

`UNIQUE(incident_id,event_kind,recipient_id)` duplicate e-postayı engeller. SMTP kabulünden sonra bağlantı sonucu belirsizse `DELIVERY_UNKNOWN` terminaldir ve varsayılan otomatik retry yoktur.

## 7. `public_status` Şeması

### 7.1 `public_status.pages`

| Kolon                                       | Tip                  | Kural/anlam                      |
| ------------------------------------------- | -------------------- | -------------------------------- |
| `id`                                        | `uuid`               | PK                               |
| `owner_id`                                  | `uuid`               | User composite FK                |
| `title`                                     | `varchar(160)`       | Public başlık                    |
| `description`                               | `varchar(2000) NULL` | Public açıklama                  |
| `state`                                     | `text`               | `DRAFT`, `PUBLISHED`, `DISABLED` |
| `slug_digest`                               | `bytea`              | Unique; ham public token yok     |
| `token_revision`                            | `bigint`             | Rotation'da artar                |
| `resource_version`                          | `bigint`             | Config concurrency               |
| `published_at`, `disabled_at`, `deleted_at` | `timestamptz NULL`   | State/lifecycle ile tutarlı      |
| `created_at`, `updated_at`                  | `timestamptz`        | Audit zamanları                  |

Bir kullanıcı birden çok public page oluşturabilir. UUID route değildir; high-entropy token route'tur.

### 7.2 `public_status.components`

| Kolon                      | Tip                 | Kural/anlam                        |
| -------------------------- | ------------------- | ---------------------------------- |
| `id`                       | `uuid`              | PK                                 |
| `owner_id`, `page_id`      | `uuid`              | Composite page FK                  |
| `check_id`, `group_id`     | `uuid NULL`         | Tam biri dolu; composite owner FKs |
| `position`                 | `integer`           | Sayfa içinde unique, `>=0`         |
| `display_name`             | `varchar(160) NULL` | Public override                    |
| `show_url`                 | `boolean`           | Açık izin                          |
| `show_response_time`       | `boolean`           | Açık izin                          |
| `show_incident_history`    | `boolean`           | Açık izin                          |
| `created_at`, `updated_at` | `timestamptz`       | Audit zamanları                    |

Aynı check/group aynı page'e bir kez eklenir; iki partial unique index kullanılır.

### 7.3 `public_status.snapshots`

Anonymous erişime açılan tek veri yüzeyidir.

| Kolon                    | Tip           | Kural/anlam                                    |
| ------------------------ | ------------- | ---------------------------------------------- |
| `page_id`                | `uuid`        | PK                                             |
| `owner_id`               | `uuid`        | Page composite FK ve private RLS scope         |
| `slug_digest`            | `bytea`       | Unique lookup                                  |
| `page_revision`          | `bigint`      | Page resource/token/state sürümünü temsil eder |
| `payload_schema_version` | `smallint`    | DTO sürümü                                     |
| `payload`                | `jsonb`       | Public allowlist; en fazla 256 KiB             |
| `generated_at`           | `timestamptz` | Projection zamanı                              |

Snapshot yalnız PUBLISHED page için bulunur. Disable, token rotation veya delete aynı transaction'da snapshot'ı siler/değiştirir. `owner_id` yalnız private RLS/purge kolonudur; payload'a girmez. Payload hiçbir owner id, private recipient, internal error veya gizli URL alanını dolaylı olarak içermez.

## 8. `prediction` Şeması

### 8.1 `prediction.analysis_jobs`

| Kolon                                      | Tip                | Kural/anlam                                                          |
| ------------------------------------------ | ------------------ | -------------------------------------------------------------------- |
| `id`                                       | `uuid`             | PK                                                                   |
| `owner_id`, `check_id`                     | `uuid`             | Composite check identity; predictor private check tablosunu okuyamaz |
| `requested_through`                        | `timestamptz`      | Coalesced feature watermark                                          |
| `state`                                    | `text`             | `PENDING`, `PROCESSING`, `RETRY_WAIT`, `COMPLETED`, `DEAD`           |
| `available_at`                             | `timestamptz`      | Claim anı                                                            |
| `attempt_count`, `max_attempts`            | `smallint`         | Bounded retry                                                        |
| `lease_owner`, `lease_expires_at`          | nullable           | Süreli sahiplik                                                      |
| `fencing_token`                            | `bigint`           | Claim sırası                                                         |
| `created_at`, `updated_at`, `completed_at` | `timestamptz NULL` | Yaşam döngüsü                                                        |

Check başına aktif analysis job partial unique index ile tekilleşir; yeni talepler `requested_through` değerini ileri taşır.

### 8.2 `prediction.model_versions`

`id uuid` PK, unique `name` + `version`, `artifact_digest`, `feature_schema_version`, `status` (`CANDIDATE`, `ACTIVE`, `RETIRED`), `activated_at`, `retired_at`, `metadata jsonb` (bounded) ve audit zamanlarını taşır. Model artifact'i DB'de tutulmaz; digest ve provenance tutulur.

### 8.3 `prediction.scores` — aylık partition

| Kolon                                        | Tip            | Kural/anlam                                   |
| -------------------------------------------- | -------------- | --------------------------------------------- |
| `computed_at`, `id`                          | zaman + uuid   | Composite PK, monthly partition               |
| `owner_id`, `check_id`                       | `uuid`         | Kimlik; predictor yalnız kendi şemasına yazar |
| `analysis_job_id`                            | `uuid`         | Kaynak job                                    |
| `model_version_id`                           | `uuid`         | Model registry FK                             |
| `horizon_seconds`                            | `integer`      | `>0`                                          |
| `risk_score`                                 | `numeric(6,5)` | `0..1`                                        |
| `risk_level`                                 | `text`         | `LOW`, `MEDIUM`, `HIGH`, `INSUFFICIENT_DATA`  |
| `valid_until`                                | `timestamptz`  | `> computed_at`                               |
| `feature_window_start`, `feature_window_end` | `timestamptz`  | Bounded input aralığı                         |
| `feature_snapshot`                           | `jsonb`        | Aggregate/non-PII, en fazla 32 KiB            |
| `reason_codes`                               | `jsonb`        | Bounded code+weight listesi                   |

Score immutable'dır. “Insufficient data” da açıklanabilir bir score kaydıdır; health veya incident state'ine hiçbir FK/trigger yan etkisi yoktur.

## 9. `audit` Şeması

### 9.1 `audit.events` — aylık partition

| Kolon                          | Tip                 | Kural/anlam                   |
| ------------------------------ | ------------------- | ----------------------------- |
| `occurred_at`, `id`            | zaman + uuid        | Composite PK ve partition     |
| `owner_id`                     | `uuid NULL`         | Tenant veya system scope      |
| `actor_type`                   | `text`              | `USER`, `WORKER`, `SYSTEM`    |
| `actor_id`                     | `uuid/text NULL`    | PII olmayan identity          |
| `action`                       | `text`              | Semantik eylem                |
| `resource_type`, `resource_id` | `text`, `uuid NULL` | Hedef                         |
| `correlation_id`               | `uuid`              | Trace zinciri                 |
| `result`                       | `text`              | `SUCCESS`, `DENIED`, `FAILED` |
| `metadata`                     | `jsonb`             | Redacted, en fazla 16 KiB     |
| `recorded_at`                  | `timestamptz`       | Insert anı                    |

Append-only'dir; runtime role update/delete yapamaz. Parola, token, response body, full internal exception veya recipient email metadata'ya yazılmaz.

## 10. Cross-table Bütünlük Matrisi

| Kural                                                        | Koruma                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Farklı owner kaynağı bağlanamaz                              | Her tenant relation için composite FK                                        |
| Bir check aynı anda ikinci job'a başlayamaz                  | `check_jobs` active-state partial unique index                               |
| Bir check'in tek açık incident'ı vardır                      | `incidents(check_id) WHERE status='OPEN'` unique partial index               |
| Bir incident'ın tek açık observed segment'i vardır           | `incident_segments(incident_id) WHERE ended_at IS NULL` unique partial index |
| Bir check'in tek açık health interval'i vardır               | `open_health_intervals.check_id` PK                                          |
| Run referansı doğru owner, check ve partition satırına gider | `(owner_id,check_id,run_finished_at,run_id)` composite FK                    |
| Maintenance tam bir hedefe aittir                            | `num_nonnulls(check_id,group_id)=1` CHECK + iki composite FK                 |
| Aynı incident geçişi tekrar mail üretmez                     | Intent ve delivery unique anahtarları                                        |
| Public token rotation eski linki keser                       | Unique digest + snapshot'ı aynı transaction'da değiştirme                    |
| Stale worker current state yazamaz                           | Generation + fencing compare, locked acceptance transaction                  |
| Account kesintisi DOWN sayılmaz                              | UNKNOWN interval + rollup denominator kuralı                                 |

Foreign key'ler veri hatasını engeller fakat yetkilendirme amacıyla kullanıcıya constraint ayrıntısı döndürülmez. API bu hataları genel `not found/conflict` contract'ına map eder.

## 11. Bilinçli Olarak Şemaya Alınmayanlar

- Organization/membership/role tabloları
- Ham HTTP response body, response header dump veya TLS sertifika içeriği
- E-posta template HTML'inin her delivery'de tam kopyası; bunun yerine template version + render sonucu yalnız adapter log politikasına göre tutulur
- Redis lock/queue state'i
- Predictor model artifact binary'si
- Browser IP/user-agent geçmişi (privacy kararı olmadan)
- Ürün kotasını temsil eden sabit `50 check` constraint'i
