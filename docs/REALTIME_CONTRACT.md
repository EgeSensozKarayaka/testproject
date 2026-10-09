# Gerçek Zamanlı SSE Sözleşmesi

**Aşama:** 4 — API, Event ve Hata Sözleşmeleri

**Durum:** Onaylandı; payload type allowlist'i uygulandı, SSE runtime Aşama 13 kapsamındadır

**Tarih:** 2026-10-10

**Bağlı belgeler:** [`API_DESIGN.md`](./API_DESIGN.md), [`EVENT_CATALOG.md`](./EVENT_CATALOG.md), [`openapi-v1.yaml`](./openapi-v1.yaml)

## 1. Amaç ve Garanti

SSE, dashboard ve public durum sayfasını sayfa yenilemeden hızla güncelleyen bir **invalidation/projection bildirim kanalıdır**. Source of truth değildir, kalıcı replay garantisi vermez ve REST snapshot'ın yerini almaz.

Garanti modeli:

- Yetkili istemci doğru owner veya public-page kapsamındaki değişikliği normal koşulda saniyeler içinde öğrenir.
- Event kaybolabilir, tekrarlanabilir, coalesce edilebilir veya sırası değişebilir.
- İstemci ilk bağlantıda, reconnect'te, `resync.required` sonrasında ve periyodik olarak REST snapshot ile uzlaşır.
- Event payload'ından iş state'i yeniden inşa edilmez. `resource.version` yalnız eski olayı elemek ve yeniden okuma kararını vermek içindir.

WebSocket kullanılmaz; ürünün istemciden sunucuya sürekli çift yönlü mesaja ihtiyacı yoktur. Kullanıcı komutları normal HTTP endpoint'lerine gider.

## 2. Endpoint'ler ve Yetkilendirme

| Endpoint                                                | Yetki                  | Kapsam                                                     |
| ------------------------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| `GET /api/v1/events`                                    | Geçerli session cookie | Yalnız session owner'ına ait private projection event'leri |
| `GET /api/public/v1/status-pages/{public_token}/events` | Public token           | Yalnız bu sayfanın yayınlanmış allowlist projection'ı      |

Request:

```http
GET /api/v1/events HTTP/1.1
Accept: text/event-stream
Cache-Control: no-cache
Cookie: site_monitor_session=...
Last-Event-ID: 0192f8fe-ec53-71ac-bad7-70f299a607a4
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-store, no-transform
Connection: keep-alive
X-Accel-Buffering: no
X-Request-Id: 0192f82c-17f8-782b-bf7a-d31fd8bc499a
```

- Private stream cookie-auth kullanır; GET olduğu için CSRF header istemez. Exact-origin CORS ve session kontrolleri uygulanır.
- Public token path'te taşınır fakat access log, APM transaction name, metric label ve problem `instance` içinde `{redacted}` olur.
- Public token rotate/disable edildiğinde mevcut stream kapatılır. İstemci sonraki REST/SSE talebinde generic `404 public_page_not_found` alır.
- `Accept: text/event-stream` yoksa `406 not_acceptable`; media type doğru fakat yetki yoksa normal problem-details cevabı bağlantı açılmadan döner.

## 3. SSE Frame Formatı

```text
id: 0192f902-5e39-7d40-a565-8d881fd07a67
event: check.status_changed
data: {"event_id":"0192f902-5e39-7d40-a565-8d881fd07a67","event_type":"check.status_changed","schema_version":1,"occurred_at":"2026-10-10T03:24:51.104Z","resource":{"type":"check_status","id":"0192f7c8-548e-7c43-9f79-93cbf7eaf831","version":"19"},"payload":{"health_state":"DOWN","freshness_state":"FRESH"}}

```

Her data event'i:

```json
{
  "event_id": "0192f902-5e39-7d40-a565-8d881fd07a67",
  "event_type": "check.status_changed",
  "schema_version": 1,
  "occurred_at": "2026-10-10T03:24:51.104Z",
  "resource": {
    "type": "check",
    "id": "0192f7c8-548e-7c43-9f79-93cbf7eaf831",
    "version": "19"
  },
  "payload": {}
}
```

- SSE `id` ile JSON `event_id` aynıdır ve opaque UUID string'dir.
- SSE `event` ile JSON `event_type` aynıdır.
- `resource.version` decimal string'dir ve yalnız aynı `resource.type + resource.id` ekseninde karşılaştırılır. Check configuration `check/resource_version`, canlı check durumu `check_status/state_version` kullanır; projection version yoksa `null` olabilir.
- JSON tek satır UTF-8 serialize edilir; her frame boş satırla biter.
- Server yaklaşık her 15 saniyede yorum heartbeat'i yollar: `: heartbeat 2026-10-10T03:25:00Z`.
- Browser heartbeat'i application event saymaz. 45 saniye veri/heartbeat yoksa bağlantıyı stale kabul edip jitter ile reconnect eder.

## 4. Bağlantı ve Snapshot Algoritması

Race-free client başlangıcı:

1. SSE bağlantısını aç.
2. `stream.ready` gelene kadar application event'lerini küçük client buffer'ında tut.
3. Private için `GET /api/v1/dashboard`, public için status-page REST snapshot'ını al.
4. Snapshot'ın her kaynak/projection version'ını store'a yaz.
5. Buffer'daki yalnız daha yeni resource version'lı event'leri uygula; eşit/eski event'i at.
6. Normal event tüketimine geç.
7. Görünür sayfada en geç her 60 saniyede ve browser yeniden foreground olduğunda REST snapshot ile uzlaş.

SSE bağlantısından önce snapshot alınması aradaki değişikliği kaçırabilir; bu nedenle sıra özellikle **stream → ready → snapshot → buffered events** biçimindedir. Snapshot başarısızsa stream açık kalabilir fakat UI eski veriyi doğru işaretler ve bounded backoff ile REST'i tekrar dener.

Reconnect:

- Browser `Last-Event-ID` gönderebilir; bu yalnız tanılama ve mümkünse kısa in-memory gap tespiti içindir.
- Sunucu kalıcı replay sözü vermez. Yeni bağlantı `stream.ready` içinde `replay_supported:false` gönderir.
- Her reconnect REST uzlaştırması gerektirir; `Last-Event-ID` bunu kaldırmaz.
- Backoff: 1 saniyeden başlayan exponential + full jitter, en fazla 30 saniye. Auth/public `404/401` sürekli retry edilmez.

## 5. Sistem Event'leri

### 5.1 `stream.ready`

Bağlantı owner/page kapsamına bağlandıktan sonra ilk event'tir.

```json
{
  "event_id": "0192f909-eed8-7934-9ad6-89dc20dafdf5",
  "event_type": "stream.ready",
  "schema_version": 1,
  "occurred_at": "2026-10-10T03:26:00.000Z",
  "resource": { "type": "stream", "id": "private", "version": null },
  "payload": {
    "scope": "PRIVATE",
    "replay_supported": false,
    "heartbeat_seconds": 15,
    "snapshot_reconcile_seconds": 60
  }
}
```

Public stream'de `resource.id` page ID veya token olmaz; opaque `public` değeridir ve `scope:"PUBLIC"` döner.

### 5.2 `resync.required`

Server event boşluğu, local subscriber restart'ı, overflow veya projection belirsizliği tespit ederse gönderir ve bağlantıyı kapatabilir.

```json
{
  "event_id": "0192f90d-a995-7fa9-80e4-5f00a1ea951d",
  "event_type": "resync.required",
  "schema_version": 1,
  "occurred_at": "2026-10-10T03:27:00.000Z",
  "resource": { "type": "stream", "id": "private", "version": null },
  "payload": { "reason": "BUFFER_OVERFLOW" }
}
```

`reason`: `BUFFER_OVERFLOW`, `SUBSCRIBER_RESTARTED`, `VERSION_GAP`, `PROJECTION_INVALIDATED`. İstemci derhal REST snapshot alır; reason son kullanıcıya teknik hata olarak gösterilmez.

Heartbeat yorumdur; JSON `stream.heartbeat` event'i yoktur. Böylece frontend state gereksiz render olmaz.

## 6. Private Event Kataloğu

Private payload minimaldir; hassas yapılandırmayı taşımaz. UI event geldiğinde ilgili query'yi invalidate eder veya yeni güvenli status alanını iyimser olmayan biçimde uygular.

| Event                  | Resource                | Payload v1                                                                                                                                                       |
| ---------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check.changed`        | `check`                 | `changed_fields[]`                                                                                                                                               |
| `check.status_changed` | `check_status`          | `health_state`, `freshness_state`, `execution_state`, `maintenance_active`, `last_response_time_ms` nullable, `last_checked_at` nullable, `incident_id` nullable |
| `group.changed`        | `group`                 | `changed_fields[]`                                                                                                                                               |
| `group.status_changed` | `group_status`          | `health_state`, `counts` (`up`, `suspect`, `down`, `unknown`, `paused`); version `null`, query invalidation zorunlu                                              |
| `incident.changed`     | `incident`              | `check_id`, `status`, `started_at`, `ended_at` nullable                                                                                                          |
| `maintenance.changed`  | `maintenance_window`    | `target_type`, `target_id`, `state`, `starts_at`, `ends_at`                                                                                                      |
| `notification.changed` | `notification_resource` | `kind` (`RECIPIENT`/`POLICY`/`DELIVERY`), `state`                                                                                                                |
| `public_page.changed`  | `public_status_page`    | `state`, `page_revision` nullable                                                                                                                                |
| `prediction.changed`   | `prediction_score`      | `check_id`, `status`, `risk_level` nullable, `valid_until` nullable                                                                                              |

`changed_fields` allowlist alan adlarıdır, eski/yeni değer içermez. Notification event'i e-posta veya provider ayrıntısı taşımaz. Check event'i target URL/body expectation taşımaz.

## 7. Public Event Kataloğu

Public stream yalnız tek application event türü yayınlar:

| Event                 | Resource      | Payload v1                                           |
| --------------------- | ------------- | ---------------------------------------------------- |
| `status_page.updated` | `status_page` | `page_revision`, `changed_component_ids[]`, `reason` |

`reason`: `STATUS`, `INCIDENT`, `MAINTENANCE`, `CONFIGURATION`, `PUBLICATION`. `changed_component_ids` yalnız sayfanın public component ID'leridir; private check/group ID, URL, owner ID veya incident ID içermez.

Public istemci event sonrası conditional `GET` yapar. Payload'da status ayrıntısı taşımamak, REST ve SSE'de farklı allowlist uygulama riskini kaldırır. Public snapshot `ETag` ile değişmediyse `304` dönebilir.

## 8. Backpressure ve Kaynak Sınırları

- Her connection için uygulama buffer'ı en fazla 256 event veya 1 MiB'dır; önce dolan sınır geçerlidir.
- Aynı resource'a ait bekleyen `*.changed` event'leri en yüksek version korunarak coalesce edilebilir.
- Buffer sınırı aşılırsa server `resync.required(BUFFER_OVERFLOW)` göndermeyi dener ve bağlantıyı kapatır; sınırsız RAM kullanmaz.
- Yazma backpressure'ı sırasında connection ana event consumer/outbox transaction'ını bloke etmez.
- Private connection sayısı kullanıcı/session/IP bazında, public connection sayısı token/IP bazında konfigüre limitlidir. Varsayılanlar deployment capacity testinde belirlenir; ürün check sayısı limiti değildir.
- Aynı browser sekmesinde tek stream paylaşılır; component başına bağlantı açılmaz.
- Proxy buffering kapatılır, idle timeout heartbeat'in en az üç katıdır ve response compression SSE için kapalıdır.

## 9. Replica ve Dağıtım Davranışı

- Her API replica PostgreSQL notification sinyalini dinler ve yalnız kendi bağlı client'larına owner/page-filtered projection üretir.
- `REALTIME` outbox consumer'ı public etkilenen sayfaların snapshot'ını owner-scoped transaction'da yeniden üretir; dispatch completion ve page ID + revision taşıyan `pg_notify` çağrısı aynı transaction'dadır. PostgreSQL sinyali yalnız commit sonrasında teslim eder. Public SSE hiçbir zaman REST snapshot'tan ileride bir revision ilan etmez.
- Private state zaten current projection tablolarında kalıcıdır; REALTIME dispatch completion ile küçük owner/resource/version `pg_notify` çağrısı aynı transaction'dadır ve replica yetkili DTO'yu source of truth'tan okur.
- Notification kaçması güvenlik veya doğruluk kaybı değildir; periyodik REST reconciliation state'i düzeltir.
- Rolling deploy/restart bağlantıyı kesebilir; istemci normal reconnect algoritmasını uygular.
- Subscriber'ın son gördüğü event DB checkpoint'i kaynak state'in parçası değildir. Persistent outbox consumer realtime invalidation üretir; client replay store'u kurulmaz.
- Schema version desteklenmiyorsa server bilinmeyen payload'ı public/private stream'e aktarmak yerine `resync.required` üretir ve metrik/alarm verir.

## 10. Güvenlik

- Owner filtering event ID lookup sonrasında değil, projection oluşturulmadan önce ve DB owner context'i içinde yapılır.
- Public projection aynı allowlist query/fonksiyonunu REST ile paylaşır; ayrı serbest serializer yoktur.
- Stream cache'lenmez; CDN shared cache yasaktır.
- CORS exact allowlist, `Vary: Origin` ve credentials kurallarına uyar.
- Token/session URL, data, comment, event ID ve diagnostic reason içinde bulunmaz.
- Event ID tahmin edilebilir yetki anahtarı değildir; başka bir owner'ın `Last-Event-ID` değeri veri erişimi sağlamaz.
- Public SSE abuse limitleri `429` ile bağlantı açılmadan uygulanır; açık stream üzerinden problem JSON yazılmaz.

## 11. Polling Fallback

SSE desteklenmiyor veya kurumsal proxy tarafından sürekli kesiliyorsa istemci:

- dashboard/public snapshot'ı görünür sekmede 30 saniye + jitter ile conditional GET eder;
- sekme background olduğunda frekansı azaltır veya durdurur;
- foreground olduğunda hemen uzlaşır;
- `ETag`/`304` ile bandwidth'i sınırlar;
- polling başarısızlığını sitenin DOWN olmasıyla karıştırmaz; UI veri freshness'ini ayrı gösterir.

## 12. Doğrulama Kapısı

- İki bağımsız browser client aynı owner değişikliğini yenilemeden görür.
- Başka owner'ın hiçbir private event'i event type, timing veya ID düzeyinde sızmaz.
- Public stream yalnız yayınlanan component değişikliğini bildirir ve private ID/URL içermez.
- Stream açılışı ile snapshot arasındaki race buffered-version algoritmasıyla kayıp üretmez.
- Tekrarlı, sıra dışı ve eski event deterministik biçimde göz ardı edilir veya query invalidate eder.
- API replica restart, connection kopması ve `Last-Event-ID` yokluğu REST snapshot ile iyileşir.
- Yavaş client buffer sınırında ana consumer'ı etkilemeden resync edilir.
- 15 saniyelik heartbeat proxy bağlantısını canlı tutar; 45 saniyelik sessizlik reconnect üretir.
- Token rotation/disable mevcut public stream'i sonlandırır ve eski token tekrar bağlanamaz.
- Predictor kapalıyken diğer event türleri ve stream sağlığı etkilenmez.
