# Proje Durumu

**Son güncelleme:** 2026-10-10 07:54 +06:00
**Genel durum:** Aşama 5 doğrulandı; Aşama 6 group API dilimi gerçek PostgreSQL ile doğrulandı, check API ve UI uygulaması sürüyor

## Tamamlanan

- Aşama 0 gereksinim/kabul kriterleri, Aşama 1 domain/durum makineleri, Aşama 2 monorepo/runtime/CI temeli, Aşama 3 kalıcılık ve Aşama 4 API/event/hata sözleşmeleri
- PostgreSQL 18.6 üzerinde on iki checksum'lı, immutable ve forward-only migration; schema-aware readiness, ayrı migration container'ı ve idempotent development seed'i
- Private tablolar için composite sahiplik kısıtları, `FORCE RLS`, transaction-local owner context'i ve dar service rolleri
- Canonical OpenAPI 3.1'den deterministik TypeScript tipleri ile Fastify runtime şemaları; merkezi RFC 9457 problem yanıtı ve UUIDv7 request korelasyonu
- 15–128 code-point parola politikası, zxcvbn güç kontrolü, bounded async Argon2id hash/verify ve parametre yükseltme yolu
- SHA-256 digest olarak saklanan 256-bit opaque server-side session; absolute/idle expiry, touch, rotation grace, revoke ve password-version invalidation
- `HttpOnly`, `SameSite=Strict`, production `Secure` cookie; exact Origin/Referer, Fetch Metadata, JSON-only auth command ve session-bound HMAC CSRF koruması
- Enumeration-safe kayıt, doğrulama ve parola sıfırlama yanıtları; PostgreSQL-backed HMAC scope rate limit ve anonymous idempotency receipt sınırı
- AES-256-GCM şifreli durable verification/reset e-posta kuyruğu; fencing/retry davranışlı ayrı notification worker ve local Mailpit adapter'ı
- Kayıt, login, session, logout, doğrulama, parola reseti, `GET/PATCH /api/v1/me` ve güçlü `ETag`/`If-Match` profil akışları
- React kayıt/giriş/parola sıfırlama/doğrulama ve authenticated temel ekranı
- Organizasyon katmanı eklemeden gerçek kullanıcı bazlı sahiplik modeli; bir kullanıcı birden fazla bağımsız browser session açabilir
- Aşama 6 için check/group CRUD, pause/resume/delete, manual job coalescing, URL doğrulama, quota, ETag/idempotency, transaction ve test mimarisi
- Check/group saf domain doğrulaması ve değişiklik sınıflandırması; HTTP(S) canonicalization, bariz private/local hedef engeli ve UTF-8 expected-text sınırı
- Revision 12 group description, DB byte constraint'i, soft-delete yetki sınırı ve API'nin owner-scoped current-state/manual-job/audit/outbox yazma temeli
- Authenticated group create/get/list/update/delete API'si; CSRF/origin, owner rate limit, güçlü ETag/If-Match, HMAC cursor, atomik idempotency receipt, deployment kotası, audit ve outbox
- Group silmede deterministik satır kilidi, soft-delete ve bağlı canlı check'lerin aynı transaction'da version artırılarak gruptan ayrılması
- OpenAPI `{param}` yollarını Fastify `:param` yollarına çeviren deterministik runtime contract üretimi

## Doğrulama Kanıtları

- `pnpm test:unit`: **11 dosyada 73/73 test geçti**.
- Gerçek PostgreSQL admin URL'siyle ilgili paket: **13/13 test geçti**; sıfırdan migration `1..12`, checksum drift, RLS/context temizliği, auth sınırları ve Aşama 6 description/byte/soft-delete/audit-outbox yetkileri doğrulandı.
- Aşama 6 domain/OpenAPI odaklı paket: **32/32 test geçti**; contract drift ve ilgili strict TypeScript kontrolleri geçti.
- Group HTTP sınırı ve config odaklı paket dahil **18/18 test geçti**; gerçek PostgreSQL group service paketi **6/6** geçti. Concurrent idempotency, owner izolasyonu, stale ETag, cursor tamper, atomik detach ve quota doğrulandı.
- Final `pnpm run ci`; format, generated-contract drift, lint, strict typecheck, 73 unit test ve bütün production build'leriyle geçti. Admin URL ayrı verildiğinde group integration paketi de 6/6 geçti.
- Compose API ve migrate imajları temizden rebuild edildi; migration işi başarıyla kapandı, API healthy oldu. Canlı readiness `200`, oturumsuz group list ve parametrik group route'ları beklenen `401` ile auth sınırına ulaştı.
- `pnpm typecheck`: ortak paketler, React, API, iki worker ve target simulator için strict TypeScript kontrolü geçti.
- Playwright: auth frontend smoke, iki bağımsız browser context ve UI → Mailpit → verification → login → logout akışı **3/3 geçti**.
- Canlı Compose akışında kayıt `202`, Mailpit teslimi, doğrulama `204`, login/session `200`, logout `204` ve logout sonrası session `401` doğrulandı.
- Aşama 5 GitHub Actions koşusu [`38002790366`](https://github.com/EgeSensozKarayaka/testproject/actions/runs/38002790366) başarıyla tamamlandı: Node kalite, PostgreSQL migration/izolasyon, Python predictor kalite, dependency audit ve full-stack container smoke işlerinin beşi de geçti.

## Bilinçli Olarak Henüz Yapılmayan

- Check API ve group/check UI CRUD'u, pause/resume ve manuel çalıştırma
- Scheduler, gerçek HTTP probe motoru ve check overlap engeli
- Incident/state geçişleri, maintenance reconciliation ve incident e-posta politikaları
- Rollup/retention background işleri, history sorguları ve grafikler
- SSE canlı güncelleme, monitoring dashboard'u ve public durum sayfası
- Predictor analiz algoritması/model lifecycle'ı
- MFA/passkey, OAuth/OIDC, organizasyon/üyelik/rol modeli ve kullanıcıya açık session/device yönetimi
- Production deployment, servis başına ayrı login secret'ları, managed backup/PITR ve production restore drill'i

## Bilinen Sınırlamalar

- Authenticated ekran Aşama 5 güvenlik temelini kanıtlar; nihai monitoring dashboard'u değildir.
- Auth rate limit PostgreSQL fixed-window yaklaşımıdır. V1 ve yatay API replica'ları için tutarlıdır; yüksek hacimli internet trafiğinde edge WAF/CDN katmanı gerekir.
- Yerel Compose kolaylığı için tek PostgreSQL bootstrap login'i dar `NOLOGIN` rollere geçer. Production'da servis başına ayrı login wrapper/secret gerekir.
- Yerel HTTP ortamında session cookie `Secure=false`; production config fail-fast secret ve HTTPS/Secure cookie gerektirir.
- Auth security audit olaylarının temel mutation kayıtları vardır; ayrıntılı deny/metric/export kapsamı Aşama 17 gözlemlenebilirlik sertleştirmesinde genişletilecektir.
- Partition helper'ları hazırdır fakat otomatik periyodik housekeeper henüz yoktur.
- Local restore provası production RPO/RTO/PITR garantisi değildir.
- Soğuk Docker image build'i registry bağlantı hızına bağlı olarak birkaç dakika sürebilir; warm build ve normal `up` akışı daha hızlıdır. Build cache mount/prune optimizasyonu Aşama 17 operasyonel sertleştirme kapsamındadır.
- Host `5432` ve `3000` başka projeler tarafından kullanıldığından PostgreSQL `15432`, API `13000`, web `15173` portundadır.
- Group API tamamlandı; check route'ları, check mutation orchestration'ı ve React yönetim ekranları henüz uygulanmadı.
- Group cursor şu anda tek aktif HMAC anahtarı kullanır; kesintisiz anahtar rotasyonu için önceki doğrulama anahtarını kabul eden key-ring Aşama 17 sertleştirmesinde eklenmelidir.

## Sıradaki İş

Aşama 6'nın sonraki dikey diliminde owner-scoped check create/get/list/update, pause/resume/delete ve manuel run orchestration'ını uygulamak.
