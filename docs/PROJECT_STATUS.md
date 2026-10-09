# Proje Durumu

**Son güncelleme:** 2026-10-10 01:13 +06:00
**Genel durum:** Aşama 2 tamamlandı; Aşama 3 veritabanı tasarımı kullanıcı incelemesinde

## Tamamlanan

- Aşama 0 gereksinim, kabul kriterleri, ana mimari ve karar günlüğü
- Aşama 1 domain modeli, durum makineleri ve ortak terimler sözlüğü
- GitHub'a bağlı `main` dalı ve aşamalı commit geçmişi
- Node.js `24.19.0` + pnpm `11.25.0` polyglot monorepo
- ESM ve strict TypeScript ortak yapılandırması
- React/Vite web, Fastify API, monitor worker, notification worker ve hedef simülatörü entrypoint'leri
- Ortak domain, contract, config, database, check-engine, notification, observability ve testing paket sınırları
- Python `3.14.8` + uv `0.12.20` ile bağımsız ve opsiyonel predictor runtime temeli
- PostgreSQL `18.6`, Mailpit `1.31.4`, ana `app` ve opsiyonel `prediction` Compose profilleri
- Non-root, multi-stage Node/web/predictor container image'ları
- Liveness/readiness uçları ve dependency-aware database readiness
- ESLint, Prettier, strict typecheck, Vitest, pytest/mypy/Ruff ve Playwright kalite zinciri
- GitHub Actions üzerinde Node, Python, full-stack E2E ve dependency-audit işleri
- Kökten çalışan platform bağımsız geliştirme ve kalite komutları
- Aşama 3'e kadar bilinçli biçimde kapalı database migration/seed/reset komutları
- Aşama 3 için ana veritabanı mimarisi, ER modeli ve eksiksiz tablo/kolon sözlüğü
- İndeks/sorgu, partition, rollup, retention, RLS/rol, migration, backup ve restore tasarımı

## Doğrulama Kanıtları

- `pnpm install --frozen-lockfile` başarılı
- `pnpm run ci` başarılı: format, lint, typecheck, 8 Node testi, integration keşfi ve bütün build'ler
- Predictor: Ruff, mypy ve 10 pytest testi başarılı; branch coverage `%84.95`, zorunlu eşik `%70`
- `docker compose --profile app build` ile beş uygulama image'ı başarılı
- API, web, iki worker, PostgreSQL, Mailpit ve target simulator healthcheck'leri sağlıklı
- Target simulator gerçek `200` ve `503` davranışları doğrulandı
- Playwright E2E: web/API entegrasyonu ve iki bağımsız browser context testi başarılı
- Predictor profile readiness başarılı; predictor durdurulduktan sonra API sağlıklı kalmaya devam etti
- Varsayılan, `app` ve `prediction` Compose konfigürasyonları geçerli

## Bilinçli Olarak Henüz Yapılmayan

- Nihai veritabanı şeması, migration ve seed uygulaması
- Kullanıcı/session tabloları ve kimlik doğrulama
- Check/group CRUD ve gerçek sahiplik/RLS uygulaması
- Scheduler, job lease/fencing ve gerçek HTTP probe motoru
- Incident, bakım, notification outbox ve gerçek e-posta gönderimi
- History partition/rollup ve availability sorguları
- SSE canlı güncelleme ve public status sayfası
- Predictor analiz/tahmin algoritması ve model lifecycle'ı
- Production deployment, backup/PITR ve observability sertleştirmesi

## Bilinen Sınırlamalar

- Mevcut ekran ve servisler ürün özelliği değil, çalışan runtime/health temelidir.
- Integration test komutu hazırdır ancak Aşama 3 şeması olmadığı için henüz test dosyası yoktur.
- `db:migrate`, `db:seed` ve `db:reset`, Aşama 3 onaylanana kadar açıklayıcı hatayla durur.
- ESLint 9.39.5, erişilebilirlik eklentisinin peer uyumluluğu nedeniyle geçici olarak pinlidir; ESLint 10 geçişi plugin uyumluluğu sonrası yapılacaktır.
- Local image tag'leri development içindir; release öncesinde base image digest ve OCI release metadata politikası tamamlanacaktır.
- Playwright Chromium CDN indirmesi yerel ağda timeout verdi; aynı E2E paketi kurulu Microsoft Edge kanalıyla başarıyla doğrulandı. CI Chromium'u resmi Playwright kurulumuyla indirir.
- Host `5432` ve `3000` başka projeler tarafından kullanıldığından bu repository sırasıyla `15432` ve `13000` kullanır; web portu `15173`tür.

## Sıradaki İş

`docs/DATABASE.md`, `docs/DATABASE_SCHEMA.md`, `docs/DATABASE_SECURITY.md` ve `docs/DATABASE_OPERATIONS.md` kullanıcı tarafından incelenecektir. Kullanıcı onayından sonraki prompt'ta migration runner, başlangıç şeması, RLS/roller, test database'i ve seed uygulamasına geçilecektir. İnceleme tamamlanmadan veritabanı kodu yazılmayacaktır.
