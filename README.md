# Site Availability Monitor

Çok kullanıcılı ve kullanıcı bazlı sahiplik izolasyonuna sahip site erişilebilirlik izleme ürünü. Repository; React web uygulaması, Node.js API ve worker süreçleri, PostgreSQL, Mailpit, deterministik hedef simülatörü ve ana sistemden bağımsız opsiyonel Python predictor için çalışır bir geliştirme temeli içerir.

Ürün domain akışları henüz uygulanmamıştır. Aşama 3 sonunda runtime/kalite temeline ek olarak nihai PostgreSQL şeması, migration runner, RLS/rol sınırları, partition'lar, demo seed'i ve gerçek veritabanı entegrasyon testleri çalışır durumdadır.

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
- `/health/live` ve `/health/ready` — container sağlık uçları

## Repository yapısı

- `apps/` — web, API, monitor worker, notification worker ve target simulator
- `packages/` — domain, contract, config, database, observability ve ortak adapter sınırları
- `database/` — immutable SQL migration'lar ve development seed'i
- `services/predictor/` — bağımsız Python ortamı
- `infra/docker/` — production-benzeri multi-stage image tanımları
- `docs/` — gereksinimler, mimari, kararlar, durum ve geliştirme günlüğü
- `e2e/` — Playwright sistem smoke testleri

## Dürüst durum

Aşama 3 tamamlanmıştır: kilitli monorepo ve runtime temeline ek olarak altı SQL migration, idempotent seed, Kysely tipleri, composite sahiplik kısıtları, 29 `FORCE RLS` tablo, dar servis rolleri, başlangıç partition'ları ve ayrı migration container'ı çalışır durumdadır.

Gerçek kayıt/giriş, check CRUD, scheduler, HTTP probe motoru, incident geçişleri, bakım reconciliation, e-posta gönderimi, history sorguları, SSE, ürün frontend'i ve tahmin algoritması henüz yoktur. Şema bu alanları taşır; iş kuralları sonraki aşamalarda uygulanacaktır. Local mantıksal restore provası geçti, fakat production backup/PITR ve RPO/RTO hedefleri henüz kurulmuş veya doğrulanmış değildir.

Güncel kapsam ve kanıtlar için [proje durumu](docs/PROJECT_STATUS.md), ayrıntılı araç zinciri için [geliştirme ortamı mimarisi](docs/DEVELOPMENT_ENVIRONMENT.md) belgelerine bakın.
