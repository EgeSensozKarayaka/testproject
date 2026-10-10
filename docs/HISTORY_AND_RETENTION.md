# Geçmiş, Rollup, Availability ve Housekeeping Mimarisi

**Durum:** Aşama 12 nihai mimarisi — uygulama dilimleri 1–3 tamamlandı

**Tarih:** 2026-10-10 17:27 +06:00

**Son uygulama güncellemesi:** 2026-10-10 18:29 +06:00

**Kapsam:** FR-HIST-001–008, AC-011, AC-035, AC-060–065, NFR-DATA-002

## 1. Amaç ve Sınır

Bu aşama üç ürün ihtiyacını tek, tutarlı veri hattında çözer:

1. Bir kontrolün son gün, hafta ve ay response-time grafiğini bounded maliyetle döndürmek.
2. Availability'yi run sayısından değil, gözlemlenmiş sağlık süresinden hesaplamak; veri boşluğunu düşüş saymamak.
3. Ham veri büyürken partition, rollup, retention ve bounded purge işlerini ana monitoring akışından izole yürütmek.

Bu aşama React grafik ekranını, SSE güncellemelerini, public status projection'ını ve predictor modelini uygulamaz. Bunlar sırasıyla Aşama 14, 13, 15 ve 16 kapsamındadır. Aşama 12 private API ve kalıcılık katmanını tamamlar.

## 2. Değişmez Ürün Semantiği

### 2.1 Zaman ekseni

- Bütün kalıcı ve dış API zamanları UTC'dir.
- Bütün aralıklar `[from,to)` biçiminde yarı açıktır.
- `period=day|week|month` istemci saatinden değil, history transaction'ının PostgreSQL `transaction_timestamp()` değerinden türetilen `to` anına sabitlenir. Exact rollup toplamı için day/week `to` değeri UTC dakikaya, month `to` değeri UTC saate aşağı yuvarlanır; gerçek transaction zamanı ayrıca `generated_at` olur.
- V1 istemcisi keyfi bir geçmiş `to` değeri göndermez. Böylece cache, sorgu bütçesi ve cursor davranışı bounded kalır.
- Server kapalıyken kaçırılan run'lar üretilmez. Bu zaman `UNKNOWN/no data` olur; FAIL veya DOWN olarak backfill edilmez.

### 2.2 Availability ve coverage

Availability yalnız finalize edilmiş `UP` ve `DOWN` sürelerinden hesaplanır:

```text
observed_ms  = up_ms + down_ms
availability = observed_ms = 0 ? null : up_ms / observed_ms
coverage     = observed_ms / requested_window_ms
```

`UNKNOWN`, hiç veri olmayan zaman ve açık `PROVISIONAL` süre availability paydasına girmez. Response ayrıca `unknown_ms` ve `provisional_ms` döndürür; aşağıdaki eşitlik her response ve bucket için korunur:

```text
requested_window_ms = up_ms + down_ms + unknown_ms + provisional_ms
```

Oranlar `0..1` aralığındadır. Veri yokken availability `0` değil `null` olur. Maintenance ölçümü durdurmaz ve availability formülünü değiştirmez.

### 2.3 Provisional/SUSPECT çözümü

İlk başarısız gözlemden sonra açılan `PROVISIONAL` interval kalıcı availability sonucu değildir:

- sonraki kabul edilmiş FAIL incident'ı doğrularsa ilk başarısız gözlemden itibaren `DOWN` finalize edilir;
- eşik aşılmadan PASS gelirse aynı süre `UP` finalize edilir;
- freshness kaybı, pause veya config değişimi olursa doğrulanmamış bölüm `UNKNOWN` olarak finalize edilir.

Başarısız run immutable geçmişte kalır; yalnız availability sınıflandırması sonradan kesinleşir.

### 2.4 Response-time örnekleri

- Yalnız `accepted_for_state=true` stateful run'lar ana grafiğe katılır.
- Paused-check diagnostic run'ları, stale-fence sonuçları ve diğer rejected run'lar teknik kanıttır fakat SLA/history grafiğine katılmaz.
- `total_ms`, PASS ve FAIL için probe'un gözlemlenen uçtan uca süresidir; dolayısıyla ikisi de response-time örneğidir.
- Her bucket `sample_count`, `response_sum_ms`, `min` ve `max` taşır; API ortalamayı `sum/count` ile üretir.
- Probe generation değişimi seriyi bölmez. Rollup satırları generation bazlı saklanır, API aynı kontrolün pencere içindeki generation'larını toplar. Config değişiminde oluşan UNKNOWN aralık coverage'a dürüstçe yansır.

## 3. Mevcut Temel ve Kapatılacak Boşluklar

Mevcut revision 20 şeması şu doğru temelleri zaten içerir:

- aylık `monitoring.check_runs` ve `monitoring.health_intervals` partition'ları;
- aylık minute ve yıllık hour rollup parent tabloları;
- `open_health_intervals` ile finalized `health_intervals` ayrımı;
- run/history, health interval ve rollup owner/check/time indeksleri;
- `rollup_checkpoints` ve `site_monitor_housekeeper` rolü;
- DEFAULT partition güvenlik ağı ve gelecek partition helper'ları.

Uygulama öncesinde kapatılması gereken boşluklar:

1. Rollup tablolarını dolduran production worker ve source cursor yoktur.
2. Finalize edilmesi günler sonra gerçekleşebilen uzun açık interval'lar eski bucket'ları kirletebilir; yalnız zaman watermark'ı yeterli değildir.
3. History ve incident OpenAPI yolları tanımlı olsa da API/service implementasyonu yoktur.
4. Mevcut `resolution=minute|hour` alanı çıktı bucket genişliğini söylemez.
5. `check_runs → jobs/attempts` ile `incidents/segments/current-state/open-health/finalized-health → check_runs` foreign key zinciri, belgelenmiş farklı retention sürelerinde partition drop ve bounded purge'u bloke eder.
6. Incident `group_id` filtresinin tarihsel anlamı mevcut check'in bugünkü grup üyeliğine bırakılmıştır; incident açılışındaki grup snapshot'ı yoktur.
7. DEFAULT partition'a veri düştüğünde otomatik attach işleminin güvenli repair sözleşmesi tanımlı değildir.

## 4. Bileşen Mimarisi

```text
monitor worker transaction
  ├─ immutable check_run
  ├─ current state + open/finalized health interval
  └─ compact run evidence
              │
              ▼
housekeeping-worker (ayrı process, aynı Node.js monorepo)
  ├─ source discovery/checkpoints
  ├─ bounded minute rebuild ranges
  ├─ minute → hour aggregation
  ├─ partition pre-creation/default guard
  └─ retention + bounded purge
              │
              ▼
PostgreSQL rollup projection
              │
              ▼
Fastify history/incident API
```

`housekeeping-worker` ayrı bir ürün mikroservisi değildir: public API'si ve bağımsız domain verisi olmayan deployment process'idir. Ayrı process/container seçilmesinin nedeni ağır aggregate, DDL ve purge işlerinin probe dispatcher, API veya notification worker'ın event loop/DB pool'unu tüketmemesidir.

Worker yalnız `site_monitor_housekeeper` login/rolüyle, küçük ve ayrı bir DB pool'u üzerinden çalışır. API veya monitor readiness'i housekeeper readiness'ine bağlı değildir; history projection aşırı geri kalırsa yalnız history endpoint'i kontrollü hata verir.

## 5. Uygulanan Forward-Only Revision 21

Revision 21 uygulanmış migration'ları değiştirmeden aşağıdaki temeli ekledi.

### 5.1 Uzun ömürlü run evidence

`monitoring.run_evidence` current state, incident ve health-interval lineage'ının uzun süre ihtiyaç duyduğu bounded run özetidir:

| Alan                                      | Anlam                                      |
| ----------------------------------------- | ------------------------------------------ |
| `owner_id, check_id, finished_at, id`     | Composite primary key ve özgün run locator |
| `outcome`, `failure_category`, `total_ms` | Bounded kanıt özeti                        |
| `recorded_at`                             | İlk persistence zamanı                     |
| `created_at`                              | Evidence satırı zamanı                     |

Kabul edilen her stateful run, state effect transaction'ında evidence satırını idempotent yazar. `check_current_states`, `incidents`, `incident_segments`, `open_health_intervals` ve `health_intervals` run locator foreign key'leri bu kompakt tabloya taşınır. Migration önce mevcut referansların evidence backfill'ini yapar, her referans türü için sayıları ve eksik locator'ları doğrular, sonra constraint'leri değiştirir.

Artık referans edilmeyen evidence satırları kısa grace süresinden sonra bounded batch ile silinir; incident/current-state tarafından referans edilen satırlar FK `RESTRICT` nedeniyle kalır. Bu model 400 günlük incident kanıtını korurken 90 günlük geniş raw run partition'larının düşürülebilmesini sağlar.

`check_runs` üzerindeki job/attempt ID'leri immutable trace locator olarak kalır fakat parent queue satırlarına kalıcı FK taşımaz. FK kaldırılmadan önce yeni `BEFORE INSERT` lineage trigger/fonksiyonu yazım anında owner/check/job/attempt eşleşmesini doğrular. Böylece 30 günlük terminal job/attempt purge'u, 90 günlük raw run retention'ından bağımsız olur; yeni yanlış lineage yine veritabanında reddedilir.

### 5.2 Source cursor ve bounded rebuild queue

`monitoring.rollup_checkpoints` şu typed cursor alanlarıyla genişler:

- source watermark (`recorded_at` veya `finalized_at`),
- tie-breaker owner/check/source-time/id tuple'ı,
- projection `data_through`,
- son başarı/hata ve monoton revision.

Yeni `monitoring.rollup_rebuild_ranges` tablosu owner/check, `MINUTE|HOUR`, aligned `[range_start,range_end)`, `next_bucket_start`, reason, retry metadata ve stable source fingerprint taşır. Uzun bir health interval observation transaction'ında binlerce bucket yazmaz; source scanner tek range oluşturur, worker range'i küçük bucket batch'lerine böler.

Cursor taramalarının partition sayısıyla doğrusal büyümemesi için Revision 21 accepted run'lara `(recorded_at,owner_id,check_id,finished_at,id)` partial discovery indeksini; finalized interval'lara `(finalized_at,owner_id,check_id,started_at,id)` discovery indeksini ekler. İndeks sırası cursor tuple'ıyla aynıdır ve `EXPLAIN` kapasite kapısında doğrulanır.

Range işlemi external SMTP benzeri claim taşımaz. Tek `security_api.process_rollup_range(batch_size)` transaction'ı `FOR UPDATE SKIP LOCKED` ile range'i seçer, deterministik bucket'ları yeniden hesaplar, upsert eder ve progress'i ilerletir. Process ölürse transaction rollback olur; iki replica aynı bucket'ı yazsa bile source'dan recompute + unique PK sonucu aynıdır.

### 5.3 Incident açılış snapshot'ı

`monitoring.incidents.group_id_at_open` nullable composite FK olarak eklenir. Yeni incident, check kilidi altındaki o anki grup kimliğini snapshot eder. Mevcut incident'lar current group ile best-effort backfill edilir; migration öncesi tarihsel grup doğruluğunun üretilemeyeceği açıkça belgelenir.

Bu alan yalnız filtreleme/açıklama içindir. Notification policy veya maintenance kararı her zaman kendi tanımlı current/snapshot kurallarını kullanmaya devam eder.

### 5.4 Partition retention manifest'i

`infra.partition_retention_runs` parent, child, boundary, row count, detach/drop zamanı, durum ve bounded hata kodunu saklar. Partition silme audit logunun yerine geçmez; operasyonel tekrar/kanıt kaydıdır. Aynı child için tek aktif işlem unique constraint ile korunur.

### 5.5 Yetki sınırı

Housekeeper'a tablolar üzerinde genel DML verilmez. Aşağıdaki dar `security_api` fonksiyonları verilir:

- source discovery + range enqueue,
- bounded rollup range process,
- partition ensure/status,
- bounded retention/purge step,
- projection readiness/status.

API rollup, interval ve incident tablolarını mevcut owner RLS altında yalnız okur. Cross-owner check/incident ID'si unknown kaynakla aynı `404` olur.

## 6. Rollup Veri Hattı

### 6.1 Source discovery

İki bağımsız cursor kullanılır:

1. `check_runs.recorded_at` sırasıyla yeni accepted run'lar bulunur ve dokundukları minute range'leri enqueue edilir.
2. `health_intervals.finalized_at` sırasıyla yeni finalized interval'lar bulunur ve kesiştikleri minute range enqueue edilir.

Cursor sırası timestamp tek başına değildir; `(watermark,owner_id,check_id,source_time,id)` tam tuple'ıdır. Range insert ve cursor ilerletme aynı transaction'dadır. Crash iki işlemi de geri alır; tekrar okuma idempotent fingerprint/unique constraint ile duplicate side effect üretmez.

Cutover'da cursor retention başlangıcına kurulur ve mevcut kaynaklar aynı yol üzerinden backfill edilir. Tarihsel ham run'ı olmayan fakat finalized interval'ı bulunan dönem availability üretmeye devam eder; latency örneği doğal olarak boş kalır.

### 6.2 Minute recompute

Her minute bucket source-of-truth'tan tamamen yeniden hesaplanır:

- run sayısı/latency: bucket içinde biten accepted run'lar;
- duration: finalized interval ile bucket kesişiminin `greatest(start)` / `least(end)` kırpımı;
- generation: storage PK'sinde korunur, API'de tüm generation'lar toplanır;
- açık interval: rollup'a yazılmaz, query-time overlay olur.

Bir generation/bucket için kaynak kalmadıysa stale projection satırı silinir. Toplam `up+down+unknown+provisional` bucket süresini aşarsa transaction invariant hatasıyla rollback olur ve alert üretilir; veri sessizce clamp edilmez.

### 6.3 Hour rollup

Değişen minute bucket, aynı transaction sonunda ilgili check/hour range'ini enqueue eder. Hour bucket yalnız minute rollup'lardan deterministik toplanır. Minute projection tamamlanmadan hour checkpoint ilerlemez.

Hour rollup, response min/max/sum/count ile duration alanlarını toplar. Average-of-average yapılmaz.

### 6.4 Açık interval ve güncel veri kuyruğu

History sorgusu rollup projection'ını şu iki bounded kaynakla tamamlar:

- `open_health_intervals` satırını `[max(start,from),to)` aralığında query-time bucket'lara böler;
- rollup watermark ile `to` arasındaki kısa raw tail'i accepted runs/finalized intervals üzerinden hesaplar.

Raw tail limiti minute kaynak için 15 dakika, hour kaynak için 2 saattir ve typed config'tir. Projection bundan daha gerideyse API ay görünümünde ham 30 günlük taramaya düşmez; `503 history_projection_lagging` ve bounded `Retry-After` döndürür. Dashboard/check API çalışmaya devam eder.

Requested window ile kesişen pending rebuild range varsa API yalnız configured tail bütçesi içinde source recompute yapar; daha büyük düzeltmede aynı kontrollü `503` davranışı kullanılır. Eksik bucket sessizce doğruymuş gibi sunulmaz.

## 7. History API Sözleşmesi

`GET /api/v1/checks/{check_id}/history?period=day|week|month` session, owner rate-limit ve RLS gerektirir. Soft-deleted check'in tombstone'u retention boyunca sahibine history/incident okuması için erişilebilir kalır; normal check config/list endpoint'i onu live kaynak olarak göstermez.

### 7.1 Sabit output bütçesi

| Period  | Exact pencere | Source | Output bucket | En fazla bucket |
| ------- | ------------: | ------ | ------------: | --------------: |
| `day`   |       24 saat | minute |    300 saniye |             288 |
| `week`  |     7×24 saat | minute |   1800 saniye |             336 |
| `month` |    30×24 saat | hour   |   7200 saniye |             360 |

API sözleşmesi mevcut `resolution: minute|hour` alanını source resolution olarak korur ve zorunlu `bucket_seconds` ekler. Böylece payload büyümeden grafik gerçek kova genişliğini bilir.

### 7.2 Response alanları

Top-level response en az şunları taşır:

- `check_id`, `period`, exact `from/to`;
- `resolution`, `bucket_seconds`, `generated_at`, `data_through`;
- `availability_ratio`, `coverage_ratio`;
- `observed_up_ms`, `observed_down_ms`, `unknown_ms`, `provisional_ms`;
- sıralı ve tam sayıda bucket.

Her bucket exact `from/to`, response-time average veya `null`, sample count, aynı dört duration, availability/coverage ve classification taşır.

Classification deterministiktir:

- observed süre yok ve provisional yok: `UNKNOWN`;
- yalnız provisional: `PROVISIONAL`;
- bütün observed süre tek sınıf: `UP` veya `DOWN`;
- birden çok observed sınıf ya da observed+provisional: `MIXED`.

Bucket olmayan zamanlar server tarafından üretilir; frontend eksik array elemanını tahmin etmez. Pre-creation, server outage, pause ve retention boşluğu UNKNOWN duration olarak görünür.

### 7.3 Tutarlılık ve HTTP davranışı

- Sorgu tek read-only `REPEATABLE READ` transaction ve tek DB time anchor kullanır.
- `statement_timeout` history için ayrı ve bounded'dır; timeout genel API pool'unu bloke etmez.
- Response `Cache-Control: private, max-age=15, stale-while-revalidate=30` ve `Vary: Cookie` taşır; shared/public cache yasaktır.
- Parametre/contract hatası `422`, owner'a görünmeyen check `404`, projection lag `503` olur.
- URL, expected body, raw diagnostic ve response body history response/loglarına girmez.

## 8. Incident Journal API

### 8.1 Liste

`GET /api/v1/incidents` aşağıdaki filtreleri destekler:

- `check_id`;
- `group_id` — `group_id_at_open` snapshot'ına göre;
- `status=OPEN|CLOSED`;
- `started_before` ve `ended_after` overlap filtresi;
- `limit` (varsayılan 50, en fazla 100) ve signed keyset cursor.

Sıra `(started_at DESC,id DESC)` olur. Cursor owner, filtre fingerprint'i, snapshot time ve son tuple'ı HMAC ile taşır; başka filtrede replay veya bit değişikliği reddedilir. Offset pagination kullanılmaz.

Liste item'ı check kimliğiyle birlikte current/tombstone check display name'ini, başlangıç/onay/bitiş, status, observation mode, closure reason, observed ve wall duration'ı taşır. Check adı tarihsel snapshot iddiası değildir; incident zamanları ve grup snapshot'ı tarihsel gerçektir.

### 8.2 Detay ve süreler

`GET /api/v1/incidents/{incident_id}` observed segmentleri ve gap'leri döndürür:

- `incident_segments` satırları `OBSERVED_DOWN` olur;
- observed segmentler arasındaki, baştaki ve sondaki boşluklar `UNOBSERVED` olarak response-time projection'da sentezlenir;
- açık observed segment `to` anına kadar, açık unobserved incident wall duration'ı artarken observed duration artmadan hesaplanır.

Closed incident'ın `observed_duration_ms` değeri immutable'dır. Open incident için stored completed segment toplamına yalnız açık observed segmentin `[started_at,to)` süresi eklenir. `wall_duration_ms = effective_end - incident.started_at`; bu iki değer gap olduğunda bilinçli olarak farklıdır.

## 9. Partition ve Retention Politikası

### 9.1 Varsayılan saklama

| Veri                      |      Minimum retention | Temizleme                              |
| ------------------------- | ---------------------: | -------------------------------------- |
| Raw check runs            |                 90 gün | Aylık partition detach/drop            |
| Finalized health interval |                400 gün | Aylık partition detach/drop            |
| Minute rollup             |                 35 gün | Aylık partition detach/drop            |
| Hour rollup               |                400 gün | Yıllık partition detach/drop           |
| Incident/segment          |                400 gün | Bounded owner/time delete              |
| Terminal job/attempt      |                 30 gün | Bounded delete; run FK'sinden bağımsız |
| Unreferenced run evidence |            2 gün grace | Bounded anti-join delete               |
| Referenced run evidence   | Referans kalkana kadar | FK korur                               |
| Completed outbox          |                 30 gün | Bounded delete                         |
| DEAD outbox               |  Operatör çözene kadar | Otomatik silinmez                      |

Partition granularity nedeniyle retention bir minimumdur: aylık partition son tam sınırdan sonra, yıllık hour partition ise yalnız tamamen süresi dolduğunda düşürülür. Bu nedenle fiziksel saklama configured günden daha uzun olabilir; daha kısa olamaz. Bu maliyet dashboard doğruluğuna tercih edilir ve status/metrics'te görünür olur.

### 9.2 Partition yaşam döngüsü

- Housekeeper her gün mevcut ay ile en az sonraki üç ayı doğrular.
- Partition DDL deployment başına sabit advisory lock, `lock_timeout=5s` ve statement timeout ile çalışır.
- DEFAULT partition normal durumda sıfır satırdır. Satır bulunursa readiness değil ayrı yüksek öncelikli metric/alert etkilenir.
- DEFAULT içinde hedef aralığa ait satır varken normal loop partition attach etmeye çalışmaz. Ayrı operator repair komutu staged copy/delete/attach adımlarını sayım ve checksum ile yürütür; başarısızlığı gizlemez.
- Retention dolan child önce detach edilir, manifest'e satır/sınır kaydı yazılır, 24 saatlik configurable grace sonrası drop edilir.
- `health_intervals` `started_at` ile partition edildiği için yalnız partition üst sınırına bakılmaz. Child içindeki `max(ended_at)` retention cutoff'tan eski değilse partition detach edilmez; uzun interval'ın retention penceresinde kalan bölümü korunur ve gecikme metriğe yazılır.
- Aktif/legal hold ihtiyacı doğarsa drop'u durduran açık deployment politikası eklenir; v1 sahte legal-hold ürünü içermez.

### 9.3 Row purge

Partition olmayan tablolar `(time,id)` keyset'iyle küçük batch silinir. Her step statement timeout, max row ve max wall-time bütçesine sahiptir. Purge sırası child'dan parent'a gider. Bir FK/reference nedeniyle silinemeyen satır hata değildir; sonraki turda tekrar denenir ve yaş metriğinde görünür.

## 10. Worker Runtime ve Arıza İzolasyonu

`apps/housekeeping-worker` aşağıdaki bağımsız loop'ları çalıştırır:

1. source discovery/backfill;
2. minute/hour range processing;
3. partition pre-create/default guard;
4. retention/row purge.

Her loop tek seferde bounded iş alır, AbortSignal destekler ve ayrı jitter'lı poll interval kullanır. Varsayılan DB pool 4, rollup concurrency 2, DDL concurrency 1'dir; typed config ile değişir.

Readiness için schema uyumu, DB ve dört loop'un en az bir başarılı iteration'ı gerekir. Rollup source hatası housekeeper readiness'ini düşürür fakat API/monitor/notification servislerini düşürmez. Graceful shutdown yeni step'i durdurur, aktif transaction'ı configured grace kadar bekler ve pool'u kapatır.

İki housekeeper replica desteklenir. `SKIP LOCKED`, deterministic upsert ve partition advisory lock aynı işi duplicate çalıştırsa bile yanlış sonuç üretmez. Exactly-once job iddiası yoktur; sonuç idempotenttir.

## 11. Güvenlik, Gizlilik ve Gözlemlenebilirlik

- History ve incident sorguları yalnız transaction-local authenticated owner context'iyle çalışır.
- Housekeeper kullanıcı session/credential, notification recipient veya public token okuyamaz.
- Log/metric'te URL, check adı, e-posta, response body veya raw diagnostic yoktur.
- Yüksek cardinality owner/check/incident ID metric label olmaz; gerekirse logda HMAC fingerprint kullanılır.
- Önerilen metrikler: source cursor lag, pending range count/oldest age, processed bucket rate, API raw-tail width, projection-lag 503 sayısı, DEFAULT row count, future partition horizon, retention overdue partition/row count ve loop failure code.
- Rebuild/purge logları processor, resolution, bounded row/bucket sayısı, süre ve sanitized result code taşır.

## 12. Performans Bütçeleri

Warmed referans ortam hedefleri:

- bir check için 30 günlük history DB işi p95 `<500 ms`;
- HTTP parse/serialization dahil history endpoint p95 `<2 s`;
- incident list p95 `<500 ms`;
- output en fazla 360 bucket ve bounded response boyutu;
- aylık sorgu planında partition pruning ve hour rollup indeksi zorunlu;
- raw 30 günlük `check_runs` scan'i yasaktır.

Referans dataset en az 500 check × 30 saniye × 35 gün eşdeğer dağılım taşır. Her CI koşusunda milyonlarca row üretmek yerine küçük correctness fixture zorunlu, büyük deterministic SQL dataset ayrı `test:history-capacity` profili olur. Ölçülen makine/CPU/RAM/PostgreSQL sürümü ve `EXPLAIN (ANALYZE,BUFFERS)` özeti raporda saklanır. Bütçe aşılırsa özellik başarılı ilan edilmez; ölçüm ve dar boğaz dürüstçe yazılır.

## 13. Zorunlu Test ve Kabul Matrisi

### 13.1 Domain/correctness

- farklı interval sıklıklarında aynı zaman çizelgesinin aynı availability üretmesi;
- `UP/DOWN/UNKNOWN/PROVISIONAL` kırpımı ve bucket sınırları;
- bir FAIL→PASS provisional süresinin UP, FAIL→FAIL'in ilk FAIL'den DOWN çözülmesi;
- server gap, pause ve check oluşturulmadan önceki sürenin availability'yi düşürmemesi;
- open interval query-time overlay ve açık incident observed/wall duration ayrımı;
- config generation değişiminde aggregation ve UNKNOWN gap;
- average-of-average yapılmaması.

### 13.2 PostgreSQL ve yarışlar

- source cursor + range enqueue aynı transaction ve crash replay;
- uzun finalized interval'ın bounded range progress'i;
- iki worker'ın aynı range/partition üzerinde yakınsaması;
- minute correction'ın hour düzeltmesini uyandırması;
- restart sonrası cursor/range devamı;
- run evidence migration/backfill ve raw partition detach sırasında incident/current-state/open-health/finalized-health FK bütünlüğü;
- terminal job/attempt purge sonrası raw run trace locator'larının korunması;
- DEFAULT guard ve üç aylık future partition horizon;
- retention grace/manifest idempotency;
- RLS cross-owner history/incident/rollup gizleme.

### 13.3 API

- day/week/month exact `to`, bucket sayısı ve eksiksiz sıra;
- no-data `null` availability + düşük coverage;
- incident cursor filter-binding/tamper ve group-at-open filtresi;
- deleted check tombstone history erişimi;
- projection lag durumunda bounded 503, dashboard'un etkilenmemesi;
- response/log negatif hassas veri testi.

### 13.4 Kapasite

- 20/200/500 check rollup throughput profili;
- 500-check eşdeğer 35 günlük distribution üzerinde ay sorgusu;
- API ile housekeeper aynı anda çalışırken API pool/latency izolasyonu;
- partition pruning ve maksimum 360 bucket kanıtı.

## 14. Uygulama Dilimleri

1. **Revision 21 + saf aggregation — tamamlandı (17:44):** run evidence ve FK/retention düzeltmesi, checkpoint/range/manifest şeması, duration/bucket domain fonksiyonları ve migration güvenlik testleri.
2. **Housekeeping runtime — tamamlandı (17:52):** source discovery, bounded minute/hour recompute, partition/default guard, retention/purge loop'ları, readiness ve restart/iki-replica testleri.
3. **Private API — tamamlandı (18:29):** canonical OpenAPI history/incident sözleşmesi, owner-scoped service/routes, tombstone erişimi, filter-bound cursor, bounded raw-tail overlay ve projection-lag davranışı.
4. **Kapanış kanıtı:** correctness matrisi, 20/200/500 rollup profili, 35 günlük history capacity/plan raporu, full CI ve durum belgeleri.

Her dilim ayrı küçük commit olur. Revision 21–26 mevcut migration dosyalarını değiştirmeden forward-only uygulandı. Revision 26 API'ye housekeeping tablolarında doğrudan SELECT vermeden owner-scoped projection durumu döndüren dar `security_api.history_projection_status` sınırını ekledi. Source scan horizon gecikmesi veya pending rebuild backlog'u varken retention fail-closed ertelenir. Retention, önce detach+manifest kaydı oluşturur; fiziksel drop ancak 24 saatlik geri dönüş grace süresi dolduğunda ayrı bir turda gerçekleşir.

## 15. Bilinçli Olarak Kapsam Dışında

- kullanıcı tanımlı keyfi tarih aralığı ve timezone-aligned takvim raporları;
- percentile histogram/t-digest ve SLA sözleşme yönetimi;
- recurring maintenance'in availability'den çıkarılması;
- public history/incident projection'ı;
- cold object-storage archive ve analytics warehouse;
- legal-hold kullanıcı arayüzü;
- cross-region rollup replikasyonu.

Bu maddeler mevcut veri modeline sahte alanlarla eklenmez. Ürün ihtiyacı doğduğunda ayrı sözleşme, migration ve kapasite kararı gerekir.
