# Site Availability Monitor — Durum Makineleri

**Sürüm:** 1.0  
**Durum:** Nihai domain geçişleri; Aşama 8 acceptance semantiğiyle hizalı
**Tarih:** 2026-10-09 22:53 +06:00
**Son güncelleme:** 2026-10-10 11:02 +06:00

## 1. Genel Kurallar

- Bütün geçişler açık bir komut, accepted observation, zaman olayı veya reconciliation tarafından tetiklenir.
- Aynı event ID veya run ID tekrar işlendiğinde ikinci domain etkisi oluşmaz.
- Domain sırası yalnızca wall-clock timestamp'e dayanmaz; resource version, generation ve fencing token ile korunur.
- Tanınmayan veya mevcut state için geçersiz komut sessizce uygulanmaz; typed conflict/validation sonucu üretir.
- Domain transaction'ı dış sistem çağrısı yapmaz.

## 2. Check Lifecycle ve Execution

Lifecycle ve execution birbirinden ayrıdır.

### Lifecycle

```text
LIVE ──DeleteCheck──> DELETED
```

`DELETED` terminaldir. Aynı Check ID yeniden etkinleştirilemez; kullanıcı aynı yapılandırmayla yeni check oluşturabilir.

### Execution

```text
ACTIVE ──PauseCheck──> PAUSED
PAUSED ──ResumeCheck─> ACTIVE
```

| Mevcut | Olay | Yeni | Yan etkiler |
| --- | --- | --- | --- |
| ACTIVE | Pause | PAUSED | Schedule generation artar, queued işler iptal edilir, running sonuç state için geçersizleşir, candidate temizlenir, incident segment'i askıya alınır. |
| PAUSED | Pause | PAUSED | Idempotent no-op; resource version gereksiz artırılmaz. |
| PAUSED | Resume | ACTIVE | Schedule generation artar, en kısa zamanda ilk scheduled job oluşturulur, effective health UNKNOWN kalır. |
| ACTIVE | Resume | ACTIVE | Idempotent no-op. |
| LIVE | Delete | DELETED | Schedule durur, işler geçersizleşir, incident CHECK_DELETED ile kapanır, public görünüm kalkar. |
| DELETED | Herhangi mutasyon | DELETED | `resource_not_found` veya terminal-state conflict. |

## 3. Manual Run Modu

Manual run ayrı bir check state'i değildir; job özelliğidir.

| Check durumu | Manual mode | State etkisi | Cadence etkisi |
| --- | --- | --- | --- |
| LIVE + ACTIVE | STATEFUL | Health/incident state machine'e katılır. | Yok |
| LIVE + PAUSED | DIAGNOSTIC | Run saklanır, health/incident/availability/bildirim değişmez. | Yok |
| DELETED | Yok | Talep reddedilir. | Yok |

Check için aktif/queued iş varsa yeni manual talepler tek `manual_requested=true` niyetinde birleşir. Mevcut iş tamamlanınca en fazla bir manual job oluşturulur.

## 4. Check Job State Machine

```text
PENDING ──claim──> LEASED ──start──> RUNNING ──result persisted──> COMPLETED
   │                 │                  │
   │                 ├─lease expiry─────┤──> PENDING (retryable)
   │                 │                  │
   ├─invalidate──────┴──────────────────┴──> CANCELLED
   │
   └─retry budget exhausted / permanent internal error──> DEAD
```

| State | İzin verilen işlemler | Notlar |
| --- | --- | --- |
| PENDING | Claim, cancel | Claim atomik lease ve fencing token üretir. |
| LEASED | Start, heartbeat, release, expire, cancel | HTTP isteği başlamadan önceki kısa evre. |
| RUNNING | Heartbeat, persist result, lose lease, cancel request | Lease kaybında worker abort sinyali alır. |
| COMPLETED | Yok | Hedef PASS veya FAIL olabilir; ikisi de job'ın başarılı yürütülmesidir. |
| CANCELLED | Yok | Pause/delete/config invalidation nedeniyle yürütülmeyecek iş. |
| DEAD | Operatör/reconciliation incelemesi | Internal hatalar retry bütçesini tüketmiştir; hedef failure gözlemi üretilmez. |

Lease expiry sonrası job yeniden PENDING olabilir. Yeni claim daha yüksek fencing token üretir. Eski attempt'in sonucu CheckRun olarak tanısal biçimde saklanabilse bile observation acceptance'tan geçemez.

## 5. Observation Acceptance Kararı

Run aşağıdaki koşulların tamamını geçerse stateful accepted observation olur:

1. Check lifecycle LIVE.
2. Job/attempt kimliği geçerli ve daha önce uygulanmamış.
3. Run `STATEFUL` modunda.
4. Probe generation mevcut check ile aynı.
5. Schedule generation geçerli.
6. Fencing token current-state üzerinde kabul edilen son token'dan büyük.
7. Run terminal sınıflandırması hedefe ait PASS veya FAIL.

Reddedilme nedenleri kararlı enum'dur:

- `DUPLICATE_RUN`
- `ATTEMPT_NOT_CURRENT`
- `CHECK_DELETED`
- `DIAGNOSTIC_RUN`
- `CHECK_PAUSED`
- `PROBE_GENERATION_MISMATCH`
- `SCHEDULE_GENERATION_MISMATCH`
- `STALE_FENCING_TOKEN`

Reddedilmiş run immutable geçmişte bulunabilir ancak health, incident, availability veya normal notification üzerinde etkili değildir.
Engine/programming hatası target observation değildir; `check_runs` içinde sahte FAIL üretmek yerine job/attempt altyapı hata politikasına gider.

## 6. Freshness State Machine

```text
STALE ──accepted observation──> FRESH
FRESH ──fresh_until elapsed───> STALE
FRESH ──pause/config reset────> STALE
```

| Mevcut | Tetikleyici | Yeni | Domain etkisi |
| --- | --- | --- | --- |
| STALE | Accepted PASS/FAIL | FRESH | Yeni `fresh_until` hesaplanır. |
| FRESH | Accepted PASS/FAIL | FRESH | `fresh_until` ileri taşınır. |
| FRESH | Clock > fresh_until | STALE | Candidate temizlenir, açık observed incident segment'i fresh_until'da kapanır, timeline UNKNOWN olur. |
| Herhangi | Pause | STALE | State gözlemsiz hale gelir. |
| Herhangi | Probe config changed | STALE | Eski observation anlamı geçersizleşir. |
| FRESH | Interval changed | FRESH veya STALE | `fresh_until` son accepted run ve yeni interval ile yeniden hesaplanır. |

`last_observed_health` korunur. Kullanıcıya sunulan:

```text
effective_health = freshness == STALE ? UNKNOWN : last_observed_health
```

## 7. Health State Machine

Yalnızca accepted stateful observation bu tabloyu çalıştırır.

| Last observed health | Sonuç | Yeni health | Candidate | Incident etkisi |
| --- | --- | --- | --- | --- |
| UNKNOWN | PASS | UP | Yok | Yok |
| UNKNOWN | FAIL | SUSPECT | Başlat | Yok |
| UP | PASS | UP | Yok | Yok |
| UP | FAIL | SUSPECT | Başlat | Yok |
| SUSPECT | PASS | UP | Temizle | Provisional dönem UP olarak finalize edilir. |
| SUSPECT | FAIL | DOWN | Doğrula | Incident açılır; ilk FAIL zamanı başlangıçtır. |
| DOWN | FAIL | DOWN | Yok | Açık incident/segment devam eder. |
| DOWN | PASS | UP | Yok | Aktif segment ve incident RECOVERED ile kapanır. |

Açık incident `UNOBSERVED` iken effective health UNKNOWN olabilir:

| Açık incident | Yeni accepted sonuç | Davranış |
| --- | --- | --- |
| UNOBSERVED | FAIL | Health DOWN olur, mevcut incident için yeni observed segment başlar; yeni incident/e-posta oluşmaz. |
| UNOBSERVED | PASS | Health UP olur, incident RECOVERED ile kapanır. |

### Provisional SUSPECT zaman çizelgesi

- İlk FAIL anından sonraki aralık `PROVISIONAL` tutulur.
- Sonraki FAIL gelirse bu aralık ilk FAIL anından itibaren DOWN olarak finalize edilir.
- Sonraki PASS gelirse doğrulanmış düşüş olmadığı için UP olarak finalize edilir.
- Pause, stale, config change veya delete candidate'ı temizler; henüz finalize edilmemiş süre UNKNOWN olur.
- İlk başarısız CheckRun geçmişten silinmez.

## 8. Incident State Machine

Incident'ın persistence status'u OPEN/CLOSED, gözlem modu OBSERVED/UNOBSERVED'dır.

```text
NONE
  └─threshold reached──> OPEN + OBSERVED
                            │
                            ├─freshness gap/pause──> OPEN + UNOBSERVED
                            │                           │
                            │                           ├─FAIL──> OPEN + OBSERVED
                            │                           └─PASS──> CLOSED/RECOVERED
                            │
                            ├─PASS───────────────> CLOSED/RECOVERED
                            ├─probe changed──────> CLOSED/CONFIG_CHANGED
                            └─check deleted──────> CLOSED/CHECK_DELETED
```

| Mevcut | Olay | Yeni | Segment davranışı | Notification-domain olayı |
| --- | --- | --- | --- | --- |
| Yok | İkinci ardışık FAIL | OPEN/OBSERVED | İlk FAIL zamanında ilk segment açılır. | `incident.opened` |
| OPEN/OBSERVED | FAIL | Aynı | Segment devam eder. | Yok |
| OPEN/OBSERVED | PASS | CLOSED/RECOVERED | PASS zamanında kapanır. | `incident.closed:RECOVERED` |
| OPEN/OBSERVED | Freshness stale | OPEN/UNOBSERVED | `fresh_until` zamanında kapanır. | `incident.observation_suspended` |
| OPEN/OBSERVED | Pause | OPEN/UNOBSERVED | Pause anında kapanır. | `incident.observation_suspended` |
| OPEN/UNOBSERVED | FAIL | OPEN/OBSERVED | FAIL zamanında yeni segment açılır. | `incident.observation_resumed` |
| OPEN/UNOBSERVED | PASS | CLOSED/RECOVERED | Yeni segment açılmaz. | `incident.closed:RECOVERED` |
| OPEN | Probe config changed | CLOSED/CONFIG_CHANGED | Açık segment değişiklik anında kapanır. | `incident.closed:CONFIG_CHANGED` |
| OPEN | Check deleted | CLOSED/CHECK_DELETED | Açık segment silme anında kapanır. | `incident.closed:CHECK_DELETED` |

Incident'ın `observed_duration` değeri kapalı segmentler ve varsa aktif segmentin şu ana kadarki süresinin toplamıdır. UNOBSERVED sürede sayaç artmaz.

## 9. Availability Timeline State Machine

Timeline sınıfları:

- `UP`
- `DOWN`
- `UNKNOWN`
- `PROVISIONAL`

Geçişler:

| Olay | Timeline etkisi |
| --- | --- |
| İlk accepted PASS | O andan itibaren UP |
| İlk accepted FAIL | O andan itibaren PROVISIONAL |
| İkinci FAIL | Candidate başlangıcından itibaren PROVISIONAL → DOWN |
| SUSPECT sonrası PASS | Candidate başlangıcından itibaren PROVISIONAL → UP |
| DOWN sonrası PASS | PASS anında DOWN sona erer, UP başlar |
| `fresh_until` aşımı | O anda mevcut bilinen dönem sona erer, UNKNOWN başlar |
| Pause | Pause anında UNKNOWN başlar |
| Resume | Accepted sonuç gelene kadar UNKNOWN |
| Probe config değişimi | Değişiklik anında UNKNOWN |
| Delete | Silme sonrasında kullanıcı timeline sorgusu sona erer; retention politikası geçmişi yönetir. |

Availability yalnızca finalize edilmiş UP ve DOWN sürelerinden hesaplanır. Açık PROVISIONAL süre response'ta “pending classification” olarak belirtilebilir ve finalized availability paydasına geçici olarak alınmaz.

## 10. Maintenance State

Maintenance'in kullanıcı tarafından saklanan lifecycle'ı:

```text
SCHEDULED ──cancel──> CANCELLED
```

Zamanla türetilen effective state:

| Koşul | Effective state |
| --- | --- |
| Cancelled | CANCELLED |
| now < starts_at | UPCOMING |
| starts_at <= now < ends_at | ACTIVE |
| now >= ends_at | ENDED |

Bir check için etkin bakım:

```text
direct active maintenance OR current group's active maintenance
```

Birden çok pencere örtüşürse notification suppression, son aktif pencere bitene kadar devam eder.

Maintenance oluşturma/değiştirme/iptal işlemi health veya incident state'ini değiştirmez; notification reconciliation tetikler.

## 11. Notification Intent State Machine

```text
PENDING_EVALUATION
   ├─incident no longer eligible────────────> CANCELLED
   ├─maintenance active─────────────────────> DEFERRED_MAINTENANCE
   └─eligible recipients found──────────────> MATERIALIZED

DEFERRED_MAINTENANCE
   ├─still maintained───────────────────────> DEFERRED_MAINTENANCE
   ├─incident recovered without sent DOWN──> CANCELLED
   └─maintenance ended + still eligible────> MATERIALIZED
```

`MATERIALIZED`, recipient başına delivery kayıtlarının idempotent oluşturulduğu terminal intent durumudur. Recipient bulunmaması `NO_RECIPIENTS` terminal sonucu olarak kaydedilir ve gözlemlenebilir olmalıdır.

## 12. Notification Delivery State Machine

```text
PENDING ──claim──> PROCESSING ──provider success──> SENT
                       │
                       ├─known failure, retryable──> RETRY_WAIT ──due──> PENDING
                       ├─permanent failure─────────> FAILED
                       ├─outcome unknowable────────> DELIVERY_UNKNOWN
                       └─no longer eligible────────> CANCELLED
```

| State | Açıklama |
| --- | --- |
| PENDING | Gönderilmeye hazır. |
| PROCESSING | Tek worker tarafından lease edilmiş. |
| RETRY_WAIT | Backoff sonuna kadar bekliyor. |
| SENT | Provider başarı cevabı ve gönderim zamanı kaydedildi. |
| FAILED | Kalıcı hata veya retry bütçesi tükendi. |
| DELIVERY_UNKNOWN | SMTP sonucu belirsiz; otomatik retry duplicate riski yaratacağı için operatör politikası gerekir. |
| CANCELLED | Gönderimden önce incident/policy nedeniyle gereksiz hale geldi. |

DOWN başarıyla SENT olmadan RECOVERY delivery oluşturulmaz. `DELIVERY_UNKNOWN` DOWN için otomatik RECOVERY kararı verilmez; reconciliation/audit görünürlük sağlar.

## 13. Recipient State Machine

```text
PENDING_VERIFICATION ──valid token──> VERIFIED ──disable──> DISABLED
          │                               │
          └─expire/resend──> PENDING      └─reverify new address──> PENDING
```

E-posta adresi değişikliği yeni recipient kimliği veya yeniden doğrulama gerektirir. VERIFIED olmayan adres operasyonel delivery materialization'a girmez.

## 14. Public Page State Machine

```text
DRAFT ──publish──> PUBLISHED ──disable──> DISABLED
  ▲                    │                     │
  └────unpublish───────┘                     └─republish/new slug──> PUBLISHED
```

- Publish için en az bir görünür component gerekir.
- Her publish/visibility/slug değişimi page revision artırır.
- Disable veya slug rotation eski public erişimi hemen geçersiz kılar.
- Republish varsayılan olarak yeni yüksek entropili slug üretir.

## 15. Prediction Etkinliği

Prediction health state değildir. Etkili görünüm türetilir:

| Koşul | Görünüm |
| --- | --- |
| Predictor disabled | DISABLED |
| Hiç score yok | UNAVAILABLE |
| `now < valid_until` | CURRENT |
| `now >= valid_until` | STALE |
| Son analysis error | UNAVAILABLE veya son score STALE olarak gösterilir |

Prediction hiçbir geçişte Check health veya Incident state machine'e event gönderemez. Yalnızca açıkça etkinleştirilmiş predictive-warning policy'si notification intent oluşturabilir.

## 16. Group Projection State Machine

Group health ayrı mutable aggregate değil, child check snapshot'larından türetilir.

```text
DOWN > SUSPECT > UNKNOWN > UP
```

| Child set | Group sonucu |
| --- | --- |
| En az bir fresh DOWN | DOWN |
| DOWN yok, en az bir fresh SUSPECT | SUSPECT |
| DOWN/SUSPECT yok, en az bir stale/UNKNOWN | UNKNOWN |
| Bütün dahil edilen check'ler fresh UP | UP |
| Aktif check yok, paused check var | health UNKNOWN, execution PAUSED |
| Hiç check yok | health UNKNOWN, empty true |

Paused ve deleted check health öncelik hesabına girmez. Maintenance özeti health'ten ayrı `NONE/PARTIAL/FULL` projection'ıdır.

## 17. Örnek Uçtan Uca Diziler

### 17.1 Tek ölçümlük geçici hata

```text
UP
→ FAIL: SUSPECT, candidate açılır, e-posta yok
→ PASS: UP, candidate kapanır, incident yok
→ provisional dönem UP olarak finalize edilir
```

### 17.2 Doğrulanmış kesinti

```text
UP
→ FAIL #1: SUSPECT
→ FAIL #2: DOWN, incident started_at=FAIL #1, confirmed_at=FAIL #2
→ DOWN delivery
→ FAIL #3..N: aynı incident, yeni e-posta yok
→ PASS: incident RECOVERED, observed duration hesaplanır
→ önceki DOWN recipient'larına RECOVERY
```

### 17.3 Bakım içinde kesinti

```text
Maintenance ACTIVE
→ FAIL #1
→ FAIL #2: incident açılır, DOWN intent deferred
→ maintenance biter
→ incident hâlâ açıksa DOWN materialize edilir
→ PASS: RECOVERY gönderilir
```

Incident bakım bitmeden PASS olursa DOWN ve RECOVERY iptal edilir.

### 17.4 Açık incident sırasında monitoring boşluğu

```text
DOWN + OPEN/OBSERVED
→ fresh_until geçer: effective UNKNOWN, segment kapanır, incident OPEN/UNOBSERVED
→ veri boşluğu availability dışında kalır
→ yeni FAIL: aynı incident için yeni segment, tekrar DOWN e-postası yok
→ PASS: incident RECOVERED, duration yalnızca iki DOWN segmentinin toplamı
```

### 17.5 DOWN sırasında probe config değişimi

```text
DOWN + açık incident
→ URL/expected status/timeout değişir
→ probe generation artar
→ eski işler state için geçersizleşir
→ incident CONFIG_CHANGED ile kapanır
→ effective health UNKNOWN
→ yeni config hemen kontrol edilir
```

Daha önce DOWN gönderilmiş recipient'lar için kapanış mesajı recovery iddiasında bulunmadan yapılandırma değişikliğini açıklar.

### 17.6 Pause ve diagnostic manual run

```text
ACTIVE/DOWN
→ Pause: PAUSED, segment kapanır, incident OPEN/UNOBSERVED
→ Manual run FAIL: diagnostic geçmişe yazılır, incident değişmez
→ Resume: ACTIVE, effective health UNKNOWN
→ İlk scheduled PASS: incident RECOVERED
```

## 18. Test Edilmesi Zorunlu Değişmezler

- Check başına en fazla bir açık incident.
- Check başına en fazla bir state'e kabul edilen fencing sırası.
- Stale generation/token current state'i değiştiremez.
- Diagnostic run state veya availability değiştiremez.
- Tek FAIL incident açamaz.
- Data gap observed downtime'a eklenemez.
- Closed incident tekrar açılamaz.
- Maintenance health'i değiştiremez.
- DOWN gönderilmemiş recipient'a RECOVERY gönderilemez.
- Public projection allowlist dışında alan taşıyamaz.
- Prediction ana health veya incident transition'ı üretemez.
