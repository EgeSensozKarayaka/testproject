# Kontrol ve Grup Yönetimi Mimarisi

**Aşama:** 6 — Kontrol ve Grup Yönetimi  
**Durum:** Tamamlandı; yerel kapanış ve GitHub Actions `38022028585` doğrulamaları geçti
**Son güncelleme:** 2026-10-10 08:22 +06:00
**Bağlı belgeler:** [`REQUIREMENTS.md`](./REQUIREMENTS.md), [`ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md), [`DOMAIN_MODEL.md`](./DOMAIN_MODEL.md), [`STATE_MACHINES.md`](./STATE_MACHINES.md), [`DATABASE.md`](./DATABASE.md), [`API_DESIGN.md`](./API_DESIGN.md), [`API_ERRORS.md`](./API_ERRORS.md), [`EVENT_CATALOG.md`](./EVENT_CATALOG.md), [`openapi-v1.yaml`](./openapi-v1.yaml), [`AUTH_AND_OWNERSHIP.md`](./AUTH_AND_OWNERSHIP.md)

## 1. Amaç ve sınır

Bu aşama, HTTP kontrol motoru çalıştırılmadan önce check ve check group yapılandırmasının güvenilir yönetim sınırını kurar. Kullanıcı check oluşturabilir, okuyabilir, değiştirebilir, duraklatabilir, sürdürebilir, silebilir ve manuel çalıştırma talebi verebilir. Gruplar oluşturulabilir, değiştirilebilir ve içlerindeki check'ler silinmeden kaldırılabilir.

V1 gerçek çok kullanıcılıdır. Her check ve grup doğrudan tek bir `owner_id` sahibine aittir; organizasyon, workspace, rol veya paylaşımlı sahiplik bu aşamaya eklenmez. Bir check sıfır veya bir gruba bağlıdır. Kaynak sayısı sabit `50` değildir: aynı veri modeli 20, 200 ve 500 kontrol profillerini taşır; operasyonel güvenlik kotası deployment tarafından yapılandırılır.

Bu aşamanın kapsamına HTTP/DNS/TLS probe ayrıntıları, scheduler claim/lease döngüsü, accepted observation işleme, history rollup, bakım UI'ı, bildirim gönderimi, public status ve prediction girmez. Bununla birlikte check komutlarının sonraki bu alanları bozmayacak generation, outbox ve state geçişleri bu belgede kesinleştirilir.

## 2. Tasarım hedefleri

1. Sahiplik yalnız handler filtresine değil explicit owner predicate, composite foreign key ve FORCE RLS'e dayanır.
2. İki tarayıcı veya API replica'sı aynı kaynağı değiştirirken sessiz last-write-wins oluşmaz.
3. Retry edilen create ve manuel çalıştırma talepleri ikinci kaynak veya ikinci iş üretmez.
4. Check ayarı, current-state geçişi, job invalidation, audit ve outbox ya birlikte commit edilir ya hiçbiri edilmez.
5. API hiçbir probe'u HTTP request süresi içinde çalıştırmaz.
6. Uzun süren veya hâlihazırda queued check için ikinci paralel aktif iş üretilemez.
7. URL ve expected text hiçbir log, metric label, audit metadata veya outbox payload'ına taşınmaz.
8. Liste sorgularının maliyeti toplam geçmiş/run hacmine bağlı değildir.
9. Soft-delete sonrası kaynak bütün private/public okumalardan hemen çıkar; geçmiş lineage korunur.
10. Predictor, SMTP veya sonraki projection consumer'larının arızası check/group mutation'ını dış servis çağrısıyla bloke etmez.

## 3. Değişmez kurallar

### 3.1 Check

- `owner_id` yalnız doğrulanmış session bağlamından alınır; request body'de kabul edilmez.
- Check `LIVE` oluşturulur ve terminal `DELETED` durumundan geri döndürülemez.
- Execution yalnız `ACTIVE` veya `PAUSED` olur; PATCH ile değil pause/resume komutlarıyla değiştirilir.
- URL yalnız mutlak `http` veya `https` URL olabilir; user-info/credential reddedilir.
- Interval dahilî iki uçla `30..3600` saniyedir.
- V1 dış timeout sözleşmesi `100..60000` ms'dir ve interval'dan uzun olabilir.
- Beklenen HTTP status `100..599` aralığındadır.
- Beklenen body metni null veya boş olmayan, en fazla 2048 UTF-8 byte exact substring'dir; regex değildir.
- Grup null olabilir; doluysa aynı owner'a ait, `deleted_at IS NULL` bir grup olmalıdır.
- Aynı owner altında check adlarının eşsiz olması gerekmez; kimlik UUID'dir.
- Her check oluşturulurken tam bir `monitoring.check_current_states` satırı da oluşturulur.
- Bir check için `PENDING`, `LEASED` veya `RUNNING` durumunda en fazla bir job bulunur.

### 3.2 Grup

- Grup adı boş olamaz; aynı owner altında aynı ada izin verilir.
- Açıklama null veya en fazla 1000 karakterdir.
- Grup silme check silmez; bütün canlı üyeler aynı transaction'da `group_id = NULL` olur.
- Silinen gruba yeni check bağlanamaz.
- Group health yazılabilir aggregate değildir; canlı child current-state kayıtlarından türetilir.
- Grup create işlemi gelecekteki bildirim ayarlarının tekil olabilmesi için aynı transaction'da `INHERIT` group policy satırı oluşturur. Owner default policy yoksa bildirim çözümleyici fail-closed, yani disabled davranır.

### 3.3 Sürüm eksenleri

- `resource_version`: istemcinin gördüğü check/group yapılandırmasındaki her gerçek değişimde bir artar.
- `probe_generation`: URL, timeout, expected status veya expected body anlamı değiştiğinde bir artar.
- `schedule_generation`: interval, pause, resume veya delete schedule geçerliliğini değiştirdiğinde bir artar.
- İsim ve grup değişimi probe/schedule generation artırmaz.
- Manuel çalışma istemek check yapılandırmasını değiştirmez; `resource_version` artırmaz.
- No-op PATCH/pause/resume, güncel `If-Match` doğrulandıktan sonra aynı representation ve ETag'i döndürür; audit/outbox/version churn üretmez.

## 4. Bileşen ve kod sınırları

```text
React UI
  └─ generated OpenAPI client types
       │ cookie + CSRF + If-Match/Idempotency-Key
       ▼
Fastify check/group routes
  ├─ runtime contract validation
  ├─ session/owner/rate-limit hooks
  └─ application command/query services
       ├─ packages/domain
       │    normalization, policy, change classification
       ├─ packages/database
       │    owner transaction, repositories, cursor/idempotency
       └─ PostgreSQL
            config + current state + job + audit + outbox
```

Fastify handler SQL veya state transition yazmaz. Saf normalizasyon/değişiklik sınıflandırması `packages/domain` içinde; transaction ve sorgu ayrıntıları `packages/database` içinde; orchestration `apps/api` application service katmanında kalır. `packages/check-engine` bu aşamada URL'yi çağırmaz; Aşama 7'de burada üretilen immutable job snapshot'ını tüketir.

Önerilen modüller:

- `packages/domain/src/checks/*`: input normalization, URL policy, change-set ve state command sonuçları
- `packages/domain/src/groups/*`: group validation ve delete planı
- `packages/database/src/checks-repository.ts`: owner-scoped command/query SQL'i
- `packages/database/src/groups-repository.ts`: group ve üyelik SQL'i
- `packages/database/src/idempotency.ts`: authenticated receipt orchestration
- `apps/api/src/check-routes.ts` ve `group-routes.ts`: HTTP adaptörleri

## 5. Mevcut şemayla çapraz inceleme ve revision 12

Mevcut revision 1–11 değiştirilmez. Uygulama sırasında revision 12 aşağıdaki ileri düzeltmeleri yapar:

1. `app.check_groups.description varchar(1000) NULL` ekler. Alan OpenAPI/domain modelinde vardır fakat mevcut tabloda yoktur.
2. `app.checks.expected_body_substring` için null veya `octet_length(...) BETWEEN 1 AND 2048` kısıtı ekler. `varchar(2048)` karakter sınırıdır; tek başına kararlaştırılmış UTF-8 byte sınırını kanıtlamaz.
3. API'nin domain mutation'ı ile aynı transaction'da initial current-state, manual job, audit ve outbox yazabilmesi için en dar gerekli grant/policy'leri ekler. API'ye worker claim/lease/fencing veya cross-owner yetkisi verilmez.
4. `app.checks` ve `app.check_groups` üzerinde fiziksel `DELETE` API yetkisini kaldırır; ürün silmeleri yalnız soft-delete command'idir.
5. `infra.outbox_events`, gerekli `infra.outbox_dispatches` ve `audit.events` insert sınırlarını owner/correlation doğrulamasıyla açar; API bu tablolarda genel okuma veya update yapamaz.
6. Yeni migration sonrası Kysely şema tipleri ve gerçek PostgreSQL entegrasyon fixture'ları güncellenir.

Uygulama sırasında revision 12'nin API'ye current-state ve job yazma yetkisi verdiği, ancak bu belgede zorunlu olan config/pause/delete incident ve health-interval geçişleri için gerekli dar izinleri vermediği gerçek PostgreSQL testinde doğrulandı. Uygulanmış revision 12 değiştirilmedi; forward-only revision 13 yalnız incident kapanış/suspension kolonlarını, open interval rotation kilidini ve finalized interval insert'ini API rolüne açtı. Worker claim, run acceptance, fencing ve probe sonucu alanları API'ye açılmadı.

Veritabanındaki URL `varchar(4096)` savunma alanı korunur; dış sözleşme normalize edilmeden önce en fazla 2048 Unicode code point, canonical serialization sonrasında en fazla 4096 UTF-8 byte kabul eder. Veritabanındaki `timeout_ms <= 300000` savunma tavanı da değiştirilmez; v1 API daha dar `60000` ms tavanını uygular. Bu ayrım gelecekte güvenli genişlemeyi migration zorunluluğu olmadan mümkün kılar ancak v1 route daha geniş değeri kabul etmez.

## 6. Girdi normalizasyonu ve doğrulama

### 6.1 Ad ve açıklama

- `name`: Unicode NFC, baş/son whitespace temizlenmiş, 1–160 karakter.
- `description`: Unicode NFC, baş/son whitespace temizlenmiş; boşsa null, değilse en fazla 1000 karakter.
- Adlar log label'ı yapılmaz ve uniqueness anahtarı değildir.

### 6.2 URL canonicalization

Canonicalization tek, saf ve unit-test edilen fonksiyondur:

1. Baş/son ASCII whitespace kaldırılır; control karakteri reddedilir.
2. WHATWG uyumlu parser ile mutlak URL parse edilir.
3. Scheme lowercase olur ve yalnız `http:`/`https:` kabul edilir.
4. Username veya password alanı doluysa reddedilir.
5. Host IDNA ASCII canonical biçimine çevrilir; boş host, wildcard ve geçersiz port reddedilir.
6. Varsayılan `:80`/`:443` portu kaldırılır; boş path `/` olur.
7. Fragment probe semantiği taşımadığı için saklanmaz. Response'ta canonical URL döndüğü için dönüşüm sessiz değildir.
8. Path ve query'nin anlamlı sırası değiştirilmez; query parametreleri sort edilmez.
9. Canonical URL dış/DB uzunluk sınırlarını tekrar geçer.

Kullanıcı URL query'sine secret koyabilir; servis URL'yi owner'a geri göstermek ve probe etmek için plaintext saklamak zorundadır. Buna karşılık query hiçbir structured log, audit/event payload, metric, problem detail veya e-postaya yazılmaz. V1 custom header/cookie/authenticated target desteği vermez.

### 6.3 İki katmanlı SSRF politikası

Configuration API ağ veya DNS çağrısı yapmaz. API request'inde DNS çözmek hem latency/availability'yi hedefe bağlar hem de DNS-rebinding yarışını çözmez.

API aşamasında canonical host üzerinde açıkça yerel/özel hedefler reddedilir:

- loopback, private, link-local, multicast, unspecified, documentation ve reserved IPv4/IPv6 literal'ları
- IPv4-mapped IPv6 ve alternatif sayısal IPv4 yazımlarının canonical karşılıkları
- `localhost`, `.localhost`, `.local`, `.internal`, `.home.arpa` ve açık metadata host allowlist'i

Hostname'in gerçek A/AAAA sonucu ve her redirect hedefi Aşama 7 kontrol motorunda, bağlantıda kullanılacak IP pinlenerek tekrar doğrulanır. Runtime çözüm private/reserved ise bağlantı kurulmaz ve güvenli `BLOCKED_TARGET` sınıflandırması üretilir. Böylece API'nin kabul etmiş olması hedefin çalıştırılacağına dair güvenlik izni değildir; execution-time kontrol authoritative'dir.

### 6.4 Beklenen metin

- `null`, body kontrolü yapılmayacağı anlamına gelir.
- Boş string reddedilir; whitespace dahil içerik aynen korunur.
- En fazla 2048 UTF-8 byte kabul edilir.
- Case-sensitive literal substring'dir; regex/glob ve Unicode normalization uygulanmaz.
- Ham expected string job snapshot dışında event/audit/loga girmez. Response body hiçbir zaman saklanmaz; Aşama 7 yalnız boolean match ve bounded tanısal sonuç üretir.

## 7. Ortak command transaction kalıbı

Authenticated mutation sırası şöyledir:

1. Request ID/correlation ID, session, exact origin, CSRF, media type, body ve rate limit doğrulanır.
2. Body allowlist ile normalize edilir; unknown alan schema tarafından reddedilir.
3. `withOwnerTransaction(ownerId)` açılır ve `SET LOCAL app.current_user_id` kurulur.
4. Idempotent uçta subject/operation/key/request digest ile mevcut receipt aranır ve gerekiyorsa replay edilir.
5. Kaynak ve ilişkili aggregate'ler tanımlı kilit sırasıyla kilitlenir.
6. `If-Match` varsa kilitli satırın `resource_version` değeriyle karşılaştırılır.
7. Domain değişiklik planı hesaplanır; quota ve invariant'lar transaction içinde tekrar doğrulanır.
8. Config, state/job yan etkisi, audit, outbox/dispatch ve idempotency receipt aynı transaction'da yazılır.
9. Commit sonrasında explicit DTO map edilir; başarı commit'ten önce socket'e yazılmaz.

Transaction içinde DNS, HTTP, SMTP, predictor veya başka dış servis çağrısı yoktur. Constraint/serialization hatası bounded retry politikasına uymuyorsa merkezi problem mapper'a stabil kod olarak gider; SQL ayrıntısı dışarı çıkmaz.

## 8. Kilit sırası ve deadlock önleme

- Tek check komutu yalnız check satırını, ardından check ID'sine bağlı current-state/job satırlarını kilitler.
- Group membership değişimi önce mevcut ve hedef group satırlarını UUID sırasıyla, sonra check satırını kilitler ve bütün değerleri tekrar okur.
- Group delete önce group satırını, sonra canlı child check'leri UUID sırasıyla kilitler.
- Owner quota create işlemi önce owner+resource-kind transaction advisory lock'ını, sonra ilgili group satırını alır.
- Aynı transaction içinde kilit alınacak check listeleri daima UUID sırasındadır.

Cross-owner satır RLS nedeniyle hiç görünmez. Hedef grup yok, silinmiş veya başka owner'a aitse aynı `404 resource_not_found` döner. Bu sıra move/delete yarışında deadlock riskini azaltır ve silinen gruba son anda üye eklenmesini engeller.

## 9. Check oluşturma ve okuma

### 9.1 Create

`POST /api/v1/checks` `Idempotency-Key` ister. Transaction:

1. Owner check quota lock/count kontrolünü yapar.
2. Opsiyonel group'u aynı owner ve live olarak kilitler/doğrular.
3. UUIDv7 check'i `LIVE + ACTIVE`, üç sürümü `1`, `cadence_anchor_at = now` ile ekler.
4. İlk `next_run_at`, deterministik ve en fazla 5 saniyelik startup jitter ile mümkün olan en kısa ana ayarlanır.
5. `UNKNOWN + STALE`, `state_version=1` current-state satırı ekler.
6. Redacted `check.created`, audit ve idempotency receipt'i yazar.

Başarı `201`, `Location`, `ETag: "rv-1"` ve canonical Check DTO'sudur. API bu sırada hedefe bağlanmaz.

### 9.2 Tekil okuma

`GET /api/v1/checks/{id}` yalnız live configuration döndürür; current operational status ayrı list/dashboard projection'ındadır. Soft-deleted, bilinmeyen ve başka owner'a ait ID aynı `404` olur. Response `Cache-Control: no-store` ve güçlü config ETag taşır.

### 9.3 Liste

`GET /api/v1/checks` owner/live predicate'inden başlar; history veya raw run scan etmez. Check configuration, tekil current-state ve opsiyonel group projection join edilir.

- sıra: `created_at DESC, id DESC`
- varsayılan sayfa 50, üst sınır 100; bu ürün kotası değildir
- filtreler: `group_id`, `execution_state`, effective `health`, `freshness`
- cursor: route + normalize filtre fingerprint'i + son `(created_at,id)` + issued/expiry taşıyan HMAC imzalı opaque token
- cursor tamper, expiry veya filtre değişimi: `400 invalid_cursor`

Effective health `freshness_state=STALE` veya check `PAUSED` ise `UNKNOWN`, aksi halde stored health'tir. Liste sorgusunun ana indeksi mevcut owner/lifecycle/created index'idir; filter query planları 500-check fixture ile `EXPLAIN (ANALYZE, BUFFERS)` üzerinden kaydedilir.

## 10. PATCH değişiklik sınıflandırması

Tek PATCH içinde birden fazla alan değişebilir; bütün gerçek değişiklikler tek `resource_version` artışı ve tek transaction'dır. Probe ve schedule generation kendi kategorileri mevcutsa en fazla birer artar.

| Değişiklik                       | Resource | Probe gen. | Schedule gen. | Job/schedule ve state etkisi                                                                                                   |
| -------------------------------- | -------: | ---------: | ------------: | ------------------------------------------------------------------------------------------------------------------------------ |
| Yalnız `name`                    |       +1 |          — |             — | Yok                                                                                                                            |
| `group_id`                       |       +1 |          — |             — | Health korunur; sonraki maintenance/policy kapsamı yeni gruptur                                                                |
| URL/timeout/expected status/body |       +1 |         +1 |             — | Aktif eski job iptal/geçersiz; candidate temiz; incident `CONFIG_CHANGED`; freshness STALE, health UNKNOWN; ACTIVE ise ASAP    |
| Yalnız interval                  |       +1 |          — |            +1 | Aktif eski job iptal/geçersiz; anchor değişiklik anı; `next_run_at=now+interval`; health korunur, freshness yeniden hesaplanır |
| Probe + interval                 |       +1 |         +1 |            +1 | Probe reseti baskındır; ACTIVE ise yeni anlam için ASAP planlanır                                                              |

Probe config değişiminde eski last response alanları tanısal geçmiş olarak tutulabilir fakat current effective health UNKNOWN'dır. Açık health interval değişiklik anında kapanır, açık incident `CONFIG_CHANGED` ile kapanır ve pending failure candidate temizlenir. Interval değişiminde `fresh_until = last_accepted_finished_at + new_interval + timeout + scheduler_grace` yeniden hesaplanır; geçmişteyse anında STALE olur.

Bir request normalized olarak mevcut değerlerle aynıysa başarılı no-op'tur. Fakat stale `If-Match`, değişiklik no-op görünse bile önce `412` üretir; eski istemci yeni durumu bilmeden başarı varsayamaz.

## 11. Pause, resume ve delete

### 11.1 Pause

`ACTIVE -> PAUSED`:

- resource ve schedule generation bir artar
- `next_run_at = NULL`
- aktif job'lar cancellation terminal durumuna alınır; running worker'ın eski sonucu lifecycle/generation/fencing kapısından geçemez
- candidate temizlenir, freshness STALE olur
- son observed health tanısal olarak korunur
- açık incident kapanmaz; observed segment pause anında kapanır ve incident `UNOBSERVED` olur
- `check.paused`, audit ve realtime/reconciliation dispatch'i aynı transaction'da yazılır

Zaten PAUSED ise güncel ETag ile no-op `200` döner.

### 11.2 Resume

`PAUSED -> ACTIVE`:

- resource ve schedule generation bir artar
- cadence anchor resume anıdır
- `next_run_at` en fazla 5 saniyelik deterministik jitter ile ASAP olur
- freshness yeni accepted observation'a kadar STALE/effective UNKNOWN kalır
- açık unobserved incident korunur; sonraki accepted FAIL gözlemi sürdürür, PASS recovery ile kapatır

Zaten ACTIVE ise güncel ETag ile no-op `200` döner.

### 11.3 Delete

Delete fiziksel satır silmez:

- `lifecycle_state=DELETED`, `deleted_at=now`, `next_run_at=NULL`, `manual_requested_at=NULL`
- resource ve schedule generation bir artar; probe generation değişmez
- queued/running işler iptal edilir; lifecycle ve schedule generation eski sonucu reddeder
- candidate ve açık interval kapanır; açık incident `CHECK_DELETED` ile kapanır
- pending normal notification niyet/teslimleri güvenli cancellation/reconciliation yoluna girer
- public projection consumer'ı check'i bir sonraki snapshot'tan çıkarır; private sorgu aynı commit'ten sonra 404 verir
- geçmiş runs/incidents/audit retention gereği korunur

Silinmiş kaynak sonraki mutasyonlarda `404` olur; restore endpoint'i yoktur.

## 12. Manuel çalıştırma komutu

`POST /api/v1/checks/{id}/runs` hem `If-Match` hem `Idempotency-Key` ister. API probe sonucunu beklemez ve `202 ManualRunReceipt` döndürür.

Transaction check'i kilitler ve güncel configuration snapshot üretir:

- LIVE+ACTIVE: `STATEFUL`
- LIVE+PAUSED: `DIAGNOSTIC`
- DELETED/cross-owner: `404`

Check için aktif job yoksa doğrudan `monitoring.check_jobs` içinde `PENDING + MANUAL` kalıcı job oluşturulur ve disposition `ENQUEUED` olur. Job snapshot URL, timeout, expected değerler ve üç version/generation değerini içerir; 16 KiB sınırını geçemez.

Aktif `PENDING/LEASED/RUNNING` job varsa yeni job yaratılmaz. `manual_requested_at` null ise request anına set edilir, doluysa değiştirilmez; disposition `COALESCED` olur. Job tamamlayan scheduler/worker transaction'ı bu tek niyeti tüketerek en fazla bir yeni manual job üretir. Partial unique index son yarış bariyeridir.

Manuel request:

- scheduled cadence'i ve check ETag'ini değiştirmez
- check ve owner bazlı ayrı distributed rate limit'ten geçer
- aynı idempotency key retry'ında aynı `request_id`, disposition, mode ve requested time'ı replay eder
- `check.manual_run_requested` payload'ında URL/expected text taşımaz

## 13. Grup komutları

### 13.1 Create ve update

`POST /groups` owner group quota'sını, `Idempotency-Key` receipt'ini ve group + `INHERIT` notification policy + audit + `group.created` yazımını tek transaction'da yapar. Başarı `201`, Location ve ETag döndürür.

`PATCH /groups/{id}` `If-Match` ister. Name/description normalize edildikten sonra gerçek fark varsa resource version bir artar ve redacted `group.changed` üretilir. Duplicate isim serbesttir. No-op aynı ETag ile döner.

### 13.2 Delete

Group delete atomik ve soft'tur:

1. Group ve canlı child check'ler tanımlı sırayla kilitlenir.
2. Group `deleted_at=now`, `resource_version+1` olur.
3. Her child check `group_id=NULL`, `resource_version+1`, `updated_at=now` olur; probe/schedule generation değişmez.
4. Her etkilenen check için minimal `check.group_changed`, grup için `group.deleted` yazılır.
5. Group-scoped scheduled maintenance yeni etki üretmeyecek şekilde cancel/reconciliation yoluna, public group component yeniden projection yoluna girer.
6. Notification policy ve geçmiş delivery kayıtları fiziksel silinmez; policy resolver silinmiş grubu geçersiz kabul eder.

Bu fan-out owner operational quota ile bounded'dır. Check başına version artışı, açık ikinci sekmenin eski ETag ile gruba geri yazmasını engeller. Başarı `204` döner; etkilenen check sayısı yalnız metric/audit metadata'sında bounded integer olabilir, check listesi yazılmaz.

### 13.3 Group list/status

Group listesi `created_at DESC,id DESC` keyset cursor kullanır. Status live child check ve current-state üzerinden tek bounded aggregate query ile hesaplanır:

```text
DOWN > SUSPECT > UNKNOWN > UP
```

Paused ve deleted check öncelik hesabına girmez; paused sayısı ayrıca döner. Aktif check yok fakat paused varsa health UNKNOWN; hiç child yoksa UNKNOWN ve iç sayaçların tümü sıfırdır. Aşama 8 observation işleyene kadar yeni check'lerin doğal durumu UNKNOWN'dır; sahte UP üretilmez.

## 14. Optimistic concurrency ve idempotency

- Mutable tekil configuration response'u `ETag: "rv-N"` taşır.
- PATCH, DELETE, pause, resume ve manual run güncel `If-Match` ister.
- Eksik header `428 precondition_required`, bozuk header `400 invalid_precondition`, eski sürüm `412 resource_version_mismatch` olur.
- Create check/group ve manual run authenticated kalıcı receipt kullanır.
- Receipt operation scope'u path kimliğini ve canonical request hash'ini kapsar; aynı key/farklı request `409 idempotency_key_reused` olur.
- Başarılı receipt domain mutation, outbox ve response allowlist header/body ile aynı transaction'dadır.
- `5xx` receipt olarak başarı diye saklanmaz; commit sonrası response kaybı tamamlanmış receipt'ten çözülür.
- Tek PATCH birden fazla değişiklik kategorisi oluşturursa aynı final aggregate version ile birden fazla tiplenmiş event çıkabilir. Consumers event ID ile idempotenttir ve version sırasını non-decreasing yorumlar; bir version başına tam bir event varsaymaz.

İki sekme örneği: ikisi `rv-3` okur; ilk sekme update ile `rv-4` alır. İkinci sekmenin `rv-3` PATCH'i `412` olur, UI son kaynağı yeniden getirir ve kullanıcı değişikliğini bilinçli olarak tekrar uygular.

## 15. Sahiplik ve yetki modeli

- Bütün repository sorguları `owner_id` ve live predicate'i açıkça taşır.
- `SET LOCAL app.current_user_id` olmadan FORCE RLS default-deny olur.
- Check-group ilişkisi `(owner_id,group_id)` composite FK ile cross-owner bağı reddeder.
- Body/route değerinden owner context kurulmaz.
- Cross-owner read/update/delete/move/manual komutları `404`; DB constraint adı dışarı verilmez.
- API rolü worker lease/claim, run acceptance, public raw snapshot veya predictor write yetkisi almaz.
- Worker rolleri check config'i okuyabilir fakat user/session/parola tablolarını okuyamaz.
- Soft-deleted parent'e FK teknik olarak bağlanabilse de repository live group kilidini zorunlu tutar; uygulama integration testi bu semantik boşluğu kapatır.

## 16. Quota ve rate limit

Kaynak sayısı ürün sözleşmesinde `50` olarak sabitlenmez. İki ayrı kontrol vardır:

### Operational quota

- `CHECKS_PER_OWNER_LIMIT` ve `GROUPS_PER_OWNER_LIMIT` validated deployment config'idir; local/reference değerleri `.env.example` içinde açıklanır.
- Değer pozitif bir limit veya açıkça unlimited semantiğidir; kod içinde gizli fallback `50` yoktur.
- Create transaction owner+resource-kind advisory lock alır, live count yapar ve sonra insert eder; farklı API replica'ları kotayı yarışla aşamaz.
- Limit değişimi migration gerektirmez. Daha yüksek plan/owner override gereksinimi oluşursa ayrı operator-controlled quota tablosu eklenir; v1'e sahte billing modeli konmaz.
- Aşım `409 quota_exceeded`; check silinince slot geri gelir.

### Rate limit

- Mutation, manuel run owner scope'u ve manuel run check scope'u mevcut PostgreSQL/HMAC sayaçlarını kullanır.
- Rate limit burst/abuse kontrolüdür ve kaynağın toplam sayısından bağımsızdır.
- Aşım `429 rate_limit_exceeded` ve `Retry-After` döndürür.
- Başlangıç bütçeleri config'dedir ve 20/200/500 yük testiyle ayarlanır; metric label'ında owner/check ID bulunmaz.

Quota worker concurrency değildir. Aşama 9 global/per-owner/per-host concurrency ve fairness'i ayrıca uygular.

## 17. Event, audit ve gizlilik

Başarılı gerçek mutation aynı transaction'da katalogdaki event'i üretir. Event payload'ları yalnız kimlik, version/generation, state, changed field adları ve zaman taşır. URL, query, group/check adı, description ve expected text taşımaz.

Audit kayıtları:

- actor type/id, owner, action, resource type/id, result, correlation ve zaman
- create/update/pause/resume/manual/delete ve group bulk ungroup için güvenli metadata
- update'te alfabetik `changed_fields`; eski/yeni değer yok
- group delete'te yalnız bounded `affected_check_count`

Audit bir tam configuration backup'ı değildir ve otomatik rollback sunmaz. Configuration version kimin/ne zaman/hangi alan sınıfını değiştirdiğini kanıtlar; hassas eski URL/substring'i kalıcı kopyalamaz. Immutable job/run snapshot'ları yalnız gerçekten çalıştırılan probe lineage'ı içindir ve private retention politikasına tabidir.

Outbox dispatch başarısızlığı domain commit'ini geri almaz; dispatch kaydı aynı transaction'da kalıcıdır ve worker retry eder. Event insertion'ın kendisi başarısızsa domain mutation da rollback olur.

## 18. Hata sözleşmesi

| Durum                                         | HTTP / code                                                   |
| --------------------------------------------- | ------------------------------------------------------------- |
| Body/query/header şema veya domain validation | `422 validation_failed` veya header/cursor için tanımlı `400` |
| Session yok/geçersiz                          | `401 authentication_required`                                 |
| Kaynak yok, deleted veya başka owner          | `404 resource_not_found`                                      |
| Group yok/deleted/cross-owner                 | `404 resource_not_found`                                      |
| Quota dolu                                    | `409 quota_exceeded`                                          |
| Geçersiz lifecycle transition                 | `409 invalid_state_transition`                                |
| Idempotency key farklı request                | `409 idempotency_key_reused`                                  |
| Eski ETag                                     | `412 resource_version_mismatch`                               |
| Eksik If-Match                                | `428 precondition_required`                                   |
| Rate limit                                    | `429 rate_limit_exceeded` + `Retry-After`                     |

Alan hataları JSON Pointer taşır fakat normalize URL, DB constraint, SQL, stack veya target response ayrıntısı taşımaz. `X-Request-Id` her cevapta bulunur.

## 19. OpenAPI uygulama düzeltmeleri

Uygulama commit'inden önce canonical `openapi-v1.yaml` şu noktalarda kesin tasarımla eşitlenir ve generated artifact'ler yeniden üretilir:

- `expected_body_substring` için boş string'in reddi ve route-level UTF-8 byte validation açıklaması
- URL canonicalization/fragment/user-info davranışının description alanları
- pause, resume ve manual run için eksik `404` response'ları
- manual run `202` response'una `Cache-Control: no-store`; check ETag'inin değişmediğinin açıklaması
- create/list mutasyonlarında quota/rate-limit problem response'ları
- Group `description` ile revision 12 şemasının eşleşmesi
- successful pause/resume response'larında yeni ETag header'ının kesinleşmesi

Sözleşme değişikliği sonrası `pnpm contracts:generate` ve `pnpm contracts:check` byte-level drift kapısıdır. Generated dosyalar elle düzenlenmez.

## 20. Test stratejisi

### 20.1 Unit/domain

- isim/description sınırları ve Unicode davranışı
- interval, timeout, status ve expected substring byte sınırları
- URL canonicalization; credential, protocol, port, IPv4/IPv6/private/local/metadata negatifleri
- PATCH change classification ve generation matrisi
- pause/resume/no-op/delete state planları
- cursor sign/verify, filter binding, expiry ve key rotation
- audit/event redaction allowlist'i

### 20.2 Gerçek PostgreSQL integration

- create ile check + current state + audit + outbox + receipt'in atomikliği
- iki owner için read/update/delete/move/manual negatif izolasyon matrisi
- owner context olmadan default-deny ve pool commit/rollback sonrası context temizliği
- stale/missing/malformed ETag davranışları
- aynı idempotency key replay ve farklı payload conflict'i
- aynı anda çoklu create ile quota'nın replica/connection yarışında aşılmaması
- aynı check'e paralel manual taleplerin tek aktif job + en fazla tek pending intent üretmesi
- combined PATCH'te resource/probe/schedule sürümlerinin yalnız birer artması
- pause/probe/edit/delete sırasında eski job ve sonuçların generation/lifecycle bariyeri
- group delete'in bütün child check'leri atomik ungroup etmesi ve her ETag'i artırması
- move ile group delete yarışında silinmiş gruba bağlı canlı check kalmaması
- transaction'ın audit/outbox hata enjeksiyonunda tamamen rollback olması
- soft-deleted satırların normal sorgu ve quota count'tan çıkması

### 20.3 API/contract/E2E

- CSRF/origin/media type/session korumaları ve problem schema conformance
- create/get/list/patch/pause/resume/manual/delete mutlu yolları
- iki browser sekmesinde stale ETag `412`, refetch ve bilinçli retry
- User A'nın User B kimliklerini denediği bütün check/group route'larında `404`
- 20, 200 ve 500 check fixture'ında bounded cursor sayfalama; response üst sınırının ürün kotası sanılmaması
- URL/query/expected text'in captured log, audit ve outbox içinde bulunmaması
- API request'inin target simulator yavaş/hang endpoint'ini beklememesi

Aşama 6 sonunda `pnpm run ci`, gerçek DB integration, Docker Compose smoke ve ilgili Playwright akışları çalıştırılır. Aşama 7/8/9'a ait worker sonucu henüz varmış gibi raporlanmaz.

## 21. Gözlemlenebilirlik

Başlangıç metric'leri düşük cardinality ile:

- command/query latency ve sonuç sayacı (`operation`, `outcome`)
- validation/problem code sayacı
- idempotency replay/conflict sayacı
- quota denied ve quota utilization bucket'ları
- manual disposition (`ENQUEUED`/`COALESCED`) ve mode
- DB transaction retry/deadlock/lock-wait süresi
- outbox dispatch backlog ayrı worker metriği

Structured log yalnız request/correlation ID, operation, HTTP status, duration ve güvenli hata kodu taşır. Owner, check ID veya group ID yalnız tanısal gereksinim varsa irreversible HMAC fingerprint olarak ve sınırlı retention ile kullanılabilir; URL/ad/substring asla loglanmaz.

## 22. Uygulama sırası

1. OpenAPI düzeltmeleri, generated contract ve contract testleri
2. Saf domain normalizasyonu/change classification ve unit testleri
3. Revision 12 schema/grant/policy değişiklikleri ve Kysely tipleri
4. Authenticated idempotency, ETag parser ve cursor altyapısı
5. Group create/get/list/update ile quota ve negatif ownership testleri
6. Check create/get/list/update ile current-state initialization
7. Pause/resume/delete ve generation/state/job invalidation
8. Manual run enqueue/coalescing ve distributed rate limit
9. Atomic group delete/ungroup fan-out ve yarış testleri
10. React check/group yönetim ekranları; loading/empty/error/412 recovery ve responsive/accessibility
11. İki-client E2E, 20/200/500 fixture/profil, log-redaction testi
12. Compose smoke, tam CI, karar/geliştirme/proje durumu ve README güncellemesi

Her dikey dilim küçük ve anlamlı commit olur. Revision 12 bir kez uygulanınca değiştirilmez; bulunan hata revision 13+ forward-fix ile giderilir.

2026-10-10 uygulama durumu: 1–12 tamamlandı. İki-client E2E, 20/200/500 PostgreSQL cursor profili, 500 kayıtlık bounded UI fixture'ı, log/audit/outbox redaction, Compose smoke ve tam CI geçti. GitHub Actions [`38022028585`](https://github.com/EgeSensozKarayaka/testproject/actions/runs/38022028585) Node, PostgreSQL, Python, dependency audit ve full-stack smoke işlerinin tamamında başarılı oldu.

## 23. Tamamlanma ölçütü

Aşama 6 yalnız aşağıdakilerin tümü sağlandığında tamamlanır:

- Check/group CRUD, pause/resume/delete ve manual request gerçek PostgreSQL üzerinde çalışır.
- Cross-owner bütün yollar 404 ve RLS ile korunur.
- ETag/idempotency/cursor davranışları sözleşmeye uygundur.
- Validation ve iki katmanlı URL güvenlik sınırı testlidir.
- Group delete check'leri kaybetmeden atomik ungroup eder.
- Concurrent manual request tek aktif job ve tek pending niyet sınırını aşmaz.
- Config/state/job/audit/outbox transaction bütünlüğü hata enjeksiyonuyla kanıtlanır.
- Operational quota sabit 50 değildir ve 20/200/500 profilleriyle doğrulanır.
- İki tarayıcı stale edit senaryosu güvenli davranır.
- UI erişilebilir loading/empty/error/conflict durumlarını gösterir.
- Yerel kalite, Compose smoke ve GitHub CI geçer; eksikler dürüstçe kaydedilir.

## 24. Bilinen tavizler ve sonraki aşamalar

- Configuration API'de DNS preflight yoktur; güvenli bağlantı ve redirect/DNS-rebinding savunması Aşama 7'nin authoritative görevidir.
- Aşama 6 manual job'ı kalıcılaştırır fakat gerçek probe'u Aşama 7, claim/schedule/recovery döngüsünü Aşama 9 tamamlar.
- Group status yeni check'lerde UNKNOWN gösterir; gerçek health/incident state machine Aşama 8'de devreye girer.
- Kullanıcıya açık audit history endpoint/UI yoktur; immutable audit kayıtları tutulur. Güvenli projection ihtiyacı ayrı sözleşme kararıdır.
- Per-plan veya per-user ticari quota override tablosu yoktur. V1 deployment-level owner kotası yeterlidir; billing modeli varsayılmaz.
- Bulk import/export, çoklu seçimle silme, clone, tags, custom headers/auth, TCP/ICMP probe ve organizasyon üyeliği kapsam dışıdır.
