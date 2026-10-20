package live.sixfinger.assistant

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.speech.RecognitionService

/** Cihazdaki gerçek konuşma tanıma servisi (tercihen Google); kendimizi hariç tutarız (asistan seçilince varsayılan tanıyıcı biz olabiliriz). */
fun pickRealRecognizer(ctx: Context): ComponentName? {
  val services = ctx.packageManager.queryIntentServices(Intent(RecognitionService.SERVICE_INTERFACE), 0)
    .mapNotNull { it.serviceInfo }
    .filter { it.packageName != ctx.packageName }
  val chosen = services.firstOrNull { it.packageName == "com.google.android.googlequicksearchbox" }
    ?: services.firstOrNull { it.packageName == "com.google.android.tts" }
    ?: services.firstOrNull()
    ?: return null
  return ComponentName(chosen.packageName, chosen.name)
}
