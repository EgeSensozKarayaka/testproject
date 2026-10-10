# Sonraki Adımlar

**Son güncelleme:** 2026-10-10 21:07 +06:00

**Mevcut kilometre taşı:** Aşama 14 teslim kapsamı tamamlandı; teslim provası ve üretim sertleştirmesi sırada

Bu belge teslim sonrası genel fikir listesi değil, mevcut uygulama durumundan sonraki öncelikli çalışma sırasıdır. Ayrıntılı aşama bağımlılıkları `docs/IMPLEMENTATION_PLAN.md` içinde tutulur.

## 1. Sıradaki Çalışma — Teslim Provası

Kullanıcı yönlendirmesiyle ayrı bir frontend mimari dosyası hazırlanmadı. Teslim kapsamındaki arayüz artık doğrudan uygulanmıştır:

- Canlı durum/freshness/bakım dashboard'u, filtreler ve aktif kesinti sayacı
- Günlük/haftalık/aylık response-time ve availability görünümü ile incident günlüğü
- Maintenance window ve notification recipient/default-policy yönetimi
- Opaque bağlantılı, allowlist tabanlı public durum sayfası
- İki-client Playwright kabulü ve public anonim görüntüleme akışı

Sonraki somut iş temiz ortamda `docker compose --profile app up --detach --build --wait` provası, demo verisi ve değerlendirici adımlarının son kez yürütülmesidir.

Aşama 13 kapanış ölçümleri [realtime kapasite raporunda](./REALTIME_CAPACITY_REPORT.md), Aşama 12 ölçümleri [history kapasite raporunda](./HISTORY_CAPACITY_REPORT.md) saklanır.

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
- Python erken uyarı/tahmin sistemi bu teslimin kapsamından çıkarılmıştır.
- Predictor yardımcı ve arıza izolasyonlu bir özelliktir; temel monitoring yolunun doğruluğunu veya kullanılabilirliğini belirlemez.
- Mikroservis ayrıştırması, ölçülmüş ölçek ya da izolasyon ihtiyacı olmadan yapılmaz.
