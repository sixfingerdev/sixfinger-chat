# Skill'ler (SixFinger Code)

Skill = ajanın **uzman kılavuzu**: `<ad>/SKILL.md` (YAML başlık + Markdown gövde) ve isteğe bağlı `references/`, `scripts/` altında metin dosyaları
(açık Agent Skills biçimi). Küçük bir model (Qwen 27B) için kritik: "nasıl yapılır" bilgisi istemde değil, **gerektiği anda** bağlama girer.

## Nasıl çalışır (kademeli yükleme)
1. Her turda sistem istemine yalnızca **katalog** girer: `ad [kaynak]: açıklama` (en çok ~9 bin karakter; çoksa açıklamalar kısalır, adlar kalır).
2. Kural: "Başlamadan kataloğa bak; eşleşen skill varsa önce `skill` aracını çağır ve döneni uygula; en çok 2 skill".
3. **Sunucu tarafı ipucu**: kullanıcı mesajı skill'lerin `triggers` + açıklama sözcükleriyle eşleşirse (`packages/shared/src/skills.ts` `matchSkills`; kök tabanlı, Türkçe/İngilizce,
   en çok 2) istem "bu istek şunlarla ilgili: X — önce yükle" notu taşır. Karar yine modelde.
4. `skill {name}` gövdeyi (≤ 20 000 karakter) döndürür ve ek dosyaları listeler; `skill {name, file}` bir ek dosyayı verir. `scripts/` dosyaları çalışma alanında
   `.sixfinger/run/skills/<ad>/scripts/` altına açılır (git dışı); ajan `bash` ile çalıştırır, hiçbir betik kendiliğinden çalışmaz.
5. **Kalıcılık**: `skill` sonuçlarının (son 3) bağlam kırpmasından muaf tutulur; sıkıştırma (compaction) sonrası ve sonraki turlarda yüklenmiş skill'ler sistem isteminde
   "Active skills" olarak kalır (en çok 3, her biri ≤ 6 000 karakter).
6. Açık çağrı: slash menüsünde her skill `/skill-adı` olarak çıkar ("bu skill'i kullan" istemi).

## Kaynaklar ve öncelik
| Kaynak | Yer | Düzenleme |
|---|---|---|
| Yerleşik | `apps/server/skills/<ad>/` (sürümle gelir; `dist/skills`) | **Değiştirilemez, silinemez, ezilemez**: adları rezervedir; kullanıcı/repo aynı adla skill oluşturamaz (API 409, kataloğa girmez). Arayüzde yalnızca görüntülenir |
| Kullanıcı | veritabanı `code_skills` (hesap başına en çok 50) | Web/mobil skill ekranı; GitHub'dan alma; bağlantıyla paylaşma |
| Repo | `.sixfinger/skills/`, `.claude/skills/`, `.agents/skills/` (her turda keşfedilir, en çok 30) | Repoda commit'le; `[repo]` etiketiyle görünür |

Öncelik: yerleşik adlar rezerve; diğerlerinde repo > kullanıcı. Ortam ayarında skill başına aç/kapa vardır (`skillsOff`); kapatılanlar kataloğa girmez.

## Ajanın skill yazması ve alt ajanlar
- **`skill_create`**: kullanıcı açıkça isterse ("bunu skill yap") ajan `.sixfinger/skills/<ad>/SKILL.md` (+ `references/`, `scripts/`) yazar. Dosyalar repoda kalır; tur sonu commit/PR'a girer
  ve ekip bu skill'i `[repo]` olarak görür. Yerleşik adlar rezervedir, kullanıcı isteği olmadan çağrılmaz; alt ajanlarda kapalıdır.
- **Alt ajanlar** (`task`) skill kataloğunu görür ve `skill` aracıyla gövde okuyabilir; ancak `skill_create`, `preview` ve `share_file` kullanamaz.

## Güvenlik
Skill metni istem enjeksiyonu kapısıdır (özellikle repo ve içe aktarılanlar): köken etiketlenir; `[repo]` skill'leri "proje kılavuzu" olarak sunulur ve platform kurallarını
aşamaz; başlıktaki `allowed-tools` gibi alanlar **yok sayılır** (yetki vermez); ad `[a-z0-9-]`, dosya yolları klasör dışına çıkamaz, metin dışı dosya yok; boyut/sayı sınırları var.
İçe aktarma ve paylaşım ayrı kullanıcı eylemidir.

## Biçim
```markdown
---
name: static-web-app          # küçük harf-rakam-tire
description: Ne yapar + ne zaman kullanılır (İngilizce, ≤ 1024). Use when …
triggers: [oyun, game, web sayfası]   # Türkçe + İngilizce; eşleştirme ilk 4 harf
---

Gövde (≤ 20 000 karakter): numaralı adımlar, komutlar, "Yapma" listesi, doğrulama.
```

## API
| Uç nokta | |
|---|---|
| `GET /code/skills` | Yerleşik + kendi skill'lerin |
| `GET/PUT/DELETE /code/skills/:name` · `POST /code/skills` | Oku (`?source=builtin`), güncelle, sil, oluştur (tam SKILL.md metni + `files`) |
| `POST /code/skills/import {url, overwrite?}` | GitHub klasörü/deposu: `…/tree/<dal>/<yol>`, `…/blob/…/SKILL.md`, `sahip/depo/yol` (kullanıcının GitHub bağlantısı varsa onun token'ı, yoksa herkese açık okuma) |
| `POST /code/skills/:name/share {enabled}` | Bağlantıyla paylaşım (token) |
| `GET /code/skills/shared/:token` · `POST …/import {overwrite?}` | Paylaşılanı önizle / hesabına al (çakışmada 409) |
| `GET /code/sessions/:id/skills` | Oturumun etkin kataloğu (repo skill'leri dahil) |

## Yerleşik kütüphane
`apps/server/skills/README.md` yazım kurallarını, `apps/server/test/builtin-skills.test.ts` kalite kapılarını (geçerlilik, boyut, git yazma komutu yok, Türkçe/İngilizce eşleştirme) içerir.
Skill'lerin Qwen'de gerçek etkisi Pi'de ölçülmelidir: `apps/server/scripts/code-smoke.ts --skills on|off`.
