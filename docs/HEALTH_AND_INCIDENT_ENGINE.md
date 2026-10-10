# Sağlık, Incident ve Grup Durumu Motoru

**Durum:** Aşama 8 uygulandı ve yerelde doğrulandı — 2026-10-10 11:53 +06:00
**Tarih:** 2026-10-10 11:02 +06:00
**Dayanak:** `REQUIREMENTS.md`, `ACCEPTANCE_CRITERIA.md`, `DOMAIN_MODEL.md`, `STATE_MACHINES.md`, `DATABASE_SCHEMA.md`, `EVENT_CATALOG.md`, `CHECKS_AND_GROUPS.md`, `CHECK_ENGINE.md`
**Saf domain paketi:** `packages/domain`
**Kalıcı uygulayıcı:** `apps/monitor-worker` — Aşama 9 atomik observation transaction'ına bağlandı ve gerçek PostgreSQL üzerinde doğrulandı

## 1. Amaç

Bu belge, kabul edilmiş bir probe gözlemini deterministik sağlık, freshness, availability timeline, incident ve grup durumu sonuçlarına çeviren Aşama 8 motorunu kesinleştirir. Motor:

- scheduler, HTTP, PostgreSQL ve wall-clock erişiminden bağımsız saf domain mantığıdır;
- `UNKNOWN`, `UP`, `SUSPECT` ve `DOWN` geçişlerini tek bir yerde tanımlar;
- tek ölçümlük geçici hatayı doğrulanmış kesintiden ayırır;
- monitoring boşluğunu hedef kesintisi saymaz;
- incident'ın wall-clock süresiyle gerçekten gözlemlenmiş DOWN süresini ayırır;
- duplicate, diagnostic, generation veya fencing açısından eski gözlemi state dışı bırakır;
- availability interval değişikliklerini kayıpsız bir transaction planı olarak üretir;
- grup durumunu child check snapshot'larından bounded biçimde türetir.

Bu aşama probe çalıştırmaz, job claim etmez, SQL transaction'ı açmaz, e-posta göndermez ve SSE bağlantısına yazmaz.

## 2. Kapsam ve Aşama Sınırları

### 2.1 Aşama 8 içinde

- Saf observation acceptance kararı
- Sağlık/freshness reducer'ı
- İki ardışık FAIL eşiği ve failure candidate
- Incident açma, sürdürme, askıya alma, devam ettirme ve recovery planı
- Provisional/UP/DOWN/UNKNOWN interval dönüşüm planı
- Freshness deadline reconciliation kararı
- Effective check health/freshness okuma kuralları
- Grup sağlık ve sayaç türetimi
- Typed transition effect ve domain event fact'leri
- Table-driven, sequence, property/invariant ve idempotency testleri

### 2.2 Aşama 9 sorumlulukları

- Job/attempt claim, lease, heartbeat ve retry
- Gerçek `check_runs` insert'i ve attempt idempotency guard'ı — uygulandı
- Satır kilitleri, SQL effect uygulama ve transaction commit'i — uygulandı
- Freshness reconciliation işlerinin bounded, owner-fair seçimi ve kalıcı uygulanması — uygulandı
- Motoru gerçek probe sonuç akışına bağlama — persistence sink uygulandı; production loop aktivasyonu açık
- Worker concurrency, fairness, overlap engeli ve restart recovery

### 2.3 Sonraki aşamalara bırakılanlar

- Maintenance CRUD ve notification reconciliation: Aşama 10
- Incident e-posta materialization/delivery: Aşama 11
- History rollup ve retention: Aşama 12
- Dashboard/SSE/public projection: Aşama 13–15
- Predictor: Aşama 16

Maintenance state'i health'i değiştirmez. Aşama 8 incident event fact'i üretebilir; bakım ve recipient policy'sinin gönderim anında tekrar değerlendirilmesi sonraki aşamanın sorumluluğudur.

## 3. Mevcut Temel ve Kapatılacak Boşluklar

Şema gerekli source-of-truth tablolarını zaten içerir:

- `monitoring.check_current_states`
- `monitoring.open_health_intervals`
- `monitoring.health_intervals`
- `monitoring.incidents`
- `monitoring.incident_segments`
- partition'lı `monitoring.check_runs`

Aşama 6 pause/resume/probe-change/delete komutlarının incident ve timeline yan etkilerini uygulamıştır. Aşama 8 bu semantiği değiştirmez; observation ve clock geçişleri için aynı invariant'ları kullanan canonical domain reducer'ını ekler.

Uygulamada kapatılması gereken iki okuma yarışı vardır:

1. Kalıcı `freshness_state=FRESH` iken `fresh_until` geçmiş olabilir. Reconciler gecikse bile API effective state'i anında `STALE/UNKNOWN` göstermelidir.
2. Açık observed incident segment'i reconciler gecikmesi boyunca `now - started_at` ile büyütülmemelidir. Query-time süre en fazla `fresh_until` noktasına kadar sayılmalı ve effective observation mode `UNOBSERVED` gösterilmelidir.

Bu kurallar source of truth'u değiştirmez; geciken projection yazımı tamamlandığında aynı sonucu kalıcı hale getirir.

## 4. Mimari Sınırlar

```text
ProbeResultV1 (Aşama 7)
        |
        v
Aşama 9 acceptance/persistence adapter
        |
        |  immutable snapshot + canonical DB time
        v
@site-monitor/domain state engine (Aşama 8)
        |
        +--> acceptance decision
        +--> current-state patch
        +--> interval rotation effects
        +--> incident/segment effects
        +--> redacted event facts
        +--> affected group invalidation
        |
        v
Aşama 9 tek PostgreSQL transaction uygulayıcısı
```

Saf motor:

- DB sorgusu, `Date.now()`, UUID üretimi veya log yazımı yapmaz;
- input snapshot'ını mutasyona uğratmaz;
- aynı input için byte-level eşdeğer semantic output üretir;
- ham URL, query, expected body veya response body kabul etmez;
- persistence ayrıntısı yerine typed effect listesi döndürür.

Kimlik gereken yeni incident/segment/interval satırlarını transaction uygulayıcısı üretir. Domain effect'i bütün lineage alanlarını taşır; uygulayıcı oluşan ID'leri aynı transaction içindeki current-state ve event satırlarına bağlar.

## 5. Canonical Tipler

```ts
type HealthState = 'UNKNOWN' | 'UP' | 'SUSPECT' | 'DOWN';
type FreshnessState = 'FRESH' | 'STALE';
type ObservationOutcome = 'PASS' | 'FAIL';
type ObservationMode = 'OBSERVED' | 'UNOBSERVED';
type TimelineClass = 'UNKNOWN' | 'UP' | 'PROVISIONAL' | 'DOWN';

interface HealthPolicyV1 {
  failureThreshold: 2;
  schedulerGraceMs: number;
}
```

V1 failure threshold deployment veya kullanıcı bazında değişken değildir: **tam olarak 2**. Sayaç `2` değerinde saturate edilir; uzun kesintide sınırsız büyümez. Gelecekte per-check threshold eklenirse probe semantiğinin parçası olur, config snapshot'ta version'lanır ve probe generation artırır.

`schedulerGraceMs` gözlem snapshot'ına değil deployment policy'sine aittir. Başlangıç değeri mevcut davranışla uyumlu olarak 5 saniyedir ve bounded config olarak Aşama 9'da tek kaynaktan verilir.

### 5.1 Observation girdisi

State motoru yalnız sanitize edilmiş alanları alır:

- owner/check/run/job/attempt referansları
- trigger ve manual mode
- resource/probe/schedule generation
- fencing token
- DB tarafından atanmış canonical `finishedAt`
- PASS/FAIL
- total duration, status code, body-match ve allowlist failure category
- check lifecycle/execution ve interval/timeout snapshot'ı
- current state, açık interval ve varsa açık incident/segment snapshot'ı
- duplicate/attempt-current gibi transaction adapter tarafından kanıtlanan acceptance girdileri

`finishedAt` worker host saatinden güvenilir kabul edilmez. Aşama 9 kalıcı sonucu alırken canonical transition zamanını PostgreSQL zamanından üretir; probe faz süreleri monotonic ölçümdür.

### 5.2 Transition planı

```ts
interface StateTransitionPlan {
  acceptance: AcceptanceDecision;
  currentState?: CurrentStateMutation;
  intervalEffects: IntervalEffect[];
  incidentEffects: IncidentEffect[];
  eventFacts: DomainEventFact[];
  affectedGroupId?: string;
}
```

Reddedilmiş observation için acceptance kararı ve redacted `check.observation_rejected` fact'i dönebilir; health, incident, interval ve normal notification fact'i oluşmaz. Duplicate replay mevcut kalıcı kararı döndürür ve ikinci event yazmaz. `check.run_recorded` ve job terminal işlemi Aşama 9 adapter'ının sorumluluğudur.

## 6. Observation Acceptance

### 6.1 Karar sırası

Precedence sabittir; aynı bozuk input her çalışmada aynı reason code'u üretir:

1. Aynı run/attempt sonucu daha önce kaydedilmişse `DUPLICATE_RUN` ve mevcut sonuç idempotent döndürülür.
2. Attempt artık current claim değilse `ATTEMPT_NOT_CURRENT`.
3. Check `DELETED` ise `CHECK_DELETED`.
4. Run `DIAGNOSTIC` ise `DIAGNOSTIC_RUN`.
5. Check `PAUSED` ise `CHECK_PAUSED`.
6. Probe generation farklıysa `PROBE_GENERATION_MISMATCH`.
7. Schedule generation farklıysa `SCHEDULE_GENERATION_MISMATCH`.
8. Fencing token son kabul edilen token'dan büyük değilse `STALE_FENCING_TOKEN`.
9. Kalan PASS/FAIL sonucu accepted stateful observation'dır.

Canonical rejection allowlist'i:

```text
DUPLICATE_RUN
ATTEMPT_NOT_CURRENT
CHECK_DELETED
DIAGNOSTIC_RUN
CHECK_PAUSED
PROBE_GENERATION_MISMATCH
SCHEDULE_GENERATION_MISMATCH
STALE_FENCING_TOKEN
```

Engine/programming exception'ı observation değildir ve `check_runs.outcome=FAIL` olarak uydurulmaz. Aşama 7 infrastructure fault'u job/attempt retry veya DEAD politikasına gider.

### 6.2 Accepted observation ortak güncellemeleri

Her accepted observation:

- `freshness_state=FRESH` yapar;
- `fresh_until = finishedAt + interval + timeout + schedulerGrace` hesaplar;
- last accepted run ve fencing token'ı günceller;
- last response/status alanlarını sonuçtan günceller;
- PASS için `last_success_at`, FAIL için `last_failure_at` günceller;
- current state `state_version` değerini **tam bir kez** artırır;
- `stale_reconciled_at` değerini temizler;
- redacted `check.observation_accepted` fact'i üretir.

Health aynı kalsa bile last-check/latency/freshness deadline görünür projection'ı değiştiği için accepted observation state version'ı artırır.

## 7. Sağlık Geçiş Matrisi

| Başlangıç               | Observation | Sonuç   | Candidate      | Incident                              | Timeline                                                   |
| ----------------------- | ----------- | ------- | -------------- | ------------------------------------- | ---------------------------------------------------------- |
| UNKNOWN                 | PASS        | UP      | Temiz          | Yok                                   | UNKNOWN kapanır, UP açılır                                 |
| UNKNOWN                 | FAIL        | SUSPECT | İlk FAIL       | Yok                                   | UNKNOWN kapanır, PROVISIONAL açılır                        |
| UP                      | PASS        | UP      | Temiz          | Yok                                   | UP interval devam eder                                     |
| UP                      | FAIL        | SUSPECT | İlk FAIL       | Yok                                   | UP kapanır, PROVISIONAL açılır                             |
| SUSPECT                 | PASS        | UP      | Temizlenir     | Yok                                   | PROVISIONAL geçmişi UP finalize edilir, yeni UP açılır     |
| SUSPECT                 | FAIL        | DOWN    | Doğrulanır     | İlk FAIL zamanında açılır             | PROVISIONAL geçmişi DOWN finalize edilir, yeni DOWN açılır |
| DOWN + OPEN/OBSERVED    | FAIL        | DOWN    | Yok            | Aynı incident/segment                 | DOWN interval devam eder                                   |
| DOWN + OPEN/OBSERVED    | PASS        | UP      | Yok            | RECOVERED kapanır                     | DOWN kapanır, UP açılır                                    |
| STALE + OPEN/UNOBSERVED | FAIL        | DOWN    | Yok            | Aynı incident için segment devam eder | UNKNOWN kapanır, DOWN açılır                               |
| STALE + OPEN/UNOBSERVED | PASS        | UP      | Yok            | RECOVERED kapanır                     | UNKNOWN kapanır, UP açılır                                 |
| STALE, incident yok     | FAIL        | SUSPECT | Yeni candidate | Yok                                   | UNKNOWN kapanır, PROVISIONAL açılır                        |
| STALE, incident yok     | PASS        | UP      | Temiz          | Yok                                   | UNKNOWN kapanır, UP açılır                                 |

Impossible snapshot örnekleri (`DOWN` fakat açık incident yok, açık incident `OBSERVED` fakat açık segment yok, candidate varken health `SUSPECT` değil) fail-open biçimde onarılmaz. Motor typed `DOMAIN_INVARIANT_VIOLATION` üretir; transaction rollback olur, hedefe FAIL yazılmaz ve operatör alarmı oluşur.

## 8. Failure Candidate ve Eşik

İlk accepted FAIL:

- `health_state=SUSPECT`
- `consecutive_failure_count=1`
- `candidate_started_at=finishedAt`
- candidate run lineage'i ilk FAIL'e bağlanır
- incident ve DOWN notification fact'i oluşmaz
- timeline `PROVISIONAL` olur

İkinci ardışık accepted FAIL:

- count `2` değerinde saturate edilir
- health `DOWN` olur
- incident `started_at` ilk FAIL, `confirmed_at` ikinci FAIL zamanıdır
- incident'ın ilk observed segment'i ilk FAIL zamanında başlar
- provisional interval ilk FAIL'den confirmation'a kadar DOWN finalize edilir
- confirmation anında açık DOWN interval başlar

SUSPECT sonrası PASS candidate'ı temizler. Provisional interval ilk FAIL'den PASS'e kadar UP finalize edilir; başarısız run immutable geçmişte kalır ancak availability downtime sayılmaz.

Pause, probe reset, delete veya freshness expiry candidate'ı temizler. Provisional süre bu durumlarda `UNKNOWN` finalize edilir.

## 9. Incident ve Segment Semantiği

Incident yalnız threshold geçilince oluşturulur. Check başına tek açık incident ve incident başına tek açık segment invariant'ları hem reducer hem partial unique index ile korunur.

### 9.1 Açılış

- `started_at`: candidate ilk FAIL zamanı
- `confirmed_at`: threshold'u geçen FAIL zamanı
- `status=OPEN`
- `observation_mode=OBSERVED`
- `observed_duration_ms=0`
- ilk segment `[firstFailureAt, open)`
- first/confirmation run lineage'i zorunlu

### 9.2 Tekrarlanan FAIL

Açık observed incident sırasında FAIL yeni incident, segment veya DOWN event'i üretmez. Son failure category ve incident resource version gerektiğinde güncellenir; active segment devam eder.

### 9.3 Recovery

Accepted PASS:

- aktif segment varsa PASS zamanında `RECOVERED` ile kapatır;
- segment süresini `observed_duration_ms` toplamına tam bir kez ekler;
- incident'ı `CLOSED/RECOVERED` yapar;
- current state's `open_incident_id` alanını temizler;
- health'i UP yapar ve timeline'ı döndürür;
- tek `incident.closed` fact'i üretir.

Açık incident zaten UNOBSERVED ise PASS yeni sıfır uzunluklu segment açmadan kapatır. Gap observed duration'a girmez.

### 9.4 Observation suspension/resume

- Freshness expiry segment'i tam `fresh_until` anında `STALE` ile kapatır.
- Pause segment'i komutun canonical DB zamanında `PAUSED` ile kapatır.
- Incident OPEN kalır, observation mode UNOBSERVED olur.
- Sonraki accepted FAIL aynı incident için yeni segment açar ve `incident.observation_resumed` üretir.
- Yeni segment resume FAIL zamanında başlar; gap hiçbir interval veya incident DOWN süresine eklenmez.

Probe change ve delete incident'ı sırasıyla `CONFIG_CHANGED`/`CHECK_DELETED` ile terminal kapatır; bu komut davranışları Aşama 6 ile uyumludur.

### 9.5 Süreler

```text
observed_duration = kapanmış segment toplamı
                  + varsa min(now, fresh_until) - açık segment başlangıcı

wall_duration = min(now, closed_at ?? now) - started_at
```

Negatif süre clamp edilerek gizlenmez; canonical zaman sırası ihlali invariant fault'tur. API decimal millisecond değerlerini string olarak taşır.

## 10. Availability Timeline

Check başına `open_health_intervals` tablosunda tam bir açık interval vardır. Rotation yarı açık `[start,end)` aralıkları üretir.

### 10.1 Genel rotation

1. Check/current-state ve açık interval aynı kilit sırası içinde okunur.
2. `effectiveAt < open.started_at` invariant fault'tur.
3. `effectiveAt > open.started_at` ise eski interval resolved final sınıfıyla history'ye insert edilir.
4. Aynı transaction'da eski open row yeni sınıf, lineage ve başlangıçla değiştirilir.
5. `effectiveAt == open.started_at` ise sıfır uzunluklu history yazılmaz; open row in-place semantik olarak değiştirilir.

### 10.2 Provisional çözümleme

| Sonraki olay       | PROVISIONAL final sınıfı          |
| ------------------ | --------------------------------- |
| FAIL ile threshold | DOWN                              |
| PASS               | UP                                |
| Freshness expiry   | UNKNOWN                           |
| Pause              | UNKNOWN                           |
| Probe reset        | UNKNOWN                           |
| Delete             | History sonu; açık row kaldırılır |

PROVISIONAL hiçbir zaman `health_intervals` final sınıfı değildir. Bu nedenle aylık availability query'si belirsiz süreyi yanlışlıkla UP/DOWN saymaz.

### 10.3 Idempotency

Aynı run veya stale reconciliation tekrar uygulandığında ikinci interval insert'i oluşmaz. Bunu run idempotency guard'ı, current-state version/token kontrolü ve `stale_reconciled_at` deadline checkpoint'i birlikte sağlar.

## 11. Freshness ve Monitoring Gap

### 11.1 Deadline

```text
fresh_until = accepted_finished_at
            + interval_seconds
            + timeout_ms
            + scheduler_grace_ms
```

V1 varsayılan scheduler grace 5 saniyedir. Formül tek bir helper'da tutulur ve overflow/invalid input fail-fast reddedilir.

### 11.2 Read-time effective state

Reconciler gecikmesi kullanıcıya yanlış UP/DOWN gösteremez:

```text
effective_freshness =
  execution == PAUSED
  OR fresh_until IS NULL
  OR fresh_until <= query_time
    ? STALE
    : persisted_freshness

effective_health = effective_freshness == STALE
  ? UNKNOWN
  : persisted_health
```

Check list, dashboard, group aggregate, private/public snapshot ve SSE reconciliation aynı helper/SQL expression semantiğini kullanır. PostgreSQL sorgusunda tek `statement_timestamp()` alınır.

Açık incident persisted `OBSERVED` olsa bile deadline geçmişse API effective observation mode'u `UNOBSERVED` verir ve dinamik süreyi `fresh_until` noktasında keser.

### 11.3 Kalıcı reconciliation

`ReconcileFreshness(now)`:

- current state/interval/incident snapshot'ını kilitli transaction girdisi olarak alır;
- `now < fresh_until` veya aynı deadline daha önce reconcile edilmişse no-op'tur;
- transition zamanı `now` değil kesin olarak `fresh_until` olur;
- freshness STALE, candidate temiz ve effective health UNKNOWN olur;
- interval UNKNOWN'a döner;
- açık segment kapanır ve incident UNOBSERVED kalır;
- current state version ve gereken incident version bir kez artar;
- `check.freshness_changed` ve gerekirse `incident.observation_suspended` fact'leri çıkar.

Worker/server kapalıyken kaçırılan probe'lar için sentetik FAIL/run üretilmez. Boşluk UNKNOWN'dır.

## 12. Grup Durumu

Grup health ayrı mutable aggregate veya tablo değildir. Query-time bounded aggregate olarak yalnız aynı owner'a ait `LIVE` child check'lerden türetilir.

### 12.1 Dahil etme

- `ACTIVE` check'ler health önceliğine girer.
- `PAUSED` check'ler health önceliğine girmez; `paused` sayacına eklenir.
- `DELETED` check'ler tamamen dışlanır.
- Her ACTIVE child için read-time effective freshness/health kuralı uygulanır.

### 12.2 Öncelik

```text
DOWN > SUSPECT > UNKNOWN > UP
```

| Child sonucu                        | Grup health               |
| ----------------------------------- | ------------------------- |
| En az bir DOWN                      | DOWN                      |
| DOWN yok, en az bir SUSPECT         | SUSPECT                   |
| DOWN/SUSPECT yok, en az bir UNKNOWN | UNKNOWN                   |
| Bütün ACTIVE child'lar UP           | UP                        |
| ACTIVE child yok, paused var        | UNKNOWN                   |
| Hiç live child yok                  | UNKNOWN; bütün sayaçlar 0 |

`up + suspect + down + unknown` aktif check sayısına eşittir; `paused` ayrıdır. Current OpenAPI boş grubu sayaçların sıfır olmasıyla ifade eder. Ayrı `empty` alanı ancak contract sürümü bilinçli değiştirildiğinde eklenir.

Maintenance özeti health'ten ayrı kalır. Aşama 10'dan önce GroupStatus DTO'suna sahte maintenance alanı eklenmez.

### 12.3 Performans ve invalidation

- Owner başına mevcut deployment quota aggregate'i bounded tutar; 50 sabit ürün limiti değildir.
- V1 tek set-based SQL aggregate kullanır, child başına query yapmaz.
- `fresh_until` read-time override hem check hem group sorgusunda aynıdır.
- Health/freshness/check group değişimi realtime/public projector'a grup query invalidation sinyali verir; mutable group health event source of truth yapılmaz.
- 20/200/500 fixture query planı Aşama 8 uygulama kapanışında yeniden ölçülür.

## 13. Event Fact'leri

Motor durable outbox'a doğrudan yazmaz; minimal, redacted fact listesi döndürür. Aşama 9 adapter'ı ID/version'ları bağlar ve yalnız kalıcı olarak aktive edilmiş destination'lar için aynı transaction'da envelope/dispatch kayıtlarını yazar.

| Fact                             | Ne zaman                                              |
| -------------------------------- | ----------------------------------------------------- |
| `check.observation_accepted`     | Her accepted run                                      |
| `check.observation_rejected`     | Kalıcılaştırılmış fakat state dışı run                |
| `check.health_changed`           | Persisted observed health gerçekten değiştiğinde      |
| `check.freshness_changed`        | FRESH↔STALE değiştiğinde                              |
| `incident.opened`                | Threshold ilk kez geçtiğinde                          |
| `incident.observation_suspended` | Açık segment gap/pause ile kapandığında               |
| `incident.observation_resumed`   | UNOBSERVED incident FAIL ile yeniden gözlemlendiğinde |
| `incident.closed`                | Recovery/config/delete terminal kapanışında           |

Tekrarlanan DOWN FAIL yeni `incident.opened` veya DOWN notification fact'i üretmez. `maintenance_suppressed` event-time tanı alanıdır; notification kararı değildir. Adapter event yazarken bakım snapshot'ını ekleyebilir, notification worker source of truth'u yeniden değerlendirir.

Payload URL, query, IP, expected body, response body veya raw network error taşımaz. Version'lar JSON decimal string'dir.

## 14. Transaction ve Kilit Protokolü

Aşama 9 observation transaction'ı bu sırayı izler:

1. Check satırını kilitle.
2. Job ve attempt satırını kilitle; duplicate/result eligibility kontrol et.
3. Current-state satırını kilitle.
4. Açık incident ve segmenti varsa kilitle.
5. Açık health interval'i kilitle.
6. Kilitli snapshot ve candidate result ile saf transition planını hesapla.
7. Immutable run satırını acceptance kararıyla insert et.
8. Current state, interval, incident ve segment effect'lerini uygula.
9. Activation-aware event/outbox dispatch'lerini yaz.
10. Attempt/job terminal durumunu yaz ve commit et.

Canonical global sıra `check -> job -> attempt -> current state -> incident -> segment -> interval`dır. API check komutları da check→job kullandığı için worker ters sırada kilit alamaz. Birden fazla check işlenecekse UUID artan sıradır. Domain transaction içinde HTTP, SMTP, SSE veya predictor çağrısı yoktur. Ayrıntılı claim/cancellation protokolü [`SCHEDULER_AND_WORKERS.md`](./SCHEDULER_AND_WORKERS.md) içinde kesinleştirilmiştir.

Failure halinde transaction'ın hiçbiri görünür olmaz. External e-posta veya realtime teslimatı outbox sonrasıdır.

## 15. Şema ve Migration Değerlendirmesi

Revision 14, Aşama 9 entegrasyonu için attempt result pointer'ı, rejection allowlist'i ve destination activation kaydını forward-only olarak eklemiştir. Atomik observation adapter'ı bu şema üzerinde doğrulanmıştır.

Aşağıdakiler migration/test review'undan geçmiştir:

- rejection reason canonical allowlist'inin DB constraint gerektirip gerektirmediği;
- monitor rolünün gereken kolonlarda least-privilege UPDATE yetkileri;
- incident/current-state/interval snapshot'larında cross-owner FK ve RLS davranışı;
- default partition'a düşmeden ilgili ay partition'larının varlığı;
- zero-length interval üretmeyen rotation helper'ı;
- aktive destination için outbox event/dispatch'in state transaction'ıyla atomikliği ve inactive destination'da backlog oluşmaması.

Uygulanmış migration dosyaları değiştirilmez; ihtiyaç çıkarsa revision 14+ forward-only migration yazılır.

## 16. Hata Politikası ve Gözlemlenebilirlik

### 16.1 Target sonucu olmayan durumlar

- Reducer invariant violation
- DB/serialization/constraint hatası
- Engine infrastructure fault
- Lease kaybı veya cancellation

Bunlar target FAIL veya incident üretmez. Job retry/dead-letter ve operasyon alarmı yoluna gider.

### 16.2 Bounded telemetry

Metrikler:

- accepted/rejected observation sayısı ve reason code
- health/freshness transition sayısı
- incident opened/closed/suspended/resumed sayısı
- stale reconciliation lag (`processed_at - fresh_until`)
- domain invariant violation sayısı
- group aggregate query latency ve child count

Loglar owner/check/run/incident/job correlation ID'leri ve allowlist reason code taşır; URL, IP, body ve query taşımaz. Cardinality yüksek kimlikler metric label yapılmaz.

## 17. Test Mimarisi

### 17.1 Table-driven unit testler

- Tam sağlık geçiş matrisi
- Acceptance precedence ve bütün rejection reason'ları
- Fresh-until hesabı ve boundary (`now == fresh_until` STALE)
- Incident açılış/recovery/suspend/resume
- Provisional → UP/DOWN/UNKNOWN çözümleme
- Repeated FAIL'de incident/event çoğalmaması
- Effective read-time freshness ve duration cap
- Group precedence/sayaç/empty/paused davranışı

### 17.2 Sequence/property testleri

Deterministik event dizileri ve seeded generated diziler şu invariant'ları doğrular:

- check başına en fazla bir açık incident;
- incident başına en fazla bir açık segment;
- finalized interval'lar örtüşmez ve negatif/sıfır süre yazılmaz;
- candidate yalnız SUSPECT ile bulunur;
- DOWN yalnız açık incident ile bulunur;
- observed duration segment toplamına eşittir;
- duplicate event ikinci effect üretmez;
- fencing/generation geriye gidemez;
- gap hiçbir zaman DOWN süresine eklenmez;
- closed incident tekrar açılamaz.

Property framework bağımlılığı ancak mevcut Vitest table/seed yaklaşımının yetersizliği kanıtlanırsa eklenir. İlk tercih sabit seed'li küçük sequence generator'dır.

### 17.3 PostgreSQL entegrasyon testleri

Aşama 9 bağlanmadan önce saf plan test edilir; bağlandığında gerçek PostgreSQL üzerinde:

- iki concurrent result'tan yalnız biri accepted;
- stale attempt/run history'de kalır fakat state'i değiştirmez;
- incident/segment partial unique invariant'ları;
- run + state + interval + incident + aktive outbox routing atomik commit/rollback;
- RLS owner izolasyonu;
- freshness deadline ve reconciler idempotency;
- 20/200/500 group aggregate plan/latency profili

doğrulanır.

## 18. Uygulama Dilimleri

1. Canonical domain tipleri, invariant validator ve health policy
2. Acceptance decision ve precedence testleri
3. Accepted observation reducer ve transition matrix testleri
4. Failure candidate/provisional interval effect'leri
5. Incident/segment effect'leri ve sequence testleri
6. Freshness reconciliation ve read-time effective projection helper'ı
7. Group status derivation ve API SQL semantiği regresyon testleri
8. Event fact mapping ve redaction testleri
9. Bütün repository kalite kapısı, belge/durum güncellemesi

Bu sıra DB scheduler entegrasyonu yapmaz; Aşama 9'un uygulayacağı kararlı bir semantic port üretir.

## 19. Tamamlanma Kapısı

Aşama 8 ancak aşağıdakilerin tümü sağlandığında tamamlanır:

- Saf motor I/O ve global clock kullanmadan deterministik çalışır.
- AC-040–048 sağlık/incident kuralları table/sequence testleriyle kanıtlanır.
- Tek FAIL incident açmaz; ikinci ardışık FAIL ilk FAIL zamanıyla incident açar.
- PASS recovery'yi ve observed duration'ı doğru kapatır.
- Data gap effective state'i anında UNKNOWN yapar ve duration'ı deadline'da keser.
- Duplicate/stale/diagnostic observation hiçbir state effect'i üretmez.
- Provisional interval yalnız UP/DOWN/UNKNOWN olarak finalize edilir.
- Group status aynı read-time freshness kuralıyla ve set-based query semantiğiyle türetilir.
- Domain event fact'leri minimal/redacted ve idempotenttir.
- Lint, format, strict typecheck ve ilgili testler geçer.
- `PROJECT_STATUS`, `DECISIONS` ve `DEVELOPMENT_LOG` dürüstçe güncellenir.

## 20. Bilinen Tavizler

- Failure threshold v1'de sabit 2'dir; kullanıcı bazlı esneklik yerine deterministik ürün semantiği seçilmiştir.
- Group state query-time hesaplanır; yüksek ölçek ölçümü sorun gösterirse rebuild edilebilir projection ayrı kararla eklenir.
- Reconciler gecikebilir; read-time override doğruluğu korur fakat kalıcı interval/outbox birkaç saniye gecikmeli olabilir. Lag gözlemlenebilir olmalıdır.
- Aşama 8 tek başına probe sonucunu veritabanına bağlamaz. Uçtan uca incident üretimi Aşama 9 observation transaction'ı tamamlanınca çalışır.
- Maintenance, notification ve realtime tüketicileri bu aşamada tamamlanmaz; yalnız onların kullanacağı doğru domain fact'leri tanımlanır.
