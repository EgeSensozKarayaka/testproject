# Veritabanı Operasyon, Sorgu ve Süreklilik Planı

**Durum:** İnceleme bekleyen Aşama 3 tasarımı  
**Bağlı belgeler:** [`DATABASE.md`](./DATABASE.md), [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md), [`DATABASE_SECURITY.md`](./DATABASE_SECURITY.md)

## 1. Operasyon Hedefleri

- Dashboard sorguları raw run geçmişine dokunmadan çalışır.
- Bir yavaş hedef diğer check'lerin claim/probe akışını bloke etmez.
- Aynı check kendisiyle paralel çalışmaz; lease kaybı stale write üretmez.
- 24 saat, 7 gün ve 30 gün geçmiş sorguları sabit sayıda partition ve bounded satır tarar.
- Migration deployment'tan bağımsız, tek instance ve kilitli çalışır.
- Yedekleme RLS nedeniyle eksik veri üretmez; restore düzenli olarak kanıtlanır.
- Partition/rollup gecikmesi görünürdür ve veri kaybı olmadan tekrar işlenebilir.

## 2. Kritik Sorgular ve İndeks Planı

İndeksler migration'da isimli ve sorgu gerekçesiyle eklenir. Her indeksin gerçek kullanımı `pg_stat_user_indexes`, boyutu ve write maliyeti izlenir; “ileride lazım olur” indeksleri eklenmez.

### 2.1 Ana indeks matrisi

| Sorgu/Invariant               | Tablo                      | İndeks/constraint                                                                                     |
| ----------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Login lookup                  | `auth.users`               | unique B-tree `(email_normalized)`                                                                    |
| Session exact digest          | `auth.sessions`            | unique B-tree `(token_digest)`; cleanup `(expires_at)`                                                |
| User check listesi            | `app.checks`               | `(owner_id, lifecycle_state, created_at DESC, id)` INCLUDE `(name,group_id,execution_state)`          |
| Group check listesi           | `app.checks`               | `(owner_id, group_id, lifecycle_state, id)`                                                           |
| Scheduler due scan            | `app.checks`               | partial `(next_run_at,id)` WHERE LIVE+ACTIVE                                                          |
| Pending manual reconciliation | `app.checks`               | partial `(manual_requested_at,id)` WHERE non-null and LIVE                                            |
| Composite ownership           | Her tenant parent          | unique `(owner_id,id)`                                                                                |
| Dashboard state join          | `check_current_states`     | PK `(check_id)`, unique `(owner_id,check_id)`; `(owner_id,health_state,updated_at DESC)`              |
| Job claim                     | `check_jobs`               | partial `(available_at,priority DESC,created_at,id)` WHERE `PENDING`                                  |
| Lease recovery                | `check_jobs`               | partial `(lease_expires_at,id)` WHERE `LEASED/RUNNING`                                                |
| Tek aktif job                 | `check_jobs`               | unique partial `(check_id)` WHERE `PENDING/LEASED/RUNNING`                                            |
| Job geçmişi                   | `check_jobs`               | `(owner_id,check_id,created_at DESC,id)`                                                              |
| Attempt sırası                | `check_job_attempts`       | unique `(job_id,attempt_number)` ve `(job_id,fencing_token)`                                          |
| Run history                   | Her run partition          | `(owner_id,check_id,finished_at DESC,id)` INCLUDE `(outcome,total_ms,status_code,accepted_for_state)` |
| Rollup source scan            | Her run partition          | partial `(finished_at,check_id)` WHERE `accepted_for_state`                                           |
| Partition zaman taraması      | Büyük partition            | BRIN `(finished_at)` yalnız boyut/plan kanıtı faydalıysa                                              |
| Tek açık incident             | `incidents`                | unique partial `(check_id)` WHERE `status='OPEN'`                                                     |
| Incident journal              | `incidents`                | `(owner_id,check_id,started_at DESC,id)` ve `(owner_id,status,started_at DESC)`                       |
| Tek açık segment              | `incident_segments`        | unique partial `(incident_id)` WHERE `ended_at IS NULL`                                               |
| Incident segmentleri          | `incident_segments`        | `(owner_id,incident_id,started_at,id)`                                                                |
| Aktif maintenance             | `maintenance_windows`      | partial `(owner_id,check_id,starts_at,ends_at)` ve group eşleniği WHERE SCHEDULED                     |
| Maintenance sona erme         | `maintenance_windows`      | partial `(ends_at,id)` WHERE SCHEDULED                                                                |
| Recipient lookup              | `recipients`               | unique `(owner_id,email_normalized)`                                                                  |
| Policy scope                  | `policies`                 | unique NULLS NOT DISTINCT `(owner_id,group_id)`                                                       |
| Intent evaluation             | `notification.intents`     | partial `(maintenance_until,created_at,id)` WHERE pending/deferred                                    |
| Intent idempotency            | `notification.intents`     | unique `(incident_id,event_kind)`                                                                     |
| Delivery claim                | `notification.deliveries`  | partial `(available_at,id)` WHERE pending/retry; lease expiry eşleniği                                |
| Delivery idempotency          | `notification.deliveries`  | unique `(incident_id,event_kind,recipient_id)`                                                        |
| Outbox claim                  | `outbox_dispatches`        | partial `(available_at,event_id,destination)` WHERE pending/retry                                     |
| Public lookup                 | `public_status.snapshots`  | unique `(slug_digest)`                                                                                |
| Component sırası              | `public_status.components` | unique `(page_id,position)` + check/group partial unique                                              |
| History rollup                | Rollup partition           | PK `(bucket_start,check_id,probe_generation)` + `(owner_id,check_id,bucket_start)`                    |
| Prediction claim              | `analysis_jobs`            | active partial unique `(check_id)` + pending `(available_at,id)`                                      |
| Latest score                  | Score partition            | `(owner_id,check_id,computed_at DESC,id)`                                                             |
| Audit listesi                 | Audit partition            | `(owner_id,occurred_at DESC,id)`                                                                      |

Foreign key kolonları, cascade/parent mutation sorguları gerçek kullanım gösteriyorsa ayrıca indekslenir. PostgreSQL foreign key için child index'i otomatik oluşturmadığından migration review bunu açıkça kontrol eder.

### 2.2 Scheduler claim akışı

Scheduler kısa bir transaction'da due check'leri bounded batch ile `FOR UPDATE SKIP LOCKED` seçer. Her seçilen check için:

1. Aktif job olup olmadığını unique invariant ile doğrular.
2. Config/version snapshot'ı ile job ekler.
3. `next_run_at` değerini `cadence_anchor_at + k * interval` formülüyle ileri alır; `now + interval` kullanıp drift üretmez.
4. Kaçırılmış aralıklar için backfill job oluşturmaz; sıradaki gelecekteki cadence slot'una sıçrar.
5. Transaction'ı kapatır; HTTP çağrısı hiçbir DB transaction/kilidi açıkken yapılmaz.

Owner adaleti tek global FIFO'ya bırakılmaz. Batch seçimi owner başına sınırlı aday veya round-robin ordering uygular; tek büyük owner küçük owner'ları sonsuza dek bekletemez. Bu algoritma Aşama 7 scheduler uygulamasında load test ile kesinleştirilir, fakat gerekli indeks yukarıdaki due scan indeksidir.

Worker job claim'de job satırını kilitler, check üzerindeki `next_fencing_token` değerini atomik artırıp önceki değeri attempt'a verir, lease ve attempt'ı aynı transaction'da yazar. Ağ çağrısı transaction dışında yapılır. Sonuç kabulü yeniden kısa transaction açar ve job/attempt/check/current-state satırlarını belirli sırayla kilitler.

### 2.3 Kilit sırası

Deadlock riskini azaltmak için bütün command'lar mümkün olduğunda şu sırayı izler:

1. `auth.users` (yalnız account lifecycle)
2. Aggregate root: check/group/page/policy/incident/intent
3. Current/projection satırı
4. Child/history satırları
5. Outbox/audit

Birden çok check kilitlenecekse UUID artan sırada alınır. External HTTP, SMTP, prediction veya SSE yayını transaction içinde yapılmaz.

### 2.4 Dashboard sorgusu

Dashboard yalnız live check, group ve current-state satırlarını join eder. Effective freshness sorguda:

- execution PAUSED veya lifecycle DELETED ise ürün sözleşmesine göre ayrı gösterim,
- `fresh_until <= statement_timestamp()` ise `STALE/UNKNOWN`,
- aksi halde projection değeri

olarak hesaplanır. Böylece reconciler birkaç saniye gecikse bile UI yanlış UP göstermez. Group genel durumu check current state'lerinin öncelik sırasıyla (`DOWN > SUSPECT > UNKNOWN > UP`) bounded aggregate'ıdır; v1'de ayrı kalıcı group-state tablosu yoktur. Ölçümle sorun görülürse rebuild edilebilir projection eklenir.

### 2.5 History sorgusu

| Aralık        | Ana kaynak                             | Grafik çözünürlüğü |
| ------------- | -------------------------------------- | ------------------ |
| Son 24 saat   | Minute rollup                          | 1–5 dakika         |
| Son 7 gün     | Minute rollup'tan API bucket aggregate | 15–60 dakika       |
| Son 30/31 gün | Hour rollup                            | 1–6 saat           |

İstek `owner_id + check_id + [from,to)` ile kesin sınırlanır. Partition pruning için `bucket_start` koşulu zorunludur. İlk/son kısmi bucket doğrudan finalized health interval/minute verisiyle kırpılır; tam bucket'lar rollup'tan gelir. Açık health interval `min(now,to)` noktasına kadar query-time eklenir.

Response-time grafiği yalnız accepted run örneklerini kullanır. Gösterilen average `response_sum_ms / response_sample_count`; min/max aynı bucket'tadır. Rejected/diagnostic run'lar ayrı teknik detay akışında gösterilebilir, ana SLA serisini etkilemez.

Availability ve coverage ayrı döner:

```text
availability = up_ms / (up_ms + down_ms)
coverage     = (up_ms + down_ms) / requested_window_ms
```

Payda sıfırsa availability `null` olur; `0%` değildir. UNKNOWN ve henüz finalize edilmemiş provisional süre grafikte gap/no-data olarak kalır.

## 3. Partition Planı

### 3.1 Partition matrisi

| Parent                        | Anahtar        | Aralık | Varsayılan retention              |
| ----------------------------- | -------------- | ------ | --------------------------------- |
| `monitoring.check_runs`       | `finished_at`  | Aylık  | 90 gün raw                        |
| `monitoring.health_intervals` | `started_at`   | Aylık  | 400 gün                           |
| `monitoring.rollups_minute`   | `bucket_start` | Aylık  | 35 gün                            |
| `monitoring.rollups_hour`     | `bucket_start` | Yıllık | 400 gün                           |
| `prediction.scores`           | `computed_at`  | Aylık  | 90 gün                            |
| `audit.events`                | `occurred_at`  | Aylık  | 400 gün, politika ile değişebilir |

Partition adları UTC sınırını açık taşır: örneğin `check_runs_2026_10`. Parent table sorguları kullanılır; uygulama partition adını üretmez.

### 3.2 Partition yaşam döngüsü

- Migration mevcut ay, önceki retention aralığı ve sonraki üç ay partition'larını oluşturur.
- Housekeeper günlük olarak en az üç gelecek aylık partition bulunduğunu doğrular ve eksikleri controlled procedure ile oluşturur.
- Her parent için bir DEFAULT partition güvenlik ağı bulunur; normal durumda sıfır satır olmalıdır.
- DEFAULT'a satır düşmesi alert üretir. Housekeeper hedef partition'ı oluşturup bounded batch ile satırları taşır; bu partition kalıcı depo değildir.
- Retention dolan partition önce detach edilir, manifest/sayım kaydı alınır, grace süresi sonrası drop edilir.
- Legal hold bu ürün kapsamında varsayılan değildir; gerekirse partition drop politikasını durduran açık deployment ayarı eklenir.

PostgreSQL unique/primary constraint'in partition anahtarını içermesi zorunluluğu nedeniyle tenant'a ait partitioned history PK'leri owner+zaman+id biçimindedir. Run referansları aynı üçlüyü taşır. Bu trade-off hem partition hem sahiplik referans bütünlüğü lehine kabul edilmiştir.

### 3.3 Partition oluşturma ve indeksler

Yeni boş partition DDL'si kısa lock timeout ile oluşturulur. Büyük mevcut partition'a yeni indeks gerekiyorsa:

1. Parent üzerinde uygun partitioned index shell hazırlanır.
2. Child indeksleri `CREATE INDEX CONCURRENTLY` ile tek tek oluşturulur.
3. Child indeksler parent index'e attach edilir.
4. Geçerlilik ve query planı doğrulanır.

Migration, varsayılan `lock_timeout=5s` ile fail-fast davranır; lock bekleyerek trafiği belirsiz süre durdurmaz. Operasyon migration'ı ayrı runbook ve ölçüm gerektirir.

## 4. Rollup Mimarisi

### 4.1 Kaynaklar

- Latency ve run sayıları: `check_runs WHERE accepted_for_state=true`
- Availability/coverage süreleri: finalized `health_intervals`
- Açık/current aralık: history query anında eklenir; kapanmadan kalıcı rollup'a kesin yazılmaz

Rollup worker ana probe worker'dan bağımsızdır. Gecikmesi monitoring doğruluğunu bozmaz; yalnız history freshness'i düşer ve görünür telemetry üretir.

### 4.2 Idempotent hesaplama

- Minute processor yalnız watermark'tan önce kesinleşmiş bucket'ları işler; örneğin current minute ve küçük lateness penceresi açık bırakılır.
- Aynı bucket tekrar hesaplanabilir; source'tan deterministik aggregate alınıp `INSERT ... ON CONFLICT ... DO UPDATE` ile revision artırılır.
- Hour rollup finalized minute bucket'lardan türetilir.
- Late/reconciled interval bir önceki bucket'ı etkilerse bounded correction queue o bucket'ı tekrar hesaplatır.
- Checkpoint yalnız ilgili bucket transaction'ı başarılı olduktan sonra ilerler.
- Rebuild komutu owner/check/time aralığıyla sınırlı ve resumable olur.

### 4.3 Hız hedefi ve kanıt

Referans dataset: en az 500 check'in 30 saniyelik 35 günlük çalışmasına eşdeğer sentetik raw/rollup dağılımı. CI'da küçük correctness fixture, ayrı performance profilinde büyük dataset kullanılır.

Hedefler warmed reference environment için:

- Bir check'in 30 günlük history API DB sorgusu p95 < 500 ms
- API serialization dahil endpoint p95 < 2 saniye
- Dashboard liste sorgusu p95 < 300 ms

Bunlar production SLO sözü değil, acceptance/performance regression bütçesidir. `EXPLAIN (ANALYZE, BUFFERS)` planları kişisel veri içermeyen fixture ile saklanır. Plan partition pruning göstermeli; raw 30 günlük run scan'i kabul edilmez.

## 5. Retention ve Purge

Varsayılanlar deployment config ile uzatılabilir; minimum ürün gereksinimi olan bir aylık history korunur.

| Veri                         |     Varsayılan saklama | Temizleme biçimi                         |
| ---------------------------- | ---------------------: | ---------------------------------------- |
| Raw accepted/rejected runs   |                 90 gün | Partition detach/drop                    |
| Finalized health intervals   |                400 gün | Partition detach/drop                    |
| Minute rollup                |                 35 gün | Partition detach/drop                    |
| Hour rollup                  |                400 gün | Partition detach/drop                    |
| Completed jobs/attempts      |                 30 gün | Bounded batch delete                     |
| Open jobs                    |   Terminal olana kadar | Retention uygulanmaz                     |
| Incident ve segment          |                400 gün | Bounded owner/check batch                |
| Notification intent/delivery |                400 gün | Bounded batch; audit gereksinimine bağlı |
| Completed outbox/dispatch    |                 30 gün | Bounded batch                            |
| Dead outbox/dispatch         |  Operatör çözene kadar | Otomatik silinmez                        |
| Session/one-time token       | Expiry/revoke + 30 gün | Bounded batch                            |
| Public snapshot              |         Yalnız current | Transactional replace/delete             |
| Prediction score             |                 90 gün | Partition detach/drop                    |
| Audit event                  |                400 gün | Partition; deployment policy override    |

Purge küçük batch, statement timeout ve progress checkpoint kullanır. Vacuum baskısı izlenir. Partition drop mümkün olan yerde row delete'e tercih edilir. User deletion farklı owner'ların paylaştığı partition'ı drop edemeyeceği için `(owner_id, time, id)` indeksli bounded delete kullanır; tamamlanana kadar tombstone owner korunur.

Retention değişimi geçmişte zaten silinmiş veriyi geri getirmez. UI/API, kullanılabilir tarih sınırını döndürür.

## 6. Migration Mimarisi

### 6.1 Dosya ve runner sözleşmesi

Migration'lar `database/migrations/` altında değişmez, sıralı SQL dosyalarıdır:

```text
000001_create_roles_and_schemas.sql
000002_create_auth_and_core.sql
000003_create_monitoring.sql
...
```

Repository-owned TypeScript runner `pg` ile:

1. Ayrı migrator connection açar.
2. PostgreSQL advisory lock alır; ikinci migrator fail/wait politikasına göre durur.
3. Ledger'daki uygulanmış dosya checksum'larını disk ile karşılaştırır; değişiklik varsa durur.
4. Pending migration'ı varsayılan olarak tek transaction'da uygular.
5. Ledger ve compatibility satırını yazar.
6. Lock'u bırakır ve bağlantıyı kapatır.

Transaction dışında çalışması zorunlu `CREATE INDEX CONCURRENTLY` gibi migration'lar açık metadata/header ile işaretlenir, idempotent precondition/postcondition taşır ve tek başına review edilir. Aynı dosyada transaction'lı DDL ile karıştırılmaz.

`db:migrate` production-safe ileri hareket komutudur. `db:reset` yalnız local/test database adını allowlist ile doğruladıktan sonra çalışır; production URL üzerinde kesinlikle çalışmaz. `db:seed` yalnız açık `APP_ENV=development|test` ve seed flag'iyle etkinleşir.

### 6.2 Forward-only ve expand/contract

Production rollback için genel `down` migration yoktur. Geri dönüş uygulama rollback'i veya yeni forward-fix migration'dır. Veri kaybeden contract migration öncesinde doğrulanmış backup/PITR noktası gerekir.

Şema değişimi sırası:

1. **Expand:** Nullable/yeni kolon, yeni tablo/index; eski app çalışmaya devam eder.
2. **Dual compatibility:** Uygulama gerekirse iki biçimi yazar/okur.
3. **Backfill:** Bounded, resumable job; migration transaction'ında milyonlarca row update edilmez.
4. **Verify:** Null/count/checksum ve shadow-read karşılaştırması.
5. **Switch:** Yeni app read path'i etkinleşir.
6. **Contract:** Eski fleet tamamen gittikten ayrı release/migration'da eski kolon/constraint kaldırılır.

Runtime build, desteklediği schema compatibility epoch/revision aralığını taşır. Readiness mevcut revision bu aralığın dışındaysa false döner; liveness true kalır. App startup migration çalıştırmaz.

### 6.3 SQL kuralları

- Her migration explicit schema-qualified ad kullanır.
- `lock_timeout` kısa; `statement_timeout` migration tipine göre bounded olur.
- Table rewrite/uzun ACCESS EXCLUSIVE lock riski migration review'da açıklanır.
- Yeni NOT NULL: önce nullable + backfill + `CHECK NOT VALID`/validate + NOT NULL şeklinde güvenli geçişle yapılır.
- Yeni FK büyük tabloda gerekirse `NOT VALID`, sonra online `VALIDATE CONSTRAINT` ile eklenir.
- Index tekrarı `pg_indexes` ve query workload ile kontrol edilir.
- Trigger yalnız gerçekten atomic DB invariant gerekiyorsa kullanılır; gizli business workflow trigger'a gömülmez.
- Migration dosyası main'e girdikten sonra değiştirilmez; düzeltme yeni dosyadır.

### 6.4 Seed ve fixture

Development seed:

- Deterministik kullanıcı/check/group/public page örnekleri
- UP, SUSPECT, DOWN, UNKNOWN ve maintenance senaryoları
- Incident/history/rollup örnekleri
- Mailpit'e uygun verified recipient
- Ham parola yerine belgelenmiş yalnız-local demo credential; production seed'de yok

Seed idempotent upsert veya sabit namespace kimlikleriyle tekrar çalışabilir. Test fixture'ı development seed'e bağımlı değildir; her test ihtiyacı kadar veriyi factory ile kurar.

## 7. Backup, PITR ve Restore

### 7.1 İlk production hedefleri

| Hedef           |                                             Değer | Not                                                      |
| --------------- | ------------------------------------------------: | -------------------------------------------------------- |
| RPO             |                                 En fazla 5 dakika | Managed WAL/PITR ile; deployment doğrulamalı             |
| RTO             |                                En fazla 60 dakika | Veri boyutu ve sağlayıcı restore süresiyle test edilmeli |
| PITR penceresi  |                                            14 gün | Yanlış migration/user error için                         |
| Günlük snapshot |                                            35 gün | Şifreli ve otomatik                                      |
| Restore drill   | En az üç ayda bir ve destructive migration öncesi | İzole environment                                        |

Bu değerler altyapı kurulmadan “sağlandı” sayılmaz; deployment acceptance sırasında sağlayıcı kanıtıyla doğrulanır. Local Compose production süreklilik çözümü değildir.

### 7.2 Backup yaklaşımı

- Production'da managed PostgreSQL automated snapshot + continuous WAL/PITR tercih edilir.
- Backup storage encryption-at-rest, TLS transfer ve ayrı erişim politikası kullanır.
- Backup credential'ı uygulama runtime'ından ayrıdır.
- Mantıksal `pg_dump` release/taşınabilirlik doğrulaması için ek katmandır; tek süreklilik çözümü değildir.
- `pg_dump` RLS yüzünden eksik satır almamalıdır. Yetkili backup rolü ve `row_security=off` fail-closed davranışı kullanılır; filtrelenmiş dump başarı kabul edilmez.
- Backup'larda secret digest ve PII bulunduğu için production verisi local geliştirmeye indirilmez. Test restore'u erişimi kısıtlı izole environment'ta yapılır veya onaylı anonymization sonrası kullanılır.

### 7.3 Restore runbook

1. Incident commander doğru restore timestamp/backup'ı belirler; yazma trafiğini durdurur veya yeni cluster'a yönlendirme planı hazırlar.
2. İzole yeni PostgreSQL 18 uyumlu instance'a snapshot/PITR restore edilir.
3. Extension, role, owner, RLS, function ve privilege'lar doğrulanır.
4. Migration ledger checksum ve schema compatibility kontrol edilir; otomatik olarak “latest” migration koşturulmaz.
5. Tablo/partition row count, FK/constraint, açık incident/job ve rollup watermark tutarlılık kontrolleri çalışır.
6. Cross-user RLS smoke, auth bootstrap, scheduler claim, history ve public snapshot testleri çalışır.
7. Uygulama önce read-only/canary bağlanır; sonra kontrollü trafik geçişi yapılır.
8. RPO veri boşluğu ölçülür. Eksik çalışma aralığı check FAIL olarak backfill edilmez; history'de UNKNOWN/gap kalır.
9. Sonuç, süreler ve farklar restore raporuna kaydedilir.

Restore başarısı yalnız database'in başlaması değildir; uygulama invariant ve güvenlik testlerinin geçmesidir.

## 8. Gözlemlenebilirlik ve Alarm Eşikleri

Database telemetry en az şunları kapsar:

- Connection kullanım oranı, pool wait p95/p99
- Transaction ve statement süresi; timeout/deadlock/lock wait sayısı
- Due check lag ve oldest pending job age
- Lease reclaim/stale result rejection sayısı
- Outbox/notification/prediction queue depth ve oldest age
- DEFAULT partition row sayısı
- Gelecek partition sayısı
- Minute/hour rollup watermark lag'i
- Autovacuum lag, dead tuples, table/index boyutu ve cache hit
- Replica/WAL/PITR gecikmesi (production)
- Backup son başarı ve restore drill yaşı
- RLS/permission denied sayısında anomali

Önerilen başlangıç alarmları deployment load test ile ayarlanır; sabit evrensel eşik kabul edilmez. Ancak DEFAULT partition'da satır, başarısız backup, migration checksum drift ve beklenmeyen schema revision her zaman actionable durumdur.

## 9. Test Stratejisi

### 9.1 Migration testleri

- Boş PostgreSQL 18.6 üzerinde zero-to-head migration
- Aynı head üzerinde ikinci çalıştırmanın no-op olması
- Değiştirilmiş uygulanmış dosyada checksum drift hatası
- İki eşzamanlı migrator'da advisory lock davranışı
- Unsupported schema revision'da readiness false
- Tüm constraint/index/policy/privilege snapshot kontrolü

### 9.2 Integration test database'i

CI PostgreSQL service container kullanır. Her suite/worker migration uygulanmış template'ten ayrı database oluşturur; transaction rollback yalnız test isolation çözümü olarak yeterli sayılmaz çünkü role/RLS/DDL de test edilir. Test sonunda yalnız doğrulanmış test database adı drop edilir.

### 9.3 Kritik concurrency testleri

- İki scheduler aynı due check'i tek job'a dönüştürür.
- İki worker aynı job'ı claim edemez.
- Lease kaybeden eski worker daha düşük fencing ile state yazamaz.
- Aktif job sırasında çoklu manual talepler tek takip işi olur.
- Pause/config/delete ile yarışan result history'ye kaydolsa da state'e uygulanmaz.
- Aynı ikinci FAIL yarışı tek incident açar.
- Maintenance bitişi ve recovery yarışı duplicate/yanlış e-posta üretmez.
- İki notifier aynı delivery'yi tek kez claim eder.
- Rollup aynı bucket'ı tekrar işlediğinde sayılar iki katına çıkmaz.

### 9.4 Query plan testleri

Performance fixture üzerinde:

- 30 günlük history partition pruning kullanır.
- Dashboard raw `check_runs` scan etmez.
- Due scheduler ve queue claim partial indeks kullanır.
- Maintenance lookup owner+target+time indeksini kullanır.
- Public lookup yalnız digest unique indeksine gider.

Planner değişkenliği nedeniyle CI her cost sayısını sabitlemez; kritik “seq scan across all partitions” ve eksik pruning desenlerini yakalar, periyodik benchmark gerçek latency bütçesini doğrular.

## 10. Uygulama Sırası — Onaydan Sonra

1. SQL migration runner, checksum ledger ve advisory lock
2. Roller, şemalar, default privilege ve security helpers
3. Auth/core tabloları ve RLS
4. Monitoring job/current/run/incident tabloları ve partition helper
5. Notification/outbox/public/prediction/audit tabloları
6. Rollup/retention/checkpoint altyapısı
7. Deterministik seed/factory
8. RLS, ownership, constraint, migration ve concurrency integration testleri
9. Backup/restore local rehearsal ve kanıt belgesi
10. Query plan/performance fixture doğrulaması

Bu sıra migration koduna başlanacak sonraki prompt içindir; mevcut tasarım turunda uygulanmaz.

## 11. PostgreSQL Referansları

- [Declarative partitioning ve kısıtları](https://www.postgresql.org/docs/18/ddl-partitioning.html)
- [Unique ve primary key constraint davranışı](https://www.postgresql.org/docs/18/ddl-constraints.html)
- [Online child index oluşturma/attach yaklaşımı](https://www.postgresql.org/docs/18/ddl-partitioning.html#DDL-PARTITIONING-DECLARATIVE-MAINTENANCE)
- [Row security ve backup uyarıları](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)
