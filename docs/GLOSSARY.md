# Site Availability Monitor — Terimler Sözlüğü

**Sürüm:** 1.0  
**Tarih:** 2026-10-09 22:53 +06:00

Bu sözlük ürün, kod, API ve dokümantasyonda aynı kavramların aynı anlamda kullanılmasını sağlar.

| Terim | Tanım |
| --- | --- |
| User | Kendi kaynaklarının tek sahibi olan authenticated ürün kullanıcısı. |
| Owner | Bir kaynağın ait olduğu kullanıcı. İlk sürümde organization/tenant değildir. |
| Check | Bir hedef URL'nin ne sıklıkta ve hangi beklentilerle kontrol edileceğini tanımlayan kaynak. |
| Probe configuration | HTTP isteğinin ve başarı değerlendirmesinin anlamını belirleyen URL, timeout, beklenen status/body ve redirect gibi alanlar. |
| Schedule configuration | Interval, execution state, cadence anchor ve sonraki çalışma zamanını belirleyen alanlar. |
| Check job | Belirli bir zamanda ve belirli config snapshot'ıyla bir kontrol çalıştırma niyeti. |
| Job attempt | Bir worker'ın job üzerinde lease alarak yaptığı tek yürütme denemesi. |
| Check run | Hedef siteye gerçekten yapılan ve tamamlanan tek kontrolün değiştirilemez gözlemi. |
| Accepted observation | Güncel config/generation/fencing kurallarını geçen ve domain state'i değiştirmesine izin verilen run. |
| Diagnostic run | Geçmişe kaydedilen fakat health, incident, availability veya normal bildirimleri değiştirmeyen run. |
| Scheduled run | Periyodik cadence tarafından oluşturulan run. |
| Manual run | Kullanıcının “şimdi kontrol et” komutuyla oluşturulan run. |
| Execution state | Check'in otomatik iş üretip üretmediğini belirleyen `ACTIVE` veya `PAUSED` ekseni. |
| Health state | Son geçerli gözlemlere göre `UNKNOWN`, `UP`, `SUSPECT` veya `DOWN` durumu. |
| Last observed health | Veri stale olsa bile son kabul edilmiş gözlemden kalan sağlık bilgisi. |
| Effective health | Freshness hesaba katılarak kullanıcıya sunulan sağlık; stale durumda `UNKNOWN` olarak gösterilir. |
| Freshness | Güncel gözlemin beklenen schedule ve timeout sınırları içinde olup olmadığını belirten `FRESH` veya `STALE` ekseni. |
| Fresh-until | Yeni bir sonuç gelmezse verinin stale sayılacağı UTC zamanı. |
| Maintenance | Kontrolleri durdurmadan normal bildirimleri bastıran planlı zaman aralığı. |
| Failure candidate | İlk başarısız accepted observation ile başlayan, henüz incident eşiğini geçmemiş provisional durum. |
| Incident | Başarısızlık eşiği geçildiğinde doğrulanan kesinti kaydı. |
| Incident segment | Incident içinde gerçekten gözlem kapsamı bulunan doğrulanmış DOWN zaman aralığı. UNKNOWN/no-data boşlukları segment değildir. |
| Observed duration | Incident'ın DOWN segmentlerinin toplam süresi. |
| Wall-clock span | Incident başlangıcı ile kapanışı arasındaki toplam takvim süresi; gözlem boşluklarını içerebilir. |
| Data gap | Monitoring sisteminin kabul edilmiş gözlem üretemediği UNKNOWN zaman aralığı. Hedef düşüşü değildir. |
| Availability | Bilinen gözlem süresindeki UP zamanının UP + DOWN zamanına oranı. |
| Coverage | Seçilen zaman aralığının ne kadarında bilinen health sınıflandırması bulunduğu. |
| Group | Bir kullanıcının kontrollerini bildirim, bakım ve görünüm amacıyla topladığı kaynak. Bir check en fazla bir gruba aittir. |
| Group health | Gruptaki aktif ve fresh kontrollerin etkili durumlarından türetilen projection. |
| Outbox event | Domain transaction'ıyla atomik yazılan ve asenkron yan etkileri tetikleyen kalıcı olay. |
| Notification intent | Belirli bir domain olayı için bildirim değerlendirme niyeti. Henüz bir kişiye teslimat değildir. |
| Notification delivery | Tek olay türünün tek recipient'a gönderim yaşam döngüsü. |
| Public page | Sahibin seçtiği sınırlı projection'ı girişsiz paylaşan kaynak. |
| Prediction score | Opsiyonel Python predictor tarafından üretilen, ana health kararını etkilemeyen süreli risk sonucu. |
| Cadence | Bir check'in interval tabanlı ideal planlı zaman dizisi. |
| Jitter | Aynı anda oluşan iş yükünü dağıtmak için cadence başlangıcına uygulanan kontrollü küçük kaydırma. |
| Lease | Bir worker'ın job'ı sınırlı süreyle işleme hakkı. |
| Heartbeat | Çalışan worker'ın lease'i hâlâ kullandığını periyodik olarak kanıtlaması. |
| Fencing token | Eski veya lease kaybetmiş denemenin current state yazmasını engelleyen monoton sıra değeri. |
| Probe generation | Probe anlamını değiştiren config güncellemelerinde artan sürüm. Eski generation sonucu state'e uygulanmaz. |
| Schedule generation | Pause/resume/interval/deletion gibi scheduling anlamını değiştiren işlemlerde artan sürüm. |
| Resource version | Optimistic concurrency için kaynağın bütün kullanıcı değişikliklerinde artan sürüm. |
| Reconciliation | Kalıcı gerçeklerden türetilen işleri ve projection'ları tekrar güvenli biçimde oluşturabilen idempotent düzeltme işlemi. |
| Housekeeping | Partition, retention, stale lease, rollup, session ve benzeri periyodik sistem bakım işleri. |

