# Site Availability Monitor — Karar Günlüğü

Bu belge ürün ve mimariyi etkileyen kabul edilmiş kararları tarih sırasıyla kaydeder. Kararlar değiştirilmez; geçersiz hale gelen karar yeni bir kayıtla değiştirilir ve eski kayıt `Superseded` olarak işaretlenir.

## D-001 — Modüler monolit ve ayrı runtime süreçleri

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Bağlam:** API, kontrol işleri, bildirimler ve opsiyonel analiz farklı hata ve ölçek profillerine sahip.
- **Karar:** Tek repository ve ortak domain modülleri korunacak; API, monitor worker, notification worker ve predictor ayrı process/container olarak çalışacak.
- **Alternatifler:** Tek Node process; başlangıçtan mikroservis mimarisi.
- **Gerekçe:** Süreç izolasyonu ve bağımsız worker ölçekleme sağlarken servisler arası ağ sözleşmesi ve dağıtık transaction karmaşıklığını sınırlamak.
- **Sonuçlar:** PostgreSQL ortak source of truth olur; modül sınırlarının kodda korunması gerekir.

## D-002 — React/TypeScript, Node.js/TypeScript ve PostgreSQL

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Frontend React/TypeScript; ana backend Fastify tabanlı Node.js/TypeScript; kalıcı veri PostgreSQL olacaktır.
- **Gerekçe:** Asenkron HTTP kontrollerinde Node.js'in I/O modeli, frontend/backend tip paylaşımı ve PostgreSQL'in transaction, locking, RLS ve partition özellikleri bu ürünle uyumludur.
- **Sonuçlar:** Gelişmiş SQL özellikleri nedeniyle ince typed SQL/repository yaklaşımı, ağır bir ORM'ye tercih edilir.

## D-003 — Kullanıcı bazlı sahiplik; organizasyon yok

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Bağlam:** Ürün gerçek çok kullanıcılı ve izolasyonlu olacak; görev ekip/organizasyon üyeliği istemiyor.
- **Karar:** Her özel kaynak doğrudan bir kullanıcıya ait olacak. Organizasyon, membership, davet ve rol sistemi ilk sürümde bulunmayacak.
- **Alternatif:** Kullanıcının birden fazla organizasyona üye olduğu tenant modeli.
- **Gerekçe:** Gereksiz ürün ve yetkilendirme karmaşıklığını önlemek.
- **Sonuçlar:** Gelecekte ortak çalışma gerekirse personal workspace migration'ı ayrı proje olarak tasarlanır.

## D-004 — PostgreSQL tabanlı kalıcı iş kuyruğu

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** İlk sürümde scheduler, check jobs ve outbox PostgreSQL kullanacak; Redis/Kafka zorunlu olmayacak.
- **Gerekçe:** Hedeflenen ilk kapasite için yeterli, transaction sınırlarını basit ve yerel kurulumu küçük tutar.
- **Sonuçlar:** Kuyruk sorguları, indeksler, cleanup ve connection kullanımı yük testleriyle doğrulanmalıdır. Ölçülen ihtiyaç oluşursa broker eklenebilir.

## D-005 — Sabit cadence, backlog yok ve fencing token

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Bağlam:** Uzun çalışan kontroller çakışmamalı; server kapalıyken geçen süre düşüş veya iş yığını olmamalı.
- **Karar:** Schedule sabit cadence kullanır; `next_run_at` mevcut zamandan sonraki ilk planlı zamana ilerler. Kaçırılan tick'ler backfill edilmez. İşler lease, heartbeat, tek aktif iş kısıtı ve monoton fencing token taşır.
- **Gerekçe:** Paralel çalışma, stale sonuç ve restart sonrası thundering herd riskini azaltmak.
- **Sonuçlar:** Eski token'lı sonuç current state/incident'ı değiştiremez. Dış hedefte matematiksel exactly-once istek garantisi verilmez; yalnızca tek kabul edilmiş sonuç garantilenir.

## D-006 — Dört ayrı durum ekseni

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Execution (`ACTIVE/PAUSED`), health (`UNKNOWN/UP/SUSPECT/DOWN`), maintenance (`true/false`) ve freshness (`FRESH/STALE`) ayrı tutulacaktır.
- **Gerekçe:** `PAUSED`, `DOWN` ve `under maintenance` gibi aynı anda geçerli olabilen gerçekleri tek enum'a sıkıştırmamak.
- **Sonuçlar:** API ve frontend bu eksenleri ayrı alanlar olarak taşır.

## D-007 — İki başarısızlıkta incident

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Varsayılan eşik iki ardışık başarısızlıktır. İlk hata `SUSPECT`, ikinci hata `DOWN` üretir. Incident ikinci hatada oluşturulur fakat `started_at` ilk başarısız gözlemdir. İlk başarı incident'ı kapatır.
- **Gerekçe:** Tek ölçümlük geçici hatayı düşüş saymama gereksinimi ve anlaşılır başlangıç davranışı.
- **Sonuçlar:** Eşik ileride kullanıcı tarafından yapılandırılabilir; ilk sürümde sistem varsayılanı olabilir.

## D-008 — Zaman ağırlıklı availability ve ayrı coverage

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Availability tamamlanmış run sayılarının oranıyla değil, bilinen gözlem süresindeki UP/DOWN durum zaman çizelgesiyle hesaplanacak. UNKNOWN/no-data süreleri availability paydasından çıkarılıp coverage olarak ayrıca gösterilecek.
- **Alternatif:** Başarılı run / toplam run oranı.
- **Gerekçe:** Interval değişikliklerinin ağırlık hatasını ve monitoring kesintisinin hedef düşüşü sayılmasını önlemek.
- **Sonuçlar:** Rollup tasarımı response-time ve durum sürelerini ayrı ele alır.

## D-009 — Bakım kontrolleri durdurmaz, bildirimleri bastırır

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Bakım pencereleri UTC `[start, end)` aralığıdır. Kontroller ve state/incident hesapları devam eder. Örtüşen pencereler birleşir. Bakım sırasında normal e-posta gönderilmez; bakım sonunda hâlâ açık incident için DOWN gönderilir.
- **Sonuçlar:** Notification worker gönderim anında bakım durumunu tekrar doğrular. Önceden DOWN almış incident'ın bakım içindeki recovery'si bakım sonuna ertelenir.

## D-010 — Transactional outbox ve ayrı notification worker

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Incident değişimi ve outbox olayı aynı transaction'da yazılır. E-posta ayrı Node.js worker tarafından SMTP adapter üzerinden gönderilir. Yerelde Mailpit kullanılır.
- **Gerekçe:** SMTP arızasının monitoring akışını etkilememesi ve bildirim kaybının önlenmesi.
- **Sonuçlar:** Uygulama seviyesinde idempotency sağlanır; SMTP taşıması için matematiksel exactly-once vaat edilmez.

## D-011 — SSE ve REST snapshot

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Canlı güncelleme SSE ile; doğru başlangıç ve yeniden bağlanma durumu REST snapshot ile sağlanır. PostgreSQL `LISTEN/NOTIFY` yalnızca uyandırma sinyalidir.
- **Alternatifler:** WebSocket; yalnızca polling.
- **Gerekçe:** Akış esas olarak server'dan istemciye tek yönlüdür ve SSE daha küçük operasyonel yüzey sunar.
- **Sonuçlar:** Heartbeat, proxy buffering, connection limit ve polling fallback gerekir.

## D-012 — Partition edilmiş ham geçmiş ve rollup

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** `check_runs` zaman partition'larıyla, günlük/haftalık/aylık sorgular rollup tablolarıyla yönetilir. Current dashboard yalnızca current-state projection okur.
- **Gerekçe:** Kontrol sayısı ve veri yaşı arttığında UI sorgularını ham satır hacminden ayırmak.
- **Sonuçlar:** Partition lifecycle ve rollup işlemleri idempotent housekeeping işlerine ihtiyaç duyar.

## D-013 — Python predictor opsiyonel advisory bileşendir

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Python worker yalnızca feature/rollup verisini okuyup prediction tablolarına açıklanabilir risk sonucu yazar. Ana state, incident ve normal bildirimleri değiştiremez.
- **Gerekçe:** Python analiz ekosisteminden yararlanırken ana ürünün güvenilirliğini predictor'dan bağımsız tutmak.
- **Sonuçlar:** Predictor feature flag, ayrı DB rolü, küçük connection pool ve resource limit ile çalışır; ana sistem tamamlandıktan sonra uygulanır.

## D-014 — Public internet hedefleri ve sıkı SSRF koruması

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** İlk sürüm yalnızca public HTTP/HTTPS hedeflerini kontrol eder. Private/loopback/link-local/metadata adresleri engellenir. Redirect hedefleri yeniden doğrulanır ve bağlantı doğrulanmış IP'ye pinlenir.
- **Gerekçe:** Kullanıcı kontrollü URL'lerin internal network erişimine dönüşmesini önlemek.
- **Sonuçlar:** Private network monitoring gelecekte ayrı, kullanıcı ağına kurulan güvenilir probe mimarisi gerektirir.

## D-015 — Sabit ürün limiti yok, yapılandırılabilir koruma var

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Kaynak kodda 50 kontrol sınırı olmayacak. Deployment kapasitesine göre kullanıcı quota'sı, worker concurrency, hostname limiti ve rate limit yapılandırılabilir olacaktır.
- **Gerekçe:** 20/200/500 ve daha büyük kurulumlara aynı mimariyle uyum sağlarken kötüye kullanım ve noisy-neighbor etkisini önlemek.
- **Sonuçlar:** 20, 200 ve 500 kontrol performans profilleri test edilir; kapasite varsayılmaz, ölçülür.

## D-016 — Bir kontrol en fazla bir gruba aittir

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Check, sıfır veya bir gruba ait olabilir.
- **Gerekçe:** Grup durumu, grup bakım penceresi ve e-posta alıcılarında çakışan/tekrarlı semantiği önlemek.
- **Sonuçlar:** Çoklu etiketleme gerekirse group üyeliğinden ayrı tag sistemi eklenebilir.

## D-017 — Yerel ve üretim veri tabanı profilleri ayrıdır

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Yerel geliştirme tek PostgreSQL container ile çalışır. Üretim mimarisi managed/HA PostgreSQL, otomatik backup, PITR, restore testi, connection pooling ve açık RPO/RTO içerir.
- **Gerekçe:** Yerel kurulum kolaylığını üretim sürekliliği iddiasıyla karıştırmamak.
- **Sonuçlar:** Repository tam HA ortamını ayağa kaldırmak zorunda değildir; operasyon belgesi üretim beklentisini ve doğrulama yöntemini açıklar.

## D-018 — Manual run aktifken stateful, paused iken diagnostic'tir

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Bağlam:** Manuel kontrolün incident/availability davranışı özgün görevde açık değildir.
- **Karar:** ACTIVE check'te manual run normal observation state machine'e katılır fakat cadence'i değiştirmez. PAUSED check'te manual run diagnostic'tir ve health, incident, availability veya normal bildirimi değiştirmez.
- **Alternatifler:** Bütün manual run'ların diagnostic olması; paused check'te manual run'ı reddetmek.
- **Gerekçe:** Aktif kontrolde “şimdi kontrol et” beklentisini karşılamak, pause semantiğini ve history doğruluğunu korumak.
- **Sonuçlar:** Run ve job üzerinde manual mode açıkça saklanır.

## D-019 — Monitoring gap açık incident'ı kapatmaz, observed segment'i durdurur

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Bağlam:** Server/worker kesintisinin hedef sitenin düşüşü sayılmaması gerekir; ancak daha önce doğrulanmış incident'ın recovery'si de gözlemlenmemiştir.
- **Karar:** Freshness STALE olduğunda incident OPEN/UNOBSERVED kalır, aktif DOWN segment'i kapanır. Gap observed duration'a girmez. Sonraki FAIL yeni segment açar; sonraki PASS incident'ı recovery ile kapatır.
- **Alternatifler:** Incident'ı gap başlangıcında kapatmak; gap'i DOWN süresine eklemek.
- **Gerekçe:** Bildirim sürekliliğini korurken bilinmeyen zamanı sahte downtime yapmamak.
- **Sonuçlar:** Incident birden çok observed segment taşıyabilir; observed duration ile wall-clock span ayrılır.

## D-020 — Probe değişikliği health bağlamını ve açık incident'ı geçersiz kılar

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** URL, timeout, beklenen status/body veya eşdeğer probe davranışı değiştiğinde probe generation artar, eski sonuçlar state için reddedilir, health UNKNOWN olur ve açık incident CONFIG_CHANGED ile kapanır.
- **Gerekçe:** Farklı hedef veya başarı kriterlerini aynı health/incident sürekliliği içinde göstermemek.
- **Sonuçlar:** Daha önce DOWN teslimatı alan alıcılara recovery iddiasında bulunmayan açıklayıcı kapanış bildirimi üretilebilir.

## D-021 — Grup silme check'leri silmez

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Group silindiğinde check'ler ungrouped olur; grup maintenance/policy/public component etkisi sona erer.
- **Alternatif:** Grup ile bütün check'leri cascade silmek.
- **Gerekçe:** Yüksek etkili ve şaşırtıcı veri kaybını önlemek.
- **Sonuçlar:** Group delete transaction'ı check bağlantılarını güvenli biçimde kaldırmalı; gönderilmiş DOWN recipient kayıtları recovery için korunmalıdır.

## D-022 — Belirsiz SMTP sonucu otomatik yeniden gönderilmez

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Bağlam:** SMTP sunucusu mesajı kabul ettikten sonra bağlantı koparsa uygulama gönderimin gerçekleşip gerçekleşmediğini kesin bilemeyebilir.
- **Karar:** Sonucu kesin olmayan teslimat `DELIVERY_UNKNOWN` olur ve varsayılan olarak otomatik retry edilmez.
- **Alternatif:** Her belirsiz sonucu retry ederek olası duplicate kabul etmek.
- **Gerekçe:** Aynı incident için tekrarlı bildirim göndermeme beklentisini duplicate riskine tercih etmek.
- **Sonuçlar:** Operatör görünürlüğü ve gelecekte idempotency destekleyen provider adapter'ı gerekir.

## D-023 — State sırası üç farklı sürümle korunur

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Genel optimistic concurrency için resource version, probe anlamı için probe generation, scheduling anlamı için schedule generation ayrı tutulur. Worker attempt sırası ayrıca fencing token ile korunur.
- **Gerekçe:** Ad değişimi gibi zararsız editlerin geçerli observation'ı düşürmesini önlerken URL/pause gibi semantik değişikliklerin eski sonucu state'e uygulamasını engellemek.
- **Sonuçlar:** Job config snapshot bu sürümleri taşır; veritabanı şeması ve acceptance transaction'ı bunları atomik karşılaştırır.

## D-024 — Polyglot monorepo ve pnpm workspace

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Node uygulamaları ve ortak TypeScript paketleri tek pnpm workspace içinde; opsiyonel Python predictor aynı Git repository içinde fakat bağımsız Python ortamında tutulacaktır. Başlangıçta Turborepo veya Nx eklenmeyecektir.
- **Alternatifler:** Her runtime için ayrı repository; Turborepo/Nx ile ilk günden görev grafiği ve remote cache.
- **Gerekçe:** Atomik sözleşme değişiklikleri ve tek geliştirme akışı korunurken Python bağımlılık çözümünü Node ekosisteminden ayırmak; henüz ölçülmemiş build sorunları için ek orchestration katmanı taşımamak.
- **Sonuçlar:** Workspace sınırları import kurallarıyla korunur. Build süreleri ölçülen bir sorun olursa task orchestrator sonradan eklenebilir.

## D-025 — Node.js 24 LTS ve pnpm 11.25 araç tabanı

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Ana runtime Node.js 24 LTS, package manager pnpm 11.25 serisi olacaktır. Repository, CI ve container aynı doğrulanmış tam sürümleri kullanacaktır.
- **Gerekçe:** LTS runtime desteği, workspace protokolü, deterministik lockfile ve yerel ortamla uyumlu tekrarlanabilir kurulum sağlamak.
- **Sonuçlar:** Tam Node patch'i ve image digest'i Aşama 2 uygulamasında registry üzerinde doğrulanır. Major yükseltmeler ayrı değişiklik ve CI doğrulaması gerektirir.

## D-026 — Predictor için Python 3.14 ve uv

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Predictor CPython 3.14 serisi, `pyproject.toml`, pinlenmiş uv ve commit edilen `uv.lock` kullanacaktır. Tasarım günü yeni yayımlanan Python 3.15 ilk sürüm için seçilmemiştir.
- **Alternatifler:** Sistem Python'u ve pip/requirements dosyasını kullanmak; Python 3.15'e yayın gününde geçmek.
- **Gerekçe:** Cross-platform deterministik çözüm, bağımsız environment ve analitik paket ekosisteminde daha olgun uyumluluk tabanı sağlamak.
- **Sonuçlar:** Host Python kurulumu zorunlu değildir; predictor container profile ile çalışabilir. 3.15 geçişi bağımlılık ve performans doğrulaması sonrası değerlendirilir.

## D-027 — İki yerel çalışma modu ve opsiyonel prediction profile

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Günlük geliştirmede Node uygulamaları host'ta, PostgreSQL/Mailpit/hedef simülatörü container'da çalışır. Temiz ortam ve demo için tam container `app` profile; predictor için ayrı `prediction` profile bulunur.
- **Gerekçe:** Hızlı hot reload ile tekrarlanabilir full-stack doğrulamayı birlikte sağlamak ve predictor'ı ana stack'in başlangıç bağımlılığı yapmamak.
- **Sonuçlar:** Ana sistem prediction profile olmadan eksiksiz çalışmalıdır. Her iki çalışma modu CI/smoke testlerle korunur.

## D-028 — ESM, strict TypeScript ve kök komut sözleşmesi

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Karar:** Node kodu ESM ve strict TypeScript kullanacaktır. Kurulum, lint, format kontrolü, typecheck, test, build ve migration işlemleri repository kökünden platform bağımsız pnpm komutlarıyla sunulacaktır.
- **Gerekçe:** App'ler arasında aynı dil güvenliği ve geliştirici deneyimini sağlamak; Windows ve Linux akışlarının ayrışmasını önlemek.
- **Sonuçlar:** Bash-only package script'leri kullanılmaz. CI aynı kök komutları frozen lockfile ile çalıştıran ana enforcement noktasıdır.

## D-029 — Yerel altyapıda PostgreSQL 18.6 ve Mailpit 1.31.4

- **Tarih:** 2026-10-09
- **Durum:** Accepted
- **Bağlam:** Aşama 2 container altyapısının yeniden üretilebilir image sürümleriyle kurulması gerekir.
- **Karar:** Yerel Compose altyapısı `postgres:18.6-bookworm` ve `axllent/mailpit:v1.31.4` kullanacaktır. Host PostgreSQL portu mevcut `5432` çakışmasını önlemek için varsayılan `15432`, container ağı içinde standart `5432` olacaktır.
- **Alternatifler:** Floating `latest` tag'leri; mevcut başka projeye ait `5432` servisini durdurmak; rastgele host portu kullanmak.
- **Gerekçe:** Tekrarlanabilir image seçimi sağlamak, kullanıcının çalışan servislerine dokunmamak ve belgelenmiş kararlı bir bağlantı noktası korumak.
- **Sonuçlar:** Uygulamalar Compose içinde `postgres:5432`, host araçları `localhost:15432` kullanır. PostgreSQL 18 şema/extension uyumluluğu Aşama 3'te tekrar doğrulanır; release öncesinde image digest'leri pinlenir.

## D-030 — Araç sürümleri ecosystem peer sınırlarına göre birlikte pinlenir

- **Tarih:** 2026-10-10
- **Durum:** Accepted
- **Karar:** Node `24.19.0`, pnpm `11.25.0`, TypeScript `6.0.3` ve ilgili araçlar exact pinlenir. TypeScript 7, mevcut `typescript-eslint` peer aralığı dışında olduğu için kullanılmaz. ESLint `9.39.5`, `eslint-plugin-jsx-a11y` ESLint 10'u destekleyene veya eşdeğer erişilebilirlik kural seti doğrulanana kadar geçici uyumluluk pini olarak tutulur.
- **Gerekçe:** En yeni tekil sürümleri karıştırmak yerine birlikte çalışan, strict peer validation'dan geçen ve lockfile ile yeniden üretilebilen bir toolchain kullanmak.
- **Sonuçlar:** Deprecation/major yükseltmeleri bağımlılık botuyla körlemesine alınmaz; peer uyumluluğu, lint sonucu ve build birlikte doğrulanır.

## D-031 — Application ve prediction Compose profilleri arıza sınırıdır

- **Tarih:** 2026-10-10
- **Durum:** Accepted
- **Karar:** Ana Node süreçleri `app`, predictor ayrı `prediction` profilindedir. Ana servisler predictor'a `depends_on` veya readiness bağımlılığı taşımaz. Predictor CPU/bellek sınırı ve ayrı process/container ile çalışır.
- **Gerekçe:** Tahmin yan özelliğinin çökmesi, yavaşlaması veya kapalı olması monitoring ürününü durdurmamalıdır.
- **Sonuçlar:** Predictor health başarılıyken ve predictor durdurulduktan sonra API readiness'in devam ettiği smoke test ile doğrulanmıştır.

## D-032 — Kök kalite komutu açıkça `pnpm run ci` olarak çağrılır

- **Tarih:** 2026-10-10
- **Durum:** Accepted
- **Bağlam:** pnpm `ci` adını kendi temiz/frozen kurulum alias'ı olarak yorumlar ve aynı adlı package script'ini çalıştırmaz.
- **Karar:** Birleşik repository kalite kapısı `pnpm run ci` komutudur; GitHub Actions ve dokümantasyon açık `run` biçimini kullanır.
- **Sonuçlar:** `pnpm ci` bağımlılık kurulumu olarak kalır; kalite kapısı sanılıp testlerin atlanması önlenir.
