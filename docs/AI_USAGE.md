# AI Kullanımı

**Son güncelleme:** 2026-10-10 07:47 +06:00

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

## Güvenlik ve gizlilik

Gerçek parola, session cookie, CSRF değeri, tek-seferlik token, encryption key veya provider credential'ı kaynak koduna ve bu günlüklere yazılmaz. Local testlerde üretilen hesaplar ve Mailpit mesajları sahte geliştirme verisidir; teslim kanıtları secret değerlerini içermez.
