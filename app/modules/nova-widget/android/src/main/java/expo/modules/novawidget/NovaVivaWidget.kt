package expo.modules.novawidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Bundle
import android.widget.RemoteViews

/** NOVA (2×2): NOVA respirando en su órbita; el arco es la preparación. Al tocarla, le hablas. */
class NovaVivaWidget : AppWidgetProvider() {

  override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
    ids.forEach { pintar(ctx, mgr, it) }
  }

  override fun onAppWidgetOptionsChanged(ctx: Context, mgr: AppWidgetManager, id: Int, opciones: Bundle) {
    pintar(ctx, mgr, id)
  }

  companion object {
    fun actualizarTodos(ctx: Context) {
      val mgr = AppWidgetManager.getInstance(ctx)
      mgr.getAppWidgetIds(ComponentName(ctx, NovaVivaWidget::class.java)).forEach { pintar(ctx, mgr, it) }
    }

    private fun pintar(ctx: Context, mgr: AppWidgetManager, id: Int) {
      val d = Nova.datos(ctx)
      val prep = d.optInt("prep", 82)
      val atencion = d.optBoolean("atencion")
      val cara = Nova.cara(d, false)
      val res = ctx.resources
      val v = RemoteViews(ctx.packageName, res.getIdentifier("nova_viva", "layout", ctx.packageName))
      Nova.cuadros(ctx, v, cara)

      // arco de preparación, del mismo tamaño que el anillo (radio 0.33 del lado)
      val o = mgr.getAppWidgetOptions(id)
      val dp = res.displayMetrics.density
      val lado = ((minOf(o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 170), o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 170)) * dp).toInt()).coerceIn(200, 720)
      v.setImageViewBitmap(Nova.id(ctx, "arco"), arco(lado, prep, atencion, dp))

      val prepId = Nova.id(ctx, "prep")
      v.setTextViewText(prepId, prep.toString())
      v.setTextColor(prepId, Color.parseColor(if (atencion) "#F2B457" else "#8FE6F5"))
      // los textos llegan de la app en su idioma (si aún no los mandó, en inglés)
      v.setTextViewText(Nova.id(ctx, "frase"), when (cara) {
        "dormida" -> d.optString("vivaDormida", "Resting. Sleep well.")
        "pensativa" -> d.optString("vivaPensativa", "Go easier today")
        else -> d.optString("vivaFeliz", "Tap to talk")
      })
      v.setOnClickPendingIntent(Nova.id(ctx, "raiz"), Nova.abrir(ctx, "nova://nova", 7))
      mgr.updateAppWidget(id, v)
    }

    private fun arco(s: Int, prep: Int, atencion: Boolean, dp: Float): Bitmap {
      val bmp = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888)
      val cv = Canvas(bmp)
      val c = s / 2f
      val r = s * 0.33f
      val col = Color.parseColor(if (atencion) "#F2B457" else "#8FE6F5")
      val p = prep.coerceIn(2, 100) / 100f
      val trazo = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2.6f * dp; strokeCap = Paint.Cap.ROUND; color = col }
      cv.drawArc(RectF(c - r, c - r, c + r, c + r), -90f, 360f * p, false, trazo)
      val a = Math.toRadians(-90.0 + 360.0 * p)
      val ex = c + (Math.cos(a) * r).toFloat()
      val ey = c + (Math.sin(a) * r).toFloat()
      val relleno = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = col }
      relleno.alpha = 56
      cv.drawCircle(ex, ey, 9f * dp, relleno)
      relleno.alpha = 255
      cv.drawCircle(ex, ey, 3.6f * dp, relleno)
      return bmp
    }
  }
}
