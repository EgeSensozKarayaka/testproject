# Proje Durumu

**Son güncelleme:** 2026-10-10 11:02 +06:00
**Genel durum:** Aşama 0–7 tamamlandı ve doğrulandı; Aşama 8 sağlık/incident/grup durumu tasarımı tamamlandı, uygulama kullanıcı incelemesini bekliyor

## Tamamlanan

- Aşama 8 için saf state reducer sınırı, canonical observation acceptance precedence, sabit iki-failure threshold, provisional timeline, incident segment/duration, read-time freshness override, query-time group aggregate ve test mimarisi
- Scheduler/DB'den bağımsız güvenli HTTP probe motoru; versioned snapshot doğrulama, frozen DNS candidate pinning, public IPv4/IPv6 policy, redirect, total deadline/cancellation, bounded streaming/decompression ve typed hata taksonomisi
- DNS çağrısı yapmayan kısa ömürlü direct TCP/TLS connector; hostname/SNI sertifika doğrulaması, proxy bypass'ı, operator port allowlist'i ve production'da reddedilen exact-origin local simulator istisnası
- Başarı/body/status, streaming, gecikme/hang, büyük/sıkıştırılmış body, redirect/loop, flaky ve erken bağlantı kapanması fixture'larıyla genişletilmiş hedef simülatörü
- Aşama 0 gereksinim/kabul kriterleri, Aşama 1 domain/durum makineleri, Aşama 2 monorepo/runtime/CI temeli, Aşama 3 kalıcılık ve Aşama 4 API/event/hata sözleşmeleri
- PostgreSQL 18.6 üzerinde on üç checksum'lı, immutable ve forward-only migration; schema-aware readiness, ayrı migration container'ı ve idempotent development seed'i
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
- Owner-scoped check create/get/list/update, pause/resume/soft-delete ve manuel run API'si; güçlü ETag, idempotency receipt, signed filter-bound cursor, quota/rate limit, audit ve redacted outbox
- Check create sırasında current-state ve başlangıç health interval'ının atomik kurulması; probe/schedule generation ayrımı, aktif job invalidation, config/delete incident kapanışı ve pause/stale observation suspension davranışı
- Tek aktif job partial unique invariant'ı altında concurrent manuel taleplerin durable `ENQUEUED` job veya tek `COALESCED` intent'e dönüşmesi; paused check için diagnostic mod
- Revision 13 ile API state komutlarına yalnız gereken incident/segment ve health-interval mutation yüzeyinin açılması; worker lease/run/fencing yetkilerinin kapalı kalması
- OpenAPI 3.1 composed write schema'larının Fastify draft-07 runtime doğrulamasına generator içinde eşdeğer kapalı obje olarak dönüştürülmesi
- Generated OpenAPI tiplerini kullanan React group/check yönetim ekranı; loading/empty/error durumları, responsive formlar, create/edit/delete, pause/resume ve manual-run komutları
- İki tarayıcıdaki eşzamanlı düzenlemede güçlü `If-Match` çatışmasını veri kaybı olmadan açıklayan, güncel kaynağı yeniden yükleyen `412` kurtarma akışı
- API mutation sözleşmesindeki `PATCH` ve `DELETE` yöntemlerini credentialed CORS preflight allowlist'ine dahil eden ve özel header yansımasını doğrulayan regresyon testi

## Doğrulama Kanıtları

- Aşama 7 odaklı unit paketi **6 dosyada 52/52**, gerçek socket HTTP/redirect/gzip/oversize/TLS/timeout ve 50 eşzamanlı probe entegrasyonu **4/4** geçti.
- Final yerel `pnpm run ci`; format, generated-contract drift, lint, strict typecheck, **17 dosyada 131/131 unit test**, integration kapıları ve bütün production build'leriyle geçti.
- Gerçek PostgreSQL admin URL'siyle birleşik integration paketi **4 dosyada 32/32** geçti; buna Aşama 7'nin gerçek socket entegrasyonları da dahildir.
- Güncel target-simulator ve monitor-worker imajları üretildi; iki container healthy oldu. Canlı match body, 64-byte bounded response, `302` redirect ve sıkıştırılmış response `200`; worker readiness `200` döndürdü. Tam Compose profilindeki bütün servisler healthy kaldı.
- Aşama 7 GitHub Actions koşusu [`38025620652`](https://github.com/EgeSensozKarayaka/testproject/actions/runs/38025620652) başarıyla tamamlandı: Node kalite, PostgreSQL migration/izolasyon, Python predictor kalite, dependency audit ve full-stack container smoke işlerinin beşi de geçti.

- `pnpm test:unit`: **13 dosyada 85/85 test geçti**.
- Gerçek PostgreSQL admin URL'siyle birleşik paket: **28/28 test geçti**; sıfırdan migration `1..13`, checksum drift, RLS/context temizliği, auth/group/check transaction sınırları ve 20/200/500 cursor profili doğrulandı.
- Aşama 6 domain/OpenAPI odaklı paket: **32/32 test geçti**; contract drift ve ilgili strict TypeScript kontrolleri geçti.
- Group HTTP sınırı ve config odaklı paket dahil **18/18 test geçti**; gerçek PostgreSQL group service paketi **6/6** geçti. Concurrent idempotency, owner izolasyonu, stale ETag, cursor tamper, atomik detach ve quota doğrulandı.
- Check HTTP sınırı **6/6**, gerçek PostgreSQL check service paketi **6/6** geçti. Concurrent create replay, üç version ekseni, cross-owner 404, no-op/stale ETag, manual coalescing, pause/resume/delete, observed incident suspension/closure ve filter-bound cursor doğrulandı.
- Final `pnpm run ci`; format, generated-contract drift, lint, strict typecheck, **85/85 unit**, **28/28 gerçek PostgreSQL integration** ve bütün production build'leriyle geçti.
- Tüm PostgreSQL integration dosyaları cluster-global bootstrap rollerinin test fixture yarışını önlemek için seri çalışır; birleşik yerel koşu migration/auth/group/check paketlerinin tamamını kapsar.
- Compose API ve migrate imajları temizden rebuild edildi; migration işi başarıyla kapandı, API healthy oldu. Canlı readiness `200`, oturumsuz group list ve parametrik group route'ları beklenen `401` ile auth sınırına ulaştı.
- Check API sonrası tam Compose stack temizden rebuild edildi; migration logu revision 13'ün uygulandığını, schema compatibility head değerinin `13` olduğunu ve bütün uygulama servislerinin healthy olduğunu gösterdi. Canlı readiness `200`, oturumsuz check list/tekil yolları beklenen `401` döndürdü.
- Aşama 6 group API GitHub Actions koşusu [`38015275133`](https://github.com/EgeSensozKarayaka/testproject/actions/runs/38015275133) başarıyla tamamlandı: Node kalite, PostgreSQL migration/izolasyon, Python predictor kalite, dependency audit ve full-stack container smoke işlerinin beşi de geçti.
- Aşama 6 check API GitHub Actions koşusu [`38018138265`](https://github.com/EgeSensozKarayaka/testproject/actions/runs/38018138265) başarıyla tamamlandı: Node kalite, PostgreSQL migration/izolasyon, Python predictor kalite, dependency audit ve full-stack container smoke işlerinin beşi de geçti.
- Aşama 6 React yönetim ve kapanış koşusu [`38022028585`](https://github.com/EgeSensozKarayaka/testproject/actions/runs/38022028585) başarıyla tamamlandı: Node kalite, PostgreSQL migration/izolasyon, Python predictor kalite, dependency audit ve full-stack container smoke işlerinin beşi de geçti.
- `pnpm typecheck`: ortak paketler, React, API, iki worker ve target simulator için strict TypeScript kontrolü geçti.
- Playwright (sistem Edge): auth frontend smoke, iki bağımsız browser context ve UI → Mailpit → verification → login → group/check CRUD → manual run → pause/resume → ikinci oturum update → stale ilk oturum `412` recovery → delete → logout akışı **3/3 geçti**.
- UI kabul testi API'nin varsayılan CORS method listesinin `PATCH` içermediğini gerçek browser preflight'ında yakaladı; explicit method allowlist ve API regresyon testi eklendikten sonra aynı senaryo geçti.
- PostgreSQL kapasite paketi 20, 200 ve 500 check fixture'ını 100 kayıtlık keyset sayfalarıyla eksiksiz dolaştı; her sorgu için 5 saniyelik gevşek regresyon üst sınırı korundu. 500 kayıtlık frontend fixture'ı ilk ve sonraki yüklemeyi 100'er karta sınırladı.
- Gerçek Fastify request logu ile PostgreSQL audit/outbox payload'ları, hedef URL sorgu değeri ve expected-body marker için negatif sızıntı testinden geçti.
- Canlı Compose akışında kayıt `202`, Mailpit teslimi, doğrulama `204`, login/session `200`, logout `204` ve logout sonrası session `401` doğrulandı.
- Aşama 5 GitHub Actions koşusu [`38002790366`](https://github.com/EgeSensozKarayaka/testproject/actions/runs/38002790366) başarıyla tamamlandı: Node kalite, PostgreSQL migration/izolasyon, Python predictor kalite, dependency audit ve full-stack container smoke işlerinin beşi de geçti.

## Bilinçli Olarak Henüz Yapılmayan

- Scheduler/job claim, check overlap engeli, global concurrency/fairness ve probe sonucu kalıcılığı
- Probe sonuçlarından incident/state geçişleri, maintenance reconciliation ve incident e-posta politikaları
- Rollup/retention background işleri, history sorguları ve grafikler
- SSE canlı güncelleme, monitoring dashboard'u ve public durum sayfası
- Predictor analiz algoritması/model lifecycle'ı
- MFA/passkey, OAuth/OIDC, organizasyon/üyelik/rol modeli ve kullanıcıya açık session/device yönetimi
- Production deployment, servis başına ayrı login secret'ları, managed backup/PITR ve production restore drill'i

## Bilinen Sınırlamalar

- Authenticated ekran group/check yapılandırmasını yönetir; kontrol motoru henüz scheduler ve sonuç kalıcılığına bağlı olmadığından nihai canlı monitoring dashboard'u değildir.
- Auth rate limit PostgreSQL fixed-window yaklaşımıdır. V1 ve yatay API replica'ları için tutarlıdır; yüksek hacimli internet trafiğinde edge WAF/CDN katmanı gerekir.
- Yerel Compose kolaylığı için tek PostgreSQL bootstrap login'i dar `NOLOGIN` rollere geçer. Production'da servis başına ayrı login wrapper/secret gerekir.
- Yerel HTTP ortamında session cookie `Secure=false`; production config fail-fast secret ve HTTPS/Secure cookie gerektirir.
- Auth security audit olaylarının temel mutation kayıtları vardır; ayrıntılı deny/metric/export kapsamı Aşama 17 gözlemlenebilirlik sertleştirmesinde genişletilecektir.
- Partition helper'ları hazırdır fakat otomatik periyodik housekeeper henüz yoktur.
- Local restore provası production RPO/RTO/PITR garantisi değildir.
- Soğuk Docker image build'i registry bağlantı hızına bağlı olarak birkaç dakika sürebilir; warm build ve normal `up` akışı daha hızlıdır. Build cache mount/prune optimizasyonu Aşama 17 operasyonel sertleştirme kapsamındadır.
- Host `5432` ve `3000` başka projeler tarafından kullanıldığından PostgreSQL `15432`, API `13000`, web `15173` portundadır.
- Liste sayfası kullanıcı isteğiyle 100'er kayıt yükler. 20/200/500 API profili ve 500 kayıtlık bounded UI fixture'ı geçti; tarayıcıda bütün sayfaları elle açarak çok daha büyük DOM üretme senaryosu virtualization kullanmaz.
- Group cursor şu anda tek aktif HMAC anahtarı kullanır; kesintisiz anahtar rotasyonu için önceki doğrulama anahtarını kabul eden key-ring Aşama 17 sertleştirmesinde eklenmelidir.

## Sıradaki İş

Kullanıcı `docs/HEALTH_AND_INCIDENT_ENGINE.md` tasarımını inceledikten sonra Aşama 8'i küçük dilimlerle uygulamak; önce domain tipleri/invariant validator ve acceptance kararı, ardından observation reducer, incident/interval effect'leri, freshness/group projection helper'ları ve sequence/property testlerine geçmek.
