# Geliştirme Günlüğü

Tüm zamanlar UTC+06:00 olarak kaydedilir. Uygulama içindeki kalıcı domain zamanları UTC tutulacaktır.

## 2026-10-09

### 22:23 — Başlangıç mimarisi

- İstemci-sunucu ürün gereksinimleri incelendi.
- React/TypeScript, Node.js/TypeScript, PostgreSQL ve opsiyonel Python predictor içeren başlangıç mimarisi kaydedildi.
- Kullanıcı bazlı sahiplik, organizasyon kapsamının dışında bırakıldı.
- Kontrol sayısı için sabit 50 sınırı kullanılmaması kararlaştırıldı.

### 22:35 — Uygulama planı

- Proje 20 sıralı iş paketine ayrıldı.
- Her aşama için tasarım-kabul-uygulama-test kapısı belirlendi.
- İlk iş paketi gereksinim ve mimari temizliği olarak seçildi.

### 22:47 — Aşama 0: Gereksinim ve mimari temizliği

- Normatif ürün ve kalite gereksinimleri kimliklendirilerek yazıldı.
- Tekrarlanabilir kabul kriterleri oluşturuldu.
- Scheduler cadence, lease/fencing, availability, state eksenleri, bakım-bildirim yarışları, quota ayrımı ve üretim PostgreSQL sürekliliği kararları kesinleştirildi.
- Karar günlüğü başlatıldı.
- Mimari v1.1 güncellemesi hazırlandı.
- Bu aşamada uygulama kodu veya veritabanı şeması oluşturulmadı.

### 22:58 — Aşama 1: Domain modeli ve durum makineleri

- Domain modülleri, aggregate sınırları, değer nesneleri, komutlar ve transaction sınırları tanımlandı.
- Check lifecycle, execution, job, freshness, health, incident, maintenance, notification, public page ve prediction durum makineleri yazıldı.
- Manual run'ın ACTIVE durumda stateful, PAUSED durumda diagnostic olması kararlaştırıldı.
- Monitoring data gap'lerinde incident'ın açık/unobserved kalması ve observed duration'ın yalnızca DOWN segmentlerinden hesaplanması kararlaştırıldı.
- Resource version, probe generation, schedule generation ve fencing token sorumlulukları ayrıldı.
- Probe config değişimi, pause/resume, group taşıma/silme ve check delete edge case'leri kesinleştirildi.
- Gereksinim, kabul kriteri ve karar günlükları yeni domain kararlarıyla güncellendi.
- Bu aşamada uygulama kodu veya veritabanı şeması oluşturulmadı.

### 23:06 — Aşama 2: Repository ve geliştirme ortamı tasarımı

- Polyglot monorepo dizin yapısı, workspace sınırları ve bağımlılık yönleri tanımlandı.
- Node.js 24 LTS, pnpm 11.25, ESM ve strict TypeScript araç tabanı seçildi.
- Opsiyonel predictor için Python 3.14, uv ve bağımsız lockfile yaklaşımı seçildi.
- Host uygulamalar/container altyapı, tam container stack ve ayrı prediction profile çalışma biçimleri tanımlandı.
- Root komut sözleşmesi, kalite araçları, test katmanları, CI işleri, config/secret ilkeleri ve image kuralları kesinleştirildi.
- Windows/Linux uyumluluğu ve temiz ortam doğrulama kapıları belirlendi.
- Bu aşamada Git repository, scaffold, bağımlılıklar, Compose servisleri veya uygulama kodu oluşturulmadı; tasarım kullanıcı incelemesine bırakıldı.

### 23:16 — Aşama 2 uygulaması: Git ve yerel container altyapısı

- Klasör `main` başlangıç dalıyla yerel Git repository olarak başlatıldı.
- Güvenli başlangıç ignore, satır sonu, editör ve örnek environment dosyaları eklendi.
- PostgreSQL `18.6-bookworm` ve Mailpit `v1.31.4` için Compose tanımı oluşturuldu.
- Mevcut başka bir projeye ait `5432` portuna dokunulmadı; bu projenin host PostgreSQL portu `15432` olarak ayrıldı.
- Her iki container başlatıldı ve Docker healthcheck'leri başarılı oldu.
- PostgreSQL bağlantısı `site_monitor` database/user ile ve Mailpit API'si v1.31.4 olarak doğrulandı.
- Yerel Git kimliği ve GitHub remote bilgisi bulunmadığı için commit/push yapılmadı.
- API, frontend, worker, target simulator ve predictor container'ları henüz oluşturulmadı.

### 23:19 — GitHub remote bağlantısı

- GitHub repository `origin` remote olarak `https://github.com/EgeSensozKarayaka/testproject.git` adresine bağlandı.
- Remote erişimi başarıyla doğrulandı; repository henüz ref döndürmediği için boş repository olarak değerlendirildi.
- Repository-local Git kullanıcı adı `Ege` olarak ayarlandı.
- Commit e-posta adresi verilmediği için ilk commit ve push bilinçli olarak bekletildi.

### 23:21 — Git commit kimliği

- Repository-local Git kimliği `Ege <sensozegekarayaka@gmail.com>` olarak tamamlandı.
- Global Git yapılandırması değiştirilmedi.

