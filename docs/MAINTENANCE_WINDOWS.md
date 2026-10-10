# Bakım Pencereleri Mimarisi

**Durum:** Onaylandı; revision 15/domain temeli, CRUD API ve çapraz kaynak davranışı uygulandı, kapanış kanıtı sırada
**Tarih:** 2026-10-10 15:46 +06:00  
**Bağımlılıklar:** Aşama 6 check/group yönetimi, Aşama 8 health/incident modeli, Aşama 9 kalıcı worker ve outbox altyapısı  
**Sonraki aşama sınırı:** E-posta alıcıları, policy çözümleme ve SMTP delivery state machine'i Aşama 11'e aittir.

## 1. Amaç

Bakım penceresi, bir check'in çalışmasını veya gerçek sağlık/incident hesabını durdurmaz. Yalnızca planlı zaman aralığında normal DOWN/RECOVERY bildirimlerinin gönderilmesini erteler. Yönetim ekranı ve ilerideki public sayfa gerçek sağlık durumunu göstermeye devam eder; bakım bilgisi ayrı bir eksendir.

Bu tasarım şu değişmezleri korur:

- Bakım, sağlık durumunu değiştirmez ve sahte `UP`, `DOWN` veya incident üretmez.
- Check ve group hedefleri owner sınırını aşamaz.
- Bütün zamanlar UTC `timestamptz` ve aralıklar `[starts_at, ends_at)` biçimindedir.
- Örtüşen direct-check ve group pencereleri birleşim (union) semantiği taşır.
- Process yeniden başlasa bile bakım sonundaki bildirim kararı kaybolmaz.
- Pencere değişikliği ile event/audit kaydı aynı transaction'da kalıcılaşır.

## 2. Kapsam ve Kapsam Dışı

### Bu aşamada

- Check veya group hedefli bakım penceresi CRUD API'si
- Sahiplik, RLS, optimistic concurrency ve idempotent create
- Türetilmiş `UPCOMING`, `ACTIVE`, `ENDED`, `CANCELLED` yaşam döngüsü
- Örtüşen pencere, aktif pencere düzenleme ve iptal kuralları
- Check/group okuma modellerinde maintenance projection'ı
- Check'in grup değiştirmesi ile bakım kapsamının anlık yeniden değerlendirilmesi
- Check/group silinirken gelecekteki veya aktif pencerelerin iptal edilmesi
- Notification katmanının kullanacağı tek, ortak “etkin bakım” sorgu semantiği
- Outbox/audit olayları ve zaman kontrollü testler

### Bu aşamada değil

- Tekrarlanan takvim/cron bakım kuralları
- Organizasyon veya rol tabanlı yetkilendirme
- Bakım sırasında check çalıştırmayı durdurma
- E-posta şablonu, recipient/policy yönetimi ve SMTP retry ayrıntıları
- Public sayfa ve canlı SSE yayını
- Geçmişte bitmiş bir pencereyi geriye dönük oluşturma veya değiştirme

## 3. Kalıcı Model

PostgreSQL `app.maintenance_windows` source of truth olmaya devam eder:

| Alan                       | Kural                                                                    |
| -------------------------- | ------------------------------------------------------------------------ |
| `id`                       | UUIDv7 primary key                                                       |
| `owner_id`                 | Sahip kullanıcı; RLS ve composite FK sınırı                              |
| `check_id` / `group_id`    | Tam olarak biri dolu; hedef sonradan değiştirilemez                      |
| `note`                     | `varchar(1000) NULL`; kullanıcı açıklaması, log/event payload'ına konmaz |
| `starts_at`, `ends_at`     | UTC; `ends_at > starts_at`                                               |
| `state`                    | Yalnız kalıcı komut durumu: `SCHEDULED` veya `CANCELLED`                 |
| `cancelled_at`             | Yalnız `CANCELLED` için dolu                                             |
| `resource_version`         | Her görünür değişiklikte artan güçlü ETag kaynağı                        |
| `created_at`, `updated_at` | Veritabanı zamanı                                                        |

Mevcut tabloda bulunan `name varchar(160) NOT NULL`, OpenAPI'deki nullable `note` sözleşmesiyle uyumsuzdur. Revision 15 bu kolonu veriyi koruyarak `note varchar(1000) NULL` biçimine dönüştürür. Ayrı bir isim alanı eklenmez; ürün gereksinimi bakım penceresine zorunlu başlık istememektedir.

`ACTIVE` ve `ENDED` veritabanında saklanmaz. Tek transaction'da alınan DB değerlendirme zamanı `t` için dış durum şöyledir:

```text
state = CANCELLED                                  -> CANCELLED
state = SCHEDULED and t < starts_at                -> UPCOMING
state = SCHEDULED and starts_at <= t < ends_at     -> ACTIVE
state = SCHEDULED and ends_at <= t                 -> ENDED
```

Bu yaklaşım timer gecikmesi veya process restart'ı yüzünden yanlış kalıcı durum oluşmasını engeller.

## 4. Etkin Bakım Hesabı

Bir check `c`, DB zamanı `t` anında şu koşulda bakımdadır:

```text
exists scheduled window w where
  w.owner_id = c.owner_id
  and w.starts_at <= t
  and t < w.ends_at
  and (
    w.check_id = c.id
    or (w.group_id is not null and w.group_id = c.group_id)
  )
```

Check'in direct penceresi ile mevcut grubunun pencereleri aynı kümede değerlendirilir. `maintenance.until`, o anda etkin eşleşmelerin en büyük `ends_at` değeridir. Bu değer bir bildirim için kesin gönderim zamanı değil, en erken yeniden değerlendirme zamanıdır; bitiş anında başka/ardışık bir pencere etkinse karar tekrar ertelenir.

Tam sınır davranışı:

- `t = starts_at`: bakım etkindir.
- `t = ends_at`: o pencere artık etkin değildir.
- Bitişi ile diğerinin başlangıcı aynı olan pencereler bildirim açısından kesintisizdir; worker sınırda source of truth'u yeniden okuyup gerekirse yeni sona erteler.
- `CANCELLED` satır hiçbir zaman etkin bakım hesabına girmez.

Check list/detail, monitor gözlem tanısı ve notification kararı aynı SQL koşulunu paylaşmalıdır. Event içindeki `maintenance_suppressed` gibi alanlar yalnız olay anı tanısıdır; gönderim kararının source of truth'u değildir.

## 5. Komut Kuralları

### Create

- `Idempotency-Key` zorunludur; aynı key + aynı payload aynı sonucu döndürür, farklı payload conflict üretir.
- Tam olarak bir `target_type/target_id` kabul edilir.
- Hedef aynı owner'a ait, canlı check veya silinmemiş group olmalıdır; bulunmayan ve başka owner'a ait hedefler aynı `404` davranışını verir.
- `ends_at` transaction zamanından ileride ve `ends_at > starts_at` olmalıdır.
- `starts_at` geçmişte olabilir; `ends_at` gelecekteyse pencere commit anından itibaren aktif kabul edilir. Daha önce gönderilmiş e-posta geri alınmaz.
- Owner başına yapılandırılabilir aktif+gelecek pencere kotası uygulanır; kaynak kodda ürün ölçeğini sabitleyen bir sayı kullanılmaz.

### Patch

- Güçlü `If-Match` zorunludur; stale version `412`, eksik header `428` üretir.
- Hedef değiştirilemez. Farklı hedef için eski pencere iptal edilip yenisi oluşturulur.
- `UPCOMING`: `starts_at`, `ends_at`, `note` değişebilir.
- `ACTIVE`: başlangıç geçmişi değiştirilemez; `ends_at` gelecekte kalmak şartıyla uzatılabilir veya kısaltılabilir, `note` değişebilir.
- Aktif bakımı hemen bitirmek için `DELETE`/cancel kullanılır.
- `ENDED` ve `CANCELLED` tarihsel kayıtlardır; patch `409 maintenance_window_immutable` üretir.
- No-op patch version/event/audit üretmez ve mevcut ETag'i döndürür.

### Delete / cancel

- Fiziksel delete yapılmaz.
- `UPCOMING` veya `ACTIVE` pencere atomik olarak `CANCELLED` yapılır; `cancelled_at` DB zamanıdır ve version artar.
- Güncel ETag ile zaten cancelled kaynağa tekrarlanan delete `204` dönebilir; stale ETag yine `412` olur.
- `ENDED` pencere iptal edilemez ve `409 maintenance_window_immutable` döner.
- Aktif pencerenin iptali o transaction anından itibaren bakım etkisini bitirir ve notification reconciliation'ı uyandırır.

## 6. Grup Üyeliği ve Kaynak Silme

Group bakım kapsamı pencere oluşturulduğu andaki üye snapshot'ı değildir; check'in karar anındaki `group_id` değerine bağlıdır.

- Check etkin bakımdaki bir gruba taşınırsa commit sonrasında hemen bakım kapsamına girer.
- Check gruptan çıkarılır veya başka gruba taşınırsa eski grubun bakımı hemen sona erer; direct veya yeni group penceresi varsa bakım sürer.
- `check.group_changed` notification reconciliation'ı uyandırır. Worker check'i ve açık/nonterminal notification intent'lerini source of truth'tan yeniden değerlendirir.
- Check soft-delete edilirken ona ait henüz bitmemiş direct pencereler aynı transaction'da iptal edilir.
- Group soft-delete edilirken o grubun henüz bitmemiş pencereleri aynı transaction'da iptal edilir; child check'ler zaten aynı transaction'da ungrouped olur.
- Önceden bitmiş pencereler audit/geçmiş için korunur.

Check/group silme transaction'ı deterministik kilit sırasını korur: hedef kaynak, etkilenen check'ler, ardından maintenance satırları ID sırasıyla kilitlenir. Mevcut group-delete owner kotası fan-out'u bounded tutar.

## 7. Health, Incident ve Bildirim Semantiği

Probe'lar bakım sırasında normal cadence ile çalışır. Run history, current health, freshness, incident ve group aggregate gerçek gözlemlere göre güncellenir. Maintenance yalnız bildirim kararını etkiler.

| Senaryo                                                       | Sonuç                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Incident bakımda açılır, bakım bitmeden kapanır               | DOWN ve RECOVERY gönderilmez; intent'ler terminal `CANCELLED` olur  |
| Incident bakımda açılır, bakım sonunda hâlâ açıktır           | Bakım sonunda tek DOWN materialize edilir                           |
| DOWN bakım öncesi gönderilmiştir, incident bakımda açık kalır | İkinci DOWN gönderilmez                                             |
| DOWN gönderildikten sonra recovery bakımda olur               | RECOVERY bakım sonuna ertelenir ve sonra bir kez gönderilir         |
| DOWN delivery henüz gönderilmeden bakım başlar                | Delivery anındaki tekrar kontrol nedeniyle ertelenir                |
| Bir pencere biterken başka pencere etkindir                   | E-posta gönderilmez; yeni etkin son sınıra ertelenir                |
| Check bakım sırasında `STALE/UNKNOWN` olur                    | Maintenance ve freshness ayrı gösterilir; sentetik recovery oluşmaz |

Gönderim öncesindeki son transaction bakım durumunu tekrar okur. Böylece pencere oluşturma, uzatma, kısaltma, iptal veya grup değiştirme ile delivery claim'i arasındaki yarış güvenli biçimde çözülür.

## 8. Kalıcı Reconciliation

İkinci bir bakım-job tablosu eklenmeyecektir. Mevcut `notification.intents` tablosu kalıcı reconciliation işi olarak kullanılır:

1. Incident event'i bir notification intent oluşturur.
2. Etkin bakım varsa intent `DEFERRED_MAINTENANCE` olur ve `maintenance_until` mevcut etkin birleşimin en erken yeniden değerlendirme sınırını taşır.
3. Notification worker `maintenance_until <= DB now` intent'lerini bounded ve owner-fair biçimde claim eder.
4. Worker güncel check/group/window/incident/policy verisini tekrar okur.
5. Başka pencere hâlâ etkinse deadline güncellenir; değilse iş kuralına göre delivery materialize edilir veya intent iptal edilir.

Doğal pencere bitişi bu deadline indeksiyle restart güvenli biçimde bulunur. Erken bitiş veya kapsam değişikliği eski deadline'ı beklememelidir; şu event'ler notification consumer'ı anında yeniden değerlendirmeye çağırır:

- `maintenance.created`
- `maintenance.changed`
- `maintenance.cancelled`
- `check.group_changed`
- `check.deleted`
- `group.deleted`

Event kaybolmaz çünkü domain değişimiyle aynı transaction'da outbox'a yazılır. Aynı intent birden fazla wake-up alabilir; claim ve terminal geçiş koşulları idempotenttir. Stage 11'de `NOTIFICATION` destination aktive edilirken açık incident/nonterminal intent reconciliation backfill'i çalıştırılır; aktivasyon öncesi tarihsel outbox olayları körlemesine e-postaya çevrilmez.

`maintenance.reconciliation_requested` ayrı bir zamanlayıcı gerçeği değil, worker'ın deadline veya mutation wake-up sonrasında source of truth değerlendirmesine başladığını gösteren redacted operasyon olayıdır.

## 9. API Sözleşmesi

Canonical yollar mevcut OpenAPI tasarımını korur:

- `GET /api/v1/maintenance-windows`
- `POST /api/v1/maintenance-windows`
- `GET /api/v1/maintenance-windows/{window_id}`
- `PATCH /api/v1/maintenance-windows/{window_id}`
- `DELETE /api/v1/maintenance-windows/{window_id}`

Liste sırası `starts_at DESC, id DESC` ve cursor imzalı/filter-bound'dır. Filtreler `state`, `check_id`, `group_id` yanında aralık kesişimi için `starts_before` ve `ends_after` alanlarını destekler. `state` tek request DB zamanına göre türetilir. Sayfalama sırasında zaman ilerleyebileceği için cursor ilk sayfanın `evaluated_at` anını da taşır; bütün sayfalar aynı yaşam döngüsü snapshot'ını kullanır.

Response hedefi `target_type/target_id` olarak normalize eder ve şu alanları taşır: `id`, hedef, `starts_at`, `ends_at`, `note`, türetilmiş `state`, `resource_version`, `created_at`, `updated_at`. ETag mevcut güçlü resource-version formatını kullanır.

Mutation'lar mevcut CSRF/origin/session, owner rate-limit, RFC 9457 problem ve atomic idempotency altyapısını kullanır. Cross-owner erişim `404` ile gizlenir.

Create idempotency replay'i genel API sözleşmesine uygun olarak ilk `201` body/ETag temsilini aynen döndürür. Türetilmiş `state` veya resource version aradan geçen zamanda değişmişse güncel temsil normal `GET` ile okunur. Liste cursor'ı ise ilk sayfanın imzalı `evaluated_at` değerini taşıdığı için bütün sayfalarda aynı yaşam döngüsü snapshot'ını korur.

## 10. Event, Audit ve Veri Gizliliği

Domain event'leri:

- `maintenance.created`: hedef kimliği, version, başlangıç/bitiş
- `maintenance.changed`: hedef kimliği, version, önceki/yeni başlangıç-bitiş, `changed_fields`
- `maintenance.cancelled`: hedef kimliği, version, `cancelled_at`
- `maintenance.reconciliation_requested`: hedef kimliği, `effective_at`, redacted `reason_code`

`note`, e-posta adresi, URL ve response body event/audit/log payload'ına yazılmaz. Audit kaydı action, resource ID, target type ve değişen alan adlarını taşır. Correlation ID API transaction'ından outbox ve reconciliation akışına aktarılır.

## 11. Yetki ve İndeksler

- API rolü owner-scoped select/insert ve gerekli kolonlarla sınırlı update yapar; fiziksel `DELETE` yetkisi kaldırılır.
- Monitor rolü yalnız etkin bakım sorgusu için select kullanır.
- Notification rolü bakım source of truth'unu okuyabilir; pencereyi değiştiremez.
- `FORCE RLS` ve composite owner foreign key'leri korunur.
- Mevcut partial check/group etkinlik indeksleri sorgu yolunu destekler.
- Liste için `(owner_id, starts_at DESC, id DESC)` indeksi eklenir.
- Doğal reconciliation, mevcut partial `notification_intents_evaluation_idx` üzerinden çalışır.

Ham owner ID, target ID veya note metric label yapılmaz. Önerilen bounded metrikler: mutation sonucu, active/upcoming window sayısı, deferred intent sayısı, reconciliation lag, no-op/stale wake-up sayısı ve hata kodu.

## 12. Yarış ve Hata Davranışı

- Bütün mutation'lar maintenance satırını `FOR UPDATE` kilitler ve version'ı aynı statement/transaction içinde doğrular.
- Hedef create sırasında hedef satır kilitlenir; eşzamanlı delete ya önce tamamlanır ve create `404` alır ya da create tamamlandıktan sonra delete pencereyi iptal eder.
- Patch/cancel ile notification değerlendirmesi yarışırsa delivery transaction'ı gönderim öncesi bakım sorgusuyla son kararı verir.
- Eski reconciliation wake-up'ı geçerli bir komut değildir; güncel source of truth ile no-op olabilir.
- API transaction'ı event/audit yazamazsa pencere değişikliği de rollback olur.
- Notification worker kapalıyken probe, health ve incident akışı etkilenmez; intent/outbox kalıcı backlog olarak kalır.

## 13. Test ve Kabul Kanıtı

### Saf domain testleri

- `starts_at - 1 ms`, tam `starts_at`, `ends_at - 1 ms`, tam `ends_at`
- Upcoming/active/ended/cancelled mutation matrisi
- Active start değiştirme reddi; future end uzatma/kısaltma
- Örtüşen/ardışık pencerelerde union ve yeniden değerlendirme zamanı

### Gerçek PostgreSQL entegrasyonu

- Owner A'nın Owner B hedefini görememesi/değiştirememesi
- Create idempotency ve farklı payload conflict'i
- İki eşzamanlı patch'te bir başarı, bir `412`
- Check + group overlap ve `max(ends_at)` projection'ı
- Grup taşıma/ungroup/delete ile kapsamın atomik değişmesi
- Check/group delete sırasında gelecek/aktif pencerelerin iptali
- Mutation + audit + outbox atomikliği ve note redaction
- Restart sonrasında aynı satırlardan doğru state türetilmesi

### Aşama 10 kapanış senaryoları

- Probe ve incident maintenance boyunca çalışmaya devam eder.
- Bakım içindeki tek-check transient hata incident eşiğini normal biçimde izler.
- Bakımda açılıp kapanan incident için bildirim kararı “gönderme” olur.
- Bakım sonunda açık incident tek DOWN'a; önceden bildirilmiş incident'ın bakım içi recovery'si tek RECOVERY'ye uygun hale gelir.
- Örtüşen pencerenin biri bitince bildirim açılmaz; son kapsam bittiğinde reconciliation ilerler.

Gerçek SMTP gönderimi Aşama 11'in kabul kanıtıdır. Aşama 10, bunun için gerekli source-of-truth, deadline ve wake-up sözleşmesini doğrular.

## 14. Uygulama Dilimleri

Hızlı fakat geri alınabilir ilerleme için Aşama 10 dört küçük dilimde uygulanacaktır:

1. **Domain ve revision 15:** `name → note`, liste indeksi, dar grant'ler, ortak bakım projection helper'ı ve saf testler.
2. **API:** service/routes, OpenAPI zaman filtreleri ve hata cevapları, idempotency/ETag/cursor/RLS entegrasyon testleri.
3. **Çapraz kaynak davranışı:** check/group delete ve group-change reconciliation event'leri; monitor/API projection birliği.
4. **Kapanış kanıtı:** zaman sınırları, overlap, restart ve notification-decision fixture'ları; tam CI ve belge güncellemesi.

Her dilim ayrı anlamlı commit olur. Aşama 10 tamamlanmadan `NOTIFICATION` destination aktive edilmez; bu aktivasyon ve gerçek delivery Aşama 11'de yapılır.

**2026-10-10 uygulama durumu:** 1–3 tamamlandı. CRUD API; zaman filtreli OpenAPI, yapılandırılabilir owner kotası, atomik create receipt'i, güçlü ETag/If-Match, soft cancel, redacted audit/outbox ve DB-zamanlı türetilmiş state ile production API'ye bağlandı. Check group değişimi güncel üyelikten anında yeniden projekte edilir; check/group silme açık hedef pencerelerini deterministik kilit sırasıyla iptal eder, bitmiş geçmişi korur ve notification/realtime wake-up olayları üretir. Owner izolasyonu, eşzamanlı create/patch/delete, exact replay/conflict, filter-bound cursor ve immutable history gerçek PostgreSQL üzerinde doğrulandı. Sıradaki dilim 4'tür.
