# Seeds

Bu dizindeki SQL dosyaları yalnız development/test ortamında çalışan idempotent demo verisidir. Production'da seed komutu kesin olarak reddedilir.

```sh
pnpm db:seed
```

Başlangıç seed'i kullanıcı, grup, check, current UNKNOWN state, notification policy/recipient, taslak public sayfa ve predictor model metadata'sı oluşturur. Authentication Aşama 5'te uygulanacağı için demo password veya session üretmez; repository içinde parola/hash örneği saklanmaz.
