# Uzaktan CLI: SixFinger Code (opencode çatalı) oturumlarını site ve uygulamadan izleme/yönetme

Yazıldığı tarih: Ekim 2026. Durum: **tasarım, kod yok**. Çatal: https://github.com/sixfingerdev/SixFinger-Code (dal `dev`, opencode çatalı, `SIXFINGER.md` değişiklikleri anlatır).

## Amaç
Kullanıcı kendi cihazında (bilgisayar/Pi) çatalı Claude Code gibi CLI olarak çalıştırsın; oturumlar chat.sixfinger.live'da ve mobil uygulamada
"Bu cihaz" rozetiyle Code oturumları arasında görünsün, canlı izlenebilsin, telefondan/siteden mesaj gönderilebilsin, durdurulabilsin, izin ve soru kartları yanıtlanabilsin.
Çalışma bulutta (sandboxd) değil **cihazın kendisinde** olur. Sunucu yalnızca aracıdır ve oturum kaydını tutar.

## Çatalda bulduklarımız (incelendi)
Çatalda neredeyse her şey hazır, yeni yazılacak olan yalnızca "dışarı bağlanan köprü":
- **Başsız sunucu:** `packages/opencode/src/cli/cmd/serve.ts` (`opencode serve`), isteğe bağlı Basic auth (`OPENCODE_SERVER_PASSWORD`, `src/server/auth.ts`). `attach.ts` çalışan sunucuya TUI bağlar.
- **HTTP API (OpenAPI):** `packages/sdk/openapi.json`, 162 yol. Bizim için gerekenler:
  - Oturum: `GET/POST /session`, `GET /session/status`, `GET /session/{id}`, `GET/POST /session/{id}/message`, `POST /session/{id}/prompt_async` (204, gövde: `parts[]`, `model`, `agent`, `variant`), `POST /session/{id}/abort`, `GET /session/{id}/diff`, `GET /session/{id}/todo`, `revert/unrevert`, `summarize`, `fork`.
  - Yanıt gerektirenler: `GET /permission`, `POST /permission/{requestID}/reply`, `GET /question`, `POST /question/{requestID}/reply|reject`.
  - Olaylar: `GET /global/event` (SSE, `GlobalEvent = {directory, project, workspace, payload:{id:"evt_…", type, properties}}`). Ayrıca v2: `GET /api/event`, `GET /api/session/{id}/event`, `GET /api/session/{id}/history`.
  - Diğer: `GET /project`, `GET /path`, `GET /global/health`. Dizin `?directory=` ya da `x-opencode-directory` başlığıyla verilir.
- **Parça türleri** (`Part`): Text, Reasoning, Tool, File, Patch, Subtask, Agent, StepStart/Finish, Snapshot, Retry, Compaction. Bizim Code mesaj parçalarına (`packages/shared/src/parts.ts`) eşlenir: Text→text, Reasoning→thinking, Tool→araç kartı (bash/read/edit…), Patch→diff çipi, Subtask→alt ajan kartı, `question` isteği→soru kartı.
- **Çatal özellikleri** (`SIXFINGER.md`): cron, hafıza, ekip/MoA, worktree, monitor, tool-search. Hepsi oturum içinde kalır; köprü bunlara dokunmaz.
- **Kontrol düzlemi:** `src/control-plane` (çalışma alanı adaptörleri, hedef `local | remote{url,headers}`). İlk sürümde kullanılmaz; ileride "uzak çalışma alanı" için aday.

## Mimari
```
[cihaz]  opencode (CLI/TUI)  ←→  yerel başsız sunucu (127.0.0.1, rastgele port, parola)
              ↑                          ↑
        `opencode link` (yeni komut) — köprü; yalnızca DIŞARI bağlanır (WSS)
                                  │
[sunucu] apps/server  /api/link  ←→ Postgres (cihazlar, bağlı oturumlar, olay günlüğü)
                                  │
[istemci] site + mobil: Code oturum listesi / ekranı (mevcut bileşenler)
```
- **Köprü** (`opencode link`, yeni CLI komutu, çatalda `packages/opencode/src/cli/cmd/link.ts`): yerel sunucuyu içeriden başlatır (ya da çalışana bağlanır), `/global/event` SSE'sini dinler, olayları WSS ile sunucuya iletir; sunucudan gelen komutları yerel HTTP API'ye çevirir. Cihazda port açmak gerekmez, NAT/güvenlik duvarı sorun olmaz. Kesilirse üstel geri çekilmeyle yeniden bağlanır, sunucu son olay kimliğinden (`evt_…`) devam ettirir.
- **Eşleştirme:** `opencode link login` cihaz kodu üretir (ör. `ABCD-1234`); kullanıcı sitede Ayarlar → Cihazlar'da kodu girer; sunucu cihaza uzun ömürlü, **yalnız o cihaza özel** jeton verir (sunucuda yalnızca özeti saklanır, iptal edilebilir). Mevcut GitHub OAuth `target: web|app` kalıbındaki gibi sunucu tarafı tamamlama kullanılır.
- **Sunucu tarafı** (`apps/server`): yeni tablolar `linked_devices(id, user_id, name, token_hash, last_seen, platform, version)`, `linked_sessions(id, device_id, remote_session_id, title, directory, status, updated_at)`, `linked_events(seq, session_id, event_id, type, payload jsonb)` (sınırlı tutulur: son N olay/oturum; dökümü cihazdan `GET /session/{id}/message` ile yeniden kurmak mümkün). Uçlar: `WS /api/link/connect` (cihaz), `GET /api/link/devices`, `GET /api/link/sessions`, mevcut Code SSE biçiminde `GET /api/link/sessions/:id/events`, `POST …/message`, `POST …/abort`, `POST …/permission/:rid`, `POST …/question/:rid`. Komutlar cihaz çevrimdışıysa 409 döner; kuyruğa alınmaz (güvenlik: eski komut sonradan çalışmasın).
- **İstemciler:** Code sekmesindeki oturum listesine "Bu cihaz: <ad>" rozeti ve çevrimdışı durumu; oturum ekranı mevcut Code bileşenleriyle çizilir (olay→parça dönüştürücü paylaşılan pakette olur, hem web hem mobil kullanır). Kredi harcaması yok: model çağrılarını cihaz kendi yapılandırmasıyla (kendi anahtarları) yapar.

## Güvenlik (en önemli kısım)
- Uzaktan komut = cihazda kod çalıştırma. Varsayılan: uzaktan gelen `prompt` yalnızca cihazın kendi izin ayarlarıyla çalışır; **izin istekleri uzaktan onaylanabilir**, ama "hep izin ver" uzaktan **verilemez**.
- Jeton cihaza özeldir, sunucuda karma olarak saklanır; kullanıcı sitede iptal eder. Köprü yerel sunucuya yalnızca 127.0.0.1 üzerinden ve rastgele parolayla bağlanır.
- Cihaz → sunucu yükü kullanıcıdan gelen veri sayılır: dosya içerikleri/araç çıktıları istemcilerde mevcut kuralla (güvenilmez metin) gösterilir; boyut sınırı ve oran sınırı uygulanır.
- Üyelik koşulu: bağlayıcı oturumlar yalnızca doğrulanmış üyelere (Code ile aynı kural).
- Sırlar (sağlayıcı anahtarları, `auth.json`) sunucuya **hiçbir zaman** iletilmez; köprü olay süzgecinde `auth`/`provider` çıktısını atar.

## Aşamalar
1. **Salt izleme (ilk sürüm):** `link login`, `link` (SSE→WSS), sunucu cihaz/oturum/olay uçları, web+mobil listede rozet ve canlı izleme. Test: sahte WSS cihaz + kayıtlı SSE olayları.
2. **Uzaktan kontrol:** mesaj gönder, durdur, izin/soru yanıtı, diff görüntüleme, `revert`.
3. **Cihazdan yeni oturum başlatma** (telefondan "bu cihazda yeni oturum"), dizin seçimi (`/project`, `/path`).
4. **Parlatma:** yerel bildirim (tur bitti/izin bekliyor), çoklu cihaz, çalışma alanı adaptörü olarak `remote`.

## Açık sorular
- Köprü çatalın içinde (`opencode link`) mı, ayrı küçük bir ikili mi? Öneri: çatalın içinde, çünkü olay şeması ve SDK orada.
- Olay günlüğü ne kadar saklansın? Öneri: oturum başına son 2000 olay + bağlanınca cihazdan tam döküm istenebilsin.
- v2 API'si (`/api/session/{id}/event`, `/history`) mı v1 SSE (`/global/event`) mi? Öneri: v1 ile başla (sabit görünüyor), v2'ye sonra geç; şema `packages/protocol` içinde, çatal ilerledikçe değişebilir.
- Sürüm uyumu: köprü başlangıçta `version` bildirir, sunucu desteklenmeyen sürüme açık hata verir.
