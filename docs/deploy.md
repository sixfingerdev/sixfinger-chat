# Dağıtım

Uygulama **tek bir servis** olarak çalışır: Fastify hem API'yi hem derlenmiş web arayüzünü (`WEB_DIST`) yayınlar.
Tek gereksinim Postgres'tir.

## Ortam değişkenleri

`apps/server/.env.example` dosyasındaki tüm değişkenler açıklamalıdır. Zorunlular:

| Değişken | Açıklama |
|---|---|
| `DATABASE_URL` | Postgres bağlantı adresi (`DATABASE_SSL=true` yönetilen servisler için) |
| `JWT_SECRET` | ≥ 32 karakter rastgele (`openssl rand -base64 48`) |
| `PUBLIC_WEB_URL` | Dışarıdan erişilen adres (paylaşım bağlantıları için) |
| `CORS_ORIGINS` | Arayüzü farklı bir alan adından yayınlıyorsan |

Opsiyonel: `AI_API_KEY` (Pollinations anahtarı), `SMTP_*` (e-posta kodları), `TRUST_PROXY=true` (proxy arkasında).
Şema migrasyonları sunucu açılırken otomatik uygulanır (`npm run migrate -w @sixfinger/server` ile elle de çalışır).

## Docker

```bash
docker build -t sixfinger-chat .
docker run -p 8787:8787 -e DATABASE_URL=... -e JWT_SECRET=... -e PUBLIC_WEB_URL=https://chat.example.com sixfinger-chat
```

`docker compose up --build` Postgres ile birlikte yerel bir kurulum başlatır.

## Render

`render.yaml` bir Blueprint'tir: Dashboard → **New → Blueprint** → bu repo. İlk dağıtımdan sonra
`PUBLIC_WEB_URL` değerini servis adresinle güncelle. Ücretsiz planda servis uykuya dalar; ilk istek yavaş olur.

## SMTP

Gmail için bir [uygulama parolası](https://myaccount.google.com/apppasswords) oluştur:
`SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=...`, `SMTP_PASSWORD=<uygulama parolası>`,
`SMTP_FROM="SixFinger <senin@gmail.com>"`. SMTP yoksa kodlar sunucu loguna yazılır (sadece geliştirme için).

## Bakım

Sunucu saatte bir: takılı kalan akışları kapatır, 14 gün görülmeyen misafirleri ve süresi dolan
kodları/oturumları temizler.
