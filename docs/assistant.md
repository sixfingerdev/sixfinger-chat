# Asistan (güç tuşu penceresi)

SixFinger'ı Android'in **dijital asistanı** olarak seçince güç tuşuna uzun basmak (ya da kenardan/köşeden kaydırmak) açık uygulamanın üstünde yarı saydam bir SixFinger penceresi açar.

## Ne yapar
- **Yaz ya da konuş**: alttaki çubuğa yaz; mikrofona dokununca cihazın konuşma tanıma servisiyle dinler (eğik çizgi dalga göstergesi), konuşma bitince kendiliğinden gönderir.
- **Ekranı ekle**: asistan olarak açıldığında sistem ekrandaki görünür metni verir; "Ekran: <uygulama>" çipine dokunursan (ya da "Bu ekranı özetle / Önemli noktaları çıkar / Buna uygun yanıt yaz / Çevir" kısayollarından birini seçersen) metin mesaja `ekran.txt` eki olarak eklenir. Ek özelliği olmayan hesaplarda metnin içine kırpılarak girilir. **Görüntü (ekran görüntüsü) gönderilmez**: zincirdeki modeller görsel anlamıyor; yalnızca metin okunur. Parola alanları atlanır; `FLAG_SECURE` uygulamalar ve özel çizilen arayüzler (oyun, bazı Flutter/WebView ekranları) az ya da hiç metin verir. Ekran içeriği yalnızca sen çipe dokunursan modele gider.
- **Ekranda seç (görsel)**: ekran görüntüsü sistemden gelirse ("Dijital asistan ayarlarında *Ekran görüntüsünü kullan* açık olmalı") "Ekranda seç" çipi çıkar. Ekran donar; parmağınla serbest çizerek çevrelersin, bırakınca çizgi düzgün bir dikdörtgene dönüşür (köşelerden boyutlandırılır, içinden taşınır). "Seç" ile kırpılan bölge (uzun kenar 1280 px JPEG) mesaja görsel olarak eklenir; "Bu nedir? / Metni oku / Çevir / Açıkla" kısayolları vardır. Görsel destekleyen modellere gider (MiniMax → Qwen → Nemotron → Claude) ve doğrulanmış hesap ister.
- **Yanıt kartı**: yanıt akarak gelir (Markdown). Kart üstünde kopyala, **Sohbette aç** (aynı sohbet ana uygulamada açılır), yeni konuşma. Hızlı/Derin düğmesi vardır (varsayılan Hızlı).
- **Sesli okuma**: Ayarlar → Asistan → "Yanıtları sesli oku": sesle sorunca (varsayılan) / hep / hiç.
- Kapatınca (dışarı dokun, geri, kartı aşağı sürükle) sunucudaki üretim sürer; sohbet listesinde görünür.

## Kurulum (telefonda)
1. Uygulama → **Ayarlar → Asistan → Asistan olarak ayarla** → açılan ekranda *Dijital asistan uygulaması* = SixFinger (Gemini'nin yerine geçer; ikisi birlikte olmaz).
2. **Hızlı Ayarlar karosu**: panelde "SixFinger'a sor" karosunu ekle. Dokununca dinleyerek açılır; asistan seçilmemiş olsa da çalışır.
3. Xiaomi/HyperOS: güç tuşu kısayolu için Ayarlar → Ek ayarlar → Düğme kısayolları'na bak; uygulamayı pil kısıtlamasından muaf tut.
4. Uygulama → Ayarlar → Asistan → **Şimdi dene / Sesle dene**: asistan seçmeden pencereyi açıp dener.

## Mimari
- Yerel Expo modülü `apps/mobile/modules/sixfinger-assistant` (autolinking, prebuild gerekmez): `SfVoiceInteractionService` + `SfSessionService`/`SfSession` (oturum açılınca `startAssistantActivity`), şeffaf `AssistantActivity` (ReactActivity, ana uygulamayla **aynı React örneği**: kimlik, sohbet deposu, API istemcisi paylaşılır), `AssistExtractor` (ekran metni), `SfTileService` (Hızlı Ayarlar), modül (`getLaunchInfo`, `getAssistContext`, `close`, `openApp`, ses tanıma).
- JS: `index.js` ikinci kökü kaydeder (`SixfingerAssistant`); `src/assistant/*` (panel, ses hook'u, dalga). Ortak açılış `src/lib/boot.ts`.
- Ses tanıma: `android.speech.SpeechRecognizer`; asistan seçilince varsayılan tanıyıcı bizim olabileceği için cihazdaki gerçek tanıyıcı (tercihen Google) açıkça seçilir. Konuşma tanıma Google servisleri/ağ gerektirebilir.
- Çok dilli ses tanıma: Ayarlar → Asistan → "Konuşma dilleri" (varsayılan: telefonun dil listesi, en çok 3). Birden çok dil varsa (Android 13+) mikrofonu `AudioRecord` ile kendimiz kaydeder ve AYNI sesi her dil için ayrı bir tanıyıcıya `EXTRA_AUDIO_SOURCE` borusuyla besleriz. Hepsi canlı yazı üretir; ekranda en olası dilin yazısı görünür. Konuşma bitince (kendi sessizlik algılamamızla) en iyisi seçilir: tanıyıcının güven puanı + metnin dilinin o tanıyıcının diline uyması (`chooseTranscript`, `packages/shared/src/lang.ts`). Tanıyıcı harici ses kaynağını kabul etmezse ya da 4,5 sn içinde hiç yanıt vermezse ilk dille, cihaz mikrofonuyla tek dilli kipe düşer.
- Sesli okuma: yanıt cümlelere bölünür, her cümlenin dili seçili diller arasından bulunur (`segmentByLanguage`), art arda aynı dildeki cümleler tek parça okunur.
- `voice-interaction-service` bildirimi bir `recognitionService` ister (yoksa Xiaomi/Android 14 servisi geçersiz sayıp hiç bağlamıyor). `SfRecognitionService` isteği cihazdaki gerçek tanıyıcıya (Google) aynen iletir, böylece diğer uygulamaların ses girişi bozulmaz.

## Bilinen sınırlar / doğrulanacaklar
- Bu geliştirme ortamında Android emülatörü/telefon yok: derleme ve manifest doğrulandı, **pencerenin gerçek cihazdaki davranışı** (Xiaomi dahil), klavye ile dock hareketi, `startAssistantActivity` ve rol seçimi telefonda denenmeli.
- "Hey Google" gibi sesle uyandırma yok (Google'a özel ayrıcalık).
- Asistan penceresi kapalıyken bildirim gönderilmez (bkz. FCM/ntfy konuşması).
