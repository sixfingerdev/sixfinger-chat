# Yedek model: Amazon Bedrock'ta Claude

Hızlı, Dengeli ve Derin sağlayıcılarından biri **yanıt vermeye başlamadan** başarısız olursa istek otomatik olarak
Bedrock'taki Claude'a (ör. Sonnet 4.6) düşer. "Başarısız" şunlardır: 200 dışı HTTP yanıtı (402/429 hız sınırı, 4xx, 5xx),
bağlantı/zaman aşımı hatası ve 200 olduğu halde içeriksiz (boş) yanıt.

Sıra: **seçilen model → Bedrock → Hızlı** (Hızlı modda: Hızlı → Bedrock). Bedrock tanımlı değilse eski davranış sürer.
Yedek varken Pollinations/OVH yanıtları için bekleyip yeniden denenmez (en çok bir kısa deneme): kullanıcı hız sınırı
yüzünden saniyelerce beklemez, doğrudan Claude yanıtlar.

Yanıt akmaya başladıktan sonra kopma olursa yedeğe düşülmez (yarım yanıt zaten kullanıcıya gitmiştir); mesaj "durduruldu/hata"
olarak kalır.

## Kurulum

`.env` dosyasına ekle (Pi'de, **asla sohbete ya da repoya yazma**):

```
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-6      # konsoldan kopyala (aşağıya bak)
BEDROCK_REGION=us-east-1                              # modele eriştiğin bölge

# Kimlik bilgisi: ya API anahtarı...
BEDROCK_API_KEY=...
# ...ya da IAM anahtarı
#BEDROCK_ACCESS_KEY_ID=...
#BEDROCK_SECRET_ACCESS_KEY=...
#BEDROCK_SESSION_TOKEN=...                            # yalnızca geçici kimlik bilgisinde
```

Sonra `git pull && docker compose up -d --build`. Açılışta bir şey loglanmaz; devreye girdiğini
`docker compose logs app | grep yedeğe` ile görürsün.

**Model kimliği:** AWS konsolu → Bedrock → *Model catalog* (ya da *Inference profiles*) içinde Sonnet 4.6'yı bul,
"Model ID"/"Inference profile ID" değerini aynen yaz. Birçok bölgede doğrudan model yerine çapraz bölge profili
gerekir (`us.` / `eu.` / `global.` önekli). Hesapta model erişiminin açık olduğundan emin ol.

**Gerekli IAM izni** (IAM anahtarı kullanıyorsan): `bedrock:InvokeModel` ve `bedrock:InvokeModelWithResponseStream`
(Converse API bunları kullanır), ilgili model ve inference profile kaynakları için.

## Notlar

- Yedek modelde uzatılmış düşünme (reasoning) kapalıdır; araç çağrıları (web_search, bash vb.) çalışır.
  "Düşünme düzeyi" seçimi yedekte uygulanmaz.
- Başlık üretimi ve hafıza gibi arka plan işleri de aynı zinciri kullanır.
- Maliyet: yedek yalnızca diğerleri başarısız olunca çağrılır. Pollinations sık hız sınırına takılıyorsa Claude'a düşen
  istek sayısı artar; Bedrock tarafında kullanım/bütçe uyarısı kurmanı öneririz.
