# SixFinger Code: ajan tasarımı notları

Bu belge, Faz 2'de (ajanın çalışması) uygulanacak tasarım kararlarının kaynağıdır. Kararlar iki açık kaynak projenin
(**opencode**, MIT; **aider**, Apache-2.0) kaynak kodu incelenerek çıkarıldı. Buradan alınan fikirler ve kısa istem
parçaları atıfla kullanılır, kod kopyalanmaz.

Model: önce Qwen3.8-27B (OVH, OpenAI uyumlu araç çağırma + reasoning), başarısız olursa Claude (Bedrock). Ajan Docker
sandbox'ında çalışır; araçlar `sandboxd` HTTP API'siyle konuşur.

## Araçlar

| Araç | Kural |
|---|---|
| `read` | `path`, `offset` (1 tabanlı), `limit` (en çok 2000). Çıktı `N: içerik` satır numaralı. Sınırlar: 2000 satır, 50 KiB, satır başına 2000 karakter. Kesilince "devam için offset: N". Dosya yoksa en çok 3 "Did you mean" önerisi. |
| `write` | Yeni dosya ya da tam değiştirme. Üst klasörleri kendisi açar. Küçük modellerde çok hunk'lı büyük değişiklik için en güvenilir yol budur (aider ölçümü: Qwen3-32B/235B'de tam dosya, diff'ten tutarlı biçimde yüksek, biçim hatası sıfır). |
| `edit` | `path`, `oldString`, `newString`, `replaceAll?`. Eşleştirme 3 kademe: birebir → tipografik tırnak/tire/özel boşluk normalizasyonu → satır sonu boşluklarını yok say. **Bulanık eşleştirme yok** (aider de bilinçli kapattı). Birden çok eşleşmede hata: "N yerde eşleşti, daha fazla bağlam ekle ya da replaceAll". Satır numarası önekini `oldString`'e koyma uyarısı açıklamada. CRLF/LF/BOM korunur. Dosya başına kilit. |
| `bash` | `command`, `timeout?` (varsayılan 120 sn), `background?`. Arka planda `shellId` + çıktı dosyası döner, "tamamlanmayı yoklama" denir. Büyük çıktı dosyaya yazılır, sondan 2000 satır / 50 KiB gösterilir, not: `[showing lines X-Y of N; full output saved to …]`. Çıkış kodu notu eklenir. |
| `glob`, `grep` | ripgrep tabanlı, sonuç sınırı 100. `grep` biçimi: `Found N matches` + dosya başlığı altında `Line N: …`. |
| `job_output`, `job_kill` | `bash background` ile başlayan işin (`shellId`) çıktısını okur / sonlandırır. İş `/tmp/sf-bg-<id>.pid` ile izlenir; çıktı sondan kırpılır. |
| `task` | **Alt ajan.** `description`, `prompt`, `agent: 'explore'\|'general'`. Kendi bağlamında iç içe döngü çalıştırır: `explore` yalnızca okur (`read/glob/grep`), `general` yazabilir. Ana ajana tek bir rapor döner (bulgular `yol:satır` ile). Ana bağlam şişmez; mesajda iç içe kart olarak izlenir. |
| `ask_user` | Kullanıcıya çoktan seçmeli soru. **Turu bitirir**; cevap bir sonraki mesaj olarak gelir (kartta seçenek düğmeleri + serbest metin). |
| `exit_plan_mode` | Plan modunda planı sunar; turu bitirir. Kullanıcı **Onayla** (plan modu kapanır, uygulama başlar) ya da **Düzelt** (yazıp yeniden plan) der. |
| `todo` | Arayüzde yapılacaklar kartı. (opencode'da yok; Claude Code tarzı, biz ekliyoruz.) |
| `web_search`, `web_fetch` | Zaten var. |

Sunucu tarafı **girdi onarımı** (Qwen için kritik): `"20"`→20, `"false"`→false, string'leşmiş JSON nesne/dizi açma,
`null`/`{}` yer tutucularını atma. Doğrulama hatası modele şu biçimde döner: `Invalid arguments for tool "X": …
(en çok 5 madde, verilen argümanlar) Update the arguments and call the tool again.` Bilinmeyen araç: `No tool named "X"
is currently available.` Araç hatası döngüyü kırmaz; model hatayı görüp devam eder.

## Döngü güvenliği

1. **Yetim tool-call yok:** süreç ölse ya da abort edilse `streaming/running` her araç çağrısı "aborted" hata
   sonucuyla kapanır, böylece sonraki istek geçerli kalır.
2. **Azami adım:** son adımda `tool_choice: none` + "yalnızca metinle özetle" mesajı. Araç tanımları yerinde kalır.
3. **`finish_reason=length`:** en çok 2 kez "özür dileme, tekrar etme, işi küçük parçalara böl" mesajı ekle; 3'te dur.
4. **Kesik akış:** "Önceki yanıt yarıda kesildi, kaldığın yerden devam et" mesajı.
5. **Doom loop:** (ikisinde de kod yok, kendimiz yazıyoruz.) Aynı araç + aynı normalize girdi 3 kez üst üste gelirse modele
   uyarı, 5'te adımı durdur. Düzeltme denemeleri en çok 3 (aider `max_reflections`).
6. **Her `edit`/`write` sonrası** ucuz sözdizimi kontrolü; hata, hatayı kapsayan fonksiyon bağlamıyla aynı araç
   sonucunda döner (satır numarası tek başına yetmez; aider `linter.py`).
7. **Eşleşmedi geri bildirimi (en değerli):** dosyadaki en benzer gerçek satırlar (±5 satır bağlam) "Did you mean…?"
   ile gösterilir (aider `editblock_coder.py`).

## Sistem istemi

Kısa ve eylem odaklı. Qwen için hazır istem yok; opencode'un Kimi istemindeki kuralları temel alıyoruz:
araçla gerçekten yaz (metindeki kod kaydedilmez), minimal değişiklik, yazdıktan sonra çalıştırıp doğrula, bağımsız
çağrıları paralel yap, kullanıcının dilinde yanıtla, git'i kendin değiştirme (branch/commit/push sunucu tarafında),
aynı araçla aynı parametreyi sonuç aldıktan sonra tekrarlama, bağımlılığı varsayma, dosyayı okumadan düzenleme.
Araca bağlı satırlar yalnızca o araç açıksa eklenir. Qwen için örnekleme ayarları modele özgü tutulur ve sağlayıcının
bağlam sınırı doğrulanır.

## Bağlam yönetimi

- Tavan = pencere − max(%10, 16K token). Boyut: sağlayıcının bildirdiği son kullanım + karakter/4 tahmini.
- Aşınca özetle: son ~15K token ham kalır, kesim bir kullanıcı mesajına hizalanır (tool-call/result çifti bölünmez).
- Özet şablonu: Objective, Requirements, Decisions, Work State (Completed/Active/Blocked), Next Move, Relevant Files
  (en çok 15), Important Context. Yol, sembol, komut, hata metinleri birebir; "görevi sürdürme, araç çağırma".
- Özet girdisinde her araç çıktısı 1250 karaktere kırpılır. "Context too long" hatasında özetle ve adımı tekrarla.
- Bayat dosya içeriği: düzenlemeden sonra eski `read` çıktılarını kırp ya da "güncel içerik budur" ilkesiyle yeniden oku.
- Repo haritası yerine hafif ağaç (`git ls-files`, derinlik/boyut sınırlı) + üst düzey semboller, 1–2K token, oturum
  başında bir kez. PageRank gerekmez; gerisini `grep`/`glob`'a bırak.

## Değişiklik takibi ve git

- Her adım başında ve sonunda çalışma ağacı durumu yakalanır; adıma değişen dosyalar yazılır. Çip sayıları (+N −M)
  satır farkından, yama `createTwoFilesPatch` ile üretilir. Tur diff'i: ilk adımın başı ile son adımın sonu.
- Ajan kendi `sixfinger/<konu>-<hash>` dalında çalışır. Her başarılı tur sonunda sunucu commit atar (ajan değil), mesajı
  Qwen üretir (Conventional Commits, ≤72 karakter) ve `Co-authored-by` ekler. Push/PR yalnızca kullanıcı onayıyla.
- Geri alma: kayıtlı kontrol noktası SHA'sına dön (yalnızca ajan commit'leri, itilmemiş olanlar).

## Model seçimi (Auto)

Qwen → Claude. Claude yedeği kullanıcı kredisini Qwen ile aynı oranda yakar; Bedrock harcamasını genel günlük token
tavanı (`CODE_CLAUDE_DAILY_TOKENS`) korur. Qwen'in araç çağırma kalitesi Pi'den ölçülmeli (bir sınama betiği Faz 2'nin
ilk işi): aider verileri metin biçimleri içindir ve Qwen3.8-27B'yi kapsamaz.

## Alınmayanlar

Ayrı mimar/editör modeli (gecikme + maliyet, araç şeması biçimi zaten dayatıyor), TUI/masaüstü, yerel dosya sistemi
varsayımları, tree-sitter ile kabuk ayrıştırma, PTY, eklenti/MCP/skill/subagent katmanları, Effect/Drizzle.

## Kaynaklar

- opencode (MIT): `packages/core/src/session/runner/{llm,step}.ts`, `tool/plugin/{shell,read,edit,write,glob,grep}.ts`,
  `plugin/tool-input-repair.ts`, `session/compaction.ts`, `snapshot.ts`, `session/diff.ts`.
- aider (Apache-2.0): `coders/editblock_coder.py`, `coders/base_coder.py`, `linter.py`, `repomap.py`, `history.py`,
  `repo.py`, `website/_data/qwen3_leaderboard.yml`.
