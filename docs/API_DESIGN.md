# API, Komut ve HTTP Sözleşmesi

**Aşama:** 4 — API, Event ve Hata Sözleşmeleri
**Durum:** Kullanıcı incelemesini bekleyen normatif tasarım
**Tarih:** 2026-10-10
**Bağlı sözleşmeler:** [`openapi-v1.yaml`](./openapi-v1.yaml), [`API_ERRORS.md`](./API_ERRORS.md), [`EVENT_CATALOG.md`](./EVENT_CATALOG.md), [`REALTIME_CONTRACT.md`](./REALTIME_CONTRACT.md)

## 1. Amaç ve Yetki Sınırı

Bu belge browser ile API, API ile domain/application katmanı ve public istemci ile public projection arasındaki ağ sözleşmesini sabitler. HTTP handler iş kuralı taşımaz; kimlik doğrulama, input doğrulama, transaction çağrısı, DTO eşleme ve hata çevirisi yapar.

Bu tur yalnız tasarımdır. Route, handler, runtime validator, auth veya domain kodu yazılmaz. Onaydan sonra ilk uygulama, sözleşme altyapısı ve yalnız ilgili aşamada gereken endpoint dilimidir; bütün endpoint'ler tek seferde sahte davranışla doldurulmaz.

## 2. Ana Kararlar

### 2.1 Kaynak yönelimli REST + açık komut endpoint'leri

- Kaynak okuma/yazma işlemleri standart HTTP yöntemlerini kullanır.
- `pause`, `resume`, `manual-run`, `publish`, `disable` ve `rotate-link` gibi durum geçişleri açık komut endpoint'leridir.
- Uzun çalışma HTTP request'i içinde bekletilmez. Manuel run `202 Accepted` ile kalıcı talep makbuzu döndürür.
- API worker tablolarını veya queue uygulama ayrıntılarını dış sözleşmeye sızdırmaz.

### 2.2 Sözleşme kaynağı

`docs/openapi-v1.yaml` dış HTTP sözleşmesinin canonical, review edilebilir kaynağıdır. Uygulama sırasında:

1. TypeScript request/response tipleri contract package içinde üretilir veya aynı şemadan türetilir.
2. Runtime request ve response doğrulaması route seviyesinde zorunludur.
3. CI OpenAPI syntax/bundle, breaking-change ve örnek conformance kontrollerini çalıştırır.
4. Handler'ın döndürdüğü response şemaya uymuyorsa test/production dışı ortamda kesin hata oluşur.

OpenAPI ile runtime şemaları iki bağımsız elle tutulan gerçek haline getirilemez. Uygulama aracı onay sonrası paket bakım durumu ve Fastify uyumu değerlendirilerek seçilir.

### 2.3 Sürümleme

- Private taban: `/api/v1`
- Public taban: `/api/public/v1`
- Health uçları versiyonsuz: `/health/live`, `/health/ready`
- v1 içinde alan eklemek, yeni event eklemek ve opsiyonel request alanı eklemek geriye uyumludur.
- Alan kaldırmak/yeniden adlandırmak, anlam değiştirmek veya enum değerini istemcinin güvenli biçimde tanımayacağı şekilde değiştirmek breaking change'dir.
- Breaking HTTP değişimi `/api/v2` gerektirir. Domain event payload'ı ayrıca `schema_version` taşır.

## 3. Protokol Kuralları

### 3.1 Medya, adlandırma ve zaman

- Normal JSON: `application/json`
- Hata: `application/problem+json`
- SSE: `text/event-stream`
- JSON alanları `snake_case` kullanır.
- Bütün anlar UTC offset'li RFC 3339 string'dir; canonical çıktı `Z` kullanır.
- Süreler alan adında birim taşır: `_ms`, `_seconds`.
- UUID'ler canonical lowercase string'dir.
- PostgreSQL `bigint` kaynaklı resource/state/generation sürümleri JavaScript hassasiyet kaybını önlemek için decimal string döner.
- Para veya floating duration yoktur. Availability/coverage oranları `0..1` arası JSON number veya veri yoksa `null` olur.

### 3.2 Header sözleşmesi

| Header            | Yön              | Kural                                                                                                                 |
| ----------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `X-Request-Id`    | request/response | Yalnız canonical UUID kabul edilir; yok/geçersizse sunucu UUIDv7 üretir ve her cevapta aynı güvenilir ID'yi döndürür. |
| `ETag`            | response         | Mutable tekil kaynakta `resource_version`dan güçlü tag: `"rv-<decimal>"`.                                             |
| `If-Match`        | request          | Mutable kaynak update/delete/komutlarında zorunlu; yoksa `428`, eskiyse `412`.                                        |
| `Idempotency-Key` | request          | Seçili create ve command endpoint'lerinde zorunlu; 8–128 printable ASCII, kullanıcı+operation scope'unda anlamlıdır.  |
| `X-CSRF-Token`    | request          | Cookie-auth ile bütün unsafe yöntemlerde zorunlu.                                                                     |
| `Retry-After`     | response         | Geçici `409 idempotency_in_progress`, `429` ve `503` cevaplarında mümkünse saniye.                                    |
| `Location`        | response         | `201` ile oluşturulan kaynağın canonical URI'si.                                                                      |

Browser'a pagination cursor, raw SQL sürümü, internal job lease veya fencing token döndürülmez.

### 3.3 CORS, cookie ve CSRF

- Production allowlist tam origin eşleşmesidir; wildcard + credentials yasaktır.
- Session cookie `site_monitor_session`; `HttpOnly`, host-only, `Path=/`, `SameSite=Lax`, production'da `Secure` olur.
- CSRF token ayrı `site_monitor_csrf` imzalı double-submit cookie ile browser'a verilir ve aynı değer unsafe request'te `X-CSRF-Token` olarak gönderilir. Bu cookie JavaScript'in header'a kopyalayabilmesi için `HttpOnly` değildir; secret/session yetkisi taşımaz.
- Unsafe request için CSRF doğrulamasına ek olarak `Origin`, yoksa `Referer` allowlist kontrolü yapılır.
- Session cookie/token response body veya loga yazılmaz.
- SSE authenticated GET'tir; state değiştirmediği için CSRF header istemez, fakat exact CORS ve cookie kurallarına tabidir.

Auth ayrıntıları Aşama 5 belgesinde threat model ile kesinleştirilecek; bu sözleşmedeki cookie/header adları değişirse OpenAPI ve karar kaydı birlikte güncellenir.

## 4. Kimlik Doğrulama ve Sahiplik Semantiği

- Authenticated endpoint'ler geçerli session gerektirir; aksi halde `401`.
- Kaynak ID'si başka kullanıcıya aitse API varlığını sızdırmamak için `404` döndürür; `403` yalnız kimliği bilinen fakat ürün politikası gereği yasak operasyonlar içindir.
- Her private application işlemi transaction-local owner context ile çalışır; DTO mapper yalnız ilgili owner satırlarını görür.
- Public endpoint private entity serialize etmez. Yalnız `public_status.snapshots` allowlist projection'ını döndürür.
- Public token yüksek entropili bearer link'tir; path/log/APM redaction zorunludur. Token hiçbir hata `instance` veya `detail` alanına kopyalanmaz.

## 5. Concurrency ve Idempotency

### 5.1 Optimistic concurrency

Mutable configuration kaynağı response'u `ETag: "rv-12"` taşır. `PATCH`, `PUT`, `DELETE` ve duruma bağlı komutlar aynı değeri `If-Match` ile ister. Sürekli değişen current-status projection aynı güçlü ETag representation'ına gömülmez; liste/dashboard öğesi `{ check, status }` veya `{ group, status }` olarak config `resource_version` ile status `state_version` eksenlerini ayrı taşır.

- Header yok: `428 precondition_required`
- Biçim bozuk: `400 invalid_precondition`
- Kaynak sürümü değişmiş: `412 resource_version_mismatch`
- Geçerli sürüm fakat domain geçişi yasak: `409 invalid_state_transition`

API başarılı mutation sonrasında güncel representation ve yeni ETag döndürür; delete `204` döner.

### 5.2 Idempotent retry

Network timeout sonrası aynı request güvenle tekrar edilebilmelidir. Aşağıdaki uçlar `Idempotency-Key` ister:

- account/register, e-posta doğrulama/parola sıfırlama başlatma ve doğrulama e-postası resend işlemleri
- check/group/maintenance/recipient/public-page create
- manual run
- public page publish ve link rotation

Anahtar aynı subject, HTTP operation ve normalized request hash'iyle tekrar gelirse önceki status/body/allowlist response header'ları yeniden oynatılır. Aynı anahtar farklı payload ile gelirse `409 idempotency_key_reused` döner. Aynı anahtarın transaction'ı hâlâ kilitliyse duplicate request yalnız kısa, bounded süre bekler; süre aşılırsa `409 idempotency_in_progress` ve `Retry-After` alır. `5xx` sonucu kalıcı başarı olarak cache edilmez; transaction sonucu belirsizse kayıt üzerinden çözülür.

Mevcut Aşama 3 şemasında HTTP idempotency receipt tablosu yoktur. Onay sonrası geçmiş migration değiştirilmeden yeni forward migration ile `infra.api_idempotency_records` eklenecektir. Asgari alanlar:

- `id`, nullable `owner_id` ve her akışta privacy-preserving `subject_digest`
- `operation`, HMAC `key_digest` ve canonical method/path/body `request_hash`
- `response_status`, allowlist `response_headers` (`Location`, `ETag`) ve bounded/sanitized `response_body`
- yalnız publish/rotation gibi secret-bearing response'lar için application-layer ciphertext ve `encryption_key_version`
- `created_at`, `expires_at`

`UNIQUE(subject_digest, operation, key_digest)` yarışmayı veritabanında tekilleştirir. Receipt, domain mutation/job enqueue ve outbox event aynı kısa transaction'da tamamlanmış haliyle yazılır; dış servis çağrısı yapılmaz. Böylece ayrıca commit edilmiş `PROCESSING`/lease state'i oluşmaz: crash transaction'ı bütünüyle geri alır, commit sonrası response kaybı tamamlanmış receipt'ten replay edilir.

Authenticated subject digest owner UUID'sinden; unauthenticated akışta flow adı + normalize edilmiş e-postadan server-side HMAC ile türetilir. Raw idempotency anahtarı, e-posta, parola veya request secret payload saklanmaz. Normal response receipt'i yalnız bounded ve sanitize edilmiş JSON taşır. Publish/rotation retry'ında aynı tek-seferlik public URL'yi güvenle yeniden oynatabilmek için ham token plaintext olarak değil, uygulama katmanında dedicated key ile şifrelenmiş response blob'unda tutulur; DB bu anahtara sahip olmaz, log/metric'e ciphertext dahi yazılmaz. Varsayılan receipt ve ciphertext retention 24 saattir; sonrasında aynı key yeni işlem garantisi vermez ve istemci güncel kaynağı okuyup gerekirse yeniden rotation ister.

## 6. Pagination, Filtre ve Sıralama

- Liste response'u `{ data: [], page: { next_cursor, has_more } }` biçimindedir.
- Cursor opaque, imzalı/base64url token'dır; sort/filter/snapshot bağlamını içerir. İstemci cursor üretmez veya ayrıştırmaz.
- Varsayılan `limit=50`, maksimum `100`; bu bir ürün check kotası değil, tek HTTP response sınırıdır.
- Stabil sıralama her zaman benzersiz tie-breaker taşır (`created_at DESC, id DESC` gibi).
- Cursor ile birlikte sort/filter değişirse `400 invalid_cursor`.
- Page-number/offset yüksek hacimli history ve incident listelerinde kullanılmaz.
- Liste filtreleri allowlist'tir; serbest SQL benzeri filter/sort kabul edilmez.

Cursor payload'ı en az `version`, route/query fingerprint, normalized sort, son anahtar tuple'ı, dashboard için `snapshot_at`, `issued_at` ve `expires_at` taşır. PII veya secret taşımaz; base64url yalnız encoding olduğu için bütün payload server-side HMAC ile imzalanır. Doğrulamada constant-time signature karşılaştırması yapılır; active + previous signing key ile sınırlı key rotation desteklenir. Süresi dolan veya farklı filtreyle kullanılan cursor `400 invalid_cursor` olur.

Dashboard snapshot sayfalanır. Cursor ilk sayfadaki `snapshot_at` değerine bağlanır; sonraki sayfalar aynı mantıksal kesiti okur. Deployment quota sabit kaynak kodu limiti değildir, fakat response boyutu ve rate limit ile korunur.

## 7. Endpoint Kataloğu

### 7.1 Health

| Yöntem ve yol       | Auth | Başarı    | Amaç                                                     |
| ------------------- | ---- | --------- | -------------------------------------------------------- |
| `GET /health/live`  | Yok  | `200`     | Process yaşıyor; dependency kontrol etmez.               |
| `GET /health/ready` | Yok  | `200/503` | DB schema compatibility ve zorunlu dependency readiness. |

Health response'ları problem-details kullanmaz; orchestrator için küçük ve sabit `ServiceHealth` döner.

### 7.2 Auth ve kullanıcı

| Yöntem ve yol                                   | Başarı | Not                                                           |
| ----------------------------------------------- | ------ | ------------------------------------------------------------- |
| `POST /api/v1/auth/register`                    | `202`  | Email varlığını sızdırmayan generic sonuç; idempotent.        |
| `POST /api/v1/auth/login`                       | `200`  | Session cookie kurar; hata daima generic credential problemi. |
| `POST /api/v1/auth/logout`                      | `204`  | Geçerli session'ı iptal eder; tekrar güvenlidir.              |
| `GET /api/v1/auth/session`                      | `200`  | User/session özeti ve CSRF bootstrap bilgisi.                 |
| `POST /api/v1/auth/email-verifications`         | `202`  | Yeni mail talebi; enumeration-safe.                           |
| `POST /api/v1/auth/email-verifications/confirm` | `204`  | Tek kullanımlık token consume.                                |
| `POST /api/v1/auth/password-resets`             | `202`  | Enumeration-safe reset talebi.                                |
| `POST /api/v1/auth/password-resets/confirm`     | `204`  | Token + yeni parola; bütün eski session'ları iptal eder.      |
| `GET /api/v1/me`                                | `200`  | Private kullanıcı profili.                                    |
| `PATCH /api/v1/me`                              | `200`  | `If-Match`; yalnız allowlist profil alanları.                 |

### 7.3 Dashboard, check ve group

| Yöntem ve yol                              | Başarı | Not                                                                                                       |
| ------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/dashboard`                    | `200`  | Cursor'lı current-state snapshot; group summary ve check status card'ları.                                |
| `GET /api/v1/checks`                       | `200`  | Filter: group, execution, health, freshness; cursor.                                                      |
| `POST /api/v1/checks`                      | `201`  | `Idempotency-Key`; Location + ETag.                                                                       |
| `GET /api/v1/checks/{check_id}`            | `200`  | Private check configuration; canlı status dashboard/list projection'ındadır.                              |
| `PATCH /api/v1/checks/{check_id}`          | `200`  | `If-Match`; metadata/probe/schedule farkları ayrı application command'e çevrilir.                         |
| `DELETE /api/v1/checks/{check_id}`         | `204`  | `If-Match`; soft-delete domain akışı.                                                                     |
| `POST /api/v1/checks/{check_id}/pause`     | `200`  | `If-Match`; güncel check döner.                                                                           |
| `POST /api/v1/checks/{check_id}/resume`    | `200`  | `If-Match`; mümkün olan ilk run planlanır.                                                                |
| `POST /api/v1/checks/{check_id}/runs`      | `202`  | `If-Match` + `Idempotency-Key`; `ENQUEUED` veya `COALESCED`, ACTIVE/PAUSED moda göre stateful/diagnostic. |
| `GET /api/v1/checks/{check_id}/runs`       | `200`  | Cursor'lı diagnostic run geçmişi; body yok.                                                               |
| `GET /api/v1/checks/{check_id}/history`    | `200`  | `period` enum day/week/month; response-time, availability, coverage ve no-data.                           |
| `GET /api/v1/checks/{check_id}/prediction` | `200`  | Predictor yoksa hata değil `UNAVAILABLE/STALE/INSUFFICIENT_DATA`.                                         |
| `GET /api/v1/groups`                       | `200`  | Cursor'lı group listesi ve türetilmiş health.                                                             |
| `POST /api/v1/groups`                      | `201`  | `Idempotency-Key`; ETag.                                                                                  |
| `GET /api/v1/groups/{group_id}`            | `200`  | Group configuration; türetilmiş status dashboard/list projection'ındadır.                                 |
| `PATCH /api/v1/groups/{group_id}`          | `200`  | `If-Match`.                                                                                               |
| `DELETE /api/v1/groups/{group_id}`         | `204`  | `If-Match`; check'ler ungrouped olur.                                                                     |

`PATCH /api/v1/checks/{check_id}` allowlist alanları: `name`, `url`, `group_id`, `interval_seconds`, `timeout_ms`, `expected_status_code`, `expected_body_substring`. Alan eksikse değişmez; nullable alanı temizlemek için açık `null` gerekir. `execution_state` PATCH ile değişmez; pause/resume komutu kullanılır.

### 7.4 Incident ve history

| Yöntem ve yol                         | Başarı | Not                                              |
| ------------------------------------- | ------ | ------------------------------------------------ |
| `GET /api/v1/incidents`               | `200`  | Filter: check/group/status/time range; cursor.   |
| `GET /api/v1/incidents/{incident_id}` | `200`  | Segmentler ve gözlemlenen süre; data-gap ayrımı. |

Incident kullanıcı tarafından normal akışta oluşturulmaz/kapatılmaz. İlk sürümde administrative close endpoint'i yoktur; gerekirse yeni audit'li ürün kararıdır.

### 7.5 Maintenance

| Yöntem ve yol                                    | Başarı | Not                                                      |
| ------------------------------------------------ | ------ | -------------------------------------------------------- |
| `GET /api/v1/maintenance-windows`                | `200`  | check/group/state/time filtreleri; cursor.               |
| `POST /api/v1/maintenance-windows`               | `201`  | Tam olarak check veya group hedefi; idempotent.          |
| `GET /api/v1/maintenance-windows/{window_id}`    | `200`  | Half-open UTC aralık.                                    |
| `PATCH /api/v1/maintenance-windows/{window_id}`  | `200`  | `If-Match`; aktif pencere edge-case'leri domain command. |
| `DELETE /api/v1/maintenance-windows/{window_id}` | `204`  | `If-Match`; fiziksel delete yerine cancel.               |

### 7.6 Notification ayarları

| Yöntem ve yol                                                      | Başarı | Not                                                          |
| ------------------------------------------------------------------ | ------ | ------------------------------------------------------------ |
| `GET /api/v1/notification-recipients`                              | `200`  | Private adresler yalnız owner'a; cursor'lı.                  |
| `POST /api/v1/notification-recipients`                             | `201`  | Verification mail niyeti oluşturur; idempotent.              |
| `DELETE /api/v1/notification-recipients/{recipient_id}`            | `204`  | `If-Match`.                                                  |
| `POST /api/v1/notification-recipients/{recipient_id}/verification` | `202`  | Verification mail resend; rate-limited.                      |
| `POST /api/v1/notification-recipient-verifications/confirm`        | `204`  | Token consume; session gerekmez.                             |
| `GET /api/v1/notification-policies/default`                        | `200`  | Kullanıcı varsayılan politikası.                             |
| `PUT /api/v1/notification-policies/default`                        | `200`  | `If-Match`; tam replacement.                                 |
| `GET /api/v1/groups/{group_id}/notification-policy`                | `200`  | `INHERIT/ACTIVE/DISABLED` çözümüyle.                         |
| `PUT /api/v1/groups/{group_id}/notification-policy`                | `200`  | `If-Match`; recipient ID listesi aynı owner/verified olmalı. |

Hesap oluşturma transaction'ı default policy satırını `DISABLED`, grup oluşturma transaction'ı group policy satırını `INHERIT` olarak oluşturur. Böylece iki `PUT` endpoint'i de sentetik “olmayan kaynak” sürümü yerine gerçek `resource_version`/ETag ile çalışır. Default policy `INHERIT` olamaz. `ACTIVE` modunda `notify_down` ve `notify_recovery` boolean; `INHERIT`/`DISABLED` modunda null ve recipient listesi boştur.

### 7.7 Public page yönetimi ve public okuma

| Yöntem ve yol                                           | Başarı | Not                                                                                 |
| ------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `GET /api/v1/public-pages`                              | `200`  | Cursor'lı private config listesi.                                                   |
| `POST /api/v1/public-pages`                             | `201`  | Draft oluşturur; idempotent.                                                        |
| `GET /api/v1/public-pages/{page_id}`                    | `200`  | Private config + components.                                                        |
| `PATCH /api/v1/public-pages/{page_id}`                  | `200`  | `If-Match`; başlık/açıklama.                                                        |
| `PUT /api/v1/public-pages/{page_id}/components`         | `200`  | `If-Match`; sıralı allowlist'in atomik replacement'ı.                               |
| `POST /api/v1/public-pages/{page_id}/publish`           | `200`  | `If-Match` + idempotency; raw token yalnız bu/rotation response'unda bir kez döner. |
| `POST /api/v1/public-pages/{page_id}/disable`           | `200`  | `If-Match`; snapshot/link hemen geçersiz.                                           |
| `POST /api/v1/public-pages/{page_id}/rotate-link`       | `200`  | `If-Match` + idempotency; eski token aynı transaction'da geçersiz.                  |
| `DELETE /api/v1/public-pages/{page_id}`                 | `204`  | `If-Match`; public erişimi atomik kapatır.                                          |
| `GET /api/public/v1/status-pages/{public_token}`        | `200`  | Auth yok; yalnız public snapshot.                                                   |
| `GET /api/public/v1/status-pages/{public_token}/events` | SSE    | Auth yok; yalnız aynı snapshot allowlist'inden event.                               |

Public yönetim response'u token digest döndürmez. Ham token kaybedilirse okunamaz; rotation gerekir.

Component allowlist'i DB modeliyle bire bir `show_url`, `show_response_time` ve `show_incident_history` izinlerini taşır. İzin kapalıysa public JSON alanı `null` yapılmaz, tamamen omit edilir; böylece “değer yok” ile “yayın izni yok” ayrılır. Maintenance-active bilgisi yayınlanan component'in durum semantiğinin parçasıdır. Public DTO private check/group ID'si, owner ID'si veya target ayrıntısı taşımaz; yalnız page-scoped public component ID kullanır.

Group component'inde tekil URL veya response time olmadığı için `show_url` ve `show_response_time` false olmak zorundadır. `display_name=null`, source adının snapshot üretilirken public kopyasının alınması demektir; sonradan private ad değişince public snapshot yeniden üretilir. Public projection private DTO'yu son anda filtrelemez, allowlist şemasını baştan üretir.

### 7.8 Canlı olaylar

| Yöntem ve yol                                           | Auth         | Sözleşme                                                            |
| ------------------------------------------------------- | ------------ | ------------------------------------------------------------------- |
| `GET /api/v1/events`                                    | Session      | Owner-scoped SSE; [`REALTIME_CONTRACT.md`](./REALTIME_CONTRACT.md). |
| `GET /api/public/v1/status-pages/{public_token}/events` | Public token | Page-scoped public SSE.                                             |

## 8. Temel DTO Kuralları

### 8.1 Check configuration

```json
{
  "id": "uuid",
  "name": "Primary website",
  "url": "https://example.com/health",
  "group_id": null,
  "execution_state": "ACTIVE",
  "interval_seconds": 30,
  "timeout_ms": 5000,
  "expected_status_code": 200,
  "expected_body_substring": null,
  "resource_version": "3",
  "created_at": "2026-10-10T00:00:00.000Z",
  "updated_at": "2026-10-10T00:05:00.000Z"
}
```

`url` ve expected substring yalnız private response'tadır. Hata response'u rejected value'yu tekrar etmez.

### 8.2 Current status card

Status eksenleri bir enumda birleştirilmez:

```json
{
  "check_id": "uuid",
  "health_state": "DOWN",
  "execution_state": "ACTIVE",
  "freshness_state": "FRESH",
  "maintenance": { "active": false, "until": null },
  "last_response_time_ms": 842,
  "last_checked_at": "2026-10-10T00:05:00.000Z",
  "current_incident": {
    "id": "uuid",
    "started_at": "2026-10-10T00:04:00.000Z",
    "confirmed_at": "2026-10-10T00:04:30.000Z",
    "observation_mode": "OBSERVED",
    "observed_duration_ms": "60000"
  },
  "state_version": "18"
}
```

`current_incident` yalnız doğrulanmış açık incident için doludur. `SUSPECT` current downtime değildir.

### 8.3 History

`period` server saatine göre değil request anındaki UTC `to` değerine göre belirlenir:

| Period  | Aralık         | Resolution                          |
| ------- | -------------- | ----------------------------------- |
| `day`   | Son 24 saat    | minute                              |
| `week`  | Son 7×24 saat  | minute veya bounded adaptive minute |
| `month` | Son 30×24 saat | hour                                |

Response; `from`, `to`, `resolution`, `availability_ratio`, `coverage_ratio`, `observed_up_ms`, `observed_down_ms`, `unknown_ms` ve sıralı bucket'lar taşır. No-data bucket `response_time_ms=null`, `classification=UNKNOWN` olur; DOWN olarak doldurulmaz.

### 8.4 Prediction

Prediction response daima ana health'ten ayrı tutulur:

- `status`: `AVAILABLE`, `INSUFFICIENT_DATA`, `STALE`, `UNAVAILABLE`
- `risk_level`: `LOW`, `MEDIUM`, `HIGH` veya null
- `risk_score`, `computed_at`, `valid_until`, `horizon_seconds`
- `model`: name/version
- bounded, allowlist `reason_codes`

Prediction endpoint hata verdiğinde dashboard temel status request'i başarısız olmaz.

## 9. Cache ve Koşullu Okuma

- Private mutation/list response'ları varsayılan `Cache-Control: no-store`.
- Private immutable/history response'ları kullanıcı cache'inde kısa süreli tutulabilir fakat shared cache yasaktır: `private, max-age=<bounded>`.
- Public snapshot response'u `ETag` ve page revision taşır; `Cache-Control: public, max-age=15, stale-while-revalidate=30` üst sınırıyla deployment tarafından daraltılabilir.
- Disable/rotation eski token'ı DB fonksiyonunda hemen geçersiz kılar; CDN kullanılırsa token revision cache key'e dahil edilir ve purge mekanizması gerekir.
- `304 Not Modified` body taşımaz; auth/authorization yine uygulanır.

## 10. Rate Limit ve Quota

Rate limit deployment-configurable ve kullanıcı/IP/operation scope'ludur. Örnek başlangıç bütçeleri uygulama aşamasında load test ile doğrulanır:

- auth giriş/reset: sıkı IP + subject digest limiti
- manual run: owner ve check bazlı burst limiti
- mutation: owner bazlı
- private read: session/owner bazlı
- public snapshot/SSE: token + IP bazlı, private bütçeden ayrı

`429` problem response ve `Retry-After` döner. Quota (`check` sayısı gibi) rate limit'ten ayrıdır; kaynak kodda sabit 50 sınırı yoktur. Quota aşımı `409 quota_exceeded` veya ürün sözleşmesi sabitlenirse `422` değil, merkezi problem koduyla döner.

## 11. Transaction ve Response Sınırı

Handler sırası:

1. Correlation/request ID üret/doğrula.
2. Content type/body size/rate limit kontrolü.
3. Session + CSRF + input validation.
4. Application command/query çağrısı.
5. Private command için tek DB transaction ve owner context.
6. Domain sonucu explicit DTO'ya map et.
7. Response schema doğrula ve structured audit/log üret.

Transaction commit edilmeden başarı response'u yazılmaz. Client bağlantısı koptu diye transaction otomatik geri alınmış varsayılmaz; idempotency receipt sonucu çözer. HTTP status domain gerçeğinin yerine geçmez.

## 12. Boyut ve Timeout Sınırları

- JSON request body başlangıç üst sınırı: 64 KiB; endpoint özel daha dar olabilir.
- Expected body substring UTF-8 byte sınırı application validation'da uygulanır.
- Liste response'u limit/cursor ile bounded'dır.
- Public snapshot payload'ı bounded ve DB'de şema sürümlüdür.
- API request deadline, DB statement timeout'tan biraz uzun; proxy deadline API'den biraz uzun seçilir.
- Manual probe, mail ve predictor çağrısı API request'i içinde yapılmaz.

Kesin sayısal timeout/byte limitleri ilgili uygulama aşamasında threat/load testiyle kaydedilir; sessiz framework default'una bırakılmaz.

## 13. Güvenlik ve Veri Minimizasyonu

- Mass-assignment yasaktır; her request DTO explicit allowlist'tir.
- URL user-info reddedilir; URL fragment kalıcı config'e alınmaz.
- Password/token/public-token/expected substring ve hassas URL query loglarda redacted olur.
- Response body, SMTP detayları, SQL hata ayrıntısı veya stack dış response'a çıkmaz.
- Public DTO private DTO'dan alan silerek üretilmez; ayrı schema ve mapper kullanır.
- CSV/export, bulk admin, arbitrary query ve GraphQL ilk v1 sözleşmesinde yoktur.

## 14. Test ve Kabul Kapısı

Aşama 4 uygulamasının tamamlanması için:

- OpenAPI syntax ve reference çözümü CI'da geçmeli.
- Her operationId benzersiz olmalı; auth, CSRF, idempotency ve If-Match gereksinimleri contract testinde doğrulanmalı.
- Problem response bütün hata yollarında aynı şemaya uymalı.
- User A'nın User B kaynağı için `404` aldığı negatif testler bulunmalı.
- Duplicate idempotency key aynı sonucu, farklı payload conflict'i üretmeli.
- Eski ETag `412`, geçersiz state `409`, validation `422` olmalı.
- History no-data'yı DOWN'a dönüştürmemeli.
- Public response/SSE allowlist dışı alan sızdırmamalı.
- İki authenticated client SSE + REST reconciliation ile aynı state'e ulaşmalı.
- OpenAPI örnekleri handler response'larıyla conformance testinden geçmeli.

## 15. Bilinçli Tavizler ve Açık İşler

- Organization/workspace scope'u yoktur; bütün private route'lar current user owner scope'undadır.
- GraphQL/WebSocket eklenmez; REST + SSE yeterlidir.
- Generic async operation resource ilk sürümde yoktur; manual run özel receipt döndürür.
- Public custom domain, webhook ve API token auth kapsam dışıdır.
- Idempotency tablosu yeni migration gerektirir; onaydan önce migration yazılmaz.
- Global, kayıpsız SSE event replay sözü verilmez. Kaynak gerçek REST snapshot'tır; SSE hızlandırma ve invalidation kanalıdır.
