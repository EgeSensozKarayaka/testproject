# Monitor Worker Kapasite Raporu

**Aşama:** 9 — Kalıcı Scheduler ve Monitor Worker  
**Ölçüm tarihi:** 2026-10-10 15:11 +06:00  
**Durum:** 20/200/500 runtime profili geçti

## 1. Amaç

Bu rapor sabit 50-check varsayımı yapmadan aynı production scheduler, PostgreSQL queue, claim/lease/fencing, bounded dispatcher ve atomik observation persistence yolunun 20, 200 ve 500 due check altında davranışını ölçer.

Sonuçlar production SLO veya donanım bağımsız kapasite garantisi değildir. Aynı veri yolundaki correctness invariant'larını ve çok geniş tutulmuş fail-safe regresyon bütçelerini koruyan, tekrar çalıştırılabilir yerel bir başlangıç baseline'ıdır.

## 2. Tekrarlama

PostgreSQL container'ı çalışırken PowerShell'de:

```powershell
$env:DATABASE_TEST_ADMIN_URL = 'postgresql://site_monitor:local_dev_only_change_me@127.0.0.1:15432/postgres'
pnpm test:capacity
Remove-Item Env:DATABASE_TEST_ADMIN_URL
```

Test her koşuda ayrı bir veritabanı oluşturur, revision 1–14 migration'larını uygular, üç profili aynı production adapter'larıyla çalıştırır ve veritabanını kontrollü biçimde kaldırır. Her profil `MONITOR_CAPACITY` önekiyle makine tarafından okunabilir tek satır JSON üretir. Aynı test normal `pnpm test:integration` ve `pnpm run ci` kapılarına da dahildir.

## 3. Ölçüm Ortamı

| Bileşen          | Değer                               |
| ---------------- | ----------------------------------- |
| İşletim sistemi  | Windows `10.0.26200`                |
| CPU              | AMD Ryzen 7 7735HS, 16 logical CPU  |
| Bellek           | 15.2 GiB                            |
| Node.js          | 24.19.0                             |
| pnpm             | 11.25.0                             |
| Docker           | client/server 29.8.2, Compose 5.5.1 |
| PostgreSQL       | 18.6, Docker container              |
| DB pool          | Monitor rolüyle en fazla 8 bağlantı |
| Worker limitleri | global 64, owner 32, hostname 4     |

Bu host aynı zamanda geliştirme araçlarını ve Docker Desktop'ı çalıştırdığı için sonuçlar adanmış benchmark makinesi ölçümü değildir.

## 4. Fixture ve Yöntem

- Profiller sırasıyla 20/2 owner, 200/4 owner ve 500/8 owner kullanır.
- Bütün check'ler 30 saniyelik cadence'de aynı anda due başlar.
- Target URL'leri 128 hostname'e deterministik dağıtılır; owner-fair ilk claim turunda bütün owner'ların temsil edildiği doğrulanır.
- Scheduler 64'lük bounded batch'lerle bütün due check'leri materialize eder.
- Dispatcher production değerleri olan 128 candidate batch, 64 global, 32 owner ve 4 hostname limitlerini kullanır.
- Dış DNS/TCP/TLS değişkenliğini scheduler/persistence ölçümünden ayırmak için probe portunda deterministik sonuç kullanılır: hedeflerin yaklaşık %10'u 50 ms, kalanı 5 ms sonra `PASS/200` döner.
- Job claim, lease, attempt, state transition, immutable run, health interval, audit ve result pointer işlemleri gerçek PostgreSQL ve production `PostgresJobQueue`/`PostgresObservationStore` kodudur.
- Henüz consumer'ı bulunmayan mevcut Aşama 9 deployment durumuna uygun olarak downstream destination activation yoktur; activation-aware outbox çağrısı çalışır fakat dispatch backlog'u oluşturmaz.
- Aşama 7'nin gerçek socket testi ayrıca bir hanging hedef varken 50 hızlı probe'un tamamının `PASS` olmasını doğrular. Bu rapor o ağ katmanı kanıtını tekrar ölçmez.

## 5. Sonuçlar

| Check | Owner |  Scheduler | Dispatch + persist |  Uçtan uca | Uçtan uca throughput | Claim lag p95 | Execution/persist p95 | Peak active | Peak DB busy |      CPU |  Peak RSS |
| ----: | ----: | ---------: | -----------------: | ---------: | -------------------: | ------------: | --------------------: | ----------: | -----------: | -------: | --------: |
|    20 |     2 |   214.6 ms |           265.6 ms |   480.2 ms |              41.65/s |      199.8 ms |               62.6 ms |           7 |            8 |   250 ms | 105.7 MiB |
|   200 |     4 | 1,864.2 ms |         1,707.2 ms | 3,571.4 ms |              56.00/s |    1,843.8 ms |               60.1 ms |           6 |            7 | 1,360 ms | 127.0 MiB |
|   500 |     8 | 4,595.1 ms |         4,138.0 ms | 8,733.1 ms |              57.25/s |    4,554.0 ms |               60.2 ms |           6 |            7 | 3,078 ms | 139.4 MiB |

Her profilde:

- materialized, claimed, completed ve accepted run sayısı fixture sayısına tam eşit kaldı;
- `PENDING/LEASED/RUNNING` job sayısı test sonunda sıfırdı;
- global 64 ve pool 8 sınırı aşılmadı;
- ilk owner-fair claim diliminde her owner en az bir kez temsil edildi;
- herhangi bir duplicate run veya kayıp result oluşmadı.

500 check'in 30 saniyede bir due olduğu en yoğun fixture ortalama en az `16.67 check/s` ister. Ölçülen uçtan uca `57.25 check/s` bunun yaklaşık 3.4 katıdır; bütün burst 8.74 saniyede boşaldı ve p95 claim lag 4.56 saniyede kaldı. Bu sonuç yalnız belirtilen ortam ve deterministik probe dağılımı için geçerlidir.

## 6. Otomatik Regresyon Kapısı

CI ortam farklarından dolayı gözlenen sayılar dar eşik olarak sabitlenmez. Test aşağıdaki gevşek emniyet sınırlarını korur:

- scheduler `< 60 saniye`;
- dispatch/persistence `< 90 saniye`;
- toplam `< 120 saniye`;
- uçtan uca ve dispatch throughput `> 1 check/s`;
- active probe `<= 64`, busy DB connection `<= 8`;
- bütün job/run sayıları eksiksiz, accepted ve terminal;
- owner-fair ilk claim kümesi eksiksiz.

Bu bütçeler performans hedefi değil, runaway query, unbounded concurrency, deadlock ve belirgin algoritmik regresyon alarmıdır. Daha sıkı p95/SLO eşikleri production instance sınıfı ve gözlemlenebilirlik altyapısı belirlendiğinde Aşama 17–18'de tanımlanacaktır.

## 7. Bulgular ve Sonraki Kanıt

- Scheduler ve persistence maliyeti profile yaklaşık doğrusal büyüdü; 500 check'te 30 saniyelik cadence bütçesinin altında kaldı.
- Gözlenen peak active probe 6–7 oldu. Bu fixture'da sequential fenced claim ve sekiz bağlantılık DB pool global 64 sınırından önce doğal backpressure oluşturdu; limiti yükseltmek için ölçülmüş gerekçe yoktur.
- RSS mutlak process değeridir ve Vitest/module yükünü içerir; yalnız fixture'ın heap delta'sı olarak yorumlanmamalıdır.
- Dış internet, gerçek DNS/TLS, timeout/FAIL ağırlıklı incident üretimi, aktive downstream outbox yükü, process kill/lease reclaim, iki gerçek worker process'i ve eşzamanlı API yükü bu raporun kapsamında değildir.
- Aşama 9'un sonraki kanıtı process-kill/lease recovery ve stale/zombie result fencing'dir; ardından worker yükü altında API izolasyonu ile aşama kapanacaktır.
