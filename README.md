# Site Availability Monitor

Çok kullanıcılı ve kullanıcı bazlı sahiplik izolasyonuna sahip site erişilebilirlik izleme ürünü. Repository; React web uygulaması, Node.js API ve worker süreçleri, PostgreSQL, Mailpit ve deterministik hedef simülatörü için çalışır bir geliştirme temeli içerir.

Aşama 0–14'ün teslim kapsamı tamamlanmıştır. Güvenli hesap ve owner-scoped group/check/bakım/bildirim yönetimi, gerçek HTTP kontrol motoru, sağlık/incident reducer'ı ve kalıcı worker runtime'ları uygulanmıştır. Monitor worker probe akışını; notification worker e-posta akışını; housekeeping worker source discovery/rollup/retention işlerini; realtime worker ise aktif `REALTIME` hedefi için lease/fencing ve redacted PostgreSQL wake-up sınırını ayrı process/pool'larda yürütür. React arayüz; canlı dashboard, response-time/availability geçmişi, incident günlüğü, bakım pencereleri, e-posta alıcı/policy yönetimi ve allowlist tabanlı anonim public durum sayfasını içerir. Authenticated ekran SSE + snapshot reconciliation ile, public sayfa ise 10 saniyelik polling ile yenileme gerektirmeden güncellenir.

## Ön koşullar

- Git 2.40+
- Docker Desktop veya Docker Engine + Docker Compose v2
- Host geliştirme için Node.js `24.19.0` ve pnpm `11.25.0`

## Hızlı başlangıç — tam container stack

```sh
docker compose --profile app up --detach --build --wait
```

Bu akış PostgreSQL sağlıklı olduktan sonra tek-seferlik `migrate` işini çalıştırır; API ve worker'lar yalnız migration başarıyla tamamlanırsa başlar. İlk worker/veri inceleme fixture'ını eklemek isterseniz stack başladıktan sonra `pnpm db:seed` çalıştırın. Seed hesabı giriş parolası üretmez; tarayıcı demosu aşağıdaki normal kayıt ve Mailpit doğrulama akışıyla yapılır.

Başlangıçtan sonra:

| Bileşen          | Adres                                 | Amaç                                      |
| ---------------- | ------------------------------------- | ----------------------------------------- |
| Web              | <http://localhost:15173>              | React uygulaması                          |
| API              | <http://localhost:13000/health/ready> | API readiness                             |
| Hedef simülatörü | <http://localhost:4010/ok>            | Başarı, hata, gecikme ve hang senaryoları |
| Mailpit          | <http://localhost:8025>               | Yakalanan geliştirme e-postaları          |
| PostgreSQL       | `localhost:15432`                     | Host araçları için database bağlantısı    |

### Yerel auth doğrulaması

1. <http://localhost:15173> adresinde yeni hesap oluşturun.
2. <http://localhost:8025> üzerindeki Mailpit mesajından doğrulama bağlantısını açın.
3. Hesabınızla giriş yapın; güvenli çalışma alanını gördükten sonra çıkış yapın.
4. İsterseniz “Parolamı unuttum” akışıyla ikinci Mailpit bağlantısını doğrulayın.

Girişten sonra grup ve HTTP kontrolü oluşturabilir; kontrolü düzenleyebilir, duraklatabilir, devam ettirebilir, manuel çalışma kuyruğuna alabilir ve silebilirsiniz. İkinci bir gizli pencere veya tarayıcı oturumuyla aynı hesaba giriş yapıldığında stale düzenleme, veri kaybı yerine açıklayıcı bir eşzamanlılık uyarısı ve güncel kaynağın yeniden yüklenmesiyle sonuçlanır.

Operasyon alanından günlük/haftalık/aylık yanıt süresi ile availability verisini ve incident günlüğünü inceleyebilir; kontrol veya grup için bakım penceresi planlayabilir; doğrulamalı e-posta alıcılarını ve varsayılan bildirim politikasını yönetebilirsiniz. Public durum yöneticisi, hangi kontrollerin yayınlanacağını açıkça seçip URL'leri gizleyerek tek sefer gösterilen anonim bağlantıyı üretir.

Kayıt ve reset istekleri hesap varlığını açıklamayan aynı genel yanıtı döndürür. Yerel geliştirmede cookie HTTPS olmadığı için `Secure=false`; production yapılandırması güvenli anahtarlar ve HTTPS/Secure cookie olmadan başlamaz.

Durumu ve logları görmek için:

```sh
docker compose --profile app ps
docker compose --profile app logs --follow
```

Normal durdurma veritabanı volume'unu korur:

```sh
docker compose --profile app down
```

`docker compose down --volumes` kalıcı yerel veriyi siler ve normal geliştirme akışında kullanılmamalıdır.

## Günlük geliştirme — host uygulamalar

Önce bağımlılıkları ve container altyapısını hazırlayın:

```sh
pnpm install --frozen-lockfile
pnpm dev:infra
pnpm db:migrate
pnpm db:seed
```

Ardından web, API ve dört zorunlu worker'ı hot reload ile çalıştırın:

```sh
pnpm dev
```

`.env.example` gerekirse `.env` olarak kopyalanabilir. `.env` Git tarafından dışlanır ve örnek dosyada gerçek secret bulunmaz.

Canlı kaynak kotası ürünün sabit 50 kontrol varsayımı değildir. `CHECKS_PER_OWNER_LIMIT`, `GROUPS_PER_OWNER_LIMIT` ve `MAINTENANCE_WINDOWS_PER_OWNER_LIMIT` pozitif deployment değerleridir; bilinçli limitsiz yerel kurulum için yalnız `unlimited` literal'i kabul edilir.

Probe egress portları, total deadline alt sınırları ve body/header/redirect limitleri `.env.example` içindeki `PROBE_*` değişkenleriyle yönetilir. Local hedef simülatörüne erişim yalnız exact-origin allowlist ile açılır; production ortamı bu geliştirme istisnası tanımlıysa fail-fast kapanır.

## Kapsam dışı predictor taslağı

Repository'de önceki araştırma turundan kalan izole bir Python predictor taslağı bulunur; teslim edilen ürünün parçası değildir, varsayılan `app` profili tarafından başlatılmaz ve tahmin algoritması/model lifecycle'ı uygulanmamıştır. Ana sistemin hiçbir çalışma veya sağlık bağımlılığı bu taslağa bağlı değildir.

## Kalite komutları

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:capacity
pnpm test:history-capacity
pnpm test:realtime-capacity
pnpm build
pnpm run ci
```

`pnpm run ci`, format, lint, typecheck, unit/integration test ve build kapılarının yerel birleşimidir. `pnpm ci` yazılmamalıdır; pnpm bunu kendi temiz kurulum komutu olarak yorumlar.

`pnpm test:capacity`, gerçek PostgreSQL üzerinde production scheduler→queue→dispatcher→observation yolunu 20/200/500 due check ile profiller. Gerekli test admin bağlantısı ve ölçüm yorumları [monitor kapasite raporunda](docs/MONITOR_CAPACITY_REPORT.md) belgelenmiştir.

`pnpm test:history-capacity`, 20/200/500 housekeeping rollup throughput'unu, 500-check eşdeğer 35 günlük ay sorgusunu ve API–housekeeper izolasyonunu ayrı ağır profilde ölçer. Tekrarlama yöntemi ve bütçeler [history kapasite raporunda](docs/HISTORY_CAPACITY_REPORT.md) bulunur.

`pnpm test:realtime-capacity`, 20/200/500 event burst'ünün iki API replica'sına broadcast'ini, eşzamanlı owner-scoped REST okumalarını ve yavaş istemci izolasyonunu ölçer. Metodoloji, proxy gereksinimleri ve iddia sınırı [realtime kapasite raporunda](docs/REALTIME_CAPACITY_REPORT.md) belgelenmiştir.

Process-kill/doğal lease recovery/stale-result fencing kanıtı [failure recovery raporunda](docs/MONITOR_FAILURE_RECOVERY_REPORT.md); iki gerçek worker prosesi altında API readiness ve authenticated list izolasyonu [runtime izolasyon raporunda](docs/MONITOR_RUNTIME_ISOLATION_REPORT.md) belgelenmiştir.

OpenAPI sözleşmesinden TypeScript tiplerini ve Fastify runtime şemalarını yeniden üretmek veya drift kontrolü yapmak için:

```sh
pnpm contracts:generate
pnpm contracts:check
```

`docs/openapi-v1.yaml` canonical kaynaktır; `packages/contracts/src/generated/` altındaki dosyalar elle düzenlenmez.

E2E testi, Playwright Chromium kurulduktan ve `app` profili ayaktayken çalışır:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

Windows'ta kurulu Edge ile indirme yapmadan doğrulamak için PowerShell'de:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
pnpm test:e2e
```

## Veritabanı komutları

```sh
pnpm db:migrate  # Bekleyen forward-only migration'ları uygular; tekrar çalıştırılabilir
pnpm db:seed     # Yalnız development/test ortamında idempotent demo verisi
```

Durum görmek için package komutu kullanılabilir:

```sh
pnpm --filter @site-monitor/database db:status
```

`db:reset` şemaları silip yeniden kurar ve kasıtlı olarak çift korumalıdır. Yalnız local/test database adı ve `ALLOW_DATABASE_RESET=true` ile çalışır; production ortamını reddeder. PowerShell örneği:

```powershell
$env:ALLOW_DATABASE_RESET = 'true'
pnpm db:reset
Remove-Item Env:ALLOW_DATABASE_RESET
```

Migration dosyaları uygulandıktan sonra değiştirilmez; düzeltmeler yeni ileri migration olarak eklenir. Local varsayılan bağlantı `.env.example` içinde belgelenmiştir; credential veya bağlantı URL'si loglanmaz.

## Hedef simülatörü

- `/ok` — başarılı hızlı cevap
- `/status/:code` — istenen HTTP kodu
- `/delay/:milliseconds` — sınırlandırılmış gecikme
- `/hang` — bağlantıyı cevaplamadan açık tutma
- `/stream/:chunks/:delay` — parçalara ayrılmış, gecikmeli body
- `/body/match` ve `/body/mismatch` — body beklentisi senaryoları
- `/large/:bytes` ve `/compressed/:encoding` — bounded büyük/sıkıştırılmış cevaplar
- `/redirect/:remaining`, `/redirect-loop/:key` ve `/redirect-to?url=...` — redirect senaryoları
- `/flaky/:key` ve `/close` — deterministik geçici hata ve erken bağlantı kapanması
- `/health/live` ve `/health/ready` — container sağlık uçları

## Repository yapısı

- `apps/` — web, API, monitor worker, notification worker, housekeeping worker, realtime worker ve target simulator
- `packages/` — auth, domain, contract, config, database, observability ve ortak adapter sınırları
- `database/` — immutable SQL migration'lar ve development seed'i
- `services/predictor/` — teslim kapsamı dışındaki izole araştırma taslağı
- `infra/docker/` — production-benzeri multi-stage image tanımları
- `docs/` — gereksinimler, mimari, kararlar, durum ve geliştirme günlüğü
- `e2e/` — Playwright sistem smoke testleri

## Dürüst durum

Aşama 0–14 teslim kapsamı tamamlanmıştır. Otuz üç immutable SQL migration, idempotent seed, Kysely tipleri, composite sahiplik kısıtları, `FORCE RLS`, dar servis rolleri, partition'lar ve ayrı migration container'ına ek olarak gerçek auth akışları, group/check/bakım/bildirim/history/incident/public-page API'leri, authenticated private SSE ve browser reconciliation, tam operasyon React arayüzü, güvenli HTTP kontrol motoru, deterministik sağlık/incident reducer'ı ve dört production worker runtime'ı uygulanmıştır. Session token'ları veritabanında yalnız digest olarak, auth e-posta payload'ları AES-256-GCM şifreli tutulur; SMTP işlemi ayrı worker tarafından yürütülür.

Monitor worker owner-fair scheduler, bounded dispatcher, lease recovery ve freshness döngülerini production entrypoint'inde çalıştırır; loop hata durumu readiness'e yansır, graceful shutdown yeni claim'i durdurup aktif işleri bounded sürede drain eder. Compose smoke'unda gerçek 30 saniyelik cadence, `PASS/200`, `UP/FRESH`, restart sonrası run devamlılığı ve duplicate aktif job oluşmaması doğrulanmıştır. 20/200/500 gerçek PostgreSQL runtime profili sabit 50-check varsayımı olmadan doğrulanmıştır. Bakım kapsamı, notification gate, kalıcı notification consumer/SMTP teslimi ve owner-scoped recipient/default-group policy UI/API'si uygulanmıştır. Private history API sabit 288/336/360 bucket ve bounded raw tail; incident journal signed cursor ve observed/unobserved segment ayrımı sağlar. Authenticated SSE ile iki tarayıcı reload olmadan yakınsar. Public sayfa opaque token digest'i ve ayrı read-only DB rolü üzerinden yalnız sahibin yayınladığı alanları gösterir; public SSE yerine 10 saniyelik polling kullanır. Python tahmin özelliği bilinçli olarak teslim kapsamı dışındadır. Local mantıksal restore provası geçti, fakat production backup/PITR ve RPO/RTO hedefleri henüz kurulmuş veya doğrulanmış değildir.

Güncel kapsam ve kanıtlar için [proje durumu](docs/PROJECT_STATUS.md), ayrıntılı araç zinciri için [geliştirme ortamı mimarisi](docs/DEVELOPMENT_ENVIRONMENT.md) belgelerine bakın.
