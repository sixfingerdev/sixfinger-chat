package live.sixfinger.assistant

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream

/** Görsel hazırlama: uzun kenarı küçült, EXIF yönünü uygula, JPEG'e sıkıştır (sunucu sınırının altında kalana dek kaliteyi düşür). */
object ImageTools {
  class Result(val path: String, val base64: String, val width: Int, val height: Int)

  private fun open(ctx: Context, uri: String): InputStream {
    val u = Uri.parse(uri)
    return if (u.scheme == null || u.scheme == "file") File(u.path ?: uri).inputStream() else ctx.contentResolver.openInputStream(u)!!
  }

  private fun readBounds(ctx: Context, uri: String): Pair<Int, Int> {
    val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    open(ctx, uri).use { BitmapFactory.decodeStream(it, null, o) }
    return o.outWidth to o.outHeight
  }

  private fun exifRotation(ctx: Context, uri: String): Int = try {
    open(ctx, uri).use {
      when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90
        ExifInterface.ORIENTATION_ROTATE_180 -> 180
        ExifInterface.ORIENTATION_ROTATE_270 -> 270
        else -> 0
      }
    }
  } catch (_: Throwable) { 0 }

  fun compress(ctx: Context, uri: String, maxSide: Int, maxBytes: Int): Result {
    val (w, h) = readBounds(ctx, uri)
    require(w > 0 && h > 0) { "görsel okunamadı" }
    var sample = 1
    while (maxOf(w, h) / (sample * 2) >= maxSide) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    var bmp = open(ctx, uri).use { BitmapFactory.decodeStream(it, null, opts) } ?: throw IllegalStateException("görsel çözülemedi")
    val rot = exifRotation(ctx, uri)
    val scale = minOf(1f, maxSide.toFloat() / maxOf(bmp.width, bmp.height))
    if (rot != 0 || scale < 1f) {
      val m = Matrix().apply { if (rot != 0) postRotate(rot.toFloat()); if (scale < 1f) postScale(scale, scale) }
      bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    }
    return encode(ctx, bmp, maxBytes)
  }

  /** Bitmap'i JPEG'e çevirir; saydam alanlar beyaza basılır. */
  fun encode(ctx: Context, src: Bitmap, maxBytes: Int): Result {
    val flat = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
    android.graphics.Canvas(flat).apply { drawColor(android.graphics.Color.WHITE); drawBitmap(src, 0f, 0f, null) }
    var bytes = ByteArray(0)
    for (q in intArrayOf(82, 70, 55, 40)) {
      val out = ByteArrayOutputStream()
      flat.compress(Bitmap.CompressFormat.JPEG, q, out)
      bytes = out.toByteArray()
      if (bytes.size <= maxBytes) break
    }
    check(bytes.size <= maxBytes) { "görsel çok büyük" }
    val f = File(ctx.cacheDir, "sf-img-${System.currentTimeMillis()}-${(Math.random() * 1e6).toInt()}.jpg")
    f.writeBytes(bytes)
    return Result("file://${f.absolutePath}", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP), flat.width, flat.height)
  }
}
