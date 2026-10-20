package live.sixfinger.assistant

import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.speech.SpeechRecognizer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Asistan penceresinin JS köprüsü: açılış bilgisi, ekran içeriği, kapatma, ses tanıma ve ayar kısayolları. */
class SixfingerAssistantModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var controller: SpeechController? = null

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context yok")

  override fun definition() = ModuleDefinition {
    Name("SixfingerAssistant")

    Events("onSession", "onAssistContext", "onScreenshot", "onHide", "onSpeech")

    OnCreate {
      AssistBridge.emit = { name, body -> sendEvent(name, body) }
    }
    OnDestroy {
      AssistBridge.emit = null
      main.post { controller?.destroy(); controller = null }
    }

    Function("getLaunchInfo") {
      mapOf("source" to AssistBridge.source, "voice" to AssistBridge.autoVoice)
    }
    Function("getAssistContext") { AssistBridge.snapshot }
    Function("getScreenshot") { AssistBridge.screenshotInfo }

    Function("close") { AssistBridge.closer?.invoke() }

    /** Ana uygulamayı öne getirir (sohbeti JS tarafı zaten açtı). */
    Function("openApp") {
      val pm = context.packageManager
      val intent = pm.getLaunchIntentForPackage(context.packageName)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
      if (intent != null) context.startActivity(intent)
    }

    /** Asistan penceresini (asistan seçilmemiş olsa da) açar: "dene" düğmesi. */
    Function("launchOverlay") { voice: Boolean ->
      val intent = Intent(context, AssistantActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        .putExtra(AssistantActivity.EXTRA_SOURCE, "app")
        .putExtra(AssistantActivity.EXTRA_VOICE, voice)
      context.startActivity(intent)
    }

    Function("isDefaultAssistant") {
      try {
        if (Build.VERSION.SDK_INT >= 29) {
          val rm = context.getSystemService(RoleManager::class.java)
          if (rm != null && rm.isRoleHeld(RoleManager.ROLE_ASSISTANT)) return@Function true
        }
        val cur = Settings.Secure.getString(context.contentResolver, "assistant") ?: ""
        cur.startsWith(context.packageName + "/")
      } catch (_: Throwable) {
        false
      }
    }

    /** Sistemin "Dijital asistan uygulaması" ekranını açar (üretici ekranı yoksa varsayılan uygulamalar → ayarlar). */
    Function("openAssistantSettings") {
      val candidates = listOf(
        Intent(Settings.ACTION_VOICE_INPUT_SETTINGS),
        Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS),
        Intent(Settings.ACTION_SETTINGS),
      )
      for (i in candidates) {
        try {
          context.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          return@Function true
        } catch (_: Throwable) {
          // sıradaki
        }
      }
      false
    }

    /** Görseli hazırlar (küçült + JPEG). Arka plan iş parçacığında çalışır. Dönen `path` önizleme, `data` sunucuya gidecek base64'tür. */
    AsyncFunction("compressImage") { uri: String, maxSide: Int, maxBytes: Int ->
      val r = ImageTools.compress(context, uri, maxSide, maxBytes)
      mapOf("path" to r.path, "data" to r.base64, "width" to r.width, "height" to r.height)
    }

    /** Ekran görüntüsünden bölge kırpar. Kutu, görüntünün yüzdesidir (0–1). Küçültülür ve JPEG'e çevrilir. */
    AsyncFunction("cropScreenshot") { left: Double, top: Double, right: Double, bottom: Double, maxSide: Int, maxBytes: Int ->
      val src = AssistBridge.screenshot ?: throw IllegalStateException("ekran görüntüsü yok")
      val x = (left.coerceIn(0.0, 1.0) * src.width).toInt()
      val y = (top.coerceIn(0.0, 1.0) * src.height).toInt()
      val w = ((right.coerceIn(0.0, 1.0) - left.coerceIn(0.0, 1.0)) * src.width).toInt().coerceAtLeast(8).coerceAtMost(src.width - x)
      val h = ((bottom.coerceIn(0.0, 1.0) - top.coerceIn(0.0, 1.0)) * src.height).toInt().coerceAtLeast(8).coerceAtMost(src.height - y)
      var part = android.graphics.Bitmap.createBitmap(src, x.coerceAtMost(src.width - 1), y.coerceAtMost(src.height - 1), w, h)
      val scale = minOf(1f, maxSide.toFloat() / maxOf(part.width, part.height))
      if (scale < 1f) part = android.graphics.Bitmap.createScaledBitmap(part, (part.width * scale).toInt().coerceAtLeast(1), (part.height * scale).toInt().coerceAtLeast(1), true)
      val r = ImageTools.encode(context, part, maxBytes)
      mapOf("path" to r.path, "data" to r.base64, "width" to r.width, "height" to r.height)
    }

    // ---- Ses tanıma (cihazdaki konuşma tanıma servisi; çok dilde aynı sesi her dile verir) ----
    Function("isSpeechAvailable") { SpeechRecognizer.isRecognitionAvailable(context) }

    Function("startListening") { langs: List<String>, forceSingle: Boolean ->
      main.post { speech().start(langs, forceSingle) }
    }
    Function("stopListening") { main.post { controller?.stop() } }
    Function("cancelListening") { main.post { controller?.destroy() } }
  }

  private fun speech(): SpeechController {
    controller?.let { return it }
    val c = SpeechController(context) { body -> sendEvent("onSpeech", body) }
    controller = c
    return c
  }
}
