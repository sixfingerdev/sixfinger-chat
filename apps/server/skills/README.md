# Yerleşik skill'ler

Her klasör bir skill'dir: `<ad>/SKILL.md` (YAML başlık + Markdown gövde) ve isteğe bağlı `references/`, `scripts/` altında **metin** dosyaları.
Derlemede `dist/skills/` altına kopyalanır; sunucu açılışında okunur (geçersiz olanlar günlüğe yazılıp atlanır).

```markdown
---
name: static-web-app            # küçük harf, rakam, tire (klasör adıyla aynı olsun)
description: Ne yaptığı VE ne zaman kullanılacağı (İngilizce, ≤ 1024 karakter). Use when …
triggers: [oyun, game, web sayfası]   # Türkçe + İngilizce anahtar sözcükler: sunucu tarafı eşleştirme ipucu için
---

Gövde (≤ 20 000 karakter): kısa, adım adım, komutları olduğu gibi yaz. Ayrıntıyı references/*.md'ye taşı.
```

Kurallar (Qwen 27B için): emir kipi, numaralı adımlar, "yapma" listesi, doğrulama adımı, `preview`/`share_file` gibi platform araçlarına açık gönderme.
Betikler (`scripts/`) skill yüklenince çalışma alanında `.sixfinger/run/skills/<ad>/scripts/` altına açılır; ajan `bash` ile çalıştırır.
