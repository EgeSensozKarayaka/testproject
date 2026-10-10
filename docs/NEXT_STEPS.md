# Sonraki Adımlar

**Son güncelleme:** 2026-10-10 14:17 +06:00

**Mevcut kilometre taşı:** Aşama 0–8 tamamlandı; Aşama 9 atomik observation persistence dilimi doğrulandı

Bu belge teslim sonrası genel fikir listesi değil, mevcut uygulama durumundan sonraki öncelikli çalışma sırasıdır. Ayrıntılı aşama bağımlılıkları `docs/IMPLEMENTATION_PLAN.md` içinde tutulur.

## 1. Sıradaki Çalışma — Aşama 9

[`SCHEDULER_AND_WORKERS.md`](./SCHEDULER_AND_WORKERS.md) mimarisinin revision 14, typed config, durable cancellation/manual intent, result pointer, activation-aware outbox, owner-fair materialization/claim, global-owner-host bounded probe dispatcher, cancellation acknowledgement, infrastructure retry/DEAD, expired-lease recovery ve atomik observation persistence dilimleri tamamlandı. Sıradaki küçük uygulama dilimleri:

1. Deadline tabanlı freshness reconciler ve restart/catch-up davranışı
2. Scheduler, dispatcher, recovery ve freshness döngülerinin güvenli runtime koordinasyonu; bütün zorunlu yollar hazır olmadan production aktivasyonu yapılmaması
3. Graceful shutdown ve loop-lag/readiness gözlemlenebilirliği
4. Concurrent worker, stale lease, duplicate result, rollback ve 20/200/500 kapasite kanıtları

## 2. Aşama 9 Sonrasında

- Maintenance window komutları ve bildirim bastırma/sonradan gönderme reconciliation'ı
- Incident açılış ve recovery e-postaları; durable, idempotent delivery
- Günlük/haftalık/aylık availability ve response-time history sorguları ile rollup/retention işleri
- Authenticated dashboard için SSE tabanlı canlı güncelleme ve reconnect/catch-up
- Owner kontrollü alan seçimi olan public status sayfası
- İzole Python predictor'ın gerçek telemetry akışına bağlanması ve güvenilirlik sınırlarının ölçülmesi

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
