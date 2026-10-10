# Sonraki Adımlar

**Son güncelleme:** 2026-10-10 13:48 +06:00

**Mevcut kilometre taşı:** Aşama 0–8 tamamlandı; Aşama 9 fault settlement ve lease recovery dilimi doğrulandı

Bu belge teslim sonrası genel fikir listesi değil, mevcut uygulama durumundan sonraki öncelikli çalışma sırasıdır. Ayrıntılı aşama bağımlılıkları `docs/IMPLEMENTATION_PLAN.md` içinde tutulur.

## 1. Sıradaki Çalışma — Aşama 9

[`SCHEDULER_AND_WORKERS.md`](./SCHEDULER_AND_WORKERS.md) mimarisinin revision 14, typed config, durable cancellation/manual intent, result pointer, activation-aware outbox, owner-fair materialization/claim, global-owner-host bounded probe dispatcher, cancellation acknowledgement, infrastructure retry/DEAD ve expired-lease recovery dilimleri tamamlandı. Sıradaki küçük uygulama dilimleri:

1. Aşama 7 probe sonucunun Aşama 8 saf transition planına bağlanması
2. Run, current state, interval, incident, segment, audit ve outbox'ın tek transaction'da kalıcılaştırılması
3. Result sink tamamlandıktan sonra scheduler/dispatcher production loop aktivasyonu
4. Deadline tabanlı freshness reconciler ve restart/catch-up davranışı
5. Graceful shutdown ve loop-lag/readiness gözlemlenebilirliği
6. Concurrent worker, stale lease, duplicate result, rollback ve 20/200/500 kapasite kanıtları

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
