# Site Availability Monitor

Çok kullanıcılı ve kullanıcı bazlı sahiplik izolasyonuna sahip site erişilebilirlik izleme ürünü. Repository; React web uygulaması, Node.js API ve worker süreçleri, PostgreSQL, Mailpit, deterministik hedef simülatörü ve ana sistemden bağımsız opsiyonel Python predictor için çalışır bir geliştirme temeli içerir.

Aşama 8 sonuna kadar güvenli hesap ve owner-scoped group/check yönetimi, scheduler'dan bağımsız gerçek HTTP kontrol motoru, deterministik hedef simülatörü ve saf sağlık/incident reducer'ı uygulanmıştır. Aşama 9 uygulaması başlamıştır: revision 14 scheduler şema temeli, durable cancellation/manual intent, partition-aware result pointer, activation-aware outbox, typed worker kapasite ayarları ve check-first materialization/claim/lease/fencing adapter'ı hazırdır. Bounded dispatcher, sonuç kalıcılığı ve canlı durum akışları henüz runtime'a bağlanmamıştır.

## Ön koşullar

- Git 2.40+
- Docker Desktop veya Docker Engine + Docker Compose v2
- Host geliştirme için Node.js `24.19.0` ve pnpm `11.25.0`
- Predictor üzerinde host'ta çalışılacaksa Python `3.14.x` ve uv `0.12.20`

Python kurulumu yalnız container tabanlı akışta zorunlu değildir.

## Hızlı başlangıç — tam container stack

```sh
docker compose --profile app up --detach --build --wait
```

Bu akış PostgreSQL sağlıklı olduktan sonra tek-seferlik `migrate` işini çalıştırır; API ve worker'lar yalnız migration başarıyla tamamlanırsa başlar. İlk demo verisini eklemek isterseniz stack başladıktan sonra `pnpm db:seed` çalıştırın.

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

Ardından web, API ve iki zorunlu worker'ı hot reload ile çalıştırın:

```sh
pnpm dev
```

`.env.example` gerekirse `.env` olarak kopyalanabilir. `.env` Git tarafından dışlanır ve örnek dosyada gerçek secret bulunmaz.

Canlı kaynak kotası ürünün sabit 50 kontrol varsayımı değildir. `CHECKS_PER_OWNER_LIMIT` ve `GROUPS_PER_OWNER_LIMIT` pozitif deployment değerleridir; bilinçli limitsiz yerel kurulum için yalnız `unlimited` literal'i kabul edilir.

Probe egress portları, total deadline alt sınırları ve body/header/redirect limitleri `.env.example` içindeki `PROBE_*` değişkenleriyle yönetilir. Local hedef simülatörüne erişim yalnız exact-origin allowlist ile açılır; production ortamı bu geliştirme istisnası tanımlıysa fail-fast kapanır.

## Opsiyonel predictor

Predictor ana stack'in başlangıç veya sağlık bağımlılığı değildir:

```sh
docker compose --profile prediction up --detach --build --wait predictor
```

Readiness: <http://localhost:18000/health/ready>

Predictor durdurulsa veya hata verse bile API, monitoring ve notification süreçleri çalışmaya devam edecek biçimde ayrılmıştır.

## Kalite komutları

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm run ci
```

`pnpm run ci`, format, lint, typecheck, unit/integration test ve build kapılarının yerel birleşimidir. `pnpm ci` yazılmamalıdır; pnpm bunu kendi temiz kurulum komutu olarak yorumlar.

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

Predictor kalite kapıları CI'da pinli Python/uv ile Ruff, mypy, pytest ve coverage olarak çalışır.

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

- `apps/` — web, API, monitor worker, notification worker ve target simulator
- `packages/` — auth, domain, contract, config, database, observability ve ortak adapter sınırları
- `database/` — immutable SQL migration'lar ve development seed'i
- `services/predictor/` — bağımsız Python ortamı
- `infra/docker/` — production-benzeri multi-stage image tanımları
- `docs/` — gereksinimler, mimari, kararlar, durum ve geliştirme günlüğü
- `e2e/` — Playwright sistem smoke testleri

## Dürüst durum

Aşama 0–8 tamamlanmıştır; Aşama 9 uygulaması devam etmektedir. On dört immutable SQL migration, idempotent seed, Kysely tipleri, composite sahiplik kısıtları, `FORCE RLS`, dar servis rolleri, partition'lar ve ayrı migration container'ına ek olarak gerçek auth akışları, group/check API'si, React yapılandırma yönetimi, güvenli HTTP kontrol motoru ve deterministik sağlık/incident reducer'ı uygulanmıştır. Session token'ları veritabanında yalnız digest olarak, auth e-posta payload'ları AES-256-GCM şifreli tutulur; SMTP işlemi ayrı worker tarafından yürütülür.

Monitor worker kontrol motorunu güvenli runtime bağımlılıklarıyla oluşturur; owner-fair materialization ve claim/lease/fencing PostgreSQL adapter'ı ile sağlık/incident karar motoru hazırdır. Ancak bu parçaları çalıştıracak dispatcher, sonuç kalıcılığı transaction'ı, bakım reconciliation, incident bildirimleri, history sorguları, SSE, canlı monitoring dashboard'u/public durum sayfası ve tahmin algoritması henüz yoktur. Mevcut authenticated ekran güvenli yapılandırma yönetimini sağlar; henüz canlı durum paneli değildir. Local mantıksal restore provası geçti, fakat production backup/PITR ve RPO/RTO hedefleri henüz kurulmuş veya doğrulanmış değildir.

Güncel kapsam ve kanıtlar için [proje durumu](docs/PROJECT_STATUS.md), ayrıntılı araç zinciri için [geliştirme ortamı mimarisi](docs/DEVELOPMENT_ENVIRONMENT.md) belgelerine bakın.
