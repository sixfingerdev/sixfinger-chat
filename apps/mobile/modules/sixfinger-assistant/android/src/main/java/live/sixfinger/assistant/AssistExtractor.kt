package live.sixfinger.assistant

import android.app.assist.AssistContent
import android.app.assist.AssistStructure
import android.text.InputType
import android.view.View

/** Sistemin verdiği ekran yapısından (AssistStructure) görünen metni okur. Parola alanları ve görünmeyen düğümler atlanır. */
object AssistExtractor {
  private const val MAX_CHARS = 14_000
  private const val MAX_NODES = 4_000

  fun extract(structure: AssistStructure?, content: AssistContent?, ownPackage: String): Map<String, Any?>? {
    if (structure == null) return null
    val pkg = structure.activityComponent?.packageName
    // Kendi penceremiz ya da sistem arayüzü: okunacak bir şey yok.
    if (pkg == null || pkg == ownPackage) return null

    val lines = LinkedHashSet<String>()
    var size = 0
    var nodes = 0
    var truncated = false

    fun walk(n: AssistStructure.ViewNode) {
      if (truncated) return
      if (++nodes > MAX_NODES) { truncated = true; return }
      if (n.visibility != View.VISIBLE) return
      if (n.idPackage == "com.android.systemui") return
      val password = n.inputType and InputType.TYPE_MASK_VARIATION
      val isPassword = password == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
        password == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
        password == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
      if (!isPassword) {
        val t = (n.text?.toString() ?: n.contentDescription?.toString())?.trim()
        if (!t.isNullOrEmpty() && t.length > 1 && lines.add(t)) {
          size += t.length + 1
          if (size > MAX_CHARS) { truncated = true; return }
        }
      }
      for (i in 0 until n.childCount) walk(n.getChildAt(i))
    }

    for (i in 0 until structure.windowNodeCount) {
      val w = structure.getWindowNodeAt(i)
      walk(w.rootViewNode)
    }

    var text = lines.joinToString("\n")
    if (text.length > MAX_CHARS) text = text.substring(0, MAX_CHARS)
    return mapOf(
      "packageName" to pkg,
      "url" to content?.webUri?.toString(),
      "text" to text,
      "truncated" to truncated,
    )
  }
}
