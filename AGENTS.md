# Proje Geliştirme Yönergesi

Bu dosya, proje boyunca insan geliştiriciler ve AI ajanları için bağlayıcı çalışma yönergesidir. Her geliştirme turunun başında okunmalı; mimari, uygulama, test, dokümantasyon ve teslim kararları bu kurallarla uyumlu olmalıdır.

## 1. Projenin Hedefi

Amaç yalnızca çalışan bir demo üretmek değil; yerelde kolayca kurulabilen, kararları açıklanmış, test edilebilir, sürdürülebilir ve çalışabilirliği kanıtlanabilen profesyonel bir istemci-sunucu ürünü teslim etmektir.

"Enterprise seviye" yaklaşımı gereksiz karmaşıklık veya erken mikroservisleşme anlamına gelmez. Kapsama uygun en sade mimari tercih edilmeli; güvenilirlik, güvenlik, bakım kolaylığı, gözlemlenebilirlik, testler ve dokümantasyon yüksek kalitede tutulmalıdır.

## 2. Zorunlu Teknik Gereklilikler

1. Ürün ayrı bir backend ve ayrı bir frontend uygulamasından oluşmalıdır.
2. Frontend ile backend ağ üzerinden, açıkça tanımlanmış bir API aracılığıyla haberleşmelidir.
3. Backend için öncelikli seçenekler Python, Go veya Node.js'tir. Başka bir dil ya da araç seçilirse güçlü gerekçesi karar günlüğünde açıklanmalıdır.
4. Frontend React veya Vue ile geliştirilmelidir.
5. Kalıcı veri için ilişkisel bir veritabanı kullanılmalıdır. Varsayılan tercih PostgreSQL'dir; farklı seçimler gerekçelendirilmelidir.
6. Hesap ve oturum açma modeli ürün ihtiyacına göre belirlenebilir. Kimlik doğrulama eklenirse güvenli biçimde uygulanmalı; eklenmezse bunun neden gerekli olmadığı belgelenmelidir.
7. Sistem aynı anda açık en az iki istemciyle (örneğin iki tarayıcı sekmesi) doğru çalışmalıdır.
8. E-posta, üçüncü taraf API'ler ve benzeri dış servisler gerektiğinde açıkça belgelenmiş mock/stub uygulamalarıyla değiştirilebilir.
9. Projenin ön koşulları ve dağıtım/çalıştırma gereksinimleri belgelenmelidir.
10. Yerel kurulum hızlı, tekrarlanabilir ve mümkün olduğunca az komutla tamamlanabilmelidir.

## 3. Mimari ve Uygulama İlkeleri

- Önce gerçek görev kapsamı ve kabul kriterleri netleştirilmeli, teknoloji seçimi bundan sonra yapılmalıdır.
- Varsayılan yaklaşım, alan sınırları açık ve modüler bir monolit olmalıdır. Mikroservis ancak somut bir ihtiyaç varsa seçilmelidir.
- İş kuralları taşıma katmanından, kullanıcı arayüzünden ve kalıcılık ayrıntılarından ayrılmalıdır.
- API sözleşmesi tutarlı olmalı; doğrulama, hata formatları ve durum kodları merkezi bir yaklaşımla ele alınmalıdır.
- Veritabanı şeması migration'larla yönetilmeli; elle yapılan ve kaydı bulunmayan şema değişikliklerinden kaçınılmalıdır.
- Gizli bilgiler kaynak koduna veya Git geçmişine yazılmamalıdır. Gerekli değişkenler `.env.example` içinde güvenli örneklerle açıklanmalıdır.
- Üretim kodunda gereksiz bağımlılıklardan kaçınılmalı; her önemli paket seçimi bakım durumu, güvenlik, ekosistem ve kullanım amacı bakımından gerekçelendirilmelidir.
- Kod okunabilir, tip güvenliğinin mümkün olduğunca kullanıldığı ve otomatik kontrollerle korunabilen bir yapıda olmalıdır.
- Erişilebilirlik, duyarlı tasarım ve anlaşılır hata/boş/yükleniyor durumları frontend kapsamının parçası kabul edilmelidir.

## 4. Kalite ve Kanıtlanabilirlik

Projenin çalıştığı yalnızca beyan edilmemeli, kanıtlanmalıdır. Uygun olan ölçüde aşağıdakiler sağlanmalıdır:

- Kritik iş kuralları için birim testleri
- Backend API ve veritabanı davranışları için entegrasyon testleri
- Temel kullanıcı akışları için uçtan uca veya eşdeğer kabul testleri
- İki istemcinin eşzamanlı kullanıldığı bir senaryonun doğrulanması
- Lint, format ve type-check kontrolleri
- Tekrarlanabilir test komutları
- Sağlık kontrolü ve anlamlı uygulama logları
- Mümkünse CI üzerinde otomatik doğrulama
- Demo/seed verisi ve değerlendiricinin izleyebileceği kısa bir doğrulama senaryosu

Test kapsamı, projenin risklerine göre seçilmeli; yalnızca yüksek coverage sayısı elde etmek için değersiz testler yazılmamalıdır.

## 5. Dokümantasyon ve Teslim Eserleri

Proje geliştikçe aşağıdaki belgeler oluşturulmalı ve güncel tutulmalıdır:

- `README.md`: ürün özeti, ön koşullar, kurulum, yerel çalıştırma, testler, yapılandırma ve temel kullanım
- `docs/ARCHITECTURE.md`: bileşenler, veri akışı, sınırlar ve önemli mimari tercihler
- `docs/DECISIONS.md`: tarihli teknik/ürün kararları, değerlendirilen alternatifler ve seçim gerekçeleri
- `docs/DEVELOPMENT_LOG.md`: çalışmanın zamana yayılan, tarih ve saat içeren kısa gelişim günlüğü
- `docs/AI_USAGE.md`: kullanılan model, araç, önemli promptlar veya oturum kaydı yaklaşımı ve AI'ın projedeki rolü
- `docs/PROJECT_STATUS.md`: çalışanlar, kısmen çalışanlar, bilinçli olarak yapılmayanlar, bilinen sorunlar ve nedenleri
- `docs/NEXT_STEPS.md`: sonraki geliştirme turunda yapılması önerilen işler
- API sözleşmesi veya otomatik üretilen OpenAPI/Swagger dokümantasyonu

Bir şablon, generator, açık kaynak proje veya başka bir çözüm temel alınırsa kaynağı ve projeye etkisi açıkça belirtilmelidir.

## 6. AI ile Çalışma ve Karar Kaydı

- AI ajanlarının kullanımı saklanmamalı; teslimin beklenen bir parçası olarak belgelenmelidir.
- Önemli promptlar, kararlar veya araç tarafından sağlanan oturum dışa aktarımı teslim edilebilir biçimde korunmalıdır.
- Her önemli karar için en az şu bilgiler yazılmalıdır: tarih/saat, bağlam, seçenekler, seçilen yaklaşım, gerekçe ve bilinen sonuçlar/tavizler.
- AI önerileri doğrulanmadan doğru kabul edilmemelidir. Kritik kod, güvenlik kararları, migration'lar ve test sonuçları kontrol edilmelidir.
- Günlükler gizli bilgi, erişim anahtarı, parola veya gereksiz kişisel veri içermemelidir.

## 7. Git ve Çalışma Geçmişi

- Çalışma, anlamlı ve küçük adımlara ayrılmış commit'lerle ilerlemelidir.
- Commit mesajları yapılan değişikliği ve amacını anlaşılır biçimde ifade etmelidir.
- Tüm projenin tek ve büyük bir son commit ile eklenmesinden kaçınılmalıdır.
- `docs/DEVELOPMENT_LOG.md` her önemli aşamada gerçek tarih ve saatle güncellenmelidir.
- Mevcut kullanıcı değişiklikleri korunmalı; ilgisiz dosyalar değiştirilmemeli veya silinmemelidir.
- Teslim sonunda GitHub repository bağlantısı sağlanmalıdır.

## 8. Yerel Çalıştırma Hedefi

Tercihen Docker Compose veya eşdeğer bir yöntemle frontend, backend ve veritabanı birlikte ayağa kaldırılabilmelidir. Kullanılan yaklaşım ne olursa olsun:

- Sıfırdan kurulum adımları README'de bulunmalıdır.
- Gerekli yazılım sürümleri belirtilmelidir.
- Migration ve seed işlemleri açıkça tanımlanmalıdır.
- Varsayılan geliştirme ayarları güvenli ve anlaşılır olmalıdır.
- Temiz bir ortamda kurulum ve test komutları teslimden önce doğrulanmalıdır.

## 9. Dürüst Durum Bildirimi

Teslim belgelerinde aşağıdakiler birbirinden açıkça ayrılmalıdır:

- Tamamlanan ve doğrulanan özellikler
- Kısmen tamamlanan özellikler
- Bilinen hatalar ve sınırlamalar
- Kapsam dışında bırakılan işler ve bırakılma gerekçeleri
- Üretime geçmeden önce yapılması gerekenler

Eksikler gizlenmemeli ve henüz doğrulanmamış işler tamamlanmış gibi gösterilmemelidir.

## 10. Her Geliştirme Turunda İzlenecek Akış

1. Bu dosyayı ve mevcut proje belgelerini oku.
2. Kullanıcı talebini mevcut kabul kriterleri ve proje durumu ile karşılaştır.
3. Belirsizlikleri kaydet; güvenli ve kapsamı değiştirmeyen varsayımlarla ilerle.
4. Önce ilgili kodu ve testleri incele.
5. En küçük anlamlı değişikliği uygula.
6. Uygun otomatik kontrolleri ve testleri çalıştır.
7. Sonuçları, başarısız kontrolleri ve bilinen sınırlamaları dürüstçe bildir.
8. Önemli bir karar veya kilometre taşı oluştuysa karar ve geliştirme günlüklarını gerçek zaman damgasıyla güncelle.
9. Kullanıcıdan açıkça istenmedikçe kapsamı büyütme veya gereksiz altyapı ekleme.

## 11. Teslim Öncesi Kontrol Listesi

- [ ] Backend ve frontend ayrı ve ağ üzerinden haberleşiyor.
- [ ] İlişkisel veritabanı migration'larla kurulabiliyor.
- [ ] Yerel kurulum temiz bir ortam için belgelenmiş ve doğrulanmış.
- [ ] İki eşzamanlı istemci senaryosu test edilmiş.
- [ ] Kritik kullanıcı akışları ve iş kuralları test edilmiş.
- [ ] Lint, type-check ve ilgili otomatik kontroller geçiyor.
- [ ] Gizli bilgi repository içinde bulunmuyor.
- [ ] Mimari ve önemli seçimlerin gerekçeleri kayıtlı.
- [ ] AI kullanımı ve geliştirme süreci belgelenmiş.
- [ ] Proje durumu ve bilinen eksikler dürüstçe yazılmış.
- [ ] Sonraki adımlar listelenmiş.
- [ ] Kullanılan şablonlar ve dış kaynaklar belirtilmiş.
- [ ] Git geçmişi aşamalı geliştirmeyi gösteriyor.
- [ ] GitHub repository bağlantısı teslim için hazır.

## 12. Başlangıç Kaydı

Bu yönerge 2026-10-09 tarihinde, özgün proje görevi alınmadan önce oluşturuldu. Somut görev ve kabul kriterleri geldiğinde bu dosya korunmalı; göreve özgü ayrıntılar ilgili proje belgelerine eklenmelidir.
