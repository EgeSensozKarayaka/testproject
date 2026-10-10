# Proje Durumu

**Son güncelleme:** 2026-10-10 15:42 +06:00

**Genel durum:** Aşama 0–9 tamamlandı ve doğrulandı; sıradaki çalışma Aşama 10 bakım pencereleri mimarisidir

## Tamamlanan

- İki gerçek production monitor-worker ve ayrı production API prosesinin aynı PostgreSQL üzerinde eşzamanlı çalıştığı 200-check kabul profili; 200 job/attempt/run/accepted result ve 200 hedef isteği tam eşleşirken iki worker da iş aldı
- Worker yükü sırasında gerçek session ile 40 authenticated check-list ve 40 readiness isteğinin tamamının başarılı olması; list p95 **32.1 ms**, readiness p95 **18.4 ms**, ayrı proses/pool API izolasyonu
- Tekrarlama yöntemi, exact correctness tablosu, latency bütçeleri ve replica başına concurrency tavizini içeren `docs/MONITOR_RUNTIME_ISOLATION_REPORT.md`
- Production monitor worker'ın gerçek hanging HTTP probe sırasında ayrı Node prosesinde `SIGKILL` ile kaybedilmesi; elle lease değiştirmeden doğal expiry, `LEASE_LOST`, bounded retry, daha yüksek fence ile replacement completion ve eski FAIL sonucunun current state/incident'ı değiştirmeden `ATTEMPT_NOT_CURRENT` reddi
- Tekrarlanabilir senaryo, kalıcı lineage tablosu, dürüst zombie-delivery ayrımı ve kapsam dışı failure mode'ları içeren `docs/MONITOR_FAILURE_RECOVERY_REPORT.md`
- Production scheduler→PostgreSQL queue→bounded dispatcher→atomik observation yolunu aynı kodla çalıştıran 20/200/500 kapasite fixture'ı; exact terminal/run sayısı, owner-fair ilk claim, concurrency ve DB pool sınırları otomatik doğrulanıyor
- Tekrarlanabilir `pnpm test:capacity` komutu ve ortam/metodoloji/metric/bütçe/sınırlama ayrımını içeren `docs/MONITOR_CAPACITY_REPORT.md`
- Scheduler, dispatcher, expired-lease recovery ve freshness reconciler'ı birbirinden bağımsız, non-overlapping ve abort edilebilir polling loop'larında production worker entrypoint'ine bağlayan runtime coordinator
- Bütün loop'lar ilk başarılı iteration'ı tamamlayana kadar ve herhangi bir loop hata durumundayken unavailable olan readiness; yalnız hata geçişini redacted kodla loglayan ve iyileşmeyi ayrı kaydeden log-storm koruması
- Startup'ta schema compatibility ile mevcut/sonraki UTC ayın `check_runs` ve `health_intervals` partition'larını doğrulayan storage preflight
- Yeni claim'i durduran, poll beklemelerini kesen, aktif probe'ları grace süresince bekleyen, süre aşımında abort eden ve takılı DB iteration'ında dahi bounded dönen graceful shutdown
- Docker Compose üzerinde demo check'in gerçek 30 saniyelik cadence ile `PASS/200` üretmesi, `UP/FRESH` state'e gelmesi, SIGTERM'de `drained=true`, restart sonrasında run sayısının **10'dan 11'e** çıkması ve sıfır duplicate aktif job ile devam etmesi
- Scheduler'ın PostgreSQL mikrosaniyeli `next_run_at` değerini Node `Date` milisaniyesiyle eşitlemeye çalışarak sıfır satır güncellemesi üretmesi canlı smoke'ta yakalandı; check lock'unun sağladığı yarış güvenliği korunarak kırılgan timestamp eşitliği kaldırıldı ve mikrosaniyeli fixture ile sabitlendi
- Exact-origin development SSRF istisnasının private Docker IP'yi kabul etmesine rağmen tek etiketli allowlisted hostname'i erken reddetmesi smoke'ta yakalandı; yalnız production'da yasak olan exact allowlist için sıra düzeltildi, DNS/IP doğrulaması ve near-miss reddi korundu
- Runtime dilimi final `pnpm run ci` kapısında format, 57-operation contract drift, lint, bütün workspace strict typecheck'leri, **22 dosyada 165/165 unit**, **6 dosyada 52/52 gerçek PostgreSQL/socket integration** ve bütün production build'leriyle geçti
- Revision 14 scheduler temeli: request-time manual mode, durable cancellation request, eksiksiz job runtime-state constraint'i, partition-key result pointer'ı, rejection allowlist'i ve migration-owned destination activation/cutover kaydı
- API pause/config/delete komutlarında PENDING job için terminal cancel, LEASED/RUNNING job için acknowledgement bekleyen cancellation request; pause sırasında bekleyen STATEFUL manual intent temizliği
- API ve worker için ortak activation-aware outbox writer; inactive consumer için event/dispatch üretmeme, aktive destination sonrası durable dispatch davranışı ve gereksiz geniş `SELECT` yetkisi vermeyen least-privilege SQL sınırı
- Monitor worker için global/owner/hostname concurrency, batch, poll, heartbeat, lease, shutdown ve DB pool değerlerini ilişki doğrulamasıyla yükleyen typed runtime config
- Anchor-aligned sabit cadence ve restart'ta değişmeyen bounded exponential retry/jitter yardımcıları
- Owner-fair due/manual candidate seçimi; check-first `SKIP LOCKED` materialization, tek catch-up job, no-backfill cadence ilerletme, stored manual mode tüketimi ve redacted `check.job_available` audit/outbox fact'i
- Owner-fair pending-job seçimi; canonical check→job claim, check-scope monoton fence, attempt lineage, timeout+grace lease, conditional start ve attempt-guarded heartbeat/cancellation görünürlüğü
- Claim öncesi global/owner/hostname slotu alan, doymuş adayı lease etmeden batch içindeki diğer owner/host işlerine ilerleyen bounded dispatcher
- Process-secret HMAC fingerprint kullanan ve hostname/owner değerlerini log/metric label yapmayan process-local concurrency gate; idempotent slot bırakma ve boş bucket temizliği
- Strict snapshot decode, task-scoped abort controller, heartbeat/cancellation gözetimi, lease-loss fencing, izole promise registry ve typed target-result/infrastructure-fault sink sınırıyla probe orchestration
- Current worker/fence/attempt/lease guard'lı cancellation acknowledgement; transient engine/cancellation fault için deterministik bounded retry, desteklenmeyen snapshot veya tükenen bütçe için `DEAD`
- Owner-fair expired-lease taraması; check→job→attempt kilit sırasıyla tek recovery, `LEASE_LOST` attempt lineage, geçersiz generation/pause/delete/cancellation için terminal cancel ve terminal geçişle aynı transaction'da coalesced manual intent materialization
- Aşama 7 probe sonucunu Aşama 8 reducer'ına bağlayan atomik PostgreSQL observation adapter'ı; immutable run, current state, interval, incident, segment, audit, activation-aware outbox, attempt pointer, job terminal geçişi ve bekleyen manual intent'in tek transaction'da uygulanması
- DB-türetilmiş ve check başına monoton `finished_at`; lease geçerliliğini ayrı gerçek DB gözlem anında değerlendiren, aynı milisaniyedeki ardışık run'larda zero-length incident segmenti/health interval'ı üretmeyen zaman politikası
- Deadline'ı geçmiş FRESH state'leri owner-fair ve bounded seçen; check-first `SKIP LOCKED` transaction'ında tam `fresh_until` anında STALE yapan, interval'i UNKNOWN'a döndüren ve observed incident segmentini gap süresini saymadan askıya alan freshness reconciler
- Aşama 8 saf state reducer'ı; immutable snapshot/invariant doğrulaması, canonical observation acceptance precedence, sabit iki-failure threshold, provisional timeline çözümleme, incident segment/duration effect'leri, deadline reconciliation ve bounded event fact'leri
- Check ve group API sorgularında reconciler'dan bağımsız `fresh_until` read-time override'ı; effective UNKNOWN/UNOBSERVED görünümü, incident duration cap'i ve aynı semantiği kullanan set-based group aggregate
- Scheduler/DB'den bağımsız güvenli HTTP probe motoru; versioned snapshot doğrulama, frozen DNS candidate pinning, public IPv4/IPv6 policy, redirect, total deadline/cancellation, bounded streaming/decompression ve typed hata taksonomisi
- DNS çağrısı yapmayan kısa ömürlü direct TCP/TLS connector; hostname/SNI sertifika doğrulaması, proxy bypass'ı, operator port allowlist'i ve production'da reddedilen exact-origin local simulator istisnası
- Başarı/body/status, streaming, gecikme/hang, büyük/sıkıştırılmış body, redirect/loop, flaky ve erken bağlantı kapanması fixture'larıyla genişletilmiş hedef simülatörü
- Aşama 0 gereksinim/kabul kriterleri, Aşama 1 domain/durum makineleri, Aşama 2 monorepo/runtime/CI temeli, Aşama 3 kalıcılık ve Aşama 4 API/event/hata sözleşmeleri
- PostgreSQL 18.6 üzerinde on dört checksum'lı, immutable ve forward-only migration; schema-aware readiness, ayrı migration container'ı ve idempotent development seed'i
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

- Aşama 9 kapanış `pnpm run ci` kapısı format, 57-operation contract drift, lint, bütün workspace strict typecheck'leri, **22 dosyada 165/165 unit**, **8 dosyada 57/57 gerçek PostgreSQL/socket/process integration** ve bütün production build'leriyle geçti.
- Multi-process izolasyon testi hedefli koşuda **1/1** geçti: iki worker 200 job'ı attempt numarası 1'i aşmadan ve duplicate HTTP/run üretmeden tamamladı; yük altındaki 80 API isteğinin tamamı `200` döndü.
- Recovery dilimi final `pnpm run ci` kapısında format, 57-operation contract drift, lint, bütün workspace strict typecheck'leri, **22 dosyada 165/165 unit**, **7 dosyada 56/56 gerçek PostgreSQL/socket/process integration** ve bütün production build'leriyle geçti.
- Process-failure hedefli observation-store paketi gerçek PostgreSQL ve gerçek child process ile **10/10** geçti. Worker'ın hedefe ulaşmış hanging probe'u sırasında force-kill edildiği, job'ın expiry'ye kadar `RUNNING` kaldığı, replacement fence'in monoton büyüdüğü, accepted PASS sonrasında eski FAIL'in yalnız rejected history olduğu ve sıfır incident üretildiği doğrulandı.
- 20/200/500 kapasite testi izole, sıfırdan migration uygulanmış gerçek PostgreSQL üzerinde **3/3** geçti. 500-check burst scheduler'da **4.60 sn**, dispatch+persistence'ta **4.14 sn**, uçtan uca **8.73 sn** sürdü; **57.25 check/s**, **4.55 sn claim-lag p95**, **60.2 ms execution/persistence p95**, en fazla **7/8 busy DB connection**, 500/500 accepted run ve sıfır aktif job ölçüldü.
- Kapasite fixture'ı dahil final `pnpm run ci`; format, 57-operation contract drift, lint, bütün workspace strict typecheck'leri, **22 dosyada 165/165 unit**, **7 dosyada 55/55 gerçek PostgreSQL/socket integration** ve bütün production build'leriyle geçti.
- Aşama 9 freshness reconciler hedefli gerçek PostgreSQL paketinde observation senaryolarıyla birlikte **8/8** geçti: iki replica tek deadline'ı yalnız bir kez uyguladı, DOWN incident tam deadline'da UNOBSERVED oldu, eşzamanlı yeni observation ve reconciliation FRESH/UP sonucuna yakınsadı, iki owner global batch limitinden önce adil seçildi. Strict monitor-worker typecheck ve workspace lint geçti.
- Freshness reconciliation dilimi final `pnpm run ci` kapısında format, 57-operation contract drift, lint, bütün workspace strict typecheck'leri, **21 dosyada 161/161 unit**, **6 dosyada 51/51 gerçek PostgreSQL/socket integration** ve bütün production build'leriyle geçti.
- Aşama 9 observation adapter'ı gerçek PostgreSQL üzerinde **4/4** hedefli testte geçti: iki eşzamanlı writer tek run/effect üretti ve duplicate replay aynı partition pointer'ından döndü; pending manual intent terminal transaction'da materialize edildi; FAIL/FAIL/PASS incident'ı pozitif süreyle açıp kapattı; diagnostic ve cancellation reddi state'i değiştirmedi; invalid snapshot bütün transaction'ı rollback etti.
- Observation persistence dilimi final `pnpm run ci` kapısında format, 57-operation contract drift, lint, bütün workspace strict typecheck'leri, **21 dosyada 161/161 unit**, **6 dosyada 47/47 gerçek PostgreSQL/socket integration** ve bütün production build'leriyle geçti.
- Aşama 9 fault/recovery diliminde cancellation + manual-intent atomikliği, transient retry, unsupported snapshot ve tükenen retry bütçesi için `DEAD`, iki eşzamanlı sweeper'ın tek expired lease'i yalnız bir kez recover etmesi ve expired cancellation'ın retry edilmemesi gerçek PostgreSQL üzerinde **7/7** job-queue testiyle geçti.
- Fault/recovery sonrasında final `pnpm run ci` kapısı format, 57-operation contract drift, lint, bütün workspace strict typecheck'leri, **21 dosyada 161/161 unit**, **5 dosyada 43/43 gerçek PostgreSQL/socket integration** ve bütün production build'leriyle geçti.
- Aşama 9 dispatcher diliminde concurrency gate, active-task isolation, saturated-candidate scan, unsupported snapshot, heartbeat cancellation ve heartbeat-hang safety deadline senaryoları **6/6** geçti. Doymuş büyük owner içindeki aday claim edilmezken aynı batch'teki başka owner ilerledi; task tamamlanınca bütün slot bucket'ları temizlendi.
- Dispatcher sonrası bütün unit paket **21 dosyada 161/161**, gerçek PostgreSQL/socket integration paketi **5 dosyada 39/39** geçti.
- Dispatcher dilimi final `pnpm run ci` kapısı format, 57-operation contract drift, lint, bütün workspace strict typecheck'leri, **161/161 unit**, **39/39 integration** ve bütün production build'leriyle geçti.
- Aşama 9 ikinci diliminde saf cadence/backoff testleri **4/4**, gerçek PostgreSQL owner-fair materialization ve iki-worker claim/lease/fence testleri **3/3** geçti. Sahte attempt kimliği start alamadı; lease sahibi olmayan worker heartbeat yenileyemedi; cancellation request doğru worker'a görünür oldu.
- Bütün unit paket **20 dosyada 155/155**, sıfırdan migration ve gerçek PostgreSQL/socket integration paketi **5 dosyada 39/39** geçti.
- Aşama 9 ikinci dilim final `pnpm run ci` kapısı format, 57-operation contract drift, lint, bütün workspace strict typecheck'leri, **155/155 unit**, **39/39 integration** ve bütün production build'leriyle geçti.
- Aşama 9 temel diliminde strict workspace typecheck geçti; unit paket **19 dosyada 151/151**, sıfırdan revision 1–14 migration ve gerçek PostgreSQL API/RLS/outbox sınırı **4 dosyada 36/36** geçti.
- Aşama 9 final `pnpm run ci` kapısı format, 57-operation contract drift, lint, strict typecheck, **151/151 unit**, **36/36 integration** ve bütün production build'leriyle geçti. Güncel migration/API/monitor-worker imajları üretildi; migration revision 14'ü doğruladı, API ile monitor worker healthy oldu ve iki readiness endpoint'i de `200` döndürdü.
- İlk activation-aware outbox entegrasyonu `INSERT ... RETURNING` nedeniyle API rolünden gereksiz `SELECT` istedi ve testte `42501` ile reddedildi. Yetki genişletilmeden SQL akışı düzeltildi; aynı paket sonraki koşuda tamamen geçti.
- Aşama 8 domain paketi **16/16** odaklı testte geçti; buna 250 observation'lık sabit-seed sequence, duplicate/diagnostic/stale fencing reddi, provisional UP/DOWN/UNKNOWN çözümleme, incident suspend/resume/recovery ve deadline duration cap dahildir.
- Check/group PostgreSQL sınırı **17/17** geçti. Reconciler gecikmesinde list/filter sonucu STALE/UNKNOWN, incident görünümü UNOBSERVED ve duration deadline'da capped; group aggregate 20/200/500 canlı check fixture'ıyla doğrulandı. Kapasite testinin fixture + sorgu süresi yerel warm koşuda **359 ms** idi.
- Final `pnpm run ci`; format, 57-operation contract drift, lint, strict typecheck, **18 dosyada 147/147 unit**, gerçek PostgreSQL ile **4 dosyada 34/34 integration** ve bütün production build'leriyle geçti.
- PostgreSQL cleanup yarış düzeltmesi sonrasında unit paket **149/149**, integration paket **34/34** geçti. GitHub Actions [`38030487100`](https://github.com/EgeSensozKarayaka/testproject/actions/runs/38030487100) Node, PostgreSQL, Python, dependency audit ve full-stack smoke işlerinin beşinde başarılı oldu.
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

- Maintenance reconciliation ve incident e-posta politikaları
- Rollup/retention background işleri, history sorguları ve grafikler
- SSE canlı güncelleme, monitoring dashboard'u ve public durum sayfası
- Predictor analiz algoritması/model lifecycle'ı
- MFA/passkey, OAuth/OIDC, organizasyon/üyelik/rol modeli ve kullanıcıya açık session/device yönetimi
- Production deployment, servis başına ayrı login secret'ları, managed backup/PITR ve production restore drill'i

## Bilinen Sınırlamalar

- Authenticated ekran group/check yapılandırmasını yönetir; probe ve sağlık motorları kalıcılık seviyesinde bağlanmış olsa da canlı monitoring projection/UI henüz uygulanmadığından nihai durum paneli değildir.
- Production worker loop'u, 20/200/500 runtime throughput/queue-lag, SIGKILL sonrası doğal lease reclaim/stale-result fencing ve iki gerçek worker yükü altında API latency doğrulanmıştır. Ölçümler yerel regresyon baseline'ıdır; production SLO veya çok-node PostgreSQL/network partition garantisi değildir.
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

Aşama 10 bakım pencereleri için nihai mimari hazırlanacaktır; kullanıcı belgeyi inceledikten sonra migration ve uygulama dilimlerine geçilecektir.
