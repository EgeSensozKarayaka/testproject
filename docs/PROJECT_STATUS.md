# Proje Durumu

**Son güncelleme:** 2026-10-10 02:24 +06:00
**Genel durum:** Aşama 3 veritabanı ve kalıcılık temeli tamamlandı; sıradaki iş Aşama 4 API, event ve hata sözleşmeleridir

## Tamamlanan

- Aşama 0 gereksinim/kabul kriterleri ve Aşama 1 domain/durum makinesi tasarımı
- Aşama 2 polyglot monorepo, React/Fastify runtime temeli, opsiyonel Python predictor, Docker Compose ve CI
- PostgreSQL 18.6 için altı sıralı, checksum'lı ve forward-only SQL migration
- Auth, check/group, maintenance, job/attempt/run, current state, health interval, incident, rollup, outbox, notification, public status, prediction ve audit şemaları
- Aylık/yıllık partition'lar, default güvenlik partition'ları ve housekeeper helper fonksiyonları
- Composite owner/check foreign key'leri, 29 private parent tabloda `ENABLE/FORCE RLS` ve dar servis rolleri
- Public snapshot/auth bootstrap için sınırlı `SECURITY DEFINER` fonksiyonları ve predictor için PII içermeyen security-barrier feature view
- Advisory-lock, SHA-256 checksum ledger ve schema compatibility kontrollü TypeScript migration runner
- Production korumalı reset, non-production idempotent demo seed'i ve CLI/root komutları
- Kysely tabanlı şema-tipli sorgu yüzeyi; `pg` transaction-local kullanıcı bağlamı
- Uygulamalardan önce çalışan ayrı, non-root migration container'ı ve schema-aware readiness
- Gerçek PostgreSQL kullanan migration, RLS, privilege, constraint, partition ve reset entegrasyon paketi

## Doğrulama Kanıtları

- Veritabanı entegrasyon paketi: **10/10 test geçti**
- Sıfırdan migration `1..6`, tekrar migration no-op ve değiştirilmiş migration checksum reddi doğrulandı
- İki kullanıcı arasında SELECT/UPDATE izolasyonu, context temizliği ve çapraz-owner FK reddi doğrulandı
- Public rolün yalnız allowlist snapshot fonksiyonuna eriştiği; predictor'ın ana sağlık tablosuna yazamadığı doğrulandı
- Runtime pool'un `current_user=site_monitor_api` dar rolünde başladığı ve tipli Kysely sorgusunun RLS altında çalıştığı doğrulandı
- Kritik indeksler, en az 32 başlangıç partition'ı, boş default run partition'ı ve schema owner'ın database `CREATE` yetkisinin olmaması doğrulandı
- Local ana veritabanı revision 6'ya migrate edilip idempotent demo seed uygulandı
- Mantıksal yedek ayrı `site_monitor_restore_test` veritabanına geri yüklendi; revision 6, altı ledger kaydı, demo kullanıcı/check ve 29 `FORCE RLS` tablo doğrulandı; geçici veritabanı/dump sonra silindi
- `docker compose --profile app up --detach --build --wait` başarılı; migration işi `0` ile bitti ve API, web, iki worker, PostgreSQL, Mailpit ve target simulator sağlıklı başladı
- `pnpm run ci` başarılı: format, lint, strict typecheck, 8 unit test, entegrasyon dosyası keşfi ve bütün production build'leri geçti
- Gerçek PostgreSQL URL'siyle kök `pnpm test:integration` komutu 10/10 testi çalıştırdı; test yokken sessiz başarı veren eski glob filtresi kaldırıldı
- Playwright E2E: web/API smoke ve iki bağımsız browser client senaryosu 2/2 geçti

## Bilinçli Olarak Henüz Yapılmayan

- Kayıt/giriş/session akışı ve gerçek parola hashleme
- Check/group API CRUD, scheduler ve gerçek HTTP probe motoru
- Incident/state geçiş uygulaması ve maintenance reconciliation
- Notification outbox consumer'ı ve gerçek SMTP gönderim akışı
- Rollup/retention background işleri ve history sorguları
- SSE canlı güncelleme, authenticated frontend ve public durum sayfası
- Predictor analiz algoritması/model lifecycle'ı
- Production deployment, ayrı login wrapper secret'ları, managed backup/PITR ve production restore drill'i

## Bilinen Sınırlamalar

- Mevcut ekran ve servisler hâlâ ürün akışları değil, çalışan runtime/health temelidir.
- Local Compose kolaylığı için tek PostgreSQL bootstrap login'i kullanır ve bağlantılar dar `NOLOGIN` service role geçer. Production'da servis başına ayrı login wrapper/secret zorunludur.
- Demo seed parola veya aktif session oluşturmaz; auth aşamasında güvenli demo credential akışı ayrıca eklenecektir.
- Partition bakım helper'ları hazırdır ancak otomatik periyodik housekeeper henüz yoktur.
- Local mantıksal restore provası production RPO/RTO/PITR hedeflerinin sağlandığını kanıtlamaz.
- ESLint 9.39.5 erişilebilirlik eklentisi uyumluluğu nedeniyle pinlidir.
- Playwright Chromium CDN'i yerel ağda timeout verdi; aynı E2E paketi kurulu Microsoft Edge ile daha önce geçti, CI Chromium kullanır.
- Host `5432` ve `3000` başka projeler tarafından kullanıldığından PostgreSQL `15432`, API `13000`, web `15173` portundadır.

## Sıradaki İş

Aşama 4'te kod yazmadan önce `docs/API_DESIGN.md`, ilk OpenAPI sözleşmesi, domain event/SSE kataloğu ve problem-details hata formatı hazırlanıp kullanıcı incelemesine sunulacaktır.
