# Sonraki Adımlar

**Son güncelleme:** 2026-10-10 15:42 +06:00

**Mevcut kilometre taşı:** Aşama 0–9 tamamlandı ve doğrulandı

Bu belge teslim sonrası genel fikir listesi değil, mevcut uygulama durumundan sonraki öncelikli çalışma sırasıdır. Ayrıntılı aşama bağımlılıkları `docs/IMPLEMENTATION_PLAN.md` içinde tutulur.

## 1. Sıradaki Çalışma — Aşama 10

Bakım pencerelerinin nihai mimarisini `docs/MAINTENANCE_WINDOWS.md` içinde oluştur:

- Check ve group scope ile sahiplik sınırları
- UTC ve `[start, end)` semantiği
- Örtüşen pencerelerin birleşim davranışı
- Aktif pencereyi uzatma, kısaltma ve silme yarışları
- Bakım sırasında probe/state/incident akışı ile yalnız notification suppression ayrımı
- Bakım bitişinde site hâlâ DOWN ise tek bildirim üreten durable reconciliation işi
- Grup üyeliği değişikliğinin açık incident ve maintenance kapsamına etkisi
- Migration, API, event/outbox ve zaman kontrollü kabul testleri

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
