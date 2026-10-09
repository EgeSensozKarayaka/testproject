# API Hata Sözleşmesi

**Aşama:** 4 — API, Event ve Hata Sözleşmeleri

**Durum:** Onaylandı; merkezi mapper ve temel conformance testleri uygulandı

**Tarih:** 2026-10-10

**Bağlı belgeler:** [`API_DESIGN.md`](./API_DESIGN.md), [`openapi-v1.yaml`](./openapi-v1.yaml)

## 1. Amaç

API hataları, istemcinin metin ayrıştırmasına gerek kalmadan güvenli ve deterministik davranabilmesi için `application/problem+json` medya türünde, RFC 9457 uyumlu tek bir zarf kullanır. İnsan tarafından okunabilen `detail` değişebilir; istemci davranışı yalnız `status`, stabil `code` ve alan hatalarındaki `pointer` üzerinden kurulmalıdır.

## 2. Problem Zarfı

```json
{
  "type": "https://status-monitor.example/problems/validation-failed",
  "title": "Request validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "instance": "/api/v1/checks",
  "code": "validation_failed",
  "request_id": "0192f82c-2f28-7448-8cc1-334f117c0630",
  "retryable": false,
  "errors": [
    {
      "pointer": "/timeout_ms",
      "code": "must_be_less_than_interval",
      "message": "timeout_ms must be lower than interval_seconds."
    }
  ]
}
```

Alanlar:

| Alan                  | Zorunluluk | Anlam                                                                                                                     |
| --------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `type`                | Zorunlu    | Stabil, çözümlenebilir problem türü URI'si. URI sürümlü kodu temsil eder; request verisi içermez.                         |
| `title`               | Zorunlu    | Problem türünün kısa ve stabil İngilizce başlığı.                                                                         |
| `status`              | Zorunlu    | HTTP durum kodunun gövde içindeki kopyası.                                                                                |
| `detail`              | Zorunlu    | Bu oluşuma ait güvenli açıklama; programatik sözleşme değildir.                                                           |
| `instance`            | Zorunlu    | Query ve secret/token içermeyen request path. Public token `{redacted}` olarak maskelenir.                                |
| `code`                | Zorunlu    | İstemci mantığı için stabil `snake_case` makine kodu.                                                                     |
| `request_id`          | Zorunlu    | Log ve destek korelasyonu; response `X-Request-Id` ile aynıdır.                                                           |
| `retryable`           | Zorunlu    | Aynı semantik işlemin daha sonra güvenle denenip denenemeyeceği. Retry güvenliği ayrıca idempotency koşullarına bağlıdır. |
| `errors`              | Koşullu    | Yalnız alan/parametre doğrulama sorunlarında sıralı hata listesi.                                                         |
| `retry_after_seconds` | Koşullu    | Retry edilebilir geçici `409`, `429` veya `503` için negatif olmayan saniye; `Retry-After` ile uyumludur.                 |

`null`, boş dizi ve debug alanları gereksizse gönderilmez. Stack trace, SQL, tablo/rol adı, dosya yolu, dependency cevabı ve iç exception mesajı dış response'a çıkmaz.

## 3. Alan Hataları

Her `errors` öğesi şu şekildedir:

```json
{
  "pointer": "/expected_status_code",
  "code": "out_of_range",
  "message": "expected_status_code must be between 100 and 599."
}
```

- JSON body alanı RFC 6901 JSON Pointer ile gösterilir.
- Query parametresi `/query/cursor`, path parametresi `/path/check_id`, header `/headers/if-match` biçimindedir.
- Hatalar önce pointer, sonra code ile deterministik sıralanır.
- `message` reddedilen parola, token, URL query'si, body eşleşme metni veya e-posta adresini tekrar etmez.
- Bilinmeyen request alanları reddedilir ve `unknown_field` kullanılır.
- Birden fazla alan hatası tek response'ta raporlanabilir; pahalı domain/DB kontrolü temel şema doğrulanmadan çalışmaz.

## 4. Stabil Problem Kodları

| HTTP | `code`                        | Kullanım                                                                                                | Retry                        |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 400  | `malformed_json`              | JSON parse edilemedi.                                                                                   | Hayır                        |
| 400  | `invalid_request`             | Şema dışı fakat alan bazına indirgenemeyen request.                                                     | Hayır                        |
| 400  | `invalid_cursor`              | Cursor bozuk, süresi geçmiş veya farklı sorguya ait.                                                    | Hayır                        |
| 400  | `invalid_precondition`        | Header sözdizimi veya koşul kombinasyonu geçersiz.                                                      | Hayır                        |
| 401  | `authentication_required`     | Session yok, süresi bitmiş veya iptal edilmiş.                                                          | Yeni auth sonrası            |
| 401  | `invalid_credentials`         | Login bilgileri yanlış; kullanıcı varlığını ayırt ettirmez.                                             | Hayır                        |
| 403  | `csrf_failed`                 | CSRF token/origin doğrulaması başarısız.                                                                | Yeni token sonrası           |
| 403  | `operation_forbidden`         | Kimliği bilinen kullanıcının hesap düzeyi işleme yetkisi yok. Başka kullanıcı kaynağı için kullanılmaz. | Hayır                        |
| 404  | `resource_not_found`          | Kaynak yok, silinmiş veya farklı owner'a ait.                                                           | Hayır                        |
| 404  | `public_page_not_found`       | Public token geçersiz, döndürülmüş, kapatılmış veya sayfa yok.                                          | Hayır                        |
| 405  | `method_not_allowed`          | Route var ancak yöntem desteklenmiyor.                                                                  | Hayır                        |
| 406  | `not_acceptable`              | Desteklenmeyen `Accept`.                                                                                | Hayır                        |
| 409  | `invalid_state_transition`    | Kaynak mevcut durumunda komutu kabul etmiyor.                                                           | Durum değişince              |
| 409  | `idempotency_key_reused`      | Aynı anahtar farklı operation/request fingerprint'i ile kullanıldı.                                     | Yeni anahtarla               |
| 409  | `idempotency_in_progress`     | Aynı anahtarlı transaction bounded bekleme sonunda hâlâ tamamlanmadı.                                   | `Retry-After` sonrası        |
| 409  | `resource_conflict`           | Unique/invariant/domain çakışması.                                                                      | Koşula bağlı                 |
| 409  | `quota_exceeded`              | Konfigüre operasyonel güvenlik kotası dolu; ürünün check sayısı sabit değildir.                         | Kaynak boşalınca             |
| 412  | `resource_version_mismatch`   | `If-Match` güncel `ETag` ile eşleşmiyor.                                                                | Yeniden okuyup karar verince |
| 413  | `payload_too_large`           | Body/alan/response güvenlik sınırı aşıldı.                                                              | Hayır                        |
| 415  | `unsupported_media_type`      | Content-Type desteklenmiyor.                                                                            | Düzeltince                   |
| 422  | `validation_failed`           | Alan, query veya header doğrulaması başarısız.                                                          | Düzeltince                   |
| 422  | `unprocessable_configuration` | Şema geçerli ancak alanlar arası domain kuralı geçersiz.                                                | Düzeltince                   |
| 428  | `precondition_required`       | Mutable kaynakta gerekli `If-Match` yok.                                                                | Header ekleyince             |
| 429  | `rate_limit_exceeded`         | Abuse/operasyon rate limit'i aşıldı.                                                                    | `Retry-After` sonrası        |
| 500  | `internal_error`              | Beklenmeyen sunucu hatası.                                                                              | Yalnız idempotent ise        |
| 503  | `dependency_unavailable`      | Zorunlu dependency geçici olarak kullanılamıyor.                                                        | Evet                         |
| 503  | `schema_incompatible`         | Runtime ile DB compatibility epoch/revision uyumsuz.                                                    | Deploy/migration sonrası     |

Liste v1 içinde yeni kodlarla genişletilebilir. İstemci bilinmeyen bir kodu aynı HTTP sınıfındaki genel hata olarak gösterebilmelidir.

## 5. Güvenlik ve Sahiplik

- Başka kullanıcıya ait kaynak ile var olmayan kaynak aynı `404 resource_not_found` cevabını üretir; zamanlama ve `detail` ayrım yaratmaz.
- Public token'ın geçersiz, disable edilmiş veya rotate edilmiş olması aynı `404 public_page_not_found` cevabıdır.
- Kayıt, parola sıfırlama ve doğrulama başlatma endpoint'leri hesap varlığını hata ile sızdırmaz; kabul edilen generic `202` döndürür.
- Login cevabı “e-posta yok” ile “parola yanlış” durumlarını ayırmaz.
- SSRF/policy reddi hedef IP'yi veya DNS çözümünü açığa çıkarmaz; private API owner'a güvenli kategori döndürebilir, public API döndüremez.

## 6. Concurrency, Retry ve Idempotency

- `428` istemcinin kaynağı tekrar okumasını değil eksik precondition'ı göndermesini ister.
- `412` istemcinin son representation/ETag'i okuyup kullanıcı kararını tekrar almasını ister; otomatik overwrite yasaktır.
- `409 idempotency_key_reused`, anahtarın aynı operation scope'unda farklı request hash'iyle kullanılmasıdır.
- Aynı idempotency key ve aynı fingerprint tamamlanmışsa ilk status/body/Location semantik olarak tekrar oynatılır; yeni domain işlemi çalışmaz.
- Belirsiz ağ hatasından sonra yalnız idempotent yöntemler veya `Idempotency-Key` korumalı komutlar otomatik denenebilir.
- `500` cevabındaki `retryable` varsayılan olarak `false` olur; sunucunun işlemi commit edip etmediği belirsiz olabilir.

## 7. İç Hata Eşleme Sırası

Handler dış sınıra çıkarken hatalar merkezi mapper tarafından şu öncelikle çevrilir:

1. Medya/parse ve request schema doğrulaması
2. Kimlik, session ve CSRF
3. Kaynak görünürlüğü ve ownership
4. Precondition/optimistic concurrency
5. Domain state/invariant
6. Rate limit/quota
7. Bilinen geçici dependency
8. Beklenmeyen internal hata

Database constraint veya driver mesajı doğrudan istemciye gönderilmez. Beklenen constraint'ler stabil domain/application hatasına eşlenir; bilinmeyenler `internal_error` olur ve yalnız server logunda ayrıntılanır.

## 8. Loglama ve Gözlemlenebilirlik

Her problem server logunda `request_id`, `code`, `status`, route template ve güvenli actor/resource kimliği ile yapılandırılmış olarak kaydedilir. `4xx` normal kullanım hataları warn/error gürültüsü üretmez; güvenlik sinyalleri ayrı sayılır. `5xx` exception chain ile server tarafında kaydedilir, fakat response'a taşınmaz.

Loglarda aşağıdakiler redakte edilir:

- session, CSRF, doğrulama/reset ve public-page token'ları;
- `Authorization`, `Cookie` ve `Set-Cookie`;
- e-posta, beklenen body string'i ve URL query/fragment'i;
- probe response body ve SMTP payload'ı.

## 9. Örnekler

### 9.1 Eski ETag

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json
X-Request-Id: 0192f82c-3f95-73d0-a459-240f319f5d9a
ETag: "rv-18"

{
  "type": "https://status-monitor.example/problems/resource-version-mismatch",
  "title": "Resource version mismatch",
  "status": 412,
  "detail": "The resource changed after it was read.",
  "instance": "/api/v1/checks/0192f7c8-548e-7c43-9f79-93cbf7eaf831",
  "code": "resource_version_mismatch",
  "request_id": "0192f82c-3f95-73d0-a459-240f319f5d9a",
  "retryable": true
}
```

### 9.2 Rate limit

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
Retry-After: 30

{
  "type": "https://status-monitor.example/problems/rate-limit-exceeded",
  "title": "Rate limit exceeded",
  "status": 429,
  "detail": "Too many requests for this operation.",
  "instance": "/api/v1/checks/{redacted}/runs",
  "code": "rate_limit_exceeded",
  "request_id": "0192f82c-50a9-71a4-9815-6dbef890f1eb",
  "retryable": true,
  "retry_after_seconds": 30
}
```

## 10. Doğrulama Kapısı

Uygulama aşamasında aşağıdaki sözleşme testleri zorunludur:

- her belgelenmiş `4xx/5xx` response'u OpenAPI `Problem` şemasına uyar;
- `Content-Type`, gövde `status` ve gerçek HTTP status aynıdır;
- her response ve log aynı `request_id`yi taşır;
- cross-owner ve nonexistent kaynaklar gözlemlenebilir response bakımından aynıdır;
- validation error sırası deterministiktir ve gizli input'u yansıtmaz;
- constraint/exception/stack trace dış response'a sızmaz;
- `Retry-After`, `retryable` ve idempotency davranışı uyumludur;
- public token hiçbir `instance`, `detail`, log veya metric label'ında görünmez.
