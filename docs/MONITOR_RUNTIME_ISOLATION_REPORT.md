# Monitor Runtime ve API İzolasyon Raporu

**Aşama:** 9 — Kalıcı Scheduler ve Monitor Worker  
**Ölçüm tarihi:** 2026-10-10 15:34 +06:00  
**Durum:** İki-worker correctness ve worker yükü altında API izolasyonu geçti

## 1. Amaç

Bu rapor iki ayrı monitor-worker prosesinin aynı PostgreSQL job kuyruğunu birlikte ve tekrarsız tükettiğini; bu sırada ayrı API prosesinin readiness ve authenticated check-list isteklerine cevap vermeye devam ettiğini kanıtlar.

Bu bir production SLO veya donanımdan bağımsız kapasite garantisi değildir. Production giriş noktaları ve gerçek PostgreSQL üzerinde çalışan, geniş fail-safe latency bütçeleri içeren tekrarlanabilir bir yerel kabul/regresyon testidir.

## 2. Proses ve Kaynak Sınırları

Test aynı anda dört bağımsız çalışma yüzeyi açar:

| Yüzey     | Gerçek kod yolu                    | Kaynak sınırı                               |
| --------- | ---------------------------------- | ------------------------------------------- |
| API       | `apps/api/src/index.ts`            | Ayrı Node prosesi ve kendi API DB pool'u    |
| Monitor A | `apps/monitor-worker/src/index.ts` | Ayrı Node prosesi, en fazla 4 DB connection |
| Monitor B | `apps/monitor-worker/src/index.ts` | Ayrı Node prosesi, en fazla 4 DB connection |
| Hedef     | Gerçek localhost HTTP server       | Her isteğe 150 ms sonra `200`               |

İki worker için process-local sınırlar ayrı ayrı global 8, owner 4 ve hostname 4'tür. Dolayısıyla tek hedefte birleşik fiziksel concurrency üst sınırı 8'dir. API monitor pool'larını paylaşmaz.

## 3. Senaryo

1. Her koşu için ayrı veritabanı oluşturulur ve revision 1–14 migration'ları sıfırdan uygulanır.
2. Dört owner'a dengeli dağıtılmış 200 check, henüz due olmayacak biçimde eklenir. Owner'lardan biri için gerçek session kaydı hazırlanır.
3. API ve iki monitor-worker production entrypoint'leri aynı anda ayrı child process olarak başlatılır; üç readiness endpoint'inin de `200` olması beklenir.
4. API için beş sıcak/boş-yük readiness ve authenticated `GET /api/v1/checks?limit=100` örneği alınır.
5. Bütün check'ler tek SQL değişikliğiyle due yapılır. İki production scheduler/dispatcher aynı PostgreSQL kuyruğunu birlikte tüketirken API istekleri tekrar tekrar örneklenir.
6. Job/run/attempt lineage, worker dağılımı, hedef istek sayısı ve API latency dağılımı kalıcı veriden doğrulanır.
7. Servisler graceful `SIGTERM` ile kapatılır; takılı proses için yalnız test cleanup sınırında force-kill fallback'i vardır.

## 4. Correctness Sonucu

| Ölçüm                      | Sonuç |
| -------------------------- | ----: |
| Due check                  |   200 |
| Completed job              |   200 |
| Attempt                    |   200 |
| Run                        |   200 |
| State'e kabul edilen run   |   200 |
| Hedef HTTP isteği          |   200 |
| Distinct worker kimliği    |     2 |
| En yüksek attempt numarası |     1 |
| Test sonunda aktif job     |     0 |
| Peak hedef concurrency     |     8 |

İki worker da iş aldı. Aynı job iki kez claim edilmedi, retry gerekmedi, duplicate run oluşmadı ve process-local hostname limitlerinin birleşik deployment etkisi beklenen 8 sınırını aşmadı.

## 5. API İzolasyon Sonucu

Yük sırasında 40 authenticated list ve 40 readiness örneğinin tamamı `200` döndü. Her list yanıtı seçilen owner'ın 50 check'ini eksiksiz içerdi.

| API ölçümü                 | Boş-yük p95 | Worker yükü p95 | Worker yükü maksimum |            Regresyon bütçesi |
| -------------------------- | ----------: | --------------: | -------------------: | ---------------------------: |
| `/health/ready`            |     15.4 ms |         18.4 ms |              19.0 ms | p95 < 1000 ms, max < 3000 ms |
| `/api/v1/checks?limit=100` |     75.5 ms |         32.1 ms |              33.8 ms | p95 < 1500 ms, max < 3000 ms |

Beş örnekli baseline'ın ilk list isteği process/plan/cache ısınmasını içerdiğinden yüklü p95'ten yüksektir. Bu nedenle test bir slowdown oranını SLO olarak kullanmaz; bütün yanıtların doğruluğunu ve geniş mutlak runaway bütçelerini korur. Makine tarafından okunabilir sonuç `MONITOR_ISOLATION` JSON satırı olarak test çıktısına yazılır.

## 6. Tekrarlama

PostgreSQL container'ı çalışırken PowerShell'de:

```powershell
$env:DATABASE_TEST_ADMIN_URL = 'postgresql://site_monitor:local_dev_only_change_me@127.0.0.1:15432/postgres'
pnpm exec vitest run --no-file-parallelism apps/monitor-worker/src/runtime-isolation.integration.test.ts
Remove-Item Env:DATABASE_TEST_ADMIN_URL
```

Hedefli test **1/1** geçmiştir. Test normal `pnpm test:integration` ve `pnpm run ci` akışlarına da dahildir.

Final kalite kapısı format, 57-operation contract drift, lint, bütün workspace strict typecheck'leri, **165/165 unit**, **57/57 gerçek PostgreSQL/socket/process integration** ve bütün production build'leriyle geçmiştir. Sağlamlaştırılmış son CI tekrarında readiness p95 **18.1 ms**, authenticated list p95 **26.9 ms** ölçülmüştür.

## 7. İddia Sınırları

- Sonuçlar belirtilen yerel makine, PostgreSQL container'ı ve 150 ms deterministik hedef içindir; internet DNS/TLS performansı değildir.
- Per-owner/per-host concurrency process-localdır ve replica sayısıyla çarpılır. Test bu deployment etkisini gizlemez: hostname başına worker başına 4, iki worker'da toplam 8 gözlenmiştir.
- API'nin ayrı pool/proses altında ilerlediğini kanıtlar; production connection proxy, multi-node PostgreSQL failover veya bölgesel network partition kanıtı değildir.
- Latency bütçeleri kullanıcı SLO'su değil, deadlock/pool starvation/event-loop blockage gibi büyük regresyonları durduran test sınırlarıdır.
