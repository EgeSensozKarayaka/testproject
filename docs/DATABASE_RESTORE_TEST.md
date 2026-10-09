# Local Veritabanı Geri Yükleme Provası

**Tarih:** 2026-10-10 02:24 +06:00
**Kapsam:** PostgreSQL 18.6 local Compose, mantıksal `pg_dump`/`pg_restore`

## Amaç

Migration testinden bağımsız olarak mevcut local veritabanı yedeğinin boş ve ayrı bir veritabanına geri yüklenebildiğini; şema sürümü, örnek veri ve güvenlik özelliklerinin korunduğunu kanıtlamak.

Bu prova production backup/PITR, şifreleme, sağlayıcı snapshot'ı veya tanımlı RPO/RTO hedeflerinin doğrulaması değildir. Production drill'i Aşama 17 kapsamındadır.

## İzlenen Akış

1. `site_monitor` veritabanı custom-format mantıksal dump olarak PostgreSQL konteynerinin geçici dizinine yazıldı.
2. Yalnız prova için `site_monitor_restore_test` adlı boş veritabanı oluşturuldu.
3. Dump bu veritabanına owner/privilege bilgileriyle geri yüklendi.
4. Salt okunur doğrulama sorguları çalıştırıldı.
5. Başarılı kontrolden sonra yalnız `site_monitor_restore_test` ve geçici dump dosyası silindi. Ana `site_monitor` veritabanına reset/drop uygulanmadı.

## Kanıtlanan Sonuçlar

| Kontrol                          | Sonuç |
| -------------------------------- | ----: |
| Schema revision                  |   `6` |
| Migration ledger satırı          |   `6` |
| Demo kullanıcı                   |   `1` |
| Demo check                       |   `1` |
| `FORCE RLS` private parent tablo |  `29` |
| `pg_restore` process sonucu      |   `0` |

## Sonraki Production Provasında Ek Gerekenler

- Ayrı production-benzeri cluster ve gerçek deployment login wrapper'ları
- Managed snapshot + WAL/PITR ile belirli zamana dönüş
- Şifreleme ve backup erişim politikası doğrulaması
- RLS negatif smoke, auth bootstrap, scheduler claim, history ve public snapshot kabul testleri
- Ölçülen RPO/RTO, veri boşluğu ve restore raporu
