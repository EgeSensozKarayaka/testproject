# Site Availability Monitor

Çok kullanıcılı ve kullanıcı bazlı sahiplik izolasyonuna sahip site erişilebilirlik izleme ürünü. Repository; React web uygulaması, Node.js API ve worker süreçleri, PostgreSQL, Mailpit, deterministik hedef simülatörü ve ana sistemden bağımsız opsiyonel Python predictor için çalışır bir geliştirme temeli içerir.

Ürün domain özellikleri henüz uygulanmamıştır. Mevcut kod Aşama 2'nin runtime, kalite, container ve CI temelidir; sıradaki çalışma nihai veritabanı tasarımıdır.

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

## Hedef simülatörü

- `/ok` — başarılı hızlı cevap
- `/status/:code` — istenen HTTP kodu
- `/delay/:milliseconds` — sınırlandırılmış gecikme
- `/hang` — bağlantıyı cevaplamadan açık tutma
- `/health/live` ve `/health/ready` — container sağlık uçları

## Repository yapısı

- `apps/` — web, API, monitor worker, notification worker ve target simulator
- `packages/` — domain, contract, config, database, observability ve ortak adapter sınırları
- `services/predictor/` — bağımsız Python ortamı
- `infra/docker/` — production-benzeri multi-stage image tanımları
- `docs/` — gereksinimler, mimari, kararlar, durum ve geliştirme günlüğü
- `e2e/` — Playwright sistem smoke testleri

## Dürüst durum

Aşama 2 tamamlanmıştır: kilitli monorepo, strict TypeScript, minimal runtime'lar, health/readiness, container profilleri, Python izolasyonu, otomatik testler ve GitHub Actions temeli çalışır durumdadır.

Henüz veritabanı şeması/migration, kimlik doğrulama, check CRUD, scheduler, gerçek HTTP probe motoru, incident, bakım, e-posta outbox, SSE, geçmiş rollup ve tahmin algoritması yoktur. `db:*` komutları Aşama 3 şeması onaylanana kadar bilinçli olarak hata verir.

Güncel kapsam ve kanıtlar için [proje durumu](docs/PROJECT_STATUS.md), ayrıntılı araç zinciri için [geliştirme ortamı mimarisi](docs/DEVELOPMENT_ENVIRONMENT.md) belgelerine bakın.
