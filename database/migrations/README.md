# Migrations

Bu dizindeki sıralı SQL dosyaları ileri yönlü ve değişmezdir. Uygulanmış bir dosya düzenlenmez; düzeltme yeni migration olarak eklenir. Runner SHA-256 checksum drift'ini reddeder ve PostgreSQL advisory lock ile aynı anda tek migrator çalıştırır.

Komutlar repository kökünden çalıştırılır:

```sh
pnpm db:migrate
pnpm --filter @site-monitor/database db:status
```

Migration'lar varsayılan olarak tek transaction içindedir. Transaction dışında çalışması gereken bir dosya ilk satırlarında `-- migrate:transaction false` direktifi taşımak zorundadır.

Production rollerinin oluşturulması managed PostgreSQL yetkileri nedeniyle platform bootstrap adımıyla önceden yapılabilir. Yerel PostgreSQL superuser'ı ilk migration'da eksik NOLOGIN grup rollerini güvenli biçimde oluşturur.
