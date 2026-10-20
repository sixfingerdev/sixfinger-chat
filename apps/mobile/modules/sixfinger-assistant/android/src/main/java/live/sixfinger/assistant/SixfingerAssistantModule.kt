package live.sixfinger.assistant

import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognitionService
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Asistan penceresinin JS köprüsü: açılış bilgisi, ekran içeriği, kapatma, ses tanıma ve ayar kısayolları. */
class SixfingerAssistantModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null
  private var lastLevelAt = 0L

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context yok")

  override fun definition() = ModuleDefinition {
    Name("SixfingerAssistant")

    Events("onSession", "onAssistContext", "onHide", "onSpeech")

    OnCreate {
      AssistBridge.emit = { name, body -> sendEvent(name, body) }
    }
    OnDestroy {
      AssistBridge.emit = null
      main.post { destroyRecognizer() }
    }

    Function("getLaunchInfo") {
      mapOf("source" to AssistBridge.source, "voice" to AssistBridge.autoVoice)
    }
    Function("getAssistContext") { AssistBridge.snapshot }
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

    // ---- Ses tanıma (cihazdaki konuşma tanıma servisi) ----
    Function("isSpeechAvailable") { SpeechRecognizer.isRecognitionAvailable(context) }

    Function("startListening") { lang: String ->
      main.post { startRecognizer(lang) }
    }
    Function("stopListening") { main.post { recognizer?.stopListening() } }
    Function("cancelListening") { main.post { destroyRecognizer() } }
  }

  private fun emit(type: String, extra: Map<String, Any?> = emptyMap()) {
    sendEvent("onSpeech", mapOf("type" to type) + extra)
  }

  /** Asistan olarak seçildiğimizde varsayılan tanıyıcı biz olabiliriz: gerçek bir tanıyıcıyı (tercihen Google) açıkça seçeriz. */
  private fun pickRecognizer(): ComponentName? {
    val services = context.packageManager.queryIntentServices(Intent(RecognitionService.SERVICE_INTERFACE), 0)
      .mapNotNull { it.serviceInfo }
      .filter { it.packageName != context.packageName }
    val google = services.firstOrNull { it.packageName == "com.google.android.googlequicksearchbox" }
    val chosen = google ?: services.firstOrNull() ?: return null
    return ComponentName(chosen.packageName, chosen.name)
  }

  private fun startRecognizer(lang: String) {
    destroyRecognizer()
    val ctx = context
    val comp = try { pickRecognizer() } catch (_: Throwable) { null }
    val r = try {
      if (comp != null) SpeechRecognizer.createSpeechRecognizer(ctx, comp) else SpeechRecognizer.createSpeechRecognizer(ctx)
    } catch (e: Throwable) {
      emit("error", mapOf("code" to -1, "message" to (e.message ?: "tanıyıcı yok")))
      return
    }
    recognizer = r
    r.setRecognitionListener(object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) = emit("ready")
      override fun onBeginningOfSpeech() = emit("start")
      override fun onRmsChanged(rmsdB: Float) {
        val now = System.currentTimeMillis()
        if (now - lastLevelAt < 70) return
        lastLevelAt = now
        emit("level", mapOf("value" to rmsdB.toDouble()))
      }
      override fun onBufferReceived(buffer: ByteArray?) {}
      override fun onEndOfSpeech() = emit("end")
      override fun onError(error: Int) = emit("error", mapOf("code" to error))
      override fun onResults(results: Bundle?) {
        val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
        emit("final", mapOf("text" to text))
      }
      override fun onPartialResults(partialResults: Bundle?) {
        val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: return
        emit("partial", mapOf("text" to text))
      }
      override fun onEvent(eventType: Int, params: Bundle?) {}
    })
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.packageName)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
    }
    try {
      r.startListening(intent)
    } catch (e: Throwable) {
      emit("error", mapOf("code" to -1, "message" to (e.message ?: "başlatılamadı")))
    }
  }

  private fun destroyRecognizer() {
    recognizer?.let {
      try { it.cancel() } catch (_: Throwable) {}
      try { it.destroy() } catch (_: Throwable) {}
    }
    recognizer = null
  }
}
