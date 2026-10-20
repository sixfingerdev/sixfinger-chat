package live.sixfinger.assistant

import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognitionService
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Bazı Android sürümleri asistan servisinin geçerli sayılması için bir konuşma tanıma servisi ister. Asistan seçilince sistem varsayılan
 * tanıyıcıyı bize çevirebilir; bu yüzden isteği cihazdaki gerçek tanıyıcıya (Google) aynen iletiriz, diğer uygulamaların ses girişi bozulmaz.
 */
class SfRecognitionService : RecognitionService() {
  private var delegate: SpeechRecognizer? = null

  override fun onStartListening(recognizerIntent: Intent, listener: Callback) {
    AssistDiag.mark(this, "recognizer")
    clear()
    val comp = try { pickRealRecognizer(this) } catch (_: Throwable) { null }
    if (comp == null) {
      safe { listener.error(SpeechRecognizer.ERROR_CLIENT) }
      return
    }
    val r = try { SpeechRecognizer.createSpeechRecognizer(this, comp) } catch (_: Throwable) { null }
    if (r == null) {
      safe { listener.error(SpeechRecognizer.ERROR_CLIENT) }
      return
    }
    delegate = r
    r.setRecognitionListener(object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) = safe { listener.readyForSpeech(params ?: Bundle()) }
      override fun onBeginningOfSpeech() = safe { listener.beginningOfSpeech() }
      override fun onRmsChanged(rmsdB: Float) = safe { listener.rmsChanged(rmsdB) }
      override fun onBufferReceived(buffer: ByteArray?) = safe { listener.bufferReceived(buffer ?: ByteArray(0)) }
      override fun onEndOfSpeech() = safe { listener.endOfSpeech() }
      override fun onError(error: Int) = safe { listener.error(error) }
      override fun onResults(results: Bundle?) = safe { listener.results(results ?: Bundle()) }
      override fun onPartialResults(partialResults: Bundle?) = safe { listener.partialResults(partialResults ?: Bundle()) }
      override fun onEvent(eventType: Int, params: Bundle?) {}
    })
    val forward = Intent(recognizerIntent)
    forward.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
    try {
      r.startListening(forward)
    } catch (_: Throwable) {
      safe { listener.error(SpeechRecognizer.ERROR_CLIENT) }
    }
  }

  override fun onStopListening(listener: Callback) {
    try { delegate?.stopListening() } catch (_: Throwable) {}
  }

  override fun onCancel(listener: Callback) = clear()

  override fun onDestroy() {
    clear()
    super.onDestroy()
  }

  private fun clear() {
    delegate?.let {
      try { it.cancel() } catch (_: Throwable) {}
      try { it.destroy() } catch (_: Throwable) {}
    }
    delegate = null
  }

  private inline fun safe(block: () -> Unit) {
    try { block() } catch (_: Throwable) {}
  }
}
