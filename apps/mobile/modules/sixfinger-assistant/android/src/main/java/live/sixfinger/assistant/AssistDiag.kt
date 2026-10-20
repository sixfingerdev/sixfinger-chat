package live.sixfinger.assistant

import android.content.Context
import android.os.Build

/** Asistan olaylarının kalıcı sayaçları: sistem bizi gerçekten çağırıyor mu? (Ayarlar → Asistan → Tanılama). */
object AssistDiag {
  private const val PREFS = "sf_assist_diag"

  fun mark(ctx: Context, key: String, error: String? = null) {
    val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val e = p.edit()
    e.putLong("$key.at", System.currentTimeMillis())
    e.putInt("$key.n", p.getInt("$key.n", 0) + 1)
    if (error != null) e.putString("$key.err", error)
    e.apply()
  }

  fun snapshot(ctx: Context): Map<String, Any?> {
    val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val out = LinkedHashMap<String, Any?>()
    for (k in listOf("ready", "sessionNew", "show", "assist", "startActivity", "startActivityError", "hide", "activity", "keyguard", "recognizer")) {
      val n = p.getInt("$k.n", 0)
      out[k] = if (n == 0) null else mapOf("n" to n, "at" to p.getLong("$k.at", 0), "err" to p.getString("$k.err", null))
    }
    out["device"] = "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"
    return out
  }
}
