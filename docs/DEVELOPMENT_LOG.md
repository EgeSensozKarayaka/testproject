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

### 03:26 — Aşama 4 CI sonucu ve dürüst durum kaydı

- Aşama 4 tasarım commit'i `80045fc` olarak `origin/main` dalına gönderildi.
- GitHub Actions çalıştırması `37993088278` içinde Node kalite, Python predictor kalite ve dependency audit işleri başarılı oldu.
- PostgreSQL migration/isolation işi testlere ulaşmadan `Initialize containers` aşamasındaki Docker pull hatasıyla sona erdi; GitHub anotasyonu pull denemelerinin yeniden denemelerden sonra da exit code 1 verdiğini gösterdi.
- Full-stack smoke işi `Start full stack` aşamasında exit code 1 ile durdu ve bu nedenle Playwright raporu oluşmadı. Her iki container işinin aynı anda başlangıçta kesilmesi ortak Docker/registry problemiyle uyumludur, ancak ham log anonim görünümde erişilemediği için bu ikinci neden kesin sonuç olarak kaydedilmedi.
- Bu başarısızlık Aşama 4 sözleşme belgelerinde doğrulanmış bir kusur göstermediğinden tahmine dayalı uygulama veya workflow değişikliği yapılmadı; CI yeniden çalıştırması açık doğrulama işi olarak bırakıldı.

### 04:02 — Aşama 4 API sözleşme altyapısı uygulaması

- Canonical `docs/openapi-v1.yaml` dosyasından TypeScript istemci tipleri ve Fastify runtime route şemaları deterministik olarak üretilir hale getirildi; 57 operation için local reference, path parametresi, CSRF, idempotency ve `If-Match` kuralları drift kontrolüne bağlandı.
- RFC 9457 problem-details şemaları, domain event ve browser realtime envelope/allowlist sözleşmeleri ortak `@site-monitor/contracts` paketine eklendi.
- API katmanına UUIDv7 request korelasyonu, güvenli instance üretimi, merkezi hata eşleme, 64 KiB body sınırı, validation/malformed JSON/404/405 davranışı ve credential destekli dar CORS yapılandırması uygulandı.
- Daha önceki health DTO tasarımındaki `ok/degraded` ile çalışan servislerin `ok/unavailable` durumu arasındaki tutarsızlık canonical sözleşmede giderildi; health yanıtı `timestamp` ve `version` alanlarıyla runtime şemasına bağlandı.
- HTTP idempotency replay kayıtları için revision 7 forward-only migration'ı eklendi. Owner kapsamı, HMAC digest'leri, header allowlist'i, bounded response gövdesi, 24 saatlik retention, encrypted one-time secret alanları ve FORCE RLS politikaları tanımlandı.
- Gerçek PostgreSQL entegrasyon paketi revision 7 ve idempotency storage sınırları dahil **11/11**; Node unit/contract/API paketi **22/22** geçti.
- Birleşik `pnpm run ci` kalite kapısı format, generated-contract drift, lint, strict typecheck, 22 unit test, 11 PostgreSQL integration test ve tüm production build'leriyle başarıyla tamamlandı.
- `docker compose --profile app up --detach --build --wait` ile tüm imajlar temizden üretildi; migration işi `0` ile kapandı ve API, web, iki worker, PostgreSQL, Mailpit ile target simulator sağlıklı duruma geldi.
- Rebuild edilen stack üzerinde Playwright web/API smoke ve iki bağımsız browser context senaryosu **2/2** geçti. Canlı HTTP kontrolleri health sözleşmesini, query bilgisinin problem `instance` alanından çıkarılmasını ve `Allow: GET, HEAD` başlıklı stabil `405` yanıtını doğruladı.
- Docker bağımlılık indirmeleri registry bağlantısındaki tekrarlar nedeniyle yaklaşık dört dakika sürdü; retry mekanizmasıyla build başarıyla bitti ve uygulama kusuru gözlenmedi.
- Beş uygulama commit'i `origin/main` dalına gönderildi. GitHub Actions koşusu [`37996956618`](https://github.com/EgeSensozKarayaka/testproject/actions/runs/37996956618) içinde Node kalite, PostgreSQL migration/izolasyon, Python predictor kalite, dependency audit ve full-stack container smoke işlerinin tamamı geçti; önceki geçici container pull sorunu tekrarlanmadı.

### 04:15 — Aşama 5 kimlik ve sahiplik izolasyonu tasarımı

- Mevcut OpenAPI, auth tabloları, FORCE RLS politikaları, security-definer bootstrap fonksiyonları ve API rol grant'leri birlikte incelendi.
- `display_name` alanının veritabanında zorunlu fakat register sözleşmesinde bulunmaması, logout'un `401` ile idempotent açıklamasının çelişmesi ve token tüketiminin hesap mutation'ından ayrı bırakılması uygulama öncesi giderilecek sözleşme boşlukları olarak kaydedildi.
- JWT/browser storage yerine digest'i DB'de tutulan 256-bit opaque session; absolute/idle expiry, rotation/grace, password-version invalidation ve HttpOnly/Secure/SameSite cookie modeli seçildi.
- CSRF token'a ek olarak exact Origin, Fetch Metadata, JSON-only body, explicit credentialed CORS ve trusted-proxy sınırı tanımlandı.
- Parola tabanı güncel NIST/OWASP yönlendirmesiyle 15 karaktere çıkarıldı; Argon2id minimum parametreleri, bounded async concurrency, dummy hash ve rehash davranışı kesinleştirildi.
- Çok replica'da tutarlı auth abuse kontrolü için raw PII taşımayan PostgreSQL sayaçları; auth tablolarına geniş DML yerine dar atomik security-definer komutları tasarlandı.
- Verification/reset linklerinin SMTP arızasında kaybolmaması için encrypted payload taşıyan, incident bildirimlerinden ayrı durable transactional e-posta kuyruğu planlandı.
- Revision 8 şema/fonksiyon kapsamı, OpenAPI değişiklikleri, secret/key rotation, audit/metric allowlist'i, negatif güvenlik test matrisi ve on bir adımlı uygulama sırası `docs/AUTH_AND_OWNERSHIP.md` içinde kullanıcı incelemesine bırakıldı.
- Bu turda dependency, migration, route, frontend veya runtime kodu değiştirilmedi.

### 04:53 — Aşama 5 kimlik doğrulama uygulaması ve yerel kabul

- Canonical OpenAPI kayıt `display_name`, 15 karakter parola tabanı, generic token hatası, idempotent logout ve account profile sözleşmesiyle güncellendi; 57 operation'ın TypeScript ve Fastify artifact'leri yeniden üretildi.
- `packages/auth` içinde e-posta/display-name normalizasyonu, zxcvbn parola politikası, bounded Argon2id, 256-bit opaque token, SHA-256 digest, session-bound HMAC CSRF ve version'lı AES-256-GCM e-posta payload primitive'leri eklendi.
- Revision 8 session expiry/rotation, auth rate limit, durable transactional e-posta ve atomik account/session fonksiyonlarını ekledi. Temiz veritabanında bulunan notifier schema `USAGE` eksikliği revision 9 ile; anonymous idempotency revision 10 ile; profil ETag ve güvenli rehash sınırı revision 11 ile geçmiş migration'lar değiştirilmeden düzeltildi.
- Fastify'da enumeration-safe register/challenge, login/session/logout/reset/verification ve `GET/PATCH /me` route'ları; exact origin/fetch metadata, JSON-only, CSRF, cookie ve `If-Match` korumaları uygulandı.
- Notification worker encrypted payload'ı yalnız claim sonrasında çözüp Mailpit SMTP'ye gönderir hale getirildi; retry/fencing sonucu dışındaki secret veriler loglanmadı.
- React kayıt, giriş, parola sıfırlama, fragment tabanlı doğrulama ve authenticated temel ekranları uygulandı.
- Yerel kapılar: 35/35 unit, 12/12 gerçek PostgreSQL integration, strict typecheck ve 3/3 Playwright geçti. Playwright tam akışı UI kaydı, Mailpit mesajı, doğrulama, giriş ve çıkışı doğruladı.
- Docker'ın ilk Linux native dependency indirmesi yavaş sürdü fakat revision 11 migration ve bütün servis health kontrolleri tamamlandı.
- Aşama 5 altı anlamlı uygulama commit'i olarak `origin/main` dalına gönderildi. GitHub Actions koşusu [`38002790366`](https://github.com/EgeSensozKarayaka/testproject/actions/runs/38002790366) içinde Node kalite, PostgreSQL migration/izolasyon, Python predictor kalite, dependency audit ve full-stack container smoke işlerinin tamamı geçti.

### 06:52 — Aşama 6 kontrol ve grup yönetimi tasarımı

- Check/group CRUD, pause/resume/delete, manual-run API sınırı, owner quota, ETag/idempotency, cursor ve audit/outbox davranışları `docs/CHECKS_AND_GROUPS.md` içinde baştan sona tasarlandı.
- Mevcut şema, OpenAPI, domain modeli, state machine, event kataloğu ve kabul kriterleri çapraz incelendi. OpenAPI'deki group `description` alanının veritabanında bulunmadığı ve expected substring'in UTF-8 byte sınırının DB constraint'iyle korunmadığı saptandı; ikisi için forward-only revision 12 planlandı.
- URL güvenliği iki katmana ayrıldı: API bariz local/private literal ve credential'ı reddedecek; DNS/redirect/IP pinning ile authoritative SSRF kararı Aşama 7 kontrol motorunda verilecek. API transaction'ı DNS veya hedef HTTP çağrısı yapmayacak.
- PATCH alanları metadata, group, probe ve schedule sınıflarına ayrıldı; resource/probe/schedule version artışları, job invalidation, current-state/incident ve next-run sonuçları birleşik değişiklikler dahil kesinleştirildi.
- Manuel çalıştırma aktif iş yoksa doğrudan durable job, varsa tek `manual_requested_at` niyeti üretir; ACTIVE stateful, PAUSED diagnostic kalır ve cadence değişmez.
- Group delete'in check'leri aynı transaction'da ungroup edip her child ETag'ini artırması; move/delete yarışlarında deterministik group→check kilit sırası kullanılması seçildi.
- Sabit 50 kontrol limiti reddedildi. Deployment-configurable, owner bazlı ve advisory-lock ile replica-safe quota; rate limit ve worker concurrency'den ayrı tasarlandı.
- 20/200/500 fixture, iki sekmede stale ETag, concurrent manual coalescing, cross-owner 404, transaction rollback ve secret redaction dahil kabul/test matrisi çıkarıldı.
- Bu turda migration, dependency, route, UI veya runtime kodu değiştirilmedi. Tasarım kullanıcı incelemesine bırakıldı; Aşama 6 uygulaması sonraki onaylı turda başlayacak.

### 07:19 — Aşama 6 sözleşme, domain ve revision 12 temeli

- Kullanıcı onayıyla D-050–D-054 kararları Accepted yapıldı ve Aşama 6 uygulaması başlatıldı.
- OpenAPI check/group uçlarına eksik not-found/rate-limit cevapları, manuel receipt cache yasağı, URL canonicalization açıklaması ve expected substring boş/UTF-8 byte sınırı eklendi; 57 operation'ın TypeScript/runtime artifact'leri yeniden üretildi.
- `packages/domain` içinde bağımlılıksız check/group normalizasyonu, HTTP(S) URL canonicalization, credential ve bariz local/private/reserved IPv4/IPv6 engeli, UTF-8 expected-text sınırı ve PATCH değişiklik sınıflandırması uygulandı.
- Metadata, group, probe ve schedule değişiklikleri birleşik PATCH için ayrı sınıflandırıldı; normalize no-op davranışı testlendi.
- Forward-only revision 12, group description kolonunu ve expected body 1..2048 UTF-8 byte constraint'ini ekledi. API'nin check/group fiziksel DELETE yetkisi kaldırıldı; config/current-state/manual-job/audit/outbox için dar owner-scoped yazma sınırı açıldı.
- İlk entegrasyon turunda iki test-fixture kusuru (aynı PostgreSQL placeholder'ında UUID/text tip belirsizliği ve eski revision beklentisi) bulundu; migration geçmişi değiştirilmeden test kodu düzeltildi.
- Sonuç: domain/OpenAPI **32/32**, gerçek PostgreSQL migration/rol/RLS paketi **13/13** geçti. Contract drift kontrolü ve ilgili strict TypeScript kontrolleri geçti.
- Henüz check/group route, application service, React yönetim ekranı veya gerçek probe uygulanmadı; Aşama 6 tamamlandı sayılmıyor.
