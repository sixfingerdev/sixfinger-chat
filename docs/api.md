# API özeti

Tüm uç noktalar `/api` altındadır. Kimlik doğrulama: `Authorization: Bearer <accessToken>`.
Hatalar: `{ "error": { "code": "...", "message": "...", "details"?: ... } }`.

## Kimlik

| Yöntem | Yol | Açıklama |
|---|---|---|
| POST | `/auth/guest` | Misafir oturumu (`{locale}`) |
| POST | `/auth/register` | Kayıt. Misafir token'ıyla çağrılırsa o hesap yükseltilir |
| POST | `/auth/login` | Giriş |
| POST | `/auth/refresh` | `{refreshToken}` → yeni token çifti (rotasyon) |
| POST | `/auth/logout` | Refresh token'ı iptal eder |
| POST | `/auth/verify` · `/auth/verify/resend` | E-posta kodu doğrula / tekrar gönder |
| POST | `/auth/forgot` · `/auth/reset` | Şifre sıfırlama (kodla) |
| POST | `/auth/password` | Şifre değiştir |

## Profil

`GET /me` · `PATCH /me` · `DELETE /me` · `GET /config` · `GET /usage` ·
`GET /me/sessions` · `DELETE /me/sessions/:id` · `GET /me/export` ·
`GET/POST/DELETE /memories`

## Sohbetler

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/chats?q=&archived=` | Liste / arama |
| POST | `/chats` | Yeni sohbet `{title?, personaId?}` |
| GET | `/chats/:id` | Sohbet + tüm mesaj ağacı |
| PATCH | `/chats/:id` | `title, pinned, archived, personaId, leafId` |
| DELETE | `/chats/:id` · `/chats` | Sil |
| POST | `/chats/:id/messages` | **SSE** — mesaj gönder `{content, parentId?, attachments?, effort?}` |
| POST | `/chats/:id/regenerate` | **SSE** — `{messageId}` |
| PUT | `/messages/:id/feedback` | `{value: 1 \| -1 \| null}` |
| POST/DELETE | `/chats/:id/share` | Paylaşım bağlantısı oluştur / kaldır |
| GET | `/public/shares/:slug` | Herkese açık paylaşım (oturumsuz) |

### SSE olayları

Her satır `data: {json}`. Türler: `start`, `reasoning`, `delta`, `title`, `memory`, `usage`, `error`, `done`.
İstemci bağlantıyı keserse üretim durdurulur ve kısmi yanıt `stopped` olarak saklanır.

`parentId` mantığı: yeni mesaj bir asistan mesajına (ya da `null` = kök) bağlanır. Bir kullanıcı mesajını
düzenlemek, aynı `parentId` ile yeni mesaj göndermektir; yeniden üretme aynı kullanıcı mesajı altında
kardeş asistan mesajı oluşturur.
