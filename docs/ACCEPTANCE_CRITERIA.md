# Site Availability Monitor — Kabul Kriterleri

**Sürüm:** 1.0  
**Tarih:** 2026-10-09 22:47 +06:00  
**Kaynak:** `docs/REQUIREMENTS.md`

Bu kriterler projenin çalıştığını kanıtlamak için ölçülebilir ve tekrar edilebilir senaryoları tanımlar. Ayrıntılı test komutları uygulama ilerledikçe bu belgeye eklenir.

## 1. Kurulum ve Mimari

- **AC-001:** Temiz bir makinede belgelenmiş komutlarla frontend, API, monitor worker, notification worker, PostgreSQL, Mailpit ve target simulator başlatılabilir.
- **AC-002:** Frontend ve backend ayrı süreç/container olarak çalışır ve ağ üzerinden haberleşir.
- **AC-003:** Migration ve seed işlemi temiz veritabanında tekrarlanabilir biçimde tamamlanır.
- **AC-004:** Predictor kapatıldığında diğer servisler başlamaya ve çalışmaya devam eder.

## 2. Kullanıcı İzolasyonu

- **AC-010:** İki kullanıcı aynı sistemde bağımsız hesaplarla giriş yapabilir.
- **AC-011:** Kullanıcı A, kullanıcı B'nin check, group, incident, history, maintenance, notification veya public-page yapılandırmasını ID tahminiyle okuyamaz.
- **AC-012:** Kullanıcı A başka kullanıcıya ait kaynağı güncelleyemez, silemez veya kendi grubuna bağlayamaz.
- **AC-013:** Kullanıcı A, kullanıcı B'nin private SSE olaylarını alamaz.
- **AC-014:** Public endpoint yalnızca sayfa sahibinin açıkça yayınladığı alanları döndürür.

## 3. Kontrol Yönetimi

- **AC-020:** Kullanıcı geçerli URL, interval, timeout, expected status ve opsiyonel expected text ile kontrol oluşturabilir.
- **AC-021:** 30 saniyeden kısa veya 1 saatten uzun interval reddedilir.
- **AC-022:** Geçersiz protokol, URL credential'ı ve engellenmiş ağ hedefleri reddedilir.
- **AC-023:** Kontrol duraklatıldığında yeni otomatik iş oluşturulmaz; sürdürüldüğünde yeni sonuç gelene kadar freshness doğru gösterilir.
- **AC-024:** Manuel çalışma isteği kalıcı bir işe dönüşür ve API request'i boyunca HTTP kontrolü bekletilmez.
- **AC-025:** Kontrol çalışırken tekrarlanan manuel talepler en fazla tek bekleyen manuel çalışmaya birleştirilir.
- **AC-026:** Aktif check'te manuel run health state machine'e katılır ve cadence'i değiştirmez.
- **AC-027:** Paused check'te manuel run diagnostic olarak tamamlanır; health, incident, availability veya normal e-posta üretmez.
- **AC-028:** Probe configuration değişikliği eski generation sonuçlarını state için reddeder ve yeni config için health'i UNKNOWN yapar.
- **AC-029:** Grup silindiğinde içindeki check'ler silinmeden ungrouped olur.

## 4. Scheduler ve Worker

- **AC-030:** Aynı check için iki normal aktif execution eşzamanlı başlatılmaz.
- **AC-031:** İstek interval'dan uzun sürse bile ikinci periyodik execution paralel başlamaz.
- **AC-032:** İki veya daha fazla worker aynı kuyruğu tüketirken aynı job yalnızca bir worker tarafından kabul edilmiş sonuç üretir.
- **AC-033:** Lease kaybeden veya eski fencing token taşıyan sonuç current state ve incident'ı değiştiremez.
- **AC-034:** Worker işlem sırasında öldürüldüğünde iş lease politikasıyla güvenli biçimde yeniden ele alınır.
- **AC-035:** Server kapalıyken kaçırılan çalışmalar backfill edilmez ve geçmişte no-data boşluğu oluşur.
- **AC-036:** Manuel çalışma periyodik cadence'i değiştirmez.
- **AC-037:** Bir yavaş/hang hedef diğer hedeflerin planlanmasını veya API cevaplarını bloke etmez.

## 5. Sağlık ve Incident

- **AC-040:** İlk başarısızlık sonucu check `SUSPECT` olur ve incident açılmaz.
- **AC-041:** İkinci ardışık başarısızlık incident açar; başlangıç zamanı ilk başarısız çalışmanın zamanıdır.
- **AC-042:** Incident açıkken yeni başarısızlıklar ikinci incident üretmez.
- **AC-043:** İlk başarılı sonuç açık incident'ı kapatır ve süresini hesaplar.
- **AC-044:** Eski veya eksik veri otomatik DOWN yerine UNKNOWN/stale olarak gösterilir.
- **AC-045:** Grup durumu içindeki aktif kontrollerin tanımlanmış önceliğine göre türetilir.
- **AC-046:** Açık incident sırasında data gap oluştuğunda incident açık/unobserved kalır ve observed duration gap boyunca artmaz.
- **AC-047:** Gap sonrasındaki FAIL aynı incident'ta yeni observed segment açar; gap sonrasındaki PASS incident'ı recovery olarak kapatır.
- **AC-048:** Probe config değişikliği açık incident'ı CONFIG_CHANGED ile kapatır; check silme CHECK_DELETED ile kapatır.

## 6. Bakım ve Bildirim

- **AC-050:** Bakım sırasında kontroller ve geçmiş kaydı devam eder.
- **AC-051:** Bakım içinde başlayıp kapanan incident e-posta üretmez.
- **AC-052:** Bakım sonunda hâlâ açık olan incident tam bir DOWN teslimat seti üretir.
- **AC-053:** Bakım öncesinde DOWN gönderilmiş incident bakım sırasında kapanırsa RECOVERY bakım sonuna kadar gönderilmez.
- **AC-054:** Örtüşen iki bakımdan yalnızca biri bittiğinde bildirim gönderilmez.
- **AC-055:** Aynı incident ve alıcı için tekrarlanan başarısız kontroller yeni DOWN teslimatı oluşturmaz.
- **AC-056:** DOWN teslimatı yapılmadan kapanan incident için geç kalmış DOWN veya anlamsız RECOVERY gönderilmez.
- **AC-057:** DOWN gönderilmiş incident kapandığında aynı alıcıya tek RECOVERY oluşturulur.
- **AC-058:** SMTP kapalıyken kontroller, incident'lar, API ve frontend çalışır; teslimatlar retry durumunda kalır.
- **AC-059:** Mailpit üzerinde DOWN ve RECOVERY e-posta içerikleri doğrulanabilir.
- **AC-059A:** SMTP sonucu belirsizse delivery `DELIVERY_UNKNOWN` olur ve otomatik duplicate retry yapılmaz.

## 7. Geçmiş ve Availability

- **AC-060:** Gün, hafta ve ay response-time grafikleri uygun rollup çözünürlüğüyle açılır.
- **AC-061:** Availability zaman ağırlıklı hesaplanır ve interval değişiminden sayım bazlı sapma oluşmaz.
- **AC-062:** Monitoring servisi kapalıyken geçen süre DOWN süresine eklenmez.
- **AC-063:** No-data süresi grafikte boşluk ve ayrı coverage değeri olarak görünür.
- **AC-064:** Incident günlüğü başlangıç, bitiş, açık/kapalı durum ve süreyi doğru gösterir.
- **AC-065:** Referans büyük veri setinde aylık geçmiş iki saniyelik hedef bütçe içinde kullanılabilir sonuç döndürür.

## 8. Canlı ve Public Görünüm

- **AC-070:** İki açık authenticated tarayıcı aynı durum değişikliğini sayfa yenilemeden görür.
- **AC-071:** SSE bağlantısı koptuktan sonra yeniden bağlanan istemci REST snapshot ile doğru duruma ulaşır.
- **AC-072:** Public sayfa yayınlanan durum değişikliğini yenileme olmadan gösterir.
- **AC-073:** Public sayfa kapatıldığında veya slug döndürüldüğünde eski bağlantı veri döndürmez.
- **AC-074:** URL görünürlüğü kapalıysa URL REST, SSE, HTML veya hata cevabında bulunmaz.

## 9. Ölçek ve Dayanıklılık

- **AC-080:** Aynı kod ve veri modeli 20, 200 ve 500 aktif kontrol profilleriyle çalışır.
- **AC-081:** 500 kontrol/30 saniye profili dokümante edilmiş referans ortamda kuyruk gecikmesi ve API bütçelerini karşılar veya ölçülen sapma dürüstçe raporlanır.
- **AC-082:** Bütün hedefler timeout olduğunda worker concurrency sınırlı kalır ve API kullanılabilirliğini korur.
- **AC-083:** Tek kullanıcı kuyruğu doldurduğunda diğer kullanıcıların işleri tamamen aç kalmaz.
- **AC-084:** Yeniden başlatma sonrası kontroller kalıcı ayarlarla devam eder.
- **AC-085:** Predictor backlog'u veya arızası ana API/worker ölçümlerinde anlamlı bozulma oluşturmaz.

## 10. Erken Uyarı

- **AC-090:** Yeterli veri oluştuğunda predictor risk skoru, zaman, ufuk, geçerlilik ve açıklama üretir.
- **AC-091:** Eski risk sonucu güncel olarak gösterilmez.
- **AC-092:** Predictor ana check health veya incident tablolarını değiştiremez.
- **AC-093:** Predictor container'ı kaldırıldığında normal DOWN/RECOVERY e-postaları ve bütün ana ürün akışları çalışır.

## 11. Güvenlik ve Operasyon

- **AC-100:** Localhost, private, link-local, metadata ve redirect üzerinden private hedef erişimleri engellenir.
- **AC-101:** DNS doğrulaması ile gerçek bağlantı arasında yeniden çözümleme kaynaklı SSRF oluşmadığı test edilir.
- **AC-102:** Response body, parola, session token ve hassas URL query değerleri log veya e-postalarda görünmez.
- **AC-103:** Liveness/readiness, queue lag, stale checks ve notification backlog gözlemlenebilir.
- **AC-104:** Veritabanı backup'ından restore prosedürü dokümante edilmiş testte doğrulanır.
- **AC-105:** Lint, format, type-check, birim, entegrasyon ve gerekli uçtan uca testler CI'da çalışır.

## 12. Teslim Kanıtı

- **AC-110:** README temiz kurulum, migration, seed, başlatma, test ve demo adımlarını içerir.
- **AC-111:** Proje durumu çalışan, eksik ve yapılmayan işleri açıkça ayırır.
- **AC-112:** AI kullanımı, kararlar ve zaman damgalı geliştirme seyri teslim edilir.
- **AC-113:** Git geçmişi aşamalı ve anlamlı geliştirmeyi gösterir.
- **AC-114:** GitHub repository bağlantısı teslim edilir.

