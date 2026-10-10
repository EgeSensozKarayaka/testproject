# Kalıcı Scheduler ve Monitor Worker Mimarisi

**Aşama:** 9 — Kalıcı Scheduler ve Monitor Worker

**Durum:** Uygulama devam ediyor — ilk dokuz dilim doğrulandı; production loop, storage preflight, loop-aware readiness ve bounded graceful drain aktif

**Tarih:** 2026-10-10 15:00 +06:00

**Bağlı belgeler:** [`REQUIREMENTS.md`](./REQUIREMENTS.md), [`ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`STATE_MACHINES.md`](./STATE_MACHINES.md), [`DATABASE.md`](./DATABASE.md), [`DATABASE_OPERATIONS.md`](./DATABASE_OPERATIONS.md), [`CHECKS_AND_GROUPS.md`](./CHECKS_AND_GROUPS.md), [`CHECK_ENGINE.md`](./CHECK_ENGINE.md), [`HEALTH_AND_INCIDENT_ENGINE.md`](./HEALTH_AND_INCIDENT_ENGINE.md), [`EVENT_CATALOG.md`](./EVENT_CATALOG.md)

## 1. Amaç

Bu aşama, Aşama 7'deki güvenli probe motoru ile Aşama 8'deki saf sağlık/incident reducer'ını kalıcı PostgreSQL kuyruğu üzerinden gerçek monitor worker akışına bağlar.

Aşama tamamlandığında sistem:

- aktif check'leri sabit cadence ile planlar;
- manuel işleri kalıcı ve coalesced biçimde çalıştırır;
- aynı check'in normal koşullarda kendisiyle paralel çalışmasını engeller;
- birden fazla worker replica'sında güvenli claim, lease, heartbeat ve fencing uygular;
- probe sırasında hiçbir veritabanı transaction'ı veya satır kilidi açık tutmaz;
- sonucu run, current state, interval, incident, segment ve outbox ile atomik kalıcılaştırır;
- worker/server kesintisinde kaçırılmış tick'leri backfill etmeden güncel zamandan devam eder;
- monitoring boşluğunu hedef düşüşü değil `UNKNOWN/no-data` olarak korur.

Bu aşama ana monitoring yoludur. Scheduler veya persistence adapter arızası target `FAIL` olarak uydurulmaz ve sahte incident üretmez.

## 2. Kapsam ve kapsam dışı

### 2.1 Aşama 9 kapsamı

- Periyodik due-check materialization
- Manual intent materialization ve coalescing tüketimi
- Cadence, catch-up ve no-backfill hesabı
- PostgreSQL job claim ve çoklu worker koordinasyonu
- Lease, heartbeat, fencing token ve stale attempt davranışı
- Job cancellation request ve worker acknowledgement protokolü
- Global, owner ve hostname bounded concurrency
- Owner-fair candidate seçimi
- Probe engine orchestration ve cancellation
- Target sonucu ile infrastructure fault ayrımı
- Run/observation transaction'ı ve Aşama 8 effect uygulayıcısı
- Freshness deadline reconciler
- Lease recovery, retry/backoff, DEAD ve restart davranışı
- Graceful shutdown/drain
- Redacted log, queue-lag ve worker yaşam döngüsü sinyalleri
- Concurrent worker, kill/recovery ve 20/200/500 kapasite kanıtları

### 2.2 Sonraki aşamalara bırakılanlar

- Maintenance CRUD ve bakım sonu reconciliation: Aşama 10
- Notification intent/delivery ve SMTP: Aşama 11
- History API, rollup ve retention: Aşama 12
- SSE/outbox consumer ve canlı dashboard: Aşama 13–14
- Public projection: Aşama 15
- Prediction consumer: Aşama 16
- Production metric exporter, alarm ve runbook'ların sistem-geneli kapanışı: Aşama 17

Aşama 9 event fact'lerini katalogdaki routing politikasıyla değerlendirir. Yalnız kalıcı olarak aktive edilmiş destination için transactional outbox event/dispatch yazar. Sonraki consumer henüz uygulanmadıysa sınırsız `PENDING` backlog üretilmez ve monitoring transaction'ı yine tamamlanır; SMTP, SSE veya predictor çağrısı yapılmaz.

## 3. Gereksinim izlenebilirliği

| Gereksinim      | Aşama 9 karşılığı                                                                 |
| --------------- | --------------------------------------------------------------------------------- |
| AC-023–028      | Pause/resume, manual stateful/diagnostic, generation ve coalescing kuralları      |
| AC-030/031      | Tek aktif job invariant'ı, cancellation acknowledgement ve concurrency testi      |
| AC-032/033      | PostgreSQL claim, attempt guard, lease ve monoton fencing token                   |
| AC-034          | Process kill, lease expiry ve retry/reclaim                                       |
| AC-035/036      | Sabit cadence, tek catch-up işi, backfill yok; manual cadence'i değiştirmez       |
| AC-037          | Probe transaction dışında; global/owner/host concurrency ve bağımsız cancellation |
| AC-040–048      | Aşama 8 reducer'ının gerçek PostgreSQL observation transaction'ına bağlanması     |
| AC-062          | Deadline reconciler ve read-time freshness ile gap'in DOWN sayılmaması            |
| AC-080/081      | Aynı algoritmayla 20/200/500 check profili ve ölçümlü queue lag                   |
| AC-082/083      | Bounded concurrency ve owner-fair candidate sırası                                |
| AC-084          | Bütün schedule/job/state gerçeğinin PostgreSQL'de kalıcı olması                   |
| AC-100–102      | Aşama 7 güvenli probe motoru ve redacted worker sınırı                            |
| NFR-REL-001–004 | Crash recovery, idempotent result, atomik state ve dış servis izolasyonu          |
| NFR-OPS-001/002 | Worker kimliği, health, structured log ve queue/freshness ölçüleri                |

## 4. Mevcut temel ve kapatılacak boşluklar

Mevcut sistem aşağıdaki temeli sağlamaktadır:

- `app.checks`: cadence, `next_run_at`, manual intent ve check-scope fencing counter
- `monitoring.check_jobs`: kalıcı queue ve check başına partial unique aktif-job invariant'ı
- `monitoring.check_job_attempts`: attempt/fencing lineage ve result guard
- partition'lı `monitoring.check_runs`
- current-state, health interval, incident ve segment tabloları
- transactional outbox ve destination dispatch tabloları
- Aşama 7 immutable snapshot decoder ve probe engine
- Aşama 8 saf observation/freshness reducer'ı
- `site_monitor_monitor` için ayrı RLS policy ve dar servis rolü

Uygulama öncesinde kapanması gereken mantıksal boşluklar:

1. Monitor worker şu anda yalnız probe engine ve health endpoint'i kuruyor; scheduler döngüsü yok.
2. Mevcut taslak job→check kilit sırası, check→job kullanan API komutlarıyla deadlock üretebilir.
3. API çalışan job'ı doğrudan `CANCELLED` yapıyor. Ağ isteği henüz sonlanmadan partial unique invariant serbest kalabilir ve yeni job fiziksel overlap oluşturabilir.
4. `manual_requested_at`, ilk coalesced manual niyetin `STATEFUL/DIAGNOSTIC` modunu kalıcı olarak taşımıyor.
5. Attempt sonucu için `result_recorded_at` guard'ı var fakat attempt satırında partition key içeren kesin result pointer'ı yok; yalnız `attempt_id` ile büyüyen partition geçmişinde bounded lookup garanti edilemez.
6. Rejection/cancellation enum'larının bir kısmı uygulama sözleşmesinde var fakat DB allowlist'i ile korunmuyor.
7. Scheduler, retry, concurrency ve freshness ayarları typed runtime config'e henüz eklenmedi.

Bu boşluklar uygulanmış migration'lar değiştirilmeden forward-only revision 14+ ile kapatılır.

## 5. Bileşen sınırları

```text
Monitor worker process
├── Due scheduler
├── Pending-job dispatcher
├── Lease recovery loop
├── Freshness reconciler
├── Active probe registry + bounded semaphores
├── Probe engine adapter
├── Observation persistence adapter
└── Health/readiness server

PostgreSQL
├── app.checks                    cadence + manual intent + fence source
├── monitoring.check_jobs         durable queue
├── monitoring.check_job_attempts lease/attempt lineage
├── monitoring.check_runs         immutable target results
├── monitoring current/history    health + incident source of truth
└── infra.outbox_*                downstream durable facts
```

Sınırlar:

- Scheduler SQL'i probe motorunu çağırmaz.
- Probe engine PostgreSQL bilmez.
- Saf reducer ID, DB, clock, log veya network kullanmaz.
- Persistence adapter reducer kararını yeniden yorumlamaz; typed effect'i uygular ve etkilenen satır sayısını doğrular.
- HTTP probe, SMTP, SSE ve prediction hiçbir DB transaction'ı içinde çalışmaz.
- PostgreSQL queue source of truth'tur; process belleğindeki aktif registry yeniden kurulabilir geçici durumdur.

## 6. Runtime döngüleri ve hata izolasyonu

Worker aynı process içinde dört bağımsız, abort edilebilir döngü çalıştırır:

1. **Due scheduler:** zamanı gelen check'lerden bounded sayıda scheduled job üretir.
2. **Dispatcher:** boş concurrency slotları kadar pending job bulur, claim eder ve probe task başlatır.
3. **Lease recovery:** süresi geçmiş leased/running işleri retry, cancel veya DEAD sonucuna taşır.
4. **Freshness reconciler:** deadline'ı geçmiş FRESH state'leri tam `fresh_until` anında kalıcı STALE yapar.

Her döngü:

- tek process içinde re-entrant çalışmaz;
- bounded batch kullanır;
- iş bulduğunda hemen devam eder, boşken bounded poll/backoff uygular;
- beklenmeyen hatayı loglayıp process'i sessizce durdurmaz;
- ortak shutdown sinyaline uyar;
- her loop'un en az bir başarılı iteration tamamlayıp tamamlamadığını ve halen hata durumunda olup olmadığını readiness için process belleğinde tutar.

Bir döngünün geçici DB hatası diğer döngünün state'ini bozmaz. Tek DB outage durumunda hepsi bounded backoff'a geçer; liveness çalışmaya devam eder, readiness `unavailable` olur.

## 7. Authoritative zaman ve cadence

Domain zamanları PostgreSQL'den alınır. Worker host saati şu kararlar için authoritative değildir:

- job available/due karşılaştırması;
- lease acquisition/expiry;
- attempt başlangıç/bitiş;
- run `finished_at`;
- health/incident transition zamanı;
- freshness reconciliation.

Probe faz süreleri monotonic process clock ile ölçülür; bunlar wall-clock sırası üretmez.

### 7.1 Sabit cadence hesabı

Bir check için:

```text
anchor   = cadence_anchor_at
interval = interval_seconds
now      = canonical DB time
next     = anchor + (floor((now - anchor) / interval) + 1) * interval
```

`next`, `now` değerinden kesin olarak büyüktür. `now < anchor` ise ilk uygun anchor/slot kullanılır. Hesap saf fonksiyon olarak boundary, uzun downtime ve interval değişimi testlerine sahip olur.

Scheduled job üretilirken:

- `scheduled_for`, check'in transaction başındaki eski `next_run_at` değeridir;
- yalnız bir job üretilir;
- `next_run_at`, `now` sonrasındaki ilk cadence slot'una sıçrar;
- aradaki her tick için ayrı job üretilmez;
- manual job bu hesabı ve `next_run_at` değerini değiştirmez.

İlk create/resume/probe-change jitter'ı Aşama 6'daki kalıcı `next_run_at` üzerinden korunur. Sonraki slotlar `cadence_anchor_at` ile drift üretmeden ilerler.

### 7.2 Uzun çalışma ve downtime

Bir scheduled job interval'dan uzun sürerse yeni scheduled job oluşturulmaz. Aktif job terminal olduktan sonra check hâlâ due ise en fazla bir catch-up job oluşturulur ve `next_run_at` tekrar gelecekteki ilk slota taşınır.

Server downtime sırasında hiçbir run üretilmez. Restart sonrasında eski due check için en fazla bir iş oluşur; downtime süresi history'de no-data boşluğu olarak kalır.

## 8. Job materialization

### 8.1 Scheduled job

Due scheduler candidate'ları owner-fair ve bounded biçimde okur. Her materialization kısa transaction'dır:

1. Check satırını `FOR UPDATE SKIP LOCKED` ile kilitle.
2. Hâlâ `LIVE + ACTIVE`, `next_run_at <= now` ve aktif job bulunmadığını doğrula.
3. Güncel config/version/generation değerlerinden versioned immutable snapshot üret.
4. `PENDING + SCHEDULED` job insert et.
5. `next_run_at` değerini gelecekteki ilk cadence slot'una taşı.
6. Gerekli redacted job-available audit/event kaydını yaz ve commit et.

Partial unique `(owner_id,check_id) WHERE PENDING/LEASED/RUNNING` son yarış bariyeridir. Constraint çakışması check schedule'ını ileri almış bir kısmi commit bırakamaz.

### 8.2 Manual job ve coalesced intent

Aktif job yoksa API'nin oluşturduğu `PENDING + MANUAL` job doğrudan dispatcher tarafından tüketilir.

Aktif job varsa ilk manual niyet şu iki alanla saklanır:

- `manual_requested_at`
- `manual_requested_mode`

İki alan birlikte null veya birlikte dolu olur. İlk bekleyen niyetin zamanı ve modu immutable'dır; sonraki manual talepler aynı niyete coalesce olur ve receipt kalıcı niyetin gerçek modunu döndürür.

Aktif job terminal yapılırken aynı check transaction'ında:

1. Bekleyen manual intent tekrar kontrol edilir.
2. Check silinmemişse güncel config/generation snapshot'ıyla tek manual job oluşturulur.
3. Stored mode yeni job'a kopyalanır.
4. Manual intent alanları temizlenir.

Manual job config değişiminden sonra üretiliyorsa son config snapshot'ını kullanır fakat request anındaki mode'u korur. Delete intent'i temizler. ACTIVE→PAUSED komutu, henüz job'a dönüşmemiş STATEFUL intent'i temizler; kullanıcı PAUSED durumda yeniden isterse açıkça DIAGNOSTIC job alır.

Crash veya eski kod nedeniyle aktif job olmadan kalan manual intent, due scheduler'ın ayrı reconciliation kolu tarafından aynı kuralla materialize edilir.

### 8.3 Öncelik

- Manual job scheduled job'dan yüksek priority taşır.
- Bir check'te pending manual intent varsa due scheduled job'dan önce manual intent materialize edilir.
- Owner fairness priority'den önce açlık önler; aynı owner içindeki manual işler scheduled işlerden önce gelir.
- Priority hiçbir zaman check başına tek aktif job invariant'ını aşmaz.

## 9. Job ve attempt yaşam döngüsü

```text
PENDING ──claim──> LEASED ──start──> RUNNING ──target result committed──> COMPLETED
   │                 │                  │
   │                 │                  ├─cancel request──> RUNNING + cancel_requested
   │                 │                  │                         │
   │                 │                  │                         └─ack/recovery──> CANCELLED
   │                 │                  │
   │                 └─lease expiry─────┴─> PENDING / DEAD / CANCELLED
   │
   └─config/pause/delete before claim────────────────────────────> CANCELLED
```

Target `PASS` ve target `FAIL` job açısından başarılı execution'dır ve `COMPLETED` olur. `DEAD`, yalnız probe sonucu üretilemeyen tekrarlı/permanent altyapı hatasıdır.

### 9.1 Cancellation request

API check satırını kilitledikten sonra:

- `PENDING` job'ı doğrudan terminal `CANCELLED` yapabilir;
- `LEASED/RUNNING` job'da `cancellation_requested_at` ve allowlist `cancellation_reason` set eder;
- leased/running job worker acknowledgement veya lease recovery tamamlanana kadar aktif state'te kalır.

Böylece ağ isteği gerçekten durmadan partial unique invariant serbest bırakılmaz. Worker heartbeat cancellation request'i gördüğünde probe `AbortSignal`ını tetikler; kısa acknowledgement transaction'ı attempt'ı ve job'ı `CANCELLED` yapar.

Worker öldüyse lease recovery, cancellation request bulunan expired job'ı retry etmek yerine `CANCELLED` yapar. Config/pause/delete sonrası eski target sonucu hiçbir zaman yeni state'e kabul edilmez.

### 9.2 Infrastructure fault

- `UNSUPPORTED_JOB_SNAPSHOT`: permanent; job `DEAD`.
- `ENGINE_ERROR`: bounded retry/backoff; bütçe biterse `DEAD`.
- lease/cancellation kaynaklı `CANCELLED`: target run değildir.
- DB transaction/partition/constraint hatası: target `FAIL` değildir; result persistence retry veya job recovery yoluna gider.

Target timeout, DNS, connect, TLS, blocked target, status mismatch ve body mismatch Aşama 7'nin typed target `FAIL` sonucudur; run olarak saklanır ve stateful ise health reducer'a girer.

## 10. Tek canonical kilit sırası

Bütün check-scope worker ve API işlemlerinde sıra:

1. `app.checks`
2. `monitoring.check_jobs`
3. `monitoring.check_job_attempts`
4. `monitoring.check_current_states`
5. `monitoring.incidents`
6. `monitoring.incident_segments`
7. `monitoring.open_health_intervals`
8. immutable history insert'leri
9. outbox/audit

Birden fazla check kilitlenecekse UUID artan sırada alınır.

Önceki Aşama 8 metnindeki job→attempt→check sırası bu belgeyle düzeltilir. API zaten check→job kullandığı için worker aynı sıraya getirilir; iki yönlü bekleme oluşmaz.

### 10.1 Candidate query ile lock transaction ayrımı

Dispatcher önce kilitsiz/bounded candidate kimlikleri okur. Bir candidate'ı claim ederken yeni kısa transaction açar:

1. Check'i `FOR UPDATE SKIP LOCKED` ile kilitler.
2. İlgili job'ı `FOR UPDATE` ile kilitler.
3. Hâlâ claim edilebilir olduğunu doğrular.
4. Fence/lease/attempt değişikliklerini yazar.

Pending job'ı önce kilitleyip sonra check beklemek yasaktır. Candidate okuması stale olabilir; transaction içi tekrar doğrulama authoritative'dir.

Heartbeat yalnız kendi job satırını conditional update eder ve check satırına ihtiyaç duymaz. Bu kısa tek-satır işlemi check→job kullanan işlemlerle deadlock cycle oluşturmaz.

## 11. Claim, lease, heartbeat ve fencing

### 11.1 Claim transaction'ı

Worker boş execution slotu ayırdıktan sonra:

1. Check ve pending job'ı canonical sırada kilitler.
2. Check `next_fencing_token` değerini attempt için ayırıp atomik artırır.
3. Job'ı `LEASED` yapar, `attempt_count` artırır; owner, expiry, heartbeat ve fence yazar.
4. Aynı attempt number/fence ile `check_job_attempts` insert eder.
5. Commit eder.

Fence check-scope monoton bir `bigint`tir; worker process sayacından veya wall clock'tan üretilmez.

Snapshot decode ve start ön kontrollerinden sonra job, aynı owner/fence koşuluyla `RUNNING` yapılır. Cancellation arada set edildiyse probe başlamadan acknowledgement çalışır.

### 11.2 Lease süresi

Başlangıç lease süresi:

```text
snapshot.timeout_ms + MONITOR_LEASE_GRACE_MS
```

olarak bounded hesaplanır. Heartbeat aralığı grace değerinin üçte birinden büyük olamaz. Heartbeat başarılı olduğunda lease aynı bounded süreyle uzatılır.

Worker son başarılı DB heartbeat'inden türetilen konservatif local deadline'ı da takip eder. Lease sahipliği expiry'den önce doğrulanamazsa probe abort edilir ve sonuç state'e uygulanmaya çalışılmaz.

### 11.3 Heartbeat koşulu

Heartbeat update yalnız şu koşullarda satır döndürür:

- job `LEASED/RUNNING`;
- `lease_owner` worker kimliğiyle aynı;
- `fencing_token` attempt ile aynı;
- lease henüz DB zamanına göre geçerli.

Response cancellation alanlarını da döndürür. Sıfır satır lease loss kabul edilir; raw DB hatası target failure'a dönüştürülmez.

### 11.4 Kabul garantisi

Sistem dış hedefe matematiksel exactly-once HTTP çağrısı garanti etmez. Process partition/lease expiry anında eski zombie request ile yeni attempt kısa süre fiziksel olarak çakışabilir. Garanti edilenler:

- normal interval/slow-target akışında tek aktif execution;
- check başına tek aktif durable job;
- her claim'de daha yüksek fence;
- attempt başına en fazla bir run kaydı;
- yalnız current, unexpired ve en yüksek uygun fencing token'lı sonucun state'e kabul edilmesi.

## 12. Fairness ve concurrency

### 12.1 Owner-fair sıralama

Candidate sorgusu eligible pending küme üzerinde owner başına sıra üretir ve global batch limitini sıralamadan sonra uygular:

```text
owner_rank = row_number() over (
  partition by owner_id
  order by priority desc, available_at, created_at, id
)

global order = owner_rank, priority desc, available_at, owner_id, id
```

Bu sıra önce her owner'ın ilk işini, sonra ikinci işlerini değerlendirir. Global FIFO ile önce limit alıp owner rank'i dar pencere üzerinde hesaplamak yasaktır; böyle bir pre-limit tek büyük owner'ın bütün candidate batch'ini doldurmasına izin verir. Tek büyük owner küçük owner'ı kalıcı olarak aç bırakamaz. Due materialization için aynı ilke `next_run_at,id` üzerinde uygulanır.

Query şekli gerçek PostgreSQL üzerinde `EXPLAIN (ANALYZE, BUFFERS)` ile doğrulanır. Gerekirse owner+dakika sırasını destekleyen partial index revision 14'te eklenir; sorgu ölçülmeden geniş indeks eklenmez.

### 12.2 Bounded semaphore'lar

Worker claim etmeden önce üç process-local slot alır:

- global probe slotu;
- owner slotu;
- target hostname slotu.

Hostname snapshot URL'sinden parse edilir fakat loglanmaz veya metric label yapılmaz. Bellek anahtarı process-secret HMAC fingerprint olabilir. Slot bulunmayan candidate lease edilmez; scan aynı batch'teki başka owner/host adaylarıyla devam eder.

Başlangıç reference değerleri:

| Config                          | Varsayılan | Sınır/anlam                        |
| ------------------------------- | ---------: | ---------------------------------- |
| `MONITOR_GLOBAL_CONCURRENCY`    |         64 | Process başına toplam probe        |
| `MONITOR_PER_OWNER_CONCURRENCY` |         32 | Process başına owner üst sınırı    |
| `MONITOR_PER_HOST_CONCURRENCY`  |          4 | Process başına hostname üst sınırı |
| `MONITOR_CANDIDATE_BATCH_SIZE`  |        128 | Her dispatcher scan'i              |
| `MONITOR_SCHEDULE_BATCH_SIZE`   |         64 | Her due materialization turu       |

Değerler pozitif, birbirleriyle tutarlı ve startup'ta fail-fast doğrulanır. Sabit ürün limiti `50` yoktur.

Per-owner/per-host hard cap v1'de process-localdır; çok replica'da efektif üst sınır replica sayısıyla çarpılır. Cluster-geneli owner fairness DB candidate sırasıyla korunur. Ölçüm kesin cluster-wide politeness limiti gerektirirse expiring shared token/slot tablosu ayrı migration ve ADR ile eklenir; uzun probe boyunca advisory lock tutup DB connection tüketilmez.

### 12.3 DB pool

Probe çalışırken DB connection tutulmaz. Pool boyutu probe concurrency ile bire bir büyümez; scheduler, heartbeat ve kısa persistence burst'leri için ayrı ölçülür. Reference başlangıç değeri 8 connection'dır ve PostgreSQL toplam connection bütçesi replica sayısıyla birlikte belgelenir.

## 13. Probe execution

Claim edilen task:

1. Versioned snapshot'ı strict decoder ile açar.
2. Job/attempt metadata'sını immutable execution context'e dönüştürür.
3. Job-scoped `AbortController` oluşturur.
4. Heartbeat/cancellation izleyicisini başlatır.
5. Aşama 7 `ProbeEngine.run` çağrısını transaction dışında yürütür.
6. Target result veya typed infrastructure fault üretir.
7. Heartbeat'i durdurur; result/fault transaction'ını çalıştırır.
8. Global/owner/host slotlarını `finally` içinde bırakır.

Task exception'ı worker loop'unu veya başka probe'ları düşürmez. Promise registry bütün aktif task'ları takip eder; fire-and-forget rejection bırakılmaz.

Worker kimliği `monitor-worker:<UUID>` gibi restart'ta değişen, secret/hostname taşımayan instance ID'dir. Job, attempt, run, check ve incident kimlikleri yalnız structured log correlation alanıdır; metric label değildir.

## 14. Observation persistence transaction'ı

Target result geldikten sonra tek kısa transaction:

1. Check'i kilitle.
2. Job ve attempt'ı kilitle.
3. Attempt `result_recorded_at` doluysa attempt üzerindeki `(result_run_finished_at,result_run_id)` pointer'ıyla doğru partition'daki mevcut run'ı bulup idempotent dön; yeni event yazma.
4. Current-state, açık incident/segment ve açık interval'i canonical sırayla kilitle.
5. Canonical `finished_at` değerini DB saatinden, attempt başlangıcından ve son accepted run'dan kesin ileri olacak şekilde milisaniye çözünürlükte üret.
6. Attempt-current girdisini job state, owner, fence ve gerçek DB gözlem anındaki lease expiry üzerinden hesapla.
7. Run/incident/segment/interval UUIDv7 allocation'larını adapter'da üret.
8. Aşama 8 reducer'ını immutable snapshot ile çalıştır.
9. Immutable `check_runs` satırını acceptance kararıyla insert et.
10. Current-state, interval, incident ve segment effect'lerini uygula.
11. Canonical event/outbox kayıt ve dispatch'lerini yaz.
12. Attempt'ın `result_recorded_at + result_run_finished_at + result_run_id` alanlarını atomik güncelle; current/non-terminal attempt için `RESULT_RECORDED` yaz, önceden terminal stale attempt'ın nedenini değiştirme.
13. Current job ise `COMPLETED` yap; değilse yeni attempt/job state'ine dokunma.
14. Bekleyen manual intent'i gerekiyorsa aynı transaction'da materialize et.
15. Commit et.

Her SQL effect beklenen row count'u doğrular. Invariant veya row-count uyuşmazlığı bütün transaction'ı rollback eder ve target sonucu sahte FAIL'e çevrilmez.

### 14.1 Attempt-current tanımı

`attemptCurrent=true` yalnız şu koşulların tamamında geçerlidir:

- job hâlâ bu attempt'ın `lease_owner + fencing_token` değerini taşıyor;
- job `LEASED/RUNNING` ve cancellation request yok;
- lease canonical DB zamanında sona ermemiş;
- attempt terminal değil;
- check/job lineage uyuşuyor.

Bu kontrol generation ve lifecycle acceptance'ından ayrıdır. Reducer canonical precedence'i daha sonra uygular.

### 14.2 Run idempotency

`check_job_attempts.result_recorded_at`, attempt başına tek result transaction guard'ıdır. Partitioned run tablosunda global unique attempt constraint taklit edilmez. Attempt row lock, insert ve result marker aynı transaction'da olduğundan ikinci writer yeni run oluşturamaz.

Attempt satırına nullable `(result_run_finished_at,result_run_id)` çifti eklenir ve marker ile üçlü all-null/all-present constraint'i uygulanır. Bu çift, run'ın partition key'ini ve kimliğini taşıdığı için duplicate replay doğrudan `(owner_id,check_id,finished_at,id)` primary key lookup'u yapar; bütün aylık partition'ları taramaz. Aynı transaction'da run insert edildikten sonra attempt pointer'ı yazılır; PostgreSQL sürümüyle doğrulanan deferred composite FK lineage'ı DB seviyesinde de korur. Duplicate replay ikinci health/incident/outbox effect'i üretmez.

`check_runs.finished_at` worker saatinden alınmaz. Adapter kilitli snapshot üzerinde `clock_timestamp()`, attempt `started_at + 1 ms` ve varsa son accepted run `finished_at + 1 ms` değerlerinin en büyüğünü kullanır. Böylece hızlı ardışık transition'lar zero-length interval/segment üretmez. Lease geçerliliği bu logical zamana değil aynı sorgudaki gerçek DB gözlem anına göre değerlendirilir.

### 14.3 Run içeriği

Saklanabilenler:

- PASS/FAIL, allowlist failure category ve diagnostic code
- bounded phase/total süreleri
- status code ve body-match boolean
- generation, fence, trigger/mode ve lineage kimlikleri

Saklanmayanlar:

- response body/header;
- raw socket/DNS error;
- çözümlenen IP;
- expected substring;
- URL veya query.

`diagnostic` yalnız bounded allowlist code taşır; exception message/stack taşımaz.

## 15. Reducer effect uygulama

Adapter Aşama 8 planını aşağıdaki eşlemeyle uygular:

| Effect                   | SQL davranışı                                                               |
| ------------------------ | --------------------------------------------------------------------------- |
| Current state            | Kilitli satırın explicit kolon update'i; `state_version` planla aynı olmalı |
| Finalize interval        | Önce partition'lı history insert; pozitif yarı-açık aralık zorunlu          |
| Set/rotate open interval | Aynı check PK'sinde explicit update/upsert                                  |
| Open incident            | Run FK'leriyle incident ve ilk segment insert                               |
| Update incident failure  | Son failure/resource version update                                         |
| Suspend incident         | Segment kapanışı + observed duration + UNOBSERVED                           |
| Resume incident          | Yeni tek açık segment + OBSERVED                                            |
| Close incident           | Segment kapanışı varsa uygula; incident terminal update                     |
| Event facts              | Canonical catalog payload + uygun dispatch'ler                              |

Adapter reducer'ın üretmediği transition eklemez. Özellikle tekrarlanan DOWN FAIL ikinci incident veya DOWN notification event'i üretmez.

### 15.1 Event destination'ları

Katalogdaki hedef routing şöyledir:

| Event ailesi                             | Destination               |
| ---------------------------------------- | ------------------------- |
| `check.run_recorded`                     | `PREDICTION`              |
| `check.observation_accepted`             | `REALTIME`                |
| `check.observation_rejected`             | `AUDIT`                   |
| `check.health_changed/freshness_changed` | `REALTIME`                |
| `incident.opened`, `incident.closed`     | `REALTIME + NOTIFICATION` |
| `incident.observation_suspended/resumed` | `REALTIME`                |

`check_runs` ve incident/current-state tabloları source of truth'tur; outbox history deposu değildir. Producer, istenen destination kümesini `infra.destination_activations` içindeki kalıcı aktif kümeyle kesiştirir. Bu global tablo `destination` primary key'i, `activated_at` cutover zamanı ve `activated_by_revision` provenance alanını taşır; servis rolleri yalnız okuyabilir ve aktivasyon yalnız consumer-ready forward migration ile eklenir. Kesişim boşsa gereksiz outbox event/dispatch satırı yazılmaz. Consumer bir sonraki aşamada ilk kez devreye alınırken activation ve cutover zamanı kalıcılaştırılır; eski `PENDING` satırlar yanlışlıkla replay edilmez:

- notification consumer mevcut open incident'ları kendi reconciliation kuralıyla ele alır, eski incident e-postalarını körlemesine göndermez;
- realtime projector ilk snapshot'ı source-of-truth tablolardan kurar, sonra cutover sonrası invalidation'ları işler;
- predictor başlangıç backfill'ini retention içindeki run tablolarından yapar, sonra yeni dispatch'leri tüketir.

Destination bir kez aktive edildikten sonra consumer'ın geçici olarak down olması dispatch üretimini durdurmaz; backlog ve retry görünür kalır. Aktivasyon, geçici health sinyali değil deployment capability'sidir. `check_jobs` claim'i outbox'a bağlı değildir; DB queue source of truth'tur.

## 16. Freshness reconciler

Candidate kaynağı:

```text
freshness_state = FRESH
AND fresh_until <= DB now
AND stale_reconciled_at IS NULL
```

Her candidate kısa transaction'da:

1. Check'i `FOR UPDATE SKIP LOCKED` ile kilitler.
2. Current-state'i ve varsa incident/segment/open interval'i canonical sırada kilitler.
3. Deadline'ın hâlâ geçerli olduğunu tekrar doğrular.
4. `planFreshnessReconciliation` çağrısını `asOf >= fresh_until` ile yapar.
5. Transition'ı tam `fresh_until` anında uygular; işlem zamanı interval sınırı değildir.
6. Event/outbox ile commit eder.

İki replica aynı check'i iki kez reconcile edemez. Observation transaction'ı deadline sonrasında önce kilit alırsa reducer kendi içinde overdue reconciliation yapıp yeni observation'ı uygular; bağımsız reconciler daha sonra no-op olur. Reconciler önce kilit alırsa observation yeni STALE snapshot üzerine uygulanır. Her iki sıra aynı semantik sonuca ulaşır.

Read-time override reconciler gecikse bile UI doğruluğunu korur; kalıcı reconciliation history/outbox ve bounded lag için gereklidir.

## 17. Retry, recovery ve restart

### 17.1 Retry/backoff

Infrastructure retry yalnız job/attempt katmanındadır:

```text
delay = min(max_delay, base_delay * 2^(attempt_count - 1) + deterministic_jitter)
```

Başlangıç policy'si üç attempt, 1 saniye base ve 30 saniye max'tır. Target FAIL retry edilmez; yeni cadence slot'u sonraki gözlemdir.
Deterministik jitter v1'de `0..1000 ms` aralığındadır ve job kimliği + attempt numarasının SHA-256 özetiyle üretilir; aynı kalıcı attempt restart sonrasında farklı bir availability zamanı üretmez.

### 17.2 Lease recovery

Recovery candidate sorgusu expired `LEASED/RUNNING` job'ları bounded okur. Transaction check→job→açık attempt sırasındadır:

- cancellation requested: attempt/job `CANCELLED`;
- check deleted/paused veya generation geçersiz: `CANCELLED`;
- retryable ve bütçe var: attempt `LEASE_LOST`, job `PENDING + backoff`, lease alanları temiz;
- permanent/bütçe bitti: attempt uygun terminal reason, job `DEAD`;
- başka worker heartbeat ile lease'i uzattıysa no-op.

Terminal geçiş aynı transaction'da bekleyen manual intent'i materialize edebilir. DEAD job health'i DOWN yapmaz; freshness doğal deadline'ında STALE olur.

### 17.3 Restart

Worker startup bellekte job üretmez ve bütün check'leri yüklemez. Kalıcı tabloları tarayan normal döngüler:

- due check'leri materialize eder;
- expired lease'leri recover eder;
- pending job'ları claim eder;
- overdue freshness state'leri reconcile eder.

Özel startup backfill modu yoktur. Bu sayede normal çalışma ve restart aynı test edilmiş kod yolunu kullanır.

## 18. Graceful shutdown

SIGTERM/SIGINT akışı:

1. Readiness draining olur; yeni schedule/claim durur.
2. Recovery ve freshness yeni batch başlatmaz.
3. Aktif probe'lara `MONITOR_SHUTDOWN_GRACE_MS` boyunca tamamlama fırsatı verilir.
4. Süre sonunda kalan probe'lar abort edilir.
5. Sahip olunan job mümkünse kısa transaction ile `PENDING + short backoff` bırakılır ve attempt `CANCELLED` kapanır.
6. Release başarısızsa lease expiry normal recovery'yi sağlar.
7. Health server ve DB pool kapanır; unhandled promise bırakılmaz.

Shutdown cancellation target run veya incident üretmez. Tekrarlı deployment bir check'i kalıcı DOWN yapamaz; yalnız monitoring gap oluşturabilir.

## 19. Şema ve migration planı

Uygulanmış revision 1–13 değiştirilmedi. Revision 14 aşağıdaki temeli forward-only olarak uyguladı:

1. `app.checks.manual_requested_mode` nullable enum ve `(at,mode)` pair constraint'i
2. `monitoring.check_jobs.cancellation_requested_at`
3. `monitoring.check_jobs.cancellation_reason` allowlist'i ve pair constraint'i
4. `check_runs` rejection reason allowlist constraint'i
5. attempt üzerinde `result_run_finished_at + result_run_id` pointer'ı, all-or-none constraint'i ve deferred composite run FK'si
6. ölçüm doğrularsa owner-fair due/pending partial indeksleri
7. job/attempt terminal ve lease alanlarının state-consistency forward constraint'leri
8. `infra.destination_activations(destination,activated_at,activated_by_revision)` için migration-owned activation/cutover kaydı; servis rollerine read-only grant ve mevcut inactive `PENDING/RETRY_WAIT` dispatch'lerin `DESTINATION_NOT_ACTIVATED` provenance'ıyla terminal sınıflandırılması
9. gerekli monitor-role column/grant ve RLS negatif testleri

Migration mevcut açık/pending satırları güvenli default/null ile backfill eder. Constraint'ler büyük tabloda gerekiyorsa `NOT VALID` eklenip aynı migration veya kontrollü takip adımında validate edilir.

### 19.1 Cancellation allowlist

İlk allowlist:

```text
CHECK_PAUSED
CHECK_DELETED
CONFIGURATION_CHANGED
```

Raw kullanıcı metni veya exception cancellation reason'a yazılmaz.

### 19.2 Rejection allowlist

DB constraint Aşama 8 canonical değerleriyle aynıdır:

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

Accepted run'da reason null, rejected run'da allowlist değer zorunludur.

## 20. Runtime config

Typed config tek kaynaktan yüklenir ve production/development aynı doğrulamayı kullanır:

| Değişken                        | Reference default | Not                            |
| ------------------------------- | ----------------: | ------------------------------ |
| `MONITOR_GLOBAL_CONCURRENCY`    |                64 | Process başına                 |
| `MONITOR_PER_OWNER_CONCURRENCY` |                32 | Globalden büyük olamaz         |
| `MONITOR_PER_HOST_CONCURRENCY`  |                 4 | Globalden büyük olamaz         |
| `MONITOR_CANDIDATE_BATCH_SIZE`  |               128 | Bounded scan                   |
| `MONITOR_SCHEDULE_BATCH_SIZE`   |                64 | Bounded due batch              |
| `MONITOR_SCHEDULER_POLL_MS`     |               250 | Boş queue poll                 |
| `MONITOR_DISPATCH_POLL_MS`      |               100 | Boş execution slot poll        |
| `MONITOR_RECOVERY_POLL_MS`      |              1000 | Expired lease scan             |
| `MONITOR_FRESHNESS_POLL_MS`     |               250 | Deadline reconciliation        |
| `MONITOR_HEARTBEAT_MS`          |              5000 | Lease grace ile doğrulanır     |
| `MONITOR_LEASE_GRACE_MS`        |             15000 | Snapshot timeout'una eklenir   |
| `MONITOR_SHUTDOWN_GRACE_MS`     |             30000 | Drain üst sınırı               |
| `MONITOR_DB_POOL_SIZE`          |                 8 | Probe concurrency'den bağımsız |

Poll interval'ları correctness kaynağı değildir; DB deadline/source of truth'tur. Değerler load testte ayarlanabilir, domain migration gerektirmez.

## 21. Güvenlik ve veri minimizasyonu

- Worker yalnız `site_monitor_monitor` rolüyle bağlanır; schema owner/superuser kullanmaz.
- Owner izolasyonu worker policy'sinde tüm tenant okumasına izin verse de her join/write composite owner lineage ile yapılır.
- Snapshot DB'de private config olarak URL/expected text taşıyabilir; log, event, audit, metric veya error payload'ına taşınmaz.
- SSRF kararı her execution ve redirect hop'unda Aşama 7 tarafından yeniden verilir; API kabulü execution izni değildir.
- Raw response body hiçbir zaman worker sınırından çıkmaz.
- Hostname concurrency anahtarı loglanmaz ve metric cardinality'sine girmez.
- SQL dinamik identifier kullanmaz; enum/reason değerleri allowlist'tir.
- Unexpected exception logu redaction formatter'dan geçer; snapshot/client objesi bütün olarak serialize edilmez.

## 22. Gözlemlenebilirlik ve health

### 22.1 Structured log olayları

- worker started/draining/stopped
- scheduler batch sonucu
- job claimed/started/completed/retried/dead/cancelled
- lease lost ve recovery sonucu
- observation accepted/rejected reason
- freshness batch ve lag bucket'ı
- invariant/transaction retry error code

Loglar URL, IP, body, expected text, owner e-postası veya raw DB/network error içermez.

### 22.2 Ölçüler

- due checks ve oldest due lag
- pending jobs ve oldest available lag
- leased/running/expired/dead job sayısı
- active probes; global/owner/host saturation bucket'ları
- claim, probe ve persistence duration histogramları
- target outcome/failure category sayıları
- infrastructure retry/dead sayıları
- accepted/rejected observation ve reason sayıları
- freshness reconciliation lag
- scheduler/materializer conflict ve DB retry sayıları

Owner/check/hostname kimliği metric label değildir. Aşama 17 exporter seçimini tamamlayana kadar aynı değerler bounded periyodik operational snapshot loguyla kanıtlanabilir.

### 22.3 Liveness/readiness

- `/health/live`: event loop ve process ayakta; DB sorgusu yapmaz.
- `/health/ready`: DB schema compatibility, monitor storage/current partition preflight ve runtime loop başlangıcını doğrular.
- Queue lag tek başına readiness'i düşürmez; restart storm yerine metric/alarm üretir.
- Draining worker readiness'te unavailable olur ve yeni claim almaz.

## 23. Test mimarisi

### 23.1 Saf unit testler

- Cadence boundary, timezone bağımsızlığı ve büyük downtime
- Tek catch-up/no-backfill
- Manual cadence değişmezliği
- Retry/backoff ve deterministic jitter
- Candidate owner-fair ordering
- Config invariant'ları
- Probe result→observation mapping ve redaction
- Infrastructure fault sınıflandırması

### 23.2 PostgreSQL entegrasyon testleri

- İki scheduler aynı due check için tek job üretir.
- İki worker aynı pending job'da tek current attempt üretir.
- Partial unique invariant uzun probe sırasında ikinci job'ı engeller.
- Pause/config/delete running job'da cancellation request bırakır; acknowledgement'a kadar yeni job yoktur.
- Expired lease daha yüksek fence ile reclaim edilir; eski sonuç history'de rejected kalır ve state'i değiştirmez.
- Attempt result duplicate replay partition-key pointer'ıyla aynı run'ı bulur; ikinci run/event üretmez.
- Manual coalesced intent tam bir kez ve doğru stored mode ile materialize edilir.
- Run + current state + interval + incident + segment + outbox hep birlikte commit/rollback olur.
- Inactive destination sınırsız pending backlog üretmez; active destination consumer outage'ında dispatch kaybolmaz.
- Reducer effect row-count/invariant hatası hiçbir kısmi state bırakmaz.
- Freshness deadline iki reconciler replica'sında bir kez uygulanır.
- Cross-owner lineage ve monitor rolü negatif testleri geçer.
- Current ve sonraki partition eksikliği readiness/persistence'ta görünür hata olur; target FAIL olmaz.

### 23.3 Process/crash testleri

- Worker probe sırasında öldürülür; lease expiry sonrası başka worker reclaim eder.
- Eski process geç sonuç yazmaya çalışır; yalnız `ATTEMPT_NOT_CURRENT/STALE_FENCING_TOKEN` sonucu mümkündür.
- Graceful shutdown task'ı tamamlar veya retryable bırakır.
- PostgreSQL kısa süre kesilir; API process'i ve bağımsız probe task'ları kontrollü davranır, sahte incident oluşmaz.
- Restart sonrası due check devam eder ve downtime aralığı no-data kalır.

### 23.4 Kapasite testleri

20, 200 ve 500 check aynı kod yoluyla test edilir:

- 30 saniyelik cadence materialization maliyeti
- owner-fair queue drain
- 50+ eşzamanlı hızlı/yavaş simulator hedefi
- bütün hedeflerin timeout olması
- tek hostname'e yığılma
- tek owner'ın queue'yu doldurması ve küçük owner'ın ilerlemesi
- API readiness/list latency'nin worker yükü altında korunması

Rapor; CPU, memory, DB connections, queue lag, claim/persistence p95 ve tamamlanan probe throughput değerlerini kaydeder. Hedef karşılanmıyorsa sayı gizlenmez; bottleneck ve sonraki tuning açıkça yazılır.

## 24. Transaction retry politikası

Kısa ve tamamen idempotent DB transaction'ları yalnız allowlist transient SQLSTATE için bounded retry edilir:

- `40001` serialization failure
- `40P01` deadlock detected

Probe yeniden çalıştırılmaz; aynı immutable target sonucu ve önceden ayrılmış ID'lerle yalnız persistence transaction'ı yeniden denenir. Unique/constraint/invariant hatası otomatik transient sayılmaz.

Retry attempt ve backoff loglanır fakat SQL metni/parametreleri veya hassas snapshot loglanmaz.

## 25. Uygulama dilimleri

1. Typed monitor runtime config, saf cadence/backoff/fairness yardımcıları ve unit testleri
2. Revision 14 cancellation/manual-mode/result-pointer/destination-activation migration'ı, Kysely tipleri ve API/worker için ortak activation-aware outbox writer
3. Canonical check-first lock helper'ları ve scheduled/manual materializer
4. Claim/lease/heartbeat/fencing ve iki-worker PostgreSQL testleri
5. Bounded dispatcher, semaphores, active task registry ve probe orchestration
6. Infrastructure fault, retry/DEAD, cancellation acknowledgement ve lease recovery
7. Observation snapshot loader, reducer adapter ve atomik result transaction'ı
8. Freshness reconciler ve deadline yarış testleri
9. Graceful shutdown, readiness/storage preflight ve redacted operational loglar
10. 20/200/500 kapasite, process-kill/restart ve API-isolation kanıtları
11. Compose smoke, tam CI, karar/geliştirme/proje durumu güncellemeleri

İlk dokuz dilim uygulanmış ve doğrulanmıştır. Dört loop production entrypoint'inde aktiftir; startup mevcut ve sonraki UTC ay için run/interval partition'larını doğrular, readiness bütün loop'ların ilk başarılarını ve güncel hata durumunu izler, shutdown poll sleep'lerini kesip yeni claim'i durdurur ve aktif probe'ları bounded grace sonunda abort eder. Her dilim küçük ve anlamlı commit olur. Migration revision uygulandıktan sonra değiştirilmez; bulunan sorun yeni forward migration ile düzeltilir.

## 26. Tamamlanma kapısı

Aşama 9 ancak aşağıdakilerin tamamı sağlandığında tamamlanır:

- Gerçek scheduled ve manual probe uçtan uca çalışır.
- API request'i probe beklemez.
- Aynı check normal slow/interval akışında kendisiyle paralel çalışmaz.
- Cancellation acknowledgement gerçekleşmeden yeni job başlamaz.
- İki worker tek current attempt/accepted observation üretir.
- Lease-lost ve stale fence current state/incident'ı değiştiremez.
- Process kill sonrası job bounded lease policy ile devam eder.
- Downtime backfill veya sahte DOWN üretmez.
- Target PASS/FAIL ile infrastructure fault kesin ayrılır.
- Run, state, interval, incident, segment ve outbox atomiktir.
- Freshness tam deadline'da, idempotent ve gap-safe reconcile edilir.
- Owner fairness ve global/owner/host concurrency 20/200/500 profillerinde ölçülür.
- URL/body/IP/secret log veya event'e sızmaz.
- API ve worker aynı activation-aware outbox routing helper'ını kullanır; inactive destination için yeni dispatch oluşmaz.
- Monitor rolü least privilege ve cross-owner negatif testlerden geçer.
- Format, lint, strict typecheck, unit, PostgreSQL integration, process/failure ve Compose smoke kontrolleri geçer.
- `README`, `PROJECT_STATUS`, `DECISIONS`, `DEVELOPMENT_LOG` ve `NEXT_STEPS` dürüstçe güncellenir.

## 27. Bilinen tavizler

- External HTTP exactly-once değildir. Lease partition sonrası kısa zombie overlap teorik olarak mümkündür; fencing yalnız bir sonucu state'e kabul eder.
- Per-owner/per-host hard concurrency cap process-localdır. Replica sayısı deployment kapasite hesabının parçasıdır; kesin cluster-wide slot ancak ölçülmüş ihtiyaçla eklenir.
- PostgreSQL polling correctness kaynağıdır; `LISTEN/NOTIFY` optimizasyonu Aşama 13'ten önce zorunlu değildir.
- DEAD infrastructure job target downtime sayılmaz. Sonraki cadence yeni job üretir; operasyon metriği/alarmı gerekir.
- Realtime/notification/prediction consumer'ları sonraki aşamalardadır. Destination aktive edilene kadar dispatch üretilmez; aktivasyon sonrasında oluşan backlog monitoring transaction'ını bloke etmez.
- Aşama 12 tamamlanana kadar run/interval verisi yazılır fakat kullanıcıya günlük/haftalık/aylık rollup API'si sunulmaz.
