package live.sixfinger.assistant

import android.app.assist.AssistContent
import android.app.assist.AssistStructure
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService

class SfSessionService : VoiceInteractionSessionService() {
  override fun onNewSession(args: Bundle?): VoiceInteractionSession {
    AssistDiag.mark(this, "sessionNew")
    return SfSession(this)
  }
}

/** Her güç tuşu/kaydırma açılışında bir oturum: şeffaf React penceresini başlatır ve ekran içeriğini köprüye iletir. */
class SfSession(private val ctx: Context) : VoiceInteractionSession(ctx) {
  override fun onShow(args: Bundle?, showFlags: Int) {
    super.onShow(args, showFlags)
    AssistDiag.mark(ctx, "show")
    AssistBridge.begin("assistant")
    val intent = Intent(ctx, AssistantActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      .putExtra(AssistantActivity.EXTRA_SOURCE, "assistant")
    try {
      startAssistantActivity(intent)
      AssistDiag.mark(ctx, "startActivity")
    } catch (e: Throwable) {
      AssistDiag.mark(ctx, "startActivityError", e.toString())
      // Asistan etkinliği sistem üzerinden başlatılamadıysa normal yoldan dene.
      try { ctx.startActivity(intent) } catch (_: Throwable) {}
    }
  }

  @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
  override fun onHandleAssist(data: Bundle?, structure: AssistStructure?, content: AssistContent?) {
    AssistDiag.mark(ctx, "assist")
    try {
      AssistExtractor.extract(structure, content, ctx.packageName)?.let { AssistBridge.setContext(it) }
    } catch (_: Throwable) {
      // Ekran okunamazsa asistan bağlamsız çalışmaya devam eder.
    }
  }

  override fun onHide() {
    super.onHide()
    AssistDiag.mark(ctx, "hide")
    AssistBridge.hide()
  }
}
