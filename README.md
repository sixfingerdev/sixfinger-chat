# Sixfinger Chat — React Native App (GitHub Copilot Agent Prompt)

## Görev
Aşağıdaki spesifikasyonlara göre eksiksiz, production-ready bir React Native Android uygulaması oluştur. Expo kullanma, bare React Native kullan. Tüm dosyaları oluştur, hiçbir şeyi eksik bırakma.

---

## Teknik Stack

- React Native (bare, Expo yok)
- TypeScript
- React Navigation v6 (Stack + Bottom Tabs)
- AsyncStorage (@react-native-async-storage/async-storage)
- React Native Vector Icons (veya @expo/vector-icons değil, react-native-vector-icons)
- Axios (HTTP istekleri için)
- React Native Markdown Display (markdown render için)

---

## API Bilgileri

**Base URL:** `https://sfapi.pythonanywhere.com`

### Auth Endpoints (cookie/session tabanlı değil, API key tabanlı)
- `POST /register` — form: email, password, plan
- `POST /login` — form: email, password → session cookie döner
- `GET /dashboard` → HTML (kullanılmayacak)

**NOT:** Login akışı şöyle çalışır:
1. Kullanıcı email+şifre ile `/login` POST atar
2. Başarılı olunca sfapi dashboard'a redirect eder (302)
3. Ama biz API key'e ihtiyacımız var
4. Bunun için login sonrası `/api/v1/stats` endpoint'ini `X-API-Key` ile çağıramayız çünkü key'i bilmiyoruz
5. **Çözüm:** Login sonrası `/dashboard` HTML'ini parse ederek API key'i çekiyoruz. HTML'de şu pattern var: `{{ user['api_key'] }}` → render edilmiş hali `sixfinger_xxxxxxxxxxxxxxxxxx` formatında
6. API key'i bulduktan sonra AsyncStorage'a kaydet, bundan sonra tüm isteklerde `X-API-Key` header'ı kullan

### Conversation Endpoints (tümünde `X-API-Key` header gerekli)
- `GET /api/v1/conversations` → konuşma listesi
- `POST /api/v1/conversations` — body: `{title, model}` → yeni konuşma
- `GET /api/v1/conversations/:id` → konuşma + mesajlar
- `PATCH /api/v1/conversations/:id` — body: `{title}` → yeniden adlandır
- `DELETE /api/v1/conversations/:id` → sil
- `POST /api/v1/conversations/:id/chat` — body: `{message, model, max_tokens, stream}` → mesaj gönder
- `GET /api/v1/conversations/:id/messages` → mesaj listesi

### Chat Request Body
```json
{
  "message": "kullanıcı mesajı",
  "model": "gpt54-nano",
  "max_tokens": 500,
  "temperature": 0.7,
  "stream": false
}
```

### Chat Response Body
```json
{
  "conversation_id": 1,
  "response": "asistan yanıtı",
  "model": "gpt54-nano",
  "usage": { "total_tokens": 120 }
}
```

### Model Listesi (sabit, API'den çekilmez)
```
gpt54-nano      → GPT-5.4 Nano (varsayılan, primary)
gpt4-nano       → GPT-4.1 Nano (fallback)
llama-8b-instant → Llama 3.1 8B
allam-2-7b      → Allam 2 7B (TR/AR)
qwen3-32b       → Qwen3 32B
llama-70b       → Llama 3.3 70B
```

---

## Uygulama Mimarisi

```
src/
  api/
    client.ts          # axios instance, interceptor
    auth.ts            # login, register, extractApiKey
    conversations.ts   # tüm conversation endpoint'leri
  screens/
    LoginScreen.tsx
    RegisterScreen.tsx
    ConversationsScreen.tsx   # ana ekran (sohbet listesi)
    ChatScreen.tsx            # sohbet ekranı
    SettingsScreen.tsx        # sistem prompt, model seçimi, çıkış
  components/
    MessageBubble.tsx         # tekil mesaj balonu
    ConversationItem.tsx      # liste satırı
    ModelPicker.tsx           # model seçim modal
    EmptyState.tsx            # boş durum görseli
  navigation/
    AppNavigator.tsx          # Stack navigator (Auth / Main)
    MainTabs.tsx              # Bottom tab (Conversations + Settings)
  store/
    useAuthStore.ts           # zustand veya Context API — api key, user email
    useConversationStore.ts   # aktif konuşmalar cache
  utils/
    storage.ts                # AsyncStorage helpers
    constants.ts              # renkler, fontlar, API_BASE_URL
  types/
    index.ts                  # TypeScript tipleri
```

---

## Ekranlar ve Özellikler

### 1. LoginScreen
- Email + şifre input
- "Giriş Yap" butonu
- "Hesap oluştur" linki
- Hata mesajı gösterimi
- Login akışı: POST /login → dashboard HTML'ini parse et → API key çıkar → AsyncStorage'a kaydet

### 2. RegisterScreen
- Email + şifre input
- Plan seçimi (sadece Free göster, ötekiler "Ücretli" etiketiyle disabled)
- Kayıt sonrası "Email doğrulaması gerekiyor" uyarısı göster, login ekranına yönlendir

### 3. ConversationsScreen (Ana Ekran)
- Konuşma listesi (FlatList)
- Sağ üstte "+" butonu → yeni konuşma oluştur ve ChatScreen'e geç
- Her satırda: konuşma başlığı, tarih
- Sola kaydır → sil seçeneği (swipeable)
- Uzun bas → yeniden adlandır (Alert ile input)
- Boş listede EmptyState komponenti

### 4. ChatScreen
- Parametre: `conversationId` (number), `title` (string)
- Üstte başlık + model adı
- Sağ üstte model değiştirme ikonu
- Mesaj listesi (FlatList, en alta scroll)
- Alt: textarea + gönder butonu
- Mesajlar: kullanıcı sağda (turuncu balonlar), asistan solda (gri balonlar)
- Asistan yanıtları markdown render edilmeli (react-native-markdown-display)
- Gönderirken loading indicator (asistan balonunda "..." animasyonu)
- **Primary model: gpt54-nano, fallback: gpt4-nano** — eğer gpt54-nano 5xx dönerse otomatik gpt4-nano ile tekrar dene

### 5. SettingsScreen
- Kullanıcı email'i göster
- Varsayılan model seçimi (dropdown)
- Varsayılan sistem prompt (textarea)
- Tema: sadece dark mode (sistem temasını takip etme, her zaman dark)
- "Çıkış Yap" butonu → AsyncStorage temizle, LoginScreen'e yönlendir
- Uygulama versiyonu

---

## Tasarım Sistemi

**SADECE DARK TEMA. Light mod yok.**

### Renkler
```typescript
export const colors = {
  // Backgrounds
  bg: '#0f0f11',           // ana arkaplan
  surface: '#1a1a1f',      // kart/panel arkaplanı
  surfaceHigh: '#222228',  // elevated surface
  border: '#2a2a32',       // kenarlıklar

  // Text
  textPrimary: '#f0eff4',  // ana metin
  textSecondary: '#8b8b9e', // ikincil metin
  textMuted: '#55556a',    // soluk metin

  // Accent (Sixfinger turuncu)
  accent: '#ea5b0c',
  accentLight: '#f08c36',
  accentSurface: '#2a1a0e', // accent bg

  // Bubbles
  userBubble: '#2a1a0e',
  userBubbleBorder: '#ea5b0c40',
  aiBubble: '#1e1e26',
  aiBubbleBorder: '#2a2a38',

  // Status
  success: '#1a8f54',
  error: '#c0392b',
  warning: '#d4860a',
}
```

### Tipografi
```typescript
export const typography = {
  fontFamily: 'System',  // platform default sans-serif
  sizes: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 26,
  },
  weights: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  }
}
```

### Spacing & Radius
```typescript
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, full: 999 }
```

---

## Önemli Uygulama Detayları

### API Key Çıkarma (Login Sonrası)
```typescript
// Dashboard HTML'inden API key parse etme
function extractApiKey(html: string): string | null {
  // Pattern: sixfinger_ ile başlayan 20+ karakterli string
  const match = html.match(/sixfinger_[a-z0-9]{15,30}/);
  return match ? match[0] : null;
}
```

### Fallback Mekanizması
```typescript
async function sendMessageWithFallback(convId: number, payload: ChatPayload) {
  try {
    return await sendMessage(convId, { ...payload, model: 'gpt54-nano' });
  } catch (err: any) {
    if (err.response?.status >= 500) {
      return await sendMessage(convId, { ...payload, model: 'gpt4-nano' });
    }
    throw err;
  }
}
```

### AsyncStorage Keys
```typescript
const STORAGE_KEYS = {
  API_KEY: '@sf_api_key',
  USER_EMAIL: '@sf_user_email',
  DEFAULT_MODEL: '@sf_default_model',
  DEFAULT_SYSTEM_PROMPT: '@sf_system_prompt',
}
```

### Yeni Konuşma Açılışı
Kullanıcı "+" butonuna basınca:
1. `POST /api/v1/conversations` body: `{title: 'New Conversation', model: 'gpt54-nano'}`
2. Dönen `id` ile ChatScreen'e navigate et
3. Başlık, ilk mesaj gönderilince backend tarafından otomatik set edilir (ilk 60 karakter)

### Mesaj Gönderme Akışı
1. Kullanıcı input'u temizle, optimistic olarak kullanıcı mesajını UI'a ekle
2. Asistan balonunu "..." ile ekle (loading state)
3. `POST /api/v1/conversations/:id/chat` ata
4. Başarılıysa "..." balonunu gerçek yanıtla değiştir
5. Hata varsa "..." balonunu kaldır, error toast göster

---

## Navigasyon Akışı

```
AppNavigator (Stack)
├── AuthStack (api key yoksa)
│   ├── LoginScreen
│   └── RegisterScreen
└── MainStack (api key varsa)
    ├── MainTabs (Bottom Tab)
    │   ├── ConversationsScreen (ikon: chat-bubbles)
    │   └── SettingsScreen (ikon: settings)
    └── ChatScreen (tab'dan push, full screen)
```

---

## package.json Dependencies

```json
{
  "dependencies": {
    "react": "18.2.0",
    "react-native": "0.73.0",
    "@react-navigation/native": "^6.1.0",
    "@react-navigation/stack": "^6.3.0",
    "@react-navigation/bottom-tabs": "^6.5.0",
    "react-native-screens": "^3.29.0",
    "react-native-safe-area-context": "^4.9.0",
    "react-native-gesture-handler": "^2.15.0",
    "@react-native-async-storage/async-storage": "^1.23.0",
    "axios": "^1.6.0",
    "react-native-markdown-display": "^7.0.0",
    "react-native-vector-icons": "^10.0.0",
    "zustand": "^4.5.0"
  }
}
```

---

## Ek Notlar

1. **Tüm network istekleri** axios instance üzerinden gitsin, base URL ve X-API-Key interceptor ile otomatik eklensin.
2. **Error handling:** 401 gelirse otomatik logout yap ve LoginScreen'e yönlendir.
3. **Loading states:** Her async işlemde uygun loading göstergesi kullan.
4. **Keyboard avoiding:** ChatScreen'de klavye açıkken input bar görünür kalsın (KeyboardAvoidingView).
5. **FlatList optimizasyonu:** inverted={true} kullan chat ekranında (en yeni mesaj altta).
6. **Android back button:** ChatScreen'de geri tuşu ConversationsScreen'e dönsün.
7. **Empty states:** Konuşma listesi boşsa, mesaj listesi boşsa uygun boş durum göster.
8. **Tarih formatı:** Konuşma listesinde "2 saat önce", "Dün", "3 Ocak" gibi relative time göster.
9. **Swipe to delete:** react-native-gesture-handler ile sola kaydırma → kırmızı sil butonu.
10. **Model değiştirme:** ChatScreen'de model değiştirildiğinde konuşmanın geri kalanı yeni modelle devam etsin (PATCH endpoint'i çağır).

---

## Derleme Talimatı

Android APK üretmek için:
```bash
cd android
./gradlew assembleRelease
```

AAB için:
```bash
./gradlew bundleRelease
```

`android/app/build/outputs/` altında çıktı oluşacak.
