# Android uygulaması

Web arayüzü [Capacitor](https://capacitorjs.com) ile Android'e paketlenir (`apps/web/android`). Uygulama,
bir SixFinger sunucusuna bağlanır: adresi derleme sırasında (`VITE_API_URL`) verebilir ya da boş bırakıp
**ilk açılışta uygulamada girebilirsin** (Ayarlar → Genel → Sunucu'dan sonradan değiştirilir).
Sunucu **https** olmalıdır.

## GitHub Actions ile APK

1. **Actions → Android APK → Run workflow** (isteğe bağlı `api_url` gir).
2. Bitince **sixfinger-apk** artifact'ını indir. `v*` etiketi atarsan APK Release'e de eklenir.

Varsayılan sunucu adresini her seferinde yazmamak için repo **Variables**'a `API_URL` ekle.

### Kendi anahtarınla imzalama (opsiyonel)

Anahtar tanımlı değilse APK debug anahtarıyla imzalanır: kurulabilir ama Play Store için uygun değildir.
Gerçek anahtar için:

```bash
keytool -genkeypair -v -keystore release.keystore -alias sixfinger -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore      # çıktıyı ANDROID_KEYSTORE_BASE64 secret'ına yapıştır
```

Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

## Yerelde derleme

Gereksinimler: JDK 17+, Android SDK (platform 34, build-tools 34).

```bash
npm install
export ANDROID_HOME=$HOME/Android/Sdk
VITE_API_URL=https://chat.example.com npm run build -w @sixfinger/web   # URL'yi boş bırakabilirsin
cd apps/web && npx cap sync android
cd android && ./gradlew assembleRelease
# → apps/web/android/app/build/outputs/apk/release/app-release.apk
```

Simgeler `apps/web/resources/*` dosyalarından üretilir: `npm run icons -w @sixfinger/web`, ardından
`npx capacitor-assets generate --android`.
