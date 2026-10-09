# Geliştirme Günlüğü

Tüm zamanlar UTC+06:00 olarak kaydedilir. Uygulama içindeki kalıcı domain zamanları UTC tutulacaktır.

## 2026-10-09

### 22:23 — Başlangıç mimarisi

- İstemci-sunucu ürün gereksinimleri incelendi.
- React/TypeScript, Node.js/TypeScript, PostgreSQL ve opsiyonel Python predictor içeren başlangıç mimarisi kaydedildi.
- Kullanıcı bazlı sahiplik, organizasyon kapsamının dışında bırakıldı.
- Kontrol sayısı için sabit 50 sınırı kullanılmaması kararlaştırıldı.

### 22:35 — Uygulama planı

- Proje 20 sıralı iş paketine ayrıldı.
- Her aşama için tasarım-kabul-uygulama-test kapısı belirlendi.
- İlk iş paketi gereksinim ve mimari temizliği olarak seçildi.

### 22:47 — Aşama 0: Gereksinim ve mimari temizliği

- Normatif ürün ve kalite gereksinimleri kimliklendirilerek yazıldı.
- Tekrarlanabilir kabul kriterleri oluşturuldu.
- Scheduler cadence, lease/fencing, availability, state eksenleri, bakım-bildirim yarışları, quota ayrımı ve üretim PostgreSQL sürekliliği kararları kesinleştirildi.
- Karar günlüğü başlatıldı.
- Mimari v1.1 güncellemesi hazırlandı.
- Bu aşamada uygulama kodu veya veritabanı şeması oluşturulmadı.

### 22:58 — Aşama 1: Domain modeli ve durum makineleri

- Domain modülleri, aggregate sınırları, değer nesneleri, komutlar ve transaction sınırları tanımlandı.
- Check lifecycle, execution, job, freshness, health, incident, maintenance, notification, public page ve prediction durum makineleri yazıldı.
- Manual run'ın ACTIVE durumda stateful, PAUSED durumda diagnostic olması kararlaştırıldı.
- Monitoring data gap'lerinde incident'ın açık/unobserved kalması ve observed duration'ın yalnızca DOWN segmentlerinden hesaplanması kararlaştırıldı.
- Resource version, probe generation, schedule generation ve fencing token sorumlulukları ayrıldı.
- Probe config değişimi, pause/resume, group taşıma/silme ve check delete edge case'leri kesinleştirildi.
- Gereksinim, kabul kriteri ve karar günlükları yeni domain kararlarıyla güncellendi.
- Bu aşamada uygulama kodu veya veritabanı şeması oluşturulmadı.

### 23:06 — Aşama 2: Repository ve geliştirme ortamı tasarımı

- Polyglot monorepo dizin yapısı, workspace sınırları ve bağımlılık yönleri tanımlandı.
- Node.js 24 LTS, pnpm 11.25, ESM ve strict TypeScript araç tabanı seçildi.
- Opsiyonel predictor için Python 3.14, uv ve bağımsız lockfile yaklaşımı seçildi.
- Host uygulamalar/container altyapı, tam container stack ve ayrı prediction profile çalışma biçimleri tanımlandı.
- Root komut sözleşmesi, kalite araçları, test katmanları, CI işleri, config/secret ilkeleri ve image kuralları kesinleştirildi.
- Windows/Linux uyumluluğu ve temiz ortam doğrulama kapıları belirlendi.
- Bu aşamada Git repository, scaffold, bağımlılıklar, Compose servisleri veya uygulama kodu oluşturulmadı; tasarım kullanıcı incelemesine bırakıldı.

### 23:16 — Aşama 2 uygulaması: Git ve yerel container altyapısı

- Klasör `main` başlangıç dalıyla yerel Git repository olarak başlatıldı.
- Güvenli başlangıç ignore, satır sonu, editör ve örnek environment dosyaları eklendi.
- PostgreSQL `18.6-bookworm` ve Mailpit `v1.31.4` için Compose tanımı oluşturuldu.
- Mevcut başka bir projeye ait `5432` portuna dokunulmadı; bu projenin host PostgreSQL portu `15432` olarak ayrıldı.
- Her iki container başlatıldı ve Docker healthcheck'leri başarılı oldu.
- PostgreSQL bağlantısı `site_monitor` database/user ile ve Mailpit API'si v1.31.4 olarak doğrulandı.
- Yerel Git kimliği ve GitHub remote bilgisi bulunmadığı için commit/push yapılmadı.
- API, frontend, worker, target simulator ve predictor container'ları henüz oluşturulmadı.

### 23:19 — GitHub remote bağlantısı

- GitHub repository `origin` remote olarak `https://github.com/EgeSensozKarayaka/testproject.git` adresine bağlandı.
- Remote erişimi başarıyla doğrulandı; repository henüz ref döndürmediği için boş repository olarak değerlendirildi.
- Repository-local Git kullanıcı adı `Ege` olarak ayarlandı.
- Commit e-posta adresi verilmediği için ilk commit ve push bilinçli olarak bekletildi.

### 23:21 — Git commit kimliği

- Repository-local Git kimliği `Ege <sensozegekarayaka@gmail.com>` olarak tamamlandı.
- Global Git yapılandırması değiştirilmedi.

### 23:22 — İlk GitHub teslimi

- Gereksinim ve mimari belgeleri `docs: define project requirements and architecture` commit'iyle kaydedildi.
- Git ve Docker altyapısı `chore: add local infrastructure compose` commit'iyle ayrı tutuldu.
- Yerel `main` dalı GitHub `origin/main` dalına başarıyla gönderildi ve upstream bağlantısı kuruldu.

## 2026-10-10

### 00:50 — Aşama 2 uygulaması tamamlandı

- Node.js 24.19.0 ve pnpm 11.25.0 ile 14 projelik polyglot workspace kuruldu; bağımlılıklar exact sürümler ve lockfile ile sabitlendi.
- React/Vite web, Fastify API, monitor worker, notification worker ve deterministik target simulator runtime temelleri eklendi.
- Domain, contract, config, database, check-engine, notification, observability ve testing package sınırları oluşturuldu.
- Python 3.14.8 ve uv 0.12.20 ile opsiyonel predictor package/lock/test temeli kuruldu.
- Strict TypeScript, ESLint, Prettier, Vitest, Playwright, Ruff, mypy, pytest ve coverage kapıları uygulandı.
- `pnpm run ci` format, lint, typecheck, 8 Node testi, integration keşfi ve bütün production build'leriyle geçti.
- Predictor testleri 3'ten 10'a genişletildi; config sınırları, database failure ve HTTP health sözleşmesi test edildi; coverage `%84.95` oldu.
- Multi-stage ve non-root Node, web ve predictor image'ları gerçek Docker build ile doğrulandı.
- `app` profilindeki API, web, iki worker, target simulator, PostgreSQL ve Mailpit birlikte sağlıklı başladı.
- Target simulator `200`/`503`, worker readiness ve web/API browser entegrasyonu doğrulandı.
- Playwright ile iki bağımsız browser context aynı anda başarıyla çalıştı.
- Predictor ayrı profile ile başlatıldı; predictor durdurulduktan sonra API'nin sağlıklı kaldığı doğrulandı.
- İlk container build'inde app build argümanının dependency katmanını gereksiz yere çoğalttığı görüldü; Dockerfile arg konumu değiştirilerek dört Node servisinin kurulum katmanı ortaklaştırıldı.
- `pnpm ci` komutunun pnpm yerleşik kurulum alias'ıyla çakıştığı bulundu; CI ve belgeler `pnpm run ci` olarak düzeltildi.
- Playwright Chromium CDN'i yerel ağda timeout verdi; aynı test paketi kurulu Microsoft Edge kanalıyla geçirildi. CI, Chromium kurulumunu sürdürür.
- Migration, seed ve reset uygulaması Aşama 3 veritabanı tasarımı onaylanana kadar bilinçli olarak ertelendi.
- İlk uzak CI koşusunda `setup-uv@v10` hareketli etiketi çözümlenemedi; resmi `v10.2.0` release'i doğrulanıp workflow tam sürüme pinlendi.
- uv managed-Python kataloğunda `3.14.8` henüz bulunmadığı, GitHub'ın resmi Python toolcache'inde bulunduğu doğrulandı; CI tam sürümü `actions/setup-python@v7` ile kuracak şekilde düzeltildi.
- Temiz Linux runner'da type-aware ESLint'in workspace `dist` declaration'ları olmadan package tiplerini çözemediği görüldü; `pnpm lint` gerekli ortak paket build'ini kendi içinde yapacak biçimde deterministik hale getirildi.

### 01:13 — Aşama 3 veritabanı ve kalıcılık tasarımı

- PostgreSQL 18.6 için SQL-first migration ve Kysely tabanlı tipli query yaklaşımı tasarlandı.
- Kullanıcı, check/group, job/attempt/run, current state, health interval, incident, maintenance, notification, outbox, public status, rollup, prediction ve audit tablolarının kolon sözlüğü tamamlandı.
- UUIDv7, composite owner foreign key, transaction-local user context, FORCE RLS ve ayrı least-privilege service rolleri kesin tasarım önerisi olarak kaydedildi.
- Partitioned run kimliklerinin PostgreSQL unique constraint ve sahiplik kuralları nedeniyle `(owner_id,finished_at,id)` olması ve run referanslarının aynı üçlüyü taşıması belirlendi.
- Tek açık health interval'ın partitioned geçmişten ayrı tutulması, UNKNOWN/coverage semantiği ve minute/hour rollup yaklaşımı tasarlandı.
- Kritik query/indeksler, scheduler lease/fencing akışı, retention, forward-only migration, seed/test database, backup/PITR ve restore drill planlandı.
- PostgreSQL 18 UUIDv7, partition constraint, RLS ve transaction-local setting davranışları resmi PostgreSQL belgeleriyle doğrulandı.
- Bu turda migration, seed, şema SQL'i, dependency veya uygulama kodu yazılmadı; tasarım kullanıcı incelemesine bırakıldı.

### 02:24 — Aşama 3 veritabanı ve kalıcılık uygulaması

- Kullanıcı onayı sonrasında altı forward-only SQL migration ile rol/şema bootstrap'ı, auth/core, monitoring, messaging/public/prediction/audit, RLS/privilege ve başlangıç partition'ları uygulandı.
- Migration runner'a advisory lock, SHA-256 checksum ledger, transaction sınırı, schema compatibility ve idempotent no-op davranışı eklendi.
- `db:migrate`, non-production `db:seed`, açık onay ve hedef allowlist'i gerektiren `db:reset` ile `db:status` komutları gerçek uygulamaya bağlandı.
- Run anahtarı, ilk tasarımdaki üçlü locator yerine check lineage'ını da veritabanında koruyan `(owner_id,check_id,finished_at,id)` biçiminde güçlendirildi; tasarım belgeleri buna göre güncellendi.
- Geniş database `CREATE` yetkisi verme girişimi güvenlik incelemesinde reddedildi; schema owner'ın database CREATE yetkisi olmadan objeler migrator tarafından oluşturulup sahipliği devredildi.
- 29 private parent tabloda `ENABLE/FORCE RLS`, composite owner/check foreign key'leri, dar `SECURITY DEFINER` fonksiyonları ve PII içermeyen predictor feature view oluşturuldu.
- Kysely 0.29.6 ile şema-tipli sorgu yüzeyi ve transaction-local kullanıcı bağlam helper'ı eklendi. Readiness artık varsayılan olarak tam revision 6 ve doğru compatibility epoch gerektiriyor.
- Gerçek PostgreSQL entegrasyon paketi 10 testle sıfırdan migration, idempotency, checksum drift, seed, RLS context temizliği, çapraz-owner reddi, rol sınırları, indeks/partition ve reset guard davranışlarını doğruladı.
- Ayrı migration Docker image'ı ve Compose one-shot işi eklendi; API/worker/predictor süreçleri başarılı migration'a bağlandı. Tam `app` profili yeniden build edilip bütün healthcheck'lerle sağlıklı başladı.
- Ana local veritabanının mantıksal yedeği ayrı `site_monitor_restore_test` veritabanına başarıyla geri yüklendi. Revision 6, altı ledger kaydı, demo kullanıcı/check ve 29 `FORCE RLS` tablo doğrulandı; yalnız geçici test veritabanı ve dump dosyası ardından silindi.
- Local restore provası production RPO/RTO/PITR hedeflerinin sağlandığı şeklinde yorumlanmadı; bu hedefler gerçek production altyapısı ve sağlayıcı drill'i kurulana kadar açık sınırlamadır.
- Birleşik kalite kapısında entegrasyon komutunun Vitest 5'te glob'u düz filtre sayıp dosyayı atladığı fark edildi. Script platform bağımsız dosya keşfi yapacak şekilde düzeltildi; kök komut gerçek PostgreSQL ile 10/10 testi çalıştırdı.
- Son `pnpm run ci` format, lint, strict typecheck, 8 unit test, entegrasyon dosyası keşfi ve bütün build'lerle geçti. Ayaktaki stack üzerinde Playwright web/API ve iki eşzamanlı client senaryoları 2/2 geçti.

### 02:57 — Aşama 4 API, event ve hata sözleşmesi tasarımı

- Private `/api/v1`, public `/api/public/v1` kaynakları ve açık command endpoint'leri için normatif API tasarımı hazırlandı.
- OpenAPI 3.1 başlangıç sözleşmesinde auth, account, dashboard, check/group, incident, maintenance, notification, public page, public snapshot ve SSE yolları ile temel DTO'lar tanımlandı.
- Mutable kaynaklarda `ETag`/`If-Match`, retry edilen create/command'larda `Idempotency-Key` ve büyüyen listelerde opaque keyset cursor yaklaşımı kesin tasarım önerisi oldu.
- Aşama 3 şemasında genel HTTP idempotency receipt'i bulunmadığı saptandı; geçmiş migration'ları değiştirmeden Aşama 4 uygulamasında yeni forward-only `infra.api_idempotency_records` migration'ı planlandı.
- RFC 9457 uyumlu problem-details zarfı, stabil hata kodları, JSON Pointer alan hataları, retry semantiği ve cross-owner/public-token varlığını gizleyen `404` davranışı tanımlandı.
- İç domain event'leri için version'lı minimal envelope, transactional outbox, aggregate başına sıra, at-least-once teslim, consumer idempotency ve PII/token minimizasyonu belirlendi.
- Browser SSE akışı internal event bus'tan ayrıldı; private/public allowlist projection, stream-first snapshot uzlaştırması, 15 saniye heartbeat, 60 saniye REST reconciliation, bounded backpressure ve polling fallback tasarlandı.
- Public SSE'nin private kimlik veya yapılandırma taşımaması için yalnız `status_page.updated` invalidation event'i yayınlaması seçildi.
- Güçlü ETag'in response gövdesindeki her değişimi temsil etmesi için check/group configuration DTO'ları canlı status projection'ından ayrıldı; liste/dashboard bileşiminde config ve status sürümleri ayrı tutuldu.
- SSE'de check configuration `resource_version` ile current-status `state_version` aynı sıra ekseninde karşılaştırılmayacak biçimde `check` ve `check_status` resource type'larına ayrıldı.
- Publish/link rotation idempotency replay'ının tek-seferlik public token'ı plaintext saklamadan çalışması için 24 saatlik application-layer encrypted response receipt'i tasarlandı.
- Bu turda uygulama kodu, dependency, migration veya mevcut veritabanı şeması değiştirilmedi; belgeler kullanıcı incelemesine bırakıldı.

### 03:19 — Aşama 4 çapraz sözleşme incelemesi

- OpenAPI ile Aşama 3 veritabanı/durum makineleri çapraz okunarak freshness adları, expected substring sınırı, incident status/observation ayrımı ve maintenance effective-state enum'u eşitlendi.
- Check/group configuration sürümleri canlı status projection sürümlerinden ayrıldı; güçlü ETag ve SSE event sıralamasının farklı version eksenlerini yanlış karşılaştırması engellendi.
- Public component izinleri mevcut şemadaki `show_url`, `show_response_time` ve `show_incident_history` alanlarıyla eşlendi; izin verilmeyen alanların public JSON'dan tamamen çıkarılması kararlaştırıldı.
- Outbox destination kataloğu uygulanmış `REALTIME`, `NOTIFICATION`, `PREDICTION`, `AUDIT` constraint'iyle uyumlu hale getirildi; scheduler/job ve history source-of-truth sınırları açıklandı.
- HTTP idempotency tasarımı takılabilir PROCESSING lease'i yerine receipt + domain mutation + outbox'ın aynı kısa transaction'da commit edilmesine sadeleştirildi.
- OpenAPI YAML parse edildi; 40 path, 57 benzersiz operation, 68 schema ve 437 local reference doğrulandı. Path parametreleri, schema required alanları ve authenticated unsafe operation CSRF parametreleri kontrol edildi.
- API endpoint kataloğundaki 57 operation ile OpenAPI'deki 57 operation bire bir eşleşti; domain modelindeki 38 zorunlu event'in tamamı final event kataloğunda bulundu.
