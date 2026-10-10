# Seeds

Bu dizindeki SQL dosyaları yalnız development/test ortamında çalışan idempotent demo verisidir. Production'da seed komutu kesin olarak reddedilir.

```sh
pnpm db:seed
```

Başlangıç seed'i kullanıcı, grup, check, current UNKNOWN state, notification policy/recipient ve taslak public sayfa oluşturur. Seed kullanıcısı yalnız veri inceleme/worker demosu içindir; parola veya session üretmez. Tarayıcı demosu için normal kayıt → Mailpit doğrulama → giriş akışı kullanılmalıdır.

Python predictor teslim kapsamından çıkarıldığı için seed tahmin modeli veya skoru oluşturmaz.
