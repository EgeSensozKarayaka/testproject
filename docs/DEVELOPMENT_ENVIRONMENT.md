# Site Availability Monitor — Repository ve Geliştirme Ortamı Mimarisi

**Sürüm:** 1.1
**Durum:** Aşama 2 uygulandı ve doğrulandı
**Tarih:** 2026-10-10 00:50 +06:00
**Dayanak:** `ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `STATE_MACHINES.md`

## 1. Amaç

Bu belge repository yapısını, runtime sürümlerini, bağımlılık yönetimini, yerel geliştirme biçimlerini, Docker Compose topolojisini, yapılandırma yaklaşımını, kalite komutlarını ve CI kapılarını kesinleştirir.

Bu aşamanın amacı ürün özelliği geliştirmek değil; sonraki bütün aşamaların aynı araçlar, sınırlar ve tekrarlanabilir komutlarla ilerleyeceği güvenilir temeli kurmaktır.

## 2. Temel Kararlar

| Alan                      | Karar                                                    |
| ------------------------- | -------------------------------------------------------- |
| Repository                | Tek Git repository, polyglot monorepo                    |
| Node runtime              | Node.js 24 LTS; tam patch sürümü pinlenir                |
| Node package manager      | pnpm 11.25.x; repository içinde tam sürüm pinlenir       |
| Python runtime            | CPython 3.14.x; predictor için minor seri sabitlenir     |
| Python dependency manager | `uv`, `pyproject.toml` ve commit edilen `uv.lock`        |
| Yerel PostgreSQL tabanı   | PostgreSQL 18.6, Debian Bookworm image                   |
| Node module sistemi       | ESM                                                      |
| Node dili                 | Strict TypeScript                                        |
| Task orchestration        | pnpm workspace komutları; başlangıçta Turborepo/Nx yok   |
| Yerel altyapı             | Docker Compose v2                                        |
| Host geliştirme           | Uygulamalar host'ta hot reload, altyapı container'da     |
| Tam-stack doğrulama       | Bütün servisler container içinde Compose profile ile     |
| CI hedefi                 | Linux runner; Windows host geliştirme uyumluluğu korunur |
| Ana CI                    | GitHub Actions                                           |

Node.js 24, tasarım tarihinde resmi olarak LTS durumundadır. Python predictor için aynı gün yayınlanan yeni major yerine paket ekosistemi açısından daha olgun Python 3.14 serisi tercih edilir. Sürümler `latest` etiketiyle değil, pin dosyaları ve container tag/digest ile sabitlenir.

## 3. Repository Yapısı

```text
/
├─ apps/
│  ├─ web/                    # React/Vite tarayıcı uygulaması
│  ├─ api/                    # Fastify API ve SSE entrypoint
│  ├─ monitor-worker/         # Scheduler ve probe execution entrypoint
│  ├─ notification-worker/    # Outbox ve SMTP entrypoint
│  ├─ housekeeping-worker/    # Rollup, partition ve retention entrypoint
│  ├─ realtime-worker/        # Outbox relay ve PostgreSQL wake-up entrypoint
│  └─ target-simulator/       # Test/demo hedef sunucusu
│
├─ packages/
│  ├─ domain/                 # Framework bağımsız domain kuralları
│  ├─ database/               # Repository, transaction ve migration araçları
│  ├─ check-engine/           # SSRF güvenli HTTP probe motoru
│  ├─ notifications/          # Bildirim politikaları ve template'ler
│  ├─ contracts/              # API/event schema ve paylaşılan public tipler
│  ├─ config/                 # Typed environment/config yükleme
│  ├─ observability/          # Log, metric ve correlation yardımcıları
│  └─ testing/                # Test fixture/factory ve ortak test yardımcıları
│
├─ services/
│  └─ predictor/              # Opsiyonel Python worker
│
├─ database/
│  ├─ migrations/
│  └─ seeds/
│
├─ infra/
│  └─ docker/
│     ├─ node.Dockerfile
│     ├─ predictor.Dockerfile
│     └─ entrypoints/
│
├─ docs/
├─ scripts/                   # Shell bağımsız Node yardımcı script'leri
├─ .github/workflows/
├─ compose.yaml
├─ package.json
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml
├─ tsconfig.base.json
├─ eslint.config.js
├─ prettier.config.js
├─ .editorconfig
├─ .gitattributes
├─ .gitignore
└─ .env.example
```

`apps/*` yalnızca composition root ve runtime'a özel adapter içerir. Domain kuralları, repository implementasyonları veya notification politikaları app dizinleri arasında kopyalanmaz.

## 4. Workspace Sınırları ve Bağımlılık Yönü

İzin verilen ana yön:

```text
apps/*
  ├─> packages/contracts
  ├─> packages/config
  ├─> packages/observability
  ├─> packages/domain
  ├─> packages/database
  ├─> packages/check-engine
  └─> packages/notifications

database/check-engine/notifications ──> domain
web ──> contracts
domain ──> hiçbir infrastructure paketi
```

Kurallar:

- `domain` Fastify, PostgreSQL, React, SMTP veya environment variable bilmez.
- `web`, server-only paketleri import edemez; yalnızca `contracts` ve browser-safe paketleri kullanır.
- `contracts` domain entity'lerini doğrudan dışarı sızdırmaz; API/event şemalarını taşır.
- `database`, domain interface'lerini uygular fakat domain'in database'e bağımlılığı yoktur.
- `check-engine` ağ adapter'ıdır; domain'e normalize edilmiş observation döndürür.
- `notifications` domain olaylarını ve policy interface'lerini kullanır; SMTP çağrısı adapter katmanındadır.
- Workspace bağımlılıkları `workspace:*` protokolüyle açıkça tanımlanır.
- Circular workspace dependency CI'da hata kabul edilir.

Başlangıçta bağımsız yayınlanan npm paketleri yoktur. Bütün workspace paketleri private kalır.

## 5. Runtime ve Sürüm Politikası

### Node.js

- Node.js `24.x` LTS kullanılır.
- İlk scaffold sırasında çalışan ve doğrulanan tam patch `.nvmrc`/`.node-version`, `engines` ve CI setup dosyasında aynı değere pinlenir.
- Container base image aynı major/minor/patch sürümü kullanır; release öncesinde digest pinlenir.
- Desteklenen tek Node major sürümü vardır; geniş `>=` aralığı verilmez.
- LTS güvenlik güncellemeleri bağımlılık güncelleme PR'larıyla kontrollü alınır.

Tasarım anındaki yerel runtime `v24.19.0` olduğundan başlangıç pini için uygun aday budur. Uygulama sırasında container registry'de aynı sürüm doğrulanmadan pin kesinleştirilmez.

### pnpm

- Root `package.json` içinde package-manager sürümü tam olarak pinlenir.
- `pnpm-lock.yaml` commit edilir ve elle düzenlenmez.
- CI ve container kurulumları frozen lockfile ile çalışır.
- `pnpm-workspace.yaml` workspace'in tek kapsam kaynağıdır.
- Workspace içi import'lar `workspace:*` kullanır.
- Root'a runtime dependency eklenmez; root yalnızca repository tooling taşır.

Başlangıç sürümü `pnpm 11.25.0` olarak planlanmıştır. Major güncelleme otomatik yapılmaz; ayrı karar ve CI doğrulaması gerektirir.

### Python

- Predictor `requires-python = "==3.14.*"` ile CPython 3.14 serisine bağlanır.
- `.python-version` geliştirme minor sürümünü belirtir; container tam patch/digest ile pinlenir.
- Yeni yayınlanmış Python 3.15 ilk sürüm için kullanılmaz; bilimsel/analitik bağımlılık uyumluluğu kanıtlandıktan sonra ayrı güncelleme olarak değerlendirilir.
- Host Python zorunlu değildir; predictor Docker profile ile çalıştırılabilir.

### uv

- `services/predictor/pyproject.toml` bağımlılık deklarasyonudur.
- `services/predictor/uv.lock` tam çözüm olarak commit edilir.
- CI `uv sync --locked` ve `uv run --locked` kullanır.
- uv sürümü CI ve Dockerfile'da pinlenir.
- Predictor bağımlılıkları root Node lockfile'a karışmaz.

### PostgreSQL ve yardımcı image'lar

Yerel altyapı tabanı PostgreSQL `18.6-bookworm` ve Mailpit `v1.31.4` ile başlatılır. PostgreSQL 18 uyumluluğu, extension ihtiyacı ve şema özellikleri Aşama 3 veritabanı tasarımında ayrıca doğrulanır; uyumsuzluk bulunmadıkça aynı major üretim tabanı olur. Hiçbir Compose servisi kalıcı olarak `latest` tag kullanmaz. Release öncesinde doğrulanan image digest'leri de pinlenir.

## 6. TypeScript Standardı

TypeScript aşağıdaki güvenlik seçenekleriyle çalışır:

- `strict`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `useUnknownInCatchVariables`
- `noImplicitOverride`
- `noFallthroughCasesInSwitch`
- `noImplicitReturns`
- `forceConsistentCasingInFileNames`

Ortak `tsconfig.base.json` yalnızca paylaşılan güvenlik ve module ayarlarını içerir. Browser, Node app ve library paketleri kendi `tsconfig.json` dosyalarıyla ortam kütüphanelerini ayrıştırır.

ESM kullanılır. Node paketleri ESM ve modern Node çözümleme kurallarıyla derlenir; frontend Vite bundler çözümlemesini kullanır. Test veya build için belirsiz path alias'lar yerine package exports tercih edilir.

Build çıktıları source tree dışında `dist/` altında üretilir ve Git'e eklenmez. Source map üretilebilir; production source map erişimi deployment politikasına göre sınırlandırılır.

## 7. Node Kalite Araçları

### Lint

ESLint flat config kullanılır. Kurallar:

- TypeScript type-aware lint
- React hooks ve erişilebilirlik kontrolleri
- Promise misuse/floating promise kontrolleri
- Import boundary ve cycle kontrolleri
- Test dosyaları için ayrı ortam kuralları

### Format

Prettier tek formatlayıcıdır. ESLint format aracı olarak kullanılmaz. CI formatı değiştirmez; yalnızca `format:check` ile doğrular.

### Test

- Vitest: domain, package ve component birim testleri
- Vitest + gerçek PostgreSQL/Testcontainers veya CI service: entegrasyon testleri
- React Testing Library: davranış odaklı UI component testleri
- Playwright: kritik browser uçtan uca akışları

Testler source yanındaki `*.test.ts`/`*.test.tsx` veya paket `test/` dizininde olabilir; repository genelinde tek konvansiyon seçilip karıştırılmaz. E2E testleri root `e2e/` altında tutulur.

Coverage bir kalite hedefidir fakat tek başarı kriteri değildir. Domain state machine, tenant izolasyonu ve scheduler concurrency testleri zorunlu path coverage'a sahip olur.

## 8. Python Kalite Araçları

Predictor için:

- Ruff: lint ve format
- mypy: strict'e yakın statik tip kontrolü
- pytest: birim ve entegrasyon testleri
- Coverage.py/pytest-cov: anlamlı kapsama raporu

Python package `src/` layout kullanır. Notebook üretim kodu veya modelin tek kaynağı olamaz; deneysel notebook varsa `experiments/` altında, çalıştırılabilir pipeline ve karar kaydıyla tutulur.

Model/algoritma artefact'ları Git'e gelişigüzel binary olarak eklenmez. Küçük deterministik fixture'lar dışında büyük artefact'lar sonraki predictor tasarımında tanımlanan registry/storage yaklaşımını kullanır.

## 9. Root Komut Sözleşmesi

Kullanıcı ve CI'nın hatırlaması gereken komutlar root'tan çalışmalıdır. Planlanan sözleşme:

```text
pnpm install --frozen-lockfile   # Kilitli Node bağımlılıkları
pnpm dev:infra                   # PostgreSQL, Mailpit ve simulator
pnpm dev                         # Web, API ve zorunlu worker'lar
pnpm dev:prediction              # Opsiyonel predictor
pnpm build                       # Bütün üretim build'leri
pnpm typecheck                   # Bütün TS projeleri
pnpm lint                        # Node/web lint
pnpm format:check                # Format doğrulaması
pnpm test:unit                   # Hızlı birim testleri
pnpm test:integration            # PostgreSQL/dış adapter entegrasyonları
pnpm test:e2e                    # Playwright akışları
pnpm test                        # Unit + integration varsayılan seti
pnpm run ci                      # CI kalite kapılarının yerel eşdeğeri
pnpm db:migrate                  # İleri migration
pnpm db:seed                     # İdempotent demo seed
pnpm db:reset                    # Yalnızca local/test; production'da reddedilir
```

Script'ler Bash-only syntax içermez. Windows, macOS ve Linux üzerinde aynı komut adları kullanılır. Karmaşık orchestration gerektiğinde `scripts/*.mjs` gibi cross-platform Node script'i yazılır; package.json içine uzun shell zincirleri gömülmez.

`pnpm dev` infrastructure servislerini otomatik olarak silmez veya yeniden oluşturmaz. Destructive `db:reset` açık environment guard gerektirir.

## 10. Yerel Geliştirme Modları

### Mod A — Host uygulamalar + container altyapı

Günlük geliştirme için varsayılandır:

```text
Host:
  web, api, monitor-worker, notification-worker, housekeeping-worker, realtime-worker

Docker:
  postgres, mailpit, target-simulator
```

Avantajları:

- Hızlı hot reload
- IDE/debugger entegrasyonu
- Node dependency cache'inin doğal kullanımı
- Altyapı servislerinin tekrarlanabilirliği

Predictor üzerinde çalışılmıyorsa Python host kurulumu gerekmez.

### Mod B — Tam container stack

CI benzeri doğrulama ve demo için:

```text
docker compose --profile app up --build
```

Bütün ana uygulamalar container içinde çalışır. Bu mod hot reload için optimize edilmez; temiz ortam doğrulaması içindir.

### Mod C — Prediction profile

Predictor yalnızca açık profile ile başlar:

```text
docker compose --profile prediction up --build predictor
```

API veya worker servisleri predictor'a `depends_on` taşımaz.

## 11. Docker Compose Topolojisi

Planlanan servisler:

| Servis                | Varsayılan/Profile   | Kalıcı volume | Sağlık bağımlılığı                                      |
| --------------------- | -------------------- | ------------- | ------------------------------------------------------- |
| `postgres`            | Varsayılan           | Evet          | Kendi healthcheck'i                                     |
| `mailpit`             | Varsayılan           | Hayır         | Kendi healthcheck'i                                     |
| `target-simulator`    | Varsayılan           | Hayır         | HTTP healthcheck                                        |
| `api`                 | `app`                | Hayır         | PostgreSQL ready + migration + dedicated listener hazır |
| `monitor-worker`      | `app`                | Hayır         | PostgreSQL ready + migration tamam                      |
| `notification-worker` | `app`                | Hayır         | PostgreSQL ready; SMTP readiness başlangıcı engellemez  |
| `housekeeping-worker` | `app`                | Hayır         | PostgreSQL ready + migration tamam                      |
| `realtime-worker`     | `app`                | Hayır         | PostgreSQL ready + migration tamam                      |
| `web`                 | `app`                | Hayır         | API liveness; hard startup dependency gerekmez          |
| `predictor`           | `prediction`         | Hayır         | PostgreSQL ready; ana servisler buna bağlı değil        |
| `migrate`             | One-shot profile/job | Hayır         | PostgreSQL ready                                        |

Compose kuralları:

- Internal database ağı host'a yalnızca local geliştirme gereğiyle açılır.
- Servisler container adını DNS host olarak kullanır; `localhost` paylaşılmaz.
- PostgreSQL volume açık isim taşır ve yanlışlıkla silinmez.
- Mailpit verisi varsayılan olarak ephemeral'dır.
- Healthcheck yalnız process varlığını değil gerekli minimum bağımlılığı kontrol eder.
- Her API replica request pool'undan ayrı, tek bağlantılık `LISTEN site_monitor_realtime_v1` pool'u kullanır; listener grace dışı kopuksa readiness fail-closed olur.
- `depends_on` readiness yerine geçmez; uygulamalar retry/backoff ile bağlantı kurar.
- Resource limit'leri özellikle worker ve predictor için tanımlanabilir.
- Predictor profile kapalıyken Compose geçerli ve ana sistem eksiksizdir.

## 12. Container Image İlkeleri

- Multi-stage build kullanılır.
- Dependency kurulumu frozen lockfile ile yapılır.
- Runtime image yalnız gerekli production dosyalarını içerir.
- Process root kullanıcıyla çalışmaz.
- Shell ve paket yöneticisi runtime image'da gerekmiyorsa taşınmaz.
- Tek Node build context'ten app'e özgü target image'lar üretilebilir; entrypoint'ler açıkça ayrılır.
- Secret build argument veya image layer'a yazılmaz.
- OCI label ile commit SHA/build zamanı eklenebilir.
- Container `SIGTERM` alındığında graceful shutdown başlatır.
- Image tag'i izlenebilir commit/release değeridir; production `latest` kullanmaz.

## 13. Port ve URL Sözleşmesi

Local varsayılanlar:

| Bileşen          | Port                                 |
| ---------------- | ------------------------------------ |
| Web dev server   | `5173`                               |
| Web container    | `15173` (host), `8080` (Compose ağı) |
| API              | `13000` (host), `3000` (Compose ağı) |
| Target simulator | `4010`                               |
| PostgreSQL       | `15432` (host), `5432` (Compose ağı) |
| Mailpit SMTP     | `1025`                               |
| Mailpit UI       | `8025`                               |
| Predictor        | `18000` (host), `8000` (Compose ağı) |

Portlar environment ile değiştirilebilir. Frontend yalnız public API base URL kullanır; database veya SMTP adresi browser build'ine girmez.

Local cookie güvenliği için HTTP geliştirme istisnası açık config ile yönetilir. Production'da secure-cookie koruması kapatılamaz.

## 14. Yapılandırma ve Secret Yönetimi

Her process yalnız ihtiyaç duyduğu değişkenleri typed schema ile başlangıçta doğrular. Eksik veya geçersiz kritik config, process'i açık hata mesajıyla başlamadan durdurur.

Planlanan gruplar:

- Runtime identity ve environment
- API host/origin/cookie ayarları
- Process'e özel PostgreSQL connection URL/role
- Scheduler concurrency, lease ve grace ayarları
- Probe timeout/size/redirect limitleri
- SMTP bağlantısı
- Retention/housekeeping ayarları
- Public/SSE limitleri
- Predictor enable/resource ayarları

Kurallar:

- `.env.example` gerçek secret içermez.
- `.env` Git'e eklenmez.
- `NODE_ENV` dışında tek bir belirsiz environment flag ile davranış kümeleri yönetilmez; özellikler açık değişkenler taşır.
- Config process başlangıcında bir kez parse edilir ve immutable typed object olarak enjekte edilir.
- Secret değerleri loglanmaz; config özeti redacted üretilebilir.
- Frontend'e yalnız `VITE_PUBLIC_*` benzeri açık allowlist değişkenler aktarılır.
- Production secret'ları platform secret store'dan gelir; repository içinde tutulmaz.

## 15. Veritabanı Geliştirme Akışı

Aşama 3 kesin şemayı uygulamıştır. Repository şu sözleşmeyi uygular:

- Migration'lar tek, ileri yönlü ve sıralıdır.
- Uygulama startup'ı otomatik destructive migration çalıştırmaz.
- `migrate` ayrı one-shot command/job'dır.
- Seed idempotent ve yalnız local/demo verisi üretir.
- Test database'i her test worker'ı için izole schema veya database kullanır.
- Production reset/drop komutları environment guard ile reddedilir.
- Migration durumu health/readiness tarafından kontrol edilebilir.

## 16. Test Ortamı Stratejisi

### Birim testleri

- Dış servis gerektirmez.
- Fake clock, deterministic ID ve seeded random kullanır.
- Domain testleri gerçek zamanı veya ağ bağlantısını doğrudan çağırmaz.

### Entegrasyon testleri

- Gerçek PostgreSQL kullanır.
- Testcontainers veya CI PostgreSQL service ile izole çalışır.
- Her suite migration'ı gerçek biçimde uygular.
- Transaction rollback tek izolasyon yöntemi değildir; concurrent worker testleri gerçek commit görmelidir.

### E2E testleri

- Build edilmiş veya production benzeri servisleri kullanır.
- Mailpit API ve target simulator üzerinden dış davranışı kanıtlar.
- Sabit sleep yerine observable condition bekler.
- Test sonunda oluşturduğu veriyi temizler veya ephemeral stack'i kapatır.

### Zaman kontrollü testler

State machine testleri injectable clock kullanır. PostgreSQL zaman ve lock testleri gerçek clock ile toleranslı assertion kullanır. Uzun 30 saniye/1 saat beklemeler testlerde gerçek zamanla yapılmaz.

## 17. CI Pipeline

GitHub Actions ana akışı pull request ve ana branch push'unda çalışır.

### Job 1 — Repository validation

- Lockfile ve workspace tutarlılığı
- Yasaklı secret/dosya kontrolü
- Markdown ve temel doküman link kontrolü
- Generated artifact drift kontrolü — eklendiğinde

### Job 2 — Node quality

- Pinned Node/pnpm kurulumu
- Frozen install
- Format check
- ESLint
- TypeScript typecheck
- Unit test
- Production build

### Job 3 — Python quality

Predictor dosyaları mevcut olduğunda:

- Pinned Python/uv kurulumu
- `uv sync --locked`
- Ruff format/lint
- mypy
- pytest

Predictor opsiyonel runtime olsa da repository quality gate'leri opsiyonel değildir; kod varsa test edilir.

### Job 4 — Database/integration

- Ephemeral PostgreSQL
- Migration sıfırdan uygulama
- Seed smoke test
- Node integration testleri
- RLS/ownership/concurrency testleri

### Job 5 — E2E

- Tam-stack image build
- Compose ile servis başlangıcı
- Readiness bekleme
- Playwright kritik akışları
- Hata durumunda service log ve test artefact yükleme

### Job 6 — Security baseline

- Dependency audit
- Secret scanning
- Container/dependency vulnerability raporu
- Kritik bulguda tanımlı failure policy

CI prensipleri:

- Cache yalnız package-manager/download cache'lerini tutar; `node_modules` güvenilir artefact sayılmaz.
- Workflow permission'ları minimumdur.
- Fork PR'larında secret gerektiren iş çalışmaz.
- Aynı branch'in eski workflow'u yeni push geldiğinde iptal edilebilir.
- Test logları secret ve token içeremez.

## 18. Git ve Commit Politikası

Repository Aşama 2 uygulamasında başlatılır.

- Varsayılan branch `main`.
- Commit'ler küçük ve çalışır durumda tutulur.
- Conventional Commits biçimi tercih edilir: `docs:`, `chore:`, `feat:`, `fix:`, `test:`.
- Lockfile değişimi dependency manifest değişimiyle aynı commit'te olur.
- Generated veya binary dosya yalnız belgelenmiş gereksinim varsa commit edilir.
- `.gitattributes` kaynak ve config dosyaları için LF standardı uygular.
- Büyük model artefact'ları normal Git geçmişine eklenmez.
- Kullanıcı veya ajan değişiklikleri ilişkisiz biçimde yeniden yazılmaz.

İlk önerilen commit dizisi:

1. `docs: define project requirements and architecture`
2. `chore: initialize monorepo toolchain`
3. `chore: add local infrastructure compose`
4. `ci: add baseline quality workflow`

Mevcut dokümanlar ilk commit'e dahil edilir; bütün proje tek son commit olarak teslim edilmez.

## 19. Editör ve Platform Uyumluluğu

- `.editorconfig` UTF-8, final newline ve temel indentation tanımlar.
- `.gitattributes` text normalization sağlar.
- Script'ler Windows PowerShell, macOS ve Linux'ta package-manager komutları üzerinden aynı adla çağrılır.
- Path işlemleri Node API veya platform bağımsız kütüphaneler kullanır.
- Shell-specific helper zorunluysa Windows ve POSIX eşdeğeri yerine tek Node script'i tercih edilir.
- Case-sensitive CI, Windows'ta görünmeyen dosya adı/import hatalarını yakalar.

## 20. Dependency Yönetimi

- Direct dependency'ler manifestte açıkça bulunur; transitive import yapılmaz.
- Production ve development dependency ayrımı korunur.
- Yeni paket eklenirken amaç, bakım durumu, güvenlik yüzeyi ve mevcut araçla çözülememe nedeni karar/log kaydına yazılır.
- Lockfile güncellemeleri review edilebilir ayrı PR/commit olur.
- Otomatik dependency bot'u haftalık gruplanmış güncelleme önerebilir; major güncellemeler ayrı ele alınır.
- Runtime paketlerinde geniş ve kontrolsüz version range yerine lockfile esas alınır.
- Install script kullanan paketler gerektiğinde allowlist politikasına tabi tutulur.

## 21. Gözlemlenebilirlik Temeli

Aşama 2 yalnız temel adapter'ları hazırlar; ayrıntılı metrikler Aşama 17'de tamamlanır.

- Her process başlangıçta service adı, version ve environment içeren structured log üretir.
- Correlation ID propagation için ortak interface bulunur.
- API `/health/live` ve `/health/ready` sözleşmesini taşır.
- Worker process liveness ve database heartbeat için ortak interface taşır.
- Log katmanı secret redaction'ı merkezi uygular.
- `console.log` doğrudan production uygulama kodu standardı değildir.

## 22. Uygulama Sırası

Aşama 2 tasarımı kabul edildikten sonra uygulama şu sırayla yapılır:

1. Git repository ve temel ignore/editor dosyaları
2. Root pnpm workspace ve sürüm pinleri
3. TypeScript/ESLint/Prettier ortak config
4. Package/app dizinleri ve minimal entrypoint'ler
5. Root kalite ve geliştirme script'leri
6. Docker Compose altyapı servisleri
7. Multi-stage Node ve predictor Dockerfile temeli
8. Python predictor `pyproject.toml`/uv temeli
9. Basit liveness/readiness smoke testleri
10. GitHub Actions baseline pipeline
11. Temiz ortam kurulumu ve Windows/Linux komut doğrulaması

Bu sırada domain veya veritabanı iş kuralları henüz implemente edilmez; boş runtime'lar ve kalite zinciri sonraki aşamalara hazır hale getirilir.

## 23. Tamamlanma Kriterleri

Aşama 2 uygulaması ancak aşağıdakiler kanıtlandığında tamamlanır:

- Pinned Node/pnpm ile frozen install başarılıdır.
- Workspace dependency graph cycle içermez.
- Bütün minimal Node app/package'leri typecheck ve build olur.
- Python predictor iskeleti locked environment ile lint/typecheck/test geçer.
- Host geliştirme modu altyapıyı başlatır.
- Tam container profile bütün zorunlu servisleri başlatır.
- Predictor profile tamamen çıkarıldığında ana stack değişmeden çalışır.
- `.env.example` yeterli ve secretsizdir.
- Root `lint`, `format:check`, `typecheck`, `test` ve `build` komutları başarılıdır.
- CI aynı kontrolleri temiz runner'da tekrarlar.
- Windows'a özgü shell bağımlılığı bulunmaz.
- README başlangıç adımları temiz ortamda doğrulanmıştır.

## 24. Bilinçli Olarak Eklenmeyen Araçlar

- **Turborepo/Nx:** Başlangıç workspace boyutunda pnpm recursive komutları yeterlidir. Ölçülen build süresi sorunu olursa eklenir.
- **Kubernetes:** Yerel çalışma ve ilk deployment için gerekli değildir.
- **Redis/Kafka:** Repository temeli için gerekli değildir; PostgreSQL kuyruğu ana karardır.
- **Husky/Lefthook zorunluluğu:** CI ana enforcement noktasıdır. İsteğe bağlı local hooks daha sonra eklenebilir.
- **Storybook:** UI component hacmi oluşmadan eklenmez.
- **Monorepo package publishing aracı:** Paketler private ve repository içidir.

## 25. Kaynak ve Sürüm Notları

- Node.js 24 resmi release tablosunda LTS durumundadır: <https://nodejs.org/en/about/previous-releases>
- pnpm workspace, `pnpm-workspace.yaml` ve `workspace:` protokolünü doğal olarak destekler: <https://pnpm.io/workspaces>
- Python 3.14, tasarım tarihinde olgun bakım sürümüne sahiptir; Python 3.15 yeni major olarak aynı tarihte yayınlanmıştır: <https://www.python.org/downloads/>
- uv, `pyproject.toml`, `.python-version` ve commit edilebilir cross-platform `uv.lock` proje akışını destekler: <https://docs.astral.sh/uv/guides/projects/>
- Docker Compose profile'ları opsiyonel servis gruplarını etkinleştirmek için kullanılır: <https://docs.docker.com/compose/how-tos/profiles/>

## 26. Uygulama Sonucu

Aşama 2, 2026-10-10 tarihinde uygulandı ve yerel ortamda doğrulandı:

- Frozen pnpm kurulumu, format, lint, strict typecheck, unit/integration test komutları ve bütün build'ler geçti.
- `app` profili API, web, iki worker ve target simulator image'larını üretip bütün healthcheck'lerle başladı.
- Playwright, web/API entegrasyonunu ve iki bağımsız browser context'ini doğruladı.
- Predictor image'ı ayrı profile ile çalıştı; durdurulduğunda ana API sağlıklı kalmaya devam etti.
- Predictor Ruff/mypy/pytest kapıları geçti ve `%70` zorunlu coverage eşiğinin üzerinde `%84.95` sağladı.
- Aşama 3'te ayrı non-root `migrate` servisi, gerçek `db:migrate|seed|reset|status` komutları ve schema-aware readiness eklendi. `app`/`prediction` servisleri migration işi başarıyla tamamlanmadan başlamaz.
