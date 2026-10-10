# AI Kullanımı

**Son güncelleme:** 2026-10-10 15:11 +06:00

## Araç ve model

Proje, Codex desktop uygulamasındaki OpenAI GPT-5 ailesi bir coding agent ile geliştirilmektedir. Codex; repository dosyalarını inceleme/değiştirme, terminal komutları çalıştırma, testleri yürütme, Git işlemleri ve GitHub Actions sonuçlarını doğrulama için seçildi. Aynı çalışma alanında kod, test ve belgeleri birlikte ele alabilmesi kararların uygulanmış sonuçlarla karşılaştırılmasını kolaylaştırır.

## Çalışma biçimi

- İnsan geliştirici ürün yönünü, kapsamı ve aşama onaylarını belirler.
- AI ajanı seçenekleri analiz eder, mimari taslakları ve uygulamayı hazırlar, testleri çalıştırır ve sonuçları raporlar.
- Önemli kararlar zaman damgasıyla `docs/DECISIONS.md`; çalışma akışı `docs/DEVELOPMENT_LOG.md`; doğrulanan ve eksik kapsam `docs/PROJECT_STATUS.md` içinde tutulur.
- Canonical gereksinimler `AGENTS.md`, `docs/REQUIREMENTS.md` ve `docs/ACCEPTANCE_CRITERIA.md` içindedir. AI önerileri bu kaynaklara ve çalışan test sonuçlarına karşı kontrol edilir.
- Prompt/oturum dışa aktarımı teslimde ayrıca eklenebilir; bu belge önemli istemlerin içerik özetini taşır ve secret/kişisel veri içermez.

## Önemli istem ve karar özeti

1. Projenin enterprise seviyede fakat gereksiz mikroservisleşmeden kurulması istendi; modüler monolit ve ayrı, arıza izolasyonlu Python predictor seçildi.
2. Gerçek çok kullanıcılı kullanıcı sahipliği istendi; organizasyon üyeliği bilinçli olarak v1 dışında bırakıldı.
3. Kalıcı veri, API sözleşmesi ve kimlik doğrulama her biri önce nihai mimari belgesi, sonra uygulama ve kanıt kapılarıyla ayrı aşamalara bölündü.
4. Aşama 5'te opaque session, Argon2id, CSRF/origin savunması, PostgreSQL rate limit, encrypted durable auth e-postası ve Mailpit doğrulaması uygulandı.
5. Uygulama sırasında temiz veritabanında bulunan notifier schema grant eksikliği, uygulanmış migration değiştirilmeden yeni forward-only migration ile giderildi.
6. Aşama 6'da check/group kapsamı önce nihai mimariye ayrıldı; ilk uygulama dilimi domain/migration temeli, ikinci dilim authenticated group API olarak küçük commit ve gerçek PostgreSQL kanıtlarıyla ilerletildi.
7. Group route testleri OpenAPI-to-Fastify parametrik yol uyumsuzluğunu ortaya çıkardı; AI önerisi generator seviyesinde düzeltilip contract drift ve gerçek UUID route testleriyle doğrulandı.
8. Aşama 8'de onaylanan sağlık/incident mimarisi saf TypeScript reducer'a dönüştürüldü. AI; acceptance precedence, iki-failure threshold, provisional interval çözümleme, incident gap süreleri ve read-time freshness için sequence/regresyon testleri üretti; sonuçlar strict typecheck ve gerçek PostgreSQL ile doğrulandı.
9. Aşama 9 scheduler/worker mimarisi hazırlanırken AI mevcut migration, API komutları, probe motoru ve sağlık reducer'ı arasındaki kilit/cancellation sınırlarını birlikte inceledi. Bu inceleme sonucunda check-first kanonik kilit sırası, çalışan iş için durable cancellation acknowledgement ve coalesced manuel isteğin modunu koruyan kalıcı intent tasarımı seçildi; kodlama kullanıcı onayından sonraki tura bırakıldı.
10. Aşama 9'un ilk uygulama diliminde AI revision 14, typed worker config ve ortak activation-aware outbox writer'ı hazırladı. Gerçek PostgreSQL testi helper'ın `INSERT ... RETURNING` nedeniyle API rolünden gereksiz `SELECT` istediğini gösterince rolü genişletmek yerine helper yalnız mevcut dar `INSERT` yetkisiyle çalışacak şekilde düzeltildi.
11. Aşama 9'un ikinci uygulama diliminde AI sabit cadence/deterministik retry yardımcılarını ve check-first PostgreSQL job queue adapter'ını uyguladı. Owner-fair seçim pencere fonksiyonuyla global limitten önce hesaplandı; iki worker yarışı, attempt lineage, monoton fence, conditional start/heartbeat ve cancellation görünürlüğü gerçek PostgreSQL üzerinde doğrulandı.
12. Aşama 9'un üçüncü uygulama diliminde AI process-secret HMAC anahtarlı owner/hostname slotları, global-owner-host bounded concurrency, active-task registry, strict snapshot decode, lease heartbeat/cancellation abort ve typed result/fault sink sınırı olan probe dispatcher'ı uyguladı. Atomik result sink henüz bulunmadığı için production polling loop'unu erken aktive etmeyerek `RUNNING` job bırakma ve sonuç kaybı riski önlendi.
13. Aşama 9'un dördüncü uygulama diliminde AI cancellation acknowledgement, typed infrastructure retry/DEAD ve owner-fair expired-lease recovery'yi check→job→attempt kilit sırasıyla uyguladı. PostgreSQL testi gerçek request timestamp'inin sürücüde mikrosaniyeden milisaniyeye yuvarlanması nedeniyle eski manual-intent temizleme eşitliğinin hatalı olduğunu yakaladı; satır zaten kilitli olduğundan kırılgan timestamp karşılaştırması kaldırıldı ve coalesced intent'in terminal geçişle aynı transaction'da materialize edilmesi doğrulandı.
14. Aşama 9'un beşinci uygulama diliminde AI probe sonucunu saf reducer'a bağlayan atomik observation adapter'ını uyguladı. Concurrent duplicate writer, manual-intent materialization, PASS/FAIL incident geçişleri, diagnostic/cancellation reddi, rollback ve payload redaction gerçek PostgreSQL üzerinde doğrulandı. Aynı milisaniyedeki hızlı run'ların zero-length segment/interval üretme riski incelemede bulununca canonical run zamanı DB saatinden ve kilitli lineage'dan check başına monoton üretildi; lease geçerliliği ayrı gerçek DB gözlem anıyla korundu.
15. Aşama 9'un altıncı uygulama diliminde AI owner-fair deadline aday seçimi ve check-first freshness reconciler'ı mevcut observation effect uygulayıcısına bağladı. İki replica idempotency'si, exact-deadline incident suspension'ı ve yeni observation ile kilit sırası yarışı gerçek PostgreSQL üzerinde doğrulandı; iki farklı owner ile global limit öncesi fairness sabitlendi. Yeni migration veya dependency gerekmedi ve production loop erken aktive edilmedi.
16. Aşama 9'un yedinci uygulama diliminde AI dört bağımsız runtime loop'unu production entrypoint'ine bağladı; loop-aware readiness, mevcut/sonraki ay partition preflight'i ve bounded graceful drain ekledi. Canlı Compose smoke, unit testlerin yakalayamadığı PostgreSQL mikrosaniye eşitliği ile exact-allowlist Docker hostname sıralama hatalarını ortaya çıkardı; iki sorun dar regresyon testleriyle düzeltildi. Restart sonrası gerçek run devamlılığı, `PASS/200`, `UP/FRESH`, sıfır duplicate aktif job ve SIGTERM drain kaydı doğrulandı.
17. Aşama 9'un sekizinci uygulama diliminde AI 20/200/500 due check'i production queue/dispatcher/persistence kod yolundan geçiren gerçek PostgreSQL kapasite fixture'ı hazırladı. Dış ağ değişkenliği deterministik 5/50 ms probe portuyla ayrıldı; Aşama 7'nin 50 gerçek socket concurrency testi tamamlayıcı kanıt olarak korundu. CPU, RSS, DB connection, active probe, scheduler/dispatch süreleri, p95 claim/execution lag ve throughput makine-okunur kaydedildi; observed baseline ile gevşek CI regresyon bütçesi ayrı belgelendi.

## Güvenlik ve gizlilik

Gerçek parola, session cookie, CSRF değeri, tek-seferlik token, encryption key veya provider credential'ı kaynak koduna ve bu günlüklere yazılmaz. Local testlerde üretilen hesaplar ve Mailpit mesajları sahte geliştirme verisidir; teslim kanıtları secret değerlerini içermez.
