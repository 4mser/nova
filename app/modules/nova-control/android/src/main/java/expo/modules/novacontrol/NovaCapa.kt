// La capa de NOVA como ventana propia sobre cualquier app (servicio en primer plano con micrófono).
// Hospeda la raíz de React «NovaAsistente» (src/asistente/Asistente.tsx) en una ventana del sistema: por eso sigue
// viva, escuchando y hablando, aunque NOVA te deje en otra app. Dos tamaños de la MISMA ventana (la sesión de voz
// no se corta nunca):
//   · completa: toda la pantalla, el velo y NOVA con su órbita, sobre lo que estabas usando
//   · burbuja: el orbe chico (84 dp) que no tapa la app; se arrastra hasta cualquier borde y tocarlo la agranda. Cuando
//     NOVA dice o hace algo, la ventana crece hacia el centro de la pantalla para mostrar una píldora al lado del orbe,
//     y el orbe no se mueve de su sitio (la ventana se ancla al orbe, no al revés).
// La actividad transparente (NovaAsistenteActivity) queda detrás como ancla: le da a Expo el contexto de Android.
//
// Nunca pegada (0.9.3): la ventana se cierra sin depender de JS. Mantener presionada la burbuja la cierra, soltarla
// abajo del todo también, y con la capa completa el botón atrás la cierra. Además JS late cada 2 s: si deja de latir
// (React pausado, un error), a los 6 s los toques pasan a la app de abajo y a los 15 s la ventana se cierra sola.
package expo.modules.novacontrol

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import com.facebook.react.ReactApplication
import com.facebook.react.interfaces.fabric.ReactSurface
import kotlin.math.hypot

class NovaCapa : Service() {
  companion object {
    const val ABRIR = "solutions.bn.nova.capa.ABRIR"
    const val CERRAR = "solutions.bn.nova.capa.CERRAR"
    private const val CANAL = "nova_capa"
    private const val AVISO = 7301
    /** el orbe de la burbuja (dp): la ventana mínima */
    const val ORBE_DP = 84f
    @Volatile var instancia: NovaCapa? = null
    /** completa · mini · cerrada */
    @Volatile var modo = "cerrada"
    /** en burbuja: de qué lado de la pantalla está el orbe (la píldora sale hacia el otro) */
    @Volatile var lado = "der"
    /** el servicio no pudo quedar en primer plano: la actividad hospeda la capa como antes */
    @Volatile var fallo = false
    var modoCambio: ((String, String) -> Unit)? = null
    /** tamaño de la burbuja (dp); la capa lo ajusta cuando muestra o esconde su píldora */
    @Volatile var miniAnchoDp = ORBE_DP
    @Volatile var miniAltoDp = ORBE_DP
    /** último latido de JS (uptime ms): la ventana se vigila sola con esto */
    @Volatile var ultimoLatido = 0L
    fun latido() { ultimoLatido = SystemClock.uptimeMillis(); instancia?.despierta() }

    fun puedeSobreponer(ctx: Context) = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx)
    fun abrir(ctx: Context) {
      fallo = false
      val i = Intent(ctx, NovaCapa::class.java).setAction(ABRIR)
      if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
    }
  }

  private val wm by lazy { getSystemService(Context.WINDOW_SERVICE) as WindowManager }
  private val principal = Handler(Looper.getMainLooper())
  private var superficie: ReactSurface? = null
  private var caja: Contenedor? = null
  private var params: WindowManager.LayoutParams? = null
  // el ORBE (no la ventana): su esquina superior izquierda en px; la ventana se arma alrededor
  private var orbeX = -1
  private var orbeY = -1
  private val orbePx get() = dp(ORBE_DP)
  private val margen get() = dp(8f)
  // la vigilancia: cuándo se creó la ventana, si está dejando pasar los toques y si ya se está cerrando
  private var creadaEn = 0L
  private var pasando = false
  private var cerrando = false
  private val vigia = object : Runnable { override fun run() { vigilar(); principal.postDelayed(this, 2000) } }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instancia = this
    if (!primerPlano()) { fallo = true; stopSelf() }
  }

  /** el aviso fijo que exige Android para escuchar fuera de la app (silencioso, con «Cerrar») */
  private fun primerPlano(): Boolean {
    val nm = getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(CANAL, "NOVA te escucha", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false); setSound(null, null); enableVibration(false) })
    val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    val cerrar = PendingIntent.getService(this, 1, Intent(this, NovaCapa::class.java).setAction(CERRAR), flags)
    val abrir = PendingIntent.getActivity(this, 2, Intent(this, NovaAsistenteActivity::class.java).setAction(NovaControlModule.ESCUCHAR).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags)
    val n = Notification.Builder(this, CANAL)
      .setSmallIcon(R.drawable.nova_ficha)
      .setContentTitle("NOVA sigue contigo")
      .setContentText("Toca para abrirla. «Cerrar» la apaga del todo.")
      .setContentIntent(abrir)
      .addAction(Notification.Action.Builder(null as Icon?, "Cerrar", cerrar).build())
      .setOngoing(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .build()
    val conMic = checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    return try {
      if (Build.VERSION.SDK_INT >= 29) {
        val tipo = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK or (if (conMic) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0)
        startForeground(AVISO, n, tipo)
      } else startForeground(AVISO, n)
      true
    } catch (e: Exception) {
      // sin micrófono como tipo (o sin permiso para partir): al menos la ventana
      try { if (Build.VERSION.SDK_INT >= 29) startForeground(AVISO, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK) else startForeground(AVISO, n); true } catch (e2: Exception) { false }
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == CERRAR) cerrar() else abrir()
    return START_NOT_STICKY
  }

  private fun abrir() {
    if (fallo) return
    if (caja == null && !crear()) { fallo = true; stopSelf(); return }
    completa()
  }

  /** la raíz de React dentro de la ventana */
  private fun crear(): Boolean {
    val host = (application as? ReactApplication)?.reactHost ?: return false
    val d = resources.displayMetrics.density
    val props = Bundle().apply {
      putString("modoCapa", "ventana")
      putDouble("insetTop", (altoRecurso("status_bar_height") / d).toDouble())
      putDouble("insetBottom", (altoRecurso("navigation_bar_height") / d).toDouble())
    }
    val s = try { host.createSurface(this, "NovaAsistente", props) } catch (e: Exception) { return false }
    val v = s.view ?: return false
    val c = Contenedor(this)
    c.addView(v, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    val p = paramsCompleta()
    try { wm.addView(c, p) } catch (e: Exception) { return false }
    superficie = s; caja = c; params = p
    try { s.start() } catch (e: Exception) { try { wm.removeView(c) } catch (e2: Exception) {}; superficie = null; caja = null; return false }
    // desde aquí la ventana se vigila sola
    creadaEn = SystemClock.uptimeMillis(); ultimoLatido = 0L; pasando = false; cerrando = false
    principal.removeCallbacks(vigia); principal.postDelayed(vigia, 2000)
    return true
  }

  private fun altoRecurso(nombre: String): Float {
    val id = resources.getIdentifier(nombre, "dimen", "android")
    return if (id > 0) resources.getDimensionPixelSize(id).toFloat() else 0f
  }
  private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt()
  private val tipoVentana = if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

  /** la completa tiene foco: así recibe el botón atrás (que la cierra) */
  private fun paramsCompleta() = WindowManager.LayoutParams(
    WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT, tipoVentana,
    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
    PixelFormat.TRANSLUCENT,
  ).apply {
    gravity = Gravity.TOP or Gravity.START; x = 0; y = 0
    softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
    if (Build.VERSION.SDK_INT >= 28) layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    if (pasando) flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
  }
  private fun paramsMini(w: Int, h: Int, x: Int, y: Int) = WindowManager.LayoutParams(
    w, h, tipoVentana,
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
    PixelFormat.TRANSLUCENT,
  ).apply { gravity = Gravity.TOP or Gravity.START; this.x = x; this.y = y; if (pasando) flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE }

  // ── la vigilancia: si JS deja de latir, los toques pasan a la app de abajo y después la ventana se cierra ──
  private fun edadLatido(): Long = SystemClock.uptimeMillis() - (if (ultimoLatido > 0L) ultimoLatido else creadaEn)
  /** JS no responde: hace más de 3 s que no late (o nunca latió y la ventana lleva más de 8 s) */
  private fun jsLento(): Boolean = if (ultimoLatido > 0L) edadLatido() > 3000 else edadLatido() > 8000
  private fun vigilar() {
    if (caja == null || modo == "cerrada" || cerrando) return
    val edad = edadLatido()
    if (edad > (if (ultimoLatido > 0L) 15000 else 25000)) { cerrar(); return }
    if (edad > 6000 && !pasando) pasar(true)
  }
  private fun pasar(v: Boolean) {
    val c = caja ?: return; val p = params ?: return
    pasando = v
    p.flags = if (v) p.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE else p.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
    try { wm.updateViewLayout(c, p) } catch (e: Exception) {}
  }
  /** volvió a latir: los toques vuelven a la capa */
  fun despierta() { if (pasando) principal.post { if (pasando) pasar(false) } }

  /** el orbe dentro de la pantalla (deja un margen chico, pero llega a cualquier borde) */
  private fun acotarOrbe() {
    val m = resources.displayMetrics
    orbeX = orbeX.coerceIn(margen, maxOf(margen, m.widthPixels - orbePx - margen))
    orbeY = orbeY.coerceIn(margen, maxOf(margen, m.heightPixels - orbePx - margen))
  }
  private fun ladoDe(): String = if (orbeX + orbePx / 2 < resources.displayMetrics.widthPixels / 2) "izq" else "der"

  /** a burbuja (o cambia su tamaño si ya lo es): la ventana se arma alrededor del orbe, que no se mueve */
  fun mini() { principal.post { miniAhora() } }
  private fun miniAhora() {
    val c = caja ?: return
    val m = resources.displayMetrics
    val w = maxOf(orbePx, dp(miniAnchoDp)); val h = maxOf(orbePx, dp(miniAltoDp))
    if (orbeX < 0) { orbeX = m.widthPixels - orbePx - margen; orbeY = altoRecurso("status_bar_height").toInt() + dp(8f) }
    acotarOrbe()
    lado = ladoDe()
    // pegada a la derecha, la ventana crece hacia la izquierda; a la izquierda, hacia la derecha
    val x = if (lado == "der") orbeX + orbePx - w else orbeX
    val p = paramsMini(w, h, x.coerceIn(0, maxOf(0, m.widthPixels - w)), orbeY)
    params = p
    try { wm.updateViewLayout(c, p) } catch (e: Exception) {}
    c.interceptar = true
    val cambio = modo != "mini"
    modo = "mini"
    if (cambio) modoCambio?.invoke("mini", lado)
  }

  fun completa() {
    principal.post {
      val c = caja ?: return@post
      val p = paramsCompleta(); params = p
      try { wm.updateViewLayout(c, p) } catch (e: Exception) {}
      c.interceptar = false
      if (modo != "completa") { modo = "completa"; modoCambio?.invoke("completa", lado) }
    }
  }

  /** esconde (o vuelve a mostrar) la ventana un instante: para fotografiar la pantalla sin NOVA encima */
  fun ocultar(v: Boolean) { caja?.visibility = if (v) View.INVISIBLE else View.VISIBLE }

  /** desde la burbuja: agrandar y traer la actividad ancla al frente (Expo necesita una actividad para cámara y permisos) */
  fun agrandar() {
    completa()
    try {
      startActivity(Intent(this, NovaAsistenteActivity::class.java).setAction(NovaControlModule.ESCUCHAR).putExtra("expandir", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
    } catch (e: Exception) {}
  }

  fun cerrar() {
    principal.post {
      if (cerrando && caja == null) return@post
      cerrando = true
      principal.removeCallbacks(vigia)
      if (modo != "cerrada") { modo = "cerrada"; modoCambio?.invoke("cerrada", lado) }
      caja?.let { try { wm.removeView(it) } catch (e: Exception) {} }
      caja = null
      superficie?.let { try { it.stop() } catch (e: Exception) {} }
      superficie = null
      NovaAsistenteActivity.instancia?.let { if (!it.isFinishing) it.finish() }
      try { stopForeground(STOP_FOREGROUND_REMOVE) } catch (e: Exception) {}
      stopSelf()
    }
  }

  override fun onDestroy() {
    instancia = null
    principal.removeCallbacks(vigia)
    if (modo != "cerrada") { modo = "cerrada"; modoCambio?.invoke("cerrada", lado) }
    caja?.let { try { wm.removeView(it) } catch (e: Exception) {} }
    caja = null
    superficie?.let { try { it.stop() } catch (e: Exception) {} }
    superficie = null
    super.onDestroy()
  }

  /** la caja de la ventana: en burbuja se queda con todos los toques (arrastrar el orbe, tocar para agrandar, mantener
      presionado para cerrar); en completa, el botón atrás la cierra y, si JS no responde, también un toque */
  inner class Contenedor(ctx: Context) : FrameLayout(ctx) {
    var interceptar = false
    private var x0 = 0f; private var y0 = 0f; private var ox = 0; private var oy = 0; private var movio = false; private var largoHecho = false
    // mantener presionada la burbuja (0,7 s sin moverla) la cierra: un gesto que no depende de JS
    private val largo = Runnable { largoHecho = true; cerrarPorGesto() }
    private fun cerrarPorGesto() { try { performHapticFeedback(HapticFeedbackConstants.LONG_PRESS) } catch (e: Exception) {}; cerrar() }

    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
      if (e.keyCode == KeyEvent.KEYCODE_BACK) { if (e.action == KeyEvent.ACTION_UP) cerrar(); return true }
      return super.dispatchKeyEvent(e)
    }
    override fun onInterceptTouchEvent(e: MotionEvent): Boolean = interceptar || jsLento()
    override fun onTouchEvent(e: MotionEvent): Boolean {
      if (!interceptar) {
        // completa con JS congelado: un toque la cierra (y a los 6 s los toques ya pasan a la app de abajo)
        if (jsLento()) { if (e.actionMasked == MotionEvent.ACTION_UP) cerrar(); return true }
        return super.onTouchEvent(e)
      }
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          x0 = e.rawX; y0 = e.rawY; ox = orbeX; oy = orbeY; movio = false; largoHecho = false
          principal.removeCallbacks(largo); principal.postDelayed(largo, 700)
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = e.rawX - x0; val dy = e.rawY - y0
          if (movio || hypot(dx.toDouble(), dy.toDouble()) > dp(6f)) {
            if (!movio) principal.removeCallbacks(largo)
            movio = true
            orbeX = (ox + dx).toInt(); orbeY = (oy + dy).toInt()
            miniAhora()
          }
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          principal.removeCallbacks(largo)
          if (largoHecho) return true
          val m = resources.displayMetrics
          if (!movio && e.actionMasked == MotionEvent.ACTION_UP) agrandar()
          // soltarla abajo del todo también la cierra (como se saca cualquier ventana flotante)
          else if (movio && orbeY + orbePx / 2 > m.heightPixels * 0.9) cerrarPorGesto()
          else {
            // se pega al borde más cercano; si cambió de lado, la píldora cambia de lado también
            val antes = lado
            orbeX = if (orbeX + orbePx / 2 < m.widthPixels / 2) margen else m.widthPixels - orbePx - margen
            miniAhora()
            if (lado != antes) modoCambio?.invoke("mini", lado)
          }
        }
      }
      return true
    }
  }
}
