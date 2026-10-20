package live.sixfinger.assistant

import android.content.Intent
import android.os.Bundle
import androidx.core.view.WindowCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

/**
 * Diğer uygulamaların üstünde açılan şeffaf asistan penceresi. İçeriği ana uygulamayla aynı React örneğinde
 * "SixfingerAssistant" adlı kök bileşen çizer (kimlik, sohbet deposu ve API istemcisi paylaşılır).
 */
class AssistantActivity : ReactActivity() {
  companion object {
    const val EXTRA_SOURCE = "sf_source"
    const val EXTRA_VOICE = "sf_voice"
  }

  override fun getMainComponentName(): String = "SixfingerAssistant"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    AssistBridge.closer = { runOnUiThread { finishAndRemoveTask() } }
    begin(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    begin(intent)
  }

  /** Oturum sistemden başladıysa (`assistant`) köprü zaten sıfırlandı ve ekran içeriği gelmiş olabilir: ezme. */
  private fun begin(i: Intent?) {
    val src = i?.getStringExtra(EXTRA_SOURCE)
      ?: if (i?.action == Intent.ACTION_ASSIST) "assist" else "app"
    if (src != "assistant") AssistBridge.begin(src, i?.getBooleanExtra(EXTRA_VOICE, false) == true)
  }

  override fun onDestroy() {
    AssistBridge.closer = null
    super.onDestroy()
  }
}
