# Site Availability Monitor — Ürün Gereksinimleri

**Sürüm:** 1.0  
**Durum:** Aşama 0 için sabitlenmiş gereksinim tabanı  
**Tarih:** 2026-10-09 22:47 +06:00

## 1. Belgenin Rolü

Bu belge ürünün ne yapması gerektiğini tanımlar. `ARCHITECTURE.md` bu gereksinimlerin nasıl karşılanacağını, bileşen tasarım belgeleri ise ilgili bölümün nasıl uygulanacağını açıklar.

Öncelik sırası:

1. Kullanıcının daha sonra verdiği açık kararlar
2. Özgün görevdeki zorunlu davranışlar
3. Kabul edilmiş karar günlüğü
4. Mimari ve uygulama ayrıntıları

Alt seviye bir belge bu gereksinimlerle çelişemez. Yeni bir ürün kararı gereksinimi değiştirirse sürüm ve karar günlüğü birlikte güncellenir.

## 2. Ürün Hedefi

Ürün, kullanıcıların HTTP/HTTPS adreslerini belirli aralıklarla kontrol etmesini; mevcut sağlık durumunu, yanıt sürelerini, availability geçmişini ve incident'ları izlemesini; doğrulanmış kesinti ve recovery durumlarında e-posta almasını; seçili verileri giriş gerektirmeyen bir public sayfada yayınlamasını sağlar.

Opsiyonel erken uyarı özelliği, black-box ölçümlerdeki belirtilerden açıklanabilir risk sinyalleri üretir. Bu özellik ana monitoring davranışının kaynağı değildir ve kullanılamadığında ana ürün eksiksiz çalışmaya devam eder.

## 3. Aktörler

- **Kullanıcı:** Hesabı olan, yalnızca kendi kontrol ve yapılandırmalarını yöneten kişi.
- **Public ziyaretçi:** Public status bağlantısını giriş yapmadan görüntüleyen kişi.
- **Sistem operatörü:** Deployment, veritabanı, yedekleme ve servis sağlığını yöneten teknik rol; ürün içi kullanıcı rolü değildir.
- **Hedef site:** Sistem tarafından kontrol edilen harici HTTP/HTTPS endpoint'i.

İlk sürümde organizasyon, ekip üyeliği, kullanıcı daveti veya uygulama içi rol hiyerarşisi yoktur.

## 4. Fonksiyonel Gereksinimler

### 4.1 Kimlik ve sahiplik

- **FR-AUTH-001:** Sistem birden fazla bağımsız kullanıcı hesabını desteklemelidir.
- **FR-AUTH-002:** Kullanıcı güvenli bir e-posta/parola akışıyla giriş ve çıkış yapabilmelidir.
- **FR-AUTH-003:** Her özel kaynak tam olarak bir kullanıcıya ait olmalıdır.
- **FR-AUTH-004:** Bir kullanıcı başka bir kullanıcının kaynağını ID'yi bilse bile okuyamamalı, değiştirememeli, silememeli veya canlı olaylarını alamamalıdır.
- **FR-AUTH-005:** Public olarak yayınlanan veriler FR-AUTH-004'ün açık ve sınırlı istisnasıdır.

### 4.2 Kontroller

- **FR-CHECK-001:** Kullanıcı bir HTTP/HTTPS kontrolü ekleyebilmelidir.
- **FR-CHECK-002:** Kontrol; görünen ad, URL, 30 saniye–1 saat arası interval, pozitif timeout, beklenen HTTP durum kodu ve opsiyonel beklenen gövde metni içermelidir.
- **FR-CHECK-003:** Kullanıcı kontrolü düzenleyebilmeli ve silebilmelidir.
- **FR-CHECK-004:** Kullanıcı kontrolü duraklatabilmeli ve sürdürebilmelidir.
- **FR-CHECK-005:** Kullanıcı kontrolü manuel olarak mümkün olan en kısa sürede çalıştırabilmelidir.
- **FR-CHECK-006:** Aynı kontrol kendi başka bir çalışmasıyla normal çalışma koşullarında paralel başlatılmamalıdır.
- **FR-CHECK-007:** Kontrol süresi interval değerini aşarsa aradaki planlı çalışmalar biriktirilmemeli ve paralel başlatılmamalıdır.
- **FR-CHECK-008:** Hedef URL için DNS, bağlantı, TLS, timeout, HTTP durum ve gövde doğrulama hataları birbirinden ayırt edilebilir olmalıdır.
- **FR-CHECK-009:** Duraklatılmış kontrol yeni otomatik iş üretmemelidir; son bilinen sağlık durumu geçmişten silinmemelidir.
- **FR-CHECK-010:** Server yeniden başladıktan sonra aktif kontroller kalıcı ayarlarıyla devam etmelidir.
- **FR-CHECK-011:** Server kapalıyken kaçırılan kontroller geriye dönük çalıştırılmamalı ve hedef site hatası olarak kaydedilmemelidir.
- **FR-CHECK-012:** Manuel run aktif check'te normal state machine'e katılmalı; paused check'te yalnızca diagnostic olmalı ve health/incident/availability/bildirim değiştirmemelidir.
- **FR-CHECK-013:** Probe anlamını değiştiren URL, timeout veya beklenen cevap düzenlemeleri eski işleri state için geçersiz kılmalı ve yeni geçerli sonuca kadar effective health'i UNKNOWN yapmalıdır.
- **FR-CHECK-014:** Pause queued işleri iptal etmeli ve çalışan eski generation sonucunun state'i değiştirmesini engellemelidir; resume mümkün olan en kısa zamanda yeni kontrol planlamalıdır.

### 4.3 Gruplar

- **FR-GROUP-001:** Kullanıcı kontrollerini gruplar halinde düzenleyebilmelidir.
- **FR-GROUP-002:** Bir kontrol sıfır veya bir gruba ait olmalıdır.
- **FR-GROUP-003:** Grup, içindeki aktif kontrollerden türetilen genel sağlık durumuna sahip olmalıdır.
- **FR-GROUP-004:** Grup bakım ve bildirim ayarları için kapsam olarak kullanılabilmelidir.
- **FR-GROUP-005:** Grup silmek içindeki check'leri silmemeli; check'ler ungrouped hale gelmelidir.

### 4.4 Sağlık durumu ve incident'lar

- **FR-STATE-001:** Sistem çalışma durumu, sağlık durumu, bakım durumu ve veri freshness bilgisini birbirinden ayrı tutmalıdır.
- **FR-STATE-002:** Tek bir başarısız kontrol doğrulanmış düşüş sayılmamalıdır.
- **FR-STATE-003:** Varsayılan doğrulama eşiği arka arkaya iki başarısız kontroldür.
- **FR-STATE-004:** İkinci ardışık başarısızlıkta incident açılmalı; incident başlangıcı ilk başarısız gözlemin zamanı olmalıdır.
- **FR-STATE-005:** Açık incident ilk başarılı kontrolle kapatılmalı ve süresi hesaplanmalıdır.
- **FR-STATE-006:** Aynı kesinti boyunca sonraki başarısız kontroller yeni incident üretmemelidir.
- **FR-STATE-007:** Yeni veya yeterince güncel gözlemi olmayan kontrol `UNKNOWN`/stale olarak gösterilmeli; otomatik olarak `DOWN` sayılmamalıdır.
- **FR-STATE-008:** Açık incident sırasında oluşan monitoring data gap incident'ı otomatik kapatmamalı; gözlemlenen DOWN segmentini durdurmalı ve gap süresini incident'ın observed duration değerine eklememelidir.
- **FR-STATE-009:** Probe configuration değişikliği açık incident'ı `CONFIG_CHANGED`, check silme ise `CHECK_DELETED` nedeni ile terminal olarak kapatmalıdır.

### 4.5 Güncel panel

- **FR-DASH-001:** Panel her kontrol için sağlık, çalışma, bakım ve freshness durumunu göstermelidir.
- **FR-DASH-002:** Panel son response time, son kontrol zamanı ve doğrulanmış mevcut düşüş süresini göstermelidir.
- **FR-DASH-003:** Grup genel durumu gösterilmelidir.
- **FR-DASH-004:** Paneldeki durumlar sayfa yenilenmeden güncellenmelidir.
- **FR-DASH-005:** İki açık istemci aynı değişikliği otomatik olarak görebilmelidir.

### 4.6 Geçmiş ve availability

- **FR-HIST-001:** Kullanıcı günlük, haftalık ve aylık response-time geçmişini görüntüleyebilmelidir.
- **FR-HIST-002:** Kullanıcı günlük, haftalık ve aylık availability değerini görüntüleyebilmelidir.
- **FR-HIST-003:** Availability, bilinen gözlem zamanındaki sağlık durumuna göre zaman ağırlıklı hesaplanmalıdır.
- **FR-HIST-004:** Monitoring servisinin veri üretemediği süre `UNKNOWN/no data` olmalı; hedef sitenin düşüşü sayılmamalıdır.
- **FR-HIST-005:** Availability ile birlikte veri kapsama oranı hesaplanmalıdır.
- **FR-HIST-006:** Incident günlüğü başlangıç, bitiş, açık/kapalı durumu ve süreyi göstermelidir.
- **FR-HIST-007:** Veri büyüdükçe aylık görünümün maliyeti ham satır sayısıyla doğrusal şekilde artmamalıdır.
- **FR-HIST-008:** Açık `SUSPECT` aralığı provisional olmalıdır. Sonraki başarısızlık incident'ı doğrularsa ilk başarısızlıktan itibaren DOWN; sonraki başarı eşiği geçmeden gelirse doğrulanmış downtime değil UP olarak finalize edilmelidir. Başarısız run kaydı her iki durumda da geçmişte korunmalıdır.

### 4.7 Bakım pencereleri

- **FR-MAINT-001:** Kullanıcı tek bir kontrol veya grup için başlangıç ve bitiş zamanı olan bakım penceresi oluşturabilmelidir.
- **FR-MAINT-002:** Bakım sırasında kontroller devam etmeli, sonuçlar kaydedilmeli ve gerçek sağlık durumu gösterilmelidir.
- **FR-MAINT-003:** Aktif bakım sırasında normal incident e-postası gönderilmemelidir.
- **FR-MAINT-004:** Incident bakım sırasında başlayıp bakım içinde kapanırsa DOWN veya RECOVERY e-postası gönderilmemelidir.
- **FR-MAINT-005:** Bakım bittiğinde incident hâlâ açıksa bir DOWN e-postası oluşturulmalıdır.
- **FR-MAINT-006:** DOWN e-postası bakım öncesinde gönderilmiş ve recovery bakım sırasında gerçekleşmişse RECOVERY e-postası bakım sonuna ertelenmelidir.
- **FR-MAINT-007:** Örtüşen bakım pencereleri birleşim olarak değerlendirilmelidir.
- **FR-MAINT-008:** Zaman karşılaştırmaları UTC üzerinde ve `[starts_at, ends_at)` aralığıyla yapılmalıdır.

### 4.8 Bildirimler

- **FR-NOTIFY-001:** Kullanıcı doğrulanmış varsayılan e-posta alıcıları tanımlayabilmelidir.
- **FR-NOTIFY-002:** Her grup varsayılan alıcıları devralabilmeli veya kendi doğrulanmış alıcılarını kullanabilmelidir.
- **FR-NOTIFY-003:** Bir incident doğrulandığında bakım yoksa alıcılara tek bir DOWN e-postası gönderilmelidir.
- **FR-NOTIFY-004:** Incident devam ederken başarısız kontroller tekrar e-posta üretmemelidir.
- **FR-NOTIFY-005:** DOWN e-postası gerçekten gönderilmiş bir incident kapandığında aynı alıcılara tek bir RECOVERY e-postası gönderilmelidir.
- **FR-NOTIFY-006:** E-posta sağlayıcısının yavaşlığı veya erişilemezliği kontrol, incident, API veya frontend işleyişini durdurmamalıdır.
- **FR-NOTIFY-007:** Başarısız teslimatlar sınırlı retry/backoff politikasına ve gözlemlenebilir son duruma sahip olmalıdır.
- **FR-NOTIFY-008:** Daha önce DOWN gönderilmiş incident probe değişikliğiyle kapanırsa aynı alıcılara recovery iddiasında bulunmayan açıklayıcı kapanış bildirimi üretilebilmelidir.
- **FR-NOTIFY-009:** Provider sonucunun belirsiz olduğu SMTP teslimatı otomatik retry ile duplicate riski yaratmamalı; ayrı `DELIVERY_UNKNOWN` durumunda görünür olmalıdır.

### 4.9 Public durum sayfası

- **FR-PUBLIC-001:** Kullanıcı giriş gerektirmeyen, iptal edilebilir bir bağlantıyla public durum sayfası yayınlayabilmelidir.
- **FR-PUBLIC-002:** Kullanıcı hangi grup ve kontrollerin yayınlanacağını seçebilmelidir.
- **FR-PUBLIC-003:** Kullanıcı gerçek URL, response time ve incident geçmişi gibi alanların görünürlüğünü ayrı ayrı kontrol edebilmelidir.
- **FR-PUBLIC-004:** Yayın izni olmayan hiçbir özel veri public REST, canlı olay, hata veya sayfa çıktısına sızmamalıdır.
- **FR-PUBLIC-005:** Public durumlar sayfa yenilenmeden güncellenmelidir.

### 4.10 Opsiyonel erken uyarı

- **FR-PRED-001:** Sistem response time ve hata belirtilerinden açıklanabilir bir risk skoru üretebilmelidir.
- **FR-PRED-002:** Risk sonucu zaman, tahmin ufku, geçerlilik, algoritma/model sürümü ve insan tarafından okunabilir nedenler içermelidir.
- **FR-PRED-003:** Predictor ana sağlık durumunu veya incident yaşam döngüsünü değiştirememelidir.
- **FR-PRED-004:** Predictor normal DOWN/RECOVERY e-postası üretememelidir.
- **FR-PRED-005:** Predictor kapalı, yavaş veya hatalıyken ana ürün normal çalışmalıdır.
- **FR-PRED-006:** Eski tahmin kullanıcıya güncelmiş gibi gösterilmemelidir.

## 5. Zaman ve Sıralama Kuralları

- **TR-001:** Bütün kalıcı zamanlar UTC `timestamptz` olarak saklanır; kullanıcı arayüzü görüntüleme sırasında yerel saate dönüştürür.
- **TR-002:** Periyodik schedule sabit cadence kullanır. `next_run_at`, planlanan dizide mevcut zamandan sonraki ilk uygun zamandır.
- **TR-003:** Kaçırılmış periyotlar için backlog oluşturulmaz.
- **TR-004:** Manuel çalışma periyodik cadence'i değiştirmez.
- **TR-005:** Bir kontrol çalışırken gelen birden fazla manuel talep en fazla tek bekleyen manuel çalışmada birleştirilir.
- **TR-006:** Her iş config version snapshot'ı ve monoton fencing token taşır.
- **TR-007:** Eski config version/fencing token sonucu geçmişe tanısal kayıt olarak eklenebilse bile current state veya incident'ı geriye götüremez.
- **TR-008:** Lease süresi request timeout ve güvenlik payından uzun olmalı; çalışan worker lease heartbeat'i üretmelidir.

## 6. Fonksiyonel Olmayan Gereksinimler

### 6.1 Mimari

- **NFR-ARCH-001:** Frontend ve backend ayrı deploy edilebilir uygulamalar olmalı ve ağ üzerinden haberleşmelidir.
- **NFR-ARCH-002:** Ana sistem modüler monolit olmalı; API ve worker sorumlulukları ayrı süreçlerde çalışmalıdır.
- **NFR-ARCH-003:** PostgreSQL kalıcı source of truth olmalıdır.
- **NFR-ARCH-004:** Ana sistem predictor'a senkron veya başlangıç bağımlılığı taşımamalıdır.

### 6.2 Ölçek ve performans

- **NFR-PERF-001:** Kontrol sayısı için kaynak kodda 50 gibi sabit bir ürün limiti bulunmamalıdır.
- **NFR-PERF-002:** Operasyonel güvenlik için deployment tarafından yapılandırılabilir quota, concurrency ve rate limit bulunmalıdır.
- **NFR-PERF-003:** 20, 200 ve 500 aktif kontrol aynı mimari ve veri modeliyle çalıştırılabilmelidir.
- **NFR-PERF-004:** 500 kontrolün 30 saniyelik interval profili referans test ortamında diğer kontrolleri veya yönetim API'sini bloke etmemelidir.
- **NFR-PERF-005:** Güncel panel sorguları ham geçmiş tablosunun boyutundan bağımsız olmalıdır.
- **NFR-PERF-006:** Aylık geçmiş görünümü referans test ortamında iki saniye içinde kullanılabilir veri döndürmeyi hedeflemelidir.
- **NFR-PERF-007:** API liste ve detay sorguları referans test ortamında p95 bir saniye altında cevap vermeyi hedeflemelidir; asıl bütçeler ilgili bileşen tasarımında donanımla birlikte kaydedilir.

### 6.3 Güvenilirlik

- **NFR-REL-001:** Worker, SMTP ve predictor hataları birbirinden izole edilmelidir.
- **NFR-REL-002:** İşler ve outbox olayları process belleğine bağlı olmamalıdır.
- **NFR-REL-003:** Domain state değişimi ve ona ait outbox olayı aynı transaction'da yazılmalıdır.
- **NFR-REL-004:** Worker kapanışı aktif işleri kontrollü biçimde sonlandırmalı veya güvenle yeniden sahiplenilebilir bırakmalıdır.
- **NFR-REL-005:** Yerel kurulum tek PostgreSQL ile çalışabilir; üretim profili backup, point-in-time recovery, restore testi ve high-availability seçeneğini tanımlamalıdır.

### 6.4 Güvenlik

- **NFR-SEC-001:** URL kontrolü SSRF, DNS rebinding, redirect ve iç ağ erişimi saldırılarına karşı korunmalıdır.
- **NFR-SEC-002:** Varsayılan ürün yalnızca public HTTP/HTTPS hedeflerini kontrol etmelidir; private network monitoring ilk sürüm kapsamı dışındadır.
- **NFR-SEC-003:** Parolalar güçlü ve memory-hard bir algoritmayla hash edilmelidir.
- **NFR-SEC-004:** Oturumlar HTTP-only cookie, rotation, süre sonu ve CSRF korumasına sahip olmalıdır.
- **NFR-SEC-005:** Gizli değerler, response body ve hassas URL bölümleri log veya e-postalara yazılmamalıdır.
- **NFR-SEC-006:** Kullanıcı sahipliği uygulama kontrolleri, veritabanı kısıtları ve uygun tablolarda RLS ile savunma katmanlarına sahip olmalıdır.
- **NFR-SEC-007:** Hassas yapılandırma değişiklikleri audit log'a yazılmalıdır.

### 6.5 Veri ve operasyon

- **NFR-DATA-001:** Şema yalnızca versioned migration'larla değiştirilmelidir.
- **NFR-DATA-002:** Ham ölçümler partition ve retention politikasıyla yönetilmelidir.
- **NFR-DATA-003:** Rollup ve housekeeping işleri idempotent olmalıdır.
- **NFR-OPS-001:** Bütün süreçler structured log, correlation ID, health endpoint ve temel metrik üretmelidir.
- **NFR-OPS-002:** Queue lag, stale checks, notification backlog ve prediction freshness gözlemlenebilir olmalıdır.
- **NFR-OPS-003:** Üretim profili RPO/RTO hedeflerini ve doğrulanmış restore prosedürünü içermelidir.

### 6.6 Geliştirme ve kanıtlama

- **NFR-DEV-001:** Proje Docker Compose veya eşdeğer belgelenmiş akışla hızlıca yerelde çalışmalıdır.
- **NFR-DEV-002:** E-posta ve hedef siteler Mailpit ve target simulator ile emüle edilebilmelidir.
- **NFR-DEV-003:** Kritik kurallar birim, entegrasyon ve uçtan uca testlerle kanıtlanmalıdır.
- **NFR-DEV-004:** Lint, format, type-check, migration ve testler CI'da tekrarlanabilmelidir.
- **NFR-DEV-005:** Kararlar, AI kullanımı, gelişim zaman çizelgesi, bilinen eksikler ve sonraki adımlar dürüstçe belgelenmelidir.

## 7. Kapsam Dışı — İlk Sürüm

- Organizasyonlar, ekip davetleri ve rol yönetimi
- Bir kontrolün birden çok gruba üyeliği
- Private network veya kullanıcı ağına kurulan probe agent'ları
- Çok bölgeli kontrol noktaları
- SMS, telefon, Slack veya webhook bildirimleri
- Tekrarlayan bakım takvimleri
- Custom public domain
- Kubernetes zorunluluğu
- Redis/Kafka zorunluluğu
- Yeterli etiketli veri oluşmadan denetimli ML ile kesin çökme tahmini
- Predictor'ın ana sağlık veya incident kararlarına müdahalesi
- Tam matematiksel exactly-once SMTP teslimat garantisi

## 8. Değişiklik Yönetimi

Bu gereksinim tabanını etkileyen her değişiklik:

1. Yeni veya değişmiş bir gereksinim kimliğiyle yazılır.
2. `DECISIONS.md` içinde gerekçelendirilir.
3. Etkilenen kabul kriterleri ve mimari belgeler güncellenir.
4. Geriye dönük uyumluluk ve migration etkisi değerlendirilir.

