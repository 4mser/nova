package expo.modules.novawidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.graphics.Color
import android.widget.RemoteViews

/** NOVA · Today (4×2): NOVA respirando con la cara del día, su frase, preparación, sueño y el check-in. */
class NovaHoyWidget : AppWidgetProvider() {

  override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
    ids.forEach { pintar(ctx, mgr, it) }
  }

  companion object {
    fun actualizarTodos(ctx: Context) {
      val mgr = AppWidgetManager.getInstance(ctx)
      mgr.getAppWidgetIds(ComponentName(ctx, NovaHoyWidget::class.java)).forEach { pintar(ctx, mgr, it) }
    }

    private fun color(s: String?, porDefecto: String) = try { Color.parseColor(if (s.isNullOrEmpty()) porDefecto else s) } catch (e: Exception) { Color.parseColor(porDefecto) }

    private fun pintar(ctx: Context, mgr: AppWidgetManager, id: Int) {
      val d = Nova.datos(ctx)
      val cara = Nova.cara(d, true)
      val v = RemoteViews(ctx.packageName, ctx.resources.getIdentifier("nova_hoy", "layout", ctx.packageName))
      Nova.cuadros(ctx, v, cara)

      v.setTextViewText(Nova.id(ctx, "cabeza"), "● Nova   Sol ${d.optInt("sol", 214)}")
      v.setTextViewText(Nova.id(ctx, "frase"), d.optString("frase", "Recovered and steady. Good day ahead."))
      v.setTextViewText(Nova.id(ctx, "d1v"), d.optInt("prep", 82).toString())
      v.setTextColor(Nova.id(ctx, "d1v"), color(if (d.optBoolean("atencion")) "#F2B457" else "#F2F5F8", "#F2F5F8"))
      v.setTextViewText(Nova.id(ctx, "d1l"), d.optString("etqPrep", "readiness"))
      v.setTextViewText(Nova.id(ctx, "d2v"), d.optString("sueno", "—"))
      v.setTextViewText(Nova.id(ctx, "d2l"), d.optString("etqSueno", "sleep"))
      v.setTextViewText(Nova.id(ctx, "d3v"), d.optString("ciValor", "0/6"))
      v.setTextViewText(Nova.id(ctx, "d3l"), d.optString("ciEtiqueta", "check-in"))
      v.setTextColor(Nova.id(ctx, "d3v"), color(d.optString("ciColor"), "#A898FF"))

      v.setOnClickPendingIntent(Nova.id(ctx, "raiz"), Nova.abrir(ctx, "", 8))
      v.setOnClickPendingIntent(Nova.id(ctx, "nova"), Nova.abrir(ctx, "nova://nova", 9))
      v.setOnClickPendingIntent(Nova.id(ctx, "d3"), Nova.abrir(ctx, "nova://journal", 10))
      mgr.updateAppWidget(id, v)
    }
  }
}
