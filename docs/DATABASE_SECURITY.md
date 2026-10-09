# Veritabanı Güvenliği, RLS ve Rol Mimarisi

**Durum:** Uygulandı; rol/privilege ve negatif RLS entegrasyon testleriyle doğrulandı
**Bağlı belge:** [`DATABASE.md`](./DATABASE.md)

## 1. Güvenlik Hedefi

Ana güvenlik invariant'ı şudur:

> Bir kullanıcı, başka bir kullanıcının private satırını kimliğini tahmin etse, API filtresi unutulsa veya hatalı join yazılsa dahi okuyamamalı, değiştirememeli ve kendi kaynağına bağlayamamalıdır.

Bu invariant tek mekanizmaya bırakılmaz:

1. API command/query katmanı authenticated owner ile çalışır.
2. Composite owner foreign key'leri çapraz sahip bağını reddeder.
3. PostgreSQL RLS satır görünürlüğünü/yazımını sınırlar.
4. Runtime rolleri en az yetkilidir ve tablo sahibi değildir.
5. Negatif integration testleri bütün katmanları doğrular.

RLS, authentication yerine geçmez. Authentication session token'ını kullanıcı kimliğine çözer; authorization ve RLS bundan sonra devreye girer.

## 2. PostgreSQL Rolleri

Gerçek kullanıcı hesapları PostgreSQL login rolü değildir. Migration aşağıdaki yetki rollerini `NOLOGIN` ve `NOBYPASSRLS` olarak kurar. Local Compose tek bootstrap login'inden bağlantı açıp bağlantı başlangıcında dar role `SET ROLE` eder. Production deployment her servis için yalnız ilgili `NOLOGIN` role üyeliği olan ayrı bir login wrapper ve ayrı secret oluşturmalıdır; superuser bağlantısı runtime'da kullanılamaz.

| Rol                         |             Login |                BYPASSRLS | Amaç                                                                 | Özellikle sahip olmadığı yetki                           |
| --------------------------- | ----------------: | -----------------------: | -------------------------------------------------------------------- | -------------------------------------------------------- |
| `site_monitor_schema_owner` |             Hayır |                    Hayır | Şema/objelerin sahibi; yalnız migrator `SET ROLE` eder               | Runtime login, normal trafik                             |
| `site_monitor_migrator`     |             Hayır |                    Hayır | Advisory lock alıp migration uygular; login wrapper owner role geçer | Uygulama trafiği                                         |
| `site_monitor_api`          |             Hayır |                    Hayır | Auth bootstrap fonksiyonları ve user-context RLS altında CRUD        | DDL, worker claim, raw backup                            |
| `site_monitor_monitor`      |             Hayır |                    Hayır | Scheduler, probe job/attempt/run, state, incident, rollup            | Credential/session, notification delivery, public secret |
| `site_monitor_notifier`     |             Hayır |                    Hayır | Intent/delivery claim, policy/recipient ve maintenance okuma         | Password/session, check config yazma, health yazma       |
| `site_monitor_predictor`    |             Hayır |                    Hayır | Güvenli feature view okuma, analysis job/score yazma                 | Raw URL, PII, current health/incident yazma              |
| `site_monitor_public`       |             Hayır |                    Hayır | Yalnız digest tabanlı public snapshot fonksiyonu                     | Private tablo SELECT dahil her şey                       |
| `site_monitor_housekeeper`  |             Hayır |                    Hayır | Partition/retention/rebuild için dar procedure'ler                   | Genel DDL ve auth verisi                                 |
| `site_monitor_backup`       | Deployment'a özel | Gerekirse ayrı kontrollü | Mantıksal backup/restore görevi; normal runtime dışında              | Uygulama trafiği                                         |

Kurallar:

- Runtime rollerinin hiçbiri superuser, object owner, `CREATEDB`, `CREATEROLE`, `REPLICATION` veya `BYPASSRLS` değildir.
- Runtime rolü başka runtime rolüne üye değildir.
- `PUBLIC` için schema/table/function varsayılan yetkileri revoke edilir.
- Yeni tabloların default privileges'ı deny-by-default'tur; migration açık GRANT eklemeden runtime erişemez.
- Owner rolü `NOLOGIN` olur. `FORCE ROW LEVEL SECURITY`, owner davranışından bağımsız ek savunmadır.
- Backup kimliği runtime secret store'da bulunmaz. Managed physical snapshot/PITR tercih edilir; `pg_dump` gerektiğinde ayrı job kimliği kullanır.

PostgreSQL dokümantasyonuna göre superuser ve `BYPASSRLS` rolleri politikaları her zaman aşar; table owner normalde RLS'yi aşabildiği için runtime'ın owner olmaması ve `FORCE ROW LEVEL SECURITY` birlikte zorunludur.

## 3. API Kullanıcı Bağlamı

Authenticated her API birimi tek database transaction'ı içinde çalışır:

1. `BEGIN`
2. `SELECT set_config('app.current_user_id', $ownerId::text, true)`
3. Gerekirse `SELECT set_config('app.correlation_id', $correlationId::text, true)`
4. Repository sorguları
5. `COMMIT` veya `ROLLBACK`

`set_config(..., true)` değeri yalnız mevcut transaction boyunca tutar. Connection pool'a dönen bağlantı kullanıcı kimliği taşımaz. Transaction dışındaki private repository sorguları kod kuralı ve testle yasaktır.

RLS helper semantiği:

```sql
nullif(current_setting('app.current_user_id', true), '')::uuid
```

Context hiç kurulmadıysa ifade `NULL` üretir ve policy default-deny olur. Hatalı UUID değeri request'i güvenli biçimde başarısız kılar. Runtime'da session-scope `SET` kullanılmaz.

Connection pool gereksinimleri:

- `max` toplamları PostgreSQL connection budget'a göre merkezi hesaplanır.
- Connection checkout'ta kullanıcı GUC'u kurulmaz; yalnız transaction başladıktan sonra kurulur.
- Timeout/cancel sonrası transaction mutlaka rollback edilir.
- PgBouncer eklenirse transaction pooling ile bu model korunur; session pooling özelliğine bağımlılık yoktur.
- Health/readiness sorguları private tabloya erişmez ve user context gerektirmez.

## 4. RLS Policy Şablonları

### 4.1 Kullanıcının kendi satırları

Tenant private tablolarında API politikası kavramsal olarak şöyledir:

```sql
USING (
  owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid
)
WITH CHECK (
  owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid
)
```

`auth.users` için `owner_id` yerine `id` kullanılır. `WITH CHECK`, kullanıcının insert/update ile owner kolonunu değiştirmesini engeller.

### 4.2 Worker politikaları

Worker'lar insan tenant context'i kurmaz. İlgili role özel RLS policy'si yalnız gerekli tablolarda bütün owner satırları için `USING (true)`/`WITH CHECK (true)` verir; fakat GRANT izinleri operasyon bazında sınırlar.

Örnekler:

- Monitor `app.checks` SELECT/UPDATE'in yalnız scheduling kolonlarını; monitoring tablolarında gerekli CRUD'u alır.
- Notifier recipient/policy/maintenance/incident için SELECT, intent/delivery için gerekli CRUD alır.
- Predictor private tablolar için politika almaz; yalnız security-barrier feature view ve prediction tablolarına erişir.
- Housekeeper doğrudan geniş tablo yetkisi yerine owner'ın kontrollü procedure'lerini execute eder.

Bir rolün RLS policy'si olması tablo privilege'ı olmadığı sürece erişim vermez; her ikisi birlikte gereklidir.

### 4.3 Partition tabloları

- RLS partitioned parent üzerinde tanımlanır.
- Runtime'a child partition üzerinde doğrudan privilege verilmez.
- Bütün DML parent tablo adı üzerinden yapılır.
- Yeni partition oluşturma testi parent policy/privilege zincirini doğrular.
- Partition owner'ı da `site_monitor_schema_owner` olur.

## 5. Rol/Veri Erişim Matrisi

`R` read, `I` insert, `U` update, `D` delete, `X` yalnız fonksiyon/view execute anlamındadır.

| Veri alanı             | API                        | Monitor                  | Notifier                 | Predictor                | Public | Housekeeper         |
| ---------------------- | -------------------------- | ------------------------ | ------------------------ | ------------------------ | ------ | ------------------- |
| User profili           | R/U (RLS)                  | –                        | –                        | –                        | –      | purge X             |
| Password/session/token | X + sınırlı RLS            | –                        | –                        | –                        | –      | cleanup X           |
| Check/group            | R/I/U/D (RLS)              | R + schedule U           | sınırlı R view           | feature view             | –      | purge X             |
| Maintenance            | R/I/U/D (RLS)              | R                        | R                        | –                        | –      | cleanup X           |
| Job/attempt            | gerektiğinde R (RLS)       | R/I/U                    | –                        | –                        | –      | cleanup X           |
| Run/current/interval   | R (RLS)                    | R/I/U                    | sınırlı R view           | feature view             | –      | partition/rebuild X |
| Incident/segment       | R (RLS)                    | R/I/U                    | sınırlı R                | feature view             | –      | cleanup X           |
| Recipient/policy       | R/I/U/D (RLS)              | –                        | R                        | –                        | –      | cleanup X           |
| Intent/delivery        | R (RLS)                    | –                        | R/I/U                    | –                        | –      | cleanup X           |
| Outbox/dispatch        | –                          | ilgili destination R/I/U | ilgili destination R/I/U | ilgili destination R/I/U | –      | cleanup X           |
| Public config          | R/I/U/D (RLS)              | snapshot refresh event   | –                        | –                        | –      | cleanup X           |
| Public snapshot        | R/I/U/D (RLS/internal)     | refresh X                | –                        | –                        | X      | cleanup X           |
| Rollup                 | R (RLS)                    | R/I/U                    | –                        | R via view               | –      | rebuild X           |
| Prediction             | R (RLS)                    | queue X                  | –                        | R/I/U                    | –      | cleanup X           |
| Audit                  | R yalnız ürün kararı varsa | I                        | I                        | I                        | –      | partition X         |

Implementation sırasında column-level GRANT'in bakım maliyeti yüksekse aynı sınırlar revoke edilmiş tablolar üzerindeki dar view/procedure'lerle uygulanır. “Geçici olarak full schema grant” kabul edilmez.

## 6. Authentication Bootstrap Problemi

Session token henüz owner id'ye çevrilmeden user-context RLS kurulamaz. Bu nedenle API'ye `auth.sessions` veya `password_credentials` üzerinde genel SELECT verilmez. `security_api` şemasındaki dar `SECURITY DEFINER` fonksiyonlar kullanılır.

### 6.1 Gerekli fonksiyonlar

| Fonksiyon                 | Girdi            | En fazla döndürdüğü veri                               | Koruma                                               |
| ------------------------- | ---------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| `resolve_session`         | token digest     | owner id, session id, expiry, status, password version | Exact digest eşitliği; revoked/expired sonucu dönmez |
| `lookup_login_credential` | normalized email | user id, hash, user/password status/version            | Yalnız API execute; dış hata daima genel             |
| `consume_one_time_token`  | purpose + digest | owner id ve atomik consume sonucu                      | Row lock; tek kullanımlı                             |
| `read_public_snapshot`    | slug digest      | yalnız public payload + generated time                 | Yalnız PUBLISHED snapshot                            |

### 6.2 Security-definer kuralları

- Fonksiyon sahibi ayrı, güvenilir owner rolüdür; çağıran runtime owner değildir.
- `SECURITY DEFINER SET search_path = pg_catalog, ...` ile sabit güvenli path kullanır.
- Bütün objeler yine schema-qualified yazılır.
- Dynamic SQL kullanılmaz; zorunluysa parametreli ve allowlist olur.
- `PUBLIC EXECUTE` revoke edilir, yalnız ilgili role grant edilir.
- Dönen kolonlar minimumdur; tablo row type döndürülmez.
- Fonksiyon API'den gelen owner id'yi yetkili kabul etmez.
- Timing/user enumeration riski API response contract ve rate limit ile ele alınır.
- Fonksiyon kaynakları migration ve security integration testinin parçasıdır.

## 7. Predictor İçin İzole Feature Yüzeyi

Predictor aşağıdaki alanları içermeyen bir `security_barrier` view veya dar fonksiyon okur:

- URL ve expected body string
- Kullanıcı e-postası/adı
- Notification recipient adresi
- Session/token/password verisi
- Ham diagnostic metni
- Public token digest'i

Feature yüzeyi yalnız `owner_id`/`check_id` teknik kimliği, UTC bucket zamanı, latency aggregate'ları, PASS/FAIL sayıları, availability/coverage ve incident aggregate'larını taşır. `owner_id`, score'un sahiplik ve purge bütünlüğü için gereklidir; predictor loglarına yazılmaz.

Predictor'ın `app`, `monitoring.current_state`, `monitoring.incidents`, `notification` ve `public_status` tablolarında UPDATE/INSERT/DELETE yetkisi yoktur. Model hatası veya kötü score bu yüzden ana sistemi değiştiremez.

## 8. Public Status Güven Sınırı

Anonymous istek için `app.current_user_id` kurulmaz. `site_monitor_public` rolü:

- Hiçbir private tablo/view üzerinde SELECT almaz.
- Yalnız `security_api.read_public_snapshot(bytea)` execute eder.
- Ham route token'ı uygulamada SHA-256 digest'e çevirir; veritabanına ham değer gitmez.
- Fonksiyondan yalnız `payload`, `payload_schema_version`, `generated_at` alır.

Public snapshot oluşturucu explicit DTO allowlist kullanır. “Private entity'yi serialize edip alan silme” yaklaşımı yasaktır. Snapshot payload'ına eklenecek her yeni alan contract/security review gerektirir.

## 9. PII, Secret ve Şifreleme

- Parola yalnız Argon2id encoded hash olarak saklanır.
- Session, verification ve public link secret'ları yalnız SHA-256 digest olarak saklanır.
- Production disk, snapshot ve PITR arşivleri platform encryption-at-rest ile şifrelenir; TLS zorunludur.
- E-posta adresi SMTP gönderimi için geri okunabilir olmalıdır. V1'de application-level field encryption eklenmez; RLS, privilege, encrypted storage/backup ve redaction ile korunur. KMS tabanlı field encryption ayrı threat-model gerektirir.
- Database URL/parola repository veya migration loguna yazılmaz.
- SQL/log tracing bind parametrelerini varsayılan olarak kaydetmez.
- Diagnostic kolonları response body, Authorization/Cookie header, URL user-info veya query secret'ı içermez.

## 10. Audit ve Yönetici Erişimi

- Runtime'da “admin tüm kullanıcıları görebilir” backdoor'u yoktur.
- Operasyonel veri incelemesi ayrı, süreli ve audit'li break-glass rolüyle yapılabilir; bu rol uygulama dağıtımının parçası değildir.
- User-visible değişiklikler, auth olayları, policy/public link değişiklikleri ve yetki reddi audit event üretir.
- Audit tablosu runtime için append-only'dir.
- RLS/constraint hatasının ayrıntısı dış kullanıcıya dönmez; correlation id ile iç log/audit'e bağlanır.

## 11. Zorunlu Güvenlik Testleri

Migration uygulamasında en az şu integration testleri bulunacaktır:

1. User A, User B'nin id'sini bilse de her private tabloda SELECT sonucu alamaz.
2. User A, B'nin check'ini kendi group/public component/maintenance/policy kaynağına bağlayamaz.
3. `owner_id` update edilerek satır transfer edilemez.
4. User context kurulmadan private sorgu zero-row/default-deny olur.
5. Bir pooled connection'daki A context'i sonraki B transaction'ına sızmaz.
6. Rollback/cancel/timeout sonrasında connection context'i sızmaz.
7. Runtime rollerinin DDL, `SET ROLE`, child partition direct access ve RLS bypass girişimi reddedilir.
8. Public role private tabloyu okuyamaz; yalnız doğru digest ile allowlist snapshot alır.
9. Eski public token rotation/disable transaction'ından sonra sonuç döndürmez.
10. Predictor ana state/incident/check/notification tablosuna yazamaz ve PII view edemez.
11. Notifier credential/session tablolarını; monitor recipient/password tablolarını okuyamaz.
12. Security-definer fonksiyonlarında search-path hijacking ve beklenmeyen overload çağrısı başarısız olur.
13. Yeni oluşturulan partition parent ile aynı güvenlik davranışına sahiptir.
14. Backup/restore testi satır sayısını RLS nedeniyle eksik almadan doğrular.

## 12. İlgili PostgreSQL Davranışları

- [Row security policies](https://www.postgresql.org/docs/18/ddl-rowsecurity.html): policy yoksa default-deny; superuser/BYPASSRLS ve normal table-owner davranışı
- [CREATE ROLE](https://www.postgresql.org/docs/18/sql-createrole.html): `NOBYPASSRLS` ve diğer rol nitelikleri
- [Configuration setting functions](https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADMIN-SET): `current_setting(..., true)` ve transaction-local `set_config`
