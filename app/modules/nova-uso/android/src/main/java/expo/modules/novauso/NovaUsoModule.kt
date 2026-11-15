// Uso del teléfono para NOVA (con permiso explícito del usuario): tiempo en pantalla, desbloqueos,
// apps más usadas y los intervalos en que la pantalla estuvo encendida (para ver el uso de noche).
package expo.modules.novauso

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NovaUsoModule : Module() {
  private val ctx: Context
    get() = appContext.reactContext ?: throw IllegalStateException("Sin contexto de Android")

  // tipos de evento de UsageEvents.Event (como números para no depender del nivel de API al compilar)
  private val RESUMIDA = 1
  private val PAUSADA = 2
  private val PANTALLA_ON = 15
  private val PANTALLA_OFF = 16
  private val DESBLOQUEO = 18

  private fun nombre(pm: PackageManager, paquete: String): String =
    try { pm.getApplicationLabel(pm.getApplicationInfo(paquete, 0)).toString() } catch (e: Exception) { paquete }

  override fun definition() = ModuleDefinition {
    Name("NovaUso")

    Function("tienePermiso") {
      val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      val modo = if (Build.VERSION.SDK_INT >= 29) {
        ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
      } else {
        @Suppress("DEPRECATION")
        ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
      }
      modo == AppOpsManager.MODE_ALLOWED
    }

    Function("abrirAjustes") {
      ctx.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    AsyncFunction("uso") { desde: Double, hasta: Double ->
      val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val eventos = usm.queryEvents(desde.toLong(), hasta.toLong())
      val e = UsageEvents.Event()
      val enPrimerPlano = HashMap<String, Long>()
      val total = HashMap<String, Long>()
      val intervalos = ArrayList<Map<String, Double>>()
      var desbloqueos = 0
      var pantallaMs = 0L
      var inicioPantalla = -1L
      while (eventos.hasNextEvent()) {
        eventos.getNextEvent(e)
        val t = e.timeStamp
        when (e.eventType) {
          RESUMIDA -> enPrimerPlano[e.packageName] = t
          PAUSADA -> enPrimerPlano.remove(e.packageName)?.let { ini -> total[e.packageName] = (total[e.packageName] ?: 0L) + (t - ini) }
          PANTALLA_ON -> inicioPantalla = t
          PANTALLA_OFF -> if (inicioPantalla >= 0) {
            pantallaMs += t - inicioPantalla
            intervalos.add(mapOf("ini" to inicioPantalla.toDouble(), "fin" to t.toDouble()))
            inicioPantalla = -1L
          }
          DESBLOQUEO -> desbloqueos++
        }
      }
      // lo que sigue abierto ahora cuenta hasta el final del rango
      val fin = hasta.toLong()
      enPrimerPlano.forEach { (p, ini) -> total[p] = (total[p] ?: 0L) + (fin - ini) }
      if (inicioPantalla >= 0) {
        pantallaMs += fin - inicioPantalla
        intervalos.add(mapOf("ini" to inicioPantalla.toDouble(), "fin" to fin.toDouble()))
      }
      val pm = ctx.packageManager
      val propio = ctx.packageName
      val apps = total.entries
        .filter { it.key != propio && it.value > 30_000L }
        .sortedByDescending { it.value }
        .take(8)
        .map { mapOf("paquete" to it.key, "nombre" to nombre(pm, it.key), "ms" to it.value.toDouble()) }
      mapOf("pantallaMs" to pantallaMs.toDouble(), "desbloqueos" to desbloqueos, "apps" to apps, "intervalos" to intervalos)
    }
  }
}
