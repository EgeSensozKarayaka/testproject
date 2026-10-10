# Sonraki Adımlar

**Son güncelleme:** 2026-10-10 16:12 +06:00

**Mevcut kilometre taşı:** Aşama 0–9 tamamlandı; Aşama 10'un ilk üç uygulama dilimi tamamlandı

Bu belge teslim sonrası genel fikir listesi değil, mevcut uygulama durumundan sonraki öncelikli çalışma sırasıdır. Ayrıntılı aşama bağımlılıkları `docs/IMPLEMENTATION_PLAN.md` içinde tutulur.

## 1. Sıradaki Çalışma — Aşama 10 Uygulaması

Onaylanmış `docs/MAINTENANCE_WINDOWS.md` tasarımını şu sırayla uygula:

- Overlap, restart ve notification-decision PostgreSQL kabul senaryoları
- Tam CI, durum ve teslim belgelerinin Aşama 10 kapanışıyla güncellenmesi

## 2. Aşama 9 Kapanış Kanıtları

- [Scheduler ve worker nihai mimarisi](./SCHEDULER_AND_WORKERS.md)
- [20/200/500 kapasite raporu](./MONITOR_CAPACITY_REPORT.md)
- [Process-kill ve stale-result fencing raporu](./MONITOR_FAILURE_RECOVERY_REPORT.md)
- [İki-worker ve API izolasyon raporu](./MONITOR_RUNTIME_ISOLATION_REPORT.md)

## 3. Üretim Öncesi Sertleştirme

- Servis başına ayrı PostgreSQL login secret'ları ve secret manager entegrasyonu
- Managed backup/PITR, restore drill ve ölçülmüş RPO/RTO
- Reverse proxy/TLS, edge rate limit ve egress/network policy
- Metric, tracing, alarm, runbook ve güvenlik gözden geçirmesi
- Temiz ortam kurulum, iki istemci ve tam kabul senaryosunun son teslim provası

## 4. Bilinçli Olarak Öncelik Dışı

- Organizasyon/üyelik/rol modeli v1 gereksinimi değildir; kullanıcı sahipliği modeli korunur.
- Predictor yardımcı ve arıza izolasyonlu bir özelliktir; temel monitoring yolunun doğruluğunu veya kullanılabilirliğini belirlemez.
- Mikroservis ayrıştırması, ölçülmüş ölçek ya da izolasyon ihtiyacı olmadan yapılmaz.
