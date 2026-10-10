# Site Availability Monitor — Sıralı Uygulama Planı

**Durum:** Uygulama öncesi iş bölümü  
**Tarih:** 2026-10-09 22:35 +06:00  
**Dayanak:** `AGENTS.md` ve `docs/ARCHITECTURE.md`

## 1. Amaç

Bu belge toplam proje çalışmasını, bağımlılıklarına göre sıralanmış ve ayrı ayrı doğrulanabilir iş paketlerine böler. Bu aşamada bileşenlerin ayrıntılı nihai tasarımı yapılmaz; her iş paketinin sınırı, kendisinden önce tamamlanması gerekenler ve beklenen çıktıları tanımlanır.

Her bileşenin ayrıntılı mimarisi, ilgili iş paketine başlanırken ayrıca ele alınacak ve uygulama kodundan önce proje dizinine kaydedilecektir.

## 2. Her İş Paketinde Uygulanacak Kapı Sistemi

Her iş paketi aşağıdaki sırayla yürütülür:

1. İlgili gereksinimler ve mevcut kararlar tekrar okunur.
2. Belirsizlikler, edge case'ler ve değişmez kurallar çıkarılır.
3. Bileşenin v1 için nihai tasarım belgesi oluşturulur.
4. Tasarım kullanıcıyla değerlendirilir ve gerekiyorsa düzeltilir.
5. Tasarım kabul edilmeden uygulama koduna başlanmaz.
6. Kod, migration ve otomatik testler küçük adımlarla uygulanır.
7. İş paketine özel kabul ve hata senaryoları çalıştırılır.
8. `DECISIONS`, `DEVELOPMENT_LOG` ve `PROJECT_STATUS` belgeleri güncellenir.
9. Anlamlı ve sınırlı Git commit'leri oluşturulur.

Bir iş paketinin tamamlanması, yalnızca kodunun yazıldığı değil; tasarımının, testlerinin, hata davranışlarının ve dokümantasyonunun da tamamlandığı anlamına gelir.

## 3. Sıralı İş Paketleri

### Aşama 0 — Gereksinim ve Mimari Temizliği

**Durum:** Tamamlandı — 2026-10-09 22:47 +06:00

**Amaç:** Kodlamadan önce bütün gereksinimleri ve son mimari incelemede bulunan boşlukları tek, tutarlı bir kaynak haline getirmek.

**Tasarım çıktıları:**

- `docs/REQUIREMENTS.md`
- `docs/DECISIONS.md`
- Düzeltilmiş `docs/ARCHITECTURE.md` v1.1
- Kabul kriterleri ve kapsam dışı maddeler

**Netleştirilecek başlıklar:**

- Scheduler zamanı ve lease/fencing kuralları
- Availability ve veri kapsama semantiği
- Durum, çalışma, bakım ve freshness eksenleri
- Bakım–bildirim yarış durumları
- Operasyonel quota ile ürün limiti ayrımı
- Üretim yedekleme ve süreklilik beklentileri

**Tamamlanma ölçütü:** Birbiriyle çelişen gereksinim veya mimari kararı kalmaması.

---

### Aşama 1 — Domain Modeli ve Durum Makineleri

**Durum:** Tamamlandı — 2026-10-09 22:58 +06:00

**Amaç:** Veritabanı ve API'den önce iş alanını ve değişmez kuralları tanımlamak.

**Tasarım çıktıları:**

- `docs/DOMAIN_MODEL.md`
- `docs/STATE_MACHINES.md`
- Terimler sözlüğü

**Kapsam:**

- User, Check, Group, Check Run ve Check Job
- Current State ve freshness
- Incident yaşam döngüsü
- Maintenance Window
- Notification Intent ve Delivery
- Public Status Page
- Prediction Score
- Pause, resume, edit, delete ve manual-run davranışları
- Grup durumu türetme kuralları
- Zaman dilimi ve `[start, end)` kuralları

**Tamamlanma ölçütü:** Bütün durum geçişlerinin geçerli, geçersiz ve idempotent davranışlarının örneklerle tanımlanmış olması.

---

### Aşama 2 — Repository, Araç Zinciri ve Yerel Geliştirme Temeli

**Durum:** Tamamlandı — 2026-10-10 00:50 +06:00

**Amaç:** Bütün sonraki bileşenlerin aynı kalite ve çalışma kurallarına sahip olacağı monorepo temelini kurmak.

**Tasarım çıktısı:**

- `docs/DEVELOPMENT_ENVIRONMENT.md`

**Uygulama kapsamı:**

- Node/TypeScript workspace yapısı
- React, API ve worker entrypoint'leri
- Python predictor için bağımsız, kilitli ortam
- Ortak domain, database, contract ve observability paketleri
- Docker Compose başlangıç yapısı
- Ortam değişkeni doğrulaması ve `.env.example`
- Format, lint, type-check ve test komutları
- İlk CI pipeline'ı
- Başlangıç README'si

**Tamamlanma ölçütü:** Temiz bir ortamda tek belgelenmiş akışla bağımlılıkların kurulması ve boş servislerin doğrulama kontrollerinden geçmesi.

---

### Aşama 3 — Nihai Veritabanı ve Kalıcılık Mimarisi

**Durum:** 2026-10-10 tarihinde tasarlandı, uygulandı ve doğrulandı.

**Amaç:** Bütün ana ve opsiyonel bileşenleri destekleyen v1 veritabanı mimarisini uygulamadan önce kesinleştirmek.

**Tasarım çıktıları:**

- `docs/DATABASE.md`
- ER diyagramı
- Tablo ve kolon sözlüğü
- İndeks ve sorgu planı
- RLS ve veritabanı rol matrisi
- Partition, rollup ve retention planı
- Migration, backup ve restore yaklaşımı

**Kapsam:**

- Kullanıcılar ve session'lar
- Kontroller ve gruplar
- Current state, jobs ve runs
- Incident'lar
- Bakım pencereleri
- Notification/outbox tabloları
- Public sayfa yapılandırması
- Rollup tabloları
- Prediction tabloları
- Composite sahiplik kısıtları
- Lease ve fencing alanları
- UTC zaman semantiği
- Soft/hard delete kararları

**Uygulama kapsamı:** Migration altyapısı, başlangıç şeması, test veritabanı ve seed mekanizması.

**Tamamlanma ölçütü:** Sıfırdan migration, geri yükleme testi, sahiplik kısıtları ve kritik indekslerin entegrasyon testleriyle doğrulanması.

---

### Aşama 4 — API, Event ve Hata Sözleşmeleri

**Durum:** Tamamlandı — tasarım onaylandı; sözleşme üretimi, API sınırı ve revision 7 migration doğrulandı

**Amaç:** Frontend, API ve worker'ların uygulama öncesinde aynı sözleşmeler üzerinde anlaşmasını sağlamak.

**Tasarım çıktıları:**

- `docs/API_DESIGN.md`
- İlk OpenAPI sözleşmesi
- Domain event kataloğu
- SSE event sözleşmesi
- Problem-details hata formatı

**Kapsam:**

- Auth endpoint'leri
- Check ve group kaynakları
- Manual-run komutu
- Maintenance ve notification ayarları
- Incident ve history sorguları
- Public status endpoint'leri
- Prediction endpoint'i
- Pagination, filtreleme, sıralama ve idempotency
- API versiyonlama yaklaşımı

**Tamamlanma ölçütü:** Frontend ve backend'in mock sözleşme üzerinden bağımsız geliştirilebilmesi.

---

### Aşama 5 — Kimlik Doğrulama ve Kullanıcı İzolasyonu

**Durum:** Tamamlandı — tasarım, uygulama ve yerel kabul kapıları doğrulandı

**Amaç:** Diğer bütün kullanıcı kaynaklarından önce güvenli kimlik ve sahiplik temelini kurmak.

**Tasarım çıktısı:**

- `docs/AUTH_AND_OWNERSHIP.md`

**Uygulama kapsamı:**

- Kayıt, giriş, çıkış ve session rotation
- Güvenli parola saklama
- HTTP-only cookie ve CSRF koruması
- E-posta doğrulama ve parola sıfırlama sınırları
- RLS request bağlamı
- API ve worker veritabanı rolleri
- Rate limiting
- Kullanıcılar arası erişim engelleri
- Temel audit olayları

**Tamamlanma ölçütü:** Her kaynak türü için negatif cross-user erişim testlerinin geçmesi ve connection-pool bağlam sızıntısının engellenmesi.

---

### Aşama 6 — Kontrol ve Grup Yönetimi

**Durum:** Nihai tasarım hazır — 2026-10-10 06:52 +06:00; kullanıcı incelemesinde, uygulama başlamadı

**Amaç:** Monitoring çalıştırılmadan önce kontrol yapılandırmasının güvenilir CRUD modelini oluşturmak.

**Tasarım çıktısı:**

- `docs/CHECKS_AND_GROUPS.md`

**Uygulama kapsamı:**

- Check ekleme, düzenleme, listeleme ve silme
- Pause ve resume
- Grup oluşturma ve yönetme
- Bir kontrolün sıfır veya bir gruba bağlanması
- URL, interval, timeout, expected status ve expected text doğrulaması
- Config version ve audit geçmişi
- Manuel kontrol talebinin API tarafı
- Kullanıcı bazlı operasyonel quota altyapısı

**Tamamlanma ölçütü:** CRUD, sahiplik, doğrulama, eşzamanlı düzenleme ve silme politikalarının entegrasyon testlerinden geçmesi.

---

### Aşama 7 — Güvenli HTTP Kontrol Motoru ve Hedef Simülatörü

**Amaç:** Scheduler'dan bağımsız, deterministik ve güvenli bir HTTP kontrol motoru geliştirmek.

**Tasarım çıktısı:**

- `docs/CHECK_ENGINE.md`

**Uygulama kapsamı:**

- DNS, TCP, TLS, TTFB ve toplam süre ölçümü
- Status code ve body text doğrulaması
- Connect ve toplam timeout
- Streaming ve response-size sınırı
- Redirect politikası
- IPv4/IPv6 davranışı
- SSRF, DNS rebinding ve private-address koruması
- Yapılandırılmış hata kategorileri
- Ham response body'nin saklanmaması
- Başarılı, yavaş, hatalı, redirect, flaky ve hang endpoint'lerine sahip target simulator

**Tamamlanma ölçütü:** Kontrol motorunun saf entegrasyon testlerinde bütün başarı, hata, timeout ve SSRF senaryolarını doğru sınıflandırması.

---

### Aşama 8 — Sağlık Durumu, Incident ve Grup Durumu

**Amaç:** Scheduler'dan bağımsız olarak sonuçlardan deterministik durum geçişleri üreten domain katmanını uygulamak.

**Tasarım çıktısı:**

- Kabul edilmiş `STATE_MACHINES.md` belgesinin uygulanabilir geçiş tablosu

**Uygulama kapsamı:**

- `UNKNOWN`, `UP`, `SUSPECT`, `DOWN` sağlık durumları
- Ayrı `ACTIVE/PAUSED`, maintenance ve freshness eksenleri
- Ardışık başarısızlık eşiği
- Incident açma, güncelleme ve kapatma
- İlk başarısızlığa dayanan incident başlangıcı
- Stale sonuç ve fencing-token reddi
- Grup durumunun türetilmesi
- Config değişimi ve unpause sonrası state davranışı

**Tamamlanma ölçütü:** Geçiş matrisi, property/sequence testleri ve aynı olayın tekrar uygulanmasına karşı idempotency testlerinin geçmesi.

---

### Aşama 9 — Kalıcı Scheduler ve Monitor Worker

**Amaç:** Kontrolleri zamanında, adil, yatay ölçeklenebilir ve aynı kontrolü kendisiyle çakıştırmadan çalıştırmak.

**Tasarım çıktısı:**

- `docs/SCHEDULER_AND_WORKERS.md`

**Uygulama kapsamı:**

- `next_run_at` cadence algoritması
- Kaçırılmış kontrolleri backfill etmeme
- Jitter
- PostgreSQL job queue
- `SKIP LOCKED`, lease, heartbeat ve fencing token
- Aynı kontrol için tek aktif iş
- Manual-run coalescing
- Kullanıcı ve hostname fairness
- Configurable concurrency
- Graceful shutdown ve crash recovery
- Sonuç, current state, incident ve outbox transaction'ı

**Tamamlanma ölçütü:** Birden fazla worker, uzun kontrol, process kill, lease kaybı, yeniden başlatma ve manuel/periyodik çakışma testlerinin geçmesi.

---

### Aşama 10 — Bakım Pencereleri

**Amaç:** Kontrolleri durdurmadan bildirimleri bastıran, zaman ve yarış koşulları açık bir bakım modeli uygulamak.

**Tasarım çıktısı:**

- `docs/MAINTENANCE_WINDOWS.md`

**Uygulama kapsamı:**

- Kontrol ve grup kapsamlı bakım
- UTC ve `[start, end)` semantiği
- Örtüşen pencereler
- Aktif pencereyi uzatma, kısaltma ve silme
- Bakım sırasında incident davranışı
- Bakım bitiş reconciliation işi
- Grup değişikliği sırasında bakım kapsamı

**Tamamlanma ölçütü:** Sınır anları, örtüşen bakım ve bakım sırasında incident açılıp kapanması senaryolarının zaman kontrollü testlerle geçmesi.

---

### Aşama 11 — Transactional E-posta ve Bildirim Sistemi

**Amaç:** Kesinti ve recovery e-postalarını tekrarsız, bakım kurallarıyla uyumlu ve ana sistemden izole biçimde göndermek.

**Tasarım çıktısı:**

- `docs/NOTIFICATIONS.md`

**Uygulama kapsamı:**

- Varsayılan ve grup bazlı alıcılar
- Alıcı doğrulama
- Transactional outbox
- Notification delivery state machine
- DOWN/RECOVERY eşleştirmesi
- Bakım sırasında erteleme veya iptal
- Retry, exponential backoff ve dead-letter davranışı
- SMTP adapter
- Mailpit geliştirme ortamı
- HTML ve text şablonları
- URL ve hassas veri maskeleme
- Test e-postası ve abuse rate limit'i

**Tamamlanma ölçütü:** E-posta sağlayıcısı kapalı, yavaş veya belirsiz sonuç verdiğinde monitoring sisteminin etkilenmemesi; incident başına beklenen alıcıya yalnızca doğru olayların üretilmesi.

---

### Aşama 12 — Geçmiş, Rollup, Availability ve Housekeeping

**Amaç:** Ham veri büyürken günlük, haftalık ve aylık geçmişin hızlı ve doğru açılmasını sağlamak.

**Tasarım çıktısı:**

- `docs/HISTORY_AND_RETENTION.md`

**Uygulama kapsamı:**

- Aylık partition yönetimi
- İndeks stratejisi
- Dakikalık/saatlik rollup
- Zaman ağırlıklı availability
- Data coverage ve unknown aralıkları
- Incident süre hesapları
- Geç gelen sonuçların rollup'a etkisi
- İdempotent housekeeping işleri
- Raw ve aggregate retention
- Partition ön oluşturma ve temizleme
- Query timeout ve pagination

**Tamamlanma ölçütü:** Büyük sentetik veri setinde gün/hafta/ay sorgularının belirlenen performans bütçesini karşılaması ve boşlukların düşüş sayılmaması.

---

### Aşama 13 — Canlı Güncelleme Altyapısı

**Amaç:** Yönetim ve public sayfaların yenileme yapılmadan güvenli biçimde güncellenmesi.

**Tasarım çıktısı:**

- `docs/REALTIME.md`

**Uygulama kapsamı:**

- PostgreSQL `LISTEN/NOTIFY`
- Authenticated ve public SSE kanalları
- Event filtreleme ve sahiplik izolasyonu
- Heartbeat ve yeniden bağlanma
- Snapshot ile tutarlılık kazanma
- Proxy buffering ayarları
- Connection limiti ve rate limiting
- Polling fallback

**Tamamlanma ölçütü:** İki tarayıcıda otomatik güncelleme, bağlantı kopması, API replica değişimi ve kaçırılmış event sonrası snapshot senaryolarının geçmesi.

---

### Aşama 14 — Authenticated Frontend

**Amaç:** Ana yönetim deneyimini tamamlamak.

**Tasarım çıktıları:**

- `docs/FRONTEND_ARCHITECTURE.md`
- Ana ekran wireframe ve durum matrisi

**Uygulama kapsamı:**

- Giriş ve hesap akışları
- Dashboard
- Check ve group yönetimi
- Manuel çalıştırma
- Güncel durum, freshness ve bakım gösterimi
- History grafikleri ve availability
- Incident günlüğü
- Maintenance yönetimi
- Notification ayarları
- Loading, empty, error ve stale durumları
- Responsive ve erişilebilir arayüz

**Tamamlanma ölçütü:** Kritik kullanıcı akışlarının Playwright testleriyle ve iki açık istemciyle doğrulanması.

---

### Aşama 15 — Public Durum Sayfası

**Amaç:** Giriş gerektirmeyen fakat veri yayınlama izinlerine kesin olarak uyan public görünümü sağlamak.

**Tasarım çıktısı:**

- `docs/PUBLIC_STATUS.md`

**Uygulama kapsamı:**

- Döndürülebilir ve iptal edilebilir public slug
- Seçili grup/check yayınlama
- Alan bazlı görünürlük
- Gerçek URL'nin varsayılan olarak gizlenmesi
- Public REST projection
- Public SSE veya polling fallback
- Cache ve abuse koruması
- Public görünüm frontend'i

**Tamamlanma ölçütü:** Yayınlanmayan hiçbir alanın REST, SSE, hata mesajı veya sayfa kaynağı üzerinden sızmaması.

---

### Aşama 16 — Opsiyonel Python Erken Uyarı Sistemi

**Amaç:** Ana ürüne bağımlılık oluşturmadan açıklanabilir risk sinyalleri üretmek.

**Tasarım çıktısı:**

- `docs/PREDICTION_SYSTEM.md`

**Uygulama kapsamı:**

- Feature sözleşmesi
- Coalesced analysis jobs
- İstatistiksel baseline ve trend analizi
- Risk skoru, geçerlilik ve açıklamalar
- Model/algoritma sürümleme
- Eski tahmin davranışı
- Ayrı DB rolü, timeout ve resource limitleri
- Feature flag
- Opsiyonel `PREDICTIVE_WARNING`
- Frontend risk paneli

**Tamamlanma ölçütü:** Predictor kapatıldığında, öldürüldüğünde, backlog oluşturduğunda veya hatalı model kullandığında ana sistemin performans ve doğruluğunun etkilenmemesi.

---

### Aşama 17 — Gözlemlenebilirlik ve Operasyonel Sertleştirme

**Amaç:** Sistemin kendi sağlığının ölçülebilir, sorunlarının teşhis edilebilir ve üretim operasyonlarının tanımlı olması.

**Tasarım çıktıları:**

- `docs/OBSERVABILITY.md`
- `docs/OPERATIONS.md`
- `docs/SECURITY.md`

**Uygulama kapsamı:**

- Structured log ve redaction
- Correlation, job, run ve incident kimlikleri
- Metrikler ve dashboard tanımları
- Liveness/readiness
- Ana sistem SLO/SLI'ları
- Queue-lag ve stale-check uyarıları
- Audit log
- Secret yönetimi
- Backup, PITR ve restore prosedürü
- RPO/RTO hedefleri
- Graceful deployment ve migration sırası
- Dependency/container güvenlik kontrolleri

**Tamamlanma ölçütü:** Operatörün yalnızca log ve metriklerle geciken kontrolleri, worker arızasını, mail kuyruğunu ve veri tabanı sorunlarını teşhis edebilmesi; restore prosedürünün doğrulanması.

---

### Aşama 18 — Sistem Geneli Performans ve Dayanıklılık Doğrulaması

**Amaç:** Parça testlerinden sonra bütün sistemin gereksinimleri birlikte karşıladığını kanıtlamak.

**Tasarım çıktısı:**

- `docs/TEST_STRATEGY.md`
- Tekrarlanabilir benchmark ve failure-test senaryoları

**Kapsam:**

- 20, 200 ve 500 kontrol yük profilleri
- Bütün hedeflerin yavaş veya timeout olması
- Birden fazla monitor worker
- Worker kill ve lease recovery
- API ve SSE eşzamanlı kullanıcı yükü
- Büyük aylık geçmiş sorguları
- SMTP kesintisi
- PostgreSQL yeniden başlatma
- Predictor kesintisi ve backlog
- İki tarayıcıda canlı güncelleme
- Kullanıcı izolasyonu saldırı testleri
- SSRF ve redirect testleri

**Tamamlanma ölçütü:** Önceden tanımlanan performans bütçeleri ve mimari başarı kriterlerinin ölçümlü raporla karşılanması.

---

### Aşama 19 — Teslim, Kanıt ve GitHub Hazırlığı

**Amaç:** Projeyi değerlendirilebilir, dürüst ve yeniden üretilebilir biçimde teslim etmek.

**Çıktılar:**

- Tamamlanmış `README.md`
- `docs/AI_USAGE.md`
- Güncel `docs/DECISIONS.md`
- Güncel `docs/DEVELOPMENT_LOG.md`
- Güncel `docs/PROJECT_STATUS.md`
- `docs/NEXT_STEPS.md`
- Mimari ve API dokümantasyonu
- Demo verisi ve doğrulama senaryosu
- Test ve performans raporu
- Kullanılan template/generator/kaynak listesi
- GitHub repository bağlantısı

**Tamamlanma ölçütü:** Temiz bir makinede belgelenen komutlarla kurulum, migration, seed, uygulama başlatma, test ve demo akışının başarıyla tekrar edilmesi.

## 4. Bağımlılık Özeti

```text
0  Gereksinim ve mimari temizliği
↓
1  Domain modeli ve durum makineleri
↓
2  Repository ve geliştirme temeli
↓
3  Veritabanı mimarisi
↓
4  API ve event sözleşmeleri
↓
5  Auth ve kullanıcı izolasyonu
↓
6  Check ve group yönetimi
↓
7  Güvenli kontrol motoru
↓
8  Durum ve incident motoru
↓
9  Scheduler ve monitor worker
↓
10 Bakım pencereleri
↓
11 E-posta ve bildirimler
↓
12 Geçmiş, rollup ve availability
↓
13 Canlı güncelleme
↓
14 Yönetim frontend'i
↓
15 Public durum sayfası
↓
16 Opsiyonel Python predictor
↓
17 Operasyonel sertleştirme
↓
18 Sistem geneli doğrulama
↓
19 Teslim
```

Bu sıra ana bağımlılık sırasıdır. Bir aşama uygulamaya geçmeden önce kendi tasarım belgesi tamamlanır. Çapraz güvenlik, test, loglama ve dokümantasyon işleri son aşamaya ertelenmez; her aşamada uygulanır, Aşama 17 ve 18'de sistem genelinde tekrar doğrulanır.

## 5. Aktif İş ve Sonraki Geçiş

**Aşama 2 — Repository, Araç Zinciri ve Yerel Geliştirme Temeli** tamamlanmıştır. Workspace scaffold'u, kilitli bağımlılıklar, minimal runtime'lar, container profilleri, CI ve yerel kalite/E2E kanıtları `docs/DEVELOPMENT_ENVIRONMENT.md` ve `docs/PROJECT_STATUS.md` içinde kayıtlıdır.

**Aşama 3 — Nihai Veritabanı ve Kalıcılık Mimarisi** tamamlanmıştır. Altı migration, idempotent seed, tipli erişim yüzeyi, RLS/rol sınırları, partition'lar, migration container'ı ve gerçek PostgreSQL entegrasyon paketi uygulandı. Sıfırdan migration ile ayrı veritabanına mantıksal restore doğrulandı.

**Aşama 4 — API, Event ve Hata Sözleşmeleri** tamamlanmıştır. Canonical OpenAPI'den TypeScript tipleri ve Fastify runtime şemaları üretilir; CI drift ve güvenlik metadata'sını kontrol eder. Merkezi RFC 9457 mapper, UUIDv7 request korelasyonu ve revision 7 idempotency receipt şeması uygulanıp test edilmiştir. OpenAPI'deki ürün route'larının iş davranışı tamamlanmış sayılmaz; her route kendi Aşama 5–15 domain diliminde bu sözleşmeye bağlanacaktır.

**Aşama 5 — Kimlik Doğrulama ve Kullanıcı İzolasyonu** tamamlanmıştır. Opaque session, Argon2id/parola politikası, CSRF/origin, enumeration-safe token akışları, PostgreSQL rate limiting, encrypted durable auth e-postası, profil ETag'i ve RLS sahiplik sınırı revision 8–11 ile uygulanmıştır. Unit, PostgreSQL integration, Mailpit ve Playwright kabul akışları geçmiştir.

**Sıradaki çalışma Aşama 6 — Kontrol ve Grup Yönetimi tasarımı**dır. Kodlamadan önce `docs/CHECKS_AND_GROUPS.md` içinde CRUD, validation, ETag/idempotency, quota ve sahiplik davranışları nihai hale getirilecektir.
