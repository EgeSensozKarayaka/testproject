# Domain Event Kataloğu

**Aşama:** 4 — API, Event ve Hata Sözleşmeleri

**Durum:** Onaylandı; ortak envelope/type allowlist'i uygulandı, producer'lar ilgili domain aşamalarında eklenecek

**Tarih:** 2026-10-10

**Bağlı belgeler:** [`DOMAIN_MODEL.md`](./DOMAIN_MODEL.md), [`STATE_MACHINES.md`](./STATE_MACHINES.md), [`REALTIME_CONTRACT.md`](./REALTIME_CONTRACT.md)

## 1. Amaç ve Sınır

Bu katalog transaction ile üretilen iç domain/integration event'lerinin v1 sözleşmesidir. Event'ler worker, notification, realtime projection, audit ve predictor bileşenlerini gevşek bağlar. Bunlar doğrudan browser SSE payload'ı değildir; dışarı yalnız [`REALTIME_CONTRACT.md`](./REALTIME_CONTRACT.md) içindeki allowlist projection'lar çıkar.

PostgreSQL transactional outbox kalıcı teslim kaynağıdır. `LISTEN/NOTIFY` yalnız yeni kayıt bulunduğuna dair kaybedilebilir bir uyandırma sinyalidir; event verisi veya kalıcılık mekanizması değildir.

## 2. Ortak Event Envelope v1

```json
{
  "event_id": "0192f82c-f949-72d8-bef2-461c4484df2c",
  "event_type": "check.health_changed",
  "schema_version": 1,
  "occurred_at": "2026-10-10T03:10:11.482Z",
  "recorded_at": "2026-10-10T03:10:11.489Z",
  "owner_id": "0192f7a7-dbd6-762b-9495-47ee57ef0f80",
  "aggregate_type": "check_state",
  "aggregate_id": "0192f7c8-548e-7c43-9f79-93cbf7eaf831",
  "aggregate_version": "18",
  "correlation_id": "0192f82c-08e8-77d0-8f85-29888b2a718d",
  "causation_id": "0192f82c-4291-759b-90b4-d6e43cdf281e",
  "payload": {}
}
```

| Alan                | Kural                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `event_id`          | UUIDv7; immutable global event kimliği ve tüketici idempotency anahtarı.                                       |
| `event_type`        | Bu katalogdaki lowercase noktalı ad.                                                                           |
| `schema_version`    | Aynı event type payload sürümü; ilk sürüm `1`.                                                                 |
| `occurred_at`       | Domain olayının UTC anı. Gecikmiş yazımda `recorded_at`tan eski olabilir.                                      |
| `recorded_at`       | Outbox satırının aynı transaction'da yazıldığı UTC an; DB `created_at` kolonu dış envelope'da bu adla eşlenir. |
| `owner_id`          | Private event'te zorunlu UUID; sistem-geneli event'te `null`.                                                  |
| `aggregate_type/id` | Event'in sıralama ve yeniden okuma kökü.                                                                       |
| `aggregate_version` | Version'lanan aggregate için decimal string; projection/system event'inde `null` olabilir.                     |
| `correlation_id`    | Başlatan HTTP request, scheduled job veya reconciliation zinciri kimliği.                                      |
| `causation_id`      | Doğrudan sebep event/command kimliği; dış kökte `null`.                                                        |
| `payload`           | Event'e özel, minimal ve sürümlü veri.                                                                         |

Envelope'e yeni opsiyonel alan eklemek geriye uyumludur. Var olan alanı kaldırmak, tip/anlam değiştirmek veya required yapmak yeni `schema_version` gerektirir.

## 3. Teslim, Sıralama ve Tüketim Kuralları

- Teslim semantiği **at-least-once**'dır. Exactly-once iddiası yoktur.
- Producer domain değişikliği ile outbox kaydını aynı DB transaction'ında yazar.
- Consumer `(consumer_name, event_id)` benzersiz makbuzuyla idempotent davranır. İş yan etkisi ve makbuz mümkünse aynı transaction'dadır.
- Yalnız aynı `aggregate_type + aggregate_id` içindeki `aggregate_version` sırası anlamlıdır. Aggregate'ler arasında global sıra yoktur.
- Consumer sürüm boşluğu veya bilinmeyen sürüm görürse event payload'ından state kurmaz; kaynağın current projection'ını yeniden okur veya dead-letter'a alır.
- Retry exponential backoff + jitter kullanır. Poison event bounded retry sonrası görünür dead-letter durumuna geçer; sessizce düşürülmez.
- Bir event publish edilmişse değiştirilemez/silinemez. Düzeltme yeni event veya yeni schema version'dır.
- Consumer event zamanı için `occurred_at`, teslim gecikmesi için `recorded_at` kullanır; wall-clock `now` ile domain sırası çıkarmaz.

## 4. Veri Minimizasyonu

Payload mümkün olduğunca kimlik, sürüm, durum geçişi ve karar nedenini taşır. Consumer ayrıntı gerekiyorsa owner-scoped source of truth'u okur.

Event payload'ında bulunmaz:

- parola/hash, session, CSRF, reset/verification veya public access token;
- e-posta adresi, SMTP gövdesi veya header'ı;
- tam target URL query/fragment'i, expected body text'i veya response body;
- çözümlenen private IP, stack trace veya provider secret'ı.

Target gösterimi gerektiğinde `target_origin` yerine güvenli `check_id` ve yapılandırma generation'ı taşınır. Bildirim adapter'ı adres/şablon verisini owner-scoped DB'den okur.

## 5. Yapılandırma Event'leri

Tablolardaki payload alanlarının tümü v1'de zorunludur; `null` açıkça belirtilen yerde geçerlidir.

| Event                               | Aggregate | Payload v1                                                                                                        | Birincil tüketiciler                                          |
| ----------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `user.created`                      | `user`    | `user_id`, `resource_version`                                                                                     | audit, onboarding                                             |
| `user.disabled`                     | `user`    | `user_id`, `resource_version`, `reason_code`                                                                      | session revocation, scheduler, audit                          |
| `check.created`                     | `check`   | `check_id`, `resource_version`, `probe_generation`, `schedule_generation`, `execution_state`, `group_id` nullable | scheduler, realtime, audit                                    |
| `check.metadata_changed`            | `check`   | `check_id`, `resource_version`, `changed_fields[]`                                                                | realtime, audit, public projection                            |
| `check.probe_configuration_changed` | `check`   | `check_id`, `resource_version`, `previous_probe_generation`, `probe_generation`, `changed_fields[]`               | scheduler, state engine, audit                                |
| `check.schedule_changed`            | `check`   | `check_id`, `resource_version`, `previous_schedule_generation`, `schedule_generation`, `interval_seconds`         | scheduler, realtime, audit                                    |
| `check.paused`                      | `check`   | `check_id`, `resource_version`, `probe_generation`, `schedule_generation`, `paused_at`                            | scheduler, realtime, notification reconciliation              |
| `check.resumed`                     | `check`   | `check_id`, `resource_version`, `probe_generation`, `schedule_generation`, `resumed_at`, `next_run_at`            | scheduler, realtime                                           |
| `check.group_changed`               | `check`   | `check_id`, `resource_version`, `previous_group_id` nullable, `group_id` nullable                                 | maintenance, notification policy, public projection, realtime |
| `check.deleted`                     | `check`   | `check_id`, `resource_version`, `deleted_at`                                                                      | scheduler, maintenance, public projection, realtime, audit    |
| `group.created`                     | `group`   | `group_id`, `resource_version`                                                                                    | realtime, audit                                               |
| `group.changed`                     | `group`   | `group_id`, `resource_version`, `changed_fields[]`                                                                | notification policy, public projection, realtime, audit       |
| `group.deleted`                     | `group`   | `group_id`, `resource_version`, `deleted_at`                                                                      | check reassignment, maintenance, public projection, realtime  |

`changed_fields` yalnız alan adlarından oluşan alfabetik sıralı allowlist'tir; eski/yeni hassas değerleri taşımaz.

## 6. Çalıştırma ve Sağlık Event'leri

| Event                            | Aggregate     | Payload v1                                                                                                                                                                                  | Birincil tüketiciler                                     |
| -------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `check.manual_run_requested`     | `check`       | `check_id`, `request_id`, `mode` (`STATEFUL`/`DIAGNOSTIC`), `requested_at`, `probe_generation`, `schedule_generation`                                                                       | scheduler, audit                                         |
| `check.job_available`            | `check_job`   | `job_id`, `check_id`, `job_kind`, `not_before`, `probe_generation`, `schedule_generation`                                                                                                   | monitor workers                                          |
| `check.run_recorded`             | `check_run`   | `run_id`, `check_id`, `finished_at`, `outcome` (`PASS`/`FAIL`), `accepted`, `failure_category` nullable, `response_time_ms`, `probe_generation`, `schedule_generation`                      | history, predictor trigger, audit metrics                |
| `check.observation_accepted`     | `check_state` | `check_id`, `run_id`, `finished_at`, `outcome`, `probe_generation`, `state_version`, `previous_health`, `candidate_health`                                                                  | state engine diagnostics, realtime coalescing            |
| `check.observation_rejected`     | `check_run`   | `check_id`, `run_id`, `finished_at`, `reason_code`, `observed_probe_generation`, `current_probe_generation`                                                                                 | operations metrics, audit                                |
| `check.health_changed`           | `check_state` | `check_id`, `state_version`, `previous_health`, `health`, `changed_at`, `trigger_run_id`, `active_incident_id` nullable                                                                     | history diagnostics, public projection, realtime         |
| `check.freshness_changed`        | `check_state` | `check_id`, `state_version`, `previous_freshness`, `freshness`, `changed_at`, `reason_code`                                                                                                 | operations, public projection, realtime                  |
| `incident.opened`                | `incident`    | `incident_id`, `check_id`, `resource_version`, `started_at`, `confirmed_at`, `trigger_run_id`, `maintenance_suppressed`                                                                     | notification intent, realtime, public projection         |
| `incident.observation_suspended` | `incident`    | `incident_id`, `check_id`, `resource_version`, `segment_id`, `suspended_at`, `reason_code`                                                                                                  | history, realtime                                        |
| `incident.observation_resumed`   | `incident`    | `incident_id`, `check_id`, `resource_version`, `segment_id`, `resumed_at`, `reason_code`                                                                                                    | history, realtime                                        |
| `incident.closed`                | `incident`    | `incident_id`, `check_id`, `resource_version`, `started_at`, `ended_at`, `closure_reason`, `observed_duration_ms`, `wall_duration_ms`, `recovery_run_id` nullable, `maintenance_suppressed` | notification intent, realtime, public projection, rollup |

`check.run_recorded.accepted=false` sonucu geçmişte tutulur fakat health/incident üretmez. `check.observation_rejected.reason_code` canonical allowlist'i `DUPLICATE_RUN`, `ATTEMPT_NOT_CURRENT`, `CHECK_DELETED`, `DIAGNOSTIC_RUN`, `CHECK_PAUSED`, `PROBE_GENERATION_MISMATCH`, `SCHEDULE_GENERATION_MISMATCH` ve `STALE_FENCING_TOKEN` değerleridir. Engine/programming hatası target run değildir ve bu event ile FAIL olarak yayınlanmaz.

## 7. Bakım ve Bildirim Event'leri

| Event                                  | Aggregate                | Payload v1                                                                                                                             | Birincil tüketiciler                                   |
| -------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `maintenance.created`                  | `maintenance_window`     | `maintenance_id`, `resource_version`, `target_type`, `target_id`, `starts_at`, `ends_at`                                               | reconciliation scheduler, realtime, audit              |
| `maintenance.changed`                  | `maintenance_window`     | `maintenance_id`, `resource_version`, `target_type`, `target_id`, `previous_starts_at`, `previous_ends_at`, `starts_at`, `ends_at`     | reconciliation scheduler, notification, realtime       |
| `maintenance.cancelled`                | `maintenance_window`     | `maintenance_id`, `resource_version`, `target_type`, `target_id`, `cancelled_at`                                                       | notification reconciliation, realtime, audit           |
| `maintenance.reconciliation_requested` | `maintenance_window`     | `maintenance_id`, `target_type`, `target_id`, `effective_at`, `reason_code`                                                            | maintenance reconciler                                 |
| `notification.recipient_created`       | `notification_recipient` | `recipient_id`, `resource_version`, `verification_state`                                                                               | verification sender, realtime, audit                   |
| `notification.recipient_reactivated`   | `notification_recipient` | `recipient_id`, `resource_version`                                                                                                     | verification sender, realtime, audit                   |
| `notification.recipient_verified`      | `notification_recipient` | `recipient_id`, `resource_version`, `verified_at`                                                                                      | notification policy, realtime, audit                   |
| `notification.recipient_disabled`      | `notification_recipient` | `recipient_id`, `resource_version`, `disabled_at`                                                                                      | delivery cancellation, policy reconciliation, realtime |
| `notification.policy_changed`          | `notification_policy`    | `policy_id`, `resource_version`, `scope_type`, `scope_id` nullable, `mode`, `recipient_ids[]`                                          | notification evaluator, realtime, audit                |
| `notification.intent_created`          | `notification_intent`    | `intent_id`, `incident_id`, `check_id`, `kind` (`DOWN`/`RECOVERY`), `decision`, `suppression_reason` nullable, `evaluate_at` nullable  | delivery planner, audit                                |
| `notification.delivery_scheduled`      | `notification_delivery`  | `delivery_id`, `intent_id`, `recipient_id`, `kind`, `attempt`, `not_before`                                                            | notification worker                                    |
| `notification.delivery_sent`           | `notification_delivery`  | `delivery_id`, `intent_id`, `recipient_id`, `kind`, `attempt`, `sent_at`, `provider_message_ref_hash` nullable                         | operations, audit                                      |
| `notification.delivery_failed`         | `notification_delivery`  | `delivery_id`, `intent_id`, `recipient_id`, `kind`, `attempt`, `failed_at`, `failure_category`, `terminal`, `next_attempt_at` nullable | retry scheduler, operations, audit                     |

E-posta adresi event'e konmaz. `provider_message_ref_hash` geri izleme için tek yönlü/kısaltılmış değerdir; provider token veya ham message ID değildir.

Bakım bitiminde ayrı `maintenance.ended` event'i zorunlu değildir: kalıcı reconciliation job zamanı gelince source of truth'u okur ve `maintenance.reconciliation_requested` üretir. Böylece process restart sırasında zamanlayıcı sinyali kaybolsa da bildirim kaçmaz.

## 8. Public Sayfa ve Prediction Event'leri

| Event                      | Aggregate            | Payload v1                                                                                                   | Birincil tüketiciler                           |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `public_page.published`    | `public_status_page` | `page_id`, `resource_version`, `published_at`, `page_revision`                                               | public snapshot, realtime, audit               |
| `public_page.changed`      | `public_status_page` | `page_id`, `resource_version`, `page_revision` nullable, `changed_fields[]`                                  | public snapshot, realtime, audit               |
| `public_page.link_rotated` | `public_status_page` | `page_id`, `resource_version`, `rotated_at`, `page_revision`                                                 | cache invalidation, realtime disconnect, audit |
| `public_page.disabled`     | `public_status_page` | `page_id`, `resource_version`, `disabled_at`, `page_revision` nullable                                       | cache invalidation, realtime disconnect, audit |
| `prediction.requested`     | `prediction_job`     | `prediction_job_id`, `check_id`, `feature_cutoff_at`, `algorithm_version`                                    | Python predictor                               |
| `prediction.updated`       | `prediction_score`   | `prediction_id`, `check_id`, `prediction_version`, `risk_level`, `score`, `valid_until`, `algorithm_version` | realtime, private UI                           |
| `prediction.expired`       | `prediction_score`   | `prediction_id`, `check_id`, `prediction_version`, `expired_at`, `reason_code`                               | realtime, private UI                           |

Raw public token event'e girmez. `page_revision` decimal string'dir ve public snapshot/SSE sıralamasında kullanılır; snapshot olmayan state'te null olabilir. Prediction açıklama/feature değerleri event'e konmaz; private endpoint source of truth'tan okur. Prediction event'lerinin hiçbir tüketicisi check health, incident veya notification state'ini değiştiremez.

## 9. Producer ve Destination Matrisi

Uygulanmış Aşama 3 şeması yalnız dört durable destination kabul eder; Aşama 4 bu listeyi gizlice genişletmez:

| DB destination | Sorumluluk                                                                            |
| -------------- | ------------------------------------------------------------------------------------- |
| `REALTIME`     | Private query invalidation, public snapshot yeniden üretimi ve SSE projection sinyali |
| `NOTIFICATION` | Incident/bakım/policy değerlendirmesi, intent ve delivery üretimi                     |
| `PREDICTION`   | Coalesced analiz talebi; kapalı veya bozuksa ana akışı bloke etmez                    |
| `AUDIT`        | Redacted, immutable denetim kaydı                                                     |

Scheduler'ın source of truth'u `monitoring.check_jobs`, history/rollup'ın source of truth'u run/interval tabloları, bakım bitişinin source of truth'u maintenance + kalıcı reconciliation işidir; bunlar yeni outbox destination adı değildir. `check.job_available` gibi katalog event'leri gözlemlenebilir/audit edilebilir domain gerçeğidir fakat job claim'i outbox teslimine bağlanmaz.

Destination fiziksel topic adı değildir; `infra.outbox_dispatches.destination` değeridir. Aynı canonical event gereken dört destination'dan birden fazlasına ayrı dispatch satırıyla fan-out edilebilir. Consumer'ın ihtiyacı olmayan event'i tüm payload ile yayınlayan global bus kurulmaz. Yeni durable tüketici sınıfı gerekirse eski migration/check constraint değiştirilmez; review edilmiş forward-only migration gerekir.

Destination'ın katalogda tanımlı olması consumer'ın deployment'ta hazır olduğu anlamına gelmez. Producer yalnız migration-owned `infra.destination_activations` kaydı bulunan destination için event/dispatch üretir. Aktivasyon öncesinde source-of-truth tablolardan snapshot/reconciliation/backfill hazırlanır; aktivasyon sonrasında consumer'ın geçici arızası dispatch üretimini durdurmaz. Böylece henüz yazılmamış consumer için sınırsız backlog ve ilk açılışta eski notification replay'i oluşmaz. Ayrıntılı cutover kuralı [`SCHEDULER_AND_WORKERS.md`](./SCHEDULER_AND_WORKERS.md) içindedir.

## 10. Şema Evrimi

1. Yeni opsiyonel payload alanı v1'de eklenebilir; consumer bilinmeyen alanı yok sayar.
2. Yeni required alan, alan kaldırma/yeniden adlandırma, enum anlamı veya birim değişikliği `schema_version: 2` gerektirir.
3. Producer geçiş süresince eski ve yeni consumer uyumluluğunu ölçer; gerekirse dual-publish ayrı outbox kayıtlarıyla yapılır.
4. Consumer desteklemediği major event schema'sını acknowledge etmez; görünür dead-letter ve alarm üretir.
5. Event adı geçmiş anlamı değiştirilerek yeniden kullanılamaz.
6. PII sınıflandırması genişleyen bir payload değişikliği yalnız sürüm değil güvenlik incelemesi de gerektirir.

## 11. Realtime Projection Eşleme

İç event'ler browser'a bire bir taşınmaz. Realtime projector event'i owner/page allowlist'iyle şu dış ailelere coalesce eder:

| İç aile                       | Private SSE                             | Public SSE                                                       |
| ----------------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| Check config/health/freshness | `check.changed`, `check.status_changed` | `status_page.updated` yalnız yayınlanan component ise            |
| Group/config                  | `group.changed`, `group.status_changed` | `status_page.updated` yalnız yayınlanan component ise            |
| Incident                      | `incident.changed`                      | `status_page.updated` yalnız görünürlük izinliyse                |
| Maintenance                   | `maintenance.changed`                   | `status_page.updated` yalnız component yayındaysa                |
| Notification                  | `notification.changed`                  | Asla                                                             |
| Public config                 | `public_page.changed`                   | `status_page.updated` veya stream kapatma                        |
| Prediction                    | `prediction.changed`                    | Varsayılan olarak asla; ayrıca allowlist gerekirse sonraki sürüm |

SSE payload event source of truth değildir; event kaçıran istemci REST snapshot ile uzlaşır.

## 12. Doğrulama Kapısı

Uygulama öncesi/sonrası aşağıdakiler test edilir:

- Her state-changing transaction ya domain + outbox'ı birlikte commit eder ya hiçbirini etmez.
- Aynı `event_id` iki kez tüketildiğinde tek iş yan etkisi oluşur.
- Aynı aggregate'in version sırası korunur; farklı aggregate'ler için global sıra varsayılmaz.
- Bilinmeyen event/version açıkça dead-letter ve metrik üretir.
- Event serialization schema testinden geçer; decimal version'lar JSON number olmaz.
- Owner event'i yanlış consumer/owner stream'ine düşmez.
- Token, e-posta, target secret/query, expected body ve response body payload veya logda bulunmaz.
- Predictor kapalı/bozukken ana outbox ve monitoring transaction'ları bloke olmaz.
- Outbox backlog/retry/dead-letter gözlemlenebilir ve güvenli biçimde yeniden işlenebilir.
