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

## D-033 — SQL-first PostgreSQL şeması ve tipli Kysely erişimi

- **Tarih:** 2026-10-10 01:13 +06:00
- **Durum:** Accepted — Aşama 3 migration setinde uygulandı
- **Bağlam:** RLS, roller, partition, partial index ve online constraint gibi PostgreSQL'e özgü yetenekler v1 veri bütünlüğünün merkezindedir.
- **Karar:** Migration'lar sürümlü ve checksum'lı düz SQL olacaktır. Uygulama sorguları `pg` transaction altyapısı üzerinde Kysely ile tipli yazılacaktır; ORM schema auto-sync kullanılmayacaktır.
- **Alternatifler:** Tam ORM migration üretimi; yalnız string tabanlı raw SQL repository; harici migration binary'si.
- **Gerekçe:** Üretim DDL'ini açık ve review edilebilir tutarken uygulama sorgularında TypeScript tip güvenliğini korumak; migration davranışını bir ORM sürümüne bağlamamak.
- **Sonuçlar:** Repository-owned runner advisory lock, checksum ledger, transaction/no-transaction ayrımı ve schema compatibility kontrolü uygular. Uygulanmış migration değiştirilmez; düzeltme yeni ileri migration'dır.

## D-034 — UUIDv7, doğrudan owner ve üç katmanlı tenant izolasyonu

- **Tarih:** 2026-10-10 01:13 +06:00
- **Durum:** Accepted — Aşama 3 migration setinde uygulandı
- **Karar:** Aggregate/event kimlikleri PostgreSQL 18 `uuidv7()` kullanır. Her private satır doğrudan `owner_id` taşır; composite owner foreign key, API authorization ve FORCE RLS birlikte uygulanır. Runtime rolleri tablo sahibi veya BYPASSRLS olmaz.
- **Alternatifler:** Sequence kimlik; yalnız API filtresi; owner'ı join zincirinden türetmek; bütün servislerde tek geniş DB rolü.
- **Gerekçe:** Global kimlik ve iyi index locality sağlamak, hatalı join/filter durumunda çapraz kullanıcı erişimini veritabanında da reddetmek ve servis arıza alanlarını yetkiyle sınırlamak.
- **Sonuçlar:** API private sorguları transaction-local user context gerektirir. Auth/public bootstrap yalnız dar security-definer fonksiyonlarla yapılır. RLS context sızıntısı ve çapraz-owner bağlar negatif integration testleriyle doğrulanır.

## D-035 — Current projection, immutable run ve açık interval ayrımı

- **Tarih:** 2026-10-10 01:13 +06:00
- **Durum:** Accepted — kalıcılık yapısı uygulandı; domain geçiş kodu sonraki aşamalardadır
- **Karar:** Dashboard check başına tek current-state projection'ı okur; her probe sonucu immutable run olarak yazılır. Tek açık/provisional availability aralığı ayrı `open_health_intervals` tablosunda, kapanmış geçmiş aylık partition'larda tutulur.
- **Alternatifler:** Dashboard'u ham run'lardan türetmek; current state ve run'ı tek tabloda tutmak; açık ve kapalı aralıkları tek partitioned tabloda saklamak.
- **Gerekçe:** Dashboard latency'sini geçmiş hacminden ayırmak, rejected/stale gözlemleri kaybetmemek ve partition sınırları arasında “check başına tek açık interval” invariant'ını PK ile korumak.
- **Sonuçlar:** Probe kabul transaction'ı run, state, interval, incident ve outbox'ı atomik günceller. Projection rebuild edilebilir; history append ağırlıklıdır.

## D-036 — Aylık raw partition, minute/hour rollup ve coverage ayrımı

- **Tarih:** 2026-10-10 01:13 +06:00
- **Durum:** Accepted — partition ve rollup tabloları uygulandı
- **Karar:** Raw runs ve yoğun zaman serileri UTC zamanına göre partition edilir; 24 saat/7 gün için minute, ay için hour rollup kullanılır. Availability yalnız UP+DOWN süresinden, coverage ise gözlemlenmiş sürenin istek aralığına oranından hesaplanır.
- **Alternatifler:** Bütün geçmişi tek tabloda tutmak; aylık sorguda raw run scan etmek; UNKNOWN süreyi DOWN kabul etmek; ilk günden ayrı time-series database kullanmak.
- **Gerekçe:** Check sayısını sabit 50 ile sınırlamadan retention ve sorgu maliyetini yönetmek, ay görünümünü bounded tutmak ve veri boşluğunu yanlış downtime'a çevirmemek.
- **Sonuçlar:** Partitioned primary key zaman kolonunu içerir; tam lineage için run primary key'i ve referansları `(owner_id,check_id,finished_at,run_id)` dörtlüsünü taşır. Default partition yalnız güvenlik ağıdır ve satır düşerse alarm üretir.

## D-037 — Forward-only migration ve doğrulanmış PITR/restore hedefi

- **Tarih:** 2026-10-10 01:13 +06:00
- **Durum:** Accepted — migration runner ve local restore provası uygulandı
- **Karar:** Production şema değişimleri expand/backfill/verify/switch/contract ve forward-fix yaklaşımıyla yapılır. İlk production süreklilik hedefi managed PostgreSQL üzerinde RPO ≤5 dakika, RTO ≤60 dakika, 14 günlük PITR ve en az üç aylık restore drill'dir.
- **Alternatifler:** Otomatik down migration; yalnız günlük dump; restore testi olmadan backup başarı bildirimi.
- **Gerekçe:** Veri kaybeden geri dönüşleri ve uzun kilitleri önlemek; yedeğin varlığını değil uygulama invariant'larıyla geri yüklenebilirliğini kanıtlamak.
- **Sonuçlar:** Runtime prosesleri migration çalıştırmaz; ayrı Compose/dağıtım işi önce tamamlanır. Şema uyumsuzluğu readiness'i düşürür. Local mantıksal restore provası başarılıdır; production RPO/RTO/PITR hedefleri gerçek production altyapısı kurulup sağlayıcı restore drill'i geçmeden sağlanmış sayılmaz.

## D-038 — NOLOGIN yetki rolleri ve deployment login wrapper'ları

- **Tarih:** 2026-10-10 02:24 +06:00
- **Durum:** Accepted — migration ve runtime pool yapılandırmasında uygulandı
- **Bağlam:** Servis yetkileri ile secret taşıyan login kimliklerini aynı rol yapmak rol rotasyonunu zorlaştırır. Local Compose'un tek bootstrap PostgreSQL hesabı ise geliştirme kolaylığı için korunmalıdır.
- **Karar:** Migration bütün schema/service rollerini `NOLOGIN`, `NOBYPASSRLS` yetki grubu olarak oluşturur. Local runtime connection başlangıcında ilgili dar role geçer. Production, her servis için yalnız gerekli role üye ayrı login wrapper ve ayrı secret sağlar; uygulama superuser ile bağlanmaz.
- **Alternatifler:** Her runtime rolünü doğrudan LOGIN yapmak; bütün servislerde tek geniş login; local ortamda her rol için ayrı secret zorunluluğu.
- **Gerekçe:** Yetki matrisi ile credential yaşam döngüsünü ayırmak, production secret rotasyonunu kolaylaştırmak ve local kurulumu tek komutlu tutarken SQL'in gerçek dar rol altında çalışmasını test etmek.
- **Sonuçlar:** Local `session_user` bootstrap hesabıdır ancak `current_user` dar service rolüdür. Entegrasyon testi bunu ve rolün private tablolardaki kısıtlarını doğrular. Production deployment login wrapper oluşturma işi altyapı runbook'unun sorumluluğudur.

## D-039 — OpenAPI 3.1 tabanlı URI-major REST ve açık komut endpoint'leri

- **Tarih:** 2026-10-10 02:57 +06:00
- **Durum:** Accepted — sözleşme ve üretim altyapısı uygulandı
- **Bağlam:** Frontend, API ve worker uygulamalarının birbirinden bağımsız ilerleyebilmesi; uzun süren işlerin HTTP lifecycle'ına bağlanmaması ve sözleşme drift'inin engellenmesi gerekir.
- **Karar:** Dış HTTP sözleşmesinin canonical kaynağı `docs/openapi-v1.yaml` olur. Private API `/api/v1`, public projection `/api/public/v1` altında kaynak yönelimli REST kullanır; pause/resume/manual-run/publish/rotate gibi durum geçişleri açık komut endpoint'leridir. Uzun işler `202` ile kalıcı makbuz döndürür.
- **Alternatifler:** GraphQL; yalnız RPC endpoint'leri; kod-first ve belgelenmeyen route'lar; manuel run tamamlanana kadar request'i açık tutmak.
- **Gerekçe:** Review edilebilir ve mock üretilebilir tek sözleşme sağlamak; cache/status/idempotency semantiğini HTTP ile açık ifade etmek; UI'ı worker gecikmesinden ayırmak.
- **Sonuçlar:** Runtime request/response validator ve TypeScript tipleri bu kaynaktan türetilecek veya CI conformance ile tek gerçek olarak korunacaktır. Breaking dış değişim yeni URI major version gerektirir.

## D-040 — ETag precondition, kalıcı idempotency receipt ve opaque cursor

- **Tarih:** 2026-10-10 02:57 +06:00
- **Durum:** Accepted — revision 7 receipt şeması uygulandı; endpoint kullanımı ilgili domain aşamalarında eklenecek
- **Bağlam:** İki açık istemci aynı kaynağı değiştirebilir; ağ retry'ları create/command yan etkisini çoğaltabilir; büyüyen geçmişte offset pagination kararsız ve pahalıdır.
- **Karar:** Mutable tekil kaynaklar güçlü `ETag: "rv-N"` döndürür ve mutation'lar `If-Match` ister. Retry edilebilir create/command'lar `Idempotency-Key` ile privacy-preserving subject+operation scope'unda kalıcı receipt kullanır. Listeler imzalı/opaque keyset cursor ile sayfalanır; response sayfa üst sınırı 100 ürün kotası değildir.
- **Alternatifler:** Last-write-wins; yalnız in-memory dedupe; offset pagination; bütün işlemlerin doğal idempotent olduğu varsayımı.
- **Gerekçe:** Sessiz veri kaybını, çift manual-run/mail/link rotation yan etkisini ve veri büyüdükçe pagination drift'ini önlemek.
- **Sonuçlar:** Eski migration'lar değiştirilmeden forward-only revision 7 ile `infra.api_idempotency_records` eklendi. Receipt, domain sonucu ve outbox aynı kısa transaction'da commit edilir; ayrıca kalıcı `PROCESSING`/lease state'i yoktur. Secret taşımayan response bounded/sanitize JSON olarak; tek-seferlik publish/rotation URL'si ise yalnız dedicated application key ile şifreli ve 24 saatlik blob olarak replay edilir. Eski ETag `412`, eksik ETag `428`, anahtarın farklı payload ile tekrarı `409` üretir. Anonymous receipt erişimi doğrudan tablo RLS'iyle açılmamıştır; Aşama 5 enumeration-safe auth akışında dar `security_api` fonksiyonuyla eklenecektir.

## D-041 — Tek problem-details zarfı ve görünmez sahiplik

- **Tarih:** 2026-10-10 02:57 +06:00
- **Durum:** Accepted — merkezi mapper ve temel HTTP sınır testleri uygulandı
- **Bağlam:** İstemcinin metne bağlı hata mantığı kurmaması, log korelasyonu yapabilmesi ve tenant/public token varlığının hata cevaplarından sızmaması gerekir.
- **Karar:** Bütün dış hatalar RFC 9457 uyumlu `application/problem+json` zarfı, stabil `code`, `request_id`, `retryable` ve gerektiğinde JSON Pointer alan hataları kullanır. Başka owner'a ait kaynak var olmayanla aynı `404`; geçersiz/disable/rotate edilmiş public token da aynı generic `404` olur.
- **Alternatifler:** Endpoint'e özel hata gövdeleri; database/exception mesajını geçirmek; cross-owner için `403`.
- **Gerekçe:** Frontend davranışını deterministik ve test edilebilir kılmak; enumeration ve iç altyapı sızıntısını azaltmak.
- **Sonuçlar:** Central error mapper zorunludur. Stack/SQL/secret/PII yalnız redakte edilmiş server loguna gider; her response `X-Request-Id` taşır.

## D-042 — SSE yalnız kaybedilebilir hızlandırma; REST snapshot source of truth

- **Tarih:** 2026-10-10 02:57 +06:00
- **Durum:** Accepted — dış sözleşme sabitlendi; runtime Aşama 13 kapsamındadır
- **Bağlam:** İki istemci otomatik güncellenmeli ancak kalıcı browser event replay altyapısı ve WebSocket karmaşıklığı ürün ihtiyacı değildir. PostgreSQL notification ve API replica restart'larında mesaj kaçabilir.
- **Karar:** Authenticated ve public SSE ayrı endpoint/projection kullanır. SSE event'i minimal invalidation/status bilgisidir; istemci stream'i önce açar, sonra REST snapshot alır, version ile buffer'ı uzlaştırır ve görünürken en geç 60 saniyede tekrar snapshot alır. `Last-Event-ID` tanısaldır, durable replay garantisi vermez.
- **Alternatifler:** WebSocket; event logunu browser'a durable replay etmek; yalnız polling; internal event payload'ını doğrudan yayınlamak.
- **Gerekçe:** Düşük operasyonel maliyetle hızlı güncelleme sağlarken doğruluğu kaybedilebilir sinyale bağlamamak ve private/public allowlist sınırını korumak.
- **Sonuçlar:** Heartbeat, bounded buffer, coalescing, `resync.required`, polling fallback ve proxy buffering ayarları sözleşmenin parçasıdır. Public SSE yalnız `status_page.updated` invalidation'ı taşır.

## D-043 — İç event'lerde transactional outbox ve at-least-once tüketim

- **Tarih:** 2026-10-10 02:57 +06:00
- **Durum:** Accepted — envelope allowlist'i uygulandı; producer/consumer davranışı ilgili domain aşamalarındadır
- **Bağlam:** Domain değişimi ile scheduler, notification, realtime ve predictor yan etkileri arasında dual-write boşluğu oluşmamalı; predictor veya e-posta arızası ana monitoring transaction'ını bloke etmemelidir.
- **Karar:** Domain event'i değişiklikle aynı transaction'da version'lı ortak envelope ile outbox'a yazılır. Teslim at-least-once, sıralama yalnız aggregate başına ve consumer idempotency anahtarı `event_id`dir. `LISTEN/NOTIFY` yalnız uyandırma sinyalidir.
- **Alternatifler:** Transaction sonrası doğrudan broker/HTTP çağrısı; exactly-once iddiası; global sıra; payload'a bütün aggregate/PII bilgisini gömmek.
- **Gerekçe:** Crash aralığında event kaybını engellemek, izole retry/dead-letter sağlamak ve opsiyonel bileşenleri ana akıştan ayırmak.
- **Sonuçlar:** Consumer receipt, retry/dead-letter ve schema-version davranışını uygular. Browser internal event'i görmez; owner/page-filtered dış projection kullanır.

## D-044 — OpenAPI tek kaynaktan deterministik tip ve runtime şeması üretimi

- **Tarih:** 2026-10-10 03:52 +06:00
- **Durum:** Accepted — Aşama 4 uygulamasında doğrulandı
- **Bağlam:** Elle tutulan OpenAPI, TypeScript DTO ve Fastify JSON Schema kopyaları zamanla ayrışabilir. Frontend'in tipleri ile backend'in runtime doğrulaması aynı dış sözleşmeden gelmelidir.
- **Karar:** `docs/openapi-v1.yaml` tek canonical kaynak olarak kalır. Pinlenmiş `openapi-typescript` 7.13.0 TypeScript tiplerini, repository-owned generator ise local referansları çözülmüş Fastify request/response şemalarını ve operation güvenlik metadata'sını üretir. Üretilmiş dosyalar commit edilir; `pnpm contracts:check` yeniden üretimle byte-level drift'i, 57 benzersiz operation'ı, local referansları, path parametrelerini ve CSRF/idempotency/If-Match matrisini doğrular.
- **Alternatifler:** DTO ve runtime şemalarını elle iki kez yazmak; kod-first OpenAPI; üretimi yalnız developer bilgisayarında çalıştırıp artifact'i commit etmemek; ilk günden kapsamlı API gateway/codegen platformu kurmak.
- **Gerekçe:** Review edilebilir YAML sözleşmesini korurken frontend ve backend'in bağımsız geliştirilmesini sağlamak, gizli drift'i CI'da erken yakalamak ve gereksiz platform katmanı eklememek.
- **Sonuçlar:** Generated dizini elle düzenlenmez ve lint'ten hariçtir; ancak format, TypeScript build/type-check ve drift kontrolünden geçer. OpenAPI'de bulunan fakat henüz domain aşaması gelmemiş route'lar çalışıyor sayılmaz. Uygulama sırasında saptanan health şeması farkı canonical sözleşmede çalışan `ok/unavailable + timestamp/version` modeliyle düzeltildi.

## D-045 — Stateful opaque session cookie ve katmanlı CSRF savunması

- **Tarih:** 2026-10-10 04:15 +06:00
- **Durum:** Accepted — Aşama 5 uygulamasında doğrulandı
- **Bağlam:** Browser oturumu revoke/rotation, parola resetinde bütün session'ları kapatma, iki eşzamanlı istemci ve tenant bağlamına güvenli kimlik üretme gerektirir. Cookie authentication tek başına CSRF riski taşır.
- **Karar:** JWT/localStorage yerine PostgreSQL'de yalnız SHA-256 digest'i tutulan 256-bit opaque session token ve `HttpOnly; Secure; SameSite=Strict` cookie kullanılacaktır. Absolute/idle expiry, periyodik rotation ve kısa parallel-request grace server-side uygulanır. Unsafe isteklerde session-bound HMAC CSRF token; bütün browser auth POST'larında exact Origin, Fetch Metadata, JSON-only ve dar credentialed CORS birlikte zorunludur.
- **Alternatifler:** Stateless JWT refresh token; browser storage bearer token; yalnız SameSite; yalnız CSRF token; framework stateless secure-session cookie'si.
- **Gerekçe:** Anında revoke ve parola-version invalidation sağlamak, XSS'te token okunmasını zorlaştırmak ve CSRF savunmasını tek header/cookie davranışına bağlamamak.
- **Sonuçlar:** Session lookup dar security-definer fonksiyondur. Local geliştirme dışında HTTPS/Secure cookie zorunludur. Logout idempotent `204`, reset bütün session'ları revoke eder; iki browser bağımsız session taşıyabilir.

## D-046 — Argon2id, 15 karakter tabanı ve bounded hash kapasitesi

- **Tarih:** 2026-10-10 04:15 +06:00
- **Durum:** Accepted — Aşama 5 uygulamasında doğrulandı
- **Bağlam:** Parola saklama offline saldırıya dirençli olmalı; pahalı doğrulama ise event loop'u veya API belleğini abuse altında tüketmemelidir. Kullanıcı enumeration timing farkı da oluşmamalıdır.
- **Karar:** PHC encoded Argon2id için başlangıç tabanı `m=19456 KiB,t=2,p=1`, 16-byte salt ve 32-byte output'tur; production benchmark ile yalnız yukarı yönlü ayarlanır. Parola minimum 15 code point, maksimum 128; composition/periyodik rotation yoktur. Pinlenmiş `zxcvbn-ts` common/English sözlükleriyle offline değerlendirilen 0–2 skorları reddedilir. Async hash/verify instance başına bounded concurrency/queue ile çalışır; bilinmeyen kullanıcı aynı maliyetli dummy hash yolunu kullanır.
- **Alternatifler:** bcrypt/PBKDF2; hızlı SHA-256; yalnız uzunluk; sync hash; sınırsız paralel hash; provider'a bağlı online breach sorgusu.
- **Gerekçe:** Güncel OWASP/NIST tabanlarıyla güçlü offline direnç, parola yöneticisi uyumu ve kontrollü kaynak tüketimi sağlamak.
- **Sonuçlar:** OpenAPI parola alt sınırı 12'den 15'e çıkarılır. İlk uygulama tercihi pinlenmiş `@node-rs/argon2`, `@zxcvbn-ts/core`, `@zxcvbn-ts/language-common` ve `@zxcvbn-ts/language-en` olur; package/platform/supply-chain doğrulaması dependency eklenirken kayda alınır. V1 pepper kullanmaz; KMS pepper ayrı threat model gerektirir.

## D-047 — Auth mutation'larında dar DB fonksiyonları ve PostgreSQL rate limit

- **Tarih:** 2026-10-10 04:15 +06:00
- **Durum:** Accepted — Aşama 5 uygulamasında doğrulandı
- **Bağlam:** API rolünün auth tablolarına genel erişimi privilege sınırını zayıflatır. Process-memory rate limit birden fazla replica arasında tutarlı değildir; yalnız Redis eklemek ise mevcut v1 mimarisine yeni zorunlu dependency getirir.
- **Karar:** Register, challenge issue/consume, session create/resolve/rotate/revoke ve password reset işlemleri fixed-search-path security-definer fonksiyonlarla atomik yürütülür. API auth tablolarında geniş DML almaz. Auth rate limit sayaçları raw e-posta/IP yerine HMAC subject ile PostgreSQL'de atomik fixed-window olarak tutulur; minute + hour/day pencereleri birlikte uygulanır.
- **Alternatifler:** API'ye auth schema CRUD yetkisi; yalnız uygulama transaction'ı; process-memory limiter; ilk günden Redis; rate limit'i yalnız edge'e bırakmak.
- **Gerekçe:** Least privilege ve transaction atomikliğini korumak, iki API replica'sında aynı abuse sınırını elde etmek ve v1 operasyon yüzeyini sade tutmak.
- **Sonuçlar:** Forward-only revision 8 session/sayaç/fonksiyon temelini, revision 10 anonim idempotency yüzeyini, revision 11 profil ve rehash sınırını ekledi. Rate-limit storage hatasında auth mutation fail-closed olur; yüksek hacimli DDoS için yine production edge/WAF gerekir.

## D-048 — Auth e-postaları için ayrı, encrypted durable delivery kuyruğu

- **Tarih:** 2026-10-10 04:15 +06:00
- **Durum:** Accepted — Aşama 5 uygulamasında doğrulandı
- **Bağlam:** Verification/reset e-postası request transaction'ında SMTP'ye bağlanırsa provider arızası kayıt/reset akışını bloke eder; yalnız token digest'i saklamak ise process crash sonrasında linki tekrar üretmeye yetmez. Incident notification tabloları auth challenge semantiğine sahip değildir.
- **Karar:** `notification.transactional_email_deliveries`, one-time challenge'a bağlı ayrı durable queue olacaktır. Raw token yalnız AES-256-GCM encrypted, version'lı ve kısa ömürlü template payload içinde saklanır. Notification worker dar claim/complete yüzeyiyle gönderir; bounded retry, fencing ve `DELIVERY_UNKNOWN` semantiği kullanır.
- **Alternatifler:** API'den senkron SMTP; raw token'ı outbox JSON'una yazmak; incident delivery tablolarını zorla yeniden kullanmak; commit sonrası fire-and-forget çağrı.
- **Gerekçe:** SMTP'yi auth/monitoring arıza alanından ayırmak, crash sonrasında teslimi sürdürebilmek ve secret'ı log/event/veritabanında plaintext bırakmamak.
- **Sonuçlar:** Mailpit aynı adapter'ın local uygulamasıdır. Encryption key version'lı secret store key ring'inden gelir; expired challenge payload'ı bounded retention ile silinir. E-posta gönderim hatası daha önce kabul edilmiş generic `202` response'unu değiştirmez.

## D-049 — Uygulanmış auth migration'larında forward-fix ve profil sınırı

- **Tarih:** 2026-10-10 04:53 +06:00
- **Durum:** Accepted — migration ve temiz veritabanı testinde doğrulandı
- **Bağlam:** Revision 8 yerel veritabanına uygulandıktan sonra sıfırdan entegrasyon testi notifier rolünün `security_api` schema `USAGE` yetkisinin eksik olduğunu gösterdi. Ayrıca anonymous receipt ve `/me` profil mutation yüzeylerinin ayrı dar fonksiyonları gerekiyordu.
- **Karar:** Uygulanmış revision 8 checksum geçmişi değiştirilmeyecek. Grant düzeltmesi revision 9, anonymous idempotency revision 10, optimistic profile mutation ve yarış güvenli password rehash revision 11 olarak ileri migration'larla eklenecek.
- **Alternatifler:** Revision 8'i sessizce yeniden yazmak; notifier'a geniş schema/table yetkisi vermek; profile update için auth tablosuna genel DML açmak.
- **Gerekçe:** Migration ledger güvenini ve least-privilege sınırını korurken temiz kurulum ile mevcut kurulumun aynı son duruma ulaşmasını sağlamak.
- **Sonuçlar:** Schema head 11'dir. API ve notifier yalnız allowlist security-definer fonksiyonlarını çağırır; sıfırdan ve mevcut veritabanı upgrade yolları aynı entegrasyon paketinde doğrulanır.

## D-050 — Check/group komutlarında tek owner transaction ve üç ayrı sürüm ekseni

- **Tarih:** 2026-10-10 06:52 +06:00
- **Durum:** Accepted — Aşama 6 uygulaması için kullanıcı onayladı
- **Bağlam:** Aynı check'i iki sekme değiştirebilir; config değişimi job, current state, incident, audit ve outbox üzerinde birbirine bağlı sonuçlar doğurur. Tek bir genel version ise probe ile schedule geçerliliğini ayıramaz.
- **Karar:** Her mutation transaction-local owner context içinde, gerekli satır kilitleri ve güçlü `If-Match` precondition ile çalışacaktır. Gerçek bir HTTP mutation `resource_version`ı bir kez; içerdiği kategoriye göre `probe_generation` ve `schedule_generation`ı en fazla birer kez artıracaktır. Config/state/job/audit/outbox/idempotency receipt tek transaction'da commit edilecektir.
- **Alternatifler:** Last-write-wins; her tabloyu ayrı commit etmek; yalnız timestamp ile stale sonuç ayırmak; bütün değişikliklerde bütün generation'ları artırmak.
- **Gerekçe:** İki istemcide veri kaybını ve yarım state'i önlemek; probe anlamı, cadence ve browser ETag'ini birbirinden bağımsız doğrulamak.
- **Sonuçlar:** No-op komut güncel precondition'ı doğrular fakat sürüm/event üretmez. Combined PATCH tek resource version ile birden fazla redacted event çıkarabilir; consumer version'ı non-decreasing yorumlar.

## D-051 — URL için API canonicalization ve execution-time SSRF doğrulaması birlikte zorunludur

- **Tarih:** 2026-10-10 06:52 +06:00
- **Durum:** Accepted — Aşama 6 uygulaması için kullanıcı onayladı
- **Bağlam:** API içinde DNS çözmek hedef latency'sini kullanıcı mutation'ına bağlar ve DNS rebinding'i yine engellemez. Yalnız runtime kontrol ise bariz localhost/private literal hatalarını geç fark ettirir.
- **Karar:** API mutlak HTTP(S) URL'yi canonicalize eder; credential, local isim ve private/reserved literal'ları reddeder, fragment'i saklamaz. Hostname A/AAAA ve her redirect hedefi Aşama 7'de bağlantı IP'si pinlenerek yeniden doğrulanır. API kabulü execution izni sayılmaz.
- **Alternatifler:** Create sırasında tek DNS lookup; yalnız regex; private hedeflere izin vermek; yalnız API-time kontrol.
- **Gerekçe:** Hızlı ve deterministik CRUD ile SSRF/DNS-rebinding güvenliğini birlikte sağlamak.
- **Sonuçlar:** Public DNS'in private adrese çözülmesi API'yi bloke etmez fakat probe bağlantısı `BLOCKED_TARGET` olur. URL/query hiçbir log, audit veya event payload'ına girmez.

## D-052 — Manuel çalışma doğrudan durable job veya tek coalesced intent üretir

- **Tarih:** 2026-10-10 06:52 +06:00
- **Durum:** Accepted — Aşama 6 uygulaması için kullanıcı onayladı
- **Bağlam:** “Şimdi çalıştır” HTTP probe'unu request içinde bekletemez; aynı check çalışırken tekrar talepler paralel iş veya sınırsız backlog üretmemelidir.
- **Karar:** Aktif job yoksa API transaction'ı snapshot'lı `PENDING + MANUAL` job yaratır. Aktif job varsa yeni job yerine check üzerinde en fazla tek `manual_requested_at` niyeti tutulur. ACTIVE check modu STATEFUL, PAUSED check modu DIAGNOSTIC'tir; cadence değişmez. Endpoint `If-Match`, kalıcı idempotency receipt ve owner/check rate limit ister.
- **Alternatifler:** Senkron probe; her tıklamada job; yalnız volatile process queue; paused manual run'ı reddetmek.
- **Gerekçe:** API latency'sini hedeften ayırmak, restart sonrası isteği kaybetmemek ve check başına paralellik invariant'ını korumak.
- **Sonuçlar:** Response `202 ENQUEUED/COALESCED` olur. Job tamamlayan scheduler en fazla bir pending niyeti tüketir; partial unique index yarışın son bariyeridir.

## D-053 — Kaynak sayısı sabit ürün limiti değil, yapılandırılabilir owner kotasıdır

- **Tarih:** 2026-10-10 06:52 +06:00
- **Durum:** Accepted — Aşama 6 uygulaması için kullanıcı onayladı
- **Bağlam:** Görevdeki 50 kontrol performans örneğidir; sistem 20, 200 veya 500 check ile çalışabilmelidir. Limitsiz create ise tek owner'ın ortak veritabanı ve worker kapasitesini tüketmesine izin verir.
- **Karar:** Check/group live count kotası deployment-configurable owner sınırıdır; kaynak kodunda gizli `50` yoktur. Create transaction owner+resource advisory lock altında count+insert yapar. Quota rate limit ve worker concurrency'den ayrı tutulur; aşım `409 quota_exceeded` olur.
- **Alternatifler:** Hard-coded 50; hiç kota olmaması; yalnız UI kontrolü; ilk sürümde billing/plan tabloları.
- **Gerekçe:** Değişken kapasite hedefini korurken çok kullanıcılı sistemde adil ve replica-safe operasyonel sınır sağlamak.
- **Sonuçlar:** Limit config ile değişir ve 20/200/500 fixture'larıyla test edilir. Owner/plan override gerçek ürün ihtiyacı oluşursa ayrı operator-controlled model olarak eklenir.

## D-054 — Grup silme atomik soft-delete ve version'lı ungroup işlemidir

- **Tarih:** 2026-10-10 06:52 +06:00
- **Durum:** Accepted — Aşama 6 uygulaması için kullanıcı onayladı
- **Bağlam:** Grup silindiğinde check'ler korunmalıdır; eşzamanlı move/delete yarışı silinmiş gruba bağlı check veya sessiz istemci overwrite'ı bırakmamalıdır.
- **Karar:** Group ve child check'ler deterministik sırayla kilitlenir. Group soft-delete edilir; bütün canlı child check'ler aynı transaction'da ungrouped olur ve her check'in `resource_version`ı artar. Probe/schedule generation değişmez; check başına redacted group-change event'i üretilir.
- **Alternatifler:** Cascade check delete; group ID'yi check'lerde bırakmak; asenkron/batch ungroup; child ETag'lerini değiştirmemek.
- **Gerekçe:** AC-029'u veri kaybetmeden ve yarışa dayanıklı biçimde sağlamak; bakım/bildirim/public kapsamını açıkça sonlandırmak.
- **Sonuçlar:** Fan-out owner kotasıyla bounded'dır. Açık istemci eski check ETag'iyle update yaparsa `412` alır; notification history fiziksel silinmez.

## D-055 — OpenAPI runtime yolu framework sözdizimine generator'da çevrilir

- **Tarih:** 2026-10-10 07:47 +06:00
- **Durum:** Accepted — parametrik group route testleriyle doğrulandı
- **Bağlam:** Canonical OpenAPI yolları `{group_id}` biçimini kullanır; Fastify parametrik route için `:group_id` bekler. Şablonu aynen runtime kaydına taşımak route'u literal yaparak gerçek UUID isteklerini 404'e düşürür.
- **Karar:** OpenAPI YAML canonical ve framework bağımsız kalacaktır. Runtime artifact generator'ı doğrulanmış `{name}` path parametrelerini Fastify `:name` biçimine deterministik çevirecektir; generated dosyalar elle değiştirilmeyecektir.
- **Alternatifler:** YAML'de framework'e özel colon sözdizimi; her handler'da elle path yazmak; generated path'i handler'da ad hoc dönüştürmek.
- **Gerekçe:** Tek sözleşme kaynağını korumak, 57 operation boyunca aynı adaptasyonu uygulamak ve sözleşme/route drift'ini testle yakalamak.
- **Sonuçlar:** Parametrik bütün mevcut ve gelecek API route'ları düzeltmeden yararlanır. Generator drift kontrolü dönüşümü korur; route testleri gerçek UUID yolunu kullanır.

## D-056 — Check state komutları için revision 13 dar yetki forward-fix'i

- **Tarih:** 2026-10-10 08:22 +06:00
- **Durum:** Accepted — gerçek PostgreSQL check service testleriyle doğrulandı
- **Bağlam:** Revision 12 API'ye current-state ve job mutation yüzeyi verdi; ancak onaylanan probe-change, pause ve delete semantiği açık incident segmentini ve health interval'ını aynı transaction'da kapatmayı gerektiriyordu. API rolünün bu tablolarda yalnız SELECT yetkisi vardı.
- **Karar:** Uygulanmış revision 12 değiştirilmeyecek. Forward-only revision 13 API rolüne incident kapanış/suspension kolonlarında column-level UPDATE, incident segment kapanış kolonlarında column-level UPDATE, open health interval için INSERT/DELETE ve satır kilidine yetecek yalnız `updated_at` UPDATE, finalized health interval için INSERT verir.
- **Alternatifler:** Belgelenen state yan etkilerini sonraki worker'a ertelemek; API'ye monitoring tablolarında genel UPDATE vermek; revision 12 checksum'ını değiştirmek; security-definer command fonksiyonları eklemek.
- **Gerekçe:** Config/state/job/audit/outbox atomikliğini korumak, least privilege sınırını bozmamak ve migration ledger geçmişini immutable tutmak.
- **Sonuçlar:** API hâlâ run kaydı, accepted observation alanları, worker lease/fencing veya probe sonucu yazamaz. Revision 13 sıfırdan ve reset migration testlerine dahil edildi; check command transition'ları gerçek rol altında doğrulandı.

## D-057 — OpenAPI 3.1 write composition runtime için draft-07'ye çevrilir

- **Tarih:** 2026-10-10 08:22 +06:00
- **Durum:** Accepted — check route ve contract drift testleriyle doğrulandı
- **Bağlam:** Canonical `CheckCreate`/`CheckPatch`, ortak alanları `allOf` ile birleştirirken unknown field engeli için OpenAPI 3.1 `unevaluatedProperties:false` kullanır. Fastify'ın varsayılan Ajv draft-07 derleyicisi bu keyword'ü strict modda reddederek route registration'ı durdurdu.
- **Karar:** Canonical OpenAPI 3.1 belgesi ve generated client tipleri değişmeden kalır. Runtime artifact generator yalnız tamamı object olan basit `allOf + unevaluatedProperties` composition'ını property/required/constraint'leri birleştirerek eşdeğer draft-07 `additionalProperties:false` objesine dönüştürür.
- **Alternatifler:** Fastify Ajv strict modunu kapatmak; unknown alanları kabul etmek; canonical şemada alanları kopyalamak; elle route schema yazmak; bütün runtime'ı farklı JSON Schema draft'ına geçirmek.
- **Gerekçe:** Kapalı request gövdesi güvenliğini ve tek canonical sözleşme kaynağını korurken framework adaptasyonunu deterministik generator sınırında tutmak.
- **Sonuçlar:** Unknown field doğrulaması çalışmaya devam eder; public OpenAPI/TypeScript anlamı değişmez. Generator testi flattened runtime şemasını, drift kapısı ise generated artifact'i korur.

## D-058 — Yönetim UI'ı generated tipler ve açık server-state uzlaştırması kullanır

- **Tarih:** 2026-10-10 09:42 +06:00
- **Durum:** Accepted — unit ve iki-session Playwright akışıyla doğrulandı
- **Bağlam:** Aşama 6 yönetim ekranı create/list/edit/delete ve komutları aynı cookie session üzerinden yürütür. İki sekme aynı resource version'ı okuyabilir; UI'ın stale mutation'ı sessizce ezmemesi ve API sözleşmesinden ayrı DTO üretmemesi gerekir.
- **Karar:** UI, canonical OpenAPI'den üretilen TypeScript tiplerini kullanan küçük bir credentialed fetch adapter'ı üzerinden konuşacaktır. Yeni bir global state/query bağımlılığı eklenmeyecek; bu aşamanın sınırlı server-state'i component sınırında tutulacaktır. Her mutation CSRF ve gereken yerde idempotency/`If-Match` taşır. `412` durumunda yerel taslak otomatik merge edilmeyecek, güncel listeler yeniden alınacak ve kullanıcı çatışma konusunda bilgilendirilecektir.
- **Alternatifler:** Elle çoğaltılmış frontend DTO'ları; last-write-wins; taslağı sessizce yeniden gönderme; bu dilim için Redux/React Query benzeri yeni state bağımlılığı eklemek.
- **Gerekçe:** Contract drift ve sessiz veri kaybını önlemek; bağımlılık/yüzey alanını mevcut ekran karmaşıklığıyla orantılı tutmak; daha sonra SSE/polling eklendiğinde uzlaştırma sınırını görünür bırakmak.
- **Sonuçlar:** Bir 412 sonrasında kullanıcı değişikliği otomatik korunmaz, bilinçli olarak yeniden uygulanır. Aşama 13 canlı veri ve cache ihtiyacı somutlaştığında query-cache seçimi yeniden değerlendirilecektir. Browser kabul testi CORS method allowlist'inin API mutation sözleşmesiyle explicit hizalanması gerektiğini de ortaya koymuştur.

## D-059 — DNS çözümü doğrulanmış aday setine pinlenir

- **Tarih:** 2026-10-10 10:01 +06:00
- **Durum:** Accepted — Aşama 7 uygulama ve testleriyle doğrulandı
- **Bağlam:** URL'yi doğrularken görülen DNS cevabı ile socket açılırken yapılan ikinci çözüm farklılaşırsa DNS rebinding private/metadata hedeflerine erişim sağlayabilir. Yalnız API zamanında private literal engellemek runtime DNS ve redirect riskini çözmez.
- **Karar:** Her request/redirect hop'u bir kez çözülür; bütün A/AAAA cevapları normalize edilip public-address policy'den geçer. Tek blocked cevap tüm hop'u fail-closed engeller. Connector yalnız immutable doğrulanmış aday setini kullanır ve yeni DNS çağrısı yapamaz. TLS hostname/SNI kontrolü URL hostname'ine karşı devam eder.
- **Alternatifler:** URL kabulünde tek DNS kontrolü; bağlantı sırasında normal sistem resolver'ına yeniden bırakmak; mixed cevapta yalnız public adresi seçmek; sadece RFC1918 denylist'i.
- **Gerekçe:** Validation-to-connect yarışını kapatmak, IPv4/IPv6 ve redirect'lerde aynı güvenlik invariant'ını korumak ve AC-100/101'i socket seviyesinde kanıtlamak.
- **Sonuçlar:** Resolver ve connector ayrı test edilebilir portlardır. Rebinding test double'ı resolver call count ve connector candidate setini doğrular. Raw DNS/IP bilgisi loglanmaz.

## D-060 — Probe tek total deadline ve bounded streaming kullanır

- **Tarih:** 2026-10-10 10:01 +06:00
- **Durum:** Accepted — Aşama 7 uygulama ve testleriyle doğrulandı
- **Bağlam:** Hop/faz başına sıfırlanan timeout redirect veya dual-stack denemeleriyle kullanıcı bütçesini aşar. Full-body buffer ise büyük/sonsuz/sıkıştırılmış yanıtların worker belleğini tüketmesine ve yavaş hedefin diğerlerini etkilemesine yol açar.
- **Karar:** Job `timeout_ms` değeri DNS'ten body EOF'a kadar tek monotonic deadline'dır. Alt timeout'lar yalnız kalan bütçeyi daraltır. Header, wire body ve decoded body ayrı hard cap'lerle streaming işlenir; expected substring bounded streaming matcher ile aranır ve ham body hiçbir katmana çıkmaz.
- **Alternatifler:** Her faza tam timeout; yalnız Undici default timeout'ları; response'u string/buffer olarak toplamak; expected text bulununca socket'i başarı sayıp bırakmak.
- **Gerekçe:** Deterministik kullanıcı semantiği, bounded kaynak kullanımı ve hang/slow hedeflerin bağımsız iptali.
- **Sonuçlar:** Caller cancellation altyapı sonucu, deadline target `TIMEOUT` sonucudur. Status-only probe da bounded biçimde EOF'a kadar okur. Size/timeout/error precedence test matrisiyle sabitlenir.

## D-061 — Public-only direct egress ve kısa ömürlü per-hop client

- **Tarih:** 2026-10-10 10:01 +06:00
- **Durum:** Accepted — Aşama 7 uygulama ve testleriyle doğrulandı
- **Bağlam:** Ambient proxy ayarları, geniş connection pool'u veya genel private-network geliştirme bayrağı doğrulanmış egress sınırını görünmez biçimde değiştirebilir. Docker target simulator ise local demo için private adres gerektirir.
- **Karar:** V1 yalnız public HTTP/HTTPS hedeflere, operator-controlled port allowlist'i üzerinden ve proxy kullanmadan bağlanır. Her redirect hop'u frozen candidate setine bağlı kısa ömürlü Undici client kullanır. Test/local simulator erişimi yalnız production'da reddedilen exact origin allowlist'iyle sağlanır; wildcard/CIDR private bypass yoktur.
- **Alternatifler:** Global keep-alive pool; `ALLOW_PRIVATE=true`; proxy env'lerini otomatik kullanmak; simulator için production policy'yi gevşetmek.
- **Gerekçe:** Cross-job stale DNS/connection state'ini ve konfigürasyon kaynaklı SSRF bypass'ını azaltmak; local kanıtlanabilirliği dar bir istisnayla korumak.
- **Sonuçlar:** Keep-alive performansından bilinçli taviz verilir ve 20/200/500 profili Aşama 9'da ölçülür. Gerekirse güvenli pool ayrı ADR ister. Production, development origin istisnasıyla fail-fast olur.
