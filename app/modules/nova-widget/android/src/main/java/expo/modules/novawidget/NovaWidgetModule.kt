package expo.modules.novawidget

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** puente desde la app: guarda los datos del día (JSON) y redibuja los widgets nativos de NOVA que haya en la pantalla de inicio */
class NovaWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NovaWidget")

    Function("actualizar") { datos: String ->
      val ctx = appContext.reactContext ?: return@Function
      ctx.getSharedPreferences(Nova.PREFS, 0).edit().putString("datos", datos).apply()
      Nova.actualizarTodos(ctx)
    }
  }
}
