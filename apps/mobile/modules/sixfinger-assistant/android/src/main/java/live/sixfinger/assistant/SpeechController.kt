package live.sixfinger.assistant

import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.io.OutputStream
import java.util.concurrent.LinkedBlockingQueue
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * Konuşma tanıma. Tek dilde cihazın mikrofonunu doğrudan tanıyıcıya verir.
 * Birden çok dilde (Android 13+) mikrofonu kendimiz kaydeder ve AYNI sesi her dil için ayrı bir tanıyıcıya boru (pipe) ile besleriz;
 * hepsi canlı yazı üretir, hangisinin doğru olduğuna JS tarafı karar verir (güven puanı + metnin dili).
 * Olaylar `lang` alanıyla gelir. Başlangıçta `lanes` olayı hangi dillerin gerçekten çalıştığını bildirir.
 */
class SpeechController(
  private val ctx: Context,
  private val send: (Map<String, Any?>) -> Unit,
) {
  private val main = Handler(Looper.getMainLooper())

  /** Her başlatmada artar: eski oturumdan gelen geç olaylar yok sayılır. */
  private var session = 0
  private var lanes = listOf<Lane>()
  private var single: SpeechRecognizer? = null
  private var audio: AudioRecord? = null
  private var audioThread: Thread? = null

  @Volatile private var feeding = false
  private var lastLevelAt = 0L

  private class Lane(val lang: String) {
    var recognizer: SpeechRecognizer? = null
    var readEnd: ParcelFileDescriptor? = null
    var out: OutputStream? = null
    val queue = LinkedBlockingQueue<ByteArray>(256)
    var writer: Thread? = null

    @Volatile var dead = false
  }

  private fun emit(id: Int, type: String, extra: Map<String, Any?> = emptyMap()) {
    main.post {
      if (id != session) return@post
      send(mapOf("type" to type) + extra)
    }
  }

  fun start(langs: List<String>, forceSingle: Boolean) {
    destroy()
    val id = ++session
    val list = langs.filter { it.isNotBlank() }.distinct().ifEmpty { listOf("en-US") }
    val multi = !forceSingle && list.size >= 2 && Build.VERSION.SDK_INT >= 33
    if (multi && startMulti(id, list)) return
    startSingle(id, list.first())
  }

  fun stop() {
    if (lanes.isNotEmpty()) finishAudio() else single?.stopListening()
  }

  fun destroy() {
    session++
    feeding = false
    try { audio?.stop() } catch (_: Throwable) {}
    try { audio?.release() } catch (_: Throwable) {}
    audio = null
    audioThread = null
    for (l in lanes) closeLane(l)
    lanes = emptyList()
    single?.let {
      try { it.cancel() } catch (_: Throwable) {}
      try { it.destroy() } catch (_: Throwable) {}
    }
    single = null
  }

  // ---------- tek dil ----------

  private fun listener(id: Int, lang: String) = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) = emit(id, "ready", mapOf("lang" to lang))
    override fun onBeginningOfSpeech() = emit(id, "start", mapOf("lang" to lang))
    override fun onRmsChanged(rmsdB: Float) {
      if (lanes.isNotEmpty()) return // çok dilli kipte seviyeyi kendi kaydımızdan veririz
      val now = System.currentTimeMillis()
      if (now - lastLevelAt < 70) return
      lastLevelAt = now
      emit(id, "level", mapOf("value" to rmsdB.toDouble()))
    }
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() = emit(id, "end", mapOf("lang" to lang))
    override fun onError(error: Int) = emit(id, "error", mapOf("lang" to lang, "code" to error))
    override fun onResults(results: Bundle?) {
      val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
      val conf = results?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)?.firstOrNull() ?: -1f
      emit(id, "final", mapOf("lang" to lang, "text" to text, "confidence" to conf.toDouble()))
    }
    override fun onPartialResults(partialResults: Bundle?) {
      val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: return
      emit(id, "partial", mapOf("lang" to lang, "text" to text))
    }
    override fun onEvent(eventType: Int, params: Bundle?) {}
  }

  private fun recognizerIntent(lang: String) = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
    putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
    putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.packageName)
    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
  }

  private fun createRecognizer(): SpeechRecognizer {
    val comp = try { pickRealRecognizer(ctx) } catch (_: Throwable) { null }
    return if (comp != null) SpeechRecognizer.createSpeechRecognizer(ctx, comp) else SpeechRecognizer.createSpeechRecognizer(ctx)
  }

  private fun startSingle(id: Int, lang: String) {
    val r = try {
      createRecognizer()
    } catch (e: Throwable) {
      emit(id, "error", mapOf("code" to -1, "message" to (e.message ?: "tanıyıcı yok")))
      return
    }
    single = r
    r.setRecognitionListener(listener(id, lang))
    emit(id, "lanes", mapOf("langs" to listOf(lang)))
    try {
      r.startListening(recognizerIntent(lang))
    } catch (e: Throwable) {
      emit(id, "error", mapOf("code" to -1, "message" to (e.message ?: "başlatılamadı")))
    }
  }

  // ---------- çok dil ----------

  /** false: çok dilli kip kurulamadı, çağıran tek dile düşer. */
  private fun startMulti(id: Int, langs: List<String>): Boolean {
    val rate = 16_000
    val minBuf = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minBuf <= 0) return false
    val rec = try {
      AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuf, rate))
    } catch (_: Throwable) {
      return false
    }
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      return false
    }
    val built = mutableListOf<Lane>()
    try {
      for (lang in langs) {
        val lane = Lane(lang)
        val pipe = ParcelFileDescriptor.createPipe()
        lane.readEnd = pipe[0]
        lane.out = ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])
        val r = createRecognizer()
        lane.recognizer = r
        r.setRecognitionListener(listener(id, lang))
        val intent = recognizerIntent(lang).apply {
          putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, pipe[0])
          putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
          putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
          putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, rate)
        }
        built += lane
        r.startListening(intent)
      }
    } catch (_: Throwable) {
      built.forEach { closeLane(it) }
      rec.release()
      return false
    }
    lanes = built
    audio = rec
    for (lane in built) {
      lane.writer = Thread {
        try {
          while (true) {
            val chunk = lane.queue.take()
            if (chunk.isEmpty()) break
            lane.out?.write(chunk)
          }
        } catch (_: Throwable) {
          lane.dead = true
        } finally {
          try { lane.out?.close() } catch (_: Throwable) {}
        }
      }.also { it.isDaemon = true; it.start() }
    }
    emit(id, "lanes", mapOf("langs" to langs))
    emit(id, "ready")
    feeding = true
    audioThread = Thread { pump(id, rec, rate) }.also { it.isDaemon = true; it.start() }
    return true
  }

  /** Mikrofonu okur, her tanıyıcıya aynı 20 ms'lik parçaları dağıtır, seviyeyi ve sessizliği ölçer. */
  private fun pump(id: Int, rec: AudioRecord, rate: Int) {
    val frame = rate / 50 // 20 ms
    val shorts = ShortArray(frame)
    val started = System.currentTimeMillis()
    var noiseDb = -60.0
    var heard = false
    var lastVoice = started
    try {
      rec.startRecording()
    } catch (_: Throwable) {
      emit(id, "error", mapOf("code" to -1, "message" to "mikrofon açılamadı"))
      return
    }
    while (feeding && id == session) {
      val n = rec.read(shorts, 0, frame)
      if (n <= 0) break
      val bytes = ByteArray(n * 2)
      var sum = 0.0
      for (i in 0 until n) {
        val s = shorts[i].toInt()
        bytes[i * 2] = (s and 0xFF).toByte()
        bytes[i * 2 + 1] = ((s shr 8) and 0xFF).toByte()
        sum += s.toDouble() * s
      }
      for (lane in lanes) if (!lane.dead) lane.queue.offer(bytes) // doluysa (tanıyıcı okumuyor) parça düşer; diğerleri etkilenmez
      val db = 20 * log10(maxOf(sqrt(sum / n), 1.0) / 32768.0)
      val now = System.currentTimeMillis()
      val threshold = maxOf(-44.0, noiseDb + 9)
      if (db > threshold) {
        heard = true
        lastVoice = now
      } else {
        noiseDb = noiseDb * 0.95 + db * 0.05
      }
      if (now - lastLevelAt >= 70) {
        lastLevelAt = now
        emit(id, "level", mapOf("value" to ((db + 50) / 5).coerceIn(-2.0, 11.0)))
      }
      val silentFor = now - lastVoice
      if ((heard && silentFor > 1_100) || (!heard && now - started > 9_000) || now - started > 45_000) {
        main.post { if (id == session) finishAudio() }
        break
      }
    }
  }

  /** Kaydı bitirir: tanıyıcılara ses sonu (EOF) gider, sonuçlar gelir. */
  private fun finishAudio() {
    if (!feeding && audio == null) return
    val id = session
    feeding = false
    try { audio?.stop() } catch (_: Throwable) {}
    try { audio?.release() } catch (_: Throwable) {}
    audio = null
    for (lane in lanes) lane.queue.offer(ByteArray(0)) // yazıcı iş parçacığı kalanı yazıp boruyu kapatır
    emit(id, "end")
  }

  private fun closeLane(l: Lane) {
    l.queue.clear()
    l.queue.offer(ByteArray(0))
    l.recognizer?.let {
      try { it.cancel() } catch (_: Throwable) {}
      try { it.destroy() } catch (_: Throwable) {}
    }
    l.recognizer = null
    try { l.out?.close() } catch (_: Throwable) {}
    try { l.readEnd?.close() } catch (_: Throwable) {}
  }
}
