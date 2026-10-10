# Realtime Kapasite ve İzolasyon Raporu

**Aşama:** 13 — Canlı Güncelleme Altyapısı  
**Ölçüm tarihi:** 2026-10-10 20:02 +06:00  
**Durum:** 20/200/500 event burst, iki replica broadcast'i, REST izolasyonu ve slow-client sınırı geçti

## 1. Amaç

Bu rapor private realtime veri yolunun sabit 50-check varsayımına bağlı olmadığını ve aşağıdaki kapanış koşullarını karşıladığını kanıtlar:

- 20, 200 ve 500 check'e ait invalidation burst'ünün iki bağımsız API replica listener'ına eksiksiz ulaşması;
- yayın sürerken ayrı API bağlantı havuzundaki owner-scoped okumaların ilerlemesi;
- 500-event burst'ünde bounded kuyruğu dolduran tek yavaş istemcinin diğer istemcileri veya replica'ları etkilemeden kapatılması;
- listener, hub ve REST sorgularının production sınıfları ve gerçek PostgreSQL üzerinden çalışması.

Sonuçlar production SLO veya sınırsız bağlantı garantisi değildir. Tek geliştirme makinesinde algoritmik regresyon, kayıp broadcast, pool starvation ve backpressure izolasyonunu yakalayan tekrarlanabilir bir yerel baseline'dır.

## 2. Tekrarlama

PostgreSQL container'ı çalışırken PowerShell'de:

```powershell
$env:DATABASE_TEST_ADMIN_URL = 'postgresql://site_monitor:local_dev_only_change_me@127.0.0.1:15432/postgres'
pnpm test:realtime-capacity
Remove-Item Env:DATABASE_TEST_ADMIN_URL
```

Test ayrı bir veritabanı oluşturur, bütün migration'ları sıfırdan uygular, iki dedicated listener/pool ve iki owner hub başlatır, üç profili çalıştırır ve veritabanını kaldırır. Her profil `REALTIME_CAPACITY` önekiyle makine tarafından okunabilir JSON üretir.

Bu ağır profil normal `pnpm run ci` içinde çalışmaz. Normal CI doğruluk, RLS, reconnect, session ve backpressure fixture'larını çalıştırır; burst profili açık komutla tekrarlanır.

## 3. Ölçüm Ortamı ve Yöntem

| Bileşen         | Değer                              |
| --------------- | ---------------------------------- |
| İşletim sistemi | Windows `10.0.26200`               |
| CPU             | AMD Ryzen 7 7735HS, 16 logical CPU |
| Bellek          | 15.2 GiB                           |
| Node.js         | 24.19.0                            |
| PostgreSQL      | 18.6, Docker container             |
| Replica         | 2 listener + 2 owner hub           |
| REST yükü       | Profil başına 20 eşzamanlı okuma   |

Her check için production şemasında owner-scoped check kaydı oluşturulur. Test redacted `pg_notify` wake-up'larını toplu üretir; her replica kendi dedicated listener'ından event'i alıp local hub'a aktarır. Teslim süresi, notification üretiminin başlangıcından iki replica'nın da exact event kümesini almasına kadar ölçülür. Aynı anda ayrı query pool'larından 20 owner-scoped okuma yapılır.

500-check profilinde ek bir istemcinin callback'i kasıtlı olarak bekletilir ve queue limiti 32 event'tir. Beklenen sonuç yalnız bu bağlantının `BUFFER_OVERFLOW` ile kapanmasıdır.

## 4. Sonuçlar

| Check | Replica başına event | Teslim süresi | Toplam yayın hızı | REST p95 | Yavaş istemci izole |
| ----: | -------------------: | ------------: | ----------------: | -------: | :-----------------: |
|    20 |                   20 |     120,82 ms |   331,06 event/sn | 62,99 ms |     Uygulanmadı     |
|   200 |                  200 |     210,28 ms | 1.902,26 event/sn | 35,98 ms |     Uygulanmadı     |
|   500 |                  500 |     513,77 ms | 1.946,38 event/sn | 34,87 ms |        Evet         |

Üç profilde de iki replica exact event kümesini aldı; eksik veya replica'lar arası farklı teslim oluşmadı. Bütün 20 REST okuması başarıyla tamamlandı. 500-check burst'ünde yavaş istemci kapatılırken normal istemciler ve ikinci replica 500 event'in tamamını aldı.

Otomatik regresyon bütçeleri event teslimi için 10 saniye, REST p95 için 2 saniyedir. Bunlar ürün SLO'su değil; deadlock, listener kaybı, pool starvation ve belirgin performans gerilemesi alarmıdır.

## 5. Proxy ve Dağıtım Sınırı

Local Compose web'i ve API'yi ayrı portlarda doğrudan sunar; arada response buffering yapan reverse proxy yoktur. Production edge aşağıdaki sözleşmeyi korumalıdır:

- SSE yolunda buffering ve response compression kapalı;
- HTTP/1.1 keep-alive veya HTTP/2 streaming korunmuş;
- idle timeout en az 60, tercihen 75 saniye;
- normal JSON body timeout'undan ayrı uzun ömürlü stream politikası;
- rolling deploy'da bounded connection drain ve istemci reconnect desteği;
- uygulama içi limitlere ek edge seviyesinde global bağlantı ve abuse limiti.

Sticky session doğruluk için gerekli değildir. Her API replica aynı PostgreSQL kanalını dinler; reconnect sonrasında browser kalıcı REST snapshot'ıyla yakınsar.

## 6. Bulgular ve Sınırlar

- 20→200→500 burst büyümesinde broadcast tamamlanması 514 ms altında kaldı; sabit 50-check kabulü yoktur.
- Dedicated listener ve ayrı query pool tasarımı, burst sırasında REST sorgularının ilerlemesini korudu.
- Bounded per-client queue, yavaş tüketiciyi diğer owner/client/replica akışından ayırdı.
- Ölçüm tek PostgreSQL container'ı ve iki process-içi replica fixture'ı kullanır; çok-node PostgreSQL failover veya bölgesel ağ testi değildir.
- Browser yeniden bağlantısı ve snapshot/polling yakınsaması ayrı unit ve Playwright kabul testlerinde doğrulanır; bu rapor wire throughput testidir.
- Bağlantı sayısı kapasitesi burada ölçülmez. Production connection limiti, dosya descriptor bütçesi ve edge davranışı gerçek deployment ortamında ayrıca yük testine alınmalıdır.
