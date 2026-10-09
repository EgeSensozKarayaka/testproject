# Proje Durumu

**Son güncelleme:** 2026-10-10 05:02 +06:00
**Genel durum:** Aşama 5 kimlik doğrulama ve kullanıcı izolasyonu uygulandı; yerel kalite ve kabul kapıları geçti

## Tamamlanan

- Aşama 0 gereksinim/kabul kriterleri, Aşama 1 domain/durum makineleri, Aşama 2 monorepo/runtime/CI temeli, Aşama 3 kalıcılık ve Aşama 4 API/event/hata sözleşmeleri
- PostgreSQL 18.6 üzerinde on bir checksum'lı, immutable ve forward-only migration; schema-aware readiness, ayrı migration container'ı ve idempotent development seed'i
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

## Doğrulama Kanıtları

- `pnpm test:unit`: **8 dosyada 35/35 test geçti**.
- Gerçek PostgreSQL admin URL'siyle `pnpm test:integration`: **12/12 test geçti**; sıfırdan migration `1..11`, checksum drift, RLS/context temizliği, auth/session/rate-limit/e-posta/profile/rehash sınırları ve reset doğrulandı.
- `pnpm typecheck`: ortak paketler, React, API, iki worker ve target simulator için strict TypeScript kontrolü geçti.
- Playwright: auth frontend smoke, iki bağımsız browser context ve UI → Mailpit → verification → login → logout akışı **3/3 geçti**.
- Canlı Compose akışında kayıt `202`, Mailpit teslimi, doğrulama `204`, login/session `200`, logout `204` ve logout sonrası session `401` doğrulandı.
- Aşama 4 son GitHub Actions koşusu [`37996956618`](https://github.com/EgeSensozKarayaka/testproject/actions/runs/37996956618) beş işin tamamında geçti. Aşama 5 uzak CI sonucu bu commit gönderildikten sonra bu belgeye eklenecektir.

## Bilinçli Olarak Henüz Yapılmayan

- Check/group API ve UI CRUD'u, pause/resume ve manuel çalıştırma
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

## Sıradaki İş

Aşama 6 — Kontrol ve Grup Yönetimi için önce `docs/CHECKS_AND_GROUPS.md` tasarımını hazırlayıp kullanıcı incelemesine sunmak; onaydan sonra owner-scoped CRUD, validation, ETag/idempotency, quota ve negatif erişim testlerini dikey dilimler halinde uygulamak.
