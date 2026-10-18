# Raspberry Pi'ye kurulum

Bu rehber Raspberry Pi 4 (4 GB) için yazıldı; 64-bit işletim sistemi çalıştıran her Pi'de aynı şekilde gider.
Uygulama tek bir Docker servisi olarak çalışır: API + web arayüzü + Postgres.

> Rehberdeki adımlar Pi'nin kendisinde denenmedi. Bir adım beklediğin gibi gitmezse hata çıktısıyla birlikte issue aç.

## 1. İşletim sistemini karta yaz (bilgisayarında)

1. [Raspberry Pi Imager](https://www.raspberrypi.com/software/) uygulamasını indir.
2. **Cihaz:** Raspberry Pi 4 · **İşletim sistemi:** *Raspberry Pi OS (other) → Raspberry Pi OS Lite (64-bit)* · **Depolama:** SD kartın.
3. **Ayarları düzenle** (dişli) ekranında:
   - Ana makine adı: `sixfinger`
   - Kullanıcı adı ve parola belirle
   - Wi-Fi adı ve parolası, Wi-Fi ülkesi `TR` (ethernet kullanacaksan atla)
   - Saat dilimi `Europe/Istanbul`
   - **SSH'ı etkinleştir** (parola ya da anahtar)
4. Yaz, kartı Pi'ye tak, adaptörü bağla. İlk açılış 1-2 dakika sürer.

## 2. Bağlan ve güncelle

Aynı ağdaki bilgisayardan:

```bash
ssh KULLANICI@sixfinger.local        # olmazsa modemin arayüzünden Pi'nin IP adresini bul: ssh KULLANICI@192.168.x.x
sudo apt update && sudo apt full-upgrade -y
sudo reboot
```

Yeniden bağlandıktan sonra güç sorunu var mı kontrol et:

```bash
vcgencmd get_throttled     # 0x0 → sorun yok. Başka değer → adaptör/kablo yetersiz (düşük voltaj)
```

## 3. Docker'ı kur

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
exit    # çıkıp tekrar ssh ile bağlan ki grup geçerli olsun
docker --version && docker compose version
```

## 4. Uygulamayı indir ve çalıştır

```bash
git clone https://github.com/sixfingerdev/sixfinger-chat.git
cd sixfinger-chat
```

Aynı klasörde `.env` adlı bir dosya oluştur (`nano .env`) ve şunu yaz. `JWT_SECRET` için rastgele bir değer üret:
`openssl rand -base64 48` komutunun çıktısını yapıştır.

```
JWT_SECRET=BURAYA_RASTGELE_DEGER
# Dışarıdan erişim adresini 6. adımdan sonra buraya yaz (şimdilik boş kalsın):
# PUBLIC_WEB_URL=https://...
# CORS_ORIGINS=https://...
# Pollinations anahtarı (opsiyonel, yoğunlukta işe yarar):
# AI_API_KEY=
# Tünel (Tailscale/Cloudflare) kullanıyorsan 6. adımdan sonra true yap:
# TRUST_PROXY=true
```

Sonra başlat:

```bash
docker compose up -d --build
```

İlk derleme Pi'de birkaç dakikadan on dakikaya kadar sürebilir. Derleme "out of memory" ile biterse geçici bir takas
alanı aç (2 GB):

```bash
sudo dphys-swapfile swapoff
sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile
sudo dphys-swapfile setup && sudo dphys-swapfile swapon
```

Kontrol:

```bash
docker compose ps                       # app ve db "running/healthy" olmalı
curl http://localhost:8787/api/health   # {"ok":true,...}
docker compose logs -f app              # canlı log (Ctrl+C ile çık)
```

Aynı ağdaki telefonda `http://sixfinger.local:8787` adresini açınca SixFinger gelmeli.

Servisler `restart: unless-stopped` ile ayarlı; Pi yeniden başlayınca kendiliğinden kalkar.

## 5. E-posta kodları (opsiyonel)

SMTP vermezsen doğrulama kodları e-posta olarak gitmez, sunucu loguna yazılır
(`docker compose logs app | grep purpose`). Gmail için uygulama parolası oluşturup `.env` dosyasına ekle:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=senin@gmail.com
SMTP_PASSWORD=UYGULAMA_PAROLASI
SMTP_FROM=SixFinger <senin@gmail.com>
```

Sonra `docker compose up -d`.

## 6. İnternetten erişim (APK için https şart)

Router'da port açma. Aşağıdaki iki yoldan biriyle güvenli bir https adresi al.

### A) Tailscale Funnel (alan adı gerekmez, adres sabit)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up                    # çıkan bağlantıyı tarayıcıda açıp giriş yap
```

Tailscale yönetim sayfasında (login.tailscale.com) **DNS → HTTPS Certificates**'ı aç ve cihaz için **Funnel**'a izin ver
([Funnel belgesi](https://tailscale.com/kb/1223/funnel)). Sonra:

```bash
sudo tailscale funnel --bg 8787
tailscale funnel status              # https://sixfinger.<tailnet>.ts.net gibi bir adres gösterir
```

### B) Cloudflare Tunnel (kendi alan adın varsa)

Alan adının DNS'i Cloudflare'de olmalı. [Cloudflare Tunnel belgesindeki](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/)
adımlarla `cloudflared` kurup `http://localhost:8787` adresini `chat.alanadin.com` gibi bir alt alan adına yönlendir.
Geçici deneme için hesap gerektirmeyen `cloudflared tunnel --url http://localhost:8787` komutu da var, ama adres her
başlatmada değişir.

### Adresi uygulamaya tanıt

Aldığın adresi `.env` dosyasına yaz ve yeniden başlat:

```bash
nano .env      # PUBLIC_WEB_URL=https://ADRESIN, CORS_ORIGINS=https://ADRESIN ve TRUST_PROXY=true
docker compose up -d
```

`TRUST_PROXY=true` önemli: tünelin arkasında kullanıcıların gerçek IP'sini doğru görmek için gerekir (hız sınırı ve misafir kotası IP'ye göre çalışır).

Ardından Android uygulamasını aç, sunucu adresi ekranına aynı adresi yapıştır. Telefon tarayıcısından da açıp
"Ana ekrana ekle" ile PWA olarak kurabilirsin.

## 7. Güncelleme

```bash
cd ~/sixfinger-chat
git pull
docker compose up -d --build
```

Veritabanı şeması sunucu açılırken otomatik güncellenir.

## 8. Yedek

Veriler `pgdata` adlı Docker volume'unda. SD kart bozulursa kaybolur, düzenli yedek al:

```bash
# elle yedek
docker compose exec -T db pg_dump -U sixfinger sixfinger | gzip > ~/sixfinger-$(date +%F).sql.gz
```

Günlük otomatik yedek için `crontab -e` ile şu satırı ekle (her gün 04:00, son 14 yedek kalsın):

```
0 4 * * * cd ~/sixfinger-chat && docker compose exec -T db pg_dump -U sixfinger sixfinger | gzip > ~/backup-$(date +\%F).sql.gz && ls -t ~/backup-*.sql.gz | tail -n +15 | xargs -r rm
```

Yedekleri ara sıra bilgisayarına kopyala (`scp KULLANICI@sixfinger.local:~/backup-*.sql.gz .`). Geri yükleme:

```bash
gunzip -c backup-2026-10-20.sql.gz | docker compose exec -T db psql -U sixfinger sixfinger
```

## 9. İpuçları ve sorun giderme

- **Kapatırken** fişi çekme: `sudo shutdown -h now` de, ışık söndükten sonra çek. SD kartı bozulmadan korur.
- **Isınma:** `vcgencmd measure_temp` 70 °C altında kalmalı. Set fanlı kasayla geliyor.
- **Yapay zekâ yanıtı gelmiyor ya da çok yavaş:** Pollinations anonim kullanımda IP başına kısa bekleme uygular.
  `docker compose logs app | grep "üst servis"` satırları 402/429 gösteriyorsa
  [enter.pollinations.ai](https://enter.pollinations.ai/keys) üzerinden anahtar al, `.env`'e `AI_API_KEY=` olarak ekle.
- **Bellek:** `free -h` ile bak. Sunucu ve Postgres 4 GB'ın küçük bir kısmını kullanır.
- **Yeniden başlatma:** `docker compose restart app`. Tümünü silmek (veriler dahil!): `docker compose down -v`.
