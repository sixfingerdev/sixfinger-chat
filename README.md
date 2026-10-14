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

## Mimari

```
apps/
  server/   Fastify 5 + Postgres  (REST + SSE, migrasyonlar, testler)
  web/      React 18 + Vite PWA   (Capacitor ile Android kabuğu: apps/web/android)
packages/
  shared/   Şemalar (zod), tipler, katman limitleri, roller — iki taraf da kullanır
docs/       API, dağıtım ve Android rehberleri
```

Yapay zekâ sağlayıcısı: **Pollinations** `openai-fast` (GPT-OSS 20B, akıl yürütmeli). `AI_BASE_URL`/`AI_MODEL`/`AI_API_KEY`
ile başka bir OpenAI uyumlu uca çevrilebilir (`apps/server/src/services/ai.ts`).

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

Sistemde Postgres kurulu değilse paketle gelen gömülü sürümü kullanabilirsin: `npm run dev:db -w
@sixfinger/server` (veriler `apps/server/.dev-data/pg`, `sixfinger` + `sixfinger_test` veritabanları
otomatik oluşur). Yapay zekâya erişim olmayan ortamlarda arayüzü denemek için: `npm run mock-ai -w
@sixfinger/server` + `AI_BASE_URL=http://127.0.0.1:8790/openai`.

SMTP ayarlı değilse doğrulama kodları sunucu loguna yazılır.

```bash
npm run typecheck && npm test                        # sunucu testleri Postgres ister (TEST_DATABASE_URL)
```

## Tek komutla çalıştırma

```bash
docker compose up --build        # http://localhost:8787
```

Dağıtım (Render, Docker, kendi sunucun) için → [docs/deploy.md](docs/deploy.md).

## Android

Web arayüzü [Capacitor](https://capacitorjs.com) ile paketlenir. APK, GitHub Actions'taki **Android APK**
iş akışıyla ya da yerelde üretilir → [docs/android.md](docs/android.md).

## API

Özet uç noktalar → [docs/api.md](docs/api.md).

## Tasarım

Marka işareti: diyagonal bir kesikle bölünmüş altıgen blok. Arayüzde aynı kesik dil olarak aktif sohbet
işaretinde, akış imlecinde ve bekleme çizgisinde tekrar eder. Yazı tipi Geist; yüzeyler tek vurgu rengiyle
(turuncu) sade tutulur.
