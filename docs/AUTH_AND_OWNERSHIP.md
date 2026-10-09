# Kimlik Doğrulama ve Kullanıcı İzolasyonu Mimarisi

**Aşama:** 5 — Kimlik Doğrulama ve Kullanıcı İzolasyonu  
**Durum:** Uygulandı ve yerel kalite kapılarıyla doğrulandı
**Tarih:** 2026-10-10  
**Bağlı belgeler:** [`API_DESIGN.md`](./API_DESIGN.md), [`API_ERRORS.md`](./API_ERRORS.md), [`DATABASE.md`](./DATABASE.md), [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md), [`DATABASE_SECURITY.md`](./DATABASE_SECURITY.md), [`openapi-v1.yaml`](./openapi-v1.yaml)

## 1. Amaç ve kapsam

Bu belge kayıt, e-posta doğrulama, giriş, session doğrulama/rotation, çıkış ve parola sıfırlama akışlarının güvenlik sınırlarını kesinleştirir. Aynı zamanda authenticated bir isteğin doğru `owner_id` ile çalışmasını ve başka bir kullanıcının satırlarının uygulama hatası olsa dahi PostgreSQL RLS tarafından görünmez kalmasını tanımlar.

V1 modeli gerçek çok kullanıcılıdır fakat organizasyon/workspace içermez. Her private aggregate doğrudan tek bir kullanıcıya aittir. Organizasyon üyeliği daha sonra eklenecekse ayrı domain, yetki ve veri migration kararı olacaktır; Aşama 5'e gizlice eklenmez.

Bu tasarım `packages/auth`, API auth/account route'ları, notification worker, React auth ekranları ve forward-only revision 8–11 migration zinciriyle uygulanmıştır. Migration 9, temiz veritabanı testinde bulunan notifier schema `USAGE` grant'ini; migration 10 anonymous idempotency sınırını; migration 11 profil mutation ve güvenli Argon2 rehash yüzeyini geçmiş migration'ları değiştirmeden tamamlar.

## 2. Güvenlik invariant'ları

1. Browser'da bearer token `localStorage`, `sessionStorage`, URL path'i veya query string içinde tutulmaz.
2. Session kimliği en az 256 bit CSPRNG çıktısıdır; istemcide yalnız `HttpOnly` cookie olarak bulunur, veritabanında yalnız SHA-256 digest'i saklanır.
3. Session kimliği kullanıcı, rol veya başka PII taşımaz; JWT kullanılmaz.
4. Parola hiçbir log, event, audit metadata'sı, idempotency kaydı veya e-posta işinde bulunmaz.
5. Login'de kullanıcı yok, parola yanlış, hesap doğrulanmamış veya hesap kapalı durumları dışarıdan aynı `401 invalid_credentials` sonucunu verir.
6. Kayıt, doğrulama e-postası ve parola sıfırlama isteği hesap varlığını açıklamayan aynı `202` cevabını verir.
7. Token doğrulama, parola değiştirme, token tüketme, session revoke ve audit kaydı ilgili komutun tek veritabanı transaction'ında yapılır.
8. Authenticated domain sorgusu yalnız transaction-local `app.current_user_id` bağlamı kurulmuş transaction içinde çalışır.
9. Uygulama sorguları açık owner predicate'i kullanır; composite foreign key ve FORCE RLS ikinci ve üçüncü savunma katmanıdır.
10. API rolüne auth tabloları üzerinde geniş `SELECT/INSERT/UPDATE/DELETE` verilmez; bootstrap ve auth mutation'ları dar `security_api` fonksiyonlarından geçer.
11. Worker rolleri session/parola verisi okuyamaz. Notification worker yalnız gönderim için gerekli adres snapshot'ı ile şifreli template payload'ını alır.
12. Bir kullanıcının kaynağına başka kullanıcı tarafından erişim, kaynağın hiç bulunmamasıyla aynı `404` sonucunu verir.
13. Auth e-postası, predictor veya başka opsiyonel servis arızası mevcut session doğrulamasını ve monitoring sistemini durduramaz.
14. Ham cookie, CSRF token, tek-seferlik token, parola, e-posta ve IP adresi loglanmaz.

## 3. Güven sınırları ve bileşenler

```text
React browser
  ├─ HttpOnly session cookie ────────────────┐
  ├─ memory-only CSRF token                  │
  └─ exact-origin credentialed fetch         ▼
Fastify API
  ├─ auth/origin/CSRF/rate-limit hooks
  ├─ packages/auth: saf policy + crypto adaptörleri
  └─ packages/database: transaction ve repository sınırı
            │
            ├─ security_api.* dar fonksiyonları
            ├─ SET LOCAL app.current_user_id
            ▼
PostgreSQL 18 / FORCE RLS
            │
            └─ durable auth e-posta işi ──► notification worker ──► SMTP/Mailpit
```

API kimliği doğrular; iş kuralı `packages/auth` ve application service katmanında, SQL ayrıntıları `packages/database` içinde kalır. Fastify handler yalnız sözleşme doğrulama, hook orchestration, cookie/response üretimi ve hata eşleme yapar.

## 4. Hesap modeli ve durumlar

Mevcut `auth.users.status` durumları korunur:

| Durum                  | Login | Private API | Geçiş                                                                |
| ---------------------- | ----: | ----------: | -------------------------------------------------------------------- |
| `PENDING_VERIFICATION` | Hayır |       Hayır | Kayıt sonrası; geçerli doğrulama token'ıyla `ACTIVE`                 |
| `ACTIVE`               |  Evet |        Evet | Yönetimsel disable veya deletion request                             |
| `DISABLED`             | Hayır |       Hayır | Yönetimsel süreç; mevcut session'lar resolve aşamasında geçersiz     |
| `DELETION_REQUESTED`   | Hayır |       Hayır | Ayrı veri silme/retention süreci; Aşama 5'te fiziksel purge yapılmaz |

Kayıt başarıyla kabul edildiğinde kullanıcı otomatik login edilmez. Önce e-posta doğrulanır, sonra normal login yapılır. Bu ayrım session fixation ve doğrulanmamış adresle private kaynak üretme riskini azaltır.

V1'de e-posta değiştirme, MFA/passkey, OAuth/OIDC, “beni hatırla”, kullanıcı tarafından session listesi ve yönetici impersonation yoktur. Bunlar mevcut modele sahte alanlarla eklenmez; sonraki adımlar olarak kaydedilir.

## 5. Girdi ve normalizasyon kuralları

### 5.1 E-posta

- Baş/son ASCII whitespace kaldırılır; boş değer reddedilir.
- V1 SMTP uyumluluğu için local-part ASCII ile sınırlandırılır. Domain IDNA ASCII biçimine çevrilir ve lowercase yapılır.
- Product canonicalization politikası olarak local-part de lowercase yapılır. Bu davranış UI'da açıklanır.
- Gmail nokta/`+tag` gibi sağlayıcıya özel eşdeğerlikler uygulanmaz.
- Canonical adres `email_normalized`, kullanıcıya gösterilecek temizlenmiş yazım `email_display` olur.
- Maksimum dış sözleşme uzunluğu 254 karakterdir; veritabanındaki 320 karakterlik savunma sınırı daraltılmadan kalabilir.
- Unique ihlali hiçbir zaman e-posta varlığını açık eden dış hata üretmez.

### 5.2 Görünen ad

Mevcut veritabanı `display_name` alanını boş bıraktırmadığı için `RegisterRequest` içine zorunlu `display_name` eklenir. Değer Unicode NFC'ye normalize edilir, baş/son whitespace kaldırılır ve 1–120 karakter olmalıdır. E-posta local-part'ından otomatik ad türetilmez.

### 5.3 Parola

- Unicode NFC normalizasyonundan sonra minimum 15, maksimum 128 Unicode code point kabul edilir; byte dizisi sessizce kesilmez.
- Space ve bütün yazdırılabilir Unicode karakterler kabul edilir; büyük harf/rakam/sembol kompozisyon kuralı konmaz.
- Kopyala/yapıştır ve parola yöneticileri engellenmez.
- Periyodik parola değiştirme zorunluluğu yoktur; compromise veya kullanıcı talebinde değiştirilir.
- Yaygın/kolay tahmin edilen parolalar pinlenmiş `@zxcvbn-ts/core`, `@zxcvbn-ts/language-common` ve `@zxcvbn-ts/language-en` sözlükleriyle offline değerlendirilir; 0–2 skorları reddedilir. Normalize e-posta local-part'ı, görünen ad ve ürün adı `userInputs` olarak verilir. Paket sürümü/lisansı dependency commit'inde kaydedilir; server kararı otoritatiftir.
- Parola validation hatası parolanın kendisini response veya loga geri yazmaz.

Mevcut OpenAPI `minLength: 12` değeri uygulama öncesinde 15'e yükseltilecektir.

## 6. Parola saklama ve doğrulama

### 6.1 Algoritma

`Argon2id` ve PHC encoded hash kullanılır. İlk güvenli taban:

| Parametre   | Başlangıç değeri |
| ----------- | ---------------: |
| Memory      |       19,456 KiB |
| Time/pass   |                2 |
| Parallelism |                1 |
| Salt        |   16 random byte |
| Hash output |          32 byte |

Bu değerler minimum tabandır. Production instance sınıfında benchmark yapılır; hedef normal yükte yaklaşık 250–500 ms doğrulama ve tanımlı memory budget içinde kalmaktır. Güvenliği azaltan otomatik runtime tuning yapılmaz. Değer değişikliği config/version olarak izlenir.

Uygulama için pinlenmiş `@node-rs/argon2` tercih edilir: async hash/verify ve PHC formatını hazır sağlar, Node 24/Windows/Linux için prebuilt N-API dağıtımları vardır. Node 24 yerleşik Argon2 API'si mevcut olmakla birlikte proje sürümümüzde release-candidate yaşam döngüsü ve PHC encode/verify sorumluluğu nedeniyle ilk tercih değildir. Dependency kurulmadan önce lisans, platform imajları ve supply-chain audit ayrıca doğrulanır.

### 6.2 Kaynak tüketimi ve timing

- Hash/verify senkron çağrıyla event loop üzerinde çalıştırılmaz.
- API instance başına hash concurrency bounded semaphore ile sınırlanır; varsayılan 4, container memory limitine göre açıkça yapılandırılır.
- Queue hem uzunluk hem bekleme süresi bakımından bounded olur. Doygunluk güvenli, retry edilebilir `503 dependency_unavailable` üretir.
- Rate limit pahalı hash'ten önce uygulanır.
- Bilinmeyen e-posta için startup'ta aynı parametrelerle oluşturulmuş dummy PHC hash doğrulanır. Böylece “kullanıcı yok” hızlı yolu oluşmaz.
- Karşılaştırma library verify veya `timingSafeEqual` ile yapılır; normal string eşitliği kullanılmaz.
- Parametresi eski hash başarılı login'de yeniden hashlenir. Mevcut tasarıma göre `password_version` artırılır ve diğer session'lar güvenli tarafta kalacak biçimde geçersiz olur.

V1'de pepper kullanılmaz. Bunun nedeni secret kaybı/rotation'ın bütün hesapları etkileyen operasyonel maliyetidir; Argon2id, benzersiz salt, dar DB rolleri, şifreli disk/yedek ve rate limit birlikte temel korumayı sağlar. KMS tabanlı pepper ayrı threat model ve kurtarma planı olmadan eklenmez.

## 7. Session modeli

### 7.1 Token ve cookie

- Token `randomBytes(32)` çıktısının padding'siz base64url gösterimidir; öngörülebilir bilgi içermez.
- Veritabanında `SHA-256(token)` olan 32-byte digest saklanır. Rastgele 256-bit token için yavaş password hash kullanılmaz.
- Yalnız cookie transport kabul edilir; header, body, path veya query içinden session alınmaz.
- Cookie adı `site_monitor_session` olarak OpenAPI ile aynı kalır.
- Production özellikleri: `HttpOnly; Secure; SameSite=Strict; Path=/`; `Domain` yazılmaz.
- Local HTTP geliştirmede yalnız `Secure=false` olabilir. Bu istisna production config'inde kabul edilmez ve startup validation ile korunur.
- Cookie `Expires` ve `Max-Age`, veritabanı absolute expiry'sini aşamaz.
- Auth/session response'ları `Cache-Control: no-store` ve `Pragma: no-cache` taşır.

Production'da frontend ve API'nin aynı origin arkasında reverse proxy ile sunulması tercih edilir. Ayrı origin gerekiyorsa credentials açık CORS yalnız tam eşleşen explicit origin allowlist'i kullanır; `*`, suffix/regex subdomain allowlist'i ve request origin reflection yasaktır.

### 7.2 Süreler

| Kural                 | Varsayılan | Anlam                                                      |
| --------------------- | ---------: | ---------------------------------------------------------- |
| Absolute session ömrü |      7 gün | Login anından itibaren uzatılamayan üst sınır              |
| Idle timeout          |    24 saat | `last_seen_at`/`created_at` sonrasındaki hareketsizlik     |
| Last-seen touch       |   5 dakika | Her request'te write yapılmasını engelleyen minimum aralık |
| Rotation periyodu     |    24 saat | Aktif kullanımda yeni token/session row                    |
| Rotation grace        |  30 saniye | Paralel in-flight request'lerin yanlış 401 almaması        |

Süreler config ile daha kısa yapılabilir; production'da bu üst sınırların üzerine çıkmak açık karar gerektirir. DB zamanı source of truth'tur.

### 7.3 Rotation ve revoke

- Başarılı login her zaman yeni session üretir; request'teki eski cookie yeniden kullanılmaz.
- Periyodik rotation eski row'u `ROTATED` nedeniyle revoke eder, yeni row'u `rotated_from_session_id` ile bağlar ve response'ta yeni cookie verir.
- Eski token yalnız 30 saniyelik grace içinde zaten başlamış paralel request'leri doğrulayabilir; yeni cookie/token veremez. Grace sonrası kesin geçersizdir.
- Aynı eski session için yarışan rotation `SELECT ... FOR UPDATE` altında tek yeni session üretir.
- Logout yalnız mevcut session'ı revoke eder ve cookie'yi süresi geçmiş değerle temizler. Session yok/geçersizse de enumeration-safe, idempotent `204` döner.
- Parola reseti ve gerçek parola değişimi bütün session'ları aynı transaction'da revoke eder.
- `DISABLED` veya `DELETION_REQUESTED` kullanıcı session'ı `resolve_session` aşamasında kabul edilmez; background cleanup beklenmez.
- Bir session row'u asla tekrar aktif hale getirilmez.

Logout'un mevcut OpenAPI'deki zorunlu auth/`401` tanımı idempotent `204` davranışıyla uyumlu hale getirilecektir.

## 8. CSRF, Origin ve browser sınırı

### 8.1 CSRF token

CSRF token session'a bağlı, version'lı HMAC değeridir:

```text
v1.base64url(HMAC-SHA-256(csrf_key_v1, "csrf\0" + session_id + "\0" + session_token_digest))
```

Token login ve `GET /api/v1/auth/session` response'undaki `SessionView.csrf_token` alanıyla browser JavaScript belleğine verilir; local/session storage'a kalıcı yazılmaz. Unsafe authenticated istekler token'ı yalnız `X-CSRF-Token` header'ında gönderir. API expected değeri yeniden türetip constant-time karşılaştırır. Rotation yeni CSRF token üretir.

CSRF anahtarları secret store'dan version'lı key ring olarak yüklenir. Current ve sınırlı süre previous key aynı anda doğrulanabilir; repository içinde gerçek key bulunmaz.

### 8.2 Çok katmanlı istek politikası

Cookie kullanan tüm unsafe yöntemlerde (`POST`, `PUT`, `PATCH`, `DELETE`):

1. `Sec-Fetch-Site: cross-site` kesin reddedilir.
2. `Origin` varsa configured frontend origin ile bire bir eşleşmelidir.
3. `Origin` yoksa yalnız aynı origin `Referer` fallback'i kabul edilir; ikisi de yoksa browser API isteği reddedilir.
4. Authenticated endpoint'te geçerli `X-CSRF-Token` zorunludur.
5. Body kabul eden endpoint yalnız `application/json` kabul eder; simple form content type'ları reddedilir.
6. CORS preflight yalnız explicit origin, yöntem ve header allowlist'i için başarılıdır; credentials ile wildcard kullanılmaz.
7. Proxy-derived origin/IP yalnız explicit trusted proxy CIDR/hop yapılandırmasından sonra kullanılır; istemci `Forwarded`/`X-Forwarded-*` değerine doğrudan güvenilmez.

Login, register, verification request/confirm ve password reset request/confirm henüz session taşımadığı için synchronizer token isteyemez; buna rağmen login-CSRF ve e-posta abuse'a karşı Origin/Fetch Metadata, JSON-only ve exact CORS kontrollerinden geçer.

CSRF XSS'e karşı koruma değildir. Frontend CSP, output escaping ve dependency güvenliği ayrı katmandır.

## 9. Auth akışları

### 9.1 Kayıt

1. Request schema, origin ve rate limit doğrulanır.
2. E-posta/display name normalize edilir, parola politikası ve blocklist kontrol edilir.
3. Argon2id hash bounded worker kapasitesiyle üretilir. Duplicate hesapta da timing farkını azaltmak için pahalı yol atlanmaz.
4. 32-byte verification token üretilir; yalnız digest DB'ye, encrypted mail payload durable delivery tablosuna gider.
5. `register_account` güvenlik fonksiyonu user, credential, token, mail job, audit ve anonymous idempotency receipt'ini tek transaction'da oluşturur.
6. E-posta yeni değilse dış response yine aynı `202` olur. `ACTIVE` hesap için yeni verification token üretilmez. Pending hesapta cooldown/rate limit izin veriyorsa eski açık token consume edilip yenisi oluşturulur.
7. SMTP işlemi request transaction'ında yapılmaz.

### 9.2 E-posta doğrulama

- Mail linki token'ı query/path yerine frontend URL fragment'ında taşır. SPA token'ı belleğe alır, adres çubuğunu hemen temizler ve JSON body ile confirm endpoint'ine yollar.
- Token 32 random byte'dır, digest'i saklanır ve varsayılan 24 saat geçerlidir.
- `confirm_email_verification` row lock altında token'ı consume eder, `PENDING_VERIFICATION → ACTIVE` geçişini, `email_verified_at`, resource version ve audit event'ini aynı transaction'da yazar.
- Geçersiz, süresi geçmiş, yanlış purpose veya daha önce kullanılmış token aynı generic `422 invalid_or_expired_token` sonucunu verir.
- Confirmation otomatik session üretmez.

### 9.3 Login

1. Origin/JSON/rate limit kontrolü pahalı işlemden önce çalışır.
2. Normalize e-posta ile `security_api.lookup_login_credential` çağrılır.
3. Kayıt yoksa dummy hash; varsa dönen PHC hash doğrulanır.
4. Parola yanlış, user `ACTIVE` değil veya credential yarışta değişmişse aynı `401 invalid_credentials` döner.
5. Başarıda `create_session(owner_id, expected_password_version, token_digest, expiry)` atomik session ve audit kaydı üretir.
6. Cookie ve yeni CSRF token içeren `SessionView` döner. Response hiçbir parola/hash bilgisi taşımaz.

### 9.4 Session çözme

Her private request'te auth hook:

1. Tek ve bounded cookie değerini parse eder.
2. Digest üretip dar `resolve_session` fonksiyonunu çağırır.
3. Revoked, absolute-expired, idle-expired, pasif user veya eski password version için sonuç alamaz.
4. Immutable `{ownerId, sessionId, expiresAt}` auth context'ini request'e ekler.
5. Domain repository transaction'ında owner/correlation context'ini `SET LOCAL` ile kurar.
6. Touch/rotation gerekiyorsa bounded ve yarış güvenli güvenlik fonksiyonunu çağırır.

Kimlik doğrulama sorgusu ile domain sorgusu farklı transaction olabilir; domain transaction'ı owner bilgisini session cookie'den tekrar türetmez, doğrulanmış immutable context'ten alır. Her repository public metodu transaction parametresi ister; pool client üzerinde session-level `SET` kullanılmaz.

### 9.5 Logout

Valid session varsa CSRF/origin doğrulanır, current session `USER_LOGOUT` ile revoke edilir ve audit yazılır. Cookie her durumda temizlenir. Tekrarlanan/expired session logout'u `204` döner; başka session'lar etkilenmez.

### 9.6 Verification resend ve parola sıfırlama isteği

- Endpoint her syntactically valid request için aynı `202` gövde/süre sınıfını kullanır.
- Rate limit IP scope ve normalized email HMAC scope üzerinde, kullanıcı varlığından bağımsız uygulanır.
- Verification yalnız pending hesaba; reset yalnız active hesaba durable mail işi üretir.
- Yeni challenge üretildiğinde aynı owner/purpose için açık eski token'lar aynı transaction'da consume edilir.
- Cooldown içinde tekrar istek mail üretmez fakat dış response değişmez.
- E-posta gönderim hatası hesap varlığını response'a taşımaz.

### 9.7 Parola reset confirm

- Reset token varsayılan 30 dakika geçerlidir.
- Yeni parola normal registration politikası, blocklist ve Argon2id sürecinden geçer.
- `complete_password_reset` token'ı lock/consume eder, credential hash'ini değiştirir, `password_version` artırır, bütün active session'ları `PASSWORD_RESET` ile revoke eder ve audit yazar; tamamı tek transaction'dır.
- Transaction başarısızsa token tüketilmiş sayılmaz.
- Başarı `204`; geçersiz/expired/consumed token generic `422 invalid_or_expired_token` döndürür.

## 10. Dağıtık rate limit

API birden fazla replica ile çalışabileceği için auth abuse limitleri yalnız process belleğinde tutulmaz. Redis v1'e eklenmez; PostgreSQL'de atomik fixed-window sayaçları kullanılır. Dakikalık ve saatlik/günlük iki pencerenin birlikte uygulanması pencere sınırı burst'ünü sınırlar.

Önerilen revision 8 tablosu `auth.rate_limit_counters`:

| Kolon            | Anlam                                          |
| ---------------- | ---------------------------------------------- |
| `policy_key`     | Version'lı allowlist policy adı                |
| `subject_digest` | Raw e-posta/IP/user yerine HMAC-SHA-256 digest |
| `window_start`   | DB zamanıyla hesaplanan pencere başlangıcı     |
| `attempt_count`  | Atomik artan sayaç                             |
| `expires_at`     | Housekeeper için bounded retention             |

PK `(policy_key, subject_digest, window_start)` olur. API doğrudan tablo yetkisi almaz; `security_api.consume_rate_limit(...)` tek statement ile artırır ve allowed/retry-after döndürür. Storage hatasında auth mutation'ları fail-closed davranır.

Başlangıç değerleri deployment config'idir:

| Akış                       | Network scope       | Subject scope              |
| -------------------------- | ------------------- | -------------------------- |
| Login                      | 30 / 15 dakika      | 10 / 15 dakika / e-posta   |
| Register                   | 5 / saat            | 3 / 24 saat / e-posta      |
| Verification/reset request | 10 / saat           | 3 / saat / e-posta         |
| Token confirm              | 30 / saat           | 10 / saat / token digest   |
| Authenticated auth/session | 120 / dakika / user | Route-specific ek limitler |

Network scope trusted proxy sonrası canonical IPv4 veya IPv6 `/64` prefix'inin HMAC'idir. Raw IP/e-posta counter tablosuna veya loga yazılmaz. Sayaç retention'ı en fazla 48 saattir. `429 rate_limit_exceeded`, tam `Retry-After` ve mevcut problem-details zarfını kullanır; account varlığına göre değişmez.

Bu limitler kapasite/abuse testleriyle ayarlanabilir güvenlik varsayılanlarıdır; ürün kotası değildir. Normal dashboard/check/history trafiği Aşama 5 sayaç tablosuna her request'te yazılmaz; ürün route limitleri kendi risk ve kapasite aşamasında tasarlanır. Dağıtık botnet/DDoS için production edge/CDN/WAF limiti ayrıca gerekir.

## 11. Durable auth e-postaları

Incident e-posta tabloları auth challenge'larıyla zorla birleştirilmez. Revision 8, `notification.transactional_email_deliveries` tablosunu ekler:

- `id`, `owner_id`, `challenge_id`, `kind`
- `recipient_address_snapshot`
- AES-256-GCM encrypted, şema sürümlü template payload envelope'u
- `encryption_key_version`
- `state`, attempt/max-attempt, available/lease/fencing alanları
- provider message id, bounded result code, sent/completed zamanları
- `UNIQUE(challenge_id, kind)` idempotency

Raw token yalnız kısa ömürlü encrypted payload içindedir; outbox event, audit veya log payload'ına girmez. Encryption key repository/database içinde bulunmaz, version'lı secret store key ring'inden gelir. Notification worker dar claim/complete fonksiyonuyla işi alır, decrypt eder ve SMTP/Mailpit adapter'ına gönderir. Monitoring incident e-posta kuyruğu ile aynı SMTP adapter/observability kullanılabilir fakat domain tabloları ayrı kalır.

Retry bounded exponential backoff + jitter kullanır. Provider kabulünden sonra bağlantı sonucu belirsizse `DELIVERY_UNKNOWN` terminal durumu seçilir; otomatik duplicate mail üretilmez. Kullanıcı rate limit sonrasında yeni challenge isteyebilir. Expired challenge'a ait gönderilmemiş işler iptal edilir. Encrypted payload token expiry + operasyonel grace sonrasında silinir.

## 12. Forward-only veritabanı değişiklik planı

Onay sonrası geçmiş migration'lar değiştirilmeden `000008_auth_and_ownership.sql` eklenir.

### 12.1 Şema değişiklikleri

- Session rotation grace ve açık revoke reason constraint'leri
- `auth.rate_limit_counters`
- `notification.transactional_email_deliveries`
- Gerekli unique/check/FK/index ve FORCE RLS politikaları
- Housekeeper için yalnız expired counter/job cleanup yetkisi
- Kysely tiplerinin yeni kolon/tablolara genişletilmesi

### 12.2 Dar güvenlik fonksiyonları

| Fonksiyon                            | Sorumluluk                                                          |
| ------------------------------------ | ------------------------------------------------------------------- |
| `lookup_login_credential`            | Minimal login verifier bilgisi; mevcut fonksiyon güçlendirilir      |
| `register_account`                   | User + credential + verify token + mail job + receipt + audit       |
| `issue_account_challenge`            | Enumeration-safe verify/reset challenge rotation ve mail işi        |
| `confirm_email_verification`         | Token consume + account activation + audit                          |
| `complete_password_reset`            | Token consume + credential version + bütün session revoke + audit   |
| `create_session`                     | Expected credential version ile session + audit                     |
| `record_login_denial`                | Allowlist reason ile PII içermeyen, bounded başarısız auth audit'i  |
| `resolve_session`                    | Absolute/idle/status/version/grace kontrolleri                      |
| `touch_or_rotate_session`            | Rate-limited touch ve yarış güvenli rotation                        |
| `revoke_session`                     | Current session idempotent revoke                                   |
| `update_current_user_profile`        | Owner + expected resource version ile dar profile mutation          |
| `consume_rate_limit`                 | Cross-replica atomik counter ve retry-after                         |
| `read/write_anonymous_idempotency`   | Exact HMAC scope ile owner-null receipt; doğrudan tablo erişimi yok |
| `claim/complete_transactional_email` | Notification worker'a yalnız gerekli şifreli iş yüzeyi              |

Fonksiyonlar fixed `search_path`, schema-qualified objeler, bounded input, minimal return type, explicit `PUBLIC EXECUTE` revoke ve yalnız gereken role grant kurallarına uyar. API'nin kullanıcı id gönderdiği bir fonksiyon, bu değeri tek başına authentication kanıtı saymaz; expected credential/session version ve DB row lock ile yarışı doğrular.

Mevcut genel `consume_one_time_token` fonksiyonunun API execute yetkisi kaldırılır. Token tüketimini hesap mutation'ından ayıran eski yüzey kullanılmaz.

## 13. API sözleşmesi değişiklikleri

Aşama 5 uygulamasının ilk commit'inde canonical OpenAPI şu kontrollü değişiklikleri alır ve generated artifact'ler yeniden üretilir:

1. `RegisterRequest.required` içine `display_name` eklenir; 1–120 sınırı tanımlanır.
2. Register/reset password minimumu 15 yapılır; Unicode/code-point semantiği açıklanır.
3. `invalid_or_expired_token` stabil problem kodu eklenir ve confirm endpoint'lerinin `422` anlamı netleştirilir.
4. Logout eksik/geçersiz session için de cookie temizleyen idempotent `204` olarak tanımlanır; valid session varsa CSRF zorunlu kalır.
5. Login `Set-Cookie` güvenlik özellikleri ve bütün auth response'larının `no-store` davranışı belgelenir.
6. `SessionView.csrf_token` rotation sonrası değişebilen bootstrap değeri olarak kalır.
7. Anonymous unsafe auth endpoint'lerinin Origin/Fetch Metadata politikası açıklamaya eklenir.

Bu değişiklikler henüz kullanılan public v1 olmadığı için breaking migration gerektirmez; yine de OpenAPI diff'i review edilir ve 57 operasyon matrisi korunur.

## 14. Sahiplik ve RLS uygulama kalıbı

Private handler akışı:

```text
auth hook resolves cookie -> AuthContext(ownerId, sessionId)
  -> application command/query
    -> withOwnerTransaction(ownerId, requestId)
      -> SET LOCAL app.current_user_id
      -> SET LOCAL app.correlation_id
      -> repository uses owner predicate
      -> PostgreSQL FORCE RLS checks the same owner
```

- Request body/path içindeki `owner_id` yok sayılmaz; böyle alan dış sözleşmede bulunmaz.
- Create işlemi owner id'yi yalnız immutable auth context'ten alır.
- Tekil read/update/delete sorgusu `WHERE owner_id=? AND id=?` kullanır; zero row `404` olur.
- Cross-owner FK ihlali `404` veya generic conflict'e çevrilir; constraint/table adı dışarı çıkmaz.
- Worker işlemleri insan owner context'i taklit etmez; kendi NOLOGIN rolü ve açık policy/GRANT'iyle çalışır.
- Pool transaction callback dışına query builder/client çıkarılmaz. Commit, rollback, cancel ve timeout sonrasında `SET LOCAL` otomatik temizlenir.
- Runtime'da admin/bypass endpoint'i veya bütün tenant'ları gören API rolü bulunmaz.

## 15. Secret ve yapılandırma sınırı

Production startup aşağıdaki secret/config yoksa fail-fast olur:

- Session/one-time token üretimi için platform CSPRNG (secret config gerekmez)
- Version'lı CSRF HMAC key ring
- Rate-limit/idempotency subject HMAC key ring
- Transactional e-posta payload AES-256-GCM key ring
- Database login secret ve SMTP/provider credential
- Exact frontend origin ve explicit trusted proxy yapılandırması
- Session, token, Argon2 concurrency ve rate-limit değerleri

`.env.example` yalnız format ve güvenli placeholder gösterir. Gerçek değer Git, image layer, CI output veya geliştirme günlüğüne yazılmaz. Key version ciphertext/digest metadata'sında bulunabilir; key materyali bulunamaz. Key rotation current+previous read, yalnız current write modeliyle yapılır.

## 16. Logging, audit ve metrikler

### 16.1 Audit action allowlist'i

- `auth.registration.accepted`
- `auth.login.succeeded`, `auth.login.denied`, `auth.login.rate_limited`
- `auth.session.rotated`, `auth.session.revoked`
- `auth.email_verification.requested`, `auth.email_verification.completed`
- `auth.password_reset.requested`, `auth.password_reset.completed`
- `auth.account.status_changed`
- `auth.ownership.denied`

Audit metadata'sı raw e-posta/IP/token/cookie/CSRF/parola/hash taşımaz. Gerekiyorsa yalnız version'lı HMAC subject, reason category ve policy key bulunur. Bilinmeyen hesap denemesinde `owner_id=null` olur. Audit yazımı auth state mutation ile aynı transaction'dadır; yüksek hacimli edge/DDoS logu audit tablosuna sınırsız aktarılmaz.

### 16.2 Metrikler

- Auth result, endpoint ve reason category sayaçları; e-posta/user/IP label değildir.
- Argon2 queue depth, wait/hash latency ve saturation.
- Session resolve/rotation/revoke sayıları ve latency.
- Rate-limit deny ve storage error sayıları.
- Transactional e-posta pending/retry/dead/unknown sayıları ve yaşları.
- RLS/ownership denial ve auth security function hata sayıları.

Beklenmeyen secret benzeri header/body değerlerinin loglanmadığı test ve redaction allowlist'iyle korunur.

## 17. Hata ve dependency davranışı

| Durum                              | Dış sonuç                        | İç davranış                                      |
| ---------------------------------- | -------------------------------- | ------------------------------------------------ |
| Cookie yok/bozuk/expired/revoked   | `401 authentication_required`    | Cookie temizlenebilir; ayrıntı dışarı çıkmaz     |
| Login hesabı yok/yanlış/pasif      | `401 invalid_credentials`        | Dummy/real hash yolu ve generic audit            |
| Origin/CSRF başarısız              | `403 csrf_failed`                | Güvenli reason metric; token loglanmaz           |
| Token invalid/expired/consumed     | `422 invalid_or_expired_token`   | Purpose/owner varlığı açıklanmaz                 |
| Rate limit                         | `429 rate_limit_exceeded`        | `Retry-After`; aynı scope semantiği              |
| Hash kapasitesi dolu               | `503 dependency_unavailable`     | Retryable; yeni session/state yazılmaz           |
| PostgreSQL auth transaction hatası | `503` veya güvenli `500`         | Atomic rollback; cookie verilmez                 |
| SMTP/Mailpit geçici hatası         | Request daha önce `202` olabilir | Durable job retry; auth transaction geri alınmaz |

Auth endpoint'lerinde hata response'u da `application/problem+json`, request ID ve güvenli instance kurallarına uyar.

## 18. Zorunlu test ve kanıt matrisi

### 18.1 Unit/contract

- E-posta/display-name/password normalizasyon ve sınır testleri
- Unicode NFC, code-point uzunluğu, sessiz truncation olmaması
- Argon2 PHC hash/verify, wrong password, dummy hash ve rehash kararı
- Token entropy/format/digest; deterministic CSRF derive ve constant-time verify
- Cookie attribute ve `no-store` sözleşmesi
- OpenAPI auth/CSRF/idempotency ve generated artifact drift
- Problem code/title/status eşleşmeleri

### 18.2 PostgreSQL integration

- Register transaction'ı ve duplicate e-postanın enumeration-safe sonucu
- Verification/reset token single-use, expiry, wrong-purpose ve iki paralel consume yarışı
- Password reset transaction rollback'inde token'ın açık kalması
- Password resetin bütün session'ları revoke etmesi
- Login sonrası expected password version yarışı
- Session absolute/idle expiry, touch, rotation ve 30 saniyelik grace
- Aynı session için paralel rotation'ın tek successor üretmesi
- Rate counter'ın iki ayrı connection/API instance simülasyonunda limiti aşmaması
- Auth e-posta job unique/lease/fencing ve expired challenge iptali
- Anonymous idempotency receipt'in yalnız exact HMAC scope ile erişilmesi
- Security-definer search-path/overload saldırılarının reddi

### 18.3 Sahiplik izolasyonu

- User A, User B'ye ait her private parent tabloda zero row görür.
- B'nin ID'si bilinse de read/update/delete `404`; constraint ayrıntısı response'a çıkmaz.
- A, B'nin kaynağını kendi parent/child ilişkisine bağlayamaz.
- Body'de sahte owner id gönderilemez ve create owner'ı auth context'ten alır.
- Context olmadan private sorgu default-deny olur.
- Commit, rollback, cancel ve statement timeout sonrasında pooled connection context'i sızmaz.
- API/monitor/notifier/predictor/public rollerinin auth tablo ve security function sınırları negatif test edilir.

### 18.4 HTTP/E2E

- Register → Mailpit linki → verify → login → session → logout mutlu yol
- Reset request → Mailpit linki → reset → eski session'ların 401 olması
- Unknown/existing e-posta request body/status eşitliği
- Yanlış parola/unknown/pending/disabled login body/status eşitliği ve dummy verify çağrısı
- Cookie `HttpOnly`, production `Secure`, `SameSite=Strict`, Path ve Domain yokluğu
- CSRF eksik/yanlış, cross-site Origin, `Sec-Fetch-Site`, form content type ve CORS negatifleri
- İki browser context'te iki ayrı kullanıcı izolasyonu
- Aynı kullanıcı için iki tab/session; bir logout'un diğer bağımsız session'ı bozmaması
- Notification worker kapalıyken monitoring/API health ve mevcut session doğrulamasının çalışması
- Log capture içinde parola, cookie, CSRF ve tek-seferlik token bulunmaması

Timing eşitliği flaky milisaniye eşiğiyle kanıtlanmaz; unknown ve wrong-password yollarının aynı hash adapter çağrısını yaptığı instrumentation testiyle kanıtlanır.

## 19. Uygulama sırası

1. OpenAPI auth düzeltmeleri ve contract testleri
2. `packages/auth` policy/crypto sınırı ve unit testleri
3. Revision 8 schema, security functions, Kysely tipleri ve DB integration testleri
4. PostgreSQL-backed rate limiter
5. Fastify cookie, auth context, origin ve CSRF hook'ları
6. Register/verification akışları ve durable auth e-postası
7. Login/session rotation/logout
8. Password reset ve global session revoke
9. Cross-owner/RLS negatif matrisinin tamamlanması
10. React auth bootstrap/form akışları ve iki-client E2E
11. Compose/Mailpit smoke, tam kalite kapısı, dokümantasyon ve CI

Her adım küçük commit olur. Migration önceki dosyaları değiştirmez; route tamamlanmadan frontend sahte başarı göstermeyecek şekilde dikey dilimler tercih edilir.

## 20. Tamamlanma ölçütü

Aşama 5 yalnız aşağıdakilerin tümü sağlanırsa tamamlanır:

- Kayıt, doğrulama, login, session, logout ve reset akışları gerçek PostgreSQL üzerinde çalışır.
- Parola ve session güvenlik kuralları uygulanır; secrets loglanmaz.
- Origin/CSRF/CORS/cookie negatif testleri geçer.
- Rate limit iki replica/connection davranışında tutarlıdır.
- Bütün auth mutation'ları atomik ve idempotency sınırlarıyla uyumludur.
- Cross-user erişim ve pool context sızıntısı testleri geçer.
- Notification worker arızası ana API/monitoring'i çökertmez.
- İki browser client senaryosu geçer.
- Docker Compose temiz kurulum, migration, Mailpit akışı, yerel CI ve GitHub CI kanıtlanır.
- README, karar/geliştirme günlüğü ve proje durumu gerçek sonuçlarla güncellenir.

## 21. Bilinen tavizler ve sonraya bırakılanlar

- Organizasyon/üyelik/rol modeli v1 kapsamında değildir.
- MFA/passkey ve OAuth/OIDC yoktur; password + verified email tek faktörlü modeldir.
- Account recovery yalnız doğrulanmış e-posta erişimine dayanır.
- Kullanıcı session listesi ve “diğer cihazlardan çıkış” UI'si yoktur; reset bütün session'ları revoke eder.
- Pepper, provider-level breached-password servisi ve KMS field encryption ayrı threat model gerektirir.
- PostgreSQL rate limit, auth trafiği için yeterli ve replica-safe başlangıçtır; çok yüksek edge trafiğinde Redis/WAF ayrı kapasite kararı olabilir.
- Local `Secure=false` cookie yalnız geliştirme istisnasıdır; production HTTPS olmadan başlamaz.

## 22. Doğrulanan kaynaklar

- [NIST SP 800-63B — password authenticator requirements](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Node.js 24 Crypto — Argon2](https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html#cryptoargon2algorithm-parameters-callback)
- [`@node-rs/argon2` repository](https://github.com/napi-rs/node-rs)
- [`zxcvbn-ts` repository and dictionaries](https://github.com/zxcvbn-ts/zxcvbn)
- [`@fastify/rate-limit` custom/external store davranışı](https://github.com/fastify/fastify-rate-limit)

Kaynaklar tasarım girdisidir; proje herhangi bir standarda sertifikalı uyumluluk iddiasında bulunmaz.
