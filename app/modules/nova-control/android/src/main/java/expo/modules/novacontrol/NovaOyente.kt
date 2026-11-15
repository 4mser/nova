// Acceso a notificaciones (lo das tú en Ajustes). Sirve para tres cosas:
//  · que Android le dé a NOVA las sesiones de música (qué suena y en qué app)
//  · leer y responder los chats con mensajes sin leer (WhatsApp, SMS…) directo desde su notificación, sin abrir la app:
//    la misma «respuesta rápida» que usa el auto o el reloj
//  · leer la última notificación que te llegó, de cualquier app («¿qué dice la última notificación?»)
// Solo se guardan en memoria las notificaciones que están abiertas; no se mandan a ningún lado salvo lo que NOVA
// necesita para responderte en ese momento, y se olvidan cuando la notificación se va.
package expo.modules.novacontrol

import android.app.Notification
import android.app.RemoteInput
import android.content.Intent
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class NovaOyente : NotificationListenerService() {
  companion object {
    /** apps de mensajes cuyas notificaciones se entienden como conversaciones */
    val MENSAJERIA = setOf("com.whatsapp", "com.whatsapp.w4b", "org.telegram.messenger", "org.thoughtcrime.securesms", "com.google.android.apps.messaging", "com.samsung.android.messaging", "com.instagram.android")
    /** clave de la notificación → la notificación (con su acción de responder) */
    private val abiertas = LinkedHashMap<String, StatusBarNotification>()
    /** todas las notificaciones abiertas que dicen algo (de cualquier app), por clave */
    private val todas = LinkedHashMap<String, StatusBarNotification>()
    @Volatile private var propio = ""

    @Synchronized fun conversaciones(): List<Map<String, Any?>> = abiertas.values.sortedByDescending { it.postTime }.map { resumen(it) }

    /** las últimas notificaciones de cualquier app, la más nueva primero */
    @Synchronized fun notificaciones(cuantas: Int): List<Map<String, Any?>> =
      todas.values.sortedByDescending { it.postTime }.take(cuantas.coerceIn(1, 20)).map { resumen(it) }

    @Synchronized fun responder(clave: String, texto: String, ctx: android.content.Context): Boolean {
      val sbn = abiertas[clave] ?: todas[clave] ?: return false
      val accion = accionResponder(sbn.notification) ?: return false
      val entrada = accion.remoteInputs?.firstOrNull() ?: return false
      val i = Intent()
      val b = Bundle(); b.putCharSequence(entrada.resultKey, texto)
      RemoteInput.addResultsToIntent(accion.remoteInputs, i, b)
      return try { accion.actionIntent.send(ctx, 0, i); true } catch (e: Exception) { false }
    }

    /** abre lo que la notificación abre al tocarla (el correo, el chat, el pedido) */
    @Synchronized fun abrir(clave: String): Boolean {
      val sbn = todas[clave] ?: abiertas[clave] ?: return false
      val pi = sbn.notification.contentIntent ?: return false
      return try { pi.send(); true } catch (e: Exception) { false }
    }

    private fun accionResponder(n: Notification): Notification.Action? =
      n.actions?.firstOrNull { a -> a.remoteInputs?.any { !it.isDataOnly } == true }

    private fun texto(e: Bundle): String? =
      e.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.takeIf { it.isNotBlank() }
        ?: e.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.takeIf { it.isNotBlank() }
        ?: e.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.joinToString(" · ")?.takeIf { it.isNotBlank() }
        ?: e.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()?.takeIf { it.isNotBlank() }

    private fun resumen(sbn: StatusBarNotification): Map<String, Any?> {
      val n = sbn.notification; val e = n.extras
      val mensajes = ArrayList<Map<String, Any?>>()
      (e.getParcelableArray(Notification.EXTRA_MESSAGES) ?: emptyArray()).forEach { m ->
        val mb = m as? Bundle ?: return@forEach
        val de = mb.getCharSequence("sender")?.toString() ?: (mb.getParcelable<android.app.Person>("sender_person")?.name?.toString())
        mensajes.add(mapOf("de" to de, "texto" to mb.getCharSequence("text")?.toString(), "t" to mb.getLong("time")))
      }
      return mapOf(
        "clave" to sbn.key, "paquete" to sbn.packageName,
        "quien" to (e.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString() ?: e.getCharSequence(Notification.EXTRA_TITLE)?.toString()),
        "grupo" to e.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION, false),
        "ultimo" to (e.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: texto(e)),
        "texto" to texto(e),
        "mensajes" to mensajes, "t" to sbn.postTime,
        "chat" to (sbn.packageName in MENSAJERIA),
        "puedeResponder" to (accionResponder(n) != null),
      )
    }

    @Synchronized private fun anotar(sbn: StatusBarNotification) {
      val n = sbn.notification
      if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
      // lo fijo (música sonando, servicios, descargas) no es «una notificación que te llegó»
      val fija = n.flags and Notification.FLAG_ONGOING_EVENT != 0 || n.flags and Notification.FLAG_FOREGROUND_SERVICE != 0
      val dice = n.extras.getCharSequence(Notification.EXTRA_TITLE) != null || texto(n.extras) != null
      if (sbn.packageName != propio && !fija && dice) todas[sbn.key] = sbn else todas.remove(sbn.key)
      if (todas.size > 60) todas.remove(todas.keys.first())
      if (sbn.packageName !in MENSAJERIA) return
      // solo lo que es una conversación de verdad: trae mensajes o se puede responder
      val esChat = n.extras.getParcelableArray(Notification.EXTRA_MESSAGES)?.isNotEmpty() == true || accionResponder(n) != null
      if (esChat) abiertas[sbn.key] = sbn else abiertas.remove(sbn.key)
    }
    @Synchronized private fun olvidar(clave: String) { abiertas.remove(clave); todas.remove(clave) }
    @Synchronized private fun limpiar() { abiertas.clear(); todas.clear() }
  }

  override fun onListenerConnected() { propio = packageName; try { activeNotifications?.forEach { anotar(it) } } catch (e: Exception) {} }
  override fun onListenerDisconnected() { limpiar() }
  override fun onNotificationPosted(sbn: StatusBarNotification) { anotar(sbn) }
  override fun onNotificationRemoved(sbn: StatusBarNotification) { olvidar(sbn.key) }
}
