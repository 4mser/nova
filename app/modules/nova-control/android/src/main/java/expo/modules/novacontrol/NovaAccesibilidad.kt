// NOVA ve y usa las apps por ti (Android, servicio de accesibilidad; lo enciendes en Ajustes → Accesibilidad → NOVA).
// Con él NOVA sabe qué app está en pantalla, lee lo que hay (textos, botones, campos, listas) y actúa: toca, escribe,
// desplaza, vuelve atrás. Así puede «abrir el último correo» en Gmail o «buscar X» en cualquier app mientras sigue
// como burbuja encima. Nada de lo que lee sale del teléfono salvo lo que NOVA necesita para responderte en ese momento
// (va al puente de voz como texto, igual que lo que le dices), y no se guarda.
package expo.modules.novacontrol

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class NovaAccesibilidad : AccessibilityService() {
  companion object {
    @Volatile var instancia: NovaAccesibilidad? = null
    /** la app que está en pantalla (paquete) y cuándo cambió por última vez algo en ella */
    @Volatile var frente: String? = null
    @Volatile var ultimoCambio = 0L
    /** avisa al módulo cuando cambia la app en primer plano */
    var ventanaCambio: ((String) -> Unit)? = null
    val activa: Boolean get() = instancia != null

    private const val MAX_ELEMENTOS = 70
    private const val MAX_TEXTO = 90
    private const val MAX_LECTURA = 3200
  }

  /** los nodos de la última foto de pantalla, por id (el modelo toca y escribe por id) */
  private var foto: ArrayList<AccessibilityNodeInfo> = ArrayList()
  private var fotoPaquete: String? = null

  override fun onServiceConnected() { instancia = this }
  override fun onInterrupt() {}
  override fun onDestroy() { instancia = null; super.onDestroy() }
  override fun onUnbind(intent: android.content.Intent?): Boolean { instancia = null; return super.onUnbind(intent) }

  override fun onAccessibilityEvent(e: AccessibilityEvent) {
    val pkg = e.packageName?.toString() ?: return
    ultimoCambio = SystemClock.uptimeMillis()
    if (e.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && pkg != packageName && !pkg.startsWith("com.android.systemui")) {
      if (pkg != frente) { frente = pkg; ventanaCambio?.invoke(pkg) }
    }
  }

  // ── leer ──
  private fun raiz(): AccessibilityNodeInfo? = try { rootInActiveWindow } catch (e: Exception) { null }

  /** espera a que la pantalla se quede quieta (nada cambió en `quieto` ms) hasta `max` ms: justo después de abrir una
      app o tocar algo, la vista aún se está armando */
  fun esperarQuieta(quieto: Long = 350, max: Long = 1500) {
    val t0 = SystemClock.uptimeMillis()
    while (SystemClock.uptimeMillis() - t0 < max) {
      if (SystemClock.uptimeMillis() - ultimoCambio >= quieto) return
      try { Thread.sleep(60) } catch (e: InterruptedException) { return }
    }
  }

  private fun limpio(s: CharSequence?): String = s?.toString()?.replace(Regex("\\s+"), " ")?.trim() ?: ""
  private fun corto(s: String, n: Int = MAX_TEXTO) = if (s.length <= n) s else s.substring(0, n - 1) + "…"

  private fun rol(n: AccessibilityNodeInfo): String {
    val c = n.className?.toString() ?: ""
    return when {
      n.isEditable || c.endsWith("EditText") -> "campo"
      c.endsWith("Switch") || c.endsWith("ToggleButton") -> "interruptor"
      c.endsWith("CheckBox") || c.endsWith("RadioButton") -> "casilla"
      c.endsWith("Button") || c.endsWith("ImageButton") -> "botón"
      c.endsWith("Tab") -> "pestaña"
      n.isScrollable || c.endsWith("RecyclerView") || c.endsWith("ListView") || c.endsWith("ScrollView") || c.endsWith("ViewPager") -> "lista"
      c.endsWith("ImageView") -> "imagen"
      c.endsWith("TextView") -> "texto"
      n.isClickable -> "elemento"
      else -> "grupo"
    }
  }

  /** el texto propio de un nodo: lo que dice o su descripción (para íconos) */
  private fun etiqueta(n: AccessibilityNodeInfo): String {
    val t = limpio(n.text); val d = limpio(n.contentDescription)
    return when {
      t.isNotEmpty() && d.isNotEmpty() && !d.contains(t, true) && !t.contains(d, true) -> "$t · $d"
      t.isNotEmpty() -> t
      else -> d
    }
  }

  /** los textos de todo lo que cuelga de un nodo (para rotular una fila clicable con lo que contiene) */
  private fun textosDentro(n: AccessibilityNodeInfo, acc: ArrayList<String>, prof: Int) {
    if (prof > 6 || acc.size > 12) return
    for (i in 0 until n.childCount) {
      val h = n.getChild(i) ?: continue
      try {
        if (!h.isVisibleToUser) continue
        val e = etiqueta(h)
        if (e.isNotEmpty() && (h.isClickable || !acc.contains(e))) { if (!h.isClickable) acc.add(e) }
        if (!h.isClickable) textosDentro(h, acc, prof + 1)
      } finally { if (Build.VERSION.SDK_INT < 33) try { h.recycle() } catch (e: Exception) {} }
    }
  }

  private data class Elemento(val id: Int, val rol: String, val texto: String, val clic: Boolean, val edita: Boolean, val lista: Boolean, val marcado: Boolean?, val y: Int)

  /** una foto compacta de lo que hay en pantalla: cada elemento con un id para tocarlo o escribirle */
  @Synchronized fun pantalla(esperar: Boolean): Map<String, Any?> {
    if (esperar) esperarQuieta()
    val r = raiz() ?: return mapOf("ok" to false, "motivo" to "no screen content available right now")
    val nuevos = ArrayList<AccessibilityNodeInfo>()
    val salida = ArrayList<Elemento>()
    var mas = false
    val pantallaAlto = resources.displayMetrics.heightPixels
    fun recorrer(n: AccessibilityNodeInfo, prof: Int) {
      if (salida.size >= MAX_ELEMENTOS) { mas = true; return }
      if (prof > 40) return
      if (!n.isVisibleToUser) return
      val b = Rect(); n.getBoundsInScreen(b)
      if (b.isEmpty || b.bottom < 0 || b.top > pantallaAlto) return
      val propio = etiqueta(n)
      val accionable = n.isClickable || n.isEditable || n.isCheckable || n.isScrollable
      if (accionable) {
        // una fila o botón: su texto es lo que contiene
        val dentro = ArrayList<String>()
        if (propio.isEmpty() || n.isClickable) textosDentro(n, dentro, 0)
        val texto = corto(listOf(propio).filter { it.isNotEmpty() }.plus(dentro.filter { it != propio }).distinct().joinToString(" · "))
        if (texto.isNotEmpty() || n.isEditable || n.isScrollable) {
          val id = nuevos.size
          nuevos.add(n)
          salida.add(Elemento(id, rol(n), texto, n.isClickable, n.isEditable, n.isScrollable, if (n.isCheckable) n.isChecked else null, (b.centerY() / resources.displayMetrics.density).toInt()))
        }
        // dentro de algo clicable solo interesan los hijos que a su vez se tocan (botones dentro de una fila)
        for (i in 0 until n.childCount) { val h = n.getChild(i) ?: continue; if (tieneAccionable(h, 0)) recorrer(h, prof + 1) }
        return
      }
      if (propio.isNotEmpty() && n.childCount == 0) {
        val id = nuevos.size
        nuevos.add(n)
        salida.add(Elemento(id, rol(n), corto(propio), false, false, false, null, (b.centerY() / resources.displayMetrics.density).toInt()))
      }
      for (i in 0 until n.childCount) { val h = n.getChild(i) ?: continue; recorrer(h, prof + 1) }
    }
    recorrer(r, 0)
    // la foto anterior ya no sirve
    if (Build.VERSION.SDK_INT < 33) foto.forEach { try { it.recycle() } catch (e: Exception) {} }
    foto = nuevos; fotoPaquete = r.packageName?.toString()
    val lineas = salida.joinToString("\n") { e ->
      val marcas = ArrayList<String>()
      if (e.clic) marcas.add("tocar"); if (e.edita) marcas.add("escribir"); if (e.lista) marcas.add("desplazar")
      e.marcado?.let { marcas.add(if (it) "activado" else "desactivado") }
      "#${e.id} ${e.rol}${if (e.texto.isNotEmpty()) " «${e.texto}»" else ""}${if (marcas.isNotEmpty()) " [${marcas.joinToString(",")}]" else ""}"
    }
    return mapOf("ok" to true, "paquete" to fotoPaquete, "app" to nombreApp(fotoPaquete), "elementos" to lineas, "cantidad" to salida.size, "hay_mas" to mas)
  }

  private fun tieneAccionable(n: AccessibilityNodeInfo, prof: Int): Boolean {
    if (prof > 5) return false
    if (n.isClickable || n.isEditable || n.isCheckable) return true
    for (i in 0 until n.childCount) { val h = n.getChild(i) ?: continue; if (tieneAccionable(h, prof + 1)) return true }
    return false
  }

  /** todo el texto visible, de arriba abajo (para leer un correo, un artículo, un chat) */
  fun leer(): Map<String, Any?> {
    val r = raiz() ?: return mapOf("ok" to false, "motivo" to "no screen content available right now")
    val sb = StringBuilder()
    fun recorrer(n: AccessibilityNodeInfo, prof: Int) {
      if (sb.length > MAX_LECTURA || prof > 40 || !n.isVisibleToUser) return
      val t = limpio(n.text)
      if (t.isNotEmpty()) sb.append(t).append('\n')
      else if (n.childCount == 0) { val d = limpio(n.contentDescription); if (d.isNotEmpty() && d.length > 1) sb.append(d).append('\n') }
      for (i in 0 until n.childCount) { val h = n.getChild(i) ?: continue; recorrer(h, prof + 1) }
    }
    recorrer(r, 0)
    val texto = sb.toString().trim()
    return mapOf("ok" to true, "app" to nombreApp(r.packageName?.toString()), "texto" to (if (texto.length > MAX_LECTURA) texto.substring(0, MAX_LECTURA) + "…" else texto))
  }

  fun nombreApp(paquete: String?): String? = paquete?.let {
    try { packageManager.getApplicationLabel(packageManager.getApplicationInfo(it, 0)).toString() } catch (e: Exception) { it }
  }

  // ── actuar ──
  private fun nodo(id: Int): AccessibilityNodeInfo? {
    val n = foto.getOrNull(id) ?: return null
    return try { if (n.refresh()) n else null } catch (e: Exception) { null }
  }

  private fun tocarGesto(b: Rect): Boolean {
    if (Build.VERSION.SDK_INT < 24) return false
    val p = Path(); p.moveTo(b.exactCenterX(), b.exactCenterY())
    val g = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(p, 0, 60)).build()
    return dispatchGesture(g, null, null)
  }

  /** toca un elemento de la última foto: su acción de clic, la de su fila, o un toque real en su centro */
  fun tocar(id: Int): Map<String, Any?> {
    val n = nodo(id) ?: return mapOf("ok" to false, "motivo" to "that element is gone; call ver_pantalla again")
    val que = corto(etiqueta(n).ifEmpty { "#$id" }, 60)
    var x: AccessibilityNodeInfo? = n
    var saltos = 0
    while (x != null && saltos < 5) {
      if (x.isClickable && x.performAction(AccessibilityNodeInfo.ACTION_CLICK)) { ultimoCambio = SystemClock.uptimeMillis(); return mapOf("ok" to true, "tocado" to que) }
      x = x.parent; saltos++
    }
    val b = Rect(); n.getBoundsInScreen(b)
    if (tocarGesto(b)) { ultimoCambio = SystemClock.uptimeMillis(); return mapOf("ok" to true, "tocado" to que, "modo" to "gesto") }
    return mapOf("ok" to false, "motivo" to "could not tap it")
  }

  /** toca lo primero que diga (o describa) ese texto */
  fun tocarTexto(texto: String): Map<String, Any?> {
    val r = raiz() ?: return mapOf("ok" to false, "motivo" to "no screen content available right now")
    val q = texto.trim().lowercase()
    var hallado: AccessibilityNodeInfo? = null
    fun buscar(n: AccessibilityNodeInfo, prof: Int) {
      if (hallado != null || prof > 40 || !n.isVisibleToUser) return
      val e = etiqueta(n).lowercase()
      if (e.isNotEmpty() && (e == q || e.contains(q))) { hallado = n; return }
      for (i in 0 until n.childCount) { val h = n.getChild(i) ?: continue; buscar(h, prof + 1) }
    }
    buscar(r, 0)
    val n = hallado ?: return mapOf("ok" to false, "motivo" to "nothing on screen says «$texto»; call ver_pantalla to see what there is")
    foto.add(n)
    return tocar(foto.size - 1)
  }

  /** escribe en un campo: el indicado, el que tiene el foco, o el primero que haya; `enviar` aprieta Intro */
  fun escribir(id: Int?, texto: String, enviar: Boolean): Map<String, Any?> {
    var campo: AccessibilityNodeInfo? = id?.let { nodo(it) }
    if (campo == null || !campo.isEditable) {
      val r = raiz()
      campo = r?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.takeIf { it.isEditable }
        ?: foto.firstOrNull { try { it.refresh() && it.isEditable } catch (e: Exception) { false } }
        ?: r?.let { primerCampo(it, 0) }
    }
    val c = campo ?: return mapOf("ok" to false, "motivo" to "no text field on screen; tap one first (ver_pantalla)")
    c.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
    val args = Bundle(); args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, texto)
    val ok = c.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    if (!ok) return mapOf("ok" to false, "motivo" to "the field did not accept text")
    var intro = false
    if (enviar && Build.VERSION.SDK_INT >= 30) intro = c.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
    ultimoCambio = SystemClock.uptimeMillis()
    return mapOf("ok" to true, "escrito" to texto, "intro" to intro, "nota" to if (enviar && !intro) "could not press enter: tap the search/send button on screen" else null)
  }

  private fun primerCampo(n: AccessibilityNodeInfo, prof: Int): AccessibilityNodeInfo? {
    if (prof > 40) return null
    if (n.isEditable && n.isVisibleToUser) return n
    for (i in 0 until n.childCount) { val h = n.getChild(i) ?: continue; primerCampo(h, prof + 1)?.let { return it } }
    return null
  }

  /** desplaza la lista (abajo · arriba · izquierda · derecha): por su acción, o con un deslizamiento real */
  fun desplazar(direccion: String, id: Int?): Map<String, Any?> {
    val adelante = direccion == "abajo" || direccion == "derecha"
    val accion = if (adelante) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
    val lista = id?.let { nodo(it) }?.takeIf { it.isScrollable }
      ?: foto.firstOrNull { try { it.refresh() && it.isScrollable && it.isVisibleToUser } catch (e: Exception) { false } }
      ?: raiz()?.let { primeraLista(it, 0) }
    if (lista != null && lista.performAction(accion)) { ultimoCambio = SystemClock.uptimeMillis(); return mapOf("ok" to true, "modo" to "lista") }
    if (Build.VERSION.SDK_INT < 24) return mapOf("ok" to false, "motivo" to "nothing to scroll")
    val m = resources.displayMetrics; val w = m.widthPixels.toFloat(); val h = m.heightPixels.toFloat()
    val p = Path()
    when (direccion) {
      "abajo" -> { p.moveTo(w / 2, h * 0.7f); p.lineTo(w / 2, h * 0.3f) }
      "arriba" -> { p.moveTo(w / 2, h * 0.3f); p.lineTo(w / 2, h * 0.7f) }
      "izquierda" -> { p.moveTo(w * 0.8f, h / 2); p.lineTo(w * 0.2f, h / 2) }
      else -> { p.moveTo(w * 0.2f, h / 2); p.lineTo(w * 0.8f, h / 2) }
    }
    val g = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(p, 0, 320)).build()
    val ok = dispatchGesture(g, null, null)
    if (ok) ultimoCambio = SystemClock.uptimeMillis()
    return mapOf("ok" to ok, "modo" to "gesto")
  }

  private fun primeraLista(n: AccessibilityNodeInfo, prof: Int): AccessibilityNodeInfo? {
    if (prof > 40) return null
    if (n.isScrollable && n.isVisibleToUser) return n
    for (i in 0 until n.childCount) { val h = n.getChild(i) ?: continue; primeraLista(h, prof + 1)?.let { return it } }
    return null
  }

  /** el pantallazo del sistema (suena, muestra la vista previa y queda en la galería), Android 9+ */
  fun pantallazo(): Boolean = Build.VERSION.SDK_INT >= 28 && performGlobalAction(GLOBAL_ACTION_TAKE_SCREENSHOT)

  /** atrás · inicio · recientes · notificaciones */
  fun tecla(cual: String): Boolean {
    val a = when (cual) {
      "atras" -> GLOBAL_ACTION_BACK
      "inicio" -> GLOBAL_ACTION_HOME
      "recientes" -> GLOBAL_ACTION_RECENTS
      "notificaciones" -> GLOBAL_ACTION_NOTIFICATIONS
      else -> return false
    }
    val ok = performGlobalAction(a)
    if (ok) ultimoCambio = SystemClock.uptimeMillis()
    return ok
  }
}
