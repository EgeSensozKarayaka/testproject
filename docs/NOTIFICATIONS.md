# Transactional E-posta ve Bildirim Sistemi Mimarisi

**Durum:** Uygulama öncesi nihai tasarım; incelemeye hazır  
**Tarih:** 2026-10-10 16:27 +06:00  
**Bağımlılıklar:** Aşama 5 auth e-posta kuyruğu, Aşama 8 incident modeli, Aşama 9 outbox/lease altyapısı, Aşama 10 maintenance gate  
**Sonraki aşama sınırı:** History/rollup ve retention Aşama 12'ye aittir.

## 1. Amaç ve Değişmezler

Bu aşama, doğrulanmış incident geçişlerini kullanıcı tarafından doğrulanmış e-posta alıcılarına güvenilir biçimde iletir. SMTP veya notification worker arızası monitoring, API ve incident doğruluğunu etkileyemez.

Korunacak değişmezler:

- Tek ölçümlük geçici hata e-posta üretmez; yalnız doğrulanmış incident açılışı DOWN niyetidir.
- Bir incident ve recipient için en fazla bir DOWN, en fazla bir normal RECOVERY delivery kaydı vardır.
- Tekrarlanan FAIL sonuçları yeni intent veya delivery üretmez.
- Başarılı DOWN teslimi olmayan recipient'a RECOVERY gönderilmez.
- Bakım health/incident akışını durdurmaz; gönderim kararı hem intent değerlendirmesinde hem delivery claim anında güncel source of truth'tan kontrol edilir.
- E-posta adresi yalnız aynı owner'ın VERIFIED recipient kaydından gelebilir.
- API veya monitor transaction'ı SMTP çağırmaz.
- Aynı worker'ın veya birden fazla replica'nın retry/lease yarışı ikinci kalıcı delivery oluşturamaz.
- SMTP üzerinde mutlak exactly-once iddiası yapılmaz. Sonucu kanıtlanamayan gönderim `DELIVERY_UNKNOWN` olur ve otomatik retry edilmez.
- URL, expected body, response body, token ve e-posta adresi log/event/metric alanlarına yazılmaz.

## 2. Kapsam

### Bu aşamada

- Owner-scoped recipient CRUD, doğrulama ve doğrulanmış alıcıya test e-postası
- Kullanıcı varsayılan policy'si ve group override/inherit modeli
- `incident.opened` ve `incident.closed` outbox tüketimi
- İdempotent intent değerlendirme ve recipient başına delivery materialization
- Maintenance defer/cancel/reconciliation davranışı
- DOWN, RECOVERY ve non-recovery closure eşleştirmesi
- Lease/fencing, retry/backoff, terminal failure ve ambiguous result politikası
- HTML + düz metin şablonları ve Mailpit kabul akışı
- Çok replica güvenliği, restart recovery, gözlemlenebilirlik ve güvenli cutover

### Bu aşamada değil

- SMS, webhook, push notification veya üçüncü taraf incident yönetimi
- Kullanıcı tarafından düzenlenebilir HTML şablonu
- Digest, escalation chain, quiet hours veya tekrar eden reminder
- Organization/role tabanlı recipient paylaşımı
- Provider dashboard'u veya billing entegrasyonu
- Tahmin uyarısı; predictor ana incident bildirim yoluna bağlanmaz

## 3. Bileşenler ve Sınırlar

### API

API recipient, doğrulama token'ı ve policy mutation'larını tek owner transaction'ında yönetir. Ham doğrulama token'ı veritabanında yalnız digest, e-posta kuyruğunda ise mevcut AES-256-GCM zarfı içinde tutulur. API SMTP çağırmaz.

### `packages/notifications`

Framework ve I/O'dan bağımsız kuralları içerir:

- policy çözümleme
- intent uygunluğu
- Aşama 10 maintenance gate
- DOWN/RECOVERY lineage kararı
- deterministic retry/backoff ve SMTP sonuç sınıflaması
- allowlist template payload doğrulaması ve text/HTML rendering

### Notification worker

Aynı deployable process içinde birbirini bloklamayan dört bounded loop çalışır:

1. `NOTIFICATION` outbox dispatch claim/consume
2. pending/deferred intent evaluation ve deadline reconciliation
3. operational incident delivery claim/send/complete
4. account/recipient verification ve test e-postalarını taşıyan transactional-email claim/send/complete

Loop'lar aynı global SMTP concurrency bütçesini adil kullanır; auth/verification kuyruğu önceliklidir fakat incident kuyruğunu aç bırakamaz. PostgreSQL bağlantısı SMTP çağrısı boyunca tutulmaz.

### SMTP adapter

Nodemailer yalnız adapter'dır. Domain sonucu `SENT`, `RETRY`, `FAILED` veya `DELIVERY_UNKNOWN` olarak sınıflandırır. Yerelde Mailpit kullanılır; production'da TLS ve credential yapılandırması fail-fast doğrulanır.

## 4. Revision 16 Kalıcılık Planı

Mevcut tablolar korunur; uygulanan migration geçmişi değiştirilmez.

### 4.1 Recipient ve doğrulama kuyruğu

`notification.recipients` source of truth olmaya devam eder. Yaşam döngüsü:

```text
PENDING_VERIFICATION -> VERIFIED -> DISABLED
DISABLED --re-add same normalized address--> PENDING_VERIFICATION
```

Aynı owner ve normalized adres için tek satır korunur. Disabled adresin yeniden eklenmesi yeni kimlik üretmez; version artırılır, adres tekrar doğrulama bekler ve yeni token oluşturulur. VERIFIED veya PENDING adresin farklı idempotency key ile tekrar eklenmesi `409 recipient_already_exists` döndürür.

`notification.recipient_verification_tokens` ham token tutmaz. Yeni token transaction'ı önceki açık token'ları consume eder.

Mevcut `notification.transactional_email_deliveries` tablosu secret-bearing e-postalar için yeniden kullanılır:

- `recipient_id uuid NULL` composite owner FK ile eklenir.
- `purpose` değerlerine `VERIFY_NOTIFICATION_RECIPIENT` ve `TEST_NOTIFICATION` eklenir.
- Recipient amaçlarında `recipient_id` zorunlu, auth amaçlarında null olur.
- `CANCELLED` terminal state eklenir.
- Recipient disable işlemi açık verification/test teslimlerini iptal eder.

Yeni paralel secret queue kurulmaz.

### 4.2 Default ve group policy

Her owner için `group_id IS NULL` tek default policy; her group için tek group policy vardır. Revision 16:

- mevcut kullanıcılar için `DISABLED` default policy backfill eder,
- mevcut eksik group policy'lerini `INHERIT` olarak backfill eder,
- yeni `auth.users` satırına aynı transaction'da default policy oluşturan güvenli trigger ekler.

Policy semantiği:

| Scope   | Mode       | Sonuç                                      |
| ------- | ---------- | ------------------------------------------ |
| Default | `DISABLED` | Bildirim yok                               |
| Default | `ACTIVE`   | Kendi flag ve recipient listesi            |
| Group   | `INHERIT`  | Güncel default policy'nin tamamı           |
| Group   | `DISABLED` | Default'u override eder, bildirim yok      |
| Group   | `ACTIVE`   | Default ile merge etmez; kendi tam listesi |

Ungrouped check default policy kullanır. Group üyeliği intent materialization anındaki güncel `check.group_id` üzerinden çözülür. `ACTIVE` policy en az bir VERIFIED recipient ister ve `notify_recovery=true` yalnız `notify_down=true` iken geçerlidir.

Policy response'u configured ve effective sonucu ayırır. OpenAPI'ye `effective_policy_id`, `effective_mode`, `effective_notify_down`, `effective_notify_recovery`, `effective_recipient_ids` ve `effective_policy_version` eklenir. ETag yalnız mutation hedefinin `resource_version` değeridir; private response `no-store` olduğu için inherited projection cache validator olarak kullanılmaz.

### 4.3 Intent

`notification.intents` incident geçişi başına kalıcı ve idempotent karar kaydıdır. Mevcut unique `(incident_id,event_kind)` korunur. Revision 16 aşağıdaki kanıt alanlarını ekler:

- `decision_code`: bounded enum; örneğin `READY`, `MAINTENANCE`, `POLICY_DISABLED`, `INCIDENT_CLOSED`, `NO_SENT_DOWN`
- `policy_id_snapshot` ve mevcut `policy_version_snapshot`
- `template_key`, `template_version`, bounded `template_payload jsonb`

Normal türler:

- `INCIDENT_OPENED` -> DOWN
- `INCIDENT_RECOVERED` -> gerçek recovery
- `INCIDENT_CLOSED` -> `CONFIG_CHANGED` veya `CHECK_DELETED` için recovery iddiası taşımayan kapanış

Intent state'i:

```text
PENDING_EVALUATION
  -> DEFERRED_MAINTENANCE
  -> MATERIALIZED
  -> CANCELLED
  -> NO_RECIPIENTS

DEFERRED_MAINTENANCE
  -> DEFERRED_MAINTENANCE
  -> MATERIALIZED
  -> CANCELLED
  -> NO_RECIPIENTS
```

`MATERIALIZED`, delivery kayıtlarının atomik oluşturulduğunu ifade eder; e-postanın gönderildiği anlamına gelmez.

### 4.4 Operational delivery ve attempt journal

`notification.deliveries` recipient başına kalıcı delivery'dir. Revision 16:

- `DEFERRED_MAINTENANCE` state ve `maintenance_until` ekler,
- recovery/closure delivery'sini exact DOWN delivery'sine bağlayan `related_down_delivery_id` self-FK ekler,
- DOWN anındaki `notify_recovery` kararını `recovery_enabled_snapshot` olarak saklar,
- `cancel_requested_at` ve bounded `cancellation_reason` ekler,
- claim/retry/deadline indekslerini yeni state'lerle günceller.

Yeni append-only `notification.delivery_attempts` tablosu `(delivery_id, attempt_number)` unique anahtarıyla claim zamanı, fence, tamamlanma zamanı, sonuç kategorisi, sanitized result code ve provider message reference digest'i tutar. Ham SMTP hata metni, recipient adresi veya payload attempt journal'a yazılmaz.

Template payload intent üzerinde bir kez snapshot edilir; retry sırasında check adı veya incident verisi değişse bile mesaj içeriği değişmez. Recipient adresi delivery üzerinde snapshot'tır. Recipient açıkça DISABLED yapılırsa henüz gönderilmemiş snapshot iptal edilir.

### 4.5 Veritabanı erişim sınırı

Revision 16 claim/complete, recipient secret-email enqueue ve açık-incident cutover enqueue işlemlerini fence/owner doğrulayan dar `security_api` fonksiyonlarıyla sunar. API ve notifier'a secret queue veya outbox üzerinde gereksiz genel yazma yetkisi verilmez. Notification tablolarındaki mevcut geniş grant'ler gereken kolonlara daraltılır; attempt journal append-only kalır.

## 5. Recipient ve Policy API Kuralları

Canonical mevcut endpoint'ler uygulanır:

- `GET/POST /api/v1/notification-recipients`
- `DELETE /api/v1/notification-recipients/{recipient_id}`
- `POST /api/v1/notification-recipients/{recipient_id}/verification`
- `POST /api/v1/notification-recipient-verifications/confirm`
- `GET/PUT /api/v1/notification-policies/default`
- `GET/PUT /api/v1/groups/{group_id}/notification-policy`

Eklenen endpoint:

- `POST /api/v1/notification-recipients/{recipient_id}/test-email` -> `202`; yalnız VERIFIED recipient, CSRF + idempotency + sıkı owner/recipient rate limit

Mutation'lar mevcut session, CSRF/origin, RFC 9457, exact idempotency receipt ve güçlü ETag yaklaşımını kullanır. Cross-owner kaynaklar `404` görünür. Policy replacement:

1. policy ve recipient satırlarını deterministik ID sırasında kilitler,
2. bütün recipient'ların aynı owner'a ait ve VERIFIED olduğunu doğrular,
3. policy-recipient setini atomik değiştirir,
4. version, redacted audit ve realtime event'i aynı transaction'da yazar.

Recipient disable işlemi bağlı bir ACTIVE policy varken `409 recipient_in_use` döndürür; gizli policy mutation'ı yapmaz. Kullanıcı önce policy'yi değiştirir. PENDING/RETRY test ve verification e-postaları disable transaction'ında iptal edilir.

Public token confirmation invalid, expired, consumed veya disabled recipient için aynı `422 invalid_or_expired_token` sonucunu verir. Token ve e-posta değeri loglanmaz.

## 6. Intent Değerlendirme Algoritması

Her değerlendirme owner, check, incident ve intent'i transaction içinde kilitler; event payload'ı karar kaynağı değildir.

### DOWN

1. Incident artık açık değilse `CANCELLED/INCIDENT_CLOSED`.
2. Güncel direct+group maintenance etkinse `DEFERRED_MAINTENANCE`, `maintenance_until` ortak DB projection'ındaki en uzak aktif bitiştir.
3. Güncel group/default policy çözülür.
4. Policy disabled veya `notify_down=false` ise `CANCELLED/POLICY_DISABLED`.
5. VERIFIED recipient yoksa `NO_RECIPIENTS`.
6. Policy/template snapshot edilir, unique delivery'ler oluşturulur, intent `MATERIALIZED` olur.

### RECOVERY

1. Aynı incident için `SENT` durumundaki DOWN delivery'leri okunur.
2. Yalnız `recovery_enabled_snapshot=true` ve recipient'ı hâlâ VERIFIED olan lineage uygundur.
3. Uygun lineage yoksa `CANCELLED/NO_SENT_DOWN`.
4. Maintenance etkinse recovery de defer edilir.
5. Her uygun DOWN delivery için `related_down_delivery_id` taşıyan tek RECOVERY delivery oluşturulur.

Policy sonradan değişse bile başarılı DOWN'ın eşleşen recovery kararı DOWN anındaki snapshot'ı kullanır. Recipient'ın açıkça disable edilmesi güvenlik/opt-out olarak üstün gelir ve recovery gönderilmez.

### Non-recovery closure

`CONFIG_CHANGED` ve `CHECK_DELETED`, başarılı DOWN almış ve recovery snapshot'ı açık recipient'lara “monitoring changed/stopped” mesajı üretir; mesaj site iyileşti iddiasında bulunmaz. Henüz gönderilmemiş DOWN delivery'leri iptal edilir. Diğer closure nedenleri allowlist dışında ise e-posta oluşturulmaz ve görünür decision code kaydedilir.

## 7. Maintenance ve Yarış Kuralları

Intent evaluation tek başına yeterli değildir: pencere delivery materialize edildikten sonra başlayabilir. Bu nedenle operational delivery claim transaction'ı SMTP'den hemen önce şu source-of-truth kontrollerini tekrarlar:

- recipient hâlâ VERIFIED mı,
- DOWN için incident hâlâ açık mı,
- delivery cancel requested mı,
- `app.effective_maintenance_until(owner,check,db_now)` dolu mu.

Bakım etkinse delivery `DEFERRED_MAINTENANCE` olur; DB connection bırakılır ve SMTP çağrılmaz. Deadline geldiğinde yeniden değerlendirme başka/uzatılmış pencere varsa yeni sona erteler.

Maintenance create/change/cancel, `check.group_changed`, `check.deleted` ve `group.deleted` dispatch'leri ilgili nonterminal intent/delivery'leri erken uyandırır. Deadline polling process timer'ına bağlı değildir.

Claim kararı ile eşzamanlı maintenance commit'i için linearization noktası delivery claim SQL statement'ıdır. Claim daha önce kesinleşmişse dış SMTP çağrısı geri alınamaz; maintenance daha önce görünür olduysa claim gönderim yapamaz. Bu yarış dürüstçe belgelenir.

Incident recovery ile `PROCESSING` DOWN yarışı:

- SMTP çağrısı geri alınmaz; `cancel_requested_at` işaretlenir.
- DOWN `SENT` tamamlanırsa aynı lineage için RECOVERY oluşturulur.
- Definitive failure/retry sonucu gelirse yeni retry yerine `CANCELLED` olur.
- Ambiguous sonuç `DELIVERY_UNKNOWN` kalır; duplicate riski nedeniyle otomatik RECOVERY veya retry yapılmaz.

## 8. Outbox Tüketimi ve Cutover

Notification dispatch consumer yalnız bilinen event/schema sürümlerini kabul eder:

- `incident.opened`, `incident.closed`: intent oluşturma
- maintenance ve group/check kapsam olayları: reconciliation wake-up
- recipient/policy olayları: açık secret delivery iptali veya nonterminal yeniden değerlendirme

Dispatch claim `SKIP LOCKED`, lease ve fencing token kullanır. Intent/wake-up etkisi ile dispatch `COMPLETED` geçişi aynı DB transaction'ındadır. Duplicate consumer aynı unique intent'i görür ve ikinci etki üretmeden dispatch'i tamamlar. Şema uyumsuzluğu bounded retry sonunda `DEAD` ve alarm olur.

Production `NOTIFICATION` destination şu sırayla açılır:

1. Revision 16, API ve worker kodu destination pasifken deploy edilir.
2. Worker DB/loop preflight'i geçer; SMTP erişimi ana sistem readiness bağımlılığı yapılmaz.
3. Forward-only cutover migration'ı `NOTIFICATION` aktivasyon satırını ekler.
4. Worker source-of-truth reconciliation ile o anda açık incident'lar için sentetik, yalnız NOTIFICATION hedefli `incident.opened` event'i üretir.
5. Aktivasyon sonrası gerçek event dispatch'leri normal consumer yoluna girer.

Tarihsel outbox körlemesine replay edilmez. Unique intent kısıtı activation/backfill yarışı sırasında duplicate e-postayı engeller. Aktivasyon sonrası kapanmış ve hiç DOWN gönderilmemiş incident recovery üretmez.

## 9. Delivery, Retry ve SMTP Sonuçları

Claim:

- due kayıtları `available_at, id` sırasında ve `SKIP LOCKED` ile alır,
- state'i `PROCESSING`, lease owner/expiry ve artan fence ile günceller,
- immutable attempt journal satırını aynı transaction'da yazar,
- commit sonrası SMTP çağrısı yapar.

Sonuç politikası:

| SMTP sonucu                                                        | Delivery sonucu                                  |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| Provider `2xx` kabulü                                              | `SENT`                                           |
| Gönderimden önce kesin geçici hata veya `4xx`                      | full-jitter exponential backoff ile `RETRY_WAIT` |
| Kesin kalıcı adres/policy hatası veya `5xx`                        | `FAILED`                                         |
| Provider kabul edip etmediği kanıtlanamayan bağlantı kaybı/timeout | `DELIVERY_UNKNOWN`                               |
| Retry bütçesi tükendi                                              | `FAILED`                                         |

Başlangıç referansı 30 saniye base, 30 dakika cap ve en fazla 8 attempt'tir; değerler typed deployment config olur, ürün koduna gizli sabit dağılmaz. Her e-posta tek recipient'a `To` ile gönderilir; recipient'lar birbirini göremez.

Deterministik `Message-ID` delivery UUID'den ve uygulama alan adından türetilir. Bu, provider duplicate azaltımı sağlar fakat exactly-once garantisi değildir. `DELIVERY_UNKNOWN` operatör metriği/audit kaydı üretir ve manuel inceleme gerektirir.

## 10. Şablon ve Veri Minimizasyonu

Şablonlar kodda version'lı ve kullanıcı HTML'i kabul etmeyen allowlist yapılardır:

- DOWN: check display name, incident başlangıç/onay zamanı, bounded failure category
- RECOVERY: check display name, başlangıç/bitiş, gözlemlenen ve duvar süresi
- MONITORING_ENDED: check display name, kapanış nedeni ve zaman
- recipient verification: tek kullanımlık HTTPS linki
- test: ürün adı ve test teslimi açıklaması

Ham check URL'si, query string, expected-body metni ve response body e-postaya konmaz. Kullanıcı kontrollü düz metin HTML-escape edilir; remote asset, tracking pixel veya script yoktur. Her mesaj text ve minimal HTML alternatifine sahiptir.

Verification linki ham token'ı URL fragment'ında taşır; browser bunu server access loguna göndermez. Frontend fragment'i alıp confirmation POST body ile API'ye iletir.

## 11. Yapılandırma ve Readiness

Typed config en az şunları taşır:

- SMTP host/port, `none|starttls|tls` modu, opsiyonel username/password
- production için zorunlu TLS ve güvenli `From`
- connect/greeting/socket timeout'ları
- global SMTP concurrency ve iki queue fairness bütçesi
- outbox/intent/delivery poll interval ve batch size
- lease süresi, retry base/cap ve max attempts
- public web URL ve deterministic Message-ID domain'i

Notification worker readiness:

- schema revision uyumlu,
- DB erişilebilir,
- dört loop en az bir başarılı iteration tamamlamış ve güncel fatal hatası yok.

SMTP outage readiness'i düşürmez ve worker restart döngüsü yaratmaz; queue lag/failure/unknown metrikleri alarm üretir. API ve monitor worker notification-worker readiness'ine bağımlı değildir.

Shutdown yeni claim'i durdurur, in-flight SMTP çağrılarını configured timeout'a kadar bounded bekler, DB completion'larını flush eder ve sonra pool'u kapatır. Lease/fence sonraki replica'nın güvenli devamını sağlar.

## 12. Güvenlik ve Gözlemlenebilirlik

- `site_monitor_notifier` bütün owner'lar için yalnız gereken source tablolarını okur ve notification/dispatch/attempt alanlarını değiştirir; auth credential/session okuyamaz.
- Recipient ve policy API'si RLS current-owner context'i altında çalışır.
- SMTP credential'ı yalnız environment/secret manager'dan gelir; DB veya loga yazılmaz.
- Loglar delivery/intent/incident ID, template key, attempt, state ve bounded code taşır; e-posta, URL, token, subject ve provider ham hatası taşımaz.
- Metric label'ları bounded: queue kind, template, state, result code family. Owner/recipient/check ID label yapılmaz.
- Önerilen metrikler: queue depth/oldest age, intent evaluation lag, maintenance deferred count, attempt sonucu, sent latency, retry count, unknown/failed terminal count, outbox dead count.
- Notification lifecycle event'leri `AUDIT`/operasyon hedeflidir; hiçbir zaman yeniden `NOTIFICATION` destination'a yönlendirilmez.

## 13. Zorunlu Kabul Senaryoları

1. `FAIL -> FAIL -> FAIL...` tek incident ve recipient başına yalnız bir DOWN mail üretir.
2. Sonraki PASS yalnız DOWN `SENT` recipient'ına bir RECOVERY üretir.
3. Bir FAIL ardından PASS incident/e-posta üretmez.
4. Incident maintenance içinde açılıp kapanırsa DOWN/RECOVERY gönderilmez.
5. Incident maintenance içinde açılır ve pencere sonunda hâlâ açıksa tek DOWN gönderilir.
6. DOWN gönderildikten sonra maintenance içinde recovery olursa RECOVERY son pencere bitimine kadar defer edilir.
7. Materialization sonrası başlayan maintenance, claim öncesi delivery'yi durdurur.
8. Direct ve group overlap'te ilk pencere bitişi delivery'yi serbest bırakmaz.
9. Worker restart'ı deferred intent/delivery ve retry deadline'ını kaybetmez.
10. İki worker aynı dispatch/delivery'yi eşzamanlı claim ettiğinde tek fence kazanır.
11. SMTP kesin geçici hata retry, kesin permanent hata FAILED, ambiguous sonuç UNKNOWN olur.
12. Recipient disable unsent teslimleri iptal eder; cross-owner recipient policy'ye bağlanamaz.
13. Group `INHERIT/ACTIVE/DISABLED` ve ungrouped default çözümü doğru recipient setini üretir.
14. Policy/recipient mutation ETag, idempotency, RLS ve redaction testlerinden geçer.
15. Mailpit'te verification, test, DOWN, RECOVERY ve MONITORING_ENDED text/HTML içerikleri doğrulanır.
16. SMTP kapalıyken check'ler çalışır, incident oluşur, API cevap verir ve kuyruk kalıcı kalır.
17. Cutover sırasında açık incident ile eşzamanlı yeni event ikinci DOWN üretmez.

## 14. Uygulama Dilimleri

1. **Revision 16 + domain/API:** schema expansion/backfill/trigger, policy/gate/lineage kuralları, recipient ve policy endpoint'leri, verification/test queue.
2. **Worker runtime + cutover:** outbox/intent/delivery adapter'ları, SMTP classifier/templates, dört loop, readiness/shutdown ve destination activation.
3. **Kapanış kanıtı:** maintenance yarışları, iki replica, restart, SMTP failure matrix, Mailpit kabulü, tam CI ve durum belgeleri.

Her dilim ayrı anlamlı commit olur. İlk dilim migration geçmişini değiştirmez; ikinci dilimde cutover yapılmadan önce worker preflight ve source-of-truth reconciliation testi geçmelidir.
