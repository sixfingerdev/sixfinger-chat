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

Yapay zekâ sağlayıcıları (`apps/server/src/services/ai.ts`). Her mod, yapılandırılmış sağlayıcıları bir **sırayla** dener; biri yanıt vermeye başlamadan hata verirse (200 dışı yanıt, hız sınırı, kesinti, boş yanıt) sıradakine geçilir.

| Sağlayıcı | Model | Ayarlar |
|---|---|---|
| LLM7 | `DeepSeek-V4-Flash-0731` (en güçlü, en hızlı) ve `GLM-5.3-Flash` — ücretsiz, anahtarsız da çalışır | `LLM7_BASE_URL`, `LLM7_MODEL`, `LLM7_MODEL_2`, `LLM7_API_KEY` |
| Kilo | `minimax/minimax-m3.1-flash:free` — ücretsiz, anahtarsız | `KILO_BASE_URL`, `KILO_MODEL`, `KILO_API_KEY` |
| OVH AI Endpoints | `Qwen3.8-27B` (Derin; Code'un ana modeli) ve `gpt-oss-120b` (Dengeli) | `AI_DEEP_*`, `AI_BALANCED_*` |
| Amazon Bedrock | Claude (isteğe bağlı yedek, bkz. [docs/bedrock.md](docs/bedrock.md)) | `BEDROCK_*` |
| Pollinations | `openai-fast` (GPT-OSS 20B) | `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` |

Güç sırası: DeepSeek > GLM > Qwen > MiniMax = Claude > gpt-oss-120b > gpt-oss-20b. Hız sırası: DeepSeek > MiniMax > diğerleri (eşit). Modların başındaki model sabit (Hızlı: MiniMax, Dengeli: gpt-oss-120b, Derin: DeepSeek); gerisi güç/hız sırasına göre dizilir:

| Mod | Sıra |
|---|---|
| Hızlı | **MiniMax** → DeepSeek → GLM → Qwen → gpt-oss-120b → gpt-oss-20b → Claude |
| Dengeli | **gpt-oss-120b** → MiniMax → GLM → DeepSeek → Qwen → Claude → gpt-oss-20b |
| Derin | DeepSeek → GLM → Qwen → MiniMax → Claude → gpt-oss-120b → gpt-oss-20b |

Yapılandırılmamış sağlayıcılar (`*_BASE_URL` boş, Bedrock yok) atlanır; `AI_FREE_ENABLED=false` DeepSeek/GLM/MiniMax'i zincirden çıkarır. Başlık üretimi ve hafıza gibi arka plan işleri de aynı zinciri kullanır.
Hepsi OpenAI uyumlu uçlardır. `reasoning_effort` destekleyen modellere her zaman en yüksek düzey gider (gpt-oss: `high`, DeepSeek/GLM/MiniMax: `max`; Qwen göndermez — bununla boş yanıt verir); menüdeki düşünme düzeyi bunlarda etkisizdir, `AI_MAX_EFFORT=false` kullanıcının seçtiği düzeye döner.

**Ücretsiz sağlayıcıların koruması:** `LLM7_API_KEY` isteğe bağlıdır; anahtar reddedilir (401/402/403) ya da kotası dolarsa (429) 10 dakika anahtarsız denenir; ≥ 1 dk beklemesi istenen uç o süre atlanır. **Code**'da varsayılan olarak
kullanılmazlar (depo içeriği üçüncü taraf servislere gider): Code (Auto) zinciri Qwen → Claude'dur; `AI_FREE_FOR_CODE=true` ile DeepSeek → GLM → Qwen → Claude olur (güç sırası). Önce Pi'de `apps/server/scripts/code-smoke.ts` ile ölçüp aç.

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
