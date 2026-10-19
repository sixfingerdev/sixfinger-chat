# SixFinger Code

GitHub reposu seçip kendi branch'inde çalışan bulut kodlama oturumları. Bir Code oturumu, `kind = 'code'` olan bir
sohbettir; mesajlar, arka planda üretim ve akış sohbetle aynı altyapıyı paylaşır. Ajanın nasıl çalışacağı
[code-agent.md](code-agent.md)'de.

> **Durum:** Hesap bağlama, ortamlar, oturumlar, kredi, kalıcı çalışma alanı, filtreli internet, Code araçları, ajan döngüsü
> (Qwen → Claude yedeği), bağlam sıkıştırma, tur sonu commit + otomatik PR, alt ajan / soru / plan modu, slash komutları, dosya gezgini,
> geri sarma, oturum yönetimi ve metin ekleri hazır (web + Android). Gerçek Docker, gerçek Qwen ve gerçek GitHub OAuth ile sınama Pi'de
> yapılmalı (aşağıdaki "Doğrulama" betikleri).

## Ajan nasıl çalışır

Oturuma mesaj gönderince sunucu: krediyi denetler → **kuyruğa** girer (Pi'de aynı anda `CODE_MAX_RUNS`=2 oturum; fazlası sırada, sıra numarası
arayüze akar) → çalışma alanını hazırlar (ilk seferde klonlar, kurulum betiğini çalıştırır) → modelle araç döngüsüne girer.
Her tur sonunda değişiklikler **kullanıcının kimliğiyle** commit edilir (`Co-Authored-By: SixFinger Code` her zaman eklenir; oturum bağlantısı
ortam ayarına bağlı) ve oturumun +N −M özeti güncellenir. Kullanıcı durdursa bile o ana kadarki iş commit edilir.

Güvenlik/sınır kuralları: **adım sınırı yoktur** (ajan işi bitirene kadar sürer); aynı araç+argüman+çıktı 3. kez gelince uyarı,
5. kezde durur; çıktı uzunluk sınırında en çok 2 kez "devam et" notu; bağlam (`CODE_CONTEXT_TOKENS`, varsayılan 262144) `CODE_COMPACT_AT` (0,8) oranına dolunca önce eski araç çıktıları kırpılır, yetmezse eski konuşma modele özetlettirilir (son tur olduğu gibi kalır; özet mesajın `compaction` parçasında saklanır ve sonraki turların geçmişi "özet + sonrası" olarak kurulur; özetleme başarısız olursa kırpmayla sürülür); yine de taşarsa tur durur;
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
(komut satırına yazılmaz); çalışma alanındaki `.git/config`'te token olmaz ve ajanın konteynerine hiç girmez. **Push da böyle yapılır** (ajan her turun sonunda kendisi iter; elle yeniden deneme: `POST /code/sessions/:id/push|pr`): ajanın yazabildiği `.git` dizinine
(config, hook, credential helper…) token'lı süreçte **hiç güvenilmez**. `sandboxd`, çalışma alanı **salt okunur** bağlı tek seferlik bir
yardımcı konteynerde bizim kontrolümüzde boş bir bare git dizini açar; ajanın nesnelerini yalnızca *alternates* ile veri olarak okur ve
son commit'i `sixfinger/…` branch'ine iter (zorla itme yok). Token yalnızca o konteynerin ortamındadır, çıktılardan temizlenir.

### Pi'de kurulum

```bash
# Çalışma alanları için dizin (ileride harici diske taşımak için CODE_WORKSPACES_HOST=/mnt/hdd/code yap)
sudo mkdir -p /var/lib/sixfinger-code && sudo chown 1000:1000 /var/lib/sixfinger-code
docker build -t sixfinger-sandbox:latest sandbox/        # ripgrep eklendi: imajı yeniden derle
git pull && docker compose --profile sandbox up -d --build
```

Sınama: `docker compose logs sandboxd` içinde `Code çıkış proxy'si dinliyor` satırı görünmeli. Boşta kalan konteyner 10 dk sonra kapanır,
çalışma alanı diskte kalır; 30 gün dokunulmayan çalışma alanı silinir (**itilmemiş çalışma kaybolur**).

### Sınama betikleri (Pi'de, yayına açmadan önce)

1. **Çalışma alanı:** `SANDBOXD_TOKEN=... ./scripts/code-sandbox-smoke.sh` (genel bir repoyu klonlar; GitHub token'ı gerekmez). Klonlama, dosya
   işlemleri, commit + ortak yazar satırı, `.git` içinde token olmaması, proxy üzerinden ağ (izinli açık / izinsiz kapalı / atlatma ve
   yerel ağ kapalı) ve disk kotasını gerçek Docker'da sınar. Herhangi bir FAIL varsa Code'u açma. *(Geliştirme ortamında Docker olmadığı için
   bu betik henüz gerçek donanımda çalıştırılmadı.)*
2. **Model:** `cd apps/server && AI_DEEP_API_KEY=... npx tsx scripts/code-smoke.ts` — gerçek Qwen'i (varsa Claude yedeğiyle) üç küçük görevde
   (işlev + test yaz, hatayı bul ve düzelt, çok dosyada yeniden adlandır) ajan araçlarıyla dener; geçti/kaldı, adım sayısı, araç hatası ve bozuk
   JSON sayısını yazar. `--runs 3` kararlılığı, `--task N` tek görevi ölçer. Çalışma alanı geçici yerel klasördür (yalıtımsız): yalnızca kendi
   makinende çalıştır. Bozuk JSON/araç hatası oranı yüksekse `services/tools/repair.ts` takma adlarına ve `code-prompt.ts`'e bak.

## PR'ı ajan açar

Ortamda **Otomatik PR** açıkken (varsayılan) ajan her turun sonunda, turda değişiklik olduysa ve kullanıcı turu durdurmadıysa:
commit'i GitHub'a iter (`sixfinger/…` branch'i, zorla itme yok); oturumun PR'ı yoksa modelin yazdığı başlık ve açıklamayla **PR'ı kendisi açar**
(ajanın son raporu ve commit listesi modele verilir; açıklamanın sonuna "Created with SixFinger Code" satırı eklenir), varsa aynı PR yeni
commit'le kendiliğinden güncellenir. Mesajda `pull_request` satırı görünür (açıldı/güncellendi, GitHub'a bağlantı); hata olursa satırdaki
**Tekrar dene** ile yeniden denenir. Kapalıyken hiçbir şey GitHub'a gönderilmez; PR listesindeki **PR'ı ajan açsın** düğmesi aynı işi tek dokunuşla yapar.
Kullanıcı elle başlık/açıklama yazmaz.

## Oturum ekranı özellikleri

- **Alt ajan (`task`)**: ağır araştırmayı ayrı bağlamda yürütür, ana ajana rapor döner (bkz. [code-agent.md](code-agent.md)).
- **Soru ve plan modu**: ajan `ask_user` ile seçenekli soru sorabilir. Composer'daki **Plan** anahtarı (ya da `/plan`) açıkken ajan yalnızca okur,
  plan sunar; **Onayla** ile uygulamaya geçer.
- **Slash komutları**: `/plan`, `/compact` (bağlamı hemen özetle), `/pr`, `/init` (SIXFINGER.md yazar), `/review`, `/test` ve reponun `.claude/commands/*.md` ile
  `.sixfinger/commands/*.md` dosyaları (`$ARGUMENTS` desteklenir). `/` yazınca menü açılır.
- **`@dosya`**: yazarken repo dosyaları önerilir (`GET /files?q=`).
- **Mesaj kuyruğu**: ajan çalışırken yazılan mesajlar kuyruğa girer, tur bitince sırayla gönderilir (kuyruktan silinebilir).
- **Durum çubuğu**: çalışırken altta evre, geçen süre, çalışan alt ajan sayısı ve dönen eğlenceli bir sözcük (`packages/shared/src/code-status-words.ts`).
  Üstte **Diff** (+N −M) ve **PR** çipleri.
- **Dosya gezgini**: çalışma alanını gezer, dosya içeriğini gösterir, `.tar.gz` indirir (`CODE_ARCHIVE_MAX_MB`, varsayılan 64; `node_modules` ve `.git` hariç).
- **Geri sarma (checkpoint)**: bir commit satırından o ana dön. Sonraki mesajlar o noktadan sürer; uzak branch ileride kalırsa bir sonraki push
  `--force` ile yapılır (yalnızca bu oturumun `sixfinger/…` branch'inde).
- **Ortam talimatları**: ortam ayarındaki serbest metin her turun sistem istemine eklenir (ör. "testleri `npm test` ile çalıştır").
- **Oturum yönetimi**: yeniden adlandır, sabitle, arşivle (`PATCH /chats/:id` `{title|pinned|archived}`), listede arama, **Markdown olarak dışa aktar**.
- **Ekler**: Code mesajına metin dosyası eklenebilir (doğrulanmış hesap); modele `<ek ad="…">` bloğu olarak gider.
- **Bildirim (web)**: sekme arka plandayken tur bitince ya da ajan yanıt beklerken tarayıcı bildirimi (ilk mesajda izin istenir).

Bilerek yapılmayanlar: MCP sunucuları, görsel girdi, sunucudan push bildirimi (FCM gerekir; mobilde yerel bildirim de yok — uygulama arka plandayken
akış kesildiği için güvenilmez), GitHub webhook ile CI hatasını otomatik düzeltme, dev-server HMR (WebSocket), notebook, zamanlanmış görevler.

## Önizleme, dosya paylaşma ve yükleme

- **Önizleme (artifact)**: ajan çalışma alanına `index.html` + `app.js` + `style.css` gibi dosyalar yazıp `preview` aracını çağırır; mesajın altında **Önizleme** kartı çıkar.
  Statik sunumda dosyalar birbirini göreli ya da köke göre (`/app.js`) çağırabilir, ES modülleri ve CDN kütüphaneleri çalışır. Kök, HTML'in klasörüdür (`root` ile değişir).
- **Dev-server önizleme**: `bash background=true` ile başlatılan sunucu `preview {port}` ile açılır. İstekler sandboxd'de `docker exec curl 127.0.0.1:<port>` ile iletilir
  (ağsız ortamlarda da çalışır; sunucu yalnızca localhost'u dinleyebilir). Sınırlar: WebSocket/HMR yok (değişiklikten sonra yenile), uygulama göreli URL kullanmalı
  (ör. Vite `base: './'`; çerçeveleri derleyip statik önizlemek daha sağlam), yanıt ≤ `CODE_PREVIEW_MAX_MB` (8), eşzamanlı istek ≤ `CODE_PREVIEW_CONCURRENCY` (8).
- **Güvenlik**: iframe/WebView başlık gönderemediği için adres, oturum + kök/port taşıyan **imzalı 3 saatlik token** içerir (`/api/code/preview/<token>/…`).
  Her yanıt `Content-Security-Policy: sandbox allow-scripts …` ile **opak kaynaklı** çalışır (SixFinger'ın depolamasına, oturum belirtecine ve API'sine erişemez; çerez ve
  `localStorage` yok), çerçeve ayrıca `sandbox` özniteliğiyle (allow-same-origin YOK) açılır. Köke göre bağlantılar (`src="/x.js"`, `url(/x.png)`, `import "/x.js"`, `Location`)
  önizleme önekine yeniden yazılır; kodun içindeki rastgele `fetch('/api')` dizgeleri yazılamaz. CORS yalnızca bu yol için herkese açıktır (kimlik bilgisi taşımaz).
- **Dosya paylaşma**: `share_file` kartı ya da dosya gezgininin **İndir** düğmesi tek dosyayı ham bayt olarak indirir (`GET /code/sessions/:id/download?path=`).
- **Yükleme**: composer'daki ataç metin dosyalarını mesaja gömer; ikili ya da büyük (>60 bin karakter) dosyaları çalışma alanına yükler (`POST …/upload`, ≤ 2 MB,
  `CODE_FILE_MAX_BYTES`) → `.sixfinger/uploads/<ad>` (`.git/info/exclude` ile git dışı); ajan yolu mesajda görür.

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
| `GET/POST /code/sessions` · `GET/DELETE /code/sessions/:id` | Oturumlar. Liste sabitlenenleri başa alır; `?archived=true` arşivi verir |
| `GET /code/sessions/:id/pulls` | Çalışma branch'indeki PR'lar |
| `GET /code/sessions/:id/changes` | Değişen dosyalar (+N −M); ajan çalışırken `stale` |
| `GET /code/sessions/:id/diff?path=` | Başlangıca göre birleşik fark (tüm dosyalar ya da tek dosya) |
| `GET /code/sessions/:id/commands` | Reponun slash komutları |
| `GET /code/sessions/:id/files?q=` | `@dosya` önerileri (yol araması) |
| `GET /code/sessions/:id/file?path=` | Dosya ya da klasör içeriği (gezgin) |
| `GET /code/sessions/:id/archive` | Çalışma alanı `.tar.gz` |
| `POST /code/sessions/:id/rewind` `{messageId}` | Çalışma alanını ve konuşmayı o mesajın turuna geri sarar |
| `POST /code/sessions/:id/preview` `{path\|port, root?}` | Önizleme bağlantısı `{url, expiresAt, kind, entry}` (3 saatlik token) |
| `GET /code/preview/:token/*` | Önizleme içeriği (oturumsuz; yetki token'da). Statik dosya ya da dev-server proxy'si, CSP `sandbox` |
| `GET /code/sessions/:id/ports` | Sandbox'ta dinleyen portlar |
| `GET /code/sessions/:id/download?path=` | Tek dosyayı indirir (ham bayt, ≤ 64 MB) |
| `POST /code/sessions/:id/upload` `{name, dataBase64}` | Dosyayı `.sixfinger/uploads/` altına yazar (≤ 2 MB) |
| `POST /code/sessions/:id/push` | Branch'i GitHub'a gönderir (ajan çalışırken `409`) |
| `POST /code/sessions/:id/pr` | PR'ı ajan açar (başlık/açıklamayı model yazar): push + PR; PR zaten varsa yalnızca push. Otomatik adım başarısız olduğunda ya da ortamda **Otomatik PR** kapalıyken yeniden deneme içindir |

## Geliştirme

`apps/server/scripts/dev-code.ts` sahte GitHub'lı bir sunucu başlatır (izin ekranı atlanır, 4 örnek repo):

```bash
cd apps/server
GITHUB_CLIENT_ID=dev GITHUB_CLIENT_SECRET=dev CODE_SECRET_KEY=dev-code-secret-dev-code-secret-0001 CODE_ALLOWED_EMAILS='*' \
  npx tsx --env-file-if-exists=.env scripts/dev-code.ts
```
