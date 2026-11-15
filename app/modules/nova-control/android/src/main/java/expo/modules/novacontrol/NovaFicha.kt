// Ficha «NOVA» de los ajustes rápidos: un toque y NOVA te escucha (si el teléfono está bloqueado, pide desbloquear).
package expo.modules.novacontrol

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

class NovaFicha : TileService() {
  override fun onStartListening() {
    val f = qsTile ?: return
    f.state = Tile.STATE_INACTIVE
    f.label = "NOVA"
    if (Build.VERSION.SDK_INT >= 29) f.subtitle = "Escúchame"
    f.updateTile()
  }

  override fun onClick() {
    val i = Intent(this, NovaAsistenteActivity::class.java)
      .setAction(NovaControlModule.ESCUCHAR)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val abrir = Runnable {
      if (Build.VERSION.SDK_INT >= 34) {
        startActivityAndCollapse(PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
      } else {
        @Suppress("DEPRECATION")
        startActivityAndCollapse(i)
      }
    }
    if (isLocked) unlockAndRun(abrir) else abrir.run()
  }
}
