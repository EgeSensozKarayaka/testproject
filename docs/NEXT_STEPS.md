# Sonraki Adımlar

**Son güncelleme:** 2026-10-10 17:52 +06:00

**Mevcut kilometre taşı:** Aşama 0–11 ve Aşama 12 housekeeping runtime tamamlandı; private history/incident API sırada

Bu belge teslim sonrası genel fikir listesi değil, mevcut uygulama durumundan sonraki öncelikli çalışma sırasıdır. Ayrıntılı aşama bağımlılıkları `docs/IMPLEMENTATION_PLAN.md` içinde tutulur.

## 1. Sıradaki Çalışma — Aşama 12 Private API

`docs/HISTORY_AND_RETENTION.md` sözleşmesine göre:

- Canonical history/incident OpenAPI şemalarını projection gerçekliğiyle eşleştir
- Owner-scoped day/week/month history ve incident journal service/routes katmanını ekle
- Signed/filter-bound cursor, tombstone erişimi ve projection-lag fail-closed davranışını test et
- Ardından 20/200/500 rollup profili ve 35 günlük sorgu planı ile Aşama 12'yi kapat

## 2. Aşama 10 Kapanış Kanıtları

- Exact `[start,end)` ve direct+group overlap projection'ı
- Yeni bağlantı havuzuyla process restart sonrası durable maintenance sonucu
- Bakım aktifken üç accepted probe ile incident open/close ve notification fact akışının devam etmesi
- Saf notification gate için `CANCEL`, `DEFER`, `PROCEED` ve stale projection reddi

## 3. Aşama 9 Kapanış Kanıtları

- [Scheduler ve worker nihai mimarisi](./SCHEDULER_AND_WORKERS.md)
- [20/200/500 kapasite raporu](./MONITOR_CAPACITY_REPORT.md)
- [Process-kill ve stale-result fencing raporu](./MONITOR_FAILURE_RECOVERY_REPORT.md)
- [İki-worker ve API izolasyon raporu](./MONITOR_RUNTIME_ISOLATION_REPORT.md)

## 4. Üretim Öncesi Sertleştirme

- Servis başına ayrı PostgreSQL login secret'ları ve secret manager entegrasyonu
- Managed backup/PITR, restore drill ve ölçülmüş RPO/RTO
- Reverse proxy/TLS, edge rate limit ve egress/network policy
- Metric, tracing, alarm, runbook ve güvenlik gözden geçirmesi
- Temiz ortam kurulum, iki istemci ve tam kabul senaryosunun son teslim provası

## 5. Bilinçli Olarak Öncelik Dışı

- Organizasyon/üyelik/rol modeli v1 gereksinimi değildir; kullanıcı sahipliği modeli korunur.
- Predictor yardımcı ve arıza izolasyonlu bir özelliktir; temel monitoring yolunun doğruluğunu veya kullanılabilirliğini belirlemez.
- Mikroservis ayrıştırması, ölçülmüş ölçek ya da izolasyon ihtiyacı olmadan yapılmaz.
