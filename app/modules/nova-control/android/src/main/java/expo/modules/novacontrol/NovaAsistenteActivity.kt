// La actividad del asistente: la que abre el botón del asistente del teléfono, la ficha de ajustes rápidos, el atajo
// «Escúchame» o el botón de los audífonos. Transparente, encima de lo que estés usando.
//
// Dónde vive la capa (src/asistente/Asistente.tsx, raíz de React «NovaAsistente»):
//  · si NOVA puede «mostrarse sobre otras apps» y el teléfono no está bloqueado, la capa va en una ventana propia
//    (NovaCapa, servicio en primer plano) y esta actividad queda detrás como ancla, sin dibujar nada: así, cuando NOVA
//    te deja en otra app, la ventana se encoge a una burbuja que sigue escuchando y actuando sobre esa app.
//  · si no (sin ese permiso, o con el teléfono bloqueado), esta misma actividad hospeda la capa como siempre, y se
//    cierra al pasar a otra app.
package expo.modules.novacontrol

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.view.WindowCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultReactActivityDelegate

class NovaAsistenteActivity : ReactActivity() {
  companion object {
    @Volatile var instancia: NovaAsistenteActivity? = null
  }

  /** true: la capa está en la ventana del servicio; false: la hospeda esta actividad */
  @Volatile var ventana = false
    private set

  /** con nombre null no carga nada (la ventana del servicio lo hace); `cargar()` hospeda la capa acá */
  inner class Delegado : DefaultReactActivityDelegate(this@NovaAsistenteActivity, "NovaAsistente", true) {
    override fun getMainComponentName(): String? = if (ventana) null else "NovaAsistente"
    fun cargar() = loadApp("NovaAsistente")
    // en burbuja, la actividad queda detrás de la otra app pero React sigue «en primer plano»: si se pausara,
    // Android congela los timers de JS y NOVA deja de cerrar sus turnos (quedaba muda y sorda en la burbuja)
    override fun onPause() { if (ventana && NovaCapa.modo == "mini") return; super.onPause() }
  }
  // sin inicializador: se asigna desde createReactActivityDelegate() durante el constructor de ReactActivity
  private lateinit var delegado: Delegado

  override fun getMainComponentName(): String? = if (ventana) null else "NovaAsistente"
  override fun createReactActivityDelegate(): ReactActivityDelegate = Delegado().also { delegado = it }

  private fun bloqueado(): Boolean = try { (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked } catch (e: Exception) { false }

  override fun onCreate(savedInstanceState: Bundle?) {
    ventana = NovaCapa.puedeSobreponer(this) && !bloqueado()
    // sin estado guardado: cada invocación parte de cero
    super.onCreate(null)
    instancia = this
    WindowCompat.setDecorFitsSystemWindows(window, false)
    // con el teléfono bloqueado también: música, alarmas, recordatorios, preguntas (lo que abra otra app pedirá desbloquear)
    if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
    if (ventana) {
      try { NovaCapa.abrir(this) } catch (e: Exception) { aActividad() }
    }
  }

  /** el servicio no pudo: la capa se hospeda acá, como antes */
  private fun aActividad() {
    if (!ventana) return
    ventana = false
    NovaCapa.fallo = false
    try { if (::delegado.isInitialized) delegado.cargar() } catch (e: Exception) {}
  }

  override fun onResume() {
    super.onResume()
    if (ventana && NovaCapa.fallo) aActividad()
  }

  // volver a invocarla mientras está abierta (otra vez el botón): NOVA vuelve a escuchar; si estaba en burbuja, crece.
  // Con «expandir» viene de la burbuja misma: solo trae la actividad al frente, sin cortar a NOVA.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    if (intent.getBooleanExtra("expandir", false)) return
    if (ventana && NovaCapa.modo == "mini") NovaCapa.instancia?.completa()
    NovaControlModule.invocada?.invoke()
  }

  // al pasar a otra app: en burbuja (NOVA te dejó ahí) sigue viva; si te fuiste tú, se cierra todo. Con un respiro:
  // un diálogo de permiso o el Reloj poniendo una alarma sin interfaz también la detienen un instante.
  private val principal = Handler(Looper.getMainLooper())
  private val cierre = Runnable { if (!isFinishing && NovaCapa.modo != "mini") { if (ventana) NovaCapa.instancia?.cerrar() ?: finish() else finish() } }
  override fun onStart() { super.onStart(); principal.removeCallbacks(cierre) }
  override fun onStop() {
    super.onStop()
    if (isFinishing) return
    if (NovaCapa.modo == "mini") return
    principal.postDelayed(cierre, 600)
  }

  override fun onDestroy() {
    super.onDestroy()
    principal.removeCallbacks(cierre)
    if (instancia === this) instancia = null
  }
}
