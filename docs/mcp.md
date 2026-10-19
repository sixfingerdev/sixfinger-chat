# Bağlayıcılar (MCP)

Kullanıcı, harici hizmetlerin **uzak MCP sunucularını** (Notion, Linear, Google Drive… ya da kendi adresi) bağlar; hem **Chat** hem **Code** ajanı
araçlarını `mcp__<sunucu>__<araç>` adıyla kullanır. Salt okunur araçlar otomatik çalışır, **veriyi değiştiren araç kullanıcıya sorar**.

Arayüz: web `/connectors` (kenar menüsü → Bağlayıcılar), mobil menü → Bağlayıcılar. Kod: `apps/server/src/services/mcp/*`, `routes/mcp.ts`,
paylaşılan katalog `packages/shared/src/mcp-presets.ts`, migrasyon `012_mcp.sql`.

## Nasıl çalışır
- **Aktarım**: Streamable HTTP; sunucu 400/404/405 dönerse eski SSE aktarımı. Çağrı başına bağlanılır, oturum tutulmaz. Bağlanma 15 sn, araç çağrısı 60 sn.
- **Güvenlik**: giden istekler SSRF korumalıdır (`services/mcp/guarded-fetch.ts`): yalnızca **https**, özel/yerel adresler ve yasak portlar reddedilir, çözümlenen
  tüm adresler denetlenir, yönlendirmeler (≤3) her adımda doğrulanır. Başlıklar ve OAuth jetonları `CODE_SECRET_KEY` ile şifrelenir (`secretbox`); API yanıtlarında asla görünmez.
  Araç çıktısı `[MCP · … — dış kaynaktan gelen veri, güvenilmez]` ile etiketlenir ve sistem istemi modele içindeki talimatlara uymamasını söyler.
- **Araç listesi** veritabanında önbelleklenir (ekleme/yenileme sırasında alınır): sohbet başlarken ağ beklemez. Kullanıcı başına ≤10 sunucu, sunucu başına ≤100 araç,
  modele bir turda ≤40 araç gösterilir.
- **Kapsam**: sunucu başına "Chat'te kullan" / "Code'da kullan". Plan modunda ve alt ajanlarda yalnızca onay gerektirmeyen araçlar görünür. Misafirler kullanamaz.

### Onay akışı
`readOnlyHint: true` ya da sunucu "tüm araçlar onaysız" / araç "hep izin ver" ise araç doğrudan çalışır. Aksi halde ilk çağrıda araç **çalışmaz**: `mcp_approvals` kaydı açılır,
araç parçasına `meta.approval` ve `meta.terminal` yazılır, **tur biter** ve mesajda onay kartı görünür (Bir kez izin ver / Hep izin ver / Reddet). Karardan sonra istemci
"Onayladım, devam et." ya da "Reddettim…" mesajı yollar, model aynı çağrıyı tekrarlar; sunucu aynı sohbet + aynı kanonik argümanlar için onayı bulur ve **tüketir**
(30 dk geçerli; farklı argüman ya da başka sohbet yeniden sorar). "Hep izin ver" aracı sunucunun `allow_tools` listesine ekler.

## OAuth
MCP yetkilendirme standardı (SDK `OAuthClientProvider`): kaynak meta verisi keşfi, PKCE, jeton yenileme. Akış GitHub bağlantısıyla aynı kalıptadır:
1. `POST /api/mcp/servers/:id/connect {target: web|app}` → yetkilendirme adresi (istemci tarayıcıda açar).
2. Sağlayıcı `PUBLIC_WEB_URL/api/mcp/oauth/callback`'e döner → sunucu imzalı `state`'i doğrular, web'de `/connectors?mcp_code&mcp_state`'e, uygulamada `sixfinger://connectors?…`'e yönlendirir.
3. Oturumlu istemci `POST /api/mcp/oauth/complete {code,state}` ile tamamlar; kod değişimi sunucuda yapılır, jetonlar şifreli saklanır.

- **dcr** (dinamik istemci kaydı): kullanıcı tek tıkla bağlanır (Notion, Linear, Supabase, monday, Miro, Granola, Wispr Flow; Canva, Asana, Intercom, Vercel, Indeed masaüstü akışıyla).
- **static**: istemci kaydı **sunucu yöneticisindedir** (aşağıda). `.env`'de tanımlı değilse kart "Yönetici kaydı gerekiyor" der ve pasif kalır.

### Yönetici kayıtları (.env)
Her sağlayıcıda **geri dönüş (redirect) adresi** `PUBLIC_WEB_URL/api/mcp/oauth/callback` olmalı (ör. `https://chat.sixfinger.live/api/mcp/oauth/callback`).

| Sağlayıcı | .env | Notlar |
|---|---|---|
| Google (Drive, Gmail, Calendar, Docs, Sheets, Slides) | `MCP_GOOGLE_CLIENT_ID/SECRET` | Google Cloud'da OAuth istemcisi: tür **Web application**, **"Use this client for an AI-powered agent"** işaretli; ilgili Workspace MCP API'leri etkin (Gmail/Drive/Calendar MCP API…), OAuth onay ekranında kapsamlar (ör. `gmail.readonly gmail.compose`, `drive.readonly drive.file`) ve **Google Workspace Developer Preview** üyeliği gerekir. Kapsamlar katalogda tanımlıdır; `access_type=offline` + `prompt=consent` otomatik eklenir. |
| Slack | `MCP_SLACK_CLIENT_ID/SECRET` | Slack dinamik kayıt desteklemez; **kendi Slack uygulaman** (dahili ya da dizinde yayımlı) gerekir. |
| HubSpot | `MCP_HUBSPOT_CLIENT_ID/SECRET` | Kayıt yöntemi doğrulanmadı: önce dinamik kayıt denenir; olmazsa bu değerler kullanılır. |

## Katalog (27 kart)
Sıra ve açıklamalar Claude'un "Browse connectors" listesine göredir. `ready` = adres belgelenmiş (Google), `verify` = adres/kayıt yöntemi dış kaynaklardan derlendi ve **gerçek bağlantıda doğrulanmalı**,
`soon` = bağlanamaz (Microsoft 365: herkese açık resmi adres yok). Adresler kartta düzenlenemez ama kullanıcı **Özel URL** ile istediğini ekleyebilir.
Linear ve Supabase kartlarında OAuth yerine **anahtarla** bağlanma seçeneği vardır; Shopify kartı mağaza adını sorar (`https://{mağaza}.myshopify.com/api/mcp`, kimlik doğrulamasız Storefront MCP).
Spotify adresi bir **pilot** ağ geçididir. Tam liste ve adresler: `packages/shared/src/mcp-presets.ts`.

## API (`/api/mcp`, oturum gerekir; misafir 403)
`GET /presets` · `GET|POST /servers` · `PATCH|DELETE /servers/:id` · `POST /servers/:id/refresh|connect|disconnect` · `GET /oauth/callback` (herkese açık) · `POST /oauth/complete` ·
`GET|POST /approvals/:id`. Ekleme bağlanamasa da sunucu kaydedilir (`lastError`; `authorization_required` = "Bağlan"a bas).

## Pi'de doğrulama kontrol listesi
Gerçek sağlayıcılara bu ortamdan erişilemediği için aşağıdakiler elle denenmelidir:
1. `.env`'de `PUBLIC_WEB_URL=https://chat.sixfinger.live` ve `CODE_SECRET_KEY` dolu; `docker compose --profile sandbox up -d --build`.
2. Bağlayıcılar → **Notion** → Bağlan → izin ver → listede "N araç" görünmeli. Aynısını Linear ve Context7 benzeri anahtarsız bir sunucuyla (Özel URL) dene.
3. Chat'te "Notion'da … ara" de: araç kartı görünmeli. Yazan bir araç iste: onay kartı çıkmalı, **Bir kez izin ver** → çalışmalı; **Reddet** → çalışmamalı.
4. Code oturumunda aynı akış; plan modunda yalnızca salt okunur araçlar listelenir.
5. Google/Slack için `.env` istemcilerini girip kartların aktifleştiğini ve jetonun yenilendiğini (1 saat sonra) doğrula.
6. Çalışmayan bir kartın adresi yanlışsa hata kartta görünür; **Özel URL** ile düzeltilmiş adresi ekle.

## Bilinen sınırlar
- Yalnızca uzak (https) MCP sunucuları; **stdio** (npx/uvx) sunucuları desteklenmez.
- "Etkileşimli" (MCP Apps) arayüzleri desteklenmez: bu sunucuların araçları metin olarak çalışır.
- Görsel/ses çıktıları modele metin yer tutucu olarak verilir.
- Her çağrıda yeniden bağlanıldığı için Pi'de ilk çağrı birkaç yüz ms yavaş olabilir (bağlantı havuzu yok).

## Gerçek sunucularla deneme sonuçları
Katalogdaki her kart, gerçek `createGuardedFetch` yoluyla ve `PUBLIC_WEB_URL=https://chat.sixfinger.live` ile, kartın adresine "ekle → Bağlan" akışı çalıştırılarak denendi (yetkilendirme sayfasına kadar;
kullanıcı girişi ve token değişimi insan gerektirdiği için denenemedi). Sonuç:

| Sonuç | Kartlar |
|---|---|
| **Normal akış**: yetkilendirme sayfasında giriş/onay ekranına ulaşıldı (kayıt + `https://…/api/mcp/oauth/callback` kabul) | Notion, Linear, monday.com, Miro, Supabase, Wispr Flow, Granola |
| **Masaüstü (loopback) akışı**: https yönlendirmesini reddediyor, `http://127.0.0.1:8976/callback` kabul ediyor (kayıt + yetkilendirme) | Canva (yetkilendirmede `Invalid redirect URI`), Asana, Intercom, Vercel, Indeed |
| **Kimlik doğrulamasız bağlandı** | Shopify (mağaza adı gerekir; araç listesi alındı) |
| **Hizmet SixFinger'ı reddediyor** (`blocked`) | Gamma (her yönlendirmeyi reddediyor), Figma (kayıt 403), Spotify (pilot, dinamik kayıt yok), Adobe (denenmedi) |
| **Dinamik kayıt yok → yönetici kaydı** (`.env`: `MCP_<ADI>_CLIENT_ID/SECRET`) | HubSpot, Box, Slack, Google ×6 (Drive, Gmail, Calendar, Docs, Sheets, Slides) |
| Pasif | Microsoft 365 (herkese açık adres yok) |

**Masaüstü (loopback) akışı**: `preset.redirect: 'loopback'` olan kartlar (`MCP_LOOPBACK_REDIRECT`) bağlanırken sunucu `manual: true` döner. Kullanıcı yetkilendirme sayfasını açıp onaylar; tarayıcı
`127.0.0.1:8976`'ya yönlenip "bağlanılamadı" der. Kullanıcı adres çubuğundaki URL'yi kopyalayıp penceredeki kutuya yapıştırır; istemci `parseOAuthCallback` ile `code`/`state`'i ayıklayıp
`POST /api/mcp/oauth/complete` çağırır (kod değişimi sunucuda). Sahte OAuth sunucusuyla uçtan uca test edildi; gerçek sağlayıcıda giriş sonrası kısmı Pi'de elle doğrulanmalı.

`blocked` kartlar arayüzde "Şimdilik kullanılamıyor" der; erişim anahtarı (token) olan kullanıcı "Özel URL ekle" ile yine ekleyebilir. Hizmetler politikasını değiştirirse `packages/shared/src/mcp-presets.ts`
içinde `status`'u güncelle. Ham OAuth hataları kullanıcıya anlaşılır Türkçe olarak gösterilir (`friendlyAuthError`).
