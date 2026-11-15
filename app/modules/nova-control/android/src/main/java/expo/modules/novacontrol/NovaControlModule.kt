// NOVA controla el teléfono: música (pausa, siguiente, qué suena, buscar y poner algo en Spotify o YouTube Music),
// cámara, abrir apps, linterna, volumen, contactos, mensajes, llamadas, rutas, no molestar. Además: la capa del
// asistente (ventana completa o burbuja: NovaCapa), su foco de audio (la música baja mientras te escucha), la voz por
// AudioTrack, las notificaciones (NovaOyente) y ver y usar las apps por ti (NovaAccesibilidad).
package expo.modules.novacontrol

import android.app.NotificationManager
import android.app.SearchManager
import android.app.StatusBarManager
import android.app.role.RoleManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.drawable.Icon
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.ContactsContract
import android.provider.MediaStore
import android.provider.Settings
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import android.util.Base64
import android.view.Display
import android.view.KeyEvent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.text.Normalizer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class NovaControlModule : Module() {
  companion object {
    const val ESCUCHAR = "solutions.bn.nova.ESCUCHAR"
    /** la capa del asistente avisa cuando la vuelven a invocar estando abierta */
    var invocada: (() -> Unit)? = null
    /** si está encendido, abrir otra app desde la capa la deja como burbuja en vez de cerrarla */
    @Volatile var miniAlSalir = false
    private val MUSICA = mapOf("spotify" to "com.spotify.music", "youtube_music" to "com.google.android.apps.youtube.music")
  }

  private val ctx: Context
    get() = appContext.reactContext ?: throw IllegalStateException("Sin contexto de Android")
  private val audio: AudioManager
    get() = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val principal = Handler(Looper.getMainLooper())

  private fun instalada(paquete: String) =
    try { ctx.packageManager.getPackageInfo(paquete, 0); true } catch (e: PackageManager.NameNotFoundException) { false }

  private fun nombreApp(paquete: String): String =
    try { ctx.packageManager.getApplicationLabel(ctx.packageManager.getApplicationInfo(paquete, 0)).toString() } catch (e: Exception) { paquete }

  private fun lanzar(i: Intent): Boolean {
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    // desde la capa del asistente se abre con su actividad (Android deja abrir apps desde lo que está en pantalla);
    // si corresponde, la capa pasa a burbuja justo antes, para seguir ahí encima de lo que se abre
    val act = appContext.currentActivity
    if (miniAlSalir) NovaCapa.instancia?.mini()
    return try { if (act != null) act.startActivity(i) else ctx.startActivity(i); true } catch (e: Exception) { false }
  }

  // ── música ──
  private fun tieneAcceso(): Boolean {
    val lista = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: return false
    return lista.split(':').any { ComponentName.unflattenFromString(it)?.packageName == ctx.packageName }
  }

  private fun sesiones(): List<MediaController> {
    if (!tieneAcceso()) return emptyList()
    val msm = ctx.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
    return try { msm.getActiveSessions(ComponentName(ctx, NovaOyente::class.java)) } catch (e: SecurityException) { emptyList() }
  }

  /** la que suena; si ninguna suena, la última que sonó (la primera de la lista es la más reciente) */
  private fun sesionActiva(): MediaController? {
    val s = sesiones()
    return s.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING } ?: s.firstOrNull()
  }

  private fun tecla(codigo: Int) {
    audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, codigo))
    audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, codigo))
  }

  private fun ahora(): Map<String, Any?> {
    val c = sesionActiva() ?: return mapOf("acceso" to tieneAcceso(), "suena" to audio.isMusicActive)
    val m = c.metadata
    return mapOf(
      "acceso" to true,
      "suena" to (c.playbackState?.state == PlaybackState.STATE_PLAYING),
      "app" to nombreApp(c.packageName),
      "titulo" to m?.getString(MediaMetadata.METADATA_KEY_TITLE),
      "artista" to (m?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: m?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST)),
      "album" to m?.getString(MediaMetadata.METADATA_KEY_ALBUM),
    )
  }

  // ── foco de audio de la capa del asistente ──
  private var foco: AudioFocusRequest? = null

  // ── la voz de NOVA (AudioTrack) ──
  private var pista: AudioTrack? = null
  private var escritos = 0L
  private fun audioCerrarInterno() { pista?.let { try { it.stop() } catch (e: Exception) {}; it.release() }; pista = null; escritos = 0L }

  // ── accesibilidad ──
  private fun accesibilidadActiva(): Boolean {
    if (NovaAccesibilidad.activa) return true
    val lista = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
    return lista.split(':').any { ComponentName.unflattenFromString(it)?.let { c -> c.packageName == ctx.packageName && c.className.endsWith("NovaAccesibilidad") } == true }
  }
  private val SIN_ACCESIBILIDAD = mapOf("ok" to false, "motivo" to "NOVA is not enabled in Accessibility: they must turn on NOVA in Settings → Accessibility → NOVA (the app can open it from Settings → Phone control → Use apps for you)")
  private fun servicio(): NovaAccesibilidad? = NovaAccesibilidad.instancia

  /** una foto de la pantalla en JPEG (base64), sin la capa de NOVA encima; Android 11+ con accesibilidad */
  private fun capturaPantalla(): String? {
    val s = servicio() ?: return null
    if (Build.VERSION.SDK_INT < 30) return null
    val latch = CountDownLatch(1)
    var salida: String? = null
    principal.post { NovaCapa.instancia?.let { it.ocultar(true) } }
    try { Thread.sleep(90) } catch (e: InterruptedException) {}
    try {
      s.takeScreenshot(Display.DEFAULT_DISPLAY, { r -> r.run() }, object : android.accessibilityservice.AccessibilityService.TakeScreenshotCallback {
        override fun onSuccess(res: android.accessibilityservice.AccessibilityService.ScreenshotResult) {
          try {
            val hb = res.hardwareBuffer
            val bm = Bitmap.wrapHardwareBuffer(hb, res.colorSpace)?.copy(Bitmap.Config.ARGB_8888, false)
            hb.close()
            if (bm != null) {
              val escala = minOf(1f, 1024f / bm.width)
              val chico = if (escala < 1f) Bitmap.createScaledBitmap(bm, (bm.width * escala).toInt(), (bm.height * escala).toInt(), true) else bm
              val out = ByteArrayOutputStream()
              chico.compress(Bitmap.CompressFormat.JPEG, 62, out)
              salida = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            }
          } catch (e: Exception) {}
          latch.countDown()
        }
        override fun onFailure(code: Int) { latch.countDown() }
      })
      latch.await(2500, TimeUnit.MILLISECONDS)
    } catch (e: Exception) {}
    principal.post { NovaCapa.instancia?.let { it.ocultar(false) } }
    return salida
  }

  /** un pantallazo como el del sistema, sin la capa de NOVA encima. Primero la acción global (suena, vista previa,
      galería); si el teléfono no la acepta, captura propia guardada en Imágenes/Screenshots (Android 11+). */
  private fun pantallazo(): Map<String, Any?> {
    val s = servicio() ?: return SIN_ACCESIBILIDAD
    principal.post { NovaCapa.instancia?.ocultar(true) }
    try { Thread.sleep(140) } catch (e: InterruptedException) {}
    try {
      if (s.pantallazo()) {
        // la animación del sistema tarda un poco: la capa vuelve después
        principal.postDelayed({ NovaCapa.instancia?.ocultar(false) }, 900)
        return mapOf("ok" to true, "modo" to "sistema")
      }
      if (Build.VERSION.SDK_INT < 30) return mapOf("ok" to false, "motivo" to "this phone does not allow screenshots from the assistant (Android 11+ needed)")
      val b64 = capturaPantallaCruda() ?: return mapOf("ok" to false, "motivo" to "could not capture the screen")
      val nombre = "NOVA_" + java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.US).format(java.util.Date()) + ".png"
      val valores = android.content.ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, nombre)
        put(MediaStore.Images.Media.MIME_TYPE, "image/png")
        put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Screenshots")
      }
      val uri = ctx.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, valores) ?: return mapOf("ok" to false, "motivo" to "could not save the screenshot")
      ctx.contentResolver.openOutputStream(uri)?.use { out -> b64.compress(Bitmap.CompressFormat.PNG, 100, out) }
      return mapOf("ok" to true, "modo" to "guardado", "archivo" to nombre)
    } finally {
      principal.postDelayed({ NovaCapa.instancia?.ocultar(false) }, 300)
    }
  }

  /** la pantalla completa como Bitmap (sin la capa de NOVA, que ya está oculta); Android 11+ con accesibilidad */
  private fun capturaPantallaCruda(): Bitmap? {
    val s = servicio() ?: return null
    if (Build.VERSION.SDK_INT < 30) return null
    val latch = CountDownLatch(1)
    var salida: Bitmap? = null
    try {
      s.takeScreenshot(Display.DEFAULT_DISPLAY, { r -> r.run() }, object : android.accessibilityservice.AccessibilityService.TakeScreenshotCallback {
        override fun onSuccess(res: android.accessibilityservice.AccessibilityService.ScreenshotResult) {
          try { val hb = res.hardwareBuffer; salida = Bitmap.wrapHardwareBuffer(hb, res.colorSpace)?.copy(Bitmap.Config.ARGB_8888, false); hb.close() } catch (e: Exception) {}
          latch.countDown()
        }
        override fun onFailure(code: Int) { latch.countDown() }
      })
      latch.await(2500, TimeUnit.MILLISECONDS)
    } catch (e: Exception) {}
    return salida
  }

  // ── la capa viva: con la actividad en segundo plano, React congela los timers; una tarea headless los mantiene ──
  private var tareaViva = -1

  // ── apps ──
  private fun normal(s: String) =
    Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").replace(Regex("[^a-z0-9]+"), " ").trim()

  override fun definition() = ModuleDefinition {
    Name("NovaControl")
    Events("invocada", "capa", "ventana")

    OnCreate {
      invocada = { sendEvent("invocada", emptyMap<String, Any?>()) }
      NovaCapa.modoCambio = { modo, lado -> sendEvent("capa", mapOf("modo" to modo, "lado" to lado)) }
      NovaAccesibilidad.ventanaCambio = { pkg -> sendEvent("ventana", mapOf("paquete" to pkg, "app" to nombreApp(pkg))) }
    }
    OnDestroy { invocada = null; NovaCapa.modoCambio = null; NovaAccesibilidad.ventanaCambio = null; audioCerrarInterno() }

    // ── la voz de NOVA por AudioTrack: el PCM suena apenas llega (sin archivos ni cola de reproductores) ──
    Function("audioAbrir") { hz: Int ->
      audioCerrarInterno()
      val min = AudioTrack.getMinBufferSize(hz, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
      val t = AudioTrack.Builder()
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(hz).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
        .setBufferSizeInBytes(maxOf(min, hz * 2)) // un segundo de margen
        .setTransferMode(AudioTrack.MODE_STREAM)
        .build()
      t.play()
      pista = t; escritos = 0L
      true
    }
    /** agrega PCM s16le mono (base64); devuelve los cuadros escritos en total */
    Function("audioEscribir") { b64: String ->
      val t = pista ?: return@Function -1.0
      val bytes = Base64.decode(b64, Base64.DEFAULT)
      var off = 0
      while (off < bytes.size) { val n = t.write(bytes, off, bytes.size - off); if (n <= 0) break; off += n }
      escritos += off / 2
      escritos.toDouble()
    }
    /** cuadros reproducidos hasta ahora (para seguir la envolvente y saber cuándo terminó) */
    Function("audioReproducido") { (pista?.playbackHeadPosition?.toLong() ?: 0L).toDouble() }
    Function("audioEscritos") { escritos.toDouble() }
    /** corta en seco (interrupción): vacía lo que había en cola */
    Function("audioParar") { pista?.let { try { it.pause(); it.flush(); it.play() } catch (e: Exception) {} }; escritos = 0L; (pista?.playbackHeadPosition?.toLong() ?: 0L).toDouble() }
    Function("audioVolumen") { v: Double -> pista?.setVolume(v.toFloat().coerceIn(0f, 1f)); true }
    Function("audioCerrar") { audioCerrarInterno(); true }

    // ── la capa: ventana completa o burbuja (NovaCapa) ──
    Function("miniAlSalir") { v: Boolean -> miniAlSalir = v }
    /** ventana: la capa vive en su ventana propia (puede ser burbuja) · actividad: la hospeda la actividad · cerrada */
    Function("capaModo") { if (NovaCapa.instancia != null) NovaCapa.modo else if (appContext.currentActivity is NovaAsistenteActivity) "actividad" else "cerrada" }
    /** de qué lado está el orbe en burbuja (izq · der): la píldora sale hacia el otro */
    Function("capaLado") { NovaCapa.lado }
    /** tamaño de la burbuja en dp (orbe solo, o con su píldora); si ya es burbuja, se ajusta al instante */
    Function("capaMini") { ancho: Double, alto: Double ->
      NovaCapa.miniAnchoDp = ancho.toFloat(); NovaCapa.miniAltoDp = alto.toFloat()
      val c = NovaCapa.instancia ?: return@Function false
      if (NovaCapa.modo == "mini") c.mini()
      true
    }
    /** a burbuja ahora (NOVA va a seguir contigo sobre la app de atrás) */
    Function("capaABurbuja") { NovaCapa.instancia?.let { it.mini(); true } ?: false }
    Function("capaCompleta") { NovaCapa.instancia?.let { it.agrandar(); true } ?: false }
    /** mantiene vivos los timers de JS mientras la actividad está en segundo plano (burbuja) */
    Function("capaViva") { v: Boolean ->
      principal.post {
        val rc = appContext.reactContext as? ReactContext ?: return@post
        try {
          val h = HeadlessJsTaskContext.getInstance(rc)
          if (v && tareaViva < 0 && rc.hasActiveReactInstance()) tareaViva = h.startTask(HeadlessJsTaskConfig("NovaViva", Arguments.createMap(), 0L, true))
          else if (!v && tareaViva >= 0) { h.finishTask(tareaViva); tareaViva = -1 }
        } catch (e: Exception) { tareaViva = -1 }
      }
      true
    }
    /** JS sigue vivo (cada 2 s desde la capa): si deja de latir, la ventana deja pasar los toques y se cierra sola */
    Function("latido") { NovaCapa.latido(); true }
    Function("puedeSobreponer") { NovaCapa.puedeSobreponer(ctx) }
    Function("pedirSobreponer") {
      lanzar(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}"))) || lanzar(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION))
    }

    /** pausar · reanudar · alternar · siguiente · anterior. Con acceso a notificaciones va al reproductor exacto;
        sin él, como las teclas de unos audífonos (le llega a la última app que sonó). */
    Function("media") { accion: String ->
      val c = sesionActiva()
      val t = c?.transportControls
      when (accion) {
        "pausar" -> if (t != null) t.pause() else tecla(KeyEvent.KEYCODE_MEDIA_PAUSE)
        "reanudar" -> if (t != null) t.play() else tecla(KeyEvent.KEYCODE_MEDIA_PLAY)
        "alternar" -> tecla(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
        "siguiente" -> if (t != null) t.skipToNext() else tecla(KeyEvent.KEYCODE_MEDIA_NEXT)
        "anterior" -> if (t != null) t.skipToPrevious() else tecla(KeyEvent.KEYCODE_MEDIA_PREVIOUS)
        else -> throw IllegalArgumentException("acción desconocida: $accion")
      }
      mapOf("app" to c?.packageName?.let { nombreApp(it) }, "exacto" to (c != null))
    }

    Function("ahora") { ahora() }
    Function("tieneAccesoNotificaciones") { tieneAcceso() }
    Function("abrirAccesoNotificaciones") {
      val i = if (Build.VERSION.SDK_INT >= 30)
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, ComponentName(ctx, NovaOyente::class.java).flattenToString())
      else Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
      if (!lanzar(i)) lanzar(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))
    }

    /** apps de música instaladas, por clave */
    Function("appsMusica") { MUSICA.filter { instalada(it.value) }.keys.toList() }

    /** busca y pone algo: la app recibe la búsqueda y reproduce el mejor resultado (como «Ok Google, pon…»).
        Si la app no acepta búsquedas para reproducir, la abre con la búsqueda hecha. */
    Function("poner") { consulta: String, app: String?, tipo: String? ->
      val paquete = app?.let { MUSICA[it] }?.takeIf { instalada(it) } ?: MUSICA.values.firstOrNull { instalada(it) }
        ?: return@Function mapOf("ok" to false, "motivo" to "no music app installed (Spotify or YouTube Music)")
      val clave = MUSICA.entries.first { it.value == paquete }.key
      val i = Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH).setPackage(paquete).putExtra(SearchManager.QUERY, consulta)
      when (tipo) {
        "artista" -> i.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, MediaStore.Audio.Artists.ENTRY_CONTENT_TYPE).putExtra(MediaStore.EXTRA_MEDIA_ARTIST, consulta)
        "album" -> i.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, MediaStore.Audio.Albums.ENTRY_CONTENT_TYPE).putExtra(MediaStore.EXTRA_MEDIA_ALBUM, consulta)
        "playlist" -> i.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/playlist").putExtra("android.intent.extra.playlist", consulta)
        else -> i.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*")
      }
      if (i.resolveActivity(ctx.packageManager) != null && lanzar(i)) return@Function mapOf("ok" to true, "app" to clave, "modo" to "reproducir")
      val busqueda = if (clave == "spotify") Intent(Intent.ACTION_VIEW, Uri.parse("spotify:search:${Uri.encode(consulta)}"))
        else Intent(Intent.ACTION_VIEW, Uri.parse("https://music.youtube.com/search?q=${Uri.encode(consulta)}")).setPackage(paquete)
      mapOf("ok" to lanzar(busqueda), "app" to clave, "modo" to "buscar")
    }

    // ── cámara ──
    Function("camara") { modo: String ->
      val i = Intent(if (modo == "video") MediaStore.INTENT_ACTION_VIDEO_CAMERA else MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)
      if (modo == "selfie") {
        // no hay un extra oficial: cada fabricante lee uno distinto
        i.putExtra("android.intent.extras.CAMERA_FACING", 1)
          .putExtra("android.intent.extras.LENS_FACING_FRONT", 1)
          .putExtra("android.intent.extra.USE_FRONT_CAMERA", true)
          .putExtra("com.google.assistant.extra.USE_FRONT_CAMERA", true)
      }
      lanzar(i)
    }

    /** abre una app por su nombre dicho en voz alta («WhatsApp», «maps», «la calculadora») */
    Function("abrirApp") { nombre: String ->
      val pm = ctx.packageManager
      val q = normal(nombre)
      if (q.isEmpty()) return@Function null
      val apps = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
        .filter { it.activityInfo.packageName != ctx.packageName }
        .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
        .distinctBy { it.first }
      val puntaje = { etiqueta: String ->
        val e = normal(etiqueta)
        when {
          e == q -> 4
          e.startsWith(q) || q.startsWith(e) -> 3
          e.split(' ').any { it == q } -> 2
          e.contains(q) || q.contains(e) -> 1
          else -> 0
        }
      }
      val mejor = apps.map { Triple(it.first, it.second, puntaje(it.second)) }.filter { it.third > 0 }.maxByOrNull { it.third }
        ?: return@Function null
      val i = pm.getLaunchIntentForPackage(mejor.first) ?: return@Function null
      if (lanzar(i)) mapOf("app" to mejor.second, "paquete" to mejor.first) else null
    }

    Function("linterna") { encender: Boolean ->
      val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val id = cm.cameraIdList.firstOrNull {
        val c = cm.getCameraCharacteristics(it)
        c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true && c.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
      } ?: return@Function false
      cm.setTorchMode(id, encender)
      true
    }

    /** volumen de la música: subir · bajar · silenciar · nivel (0–100). Devuelve el nivel final en %. */
    Function("volumen") { accion: String, nivel: Double? ->
      val am = audio
      val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      val paso = maxOf(1, Math.round(max * 0.15f))
      val ahora = am.getStreamVolume(AudioManager.STREAM_MUSIC)
      val nuevo = when (accion) {
        "subir" -> minOf(max, ahora + paso)
        "bajar" -> maxOf(0, ahora - paso)
        "silenciar" -> 0
        "nivel" -> Math.round(((nivel ?: 50.0).coerceIn(0.0, 100.0) / 100.0 * max)).toInt()
        else -> ahora
      }
      am.setStreamVolume(AudioManager.STREAM_MUSIC, nuevo, AudioManager.FLAG_SHOW_UI)
      Math.round(nuevo * 100.0 / max).toInt()
    }

    /** deja un texto en el portapapeles («copia el código») */
    Function("copiar") { texto: String ->
      val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      cm.setPrimaryClip(ClipData.newPlainText("NOVA", texto))
      true
    }

    /** quita una alarma del Reloj por su nombre o su hora (la misma API con la que se ponen) */
    Function("quitarAlarma") { etiqueta: String?, hora: Int?, minutos: Int? ->
      val i = Intent("android.intent.action.DISMISS_ALARM").putExtra("android.intent.extra.alarm.SKIP_UI", true)
      when {
        !etiqueta.isNullOrBlank() -> i.putExtra("android.intent.extra.alarm.SEARCH_MODE", "android.label").putExtra("android.intent.extra.alarm.MESSAGE", etiqueta)
        hora != null -> i.putExtra("android.intent.extra.alarm.SEARCH_MODE", "android.time").putExtra("android.intent.extra.alarm.HOUR", hora).putExtra("android.intent.extra.alarm.MINUTES", minutos ?: 0)
        else -> i.putExtra("android.intent.extra.alarm.SEARCH_MODE", "android.next")
      }
      if (i.resolveActivity(ctx.packageManager) == null) return@Function false
      // sin pasar por lanzar(): el Reloj no muestra nada (SKIP_UI), la capa no debe irse a burbuja
      try { ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true } catch (e: Exception) { false }
    }
    /** abre la lista de alarmas del Reloj */
    Function("verAlarmas") { lanzar(Intent("android.intent.action.SHOW_ALARMS")) }

    // ── NOVA como asistente del teléfono ──
    Function("esAsistente") {
      if (Build.VERSION.SDK_INT >= 29) {
        (ctx.getSystemService(Context.ROLE_SERVICE) as RoleManager).isRoleHeld(RoleManager.ROLE_ASSISTANT)
      } else {
        Settings.Secure.getString(ctx.contentResolver, "assistant")?.startsWith(ctx.packageName) == true
      }
    }
    /** el rol de asistente no se puede pedir con un diálogo: se abre la pantalla donde se elige */
    Function("abrirAjustesAsistente") {
      lanzar(Intent(Settings.ACTION_VOICE_INPUT_SETTINGS)) || lanzar(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)) || lanzar(Intent(Settings.ACTION_SETTINGS))
    }

    /** mientras la capa está abierta, la música baja de volumen (no se pausa: así «pausa» y «siguiente» hacen
        exactamente eso); al soltarlo vuelve a su volumen */
    Function("enfocar") { tomar: Boolean ->
      val am = audio
      foco?.let { am.abandonAudioFocusRequest(it) }
      foco = null
      if (tomar) {
        val r = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
          .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
          .setOnAudioFocusChangeListener { }
          .build()
        if (am.requestAudioFocus(r) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) foco = r
      }
      foco != null
    }

    // ── notificaciones: chats con mensajes sin leer, y la última de cualquier app ──
    Function("conversaciones") { if (tieneAcceso()) NovaOyente.conversaciones().map { it + ("app" to nombreApp(it["paquete"] as String)) } else emptyList() }
    Function("notificaciones") { cuantas: Int -> if (tieneAcceso()) NovaOyente.notificaciones(cuantas).map { it + ("app" to nombreApp(it["paquete"] as String)) } else emptyList() }
    AsyncFunction("responderNotificacion") { clave: String, texto: String -> NovaOyente.responder(clave, texto, ctx) }
    /** abre lo que la notificación abre al tocarla (el correo, el chat, el pedido…) */
    Function("abrirNotificacion") { clave: String ->
      if (miniAlSalir) NovaCapa.instancia?.mini()
      NovaOyente.abrir(clave)
    }

    // ── no molestar y timbre (permiso aparte: Ajustes → Acceso a No molestar) ──
    Function("tienePermisoNoMolestar") { (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).isNotificationPolicyAccessGranted }
    Function("abrirPermisoNoMolestar") { lanzar(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)) }
    /** normal · vibrar · silencio · no_molestar (solo prioridad) · solo_alarmas */
    Function("modoTelefono") { modo: String ->
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (!nm.isNotificationPolicyAccessGranted) return@Function false
      val am = audio
      when (modo) {
        "normal" -> { nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL); am.ringerMode = AudioManager.RINGER_MODE_NORMAL }
        "vibrar" -> { nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL); am.ringerMode = AudioManager.RINGER_MODE_VIBRATE }
        "silencio" -> { nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL); am.ringerMode = AudioManager.RINGER_MODE_SILENT }
        "no_molestar" -> nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
        "solo_alarmas" -> nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALARMS)
        else -> return@Function false
      }
      true
    }
    Function("modoActual") {
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      when (nm.currentInterruptionFilter) {
        NotificationManager.INTERRUPTION_FILTER_PRIORITY -> "no_molestar"
        NotificationManager.INTERRUPTION_FILTER_ALARMS -> "solo_alarmas"
        NotificationManager.INTERRUPTION_FILTER_NONE -> "silencio_total"
        else -> when (audio.ringerMode) { AudioManager.RINGER_MODE_VIBRATE -> "vibrar"; AudioManager.RINGER_MODE_SILENT -> "silencio"; else -> "normal" }
      }
    }

    // ── ver y usar las apps por ti (accesibilidad) ──
    Function("accesibilidadActiva") { accesibilidadActiva() }
    Function("abrirAccesibilidad") { lanzar(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
    /** la app que está en pantalla */
    Function("appEnFrente") {
      val s = servicio() ?: return@Function null
      val p = try { s.rootInActiveWindow?.packageName?.toString() } catch (e: Exception) { null } ?: NovaAccesibilidad.frente ?: return@Function null
      mapOf("paquete" to p, "app" to nombreApp(p))
    }
    /** una foto compacta de lo que hay en pantalla (elementos con id); espera a que la vista se quede quieta */
    AsyncFunction("pantalla") { esperar: Boolean -> servicio()?.pantalla(esperar) ?: SIN_ACCESIBILIDAD }
    AsyncFunction("leerPantalla") { servicio()?.leer() ?: SIN_ACCESIBILIDAD }
    AsyncFunction("tocar") { id: Int -> servicio()?.tocar(id) ?: SIN_ACCESIBILIDAD }
    AsyncFunction("tocarTexto") { texto: String -> servicio()?.tocarTexto(texto) ?: SIN_ACCESIBILIDAD }
    AsyncFunction("escribir") { id: Int?, texto: String, enviar: Boolean -> servicio()?.escribir(id, texto, enviar) ?: SIN_ACCESIBILIDAD }
    AsyncFunction("desplazar") { direccion: String, id: Int? -> servicio()?.desplazar(direccion, id) ?: SIN_ACCESIBILIDAD }
    Function("tecla") { cual: String -> servicio()?.tecla(cual) ?: false }
    /** JPEG en base64 de la pantalla (sin la capa de NOVA), para que NOVA la mire */
    AsyncFunction("capturaPantalla") { capturaPantalla() }
    /** un pantallazo de verdad, a la galería (el del sistema o uno propio) */
    AsyncFunction("pantallazo") { pantallazo() }

    // ── personas: contactos, mensajes, llamadas ──
    /** tus contactos que más se parecen a un nombre dicho en voz alta («mamá», «Benja», «Luis González»), con sus
        teléfonos (en formato internacional), correos y si tienen WhatsApp. Necesita el permiso de contactos. */
    Function("contactos") { nombre: String ->
      val q = normal(nombre)
      if (q.isEmpty()) return@Function emptyList<Map<String, Any?>>()
      val cr = ctx.contentResolver
      val pais = (ctx.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager).let { it.simCountryIso.ifEmpty { it.networkCountryIso } }.uppercase().ifEmpty { "CL" }
      val puntaje = { etiqueta: String ->
        val e = normal(etiqueta)
        when {
          e == q -> 5
          e.startsWith("$q ") || e.split(' ').firstOrNull() == q -> 4
          e.split(' ').any { it == q } -> 3
          e.startsWith(q) -> 2
          e.contains(q) || (q.length >= 4 && q.contains(e)) -> 1
          else -> 0
        }
      }
      // id → (nombre, puntaje)
      val candidatos = LinkedHashMap<Long, Pair<String, Int>>()
      val fotos = HashMap<Long, String?>()
      cr.query(ContactsContract.Contacts.CONTENT_URI, arrayOf(ContactsContract.Contacts._ID, ContactsContract.Contacts.DISPLAY_NAME_PRIMARY, ContactsContract.Contacts.PHOTO_THUMBNAIL_URI), null, null, null)?.use { c ->
        while (c.moveToNext()) {
          val n = c.getString(1) ?: continue
          val p = puntaje(n)
          if (p > 0) { candidatos[c.getLong(0)] = n to p; fotos[c.getLong(0)] = c.getString(2) }
        }
      }
      val mejores = candidatos.entries.sortedWith(compareByDescending<Map.Entry<Long, Pair<String, Int>>> { it.value.second }.thenBy { it.value.first.length }).take(5)
      mejores.map { (id, np) ->
        val telefonos = ArrayList<String>()
        cr.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER), "${ContactsContract.CommonDataKinds.Phone.CONTACT_ID} = ?", arrayOf(id.toString()), null)?.use { c ->
          while (c.moveToNext()) {
            val crudo = c.getString(0) ?: continue
            val e164 = PhoneNumberUtils.formatNumberToE164(crudo, pais) ?: crudo.filter { it.isDigit() || it == '+' }
            if (e164.isNotEmpty() && e164 !in telefonos) telefonos.add(e164)
          }
        }
        val correos = ArrayList<String>()
        cr.query(ContactsContract.CommonDataKinds.Email.CONTENT_URI, arrayOf(ContactsContract.CommonDataKinds.Email.ADDRESS), "${ContactsContract.CommonDataKinds.Email.CONTACT_ID} = ?", arrayOf(id.toString()), null)?.use { c ->
          while (c.moveToNext()) c.getString(0)?.let { if (it !in correos) correos.add(it) }
        }
        var whatsapp = false
        cr.query(ContactsContract.RawContacts.CONTENT_URI, arrayOf(ContactsContract.RawContacts.ACCOUNT_TYPE), "${ContactsContract.RawContacts.CONTACT_ID} = ?", arrayOf(id.toString()), null)?.use { c ->
          while (c.moveToNext()) if (c.getString(0)?.startsWith("com.whatsapp") == true) whatsapp = true
        }
        mapOf("id" to id.toString(), "nombre" to np.first, "puntaje" to np.second, "telefonos" to telefonos, "correos" to correos, "whatsapp" to whatsapp, "foto" to fotos[id])
      }
    }

    /** abre el chat de WhatsApp de ese número con el mensaje ya escrito: solo falta tocar enviar */
    Function("whatsapp") { numero: String, texto: String ->
      val digitos = numero.filter { it.isDigit() }
      val paquete = listOf("com.whatsapp", "com.whatsapp.w4b").firstOrNull { instalada(it) } ?: return@Function false
      lanzar(Intent(Intent.ACTION_VIEW, Uri.parse("https://api.whatsapp.com/send?phone=$digitos&text=${Uri.encode(texto)}")).setPackage(paquete))
    }
    Function("sms") { numero: String, texto: String ->
      lanzar(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:${Uri.encode(numero)}")).putExtra("sms_body", texto))
    }
    Function("correo") { para: String, asunto: String, cuerpo: String ->
      lanzar(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")).putExtra(Intent.EXTRA_EMAIL, arrayOf(para)).putExtra(Intent.EXTRA_SUBJECT, asunto).putExtra(Intent.EXTRA_TEXT, cuerpo))
    }
    /** llama directo si diste el permiso de llamadas; si no, deja el número marcado */
    Function("llamar") { numero: String ->
      val directo = ctx.checkSelfPermission(android.Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED
      lanzar(Intent(if (directo) Intent.ACTION_CALL else Intent.ACTION_DIAL, Uri.parse("tel:${Uri.encode(numero)}")))
    }
    /** navegación: Google Maps (auto, a pie, bici, transporte público) o Waze */
    Function("navegar") { destino: String, modo: String?, app: String? ->
      val q = Uri.encode(destino)
      if (app == "waze" && instalada("com.waze")) return@Function lanzar(Intent(Intent.ACTION_VIEW, Uri.parse("https://waze.com/ul?q=$q&navigate=yes")).setPackage("com.waze"))
      val i = when (modo) {
        "transporte" -> Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/dir/?api=1&destination=$q&travelmode=transit"))
        "caminando" -> Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=$q&mode=w"))
        "bicicleta" -> Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=$q&mode=b"))
        else -> Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=$q&mode=d"))
      }
      if (instalada("com.google.android.apps.maps")) i.setPackage("com.google.android.apps.maps")
      lanzar(i)
    }

    /** abre la capa del asistente (el botón «Probar» de Ajustes) */
    Function("abrirAsistente") {
      lanzar(Intent(ctx, NovaAsistenteActivity::class.java).setAction(ESCUCHAR))
    }

    /** Android 13+: el sistema pregunta si agregar la ficha «NOVA» a los ajustes rápidos. Antes: false (se agrega a mano). */
    AsyncFunction("agregarFicha") { promesa: Promise ->
      if (Build.VERSION.SDK_INT < 33) { promesa.resolve(false); return@AsyncFunction }
      val sbm = ctx.getSystemService(StatusBarManager::class.java)
      sbm.requestAddTileService(
        ComponentName(ctx, NovaFicha::class.java), "NOVA", Icon.createWithResource(ctx, R.drawable.nova_ficha),
        ctx.mainExecutor,
      ) { r -> promesa.resolve(r == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED || r == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED) }
    }

    /** cierra la capa del asistente (la ventana del servicio, o la actividad si la hospeda ella) */
    AsyncFunction("cerrarAsistente") {
      NovaCapa.instancia?.cerrar() ?: (appContext.currentActivity as? NovaAsistenteActivity)?.finish()
    }.runOnQueue(Queues.MAIN)
  }
}
