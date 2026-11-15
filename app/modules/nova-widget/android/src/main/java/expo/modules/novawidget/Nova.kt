package expo.modules.novawidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import org.json.JSONObject
import java.util.Calendar
import java.util.TimeZone

/**
 * Lo común de los widgets nativos de NOVA. La animación es un bucle de 28 cuadros por cara (renderizados desde NovaOrb
 * con `bucle`: la forma del final empalma con la del inicio y respira), en un ViewFlipper que Android pasa solo.
 * La app deja los datos del día en SharedPreferences (JSON); la cara de noche se decide aquí, aunque la app esté cerrada.
 */
object Nova {
  const val PREFS = "nova_viva"
  const val CUADROS = 28

  fun datos(ctx: Context): JSONObject =
    try { JSONObject(ctx.getSharedPreferences(PREFS, 0).getString("datos", "{}") ?: "{}") } catch (e: Exception) { JSONObject() }

  /** de noche (hora de la nave = UTC) duerme; con el pulso alto se sorprende; si no te recuperaste, piensa */
  fun cara(d: JSONObject, conSorpresa: Boolean): String {
    val h = Calendar.getInstance(TimeZone.getTimeZone("UTC")).get(Calendar.HOUR_OF_DAY)
    return when {
      h >= 22 || h < 6 -> "dormida"
      conSorpresa && d.optBoolean("sorpresa") -> "sorprendida"
      d.optBoolean("atencion") -> "pensativa"
      else -> "feliz"
    }
  }

  /** pone los 28 cuadros de la cara en el ViewFlipper (vistas f00…f27) */
  fun cuadros(ctx: Context, v: RemoteViews, cara: String) {
    val res = ctx.resources
    val pkg = ctx.packageName
    for (k in 0 until CUADROS) {
      val vista = res.getIdentifier("f%02d".format(k), "id", pkg)
      val img = res.getIdentifier("nova_%s_%02d".format(cara, k), "drawable", pkg)
      if (vista != 0 && img != 0) v.setImageViewResource(vista, img)
    }
  }

  /** abre la app en una ruta (nova://…) o, con uri vacía, tal cual se abre desde el ícono */
  fun abrir(ctx: Context, uri: String, codigo: Int): PendingIntent {
    val i = (if (uri.isEmpty()) ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent() else Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(ctx.packageName))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(ctx, codigo, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  fun id(ctx: Context, nombre: String) = ctx.resources.getIdentifier(nombre, "id", ctx.packageName)

  fun actualizarTodos(ctx: Context) {
    NovaVivaWidget.actualizarTodos(ctx)
    NovaHoyWidget.actualizarTodos(ctx)
  }
}
