# Zamanlanmış görevler ve Artifacts

## Zamanlanmış görevler
Belirli zamanlarda bir istemi (prompt) otomatik çalıştırır; sonuç **yeni bir sohbet** olarak kalır (kenar menüsünde saat simgesiyle görünür).
Kullanıcı bölümden elle kurar ya da asistana "her sabah 9'da haber özeti gönder" der (ajan araçları).

- **Zamanlar**: bir kez (`once`), günlük (`daily`), haftalık (`weekly`, 1 = Pzt … 7 = Paz), aralıklı (`interval`, en az 30 dk). Saat dilimi görev başına saklanır (varsayılan `Europe/Istanbul`); yaz saati geçişleri doğru hesaplanır (`packages/shared/src/schedule.ts`).
- **Model**: Hızlı / Dengeli / Derin (sohbetteki modlarla aynı zincir).
- **Sınırlar**: kullanıcı başına 20 görev; yalnızca hesaplı üyeler (misafir değil). Çalıştırma sohbet günlük mesaj hakkından düşer; hak bittiyse görev `error` olarak işaretlenir ve boş sohbet bırakılmaz.
- **Çalıştırıcı**: sunucu açıkken her 30 sn'de zamanı gelen görevleri alır (`startScheduler`, en fazla 3 paralel). Sunucu kapalıyken kaçan tekrarlayan görev açılışta bir kez çalışır; 6 saatten fazla kaçan **tek seferlik** görev atlanır (`skipped`). `SCHEDULER_ENABLED=false` ile kapatılır.
- **Görev çalışırken** zamanlama araçları verilmez (zincirleme zamanlama yok); model soru sormaz, istemi doğrudan yerine getirir. Yazma gerektiren MCP araçları onay bekler: sonuç sohbette onay kartı olarak kalır.
- **Ajan araçları** (Chat): `schedule_create`, `schedule_list`, `schedule_update`, `schedule_delete`. Saatler İstanbul saatidir. (Code oturumlarında yok.)

### API
`GET/POST /api/schedule`, `PATCH/DELETE /api/schedule/:id`, `POST /api/schedule/:id/run` (şimdi çalıştır, zamanlamayı değiştirmez), `GET /api/schedule/:id/runs`.

## Artifacts
`GET /api/artifacts` kullanıcının sohbetlerinde üretilmiş artifact'ları (aynı sohbet + `id` için **en yeni sürüm**, sürüm sayısıyla) listeler; son 400 yanıt taranır. Listeden birine dokunmak sohbeti açar ve artifact panelini/görüntüleyicisini gösterir.

## Arayüz
Web: kenar menüsünde **Zamanlanmış** ve **Artifacts** (`/scheduled`, `/artifacts`). Mobil: çekmecede aynı iki satır.
Mobilde tarih/saat alanları metin girişidir (`SS:DD`, `YYYY-AA-GG SS:DD`); "1 saat sonra" ve "Yarın 09:00" kısayolları vardır.

## Pi'de doğrulama
1. `git pull` + `docker compose up -d --build` (migration `015_scheduled_tasks.sql` otomatik uygulanır).
2. Bir görev kur, "Şimdi çalıştır" de: yeni sohbet oluşmalı.
3. Asistana "her gün 09:00'da bana kısa bir güne başlangıç özeti yaz" de: araç kartı çıkmalı, görev listede `Asistan oluşturdu` ile görünmeli.
