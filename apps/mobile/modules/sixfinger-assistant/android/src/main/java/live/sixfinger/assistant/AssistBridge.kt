package live.sixfinger.assistant

/**
 * Asistan oturumu (sistem servisi) ile React tarafı arasındaki köprü. Aynı süreçte yaşar.
 * Olaylar JS hazır olmadan önce gelebilir; bu yüzden son durum burada tutulur ve JS açılışta çeker (`getLaunchInfo`, `getAssistContext`).
 */
object AssistBridge {
  /** Sistemin verdiği ekran görüntüsü (tam çözünürlük; bölge seçiminde kırpılır). */
  @Volatile var screenshot: android.graphics.Bitmap? = null
  /** Önizleme dosyası: { path, width, height }. */
  @Volatile var screenshotInfo: Map<String, Any?>? = null

  /** Pencere nereden açıldı: "assistant" (güç tuşu/kaydırma), "assist" (ACTION_ASSIST), "tile", "app". */
  @Volatile var source: String = "app"
  /** Açılır açılmaz mikrofonu başlat (karo ve "sesle sor" kısayolu). */
  @Volatile var autoVoice: Boolean = false
  /** Ekrandaki uygulamadan okunan en son içerik (yalnızca asistan olarak açıldıysa dolu). */
  @Volatile var snapshot: Map<String, Any?>? = null

  /** Modül tarafından bağlanır (JS olayları). */
  @Volatile var emit: ((String, Map<String, Any?>) -> Unit)? = null
  /** Açık pencere tarafından bağlanır (pencereyi kapatır). */
  @Volatile var closer: (() -> Unit)? = null

  fun begin(src: String, voice: Boolean = false) {
    source = src
    autoVoice = voice
    snapshot = null
    screenshot = null
    screenshotInfo = null
    emit?.invoke("onSession", mapOf("source" to src, "voice" to voice))
  }

  fun setScreenshot(info: Map<String, Any?>) {
    screenshotInfo = info
    emit?.invoke("onScreenshot", info)
  }

  fun setContext(s: Map<String, Any?>) {
    snapshot = s
    emit?.invoke("onAssistContext", s)
  }

  /** Sistem asistan oturumunu kapattı (tekrar güç tuşu, başka uygulamaya geçiş…). */
  fun hide() {
    closer?.invoke()
    emit?.invoke("onHide", emptyMap())
  }
}
