# Güvenli HTTP Kontrol Motoru ve Hedef Simülatörü

**Durum:** Aşama 7 uygulama öncesi nihai tasarım  
**Tarih:** 2026-10-10 10:01 +06:00  
**Dayanak:** `AGENTS.md`, `REQUIREMENTS.md`, `ACCEPTANCE_CRITERIA.md`, `DOMAIN_MODEL.md`, `STATE_MACHINES.md`, `ARCHITECTURE.md`, `CHECKS_AND_GROUPS.md`, `DATABASE_SCHEMA.md`  
**Uygulama paketi:** `packages/check-engine`  
**Çalıştıran süreç:** `apps/monitor-worker` — Aşama 9'da scheduler ile bağlanacak  
**Test hedefi:** `apps/target-simulator` ve motorun process-içi HTTP/HTTPS fixture'ları

## 1. Amaç

Bu belge, bir check snapshot'ını alıp tek bir HTTP gözlemi üreten scheduler-bağımsız kontrol motorunun v1 sözleşmesini kesinleştirir. Motor:

- hedefe güvenli biçimde bağlanır;
- DNS, TCP, TLS, ilk byte ve toplam süreyi ölçer;
- beklenen durum kodu ile opsiyonel body metnini doğrular;
- redirect, timeout, IPv4/IPv6, büyük/sonsuz yanıt ve ağ hatalarını deterministik sınıflandırır;
- SSRF ile DNS rebinding girişimlerinde bağlantı kurulmadan fail-closed davranır;
- ham response body, URL query değeri, credential veya hedef IP'yi kalıcı veriye ve loglara taşımaz;
- tek bir yavaş hedefin Node.js event loop'unu veya başka probe'ları bloke etmediği async streaming I/O kullanır.

Motor bir HTTP client wrapper'ı değildir. Güvenlik politikası, zaman bütçesi, bounded streaming ve hata taksonomisi bu domain bileşeninin parçasıdır.

## 2. Kapsam ve Kapsam Dışı

### 2.1 Bu aşamanın kapsamı

- Saf `ProbeEngine` portu ve immutable giriş/çıkış tipleri
- Doğrudan HTTP/1.1 ve HTTPS kontrolü
- Public IPv4/IPv6 adres politikası
- DNS çözme, tüm cevapları doğrulama ve connection pinning
- Manuel redirect takibi
- Total deadline, connect timeout ve harici cancellation
- Bounded header/body okuma ve streaming body matcher
- Durum kodu/body beklentisi
- Yapılandırılmış hedef hata kategorileri
- Deterministik simulator endpoint'leri
- Gerçek socket kullanan motor entegrasyon testleri

### 2.2 Sonraki aşamalarda kalacaklar

- Job oluşturma, claim, lease, fencing ve aynı check'in overlap engeli: Aşama 9
- Sonucu `check_runs` tablosuna yazma ve stale snapshot reddi: Aşama 9
- `UP/SUSPECT/DOWN`, incident ve group status geçişleri: Aşama 8–9
- Scheduler fairness ve global/owner/hostname concurrency: Aşama 9
- Maintenance ve notification kararı: Aşama 10–11
- History rollup, dashboard, SSE ve public sayfa: sonraki aşamalar
- ICMP, TCP-only, UDP, DNS-only, custom HTTP method/header/auth, mTLS ve proxy monitoring: v1 dışı
- HTTP/3 ve zorunlu h2-only hedefler: v1 dışı
- Çok bölgeli probe ağı: v1 dışı

Kontrol motorunun çökmesi veya beklenmeyen exception üretmesi hedefin düştüğü anlamına gelmez. Bu durum worker/job altyapı hatasıdır ve incident state machine'e target failure olarak verilmez.

## 3. Gereksinim İzlenebilirliği

| Gereksinim       | Tasarım karşılığı                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| FR-CHECK-008     | DNS/connect/TLS/timeout/status/body ayrımlı hata taksonomisi                                              |
| NFR-PERF-003/004 | Tam async I/O, per-probe cancellation, bounded stream; kapasite Aşama 9 concurrency katmanıyla tamamlanır |
| NFR-SEC-001      | Tüm DNS cevaplarını doğrulama, IP pinning, her redirect hop'unda yeniden politika kontrolü                |
| NFR-SEC-002      | Yalnız `http:`/`https:`, public adresler ve deployment port allowlist'i                                   |
| NFR-SEC-005      | Ham body/query/IP/secret için persist ve log yasağı                                                       |
| AC-022           | Protokol, userinfo, hostname, port ve adres politikasında fail-closed doğrulama                           |
| AC-037           | Hang/slow fixture ile bağımsız probe'ların ilerlediği concurrency testi                                   |
| AC-080/081/082   | Motorun non-blocking ve bounded olması; 20/200/500 scheduler kapasitesi Aşama 9'da                        |
| AC-100           | Localhost, private/link-local/special-use/metadata ve private redirect engeli                             |
| AC-101           | Resolve-once-per-hop ve frozen candidate set kullanan connector                                           |
| AC-102           | Negatif log/result/body sızıntı testleri                                                                  |

## 4. Mimari Sınırlar

```text
CheckJob.config_snapshot
          |
          v
  Snapshot decoder/validator
          |
          v
      ProbeEngine
      |    |    |
      |    |    +--> MonotonicClock
      |    +-------> AddressPolicy
      +------------> ResolverPort
          |
          v
   Frozen public candidate set
          |
          v
     HttpTransport
   (direct, pinned I/O)
          |
          v
      ProbeResult
          |
          +--> Aşama 9 persistence/fencing
          +--> Aşama 8 state transition
```

`packages/check-engine` veritabanı, Fastify, scheduler, logger veya environment variable bilmez. Bütün runtime policy değerleri ve adapter'lar constructor ile verilir. Böylece motor:

- process içinde saf entegrasyon testine açıktır;
- scheduler olmadan çalıştırılabilir;
- testlerde yalnız belirlenmiş loopback origin'ine izin veren policy enjekte edebilir;
- uygulama içinden yanlışlıkla proxy veya geniş network erişimi devralmaz.

Üretim adapter'ı için doğrudan ve pinlenmiş düşük seviye bağlantı gerektiğinden global `fetch` yerine doğrudan, workspace'te pinlenmiş `undici` bağımlılığı kullanılacaktır. IP/CIDR ayrıştırması güvenlik-kritik özel parser yazmak yerine doğrudan pinlenmiş `ipaddr.js` ile yapılacak; kabul edilen bloklar repository-owned ve testli policy tablosu olacaktır.

## 5. Giriş Sözleşmesi

Motor yalnız worker'ın job'dan çözdüğü immutable snapshot ile çağrılır:

```ts
interface ProbeInputV1 {
  schemaVersion: 1;
  url: string;
  timeoutMs: number;
  expectedStatusCode: number;
  expectedBodySubstring: string | null;
}

interface ProbeInvocation {
  input: Readonly<ProbeInputV1>;
  signal: AbortSignal;
}
```

Snapshot'ta `owner_id`, check adı, e-posta veya loglanabilir kullanıcı metni bulunmaz. Worker korelasyon kimliklerini motor dışında taşır.

Mevcut Aşama 6 manuel job snapshot'ları `schema_version` taşımamaktadır. Aşama 7 uygulamasında:

1. yeni job'lar snake_case `schema_version: 1` ile yazılır;
2. decoder yalnız tam olarak bilinen v1 alanlarını kabul eder;
3. geçiş süresinde tam legacy alan seti sürüm 1 olarak normalize edilir;
4. eksik, fazla, tipçe yanlış veya desteklenmeyen sürüm hedef hatası değil `UNSUPPORTED_JOB_SNAPSHOT` altyapı hatasıdır;
5. snapshot içeriği loglanmaz.

URL daha önce API katmanında doğrulanmış olsa da worker trust boundary'sinde tekrar doğrulanır. Kalıcı veri güvenilir input sayılmaz.

## 6. Çıkış ve Hata Sözleşmesi

### 6.1 Target sonucu

```ts
type ProbeFailureCategory =
  | 'DNS_ERROR'
  | 'CONNECT_ERROR'
  | 'TLS_ERROR'
  | 'TIMEOUT'
  | 'TOO_MANY_REDIRECTS'
  | 'BLOCKED_TARGET'
  | 'RESPONSE_TOO_LARGE'
  | 'UNEXPECTED_STATUS'
  | 'BODY_MISMATCH'
  | 'PROTOCOL_ERROR'
  | 'UNKNOWN_NETWORK_ERROR';

interface ProbeTimings {
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
  totalMs: number;
}

interface ProbeResult {
  outcome: 'PASS' | 'FAIL';
  failureCategory: ProbeFailureCategory | null;
  statusCode: number | null;
  bodyMatch: boolean | null;
  timings: ProbeTimings;
  redirectCount: number;
  diagnosticCode: ProbeDiagnosticCode | null;
}
```

`diagnosticCode` serbest metin değildir; sabit bir allowlist enum'dur. DB `diagnostic` alanına gerekirse bu stabil kodun kısa, hassas olmayan açıklaması yazılır. Socket error mesajı, stack, URL, IP, DNS cevabı, `Location` veya body bu alana girmez.

`bodyMatch` semantiği:

- beklenti yoksa `null`;
- beklenti varsa ve status doğrulamasından sonra stream içinde bulunduysa `true`;
- stream tamamlandığında bulunmadıysa `false`;
- body değerlendirilmeden network/status/size hatası oluştuysa `null`.

### 6.2 Altyapı sonucu

Aşağıdakiler `ProbeResult FAIL` değildir; typed exception/fault olarak çağırana döner:

- caller signal ile lease kaybı, shutdown veya job cancellation;
- bozuk/desteklenmeyen snapshot;
- engine invariant ihlali;
- adapter/programlama hatası.

Worker bunları target run/incident olarak kabul etmez; job retry/dead-letter ve gözlemlenebilirlik politikasına gönderir. Global probe deadline'ının dolması ise hedef açısından `TIMEOUT` sonucudur.

## 7. Tek Probe Algoritması

1. Monotonic başlangıç zamanı alınır; `deadline = start + timeoutMs` hesaplanır.
2. Snapshot alanları ve canonical URL tekrar doğrulanır.
3. İlk hop için scheme, userinfo, hostname, port, URL length ve fragment politikası uygulanır.
4. Host IP literal ise doğrudan adres politikasına; isim ise resolver'a verilir.
5. Resolver'ın döndürdüğü **bütün** A/AAAA adayları normalize edilir ve doğrulanır.
6. Tek bir blocked/invalid/zone-id/mapped-private aday varsa hop bütünüyle `BLOCKED_TARGET` olur; bağlantı denenmez.
7. Güvenli aday seti immutable olarak transport connector'a verilir. Connector DNS çağrısı yapamaz.
8. TCP ve gerekiyorsa TLS bağlantısı kalan total budget içinde kurulur; Host/SNI orijinal canonical hostname'tir.
9. Minimal GET isteği gönderilir; header ve body bounded streaming ile alınır.
10. Redirect yanıtıysa `Location` resolve edilir, policy tekrar baştan uygulanır ve yeni kısa ömürlü client kullanılır.
11. Final yanıtta size, status ve opsiyonel body beklentisi deterministik sırayla değerlendirilir.
12. Stream EOF veya hata ile tamamlandığında total süre ölçülür ve typed sonuç döner.
13. Her durumda socket/client, decoder ve timer `finally` içinde kapatılır.

Motor retry yapmaz. Scheduler retry'ı da normal target failure için anında yapılmaz; tekrarlar kullanıcının interval cadence'iyle gelir. Böylece bir probe birden fazla gizli denemeyle timeout'u ve hedef yükünü büyütmez.

## 8. URL ve İstek Politikası

### 8.1 URL doğrulama

- WHATWG `URL` parser kullanılır.
- Yalnız `http:` ve `https:` kabul edilir.
- Username/password içeren URL reddedilir.
- Hostname zorunludur; IPv6 zone ID reddedilir.
- Fragment istekten kaldırılır; query hedefe gönderilir fakat hiçbir telemetry/log/result alanına yazılmaz.
- Canonical URL UTF-8 byte uzunluğu en fazla 2048'dir; redirect sonrası URL de aynı sınıra tabidir.
- Internationalized domain, WHATWG tarafından ASCII/Punycode canonical hostname'e dönüştürüldükten sonra çözülür.
- HTTP varsayılan portu 80, HTTPS varsayılan portu 443'tür.
- Port, operator-controlled allowlist içinde olmalıdır. Production varsayılanı `80,443`; genişletme deployment config ile yapılır, kullanıcı request'iyle yapılamaz.
- `localhost`, `.localhost`, `.local`, `.internal`, `.home.arpa` ve tek-label internal adlar DNS'e gitmeden engellenir. Bu liste IP kontrolünün yerine geçmez.

### 8.2 İstek

- Method yalnız `GET`.
- Redirect dahil method body yoktur.
- `Host` ve TLS SNI canonical URL hostundan üretilir; pinlenen IP ile değiştirilmez.
- Stabil `User-Agent`, `Accept: */*`, `Accept-Encoding: identity`, `Cache-Control: no-cache` gönderilir.
- Cookie jar, Authorization, Proxy-Authorization, Referer, custom header ve ambient credential yoktur.
- Runtime `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` değişkenleri yok sayılır; bağlantı doğrudandır.
- HTTP upgrade (`101`) ve CONNECT davranışı desteklenmez.
- HTTP/1.1 v1 zorunlu tabandır; HTTP/2 optimizasyonu ancak aynı pinning/timing/limit testlerini geçiren ayrı kararla açılır.

## 9. DNS, IP Politikası ve Rebinding Savunması

### 9.1 Resolver

Production resolver adapter'ı her hop için izole bir `node:dns` Promise `Resolver` kullanır ve A/AAAA cevaplarını toplar. İşletim sistemi hosts/search-domain davranışına sessizce güvenmez. Harici abort/deadline'da resolver cancel edilir; geç sonuç kullanılamaz.

- IP literal için DNS yapılmaz ve `dnsMs = 0` olur.
- CNAME'in nihai A/AAAA cevapları doğrulanır.
- Cevap yoksa veya bütün sorgular uygun DNS hatası verirse `DNS_ERROR`.
- En fazla 16 adres kabul edilir. Daha fazla cevap fail-closed `DNS_ERROR/DNS_RESPONSE_LIMIT` olur; güvenlik için cevap kırpılıp devam edilmez.
- Duplicate adresler canonical byte formunda kaldırılır.
- Resolver sırası IPv4/IPv6 preference için tek gerçek değildir; transport yalnız doğrulanmış aday setinde bounded family selection yapabilir.

### 9.2 Public adres kuralı

Policy denylist yaklaşımıyla yalnız birkaç private CIDR'ı engellemez. Adres:

- canonical IPv4 veya IPv6 olmalı;
- IPv4-mapped IPv6 ise önce gömülü IPv4'e normalize edilip aynı kurallardan geçmeli;
- zone/scope identifier taşımamalı;
- loopback, unspecified, private, link-local, multicast, broadcast, carrier-grade NAT, benchmark, documentation, protocol-assignment, reserved ve future-use bloklarında olmamalı;
- cloud metadata adresleri ve özel servis uçları explicit engelli olmalı;
- IANA special-purpose registry'de `Globally Reachable = False` olan bir blokta olmamalıdır.

Normal global unicast adresler kabul edilir. Repository içinde reviewed CIDR tablosu tutulur; uygulama çalışırken IANA'dan policy indirilmez. Tablo güncellemesi security review ve unit test gerektirir.

Bir hostname hem public hem blocked bir adres döndürürse yalnız public olanı seçmek yerine bütün hop engellenir. Bu, saldırganın round-robin/dual-stack cevabıyla private hedefe şans eseri ulaşmasını önler.

### 9.3 Pinning

En önemli invariant:

> Bir hop için güvenlik doğrulamasında görülen adres seti ile socket'in bağlandığı adres seti aynıdır.

Akış:

1. isim bir kez çözülür;
2. bütün cevaplar doğrulanır;
3. canonical ve immutable aday seti oluşturulur;
4. Undici custom connector/lookup callback'i yalnız bu seti döndürür;
5. callback yeni DNS çağrısı yapamaz;
6. yeni redirect hop'u baştan yeni resolve+validation yapar;
7. hop client'ı tek request sonunda kapatılır; başka job veya daha sonraki DNS doğrulamasıyla havuz paylaşmaz.

TLS sertifika/hostname doğrulaması IP'ye değil orijinal hostname'e karşı yapılır. `rejectUnauthorized` kapatılamaz; custom CA veya insecure mode v1'de yoktur.

Kısa ömürlü per-hop client, global keep-alive havuzuna göre ek handshake maliyeti yaratır; karşılığında stale DNS/pool rebinding sınırını basit ve kanıtlanabilir tutar. 20/200/500 profili ölçülmeden daha karmaşık `(scheme,host,port,validated-address-set)` havuzu eklenmez.

### 9.4 Simulator için dar geliştirme istisnası

Gerçek ürün private ağ hedeflemez; Docker içindeki `target-simulator` ise doğal olarak private IP kullanır. Bu çelişki genel `ALLOW_PRIVATE_NETWORKS=true` bayrağıyla çözülmez.

- Testte `AddressPolicy` yalnız fixture'ın exact loopback adres/origin'ine izin veren adapter ile enjekte edilir.
- Local Compose demo'da yalnız `NODE_ENV=development` iken exact canonical origin allowlist'i kullanılabilir.
- Local Compose, simulator'ın `4010` portunu ayrıca deployment port allowlist'ine ekler; private-address istisnası port politikasını örtük olarak delmez.
- İstisna scheme+hostname+port üçlüsüne bağlıdır, wildcard/CIDR kabul etmez.
- İzinli origin'den redirect edilen her farklı origin normal public policy'ye tabidir.
- Production config bu alan doluysa process fail-fast kapanır.
- Bu istisna dış API ile veya kullanıcı başına değiştirilemez.

## 10. Redirect Politikası

- Yalnız `301`, `302`, `303`, `307`, `308` ve geçerli `Location` redirect olarak izlenir.
- `Location` relative olabilir; mevcut URL'ye göre WHATWG ile çözülür.
- Maksimum 5 takip edilen redirect vardır. Altıncı `TOO_MANY_REDIRECTS`.
- Aynı canonical URL'nin tekrar görülmesi limit beklenmeden `TOO_MANY_REDIRECTS/REDIRECT_LOOP`.
- Her hop scheme, userinfo, hostname, port, DNS, bütün-IP ve pinning kontrolünden geçer.
- HTTPS → HTTP downgrade `BLOCKED_TARGET/REDIRECT_DOWNGRADE` olur. HTTP → HTTPS kabul edilir.
- Redirect ile credential/header/cookie taşınmaz; zaten motor bunları desteklemez.
- `Location` eksik veya parse edilemezse beklenen status o kodsa final response olarak değerlendirilebilir; parse edilmeye çalışılan fakat geçersiz Location `PROTOCOL_ERROR` olur.
- Final status ve body beklentisi son yanıta uygulanır.
- Redirect hop body'leri okunmaz; response güvenli biçimde abort edilip per-hop client kapatılır.

`redirectCount`, gerçekten takip edilen hop sayısıdır. Redirect zincirindeki hostname veya URL'ler sonuç ve loglara yazılmaz.

## 11. Timeout, Deadline ve Cancellation

Kullanıcının `timeoutMs` değeri tek ve kesin **toplam probe bütçesidir**. Şunların tamamını kapsar:

- URL/policy çalışması;
- DNS;
- bütün adres denemeleri;
- TCP ve TLS;
- redirect zinciri;
- response header/TTFB;
- body'nin EOF'a kadar bounded okunması/decode edilmesi.

Her alt katman kalan bütçeyi kullanır. Ayrı runtime limitleri yalnız daha dar olabilir:

| Limit               |   Varsayılan | Kural                                |
| ------------------- | -----------: | ------------------------------------ |
| Total probe         | job snapshot | Canonical deadline                   |
| Connect+TLS per hop |    10.000 ms | `min(remaining, configured maximum)` |
| Response headers    |    remaining | Ayrı uzun default kullanılamaz       |
| Body idle           |    remaining | Her chunk'ta total deadline uzamaz   |
| Redirect            |            5 | Zaman bütçesini sıfırlamaz           |

Timer her hop için yeniden total süre vermez. Deadline bir kez başlar ve redirect/IPv4/IPv6 fallback boyunca aynı kalır.

- Global deadline dolarsa alt hata ne olursa olsun target sonucu `TIMEOUT` olur.
- Caller `AbortSignal` önce gelirse typed `CANCELLED` altyapı sonucu olur; target `TIMEOUT` yazılmaz.
- Deadline ve caller abort yarışında monotonic deadline kontrolüyle deterministic karar verilir.
- Timer, socket, DNS ve decoder cleanup idempotent olmalıdır.
- `setTimeout` tek başına kullanılmaz; gerçek I/O AbortSignal/socket destroy ile kesilir.

## 12. Zaman Ölçümleri

Süreler `performance.now()` benzeri monotonic clock ile ölçülür; `Date.now()` yalnız worker'ın `started_at/finished_at` wall-clock alanları içindir.

| Alan        | Anlam                                                                              |
| ----------- | ---------------------------------------------------------------------------------- |
| `dnsMs`     | İsim çözme süresi; IP literal için `0`; DNS başlamadan blocked URL için `null`     |
| `connectMs` | TCP bağlantı süresi; bağlantı kurulamadıysa harcanan connect süresi de ölçülebilir |
| `tlsMs`     | TCP sonrası TLS handshake; yalnız HTTPS hop'ları, aksi halde `null`                |
| `ttfbMs`    | Request dispatch ile response header başlangıcı arası süre                         |
| `totalMs`   | İlk motor başlangıcından body EOF/hata/cancel kararına kadar toplam                |

Redirect varsa phase alanları bütün hop'ların ilgili sürelerinin toplamıdır; `totalMs` tüm zincirin wall duration'ıdır. Phase toplamlarının `totalMs` ile tam eşit olması beklenmez; URL parse, stream okuma, decode ve scheduling aralıkları ayrıca vardır.

Süreler non-negative integer milisaniyeye yuvarlanır. Başlamayan faz `null`, başlamış fakat ölçüm çözünürlüğünün altında kalan faz `0` olabilir. Ölçüm instrumentation'ı exception mesajı veya IP taşımaz.

## 13. Response Okuma ve Body Doğrulama

### 13.1 Header ve body sınırları

- Header toplamı en fazla 16 KiB; aşım `PROTOCOL_ERROR/HEADERS_TOO_LARGE`.
- Wire body ve decode edilmiş body için ayrı ayrı 1 MiB hard cap uygulanır.
- `Content-Length` geçerli ve cap üzerinde ise stream okunmadan `RESPONSE_TOO_LARGE`.
- Chunked/lengthsiz yanıtta byte counter cap'i aştığı anda socket abort edilir.
- Body bellekte biriktirilmez, dosyaya yazılmaz ve hiçbir callback/log/event'e verilmez.
- Status-only check de EOF'a kadar bounded stream tüketir; böylece total süre gerçek tamamlanmayı ölçer ve sonsuz body timeout olur.

`Accept-Encoding: identity` gönderilir. Sunucu yine sıkıştırılmış içerik döndürürse:

- body beklentisi yoksa wire stream bounded biçimde tüketilir;
- body beklentisi varsa tek `gzip`, `deflate` veya `br` Node stream decoder ile açılır;
- hem wire hem decompressed byte cap'i korunur;
- bilinmeyen veya çoklu content-encoding `PROTOCOL_ERROR/UNSUPPORTED_CONTENT_ENCODING` olur.

### 13.2 Streaming substring

Expected body API sınırında 1–2048 UTF-8 byte'tır. Motor bunu UTF-8 byte pattern'e çevirir ve chunk sınırlarında çalışan streaming matcher kullanır. Yalnız matcher state'i ve en fazla pattern boyutuyla orantılı bounded overlap tutulur.

- Tam byte-level, case-sensitive eşleşme kullanılır.
- HTML parse, Unicode normalization, regex veya charset dönüşümü yapılmaz.
- Eşleşme erken bulunsa da stream cap/deadline içinde EOF'a kadar tüketilir.
- Invalid UTF-8 response, aranan byte pattern'i içermiyorsa normal mismatch'tir; body loglanmaz.

### 13.3 Değerlendirme önceliği

Deterministik öncelik:

1. caller cancellation — altyapı sonucu
2. total deadline — `TIMEOUT`
3. URL/address/redirect güvenlik — `BLOCKED_TARGET`
4. DNS/connect/TLS/protocol/network failure
5. redirect loop/limit
6. header/body/decompressed size — `RESPONSE_TOO_LARGE` veya protocol
7. expected status — `UNEXPECTED_STATUS`
8. expected body — `BODY_MISMATCH`
9. `PASS`

Bu sıra test edilir. Örneğin status beklenenden farklı ve `Content-Length` 2 GiB ise kaynak güvenliği nedeniyle `RESPONSE_TOO_LARGE`; body okunurken deadline dolarsa `BODY_MISMATCH` değil `TIMEOUT` olur.

## 14. Hata Taksonomisi

| Kategori                | Örnekler                                                    |        Status var mı? | Retryable işaretleme    |
| ----------------------- | ----------------------------------------------------------- | --------------------: | ----------------------- |
| `DNS_ERROR`             | NXDOMAIN, SERVFAIL, cevap yok, çok fazla adres              |                 Hayır | Sonraki cadence'de      |
| `CONNECT_ERROR`         | Refused, unreachable, bütün doğrulanmış adaylar başarısız   |                 Hayır | Sonraki cadence'de      |
| `TLS_ERROR`             | Sertifika, hostname, handshake, unsupported secure protocol |                 Hayır | Sonraki cadence'de      |
| `TIMEOUT`               | Total deadline DNS/connect/header/body sırasında doldu      |                 Bazen | Sonraki cadence'de      |
| `TOO_MANY_REDIRECTS`    | Limit veya loop                                             | Son redirect olabilir | Config/hedef düzelmeli  |
| `BLOCKED_TARGET`        | Private/special IP, unsafe port, downgrade, mixed DNS       |                 Hayır | Policy/config düzelmeli |
| `RESPONSE_TOO_LARGE`    | Content-Length, wire veya decoded cap                       |                  Evet | Hedef/config düzelmeli  |
| `UNEXPECTED_STATUS`     | Final status beklenen değil                                 |                  Evet | Sonraki cadence'de      |
| `BODY_MISMATCH`         | EOF'ta substring yok                                        |                  Evet | Sonraki cadence'de      |
| `PROTOCOL_ERROR`        | Bozuk HTTP, fazla header, unsupported encoding/upgrade      |                 Bazen | Sonraki cadence'de      |
| `UNKNOWN_NETWORK_ERROR` | Bilinen güvenli mapping dışında socket/network hatası       |                 Bazen | Sonraki cadence'de      |

Raw Node/Undici error code'u dış sözleşme değildir. Adapter, audited bir mapping tablosu kullanır. Bilinmeyen ağ exception'ı `UNKNOWN_NETWORK_ERROR`; programlama/invariant exception'ı ise engine fault'tur. Böylece gerçek kod hatası target downtime'a çevrilmez.

Tanı kodları örneği: `DNS_NXDOMAIN`, `DNS_SERVFAIL`, `DNS_RESPONSE_LIMIT`, `CONNECT_REFUSED`, `TLS_CERTIFICATE`, `TOTAL_DEADLINE`, `PRIVATE_ADDRESS`, `MIXED_ADDRESS_SET`, `PORT_NOT_ALLOWED`, `REDIRECT_LOOP`, `REDIRECT_DOWNGRADE`, `WIRE_BODY_LIMIT`, `DECODED_BODY_LIMIT`, `STATUS_MISMATCH`, `EXPECTED_TEXT_MISSING`.

## 15. Gizlilik ve Gözlemlenebilirlik Sınırı

### 15.1 Loglanabilecek alanlar

- worker/service version
- job/check kimliği — worker context'inden
- result category ve diagnostic enum
- numeric timings, redirect count ve response status
- result outcome

### 15.2 Yasak alanlar

- full/canonical URL ve query
- response body veya body preview/hash
- expected substring
- DNS answer, selected IP veya redirect Location
- request/response header değerleri
- cookie, credential, token, stack/exception message

Hostname-cardinality metric etiketi kullanılmaz. Gerekirse worker yalnız process-secret HMAC ile üretilmiş kısa host bucket'ını metric'te kullanır; bu Stage 17 kararıdır.

Logger motor bağımlılığı değildir. Worker typed result'tan allowlist alanları çıkarır. Hata nesnesini doğrudan `{ err }` biçiminde serialize etmek yasaktır; adapter yalnız safe diagnostic enum döndürür.

Negatif test, query secret'i, expected text marker'ı ve body marker'ını memory log sink, returned result, metric label ve serialized diagnostic içinde arar.

## 16. Runtime Policy Yapılandırması

Environment yalnız `monitor-worker` config katmanında okunur; parse edilmiş policy motora verilir.

| Ayar                        |      V1 varsayılanı | Güvenlik                            |
| --------------------------- | ------------------: | ----------------------------------- |
| `PROBE_MAX_REDIRECTS`       |                 `5` | 0–10 arası                          |
| `PROBE_MAX_RESPONSE_BYTES`  |           `1048576` | 1 KiB–10 MiB deployment sınırı      |
| `PROBE_MAX_HEADER_BYTES`    |             `16384` | Sabit/üst sınır 64 KiB              |
| `PROBE_CONNECT_TIMEOUT_MS`  |             `10000` | Total timeout'tan büyük olamaz      |
| `PROBE_MAX_DNS_RESULTS`     |                `16` | 1–32                                |
| `PROBE_ALLOWED_PORTS`       |            `80,443` | Operator-only allowlist             |
| `PROBE_USER_AGENT`          | sürümlü sabit değer | CR/LF ve secret yasak               |
| `PROBE_DEV_ALLOWED_ORIGINS` |                 boş | Production'da boş değilse fail-fast |

Per-check response limit, redirect, header veya özel ağ exception'ı v1'de yoktur. Bunlar kullanıcı kontrolüne açılırsa abuse budget, API sözleşmesi ve audit gerektirir.

## 17. Hedef Simülatörü

`apps/target-simulator` internet hedefini taklit eder; güvenlik policy'sini taklit etmez. Endpoint'ler deterministik ve bounded olmalıdır:

| Endpoint                       | Davranış                                              |
| ------------------------------ | ----------------------------------------------------- |
| `GET /ok`                      | `200`, sabit expected content                         |
| `GET /status/:code`            | İstenen geçerli HTTP status                           |
| `GET /delay/:milliseconds`     | Header öncesi bounded gecikme                         |
| `GET /stream/:chunks/:delay`   | Chunk'lar arası gecikmeli bounded body                |
| `GET /hang`                    | Client kapatana kadar cevap yok                       |
| `GET /body/match` / `mismatch` | Chunk sınırına yayılan expected text fixture'ı        |
| `GET /large/:bytes`            | Bellekte tek buffer oluşturmadan streaming büyük body |
| `GET /compressed/:encoding`    | gzip/deflate/br body                                  |
| `GET /redirect/:remaining`     | Relative, sonu `/ok` olan zincir                      |
| `GET /redirect-loop/a          | b`                                                    | Deterministik loop |
| `GET /redirect-to?target=`     | Yalnız testte private/unsafe redirect doğrulaması     |
| `GET /flaky/:key`              | İzole fixture instance'ında tanımlı 503/200 dizisi    |
| `GET /close`                   | Response tamamlanmadan socket kapama                  |

Simulator query/body değerlerini loglamaz. Parametrelerin tümü üst sınırlıdır; fixture kendi başına bellek/connection DoS üretemez. Flaky state process-local test fixture'ıdır, ürün durumu değildir; paralel testler ayrı instance/key kullanır.

TLS senaryoları için test suite ephemeral HTTPS server ve yalnız test amaçlı self-signed sertifika kullanır. Private key production image/config'e girmez. Simulator'ın mevcut health endpoint'leri korunur.

## 18. Test Stratejisi

### 18.1 Birim testleri

- URL canonicalization, userinfo, scheme, port, hostname ve redirect downgrade
- IPv4/IPv6 canonical parse; mapped IPv4, zone ID ve bütün blocked CIDR sınırları
- IANA policy tablosunun boundary adresleri
- Bir mixed public/private DNS setinin bütünüyle reddi
- Streaming matcher'ın her olası chunk boundary'si
- Wire/decoded byte counter ve exact cap sınırı
- Hata mapping ve precedence tablosu
- Monotonic deadline/abort yarışları fake clock ile
- Legacy/v1 snapshot decoder ve unknown field/version reddi

### 18.2 Gerçek I/O entegrasyon testleri

- HTTP success, unexpected status, body match/mismatch
- IPv4 ve ortam destekliyorsa IPv6 loopback
- TLS success test CA'sı, expired/wrong-host/self-signed failure
- connect refused, socket close, malformed HTTP
- header delay, body delay ve sonsuz hang timeout
- redirect relative/cross-host/loop/limit/downgrade/private target
- oversized Content-Length, chunked wire body ve compressed bomb
- caller cancellation'ın target failure üretmemesi
- bütün resource'ların test sonunda kapanması

Test policy yalnız oluşturulan fixture'ın exact loopback origin'ini kabul eder; production private-address policy gevşetilmez.

### 18.3 SSRF ve rebinding kanıtları

- literal `127.0.0.1`, `::1`, RFC1918, link-local, CGNAT, multicast, documentation ve metadata adresleri
- decimal/octal/hex benzeri URL parser varyantları canonical formdan sonra
- IPv4-mapped IPv6 private adres
- DNS'in yalnız private ve mixed public/private cevapları
- resolver ilk çağrıda public, olası ikinci çağrıda private döndüren fake: resolver çağrı sayısı 1 ve connector yalnız frozen ilk seti görür
- redirect public origin'den private hedefe: private connector hiç çağrılmaz
- dev exact-origin exception'ından farklı port/host/redirect kaçışı
- ambient proxy environment'ının bağlantı yolunu değiştirmediği test

### 18.4 Eşzamanlılık ve kaynak testleri

- Aynı process'te en az 50 motor çağrısı; bir hang varken hızlı çağrıların bağımsız tamamlanması
- Bütün çağrıların timeout olduğu durumda active socket/timer/decoder sayısının başlangıç seviyesine dönmesi
- Büyük response altında heap'in body boyutuyla doğrusal büyümemesi
- Event-loop delay için gevşek regresyon eşiği

20/200/500 check ve fairness testi motorun değil Aşama 9 scheduler'ın kapanış kapısıdır. Aşama 7, bu ölçeği mümkün kılan non-blocking primitive'i kanıtlar.

### 18.5 Property/fuzz testleri

- IP textual formu ve CIDR boundary'leri
- Redirect URL resolve/loop canonicalization
- Expected substring'in rastgele chunk bölünmeleri
- Error precedence'in olay sıraları

Fuzz test ağ erişimi yapmaz ve sabit seed'i failure çıktısında verir.

## 19. Performans ve Kapasite Modeli

500 check'in 30 saniyelik interval ile dengeli dağılımı ortalama yaklaşık 16,7 probe/s demektir; bu sayı ürün limiti değildir. Motorun kapasite ilkeleri:

- socket, DNS ve body tamamen async;
- her probe için O(1) body belleği ve expected pattern boyutuyla bounded matcher state'i;
- response ve redirect limitleriyle bounded ağ/CPU;
- per-hop client ile cross-job connection state paylaşımı yok;
- sync DNS, sync crypto, full-body buffering ve unbounded Promise fan-out yok.

Global/owner/hostname semaphore, jitter ve fairness scheduler/worker katmanındadır. Motor içinde global queue kurmak scheduler görünürlüğünü bozacağından yapılmaz. Aşama 9 load testinde handshake maliyeti hedefi karşılamazsa yalnız doğrulanmış candidate-set kimliğine bağlı, TTL ve max-lifetime sınırlı güvenli pool ayrı ADR ile değerlendirilecektir.

## 20. Dayanıklılık ve Yaşam Döngüsü

- Motor stateless'tir; server restart sonrası kalıcılık job/check tablolarındadır.
- Probe process kill olursa yarım target run yazılmaz; lease expiry/reclaim Aşama 9'dadır.
- Deadline/cancel cleanup birden çok kez çağrılabilir.
- Resolver, connector veya decoder geç callback'i tamamlanmış sonucu değiştiremez.
- Aynı invocation tek terminal sonuç üretir.
- Motor process-level `unhandledRejection` üretmez.
- Engine fault target failure'a çevrilmez; worker readiness yalnız sistemik hata oranı belirlenen eşiği aşarsa etkilenir.

## 21. Uygulama Dilimleri

1. Public tipler, snapshot decoder, policy config ve diagnostic enum
2. Strict URL/IP/CIDR policy ve kapsamlı boundary testleri
3. Resolver adapter, frozen candidate set ve rebinding test double'ı
4. Undici pinned transport, lifecycle ve phase instrumentation
5. Total deadline/cancellation ve deterministic error mapping
6. Bounded streaming, compression ve substring matcher
7. Redirect state machine
8. Target simulator endpoint'leri ve gerçek I/O entegrasyon suite'i
9. Monitor-worker'a yalnız standalone probe composition wiring'i; scheduler claim/persistence yapılmaz
10. Leak, concurrency, redaction ve CI kapanış testleri

Her dilim `format`, `lint`, strict `typecheck`, unit ve ilgili integration testinden geçer. Dependency lockfile ve lisans/audit sonucu ayrıca review edilir.

## 22. Tamamlanma Kapısı

Aşama 7 ancak aşağıdakilerin tümü sağlandığında tamamlanır:

- `ProbeEngine` scheduler ve DB olmadan deterministik çalışır.
- HTTP/HTTPS success, status/body mismatch ve bütün ağ kategorileri testlidir.
- Global deadline DNS/header/body/hang boyunca gerçekten I/O'yu keser.
- Redirect'lerin her hop'u yeniden resolve ve policy kontrolünden geçer.
- Rebinding testinde socket yalnız validated frozen candidate setine bağlanabilir.
- Private/special/mixed cevaplarda connector hiç çağrılmaz.
- Body ve header bellekte bounded; raw body hiçbir çıktıya ulaşmaz.
- Slow/hang probe diğer hızlı probe'ları bloke etmez.
- Caller cancellation target failure üretmez.
- Simulator gerekli deterministik senaryoları sağlar.
- Tam repository kalite kapısı ve container smoke geçer.
- `DECISIONS`, `DEVELOPMENT_LOG` ve `PROJECT_STATUS` gerçek sonuçlarla güncellenir.

## 23. Bilinen Tavizler

- Per-hop kısa ömürlü connection, güvenlik kanıtını sadeleştirirken keep-alive performansından vazgeçer.
- Varsayılan 80/443 port allowlist'i bazı meşru özel portları operator config olmadan engeller.
- Byte-level UTF-8 substring semantiği charset/DOM farkındalığı sağlamaz; deterministik ve bounded kalır.
- HTTP/1.1 tabanı h2-only hedefleri kapsamaz.
- Public-only policy intranet monitoring ürününü bilinçli olarak dışarıda bırakır.
- Aşama 7 tek probe güvenliğini çözer; aynı check overlap ve toplam concurrency garantisi Aşama 9 tamamlanmadan ürün kabul kriteri sayılmaz.

## 24. Referanslar

Tasarım hazırlanırken incelenen birincil kaynaklar:

- Node.js DNS API — `Resolver`, lookup/resolve farkı ve cancellation: <https://nodejs.org/docs/latest-v24.x/api/dns.html>
- Node.js monotonic performance API: <https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html>
- Undici `Client` seçenekleri — custom connect, timeout ve response limitleri: <https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md>
- Undici `Dispatcher` request lifecycle: <https://github.com/nodejs/undici/blob/main/docs/docs/api/Dispatcher.md>
- IANA IPv4 Special-Purpose Address Registry: <https://www.iana.org/assignments/iana-ipv4-special-registry>
- IANA IPv6 Special-Purpose Address Registry: <https://www.iana.org/assignments/iana-ipv6-special-registry>
- `ipaddr.js` resmi repository/API: <https://github.com/whitequark/ipaddr.js>

Bu bağlantılar runtime bağımlılığı değildir. Güvenlik policy tablosu review edilmiş haliyle repository'de pinlenir ve değişiklikleri test/ADR gerektirir.
