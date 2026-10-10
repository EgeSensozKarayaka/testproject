# Canlı Güncelleme Altyapısı Mimarisi

**Aşama:** 13 — Canlı Güncelleme Altyapısı

**Durum:** Nihai mimari; Dilim 1 relay çekirdeği uygulandı ve doğrulandı

**Tarih:** 2026-10-10 19:35 +06:00

**Kapsam:** FR-DASH-004–005, FR-PUBLIC-004–005, NFR-PERF-002, AC-013–014, AC-070–074

**Bağlı belgeler:** [`REALTIME_CONTRACT.md`](./REALTIME_CONTRACT.md), [`EVENT_CATALOG.md`](./EVENT_CATALOG.md), [`API_DESIGN.md`](./API_DESIGN.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## 1. Amaç ve Sonuç

Bu aşama, private yönetim ekranlarının değişiklikleri sayfa yenilemeden görmesini sağlayan canlı güncelleme hattını kurar. SSE hızlı bir invalidation kanalıdır; kalıcı state, olay replay deposu veya REST'in alternatifi değildir.

Nihai yaklaşım:

- domain mutation ve event kaydı aynı PostgreSQL transaction'ında kalır;
- ayrı `realtime-worker`, `REALTIME` outbox dispatch'lerini lease/fencing ile tüketir;
- worker yalnız küçük ve hassas veri içermeyen bir wake-up envelope'unu `pg_notify` ile yayınlar;
- her API replica aynı PostgreSQL kanalını dinler ve yalnız kendi bağlı istemcilerine owner/page kapsamlı projection gönderir;
- istemci stream'i snapshot'tan önce açar, gelen invalidation'ları buffer'lar ve REST ile yakınsar;
- bağlantı, worker veya notification sinyali kaybı yanlış state üretmez; en fazla canlılık gecikir;
- bounded queue, coalescing, admission limitleri ve polling fallback ile bir yavaş istemci veya bozulan canlı kanal ana monitoring sistemini yavaşlatmaz.

Bu bir mikroservis ayrıştırması değildir. `realtime-worker` ayrı public API'si ve ayrı veri sahipliği olmayan, aynı Node.js monorepo/domain içindeki bir deployment process'idir. Ayrı process seçimi yalnız outbox tüketim yetkisini API'den ayırmak ve arızayı izole etmek içindir.

## 2. Kapsam Sınırı

### 2.1 Aşama 13 içinde

- private `GET /api/v1/events` SSE runtime'ı;
- `REALTIME` outbox claim/complete/dead-letter sınırı ve güvenli aktivasyon;
- ayrı realtime relay process'i ve her API replica için dedicated PostgreSQL listener;
- owner bazlı in-memory subscriber hub ve private projection mapper;
- heartbeat, reconnect, snapshot reconciliation ve polling fallback client altyapısı;
- mevcut authenticated React ekranında query invalidation/yeniden okuma bağlantısı;
- iki bağımsız istemci, iki API replica, listener/worker restart ve slow-consumer kabul testleri;
- ilerideki public kanalın aynı hub/serializer/admission mekanizmasını kullanacağı portlar ve test doubles.

### 2.2 Aşama 13 dışında

- public status sayfasının allowlist snapshot'ı, token yaşam döngüsü ve gerçek public SSE route aktivasyonu — Aşama 15;
- monitoring dashboard'un tam görsel tasarımı, history grafikleri ve notification ayar ekranları — Aşama 14;
- prediction event producer/model yaşam döngüsü — Aşama 16;
- CDN/WAF ve çok bölgeli dağıtım — üretim dağıtım kapsamı.

Canonical OpenAPI'deki public SSE yolu rezervasyondur. Public snapshot ve token doğrulaması hazır olmadan yalnız event yolu açılmayacaktır; snapshot olmadan çalışan bir public stream race-free sözleşmeyi yerine getiremez. Aşama 13 shared transport'u hazırlar, public uçtan uca kabulü Aşama 15 kapatır.

## 3. Değişmezler

1. **PostgreSQL current projection source of truth'tur.** Browser state yalnız SSE payload'ından yeniden kurulmaz.
2. **Domain write ile outbox atomiktir.** Mutation commit olup event kaydı kaybolamaz; ikisi birlikte rollback olur.
3. **`LISTEN/NOTIFY` kalıcı kuyruk değildir.** Yalnız commit sonrası bounded wake-up taşır; kaçabilir, tekrarlanabilir ve sırası değişebilir.
4. **Kalıcı browser replay yoktur.** `Last-Event-ID` yetki veya doğruluk garantisi sağlamaz. Her reconnect REST reconciliation gerektirir.
5. **Owner izolasyonu iki kez uygulanır.** Wake-up owner kimliğiyle hub'a yönlenir; DTO okuması ayrıca owner-scoped DB transaction/RLS içinde yapılır.
6. **Public ve private serializer paylaşılmaz.** Public projection yalnız Aşama 15'in allowlist reader'ından gelir; private kimlik veya durum nesnesi public kanala çevrilmez.
7. **Bir client hiçbir zaman consumer'ı bloke etmez.** Her bağlantının byte/event sınırı vardır; overflow resync ve disconnect üretir.
8. **Tek kaynağın sırası dışında global sıra yoktur.** Version yalnız aynı `resource.type + resource.id` içinde karşılaştırılır.
9. **Canlı kanal ürün state'i değildir.** Worker/API restart, deployment ve kısa kesinti DOWN olayı veya history örneği üretmez.
10. **Prediction bağımlılık değildir.** Prediction event mapping'i veya worker'ı bozulduğunda diğer event aileleri ve stream devam eder.

## 4. Mevcut Temel ve Kapatılacak Boşluklar

Mevcut repository şu temeli sağlar:

- `infra.outbox_events` ve destination bazlı `infra.outbox_dispatches`;
- yalnız aktif destination için event/dispatch yazan ortak transaction helper'ı;
- lease, fencing token, retry ve dead-letter alanları;
- domain event kataloğu ile private/public SSE allowlist'i;
- owner RLS, opaque session, exact-origin CORS ve HMAC'li rate-limit anahtarları;
- canonical SSE endpoint ve frame sözleşmeleri;
- check/group/maintenance/notification producer'larının `REALTIME` destination niyeti;
- 30 saniyelik polling fallback ve 60 saniyelik görünür-sekme reconciliation kuralı.

Kalan uygulama boşlukları:

1. `REALTIME` destination production'da bilinçli olarak aktif değildir; relay consumer hazır ve pasif hedefte doğrulanmıştır.
2. API process'inde dedicated PostgreSQL listener ve subscriber registry yoktur.
3. İç domain event'ini dış SSE allowlist'ine çeviren, owner-scoped current projection reader yoktur.
4. Mevcut OpenAPI `DashboardPage` tek cursor ile iki collection'ı tarif eder; bu, büyük check/group koleksiyonları için tam snapshot pagination sözleşmesi değildir.
5. Browser heartbeat comment'ini native `EventSource` API'sinden gözleyemez; 45 saniye stale kuralı bu API ile kanıtlanamaz.
6. Session expiry/revocation, slow consumer, replica restart ve listener reconnect davranışları runtime'da uygulanmamıştır.
7. Public snapshot/token projection'ı henüz yoktur; public route'u erken açmak güvenli değildir.

## 5. Bileşen Topolojisi

```text
domain transaction (API / monitor / notification)
  ├─ source-of-truth mutation
  ├─ infra.outbox_events
  └─ infra.outbox_dispatches(destination=REALTIME)
                         │
                         ▼
realtime-worker (1..N replica, ayrı DB pool/role)
  ├─ lease + fencing ile bounded claim
  ├─ internal event → wake-up family allowlist
  ├─ dispatch complete + pg_notify aynı transaction
  └─ retry/dead-letter + health/metrics
                         │ PostgreSQL broadcast
             ┌───────────┴───────────┐
             ▼                       ▼
API replica A listener       API replica B listener
  ├─ bounded projection queue  ├─ bounded projection queue
  ├─ owner-scoped DB read      ├─ owner-scoped DB read
  └─ local owner hub           └─ local owner hub
       │     │                       │
       ▼     ▼                       ▼
   browser 1 browser 2           browser 3
       └──── stream → REST snapshot → buffered invalidation ────┘
```

Realtime worker bir event'i yalnız bir kez dispatch completion'a taşır. PostgreSQL `NOTIFY` ise commit'te bütün dinleyen API session'larına broadcast edilir. Böylece worker replica sayısı arttığında duplicate processing sınırlandırılır, API replica'larının her biri kendi local client'larına aynı değişikliği iletebilir.

## 6. Kalıcılık ve Revision 27 Planı

### 6.1 Rol ve yetki

Yeni `site_monitor_realtime` NOLOGIN rolü yalnız şu dar yetkilere sahip olur:

- realtime dispatch claim/complete/retry/dead-letter SECURITY DEFINER fonksiyonlarını çağırmak;
- worker schema compatibility/preflight fonksiyonunu çağırmak;
- completion fonksiyonu üzerinden sabit `site_monitor_realtime_v1` kanalına redacted wake-up üretmek.

Rol domain tablolarına, auth tablolarına, serbest outbox `SELECT/UPDATE` yetkisine veya keyfi notification payload'ı üretme yüzeyine sahip olmaz. Yerel Compose mevcut bootstrap login üzerinden bu role `SET ROLE` eder; production'da ayrı login/secret gerekir.

API rolü outbox tüketemez. Dedicated listener bağlantısı yalnız `LISTEN site_monitor_realtime_v1` yapar; owner DTO okuması mevcut `site_monitor_api` pool'unda RLS kapsamlı transaction ile yürür.

### 6.2 Dar DB fonksiyonları

Revision 27 aşağıdaki dar fonksiyonları ekler:

- `security_api.claim_realtime_dispatch(worker_id, lease_seconds)`:
  - yalnız `destination='REALTIME'`;
  - `PENDING`, zamanı gelmiş `RETRY_WAIT` veya süresi dolmuş `PROCESSING` satırı;
  - `FOR UPDATE SKIP LOCKED` ve deterministik `(available_at,event_id)` sırası;
  - `attempt_count` ve monoton `fencing_token` artırımı;
  - event envelope ile lease bilgisini döndürür.
- `security_api.complete_realtime_dispatch(event_id, worker_id, fencing_token, result, result_code, retry_delay_seconds)`:
  - yalnız güncel lease/fence kazanabilir;
  - `COMPLETED`, `RETRY` veya `DEAD` sonucunu tek fencing sınırında uygular;
  - retry zamanını worker'ın bounded deterministic backoff kararından alır;
  - yalnız `COMPLETED` sonucunda stored routing metadata'dan sabit, 1 KiB altı wake-up üretir.

Worker `complete` çağrısı ve sabit kanal `pg_notify` işlemini aynı DB transaction'ında yapar. PostgreSQL notification'ı yalnız commit sonrasında teslim ettiği için şu iki durumdan biri oluşur:

- transaction rollback: dispatch tamamlanmaz, notification yayınlanmaz, lease sonrası retry edilir;
- transaction commit: dispatch tamamlanır ve notification bütün aktif listener'lara yayınlanır.

Exactly-once browser delivery iddiası yoktur. DB transaction yalnız "completion ile wake-up birbirinden ayrılmasın" garantisi verir.

### 6.3 Aktivasyon ve geçmiş event politikası

`REALTIME` activation ancak şu preflight'lar geçtikten sonra forward-only cutover migration'ında açılır:

1. realtime worker schema sürümünü destekliyor;
2. en az bir worker readiness veriyor;
3. API listener ve private SSE route testleri geçiyor;
4. iki istemci ve iki API replica kabulü geçiyor.

Aktivasyondan önceki tarihsel domain event'leri backfill edilmez. İstemci ilk snapshot'ta güncel state'i alır. Bu, eski event fırtınasını ve artık anlamlı olmayan notification'ları önler.

## 7. Wake-up Envelope ve Projection

### 7.1 PostgreSQL notification payload'ı

Kanal payload'ı 1 KiB altında, schema-version'lı ve yalnız routing bilgisi taşır:

```json
{
  "v": 1,
  "event_id": "0192...",
  "owner_id": "0191...",
  "event_type": "check.health_changed",
  "aggregate_type": "check_state",
  "aggregate_id": "0190...",
  "aggregate_version": "19",
  "occurred_at": "2026-10-10T13:12:00.000Z"
}
```

Payload'da URL, e-posta, expected body, response body, session/token, incident ayrıntısı veya public token bulunmaz. `owner_id=null` event'ler açıkça allowlist edilmedikçe private hub'a girmez. Bilinmeyen `v`, event type veya bozuk JSON, veri yayınlamak yerine affected local stream'lerde `resync.required(PROJECTION_INVALIDATED)` ve alarm üretir.

### 7.2 İç event → dış event eşlemesi

Worker yalnız iç event ailesini doğrular; API projection mapper dış tipi seçer:

| İç event ailesi                                                | Dış private event                        | Okuma davranışı                                                                       |
| -------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| check create/metadata/probe/schedule/pause/resume/group/delete | `check.changed`                          | Güncel check list/detail query invalidation; delete'te minimal tombstone invalidation |
| observation/health/freshness/incident state                    | `check.status_changed`                   | Güncel check status projection'ı owner transaction'da okunur                          |
| group create/change/delete veya member status etkisi           | `group.changed` / `group.status_changed` | Grup ve hesaplanmış durum yeniden okunur                                              |
| incident lifecycle                                             | `incident.changed`                       | Incident journal/detail projection'ı yeniden okunur                                   |
| maintenance lifecycle                                          | `maintenance.changed`                    | Güncel window state owner scope'ta okunur                                             |
| recipient/policy/delivery                                      | `notification.changed`                   | Hassas adres taşımayan resource state okunur                                          |
| public config                                                  | `public_page.changed`                    | Yalnız private yönetim görünümü; public yayın değildir                                |
| prediction                                                     | `prediction.changed`                     | Port opsiyoneldir; hata diğer aileleri durdurmaz                                      |

Bir wake-up geldiğinde local replica'da o owner'a bağlı stream yoksa projection DB sorgusu yapılmaz. Stream varsa işler `(owner_id, external_family, resource_id)` anahtarıyla coalesce edilir. Aynı anahtar için yalnız en yüksek version tutulur; `version=null` query invalidation'dır ve düşürülemez.

Projection read hata verirse event uydurulmaz. İlgili owner stream'lerine resync sinyali gönderilir, hata bounded retry/metric'e alınır; worker dispatch'i zaten durable current state'in değiştiğini bildirmiştir.

## 8. API Replica ve Subscriber Hub

### 8.1 Dedicated listener

Her API replica pool dışında tek uzun ömürlü `pg.Client` açar:

- bağlantı kurulunca sabit kanalı `LISTEN` eder;
- connect/listen tamamlanmadan API readiness `ready` olmaz;
- bağlantı koparsa full-jitter backoff ile yeniden bağlanır;
- disconnect ile reconnect arasındaki bütün local stream'lere bir kez `resync.required(SUBSCRIBER_RESTARTED)` gönderilir;
- listener ana request pool'unun connection bütçesini tüketmez.

Listener'ın kopması liveness'i düşürmez. Readiness kısa grace sonrasında `unavailable` olur; mevcut HTTP/REST istekleri ve monitoring worker bağımsız çalışır.

### 8.2 In-memory indeksler

Private hub şu bounded indeksleri tutar:

```text
owner_id  -> Set<connection>
session_id -> connection count
ip_hash    -> connection count
connection -> queue bytes/events + last write + auth deadline
```

Hub kalıcı state değildir. Restart bütün bağlantıları kapatır; client reconnect + snapshot ile iyileşir. Redis eklenmez. V1 admission sınırları replica başına uygulanır; deployment genelindeki üst sınır reverse proxy/WAF'ta korunur. Bu taviz belgelenir ve kullanıcı state doğruluğunu etkilemez.

### 8.3 Stream açılışı

`GET /api/v1/events` sırası:

1. `Accept: text/event-stream` doğrulanır; yoksa `406`.
2. Exact-origin/CORS, session ve disabled-user kontrolü bağlantı açılmadan yapılır.
3. Handshake rate limit ve local session/owner/IP/global connection admission uygulanır; ret `429` problem JSON'dır.
4. Connection owner/session indekslerine atomik olarak kaydedilir.
5. SSE header'ları yazılır ve compression kapatılır.
6. İlk frame `stream.ready` olur; bu noktadan sonraki event'ler connection queue'suna girer.
7. Socket `close`/`error`/abort bütün timer ve indeksleri idempotent temizler.

İstemci snapshot'ı `stream.ready` sonrasında alır. Stream kaydı ile ready frame'i arasındaki çok küçük aralıkta gelen event connection queue'sunda tutulur.

### 8.4 Session yaşam döngüsü

- Stream session'ın DB expiry anını timer olarak taşır ve en geç bu anda kapanır.
- Logout/session revoke olayı local session indeksindeki bağlantıları hemen kapatır.
- Kaçmış revoke sinyaline karşı 60 saniyelik reconciliation turu aktif session kimliklerini bounded batch ile yeniden doğrular.
- Yetkisi biten bağlantıya başka owner verisi veya problem JSON frame'i yazılmaz; socket kapatılır ve normal HTTP reconnect `401` alır.

## 9. Frame, Backpressure ve Coalescing

Wire formatı [`REALTIME_CONTRACT.md`](./REALTIME_CONTRACT.md) ile aynıdır. Serializer:

- event name ve payload'ı Zod allowlist'inden geçirir;
- tek satır JSON üretir; CR/LF içeren `id` veya `event` değerini reddeder;
- JSON `event_id`, SSE `id` ve event name eşitliğini zorunlu tutar;
- private resource version'ı decimal string olarak taşır;
- her 15 saniyede `: heartbeat <UTC>` comment'i yazar.

Her connection için iki sınırdan önce dolan uygulanır:

- 256 bekleyen event;
- 1 MiB serialize edilmiş frame.

Socket `write()` false dönerse yeni frame doğrudan yazılmaz. Aynı resource için bekleyen invalidation en yüksek version ile coalesce edilir. Sınır aşılırsa server mümkünse `resync.required(BUFFER_OVERFLOW)` yollar ve bağlantıyı kapatır. Global relay/projection kuyruğu da bounded olur; global overflow yalnız etkilenen owner stream'lerini resync eder, sonsuz RAM veya outbox backpressure üretmez.

Başlangıç config değerleri kodda doğrulanmış, environment ile ayarlanabilir olur. Uygulama kapanış testleri ölçüm yapılmadan yüksek connection iddiasında bulunmaz. Minimum kabul iki bağımsız browser'dır; kapasite profili ayrıca local baseline ve gevşek regresyon bütçesi kaydeder.

## 10. Browser Client ve Tutarlılık Algoritması

### 10.1 Neden native `EventSource` değil

Native `EventSource` heartbeat comment'lerini uygulamaya göstermez ve 401/404/429 durumlarını güvenilir biçimde ayırmak için yeterli response kontrolü vermez. Bu nedenle client, browser `fetch` + `ReadableStream` üzerinde küçük, test edilmiş bir SSE parser kullanır:

- `credentials:'include'`;
- `Accept:'text/event-stream'`;
- response status/content-type kontrolü;
- comment dahil son byte zamanını izleme;
- 45 saniye sessizlikte `AbortController` ile stale bağlantıyı kesme;
- 1–30 saniye exponential full-jitter reconnect;
- 401/403 için auth state'e dönüş, public 404 için terminal stop, 429 için `Retry-After` uyumu.

Yeni runtime dependency zorunlu değildir. Parser; chunk sınırında bölünen UTF-8, CRLF/LF, çoklu `data:` satırı, comment, eksik son frame ve abort senaryolarıyla unit test edilir.

### 10.2 Private snapshot planı

Race-free sıra:

1. stream'i aç;
2. `stream.ready` al;
3. application event'lerini bounded client buffer'ında tut;
4. görünür ekranın owner-scoped REST query'lerini yeniden oku;
5. snapshot resource version'larını cache'e yaz;
6. buffered event'lerden yalnız daha yeni veya version'sız invalidation'ları uygula;
7. normal tüketime geç.

Tek `DashboardPage` cursor'ı iki bağımsız collection'ı tam temsil etmediğinden Aşama 13 doğruluk algoritması bir "snapshot set" kullanır: görünür ekranın `/checks`, `/groups`, `/incidents`, notification ve diğer query'leri kendi bounded cursor/ETag sözleşmeleriyle revalidate edilir. Aşama 14 dashboard endpoint'i bu query'ler için convenience projection olabilir; canlı kanalın doğruluğu tek dev response'a bağlanmaz.

Event payload'ı doğrudan optimistic state mutasyonu için zorunlu değildir. Varsayılan davranış query-key invalidation ve bounded refetch'tir. Bu, out-of-order/coalesced event'te yanlış ara state riskini azaltır.

### 10.3 Periyodik uzlaşma ve fallback

- Görünür sekmede başarılı SSE varken en geç 60 saniyede REST reconciliation.
- `visibilitychange` ile foreground olduğunda anında reconciliation.
- SSE üç ardışık bağlantı çevriminde kararlı kalamazsa 30 saniye + jitter polling.
- Background sekmede polling durur veya seyrekleşir; foreground'da hemen çalışır.
- SSE yeniden kararlı olunca polling kapanır.
- Client transport hatası hiçbir check'i `DOWN` göstermez; ayrı "canlı veri gecikiyor" UI freshness durumu üretir.

`Last-Event-ID` replay sağlamadığı için cross-origin fetch'te zorunlu header değildir. Gönderilirse yalnız tanılama/gap sinyali olarak kabul edilir ve CORS allowlist'inden geçer; snapshot zorunluluğunu kaldırmaz.

## 11. Public Kanalın Aşama 15 Entegrasyon Sınırı

Public status sayfası geldiğinde aynı transport çekirdeği şu farklı portlarla kullanılır:

- token hash lookup ve generic-not-found davranışı;
- page-scoped local hub (`page_id -> connections`);
- REST ile aynı allowlist snapshot reader;
- revision üreten public projection transaction'ı;
- yalnız `status_page.updated` serializer'ı;
- token rotate/disable olduğunda local stream termination.

Public wake-up, projection revision commit edilmeden yayınlanamaz. Public payload private check/group/incident ID, owner ID, URL veya token içermez. API replica notification sonrasında yalnız page ID ile local hub'a yönlenir; wire üzerinde resource ID opaque `public` olur.

Aşama 13 test doubles bu portların private serializer'a yanlışlıkla bağlanamadığını kanıtlar. Production public route ve acceptance Aşama 15'te snapshot ile aynı commit/read modeline bağlanır.

## 12. Hata, Retry ve Shutdown

### 12.1 Realtime worker

- transient DB/projection hatası: bounded exponential backoff + jitter;
- desteklenmeyen schema/event: retry edilmeden görünür `DEAD`, alarm ve metric;
- lease kaybı/fence uyuşmazlığı: eski worker completion/notify yapamaz;
- poison event: ana kuyruğu sonsuza kadar bloke etmez;
- shutdown: yeni claim durur, aktif transaction grace içinde tamamlanır veya rollback olur, pool kapanır.

### 12.2 API subscriber

- listener reconnect: bütün local stream'ler resync edilir;
- projection read timeout: affected owner resync, başka owner'lar devam;
- socket backpressure: connection-local overflow ve disconnect;
- serializer reddi: veri yayınlanmaz, affected owner resync ve metric;
- graceful shutdown: yeni SSE admission kapanır, mümkünse `SUBSCRIBER_RESTARTED` gönderilir, bounded grace sonunda socket'ler kapatılır.

Worker readiness; schema preflight, DB ve en az bir başarılı claim/poll çevrimini izler. API readiness; normal DB readiness yanında listener'ın grace dışı kopuk olmamasını izler. Realtime worker kapalıyken API/monitor/notification liveness'i etkilenmez; client polling fallback ile güncel kalır.

## 13. Güvenlik ve Gizlilik

- Private stream yalnız session owner kapsamındadır; request owner/path parametresinden alınmaz.
- Wake-up owner ID'si yalnız internal PostgreSQL bağlantısındadır, browser payload'ına eklenmez.
- Projection sorgusu notification içindeki aggregate ID'yi owner RLS olmadan okuyamaz.
- Public token access log/APM/metric label/problem instance içinde redacted kalır.
- SSE response `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`; compression kapalıdır.
- Exact-origin CORS ve `Vary: Origin` korunur; wildcard + credentials kullanılmaz.
- Handshake rate-limit anahtarı raw IP/session/token değil HMAC'li sınırlı kimliktir.
- Frame/log/metric içinde target query, expected body, e-posta, response body, session, CSRF veya provider secret bulunmaz.
- Error code'lar bounded allowlist'tir; exception text outbox/metric label'a yazılmaz.

## 14. Gözlemlenebilirlik ve Kapasite Bütçeleri

Zorunlu metric aileleri düşük cardinality label'larla:

- realtime dispatch pending/processing/retry/dead ve oldest age;
- claim/complete/retry toplamı ve dispatch latency histogramı;
- listener connected state/reconnect toplamı;
- active stream: scope ve replica toplamı; owner/session/token label yok;
- projection queue depth/coalesced/overflow/read latency;
- SSE frames/bytes, heartbeat, slow-consumer disconnect ve resync reason;
- handshake rejected reason (`AUTH`, `RATE`, `CAPACITY`, `MEDIA_TYPE`);
- client-side reconnect, stale abort, polling fallback ve snapshot latency.

Loglar `request_id`, internal `event_id`, bounded event family, worker/replica id ve sanitized result taşır. Owner/session/IP/token değerleri loglanmaz.

Kapasite kapanışında en az şu profil ölçülür:

- 20/200/500 check kaynaklı burst event;
- iki API replica ve her birinde birden fazla client;
- yavaş client varken hızlı client teslim gecikmesi;
- worker kapalıyken outbox backlog, geri geldiğinde drain;
- listener restart sırasında snapshot convergence;
- ayrı API request pool'unda authenticated REST latency.

Sonuçlar local baseline olarak raporlanır; production SLO veya sonsuz bağlantı iddiası yapılmaz.

## 15. Proxy ve Dağıtım Gereksinimleri

- HTTP/1.1 keep-alive veya HTTP/2 streaming korunur.
- Reverse proxy buffering ve SSE compression kapalıdır.
- Proxy idle timeout en az 60 saniye, tercihen 75 saniyedir; 15 saniye heartbeat'in üç katından uzundur.
- Response/body timeout normal JSON endpoint'lerinden ayrı ele alınır.
- Rolling deploy sırasında connection drain süresi bounded'dır; istemci reconnect beklenir.
- Sticky session doğruluk için gerekmez. Her replica PostgreSQL kanalını dinler ve snapshot kalıcı DB'dedir.
- Global connection ve internet abuse limiti production edge katmanında ayrıca uygulanır; app içi limitler savunmanın ikinci katmanıdır.

## 16. Uygulama Dilimleri

### Dilim 1 — Kalıcılık, worker ve relay çekirdeği

- [x] Revision 27 rol/fonksiyon/preflight;
- [x] realtime worker config, claim/fencing/retry/dead-letter;
- [x] safe wake-up mapper ve transactional `pg_notify`;
- [x] activation kapalıyken unit + gerçek PostgreSQL testleri ve container readiness smoke'u.

### Dilim 2 — Private API stream ve projection

- dedicated listener, owner hub, frame serializer ve backpressure;
- private projection reader/mapper;
- session expiry/revocation ve graceful shutdown;
- private route, headers, media/auth/rate/capacity hataları;
- iki API replica owner-isolation integration testleri.

### Dilim 3 — Browser client, cutover ve kapanış

- fetch-stream parser, stale detection, backoff, snapshot coordinator ve polling fallback;
- mevcut authenticated UI query invalidation bağlantısı;
- `REALTIME` activation cutover;
- iki browser/reconnect/replica/slow-client acceptance;
- capacity report, Compose/proxy config ve tam CI.

Public production adapter Aşama 15'in ilk diliminde shared Aşama 13 transport'una bağlanır.

## 17. Zorunlu Doğrulama Matrisi

| Senaryo                     | Beklenen kanıt                                                   |
| --------------------------- | ---------------------------------------------------------------- |
| Domain mutation rollback    | Event ve dispatch yok                                            |
| Worker crash claim sonrası  | Lease expiry ile daha yüksek fence; tek committed wake-up        |
| İki worker                  | Aynı dispatch'i yalnız güncel fence tamamlar                     |
| İki API replica             | Her replica kendi client'ına aynı owner invalidation'ını verir   |
| İki browser                 | Değişiklik reload olmadan iki ekranda görünür                    |
| Cross-owner                 | Event type, ID, timing veya payload sızıntısı yok                |
| Stream-before-snapshot race | Buffered newer version kaybolmaz                                 |
| Duplicate/out-of-order      | Eski version atılır veya query invalidate edilir                 |
| Listener disconnect         | Resync + reconnect + snapshot ile current state                  |
| Worker outage               | Ana ürün çalışır; polling günceller; backlog dönüşte drain olur  |
| Slow consumer               | Yalnız o connection overflow/resync; diğer client/API etkilenmez |
| Session expiry/logout       | Stream bounded sürede kapanır; reconnect 401                     |
| Heartbeat/stale             | 15 sn comment; 45 sn sessizlikte abort/reconnect                 |
| Unsupported schema          | Wire'a aktarılmaz; dead-letter/alarm/resync                      |
| Graceful shutdown           | Yeni admission yok; bounded drain; stuck socket yok              |
| 500-check burst             | Queue/RAM bounded; REST latency bütçesi korunur                  |
| Public adapter sınırı       | Private serializer/ID/token public payload'a geçemez             |

## 18. Tamamlanma Ölçütü

Aşama 13 ancak aşağıdakilerin tamamı sağlandığında uygulama olarak tamamlanmış sayılır:

- Revision 27 ve realtime worker clean database ile kurulabilir ve idempotent migration kapısından geçer;
- private SSE, iki browser ve iki API replica ile otomatik güncellemeyi kanıtlar;
- owner izolasyonu, race-free snapshot, listener/worker restart ve slow-consumer senaryoları geçer;
- polling fallback canlı kanal kaybını check DOWN state'iyle karıştırmaz;
- `REALTIME` activation yalnız consumer hazır olduktan sonra açılmıştır;
- proxy/Compose/config belgeleri ve capacity raporu günceldir;
- format, contract drift, lint, strict typecheck, unit, integration, E2E ve production build kapıları geçer;
- public route'un Aşama 15'e bağlı olduğu proje durumunda dürüstçe belirtilir.
