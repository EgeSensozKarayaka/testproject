# Monitor Worker Process Failure Recovery Report

**Aşama:** 9 — Kalıcı Scheduler ve Monitor Worker  
**Doğrulama tarihi:** 2026-10-10 15:23 +06:00  
**Durum:** Process-kill, doğal lease expiry/reclaim ve stale-result fencing geçti

## 1. Kanıtlanan Risk

Bu test, aktif HTTP kontrolü sırasında monitor worker prosesinin geri dönüşsüz biçimde kaybedilmesinin job'ı sonsuza kadar `RUNNING` bırakmadığını ve eski attempt kimliğiyle gelen gecikmiş bir sonucun daha yeni sonucu bozamadığını kanıtlar.

Test yalnız queue fonksiyonunu çağıran bir mock değildir. Ayrı bir Node prosesi production `apps/monitor-worker/src/index.ts` giriş noktasını, gerçek probe motorunu, runtime coordinator'ı ve monitor PostgreSQL rolünü çalıştırır.

## 2. Senaryo

1. Her koşu için revision 1–14 uygulanmış izole PostgreSQL veritabanı oluşturulur.
2. Test, yanıtı bilerek tamamlamayan gerçek bir localhost HTTP hedefi açar ve tek pending job hazırlar.
3. Production monitor worker ayrı child process olarak başlatılır. Job'ın `RUNNING` olduğu ve hedefin gerçek HTTP isteğini aldığı gözlenir.
4. Worker'a graceful handler'ları çalıştırmayan `SIGKILL` gönderilir.
5. Veritabanında job'ın hâlâ eski owner ile `RUNNING` kaldığı doğrulanır; test elle lease tarihi değiştirmez.
6. `timeout_ms + lease_grace_ms` süresinin veritabanı saatine göre doğal olarak dolması beklenir. Reclaimer eski attempt'ı `LEASE_LOST` ile kapatıp aynı job'ı deterministik bounded backoff ile `PENDING` yapar.
7. Başka worker job'ı yeniden claim eder. Yeni fencing token'ın eskisinden büyük olduğu doğrulanır ve `PASS` sonucu atomik olarak kabul edilir.
8. Eski claim kimliğiyle gecikmiş `FAIL` persistence çağrısı yapılır. Bu çağrı öldürülen prosesin dirildiğini iddia etmez; ağ partition'ı/gecikmiş callback gibi zombie-delivery sınırını aynı production adapter üzerinde deterministik olarak yeniden üretir.
9. Eski sonuç history'de `accepted_for_state=false` ve `ATTEMPT_NOT_CURRENT` olarak tutulur. Current state, accepted fence, response time ve state version değişmez; sahte incident oluşmaz.

## 3. Kalıcı Sonuç

| Kayıt                   | Attempt 1 — öldürülen worker | Attempt 2 — replacement |
| ----------------------- | ---------------------------- | ----------------------- |
| Attempt terminal nedeni | `LEASE_LOST`                 | `RESULT_RECORDED`       |
| Fencing token           | Eski                         | Monoton daha büyük      |
| Sonuç                   | Gecikmiş `FAIL`              | `PASS`                  |
| State'e kabul           | Hayır                        | Evet                    |
| Rejection               | `ATTEMPT_NOT_CURRENT`        | Yok                     |

Job tekil olarak `COMPLETED` kalır, current health `UP` kalır ve incident sayısı sıfırdır. Böylece dış HTTP çağrısı için exactly-once iddiasında bulunmadan, yalnız current lease/fence'in sağlık ve incident durumunu değiştirebildiği gösterilir.

## 4. Tekrarlama

PostgreSQL container'ı çalışırken PowerShell'de:

```powershell
$env:DATABASE_TEST_ADMIN_URL = 'postgresql://site_monitor:local_dev_only_change_me@127.0.0.1:15432/postgres'
pnpm exec vitest run --no-file-parallelism apps/monitor-worker/src/observation-store.integration.test.ts
Remove-Item Env:DATABASE_TEST_ADMIN_URL
```

Hedefli paket **10/10** testle geçmiştir. Process testi Windows ve POSIX üzerinde Node'un force-kill semantiğini kullanır; sabit servis portuna bağımlı değildir ve hassas URL/body değerlerini assertion veya rapora taşımaz.

## 5. Bu Testin İddia Etmediği Şeyler

- Bir dış HTTP isteğinin exactly-once çalıştığını iddia etmez. Lease partition anında kısa fiziksel overlap mümkündür.
- PostgreSQL cluster kaybı, işletim sistemi çökmesi veya çok-node network partition testi değildir.
- Worker yükü altında API latency ve iki production worker'ın eşzamanlı throughput profili bu raporun kapsamında değildir; Aşama 9'un sonraki ve son kanıt dilimidir.
- Downtime boşluğunun history API sunumundaki görünümü Aşama 12 history/read model kapsamında ayrıca doğrulanacaktır. Kalıcılık katmanı proses yokken sahte run üretmez.

## 6. Otomatik Koruma

Test normal `pnpm test:integration` ve `pnpm run ci` akışına dahildir. Zaman sınırları performans SLO'su değil, takılı proses/lease/backoff regresyonunu sonlandıran gevşek test emniyet sınırlarıdır.

Final kalite kapısı format, 57-operation contract drift, lint, bütün workspace strict typecheck'leri, **165/165 unit**, **56/56 gerçek PostgreSQL/socket/process integration** ve bütün production build'leriyle geçmiştir.
