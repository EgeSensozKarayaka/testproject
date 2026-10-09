# Site Availability Monitor

Çok kullanıcılı, sahiplik izolasyonuna sahip site erişilebilirlik izleme ürünü. Proje şu anda altyapı ve uygulama temeli kurulumu aşamasındadır; çalışan ürün özellikleri henüz uygulanmamıştır.

## Ön Koşullar

- Git 2.40 veya üzeri
- Docker Desktop veya Docker Engine + Docker Compose v2
- Sonraki uygulama aşamaları için Node.js 24 LTS ve pnpm 11.25
- Predictor üzerinde host'ta çalışılacaksa Python 3.14 ve uv

## Yerel Altyapıyı Başlatma

Varsayılan geliştirme değerleriyle:

```sh
docker compose up --detach --wait
```

Özel port veya yerel parola kullanılacaksa önce `.env.example` dosyasını `.env` olarak kopyalayıp yalnız yerel değerleri değiştirin. `.env` Git tarafından dışlanır.

Başlatılan servisler:

| Servis | Yerel adres | Amaç |
| --- | --- | --- |
| PostgreSQL | `localhost:15432` | Kalıcı geliştirme verisi; container ağında `postgres:5432` |
| Mailpit SMTP | `localhost:1025` | Geliştirme e-postalarını yakalama |
| Mailpit UI | <http://localhost:8025> | Yakalanan e-postaları görüntüleme |

Durumu görmek için:

```sh
docker compose ps
```

Servisleri durdurmak için:

```sh
docker compose down
```

PostgreSQL verisi `site-monitor-postgres-data` adlı Docker volume içinde korunur. `docker compose down --volumes` veriyi geri döndürülemeyecek biçimde kaldıracağı için normal geliştirme akışında kullanılmamalıdır.

## Mevcut Durum

Şu anda yalnızca PostgreSQL ve Mailpit geliştirme altyapısı tanımlanmıştır. API, frontend, worker'lar, hedef simülatörü, migration'lar ve predictor henüz çalışır durumda değildir. Güncel ayrıntılar için `docs/PROJECT_STATUS.md` dosyasına bakın.

## Tasarım Belgeleri

- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/DEVELOPMENT_ENVIRONMENT.md`
- `docs/PROJECT_STATUS.md`
- `docs/DECISIONS.md`

