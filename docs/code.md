# SixFinger Code

GitHub reposu seçip kendi branch'inde çalışan bulut kodlama oturumları. Bir Code oturumu, `kind = 'code'` olan bir
sohbettir; mesajlar, arka planda üretim ve akış sohbetle aynı altyapıyı paylaşır. Ajanın nasıl çalışacağı
[code-agent.md](code-agent.md)'de.

> **Durum:** Faz 1 (hesap bağlama, ortamlar, oturumlar, kredi, ekranlar) hazır. Faz 2'de sunucu tarafı tamam: kalıcı çalışma alanı,
> filtreli internet, Code araçları, ajan döngüsü (Qwen → Claude yedeği, adım/döngü/bağlam/kredi sınırları, kuyruk, tur sonu
> commit). Oturum ekranı (mesajlar, araç kartları, bağlam halkası, PR listesi) sırada.

## Ajan nasıl çalışır

Oturuma mesaj gönderince sunucu: krediyi denetler → **kuyruğa** girer (Pi'de aynı anda `CODE_MAX_RUNS`=2 oturum; fazlası sırada, sıra numarası
arayüze akar) → çalışma alanını hazırlar (ilk seferde klonlar, kurulum betiğini çalıştırır) → modelle araç döngüsüne girer.
Her tur sonunda değişiklikler **kullanıcının kimliğiyle** commit edilir (`Co-Authored-By: SixFinger Code` her zaman eklenir; oturum bağlantısı
ortam ayarına bağlı) ve oturumun +N −M özeti güncellenir. Kullanıcı durdursa bile o ana kadarki iş commit edilir.

Güvenlik/sınır kuralları: mesaj başına en çok `CODE_MAX_STEPS` tur (aşılırsa araçsız özet + "Devam et"); aynı araç+argüman+çıktı 3. kez gelince uyarı,
5. kezde durur; çıktı uzunluk sınırında en çok 2 kez "devam et" notu; bağlam `CODE_CONTEXT_TOKENS`'ı aşarsa eski araç çıktıları kırpılır, çok aşarsa tur durur;
kredi çalışırken biterse tur durur. Model zinciri: Qwen3.8-27B → Claude yedeği (Hızlı modele asla düşülmez).

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

## Sandbox altyapısı (Code çalışma alanları)

Code, sohbet sandbox'ından ayrı bir havuz kullanır (`sandboxd` içinde, `/v1/code/*`):

| | Sohbet sandbox'ı | Code çalışma alanı |
|---|---|---|
| Dosyalar | RAM'de (tmpfs), 64 MB | **Diskte kalıcı** (bind-mount), ortam başına 128 MB – 1,5 GB |
| Bellek / CPU | 320 MB / 0,5 | 1 GB / 1 çekirdek (`CODE_MEM_MB`, `CODE_CPUS`) |
| Komut süresi | en çok 120 sn | varsayılan 120 sn, en çok 15 dk |
| Aynı anda | 6 konteyner | **2 konteyner** (`CODE_MAX_CONTAINERS`; Pi 4 için) |
| İnternet | iptables ile 80/443 | **Docker `--internal` ağı + alan adı izin listeli proxy** |

**Ağ (Trusted/Custom/Full/None):** Code konteynerleri `sixfinger-code` adlı `--internal` Docker ağındadır; doğrudan internete **hiç**
çıkamazlar. Tek çıkış `sandboxd` içindeki CONNECT proxy'sidir (`HTTPS_PROXY` otomatik ayarlanır). Proxy her istekte kimlik doğrular,
alan adını izin listesine göre denetler, adı **kendisi çözer** ve yalnızca genel IP'lere bağlanır (özel/yerel/bulut meta veri
adresleri, DNS rebinding dahil reddedilir); yalnızca 80 ve 443 portlarına izin verir. Dolayısıyla firewall betiği gerekmez. Trusted listesi:
npm, PyPI, GitHub, crates.io, Go, Maven, RubyGems, jsDelivr/unpkg/cdnjs, Google Fonts, Playwright (`packages/…/egress.ts`).

**Token güvenliği:** GitHub token'ı yalnızca ilk klonlamada, tek seferlik bir yardımcı konteynere **ortam değişkeni olarak** verilir
(komut satırına yazılmaz); çalışma alanındaki `.git/config`'te token olmaz ve ajanın konteynerine hiç girmez. Push (Faz 4) da böyle yapılacak.

### Pi'de kurulum

```bash
# Çalışma alanları için dizin (ileride harici diske taşımak için CODE_WORKSPACES_HOST=/mnt/hdd/code yap)
sudo mkdir -p /var/lib/sixfinger-code && sudo chown 1000:1000 /var/lib/sixfinger-code
docker build -t sixfinger-sandbox:latest sandbox/        # ripgrep eklendi: imajı yeniden derle
git pull && docker compose --profile sandbox up -d --build
```

Sınama: `docker compose logs sandboxd` içinde `Code çıkış proxy'si dinliyor` satırı görünmeli. Boşta kalan konteyner 10 dk sonra kapanır,
çalışma alanı diskte kalır; 30 gün dokunulmayan çalışma alanı silinir (**itilmemiş çalışma kaybolur**).

## Ortamlar

Her kullanıcı kendi ortamlarını yönetir (en çok 10; ilk açılışta hazır bir `Default` gelir):

| Alan | Açıklama |
|---|---|
| Ağ erişimi | **None** internet yok · **Trusted** bilinen paket kaynakları · **Full** tüm internet (yerel ağ hariç) · **Custom** yalnızca yazdığın alan adları (`*.example.com` desteklenir) |
| Disk | Çalışma alanı tavanı, **128 MB – 1,5 GB**. Doldukça kredi daha hızlı tükenir |
| Ortam değişkenleri | `ANAHTAR=değer`; şifreli saklanır. `PATH`, `LD_*`, `*_PROXY` gibi sandbox'ı bozacak adlar reddedilir |
| Kurulum betiği | Çalışma alanı ilk hazırlanırken çalışır (ör. `npm ci`) |

> Ağ modları sandboxd'de uygulanır (yukarıdaki proxy). Disk tavanı `du` ile ölçülür: dolunca yazma/düzenleme reddedilir, `rm` gibi temizlik komutları çalışmaya devam eder.

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
| `GET /code/github/callback` | GitHub geri dönüşü (oturumsuz): yalnızca imzalı `state`i doğrulayıp kodu istemciye yönlendirir, hesabı **bağlamaz** |
| `POST /code/github/complete` `{code, state}` | Bağlantıyı tamamlar; `state`'i başlatan kullanıcıyla bu oturum aynı olmalı (hesap-bağlama CSRF'ine karşı) |
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
