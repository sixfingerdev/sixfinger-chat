# Görsel ekleme

Sohbette mesaja görsel eklenir (web: ataç/yapıştır/sürükle; mobil: ataç → fotoğraf/kamera; asistan: ekranda seç). Yalnızca **doğrulanmış üyeler**; mesaj başına en fazla 4 görsel.

## Hangi modeller görüyor (gerçek görselle sınandı)
| Model | Sağlayıcı | Sonuç |
|---|---|---|
| `minimax/minimax-m3.1-flash:free` | Kilo | ✅ |
| `Qwen3.8-27B` | OVH | ✅ |
| `qwen/qwen3.8-27b-free`, `nvidia/nemotron-3.5-super-vl-free` | llmtr | listede görsel girdi var, anahtarsız sınanamadı |
| Claude | Bedrock | görüntüler (Converse `image` bloğu), sınanamadı |
| `gpt-oss-120b` (OVH) | — | ❌ görseli **sessizce yok sayıp "göremiyorum" der** (hata vermez) |
| `openai-fast` (Pollinations), DeepSeek, GLM (LLM7) | — | ❌ 400 |

Bu yüzden görselli istek **yalnızca** şu sırayı kullanır: MiniMax → Qwen (OVH) → Qwen (llmtr) → Nemotron VL → Claude (`ai.ts` `VISION`). Hiçbiri yapılandırılmamışsa 503.

## Akış
- İstemci görseli uzun kenarı 1280 px olacak şekilde küçültüp JPEG'e çevirir (web: canvas; mobil: yerel modül `compressImage`, EXIF yönü uygulanır), ≤ ~900 KB.
- `POST /api/chats/:id/messages` gövdesinde `images: [{name, mime, data(base64)}]`. Sunucu boyut, tür ve **dosya imzasını** doğrular, kota düşmeden reddeder.
- Baytlar `message_images` tablosunda (`bytea`); mesaj DTO'sunda yalnızca `images: [{id,name,mime}]`. Bayt: `GET /api/images/:id` (yalnızca sahibi, değişmez önbellek).
- Modele giden geçmişte görsel yalnızca **en yeni 2 görselli kullanıcı mesajında** taşınır; eskilerin yerine metin notu girer (bağlam/maliyet).
- Code oturumlarında görsel yok.

## Dosya yükleme (sohbet ve Code) ve `read` ile görsel
Dosya seçilince (web ataç/sürükle, mobil ataç → Dosya) **doğrudan sandbox çalışma alanına** yazılır; mesaja içerik gömülmez, yalnızca yol notu girer
(`<ek ad="…" yol="/work/uploads/x.pdf" boyut="…">`). Model metin dosyasını `read`, diğerlerini (pdf, zip, xlsx…) `bash` ile açar.

- Sohbet: `POST /api/chats/:id/upload` → `/work/uploads/<ad>` (yalnızca sandbox hakkı olan üyeler). Code: `POST /api/code/sessions/:id/upload` → `.sixfinger/uploads/<ad>` (git'e girmez).
- Her tür dosya (ikili dahil), en çok **10 MB** (`UPLOAD_MAX_BYTES` / sandboxd `UPLOAD_MAX_BYTES`). sandboxd `write` `encoding: 'base64'` kabul eder, yeni `POST /v1/raw` ham bayt verir.
- Yükleme gönderim anında yapılır; başarısızsa metin dosyası mesaja gömülür (yedek), ikili dosya atılıp kullanıcıya bildirilir. Mesaj her durumda gider.
- **Görsel dosyaları**: `read` (.png/.jpg/.jpeg/.webp) görseli **modele gösterir** (sohbet ve Code): sonuç metin notu + hemen ardından kullanıcı mesajı olarak görsel. En çok ~2,5 MB; daha büyükse model `bash` ile küçültür. İmza dosya uzantısıyla uyuşmuyorsa hata. Code'da bu istekler yalnızca görsel destekleyen modellere gider (MiniMax → Qwen → Qwen llmtr → Claude).
- Modele giden görsel sayısı sınırlıdır (en yeni 2 görselli mesaj); eskilerin yerine not girer, gerekirse model dosyayı yeniden açar.
