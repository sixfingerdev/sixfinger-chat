# Sandbox (bash, read, write, edit)

Doğrulanmış üyeler, modele `bash`, `read`, `write` ve `edit` araçlarını kullandırabilir. Komutlar **izole bir Docker
konteynerinde** çalışır. Bu sayfa kurulumu, güvenlik modelini ve sınırları anlatır.

> **Durum:** Mantık (kabul kontrolü, kuyruk, dosya işlemleri, HTTP katmanı) ve `docker run` bayrakları testlerle
> doğrulandı. Gerçek Docker davranışı (bellek/PID/disk sınırları, ağ kuralları) geliştirme ortamında denenemedi:
> **kullanıcılara açmadan önce Pi'de `scripts/sandbox-smoke.sh` çalıştır** ve tamamının geçtiğini gör.

## Mimari

```
Telefon/Web ──► app (Fastify) ──HTTP+token──► sandboxd ──docker.sock──► sandbox konteynerleri
                 │                              (tek yetkili kapı)         (sf-<oturum>, ayrıcalıksız)
                 └─ Postgres
```

- **Ana uygulama Docker'a hiç dokunmaz.** Yalnızca `sandboxd`'nin dar HTTP arayüzünü çağırır (`/v1/exec`, `read`, `write`, `edit`).
- **`sandboxd`** Docker soketine sahip tek servistir. Sabit güvenlik bayraklarıyla konteyner açar/kapatır, kuyruğu ve kotayı yönetir.
- **Sohbet başına bir konteyner** (`sf-<hash>`). Boşta kalan konteynerler 5 dk sonra kapanır; `/work` içeriği küçük bir anlık görüntüye alınıp sonraki kullanımda geri yüklenir.

## Her sandbox konteynerinin sınırları

| Sınır | Değer (ayarlanabilir) |
|---|---|
| Kullanıcı | `1000:1000`, root değil; `--cap-drop ALL`, `no-new-privileges` |
| Dosya sistemi | **salt okunur** kök; `/work` ve `/tmp` RAM'de (tmpfs), sert boyut sınırlı (64 MB / 32 MB) |
| Bellek | 320 MB (swap yok) |
| CPU | 0,5 çekirdek |
| Süreç sayısı | 64 (fork bombasına karşı) |
| Komut süresi | 30 sn varsayılan, en çok 120 sn (içeride `timeout -k`) |
| Çıktı | stdout/stderr başına 64 KB; sonsuz çıktı erken kesilir |
| Dosya | tek dosya ≤ 1 MB |
| Günlük | `--log-driver none` (diske yazmaz) |

`/work` RAM'de olduğu için **SD karta yazılmaz** ve disk dolduramaz. Boştaki bir sandbox kapanırken içeriği
(en çok 16 MB) `SANDBOX_DATA_DIR` altına sıkıştırılıp kaydedilir; bu dizini harici diske taşımak için
`SANDBOX_DATA_DIR_HOST=/mnt/hdd/sandbox` yeterlidir.

## Kapasite yönetimi (çökmesin diye)

- En fazla `MAX_CONTAINERS` (6) canlı konteyner; yer açmak için en uzun süredir boşta olan kapatılır, hepsi meşgulse **503 + Retry-After**.
- En fazla `MAX_CONCURRENT_EXEC` (4) eşzamanlı komut; fazlası `MAX_QUEUE` (12) kadar sırada bekler, dolunca 503.
- Aynı kullanıcının işlemleri **sıraya girer**: tek kullanıcı havuzu tek başına dolduramaz.
- Ana uygulamada ayrıca kullanıcı başına dakikada 40 sandbox işlemi sınırı vardır.
- Pi 4 (4 GB) için varsayılanlar: 6 × 320 MB ≈ 1,9 GB üst sınır. RAM sıkışırsa `SANDBOX_MAX_CONTAINERS=4` yap.

## Kurulum (Raspberry Pi)

1. **Sandbox imajını derle** (ilk seferde birkaç dakika sürer):
   ```bash
   cd ~/sixfinger-chat
   docker build -t sixfinger-sandbox:latest sandbox/
   ```
2. **`.env` dosyasına ekle:**
   ```
   SANDBOXD_URL=http://sandboxd:8791
   SANDBOXD_TOKEN=<openssl rand -base64 32 çıktısı>
   DOCKER_GID=<getent group docker | cut -d: -f3>
   SANDBOX_NETWORK=none          # önce kapalı başla; 4. adımdan sonra restricted yap
   ```
3. **Başlat:**
   ```bash
   git pull
   docker compose --profile sandbox up -d --build
   ```
4. **Sınama (zorunlu):**
   ```bash
   SANDBOXD_TOKEN=... ./scripts/sandbox-smoke.sh
   ```
   Tüm satırlar `PASS` olmalı. Bellek, disk, fork bombası, salt okunur dosya sistemi, yetenekler, zaman aşımı ve sırların sızmadığı kontrol edilir.

## Sandbox'ta internet (80/443)

Varsayılan **kapalı** (`SANDBOX_NETWORK=none`). Açmak için önce ana makinede güvenlik duvarını kur:

```bash
sudo scripts/sandbox-firewall.sh
```

Konteynerler şunları **yapabilir**: genel DNS (1.1.1.1, 9.9.9.9) ve internete TCP 80/443 (konteyner başına hız ve bağlantı sınırlı).
**Yapamazlar**: ev ağı (192.168/16, 10/8, 172.16/12…), Pi'nin kendisi, SMTP/SSH/başka portlar, ICMP, yerel ağdaki diğer cihazlar.

Sonra `.env` içinde `SANDBOX_NETWORK=restricted` yap ve `docker compose --profile sandbox up -d`.
**`sandboxd` açılırken ağı kendisi sınar:** sandbox'tan ana makineye ve yaygın yerel adreslere bağlanmayı dener;
herhangi biri başarılı olursa internet erişimini otomatik KAPATIR ve logda uyarır (`docker compose logs sandboxd`).
Ardından `SANDBOX_NETWORK=restricted ./scripts/sandbox-smoke.sh` ağ kontrollerini de çalıştırır.

### Açılışta otomatik uygula

`/etc/systemd/system/sixfinger-sandbox-firewall.service`:

```ini
[Unit]
Description=SixFinger sandbox güvenlik duvarı
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/home/KULLANICI/sixfinger-chat/scripts/sandbox-firewall.sh

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now sixfinger-sandbox-firewall
```

## Kim kullanabilir?

`bash/read/write/edit` yalnızca **e-postası doğrulanmış üyelerde** açıktır (`features.sandbox`). Misafir ve doğrulanmamış
hesaplar web araçlarını, artifact'ları ve widget'ları kullanır. `SANDBOXD_URL` boşsa araçlar hiç görünmez.

## Güvenlik notları

- **Docker soketi root eşdeğeridir.** Bu yüzden yalnızca `sandboxd` servisine bağlanır (ayrıcalıksız `node` kullanıcısı + docker grubu).
  `sandboxd` kullanıcı kodu çalıştırmaz, sadece sabit bayraklarla konteyner yönetir. Daha güçlü yalıtım için rootless Docker ya da gVisor (`runsc`) eklenebilir.
- Sandbox'ta **sır yok**: JWT anahtarı, veritabanı ve ana ağ konteynere hiç verilmez; ana uygulamanın ağından ayrı bir köprüde çalışır.
- Model çıktısı ve web sayfaları **güvenilmeyen veri**dir; sandbox'ın amacı, yönlendirilmiş (prompt injection) bir modelin bile zarar verememesidir.
- `SANDBOX_RUNTIME=local-unsafe` yalnızca geliştirme/test içindir (komutları ana makinede çalıştırır); üretimde reddedilir.

## Ayarlar

| Değişken | Varsayılan | Anlamı |
|---|---|---|
| `SANDBOX_MAX_CONTAINERS` | 6 | Aynı anda canlı sandbox |
| `SANDBOX_MAX_CONCURRENT_EXEC` | 4 | Aynı anda çalışan komut |
| `SANDBOX_MAX_QUEUE` | 12 | Bekleme sırası |
| `SANDBOX_MEM_MB` / `SANDBOX_CPUS` | 320 / 0.5 | Konteyner başına bellek / CPU |
| `SANDBOX_WORK_MB` | 64 | `/work` boyutu (RAM) |
| `SANDBOX_IDLE_SECONDS` | 300 | Boşta kapanma süresi |
| `SANDBOX_NETWORK` | none | `none` ya da `restricted` |
| `SANDBOX_DATA_DIR_HOST` | (volume) | Anlık görüntü klasörü (harici disk için) |

## Sorun giderme

- **`permission denied ... docker.sock`**: `DOCKER_GID` yanlış. `getent group docker | cut -d: -f3` çıktısını `.env`'e yaz.
- **Araçlar görünmüyor**: `SANDBOXD_URL`/`SANDBOXD_TOKEN` boş, kullanıcı doğrulanmamış ya da `docker compose logs app` içinde sandbox hatası var.
- **"Sandbox şu an dolu"**: kuyruk/konteyner sınırı doldu; `SANDBOX_MAX_*` değerlerini ve `docker stats` çıktısını kontrol et.
- **İnternet yok**: `docker compose logs sandboxd` içinde "Ağ yalıtımı doğrulanamadı" varsa güvenlik duvarı kurulu değil ya da kural sızdırıyor.
- **Durum**: `curl -H "authorization: Bearer $SANDBOXD_TOKEN" http://localhost:8791/v1/stats` (compose ağı dışına port açılmadığı için `docker compose exec sandboxd wget -qO- ...` kullan).
