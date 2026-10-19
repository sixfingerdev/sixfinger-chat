<p align="center">
  <img src="apps/web/public/logo.svg" width="56" alt="SixFinger" />
</p>

<h1 align="center">SixFinger Chat</h1>

<p align="center">Düşünen, hızlı, sade bir yapay zekâ sohbet asistanı.<br/>Web (PWA), Android ve kendi sunucunda çalışan tam yığın proje.</p>

---

## Özellikler

**Sohbet**
- Gerçek zamanlı akış (SSE), durdurma, yeniden üretme, mesaj düzenleme ve **sürüm gezinme** (`‹ 2/3 ›`) — sohbet bir ağaç olarak saklanır
- Modelin **düşünce sürecini** ayrı, katlanabilir blokta gösterir ve süreyi ölçer
- Markdown, tablolar, **kod vurgulama + kopyalama**, **KaTeX** formüller (`\[ … \]` dahil)
- Düşünme derinliği: Hızlı / Dengeli / Derin
- Roller: Genel, Yazılımcı, Yazar, Öğretmen, Çevirmen, Analist, Kısa
- Otomatik başlık, sohbet arama (mesaj içeriğinde), sabitleme, arşivleme, yeniden adlandırma
- Dosya ekleme (metin/kod), sesle yazma ve sesli okuma, 👍/👎 geri bildirim
- Sohbeti herkese açık bağlantıyla **paylaşma** (düşünce süreci paylaşılmaz), Markdown/JSON dışa aktarma
- Komut paleti (`Ctrl/⌘ + K`), klavye kısayolları, koyu/açık tema, Türkçe/İngilizce

**Kişiselleştirme**
- Hitap adı, hakkında, özel talimatlar, varsayılan rol
- **Hafıza**: “bunu hatırla” dediğin bilgiler sonraki sohbetlerde kullanılır; listeden yönetilir

**Hesap sistemi**

| | Misafir | Kayıtlı (doğrulanmamış) | Üye (e-posta doğrulanmış) |
|---|---|---|---|
| Günlük mesaj | 15 | 40 | 300 |
| Mesaj uzunluğu | 4 bin | 8 bin | 24 bin karakter |
| Saklanan sohbet | 5 | 50 | 2000 |
| Arama, sabitleme, roller, özel talimat | – | ✓ | ✓ |
| Dosya ekleme, hafıza, paylaşım | – | – | ✓ |

Misafir olarak hesap açmadan hemen sohbet edilir; sonradan hesap oluşturunca sohbetler taşınır.
E-posta doğrulama ve şifre sıfırlama 6 haneli kodla (SMTP).

**Güvenlik**: scrypt parola özeti, kısa ömürlü JWT + dönen refresh token (yeniden kullanım tespiti), oturum listesi/iptali, rate limit, parametreli SQL, ham HTML temizleme (sanitize), Helmet, CORS beyaz listesi.

## Araçlar, artifact'lar ve sandbox

- **Web araçları** (herkes): `web_search` (DuckDuckGo, Bing yedekli) ve `web_fetch` (SSRF korumalı; fiyat/stok gibi somut veriler için sayfa içi JSON-LD'yi de okur).
- **Artifact'lar** (herkes): model tek dosyalık uygulama/oyun/SVG/diyagram/belge üretir; web'de yan panelde, mobilde tam ekranda, izole iframe/WebView içinde çalışır.
- **Widget'lar** (herkes): mesajın içinde küçük etkileşimli parçalar (grafik, hesaplayıcı); uygulama temasına uyar.
- **Code** (izin listesi): GitHub reposu seçip kendi branch'inde çalışan bulut kodlama oturumları; ortamlar, disk ve kredi sınırları. Faz 1 (hesap bağlama, ortamlar, oturumlar) hazır, ajan çalıştırması Faz 2. Kurulum: [docs/code.md](docs/code.md), tasarım notları: [docs/code-agent.md](docs/code-agent.md).
- **Sandbox** (yalnızca doğrulanmış üyeler): `bash`, `read`, `write`, `edit` — izole Docker konteynerinde, kaynak sınırlı, isteğe bağlı kısıtlı internet. Kurulum ve güvenlik modeli: [docs/sandbox.md](docs/sandbox.md).

## Mimari

```
apps/
  server/   Fastify 5 + Postgres  (REST + SSE, migrasyonlar, testler)
  web/      React 18 + Vite PWA   (Capacitor ile Android kabuğu: apps/web/android)
packages/
  shared/   Şemalar (zod), tipler, katman limitleri, roller — iki taraf da kullanır
docs/       API, dağıtım ve Android rehberleri
```

Yapay zekâ sağlayıcıları (çalışma moduna göre, `apps/server/src/services/ai.ts`):

| Mod | Sağlayıcı / model | Ayarlar |
|---|---|---|
| Hızlı | Önce ücretsiz modeller (aşağıda), sonra Pollinations `openai-fast` (GPT-OSS 20B) | `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` |
| Dengeli | OVH AI Endpoints `gpt-oss-120b` | `AI_BALANCED_BASE_URL`, `AI_BALANCED_MODEL`, `AI_BALANCED_API_KEY` |
| Derin | OVH AI Endpoints `Qwen3.8-27B` (akıl yürütmeli) | `AI_DEEP_BASE_URL`, `AI_DEEP_MODEL`, `AI_DEEP_API_KEY` |

Hepsi OpenAI uyumlu uçlardır (Dengeli `reasoning_effort` gönderir; Derin göndermez — Qwen bununla boş yanıt verir, o yüzden Derin'e başka bir model koyarsan `ai.ts`'teki bayrağı gözden geçir). Dengeli/Derin sağlayıcı yanıt vermeye başlamadan hata verirse istek otomatik olarak Hızlı
sağlayıcıya düşer; `AI_BALANCED_BASE_URL=` (boş) vermek o modu doğrudan Hızlı'ya yönlendirir.
Başlık üretimi ve hafıza gibi arka plan işleri Hızlı sağlayıcıyı kullanır.
**Yedek:** bunlardan biri hata verir, hız sınırına takılır ya da boş yanıt dönerse istek otomatik olarak Amazon Bedrock'taki
Claude'a düşer (isteğe bağlı; bkz. [docs/bedrock.md](docs/bedrock.md)).

**Ücretsiz sağlayıcılar** (`AI_FREE_ENABLED`, varsayılan açık; anahtarsız çalışır): LLM7 `DeepSeek-V4-Flash-0731` → LLM7 `GLM-5.3-Flash` → Kilo
`minimax/minimax-m3.1-flash:free` sırasıyla denenir (güç: DeepSeek > GLM > MiniMax). Hızlı modda ilk sıradadırlar; Dengeli/Derin'de seçilen modelden sonra, Bedrock'tan ve
Pollinations'tan önce gelirler. `LLM7_API_KEY` isteğe bağlıdır: anahtar reddedilir (401/402/403) ya da kotası dolarsa (429) 10 dakika anahtarsız denenir; ≥ 1 dk beklemesi istenen
uç o süre atlanır. Code'da varsayılan olarak **kullanılmaz** (depo içeriği üçüncü taraf servislere gider); `AI_FREE_FOR_CODE=true` ile Qwen'den sonra, Claude'dan önce DeepSeek/GLM denenir.
`reasoning_effort` destekleyen modellere her zaman en yüksek düzey gider (gpt-oss: `high`, ücretsiz modeller: `max`); menüdeki düşünme düzeyi bunlarda etkisizdir. `AI_MAX_EFFORT=false` kullanıcının seçtiği düzeye döner.
Ayarlar: `LLM7_BASE_URL/MODEL/MODEL_2/API_KEY`, `KILO_BASE_URL/MODEL/API_KEY` (adres boşsa o sağlayıcı kapalı).

İstemci iki ayrı değer gönderir: `mode` (`fast`/`balanced`/`deep`, hangi model) ve `effort` (`low`/`medium`/`high`, düşünme düzeyi).
Düşünme düzeyi Hızlı ve Dengeli'de uygulanır; Derin'de menüde gizlenir. `mode` göndermeyen eski istemcilerde `effort` modu belirler.

> **Not (kota):** Pollinations anonim katmanı IP başına kısa bekleme uygular (402/429). Sunucu bunu
> kuyruklayıp aralıklarla yeniden dener (`AI_MAX_CONCURRENCY`), ama çok kullanıcılı üretimde
> [enter.pollinations.ai](https://enter.pollinations.ai/keys) üzerinden bir anahtar (`AI_API_KEY`) almanı öneririz.

## Hızlı başlangıç (geliştirme)

Gereksinimler: Node 22, Postgres 14+.

```bash
npm install
createdb sixfinger && createdb sixfinger_test        # veya docker compose up db

cp apps/server/.env.example apps/server/.env         # DATABASE_URL ve JWT_SECRET'ı ayarla
npm run dev                                          # API :8787, web :5173
```

SMTP ayarlı değilse doğrulama kodları sunucu loguna yazılır.

```bash
npm run typecheck && npm test                        # sunucu testleri Postgres ister (TEST_DATABASE_URL)
```

## Tek komutla çalıştırma

```bash
docker compose up --build        # http://localhost:8787
```

Dağıtım (Render, Docker, kendi sunucun) için → [docs/deploy.md](docs/deploy.md).
Raspberry Pi'ye adım adım kurulum → [docs/raspberry-pi.md](docs/raspberry-pi.md).

## Android

Web arayüzü [Capacitor](https://capacitorjs.com) ile paketlenir. APK, GitHub Actions'taki **Android APK**
iş akışıyla ya da yerelde üretilir → [docs/android.md](docs/android.md).

## API

Özet uç noktalar → [docs/api.md](docs/api.md).

## Tasarım

Marka işareti: diyagonal bir kesikle bölünmüş altıgen blok. Arayüzde aynı kesik dil olarak aktif sohbet
işaretinde, akış imlecinde ve bekleme çizgisinde tekrar eder. Yazı tipi Geist; yüzeyler monokrom (siyah-beyaz)
bir paletle sade tutulur; vurgu rengi logodaki gibi koyuda beyaz, açıkta siyahtır.
