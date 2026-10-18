# SixFinger Code

GitHub reposu seçip kendi branch'inde çalışan bulut kodlama oturumları. Bir Code oturumu, `kind = 'code'` olan bir
sohbettir; mesajlar, arka planda üretim ve akış sohbetle aynı altyapıyı paylaşır. Ajanın nasıl çalışacağı
[code-agent.md](code-agent.md)'de.

> **Durum (Faz 1):** GitHub hesabı bağlama, repo/branch seçimi, ortamlar (ağ modu, disk, değişkenler, kurulum betiği),
> oturum oluşturma, kredi sayacı ve Code ekranları hazır. **Ajanın çalışması (Faz 2) henüz yok**: oturuma mesaj
> gönderilemez.

## Kurulum

### 1. GitHub OAuth uygulaması

GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**:

| Alan | Değer |
|---|---|
| Homepage URL | `https://chat.sixfinger.live` (kendi adresin) |
| Authorization callback URL | `https://chat.sixfinger.live/api/code/github/callback` |

Oluşturunca **Client ID**'yi kopyala, **Generate a new client secret** ile bir Client Secret üret.
Callback adresi `PUBLIC_WEB_URL + /api/code/github/callback` ile **birebir aynı** olmalı (farklıysa `GITHUB_REDIRECT_URL` ver).

> İstenen yetki `repo read:user`. Özel repolara erişim ve push için `repo` gerekir; bu kapsam hesabındaki **tüm**
> repolara erişim demektir (OAuth uygulamalarında repo bazında seçim yoktur). Token sunucuda AES-256-GCM ile şifreli
> saklanır, sandbox'a ve modele hiç verilmez. İstediğin zaman bağlantıyı kesebilirsin (GitHub tarafındaki yetki de
> iptal edilir). Repo bazlı seçim için ileride bir GitHub App'e geçilebilir.

### 2. `.env`

```bash
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
CODE_SECRET_KEY=$(openssl rand -base64 48)      # JWT_SECRET'tan ayrı! Değiştirirsen kayıtlı bağlantılar çözülemez
CODE_ALLOWED_EMAILS=sen@example.com,arkadas@example.com   # ya da herkes için *
```

Opsiyoneller: `CODE_DAILY_CREDITS` (varsayılan 100), `CODE_CLAUDE_DAILY_TOKENS` (Claude yedeği için genel günlük token tavanı,
varsayılan 2.000.000; `0` = yedek kapalı), `GITHUB_REDIRECT_URL`.

```bash
git pull && docker compose up -d --build
```

Code yalnızca **e-postası doğrulanmış** ve `CODE_ALLOWED_EMAILS` listesindeki üyeler içindir. Üçlü (GitHub Client ID/Secret +
`CODE_SECRET_KEY`) eksikse Code kapalıdır ve menüde görünmez. E-posta doğrulaması için SMTP gerekir
([raspberry-pi.md](raspberry-pi.md)).

## Ortamlar

Her kullanıcı kendi ortamlarını yönetir (en çok 10; ilk açılışta hazır bir `Default` gelir):

| Alan | Açıklama |
|---|---|
| Ağ erişimi | **None** internet yok · **Trusted** bilinen paket kaynakları · **Full** tüm internet (yerel ağ hariç) · **Custom** yalnızca yazdığın alan adları (`*.example.com` desteklenir) |
| Disk | Çalışma alanı tavanı, **128 MB – 1,5 GB**. Doldukça kredi daha hızlı tükenir |
| Ortam değişkenleri | `ANAHTAR=değer`; şifreli saklanır. `PATH`, `LD_*`, `*_PROXY` gibi sandbox'ı bozacak adlar reddedilir |
| Kurulum betiği | Çalışma alanı ilk hazırlanırken çalışır (ör. `npm ci`) |

> Ağ modlarının uygulanması (egress proxy) ve çalışma alanı diski Faz 2–3'te gelecek; şu an ayarlar kaydedilir.

## Kredi

Günlük bütçe (`CODE_DAILY_CREDITS`) üç kalemle harcanır; formül ve katsayılar `packages/shared/src/code-credits.ts`'de:

- **Model:** token başına. Claude yedeği kullanıcı için Qwen ile aynı fiyat (kullanıcı seçmedi); Bedrock harcamasını genel günlük token tavanı korur.
- **Çalışma süresi:** sandbox'ın açık kaldığı dakika başına, **disk doluluğuyla çarpılır** (boş alan 1×, tavana dayanmış alan 3×).
- **Disk kirası:** çalışma alanı diskte durdukça GB·saat başına.

Faz 1'de sayaç ve ekranlar var, harcama Faz 2'de başlar.

## Auto model

Tek seçenek. Zincir: **Qwen3.8-27B → Claude (Bedrock)**. Qwen'in araç çağırma kalitesi gerçek uç noktada ölçülmeli (Faz 2'nin
ilk işi).

## API

Hepsi `/api` altında, Bearer token ister. İzin yoksa `403`, GitHub bağlı değilse `409 github_required`.

| Uç nokta | |
|---|---|
| `GET /code/status` | `{available, allowed, github, credits}` (izinsiz kullanıcıda da `200`) |
| `POST /code/github/start` `{target:'web'\|'app'}` | GitHub yetkilendirme adresi |
| `GET /code/github/callback` | GitHub geri dönüşü (oturumsuz; imzalı `state` doğrular) |
| `DELETE /code/github` | Bağlantıyı keser, GitHub yetkisini iptal etmeyi dener |
| `GET /code/repos?q=` · `GET /code/branches?repo=owner/name` | Repo ve branch listesi |
| `GET/POST /code/environments` · `GET/PATCH/DELETE /code/environments/:id` | Ortamlar (değişkenler yalnızca tekil okumada döner) |
| `GET/POST /code/sessions` · `GET/DELETE /code/sessions/:id` | Oturumlar |

## Geliştirme

`apps/server/scripts/dev-code.ts` sahte GitHub'lı bir sunucu başlatır (izin ekranı atlanır, 4 örnek repo):

```bash
cd apps/server
GITHUB_CLIENT_ID=dev GITHUB_CLIENT_SECRET=dev CODE_SECRET_KEY=dev-code-secret-dev-code-secret-0001 CODE_ALLOWED_EMAILS='*' \
  npx tsx --env-file-if-exists=.env scripts/dev-code.ts
```
