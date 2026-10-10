# History ve Housekeeping Kapasite Raporu

**Aşama:** 12 — Geçmiş, Rollup, Availability ve Housekeeping  
**Ölçüm tarihi:** 2026-10-10 19:02 +06:00  
**Durum:** 20/200/500 rollup, 35 günlük ay sorgusu ve API izolasyonu geçti

## 1. Amaç

Bu rapor history veri yolunun sabit 50-check varsayımı olmadan aşağıdaki kapanış koşullarını karşıladığını kanıtlar:

- 20, 200 ve 500 check için source discovery ile minute→hour rollup'ın bounded ilerlemesi;
- 500 check'in 30 saniyelik cadence ile 35 günlük dağılımına eşdeğer veride ay görünümünün hızlı açılması;
- ay sorgusunda partition pruning, indeks kullanımı ve en fazla 360 output bucket;
- housekeeper yükünün ayrı pool üzerinden private history API'yi bloke etmemesi.

Sonuçlar production SLO veya donanımdan bağımsız kapasite garantisi değildir. Gerçek production kod yollarını ve geniş fail-safe regresyon bütçelerini kullanan, tekrarlanabilir yerel bir baseline'dır.

## 2. Tekrarlama

PostgreSQL container'ı çalışırken PowerShell'de:

```powershell
$env:DATABASE_TEST_ADMIN_URL = 'postgresql://site_monitor:local_dev_only_change_me@127.0.0.1:15432/postgres'
pnpm test:history-capacity
Remove-Item Env:DATABASE_TEST_ADMIN_URL
```

Test her koşuda ayrı bir veritabanı oluşturur, bütün migration'ları sıfırdan uygular, dört kabul senaryosunu çalıştırır ve veritabanını kaldırır. `HISTORY_ROLLUP_CAPACITY`, `HISTORY_MONTH_CAPACITY`, `HISTORY_API_ISOLATION` ve `HISTORY_CAPACITY_HOST` önekleriyle makine tarafından okunabilir JSON üretir.

Bu ağır profil normal `pnpm run ci` içinde çalışmaz. Normal CI küçük correctness fixture'larını çalıştırır; 420.000 rollup satırlık kapasite profili açık komutla tekrarlanır.

## 3. Ölçüm Ortamı

| Bileşen             | Değer                              |
| ------------------- | ---------------------------------- |
| İşletim sistemi     | Windows `10.0.26200`               |
| CPU                 | AMD Ryzen 7 7735HS, 16 logical CPU |
| Bellek              | 15.2 GiB                           |
| Node.js             | 24.19.0                            |
| PostgreSQL          | 18.6, Docker container             |
| API DB pool         | En fazla 4 bağlantı                |
| Housekeeper DB pool | En fazla 2 bağlantı                |
| Host fingerprint    | `d18f67f2ee14e71b`                 |

Makine aynı anda geliştirme araçlarını ve Docker Desktop'ı çalıştırmaktadır. Serbest bellek ölçüm sonunda yaklaşık 2,13 GiB idi.

## 4. Rollup Profili

Her check için production şemasında gerçek job, attempt, accepted run ve bir dakikalık finalized `UP` interval oluşturulur. Production `HousekeepingStore` dar `security_api` fonksiyonlarıyla source cursor'larını ilerletir; minute bucket'ları raw kaynaktan, hour bucket'ları minute rollup'tan yeniden hesaplanır.

İki source fingerprint'i aynı check/minute bucket'ını ayrı ayrı yeniden hesaplayabildiği için minute ve hour işlenen bucket sayısı check sayısının iki katıdır. Bu, idempotent source-of-truth recompute tasarımının beklenen maliyetidir.

| Check |   Fixture | Discovery | Minute projection | Hour projection | Toplam projection |    Throughput |
| ----: | --------: | --------: | ----------------: | --------------: | ----------------: | ------------: |
|    20 |  42,68 ms |  23,66 ms |         192,26 ms |       182,69 ms |         398,61 ms | 50,17 check/s |
|   200 |  80,81 ms |  23,97 ms |       1.876,26 ms |     1.710,47 ms |       3.610,70 ms | 55,39 check/s |
|   500 | 184,80 ms |  83,38 ms |       4.899,71 ms |     4.557,76 ms |       9.540,85 ms | 52,41 check/s |

Her profilde run ve interval source sayısı check sayısına, enqueue edilen range sayısı ve her çözünürlükte işlenen bucket sayısı `2 × check` değerine tam eşittir. Sonuçta check başına tek minute ve tek hour rollup satırı kalır. İki bağlantılık housekeeper pool sınırı aşılmadı.

Otomatik kapı toplam projection süresini 120 saniyenin altında ve throughput'u 1 check/s üzerinde tutar. Bu eşikler SLO değil; deadlock, runaway query ve belirgin algoritmik regresyon alarmıdır.

## 5. 35 Günlük Ay Sorgusu

30 saniyelik cadence'de 500 check × 35 gün, **50.400.000 ham örneğe** eşdeğerdir. API'nin ay görünümü ham örnek okumadığı için fixture aynı dağılımı 120 örnek/saat taşıyan **420.000 `rollups_hour` satırı** olarak üretir. Böylece production sorgu kardinalitesi ve indeks dağılımı korunurken test için anlamsız 50 milyon raw insert maliyeti oluşturulmaz.

| Ölçüm                              |               Sonuç |
| ---------------------------------- | ------------------: |
| Dataset oluşturma + `ANALYZE`      |        16.690,11 ms |
| `EXPLAIN (ANALYZE, BUFFERS)`       |            4,568 ms |
| `HistoryService.getHistory(month)` |            25,32 ms |
| Output bucket                      |                 360 |
| Okunan partition                   | `rollups_hour_2026` |
| Partition sayısı                   |                   1 |
| İndeksli plan                      |                Evet |
| DEFAULT partition                  |            Okunmadı |

Plan owner/check/time indeksli erişim kullandı ve sorgu penceresi dışındaki yıl/default partition'larını plana taşımadı. API sorgusu iki saatlik bounded raw tail'i aynı read-only `REPEATABLE READ` transaction içinde birleştirdi. Otomatik bütçe hem planı hem uçtan uca servis sorgusunu 2 saniyenin altında, response'u 360 bucket ile sınırlı tutar.

## 6. API–Housekeeper İzolasyonu

Ay sorgusunun hedef check'i dışında 64 check için birer 60 dakikalık repair range'i oluşturuldu. Housekeeper ayrı iki bağlantılık pool ile toplam 3.840 minute bucket işlerken, ayrı dört bağlantılık API pool'undan aynı ay görünümü 40 kez istendi.

| API ölçümü      |    Sonuç | Regresyon bütçesi |
| --------------- | -------: | ----------------: |
| Boş-yük p95     | 17,79 ms |                 — |
| Yük altında p95 | 15,20 ms |        < 1.500 ms |
| Yük altında max | 15,59 ms |        < 3.000 ms |
| Başarılı örnek  |       40 |             40/40 |

API ve housekeeper pool limitleri aşılmadı. Ölçüm, aynı PostgreSQL üzerinde bounded housekeeper işi sürerken private history sorgusunun ilerlediğini kanıtlar; ayrı fiziksel database cluster veya production connection proxy izolasyonu iddia etmez.

## 7. Bulgular ve Sınırlar

- 20→200→500 profili yaklaşık doğrusal büyüdü; 500 check projection'ı 10 saniyenin altında kaldı.
- Ay görünümü 420.000 satırlık dağılımda tek check'e ait yaklaşık 30 günlük hour satırlarını indeks ve partition pruning ile okudu; raw 30 günlük `check_runs` taraması oluşmadı.
- Housekeeper'ın minute ve hour lane advisory lock'ları doğruluğu sadeleştirir; aynı çözünürlükte replica sayısıyla doğrusal throughput hedeflenmez. Ölçülen 52,41 check/s bu v1 kapsamı için ek sharding gerektirmediğini gösterir.
- Büyük fixture pre-aggregated eşdeğer dağılımdır; 50,4 milyon ham run'ın ingest/storage benchmark'ı değildir. Raw ingest kapasitesi monitor worker raporunda ayrı ölçülür.
- Sonuç tek geliştirme makinesi, tek PostgreSQL container'ı ve sıcak yerel ağ içindir. Çok-node PostgreSQL, disk baskısı, backup, failover ve bölgesel ağ koşulları Aşama 17–18 kapsamındadır.
