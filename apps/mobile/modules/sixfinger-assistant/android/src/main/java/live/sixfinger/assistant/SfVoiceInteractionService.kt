package live.sixfinger.assistant

import android.service.voice.VoiceInteractionService

/** Dijital asistan servisi: sistem bunu bağlayınca güç tuşu/kaydırma kısayolları oturumu (SfSession) açar. */
class SfVoiceInteractionService : VoiceInteractionService() {
  override fun onReady() {
    super.onReady()
    AssistDiag.mark(this, "ready")
  }

  override fun onLaunchVoiceAssistFromKeyguard() {
    AssistDiag.mark(this, "keyguard")
  }
}
