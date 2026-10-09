# Proje Durumu

**Son güncelleme:** 2026-10-10 04:02 +06:00
**Genel durum:** Aşama 4 sözleşme altyapısı tamamlandı; sıradaki çalışma Aşama 5 auth ve kullanıcı izolasyonu tasarımı

## Tamamlanan

- Aşama 0 gereksinim/kabul kriterleri ve Aşama 1 domain/durum makinesi tasarımı
- Aşama 2 polyglot monorepo, React/Fastify runtime temeli, opsiyonel Python predictor, Docker Compose ve CI
- PostgreSQL 18.6 için yedi sıralı, checksum'lı ve forward-only SQL migration
- Auth, check/group, maintenance, job/attempt/run, current state, health interval, incident, rollup, outbox, notification, public status, prediction ve audit şemaları
- Aylık/yıllık partition'lar, default güvenlik partition'ları ve housekeeper helper fonksiyonları
- Composite owner/check foreign key'leri, 30 private parent tabloda `ENABLE/FORCE RLS` ve dar servis rolleri
- Public snapshot/auth bootstrap için sınırlı `SECURITY DEFINER` fonksiyonları ve predictor için PII içermeyen security-barrier feature view
- Advisory-lock, SHA-256 checksum ledger ve schema compatibility kontrollü TypeScript migration runner
- Production korumalı reset, non-production idempotent demo seed'i ve CLI/root komutları
- Kysely tabanlı şema-tipli sorgu yüzeyi; `pg` transaction-local kullanıcı bağlamı
- Uygulamalardan önce çalışan ayrı, non-root migration container'ı ve schema-aware readiness
- Gerçek PostgreSQL kullanan migration, RLS, privilege, constraint, partition ve reset entegrasyon paketi
- Aşama 4 için private/public REST kaynakları, komut endpoint'leri, pagination, concurrency ve idempotency kurallarını tanımlayan API tasarımı
- Mock geliştirmeye temel olacak ilk OpenAPI 3.1 sözleşmesi
- Version'lı transactional domain event kataloğu ve private/public SSE sözleşmesi
- Stabil kodlar, alan hataları, retry ve sahiplik gizleme semantiği içeren problem-details sözleşmesi
- Canonical OpenAPI'den üretilen TypeScript request/response tipleri, Fastify runtime route şemaları ve operation güvenlik metadata'sı
- CI'da 57 operation, local reference, path parametresi, CSRF, idempotency, If-Match ve generated-artifact drift kontrolü
- UUIDv7 request korelasyonu, her response'ta `X-Request-Id` ve RFC 9457 merkezi error mapper
- `404`/`405`, validation `422`, malformed JSON, retry/`Retry-After` ve public-token instance redaction temel conformance testleri
- Forward-only revision 7 `infra.api_idempotency_records` migration'ı; bounded response, header allowlist, encrypted-secret alanları ve FORCE RLS

## Doğrulama Kanıtları

- Veritabanı entegrasyon paketi: **11/11 test geçti**
- Sıfırdan migration `1..7`, tekrar migration no-op ve değiştirilmiş migration checksum reddi doğrulandı
- İki kullanıcı arasında SELECT/UPDATE izolasyonu, context temizliği ve çapraz-owner FK reddi doğrulandı
- Public rolün yalnız allowlist snapshot fonksiyonuna eriştiği; predictor'ın ana sağlık tablosuna yazamadığı doğrulandı
- Runtime pool'un `current_user=site_monitor_api` dar rolünde başladığı ve tipli Kysely sorgusunun RLS altında çalıştığı doğrulandı
- Kritik indeksler, en az 32 başlangıç partition'ı, boş default run partition'ı ve schema owner'ın database `CREATE` yetkisinin olmaması doğrulandı
- Local ana veritabanı revision 6'ya migrate edilip idempotent demo seed uygulandı
- Mantıksal yedek ayrı `site_monitor_restore_test` veritabanına geri yüklendi; revision 6, altı ledger kaydı, demo kullanıcı/check ve 29 `FORCE RLS` tablo doğrulandı; geçici veritabanı/dump sonra silindi
- `docker compose --profile app up --detach --build --wait` revision 7 ile temizden başarılı; migration işi `0` ile bitti ve API, web, iki worker, PostgreSQL, Mailpit ve target simulator sağlıklı başladı
- `pnpm run ci` başarılı: format, generated-contract drift, lint, strict typecheck, 22 unit test, 11 gerçek PostgreSQL entegrasyon testi ve bütün production build'leri geçti
- Gerçek PostgreSQL URL'siyle kök `pnpm test:integration` komutu 11/11 testi çalıştırdı; test yokken sessiz başarı veren eski glob filtresi kaldırıldı
- Playwright E2E: web/API smoke ve iki bağımsız browser client senaryosu 2/2 geçti
- Aşama 4 sözleşme doğrulaması: OpenAPI 3.1 YAML parse edildi; 40 path, 57 benzersiz operation, 68 schema ve 437 local `$ref` doğrulandı. Doküman endpoint kataloğu ve 38 zorunlu domain event'i sözleşmelerle bire bir karşılaştırıldı.
- Aşama 4 commit'i için GitHub Actions çalıştırması `37993088278` içinde Node kalite, Python predictor kalite ve dependency audit işleri geçti.
- `pnpm contracts:check` ile 57 OpenAPI operation'ının üretim artifact'leri ve güvenlik/precondition matrisi doğrulandı.
- Revision 7 sıfırdan migration, tekrar migration, checksum, RLS ve idempotency storage sınırlarını içeren PostgreSQL entegrasyon paketi **11/11** geçti; local geliştirme veritabanı revision 7'ye taşındı.
- Rebuild edilen stack üzerinde canlı health, güvenli `404` instance ve `Allow` başlıklı `405` problem yanıtları doğrulandı; Playwright smoke ve iki eşzamanlı istemci senaryosu yeniden **2/2** geçti.

## Bilinçli Olarak Henüz Yapılmayan

- Kayıt/giriş/session akışı ve gerçek parola hashleme
- Check/group API CRUD, scheduler ve gerçek HTTP probe motoru
- Incident/state geçiş uygulaması ve maintenance reconciliation
- Notification outbox consumer'ı ve gerçek SMTP gönderim akışı
- Rollup/retention background işleri ve history sorguları
- SSE canlı güncelleme, authenticated frontend ve public durum sayfası
- Predictor analiz algoritması/model lifecycle'ı
- Production deployment, ayrı login wrapper secret'ları, managed backup/PITR ve production restore drill'i
- Authenticated/public ürün endpoint'lerinin domain handler'ları; OpenAPI yolları ilgili Aşama 5–15 içinde uygulanacaktır
- Anonymous auth idempotency receipt erişimi için dar `security_api` fonksiyonu; Aşama 5 enumeration-safe akışıyla birlikte uygulanacaktır

## Bilinen Sınırlamalar

- Mevcut ekran ve servisler hâlâ ürün akışları değil, çalışan runtime/health temelidir.
- Aşama 4 sözleşme ve sınır altyapısı çalışır; OpenAPI'de görünen ürün endpoint'lerinin çoğu henüz domain handler'ına sahip değildir ve çalışıyor olarak değerlendirilmemelidir.
- Local Compose kolaylığı için tek PostgreSQL bootstrap login'i kullanır ve bağlantılar dar `NOLOGIN` service role geçer. Production'da servis başına ayrı login wrapper/secret zorunludur.
- Demo seed parola veya aktif session oluşturmaz; auth aşamasında güvenli demo credential akışı ayrıca eklenecektir.
- Partition bakım helper'ları hazırdır ancak otomatik periyodik housekeeper henüz yoktur.
- Local mantıksal restore provası production RPO/RTO/PITR hedeflerinin sağlandığını kanıtlamaz.
- ESLint 9.39.5 erişilebilirlik eklentisi uyumluluğu nedeniyle pinlidir.
- Playwright Chromium CDN'i yerel ağda timeout verdi; aynı E2E paketi kurulu Microsoft Edge ile daha önce geçti, CI Chromium kullanır.
- Host `5432` ve `3000` başka projeler tarafından kullanıldığından PostgreSQL `15432`, API `13000`, web `15173` portundadır.
- GitHub Actions çalıştırması `37993088278` tamamen yeşil değildir: PostgreSQL işi testlere ulaşmadan `Initialize containers` adımındaki Docker pull hatasıyla, full-stack smoke işi ise `Start full stack` adımında başarısız oldu. İlk hata açıkça CI/container altyapısı kaynaklıdır; ikinci hatanın aynı nedenden doğduğu yalnızca güçlü bir çıkarımdır çünkü anonim GitHub görünümü ham logu sunmamaktadır. Uygulama düzeltmesi için kanıt oluşmadığından bu turda kod değiştirilmemiştir; çalışma yeniden denenmelidir.

## Sıradaki İş

Aşama 5 için önce `docs/AUTH_AND_OWNERSHIP.md` hazırlanacak ve kullanıcı incelemesine bırakılacaktır. Session rotation, parola hashleme, CSRF/origin, enumeration-safe doğrulama/reset akışları, rate limit ve RLS request context tasarımı onaylanmadan auth koduna başlanmayacaktır.
