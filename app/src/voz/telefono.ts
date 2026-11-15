/* Lo que NOVA hace en el TELÉFONO (Android, modules/nova-control): música, cámara, abrir apps, linterna y volumen.
   Sirve igual en el chat de la app y en la capa del asistente (src/asistente). Cada acción devuelve lo mismo que las
   de acciones.ts; `fuera: true` marca que dejó al usuario en otra app (la capa del asistente se cierra sola). */
import { useSyncExternalStore } from 'react';
import { PermissionsAndroid } from 'react-native';
import { NovaControl, type AppMusica, type Contacto, type Conversacion, type ModoTelefono } from '../../modules/nova-control';
import type { Traductor } from '../i18n';
import type { Resultado } from './acciones';
import { alarmasRecordadas, buscarAlarma, olvidarAlarma } from './alarmas';

export const HERRAMIENTAS_TELEFONO = new Set(['control_musica', 'poner_musica', 'abrir_camara', 'abrir_app', 'linterna', 'volumen', 'redactar_mensaje', 'enviar_mensaje', 'llamar', 'navegar', 'leer_mensajes', 'modo_telefono', 'mirar',
  'ver_pantalla', 'leer_pantalla', 'tocar', 'escribir', 'desplazar', 'tecla', 'mirar_pantalla', 'burbuja', 'pantallazo', 'leer_notificaciones', 'abrir_notificacion', 'copiar', 'quitar_alarma', 'ver_alarmas']);

const SIN_MODULO = { ok: false, motivo: 'phone control needs the newer NOVA app (0.7) on Android; tell them to install the new version' };
const SIN_MODULO9 = { ok: false, motivo: 'this needs the newer NOVA app (0.9) on Android; tell them to install the new version' };
const SIN_ACCESIBILIDAD = { ok: false, motivo: 'NOVA is not enabled in Accessibility: they must turn on NOVA in Android Settings → Accessibility → NOVA (NOVA → Settings → Phone control → Use apps for you opens it). Say it in one sentence.' };
const S = (x: unknown) => (x == null ? '' : String(x).trim());
/** el id de un elemento de ver_pantalla («#12», 12, '12'), o null */
const idDe = (x: unknown) => { const n = Number(String(x ?? '').replace('#', '').trim()); return x == null || x === '' || !Number.isFinite(n) ? null : n; };

/* ── el mensaje que NOVA redactó y espera tu confirmación ──
   NOVA lo escribe (redactar_mensaje), te lo lee y lo muestra como tarjeta. Cuando dices «mándalo» (enviar_mensaje) o
   tocas «Enviar»: si ese chat tiene un mensaje sin leer (su notificación está abierta), se responde DIRECTO por ahí,
   sin abrir nada (via «notificacion»); si no, se abre WhatsApp / SMS / correo con el texto puesto y lo envías con un toque. */
export type Via = 'whatsapp' | 'sms' | 'correo' | 'notificacion';
export type Borrador = { via: Via; para: string; destino: string; texto: string; asunto?: string; /** via notificacion: la notificación que se responde y su app */ clave?: string; app?: string };
let borrador: Borrador | null = null;
const oyentes = new Set<() => void>();
const ponerBorrador = (b: Borrador | null) => { borrador = b; oyentes.forEach(o => o()); };
export const leerBorrador = () => borrador;
export const descartarBorrador = () => ponerBorrador(null);
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useBorrador() { return useSyncExternalStore(suscribir, leerBorrador, leerBorrador); }

/** manda el borrador: directo por la notificación (enviado: true) o abriendo la app con el texto listo (abierto: true) */
export async function enviarBorrador(): Promise<{ ok: boolean; enviado: boolean }> {
  const b = borrador, N = NovaControl;
  if (!b || !N) return { ok: false, enviado: false };
  if (b.via === 'notificacion' && b.clave) {
    const ok = await N.responderNotificacion(b.clave, b.texto).catch(() => false);
    if (ok) { ponerBorrador(null); return { ok: true, enviado: true }; }
    // la notificación ya no está: se abre el chat como siempre
    if (!b.destino) return { ok: false, enviado: false };
  }
  const ok = b.via === 'sms' ? N.sms(b.destino, b.texto) : b.via === 'correo' ? N.correo(b.destino, b.asunto ?? '', b.texto) : N.whatsapp(b.destino, b.texto);
  if (ok) ponerBorrador(null);
  return { ok, enviado: false };
}

/** los chats con mensajes sin leer (de sus notificaciones), y el que mejor suena como un nombre dicho */
function conversaciones(): Conversacion[] { return NovaControl?.tieneAccesoNotificaciones() ? NovaControl.conversaciones() : []; }
function conversacionDe(dicho: string): Conversacion | null {
  const palabras = sinTildes(dicho).split(/\s+/).filter(p => p.length >= 2);
  if (!palabras.length) return null;
  const puntuadas = conversaciones().filter(c => c.quien).map(c => {
    const suyas = sinTildes(c.quien!).split(/\s+/).filter(Boolean);
    return { c, p: palabras.reduce((acc, q) => acc + Math.max(...suyas.map(x => parecido(q, x))), 0) / palabras.length };
  }).filter(x => x.p >= 0.72).sort((a, b) => b.p - a.p || b.c.t - a.c.t);
  return puntuadas[0]?.c ?? null;
}

async function permiso(p: 'contactos' | 'llamadas') {
  const P = p === 'contactos' ? PermissionsAndroid.PERMISSIONS.READ_CONTACTS : PermissionsAndroid.PERMISSIONS.CALL_PHONE;
  if (await PermissionsAndroid.check(P)) return true;
  return (await PermissionsAndroid.request(P)) === PermissionsAndroid.RESULTS.GRANTED;
}

/* ── encontrar a alguien por cómo SUENA su nombre ──
   La voz llega transcrita: «Niko» puede venir como «Nico», «Benja» es «Benjamín», «Yésica» puede ser «Jessica».
   El módulo nativo compara letra por letra (y solo devuelve lo que calza), así que acá se le pide cada palabra del
   nombre y sus grafías vecinas, se juntan los candidatos y se puntúan por parecido fonético, palabra a palabra. */
const sinTildes = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
/** cómo suena en español: qu/c/k → k, c suave/z/s → s, v → b, ll/y → y, h muda, letras dobles a una */
const suena = (s: string) => sinTildes(s).replace(/qu/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/z/g, 's').replace(/v/g, 'b').replace(/ll/g, 'y').replace(/h/g, '').replace(/(.)\1+/g, '$1');
function distancia(a: string, b: string) {
  const f = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = f[0]; f[0] = i;
    for (let j = 1; j <= b.length; j++) { const tmp = f[j]; f[j] = Math.min(f[j] + 1, f[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
  }
  return f[b.length];
}
/** 0..1: cuánto se parecen dos palabras (igual → 1; suenan igual → 0,97; una empieza con la otra → 0,9; si no, por edición) */
function parecido(a: string, b: string) {
  if (a === b) return 1;
  const fa = suena(a), fb = suena(b);
  if (fa === fb) return 0.97;
  if (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.9;
  return Math.max(0, 1 - distancia(fa, fb) / Math.max(fa.length, fb.length));
}
/** grafías vecinas de una palabra, para que el módulo nativo (que compara letras) devuelva candidatos */
function grafias(p: string) {
  const v = new Set([p, p.replace(/k/g, 'c'), p.replace(/c/g, 'k'), p.replace(/z/g, 's'), p.replace(/s/g, 'z'), p.replace(/v/g, 'b'), p.replace(/b/g, 'v'), p.replace(/y/g, 'i'), p.replace(/i/g, 'y'), p.replace(/ll/g, 'y'), p.replace(/h/g, ''), p.replace(/j/g, 'g'), p.replace(/g/g, 'j')]);
  if (p.length >= 4) v.add(p.slice(0, 4)); // «Nico» encuentra a Nicolás
  return [...v].filter(x => x.length >= 2);
}
/* ── cuando hay varios (dos «Benjamín Campos»): NOVA pregunta y la capa muestra las opciones con foto ──
   Tocar una equivale a decir el nombre: la app le pasa al modelo el id y la herramienta vuelve con `contacto_id`. */
export type Candidatos = { lista: Contacto[] };
let candidatos: Candidatos | null = null;
const porId = new Map<string, Contacto>();
const oyentesC = new Set<() => void>();
const ponerCandidatos = (c: Candidatos | null) => { candidatos = c; oyentesC.forEach(o => o()); };
export const descartarCandidatos = () => { if (candidatos) ponerCandidatos(null); };
export const leerCandidatos = () => candidatos;
const suscribirC = (o: () => void) => { oyentesC.add(o); return () => { oyentesC.delete(o); }; };
export function useCandidatos() { return useSyncExternalStore(suscribirC, leerCandidatos, leerCandidatos); }

/** el contacto que mejor suena como lo que dijiste; `varios` si hay empate; `parecidos` si nadie calza del todo */
export function buscarContacto(dicho: string): { mejor: Contacto | null; puntaje: number; varios: Contacto[]; parecidos: string[] } {
  const N = NovaControl!;
  const palabras = sinTildes(dicho).split(/\s+/).filter(p => p.length >= 2);
  const candidatos = new Map<string, Contacto>();
  for (const p of palabras) for (const g of grafias(p)) for (const c of N.contactos(g)) { candidatos.set(c.id, c); porId.set(c.id, c); }
  if (!palabras.length || !candidatos.size) return { mejor: null, puntaje: 0, varios: [], parecidos: [] };
  // puntaje = promedio, por cada palabra dicha, del mejor parecido con alguna palabra del nombre
  const puntuados = [...candidatos.values()].map(c => {
    const suyas = sinTildes(c.nombre).split(/\s+/).filter(Boolean);
    const p = palabras.reduce((acc, q) => acc + Math.max(...suyas.map(s => parecido(q, s))), 0) / palabras.length;
    // decir dos palabras que calzan («Niko Richardson») vale más que una sola
    return { c, p: p * (palabras.length > 1 ? 1 : 0.97) };
  }).sort((a, b) => b.p - a.p);
  const mejor = puntuados[0];
  const varios = puntuados.filter(x => x.p >= mejor.p - 0.04).map(x => x.c);
  return { mejor: mejor.p >= 0.72 ? mejor.c : null, puntaje: mejor.p, varios, parecidos: puntuados.slice(0, 3).map(x => x.c.nombre) };
}

/** a quién: un número dicho tal cual, o el contacto que mejor suena. Si hay varios igual de probables, se pregunta. */
type Quien = { ok: true; c: Contacto } | { ok: false; respuesta: Record<string, unknown> };
async function quien(para: string, id?: string): Promise<Quien> {
  // eligió en pantalla (o el modelo ya sabe el id): ese y no otro
  if (id && porId.has(id)) { descartarCandidatos(); return { ok: true, c: porId.get(id)! }; }
  const digitos = para.replace(/[^\d+]/g, '');
  if (digitos.replace('+', '').length >= 8) return { ok: true, c: { id: digitos, nombre: para, puntaje: 5, telefonos: [digitos], correos: [], whatsapp: true } };
  if (!(await permiso('contactos'))) return { ok: false, respuesta: { ok: false, motivo: 'no permission to read contacts; they must allow Contacts for NOVA' } };
  const b = buscarContacto(para);
  if (!b.mejor) return { ok: false, respuesta: { ok: false, motivo: `no contact sounds like "${para}"`, ...(b.parecidos.length ? { parecidos: b.parecidos, sugerencia: 'ask if they meant one of these (say the names)' } : { sugerencia: 'ask who exactly, or for the number' }) } };
  // dos o más igual de probables (dos «Benjamín Campos»): se muestran con foto y número, y NOVA pregunta
  if (b.varios.length > 1 && b.puntaje < 0.97) {
    ponerCandidatos({ lista: b.varios.slice(0, 4) });
    return { ok: false, respuesta: { ok: false, varios: b.varios.slice(0, 4).map(c => ({ contacto_id: c.id, nombre: c.nombre, telefono_termina_en: c.telefonos[0]?.slice(-4) ?? null })), motivo: 'several contacts match; they are shown on screen with photos: ask which one (by name or by the last digits); they may tap one, then you get its contacto_id' } };
  }
  descartarCandidatos();
  return { ok: true, c: b.mejor };
}

export async function ejecutarTelefono(nombre: string, a: Record<string, unknown>, t: Traductor['t']): Promise<(Resultado & { fuera?: boolean }) | null> {
  if (!HERRAMIENTAS_TELEFONO.has(nombre)) return null;
  const N = NovaControl;
  if (!N) return { respuesta: SIN_MODULO };
  switch (nombre) {
    case 'control_musica': {
      const accion = S(a.accion);
      if (accion === 'que_suena') {
        const x = N.ahora();
        if (!x.acceso) return { respuesta: { ok: false, suena: x.suena, motivo: 'no access to what is playing: they can allow it in NOVA → Settings → Phone control (notification access)' } };
        if (!x.titulo) return { respuesta: { ok: true, suena: false, nada: true } };
        return { respuesta: { ok: true, suena: x.suena, app: x.app, titulo: x.titulo, artista: x.artista, album: x.album } };
      }
      if (!['pausar', 'reanudar', 'siguiente', 'anterior'].includes(accion)) return { respuesta: { ok: false, motivo: 'unknown action' } };
      const r = N.media(accion as 'pausar');
      const texto = { pausar: t('Paused'), reanudar: t('Playing'), siguiente: t('Next song'), anterior: t('Previous song') }[accion as 'pausar'];
      const icono = { pausar: 'pause', reanudar: 'play', siguiente: 'play-skip-forward', anterior: 'play-skip-back' }[accion as 'pausar'];
      return { respuesta: { ok: true, app: r.app ?? undefined }, accion: { icono, texto: r.app ? `${texto} · ${r.app}` : texto } };
    }
    case 'poner_musica': {
      const q = S(a.busqueda);
      if (!q) return { respuesta: { ok: false, motivo: 'need what to play' } };
      const app = (['spotify', 'youtube_music'] as const).includes(a.app as AppMusica) ? (a.app as AppMusica) : null;
      const r = N.poner(q, app, S(a.tipo) || null);
      if (!r.ok) return { respuesta: { ok: false, motivo: r.motivo ?? 'could not open the music app' } };
      const donde = r.app === 'spotify' ? 'Spotify' : 'YouTube Music';
      return {
        // «buscar»: la app no aceptó reproducir directo, quedó abierta con la búsqueda hecha
        respuesta: { ok: true, app: donde, modo: r.modo, ...(r.modo === 'buscar' ? { nota: 'opened the search; they need to tap the result' } : {}) },
        accion: { icono: 'musical-notes', texto: `${q} · ${donde}`, donde },
        fuera: true,
      };
    }
    case 'abrir_camara': {
      const modo: 'foto' | 'video' | 'selfie' = a.modo === 'video' || a.modo === 'selfie' ? a.modo : 'foto';
      if (!N.camara(modo)) return { respuesta: { ok: false, motivo: 'no camera app answered' } };
      return { respuesta: { ok: true, modo }, accion: { icono: modo === 'video' ? 'videocam' : 'camera', texto: t(modo === 'video' ? 'Camera opened in video' : modo === 'selfie' ? 'Camera opened for a selfie' : 'Camera opened') }, fuera: true };
    }
    case 'abrir_app': {
      const r = N.abrirApp(S(a.nombre));
      if (!r) return { respuesta: { ok: false, motivo: `no installed app matches "${S(a.nombre)}"` } };
      return { respuesta: { ok: true, app: r.app }, accion: { icono: 'apps', texto: t('Opened {x}', { x: r.app }) }, fuera: true };
    }
    case 'linterna': {
      const on = a.encender !== false;
      if (!N.linterna(on)) return { respuesta: { ok: false, motivo: 'this phone has no flashlight' } };
      return { respuesta: { ok: true, encendida: on }, accion: { icono: on ? 'flashlight' : 'flashlight-outline', texto: t(on ? 'Flashlight on' : 'Flashlight off') } };
    }
    case 'volumen': {
      const accion = (['subir', 'bajar', 'silenciar', 'nivel'] as const).includes(a.accion as 'subir') ? (a.accion as 'subir') : 'nivel';
      const v = N.volumen(accion, a.nivel == null ? null : Number(a.nivel));
      return { respuesta: { ok: true, volumen_pct: v }, accion: { icono: v === 0 ? 'volume-mute' : 'volume-high', texto: t('Volume {n}%', { n: v }) } };
    }
    case 'redactar_mensaje': {
      const texto = S(a.texto), para = S(a.para);
      if (!texto || !para) return { respuesta: { ok: false, motivo: 'need who and the message' } };
      const via: Via = a.via === 'sms' || a.via === 'correo' ? a.via : 'whatsapp';
      // si esa persona te escribió y el mensaje sigue sin leer, se responde directo por la notificación, sin abrir nada
      const chat = via !== 'correo' && !a.contacto_id ? conversacionDe(para) : null;
      if (chat?.puedeResponder) {
        ponerBorrador({ via: 'notificacion', para: chat.quien!, destino: '', texto, clave: chat.clave, app: chat.app });
        return { respuesta: { ok: true, para: chat.quien, via: chat.app, directo: true, estado: 'draft shown on screen; read it back briefly and ask if it is ok; after their yes it is SENT directly (no app opens)' }, visual: { tipo: 'mensaje' } };
      }
      const q = await quien(para, S(a.contacto_id) || undefined);
      if (!q.ok) return { respuesta: q.respuesta };
      const destino = via === 'correo' ? q.c.correos[0] : q.c.telefonos[0];
      if (!destino) return { respuesta: { ok: false, motivo: via === 'correo' ? `${q.c.nombre} has no email saved` : `${q.c.nombre} has no phone number saved` } };
      ponerBorrador({ via, para: q.c.nombre, destino, texto, asunto: S(a.asunto) || undefined });
      return {
        respuesta: { ok: true, para: q.c.nombre, via, directo: false, ...(via === 'whatsapp' && !q.c.whatsapp ? { aviso: 'this contact may not have WhatsApp' } : {}), estado: 'draft shown on screen; read it back briefly and ask if it is ok; after their yes the chat opens with the text and they tap send' },
        visual: { tipo: 'mensaje' },
      };
    }
    case 'enviar_mensaje': {
      const b = leerBorrador();
      if (!b) return { respuesta: { ok: false, motivo: 'there is no draft; write it first with redactar_mensaje' } };
      const r = await enviarBorrador();
      if (!r.ok) return { respuesta: { ok: false, motivo: b.via === 'whatsapp' ? 'WhatsApp is not installed' : 'could not send or open the app' } };
      const app = b.via === 'notificacion' ? (b.app ?? 'WhatsApp') : b.via === 'whatsapp' ? 'WhatsApp' : b.via === 'sms' ? 'SMS' : t('Email');
      if (r.enviado) return { respuesta: { ok: true, enviado: true, nota: 'sent; say so in two words' }, accion: { icono: 'checkmark-done', texto: t('Sent to {x} · {y}', { x: b.para, y: app }) } };
      return { respuesta: { ok: true, enviado: false, nota: 'the chat is open with the message written; they tap send' }, accion: { icono: 'paper-plane', texto: t('Message for {x} ready in {y}', { x: b.para, y: app }) }, fuera: true };
    }
    case 'leer_mensajes': {
      if (!N.tieneAccesoNotificaciones()) return { respuesta: { ok: false, motivo: 'no notification access: they can allow it in NOVA → Settings → Phone control → Music and chats' } };
      const de = S(a.de);
      const lista = de ? [conversacionDe(de)].filter((c): c is Conversacion => !!c) : conversaciones();
      if (!lista.length) return { respuesta: { ok: true, nada: true, motivo: de ? `no unread chat from "${de}" (only chats with an open notification are visible)` : 'no unread chats right now (only chats with an open notification are visible)' } };
      return { respuesta: { ok: true, chats: lista.slice(0, 6).map(c => ({ quien: c.quien, app: c.app, grupo: c.grupo, mensajes: (c.mensajes.length ? c.mensajes.slice(-5) : [{ de: c.quien, texto: c.ultimo }]).map(m => ({ de: m.de, texto: m.texto })), puede_responder: c.puedeResponder })) } };
    }
    case 'modo_telefono': {
      const modos: ModoTelefono[] = ['normal', 'vibrar', 'silencio', 'no_molestar', 'solo_alarmas'];
      const modo = modos.includes(a.modo as ModoTelefono) ? (a.modo as ModoTelefono) : null;
      if (!modo) return { respuesta: { ok: false, motivo: 'unknown mode' } };
      if (!N.tienePermisoNoMolestar()) return { respuesta: { ok: false, motivo: 'needs the Do not disturb permission: NOVA → Settings → Phone control → Do not disturb by voice' } };
      if (!N.modoTelefono(modo)) return { respuesta: { ok: false, motivo: 'could not change the mode' } };
      const nombre = { normal: t('Normal'), vibrar: t('Vibrate'), silencio: t('Silent'), no_molestar: t('Do not disturb'), solo_alarmas: t('Alarms only') }[modo];
      const icono = { normal: 'volume-high', vibrar: 'phone-portrait', silencio: 'volume-mute', no_molestar: 'moon', solo_alarmas: 'alarm' }[modo];
      return { respuesta: { ok: true, modo }, accion: { icono, texto: t('Phone on {x}', { x: nombre }) } };
    }
    case 'mirar': {
      // la cámara en vivo la maneja la capa del asistente (src/asistente); en el chat de la app no hay cámara
      return { respuesta: { ok: false, motivo: 'the live camera only works in the assistant overlay (hold the power button); here they can open the camera app with abrir_camara' } };
    }
    // ── ver y usar la app que está en pantalla (accesibilidad) ──
    case 'ver_pantalla': {
      if (!N.pantalla) return { respuesta: SIN_MODULO9 };
      if (!N.accesibilidadActiva?.()) return { respuesta: SIN_ACCESIBILIDAD };
      return { respuesta: await N.pantalla(true) };
    }
    case 'leer_pantalla': {
      if (!N.leerPantalla) return { respuesta: SIN_MODULO9 };
      if (!N.accesibilidadActiva?.()) return { respuesta: SIN_ACCESIBILIDAD };
      return { respuesta: await N.leerPantalla() };
    }
    case 'tocar': {
      if (!N.tocar || !N.tocarTexto) return { respuesta: SIN_MODULO9 };
      if (!N.accesibilidadActiva?.()) return { respuesta: SIN_ACCESIBILIDAD };
      const id = idDe(a.elemento);
      if (id != null) return { respuesta: await N.tocar(id) };
      const texto = S(a.texto);
      if (!texto) return { respuesta: { ok: false, motivo: 'need elemento (an id from ver_pantalla) or texto (what it says)' } };
      return { respuesta: await N.tocarTexto(texto) };
    }
    case 'escribir': {
      if (!N.escribir) return { respuesta: SIN_MODULO9 };
      if (!N.accesibilidadActiva?.()) return { respuesta: SIN_ACCESIBILIDAD };
      const texto = S(a.texto);
      if (!texto) return { respuesta: { ok: false, motivo: 'need texto' } };
      return { respuesta: await N.escribir(idDe(a.elemento), texto, a.enviar === true) };
    }
    case 'desplazar': {
      if (!N.desplazar) return { respuesta: SIN_MODULO9 };
      if (!N.accesibilidadActiva?.()) return { respuesta: SIN_ACCESIBILIDAD };
      const dir = ['abajo', 'arriba', 'izquierda', 'derecha'].includes(String(a.direccion)) ? String(a.direccion) : 'abajo';
      return { respuesta: await N.desplazar(dir, idDe(a.elemento)) };
    }
    case 'tecla': {
      if (!N.tecla) return { respuesta: SIN_MODULO9 };
      if (!N.accesibilidadActiva?.()) return { respuesta: SIN_ACCESIBILIDAD };
      const cual = (['atras', 'inicio', 'recientes', 'notificaciones'] as const).find(x => x === a.cual);
      if (!cual) return { respuesta: { ok: false, motivo: 'unknown key' } };
      return { respuesta: { ok: N.tecla(cual) } };
    }
    case 'pantallazo': {
      if (!N.pantallazo) return { respuesta: SIN_MODULO9 };
      if (!N.accesibilidadActiva?.()) return { respuesta: SIN_ACCESIBILIDAD };
      const r = await N.pantallazo();
      if (!r.ok) return { respuesta: r };
      return { respuesta: { ok: true, modo: r.modo, nota: 'saved to the gallery; say so in two words. If they also want you to read or describe it, call mirar_pantalla' }, accion: { icono: 'image-outline', texto: t('Screenshot saved') } };
    }
    case 'mirar_pantalla': case 'burbuja':
      // las maneja la capa del asistente (src/asistente), que tiene la ventana y el canal de imágenes
      return { respuesta: { ok: false, motivo: 'only from the assistant overlay (hold the power button)' } };
    // ── notificaciones de cualquier app ──
    case 'leer_notificaciones': {
      if (!N.notificaciones) return { respuesta: SIN_MODULO9 };
      if (!N.tieneAccesoNotificaciones()) return { respuesta: { ok: false, motivo: 'no notification access: they can allow it in NOVA → Settings → Phone control → Music and chats' } };
      const de = S(a.de).toLowerCase(), cuantas = Math.min(10, Math.max(1, Number(a.cuantas) || 5));
      let lista = N.notificaciones(20);
      if (de) lista = lista.filter(n => [n.app, n.quien ?? ''].some(x => x.toLowerCase().includes(de)));
      if (!lista.length) return { respuesta: { ok: true, nada: true, motivo: de ? `no open notification from "${S(a.de)}"` : 'no notifications right now (only the ones still in the shade are visible)' } };
      const ahora = Date.now();
      return { respuesta: { ok: true, notificaciones: lista.slice(0, cuantas).map(n => ({ clave: n.clave, app: n.app, de: n.quien, texto: n.texto ?? n.ultimo, hace_min: Math.max(0, Math.round((ahora - n.t) / 60000)), chat: n.chat, puede_responder: n.puedeResponder })) } };
    }
    case 'abrir_notificacion': {
      if (!N.abrirNotificacion || !N.notificaciones) return { respuesta: SIN_MODULO9 };
      if (!N.tieneAccesoNotificaciones()) return { respuesta: { ok: false, motivo: 'no notification access' } };
      const lista = N.notificaciones(20), de = S(a.de).toLowerCase(), clave = S(a.clave);
      const n = (clave && lista.find(x => x.clave === clave)) || (de ? lista.find(x => [x.app, x.quien ?? ''].some(y => y.toLowerCase().includes(de))) : lista[0]);
      if (!n) return { respuesta: { ok: false, motivo: 'that notification is no longer there' } };
      if (!N.abrirNotificacion(n.clave)) return { respuesta: { ok: false, motivo: 'that notification cannot be opened' } };
      return { respuesta: { ok: true, abierto: n.app }, accion: { icono: 'open-outline', texto: t('Opened {x}', { x: n.quien ? `${n.quien} · ${n.app}` : n.app }) }, fuera: true };
    }
    case 'copiar': {
      if (!N.copiar) return { respuesta: SIN_MODULO9 };
      const texto = S(a.texto);
      if (!texto) return { respuesta: { ok: false, motivo: 'need texto' } };
      N.copiar(texto);
      return { respuesta: { ok: true }, accion: { icono: 'copy-outline', texto: t('Copied') } };
    }
    // ── alarmas del Reloj: NOVA recuerda las que puso y las quita por nombre o por hora ──
    case 'quitar_alarma': {
      if (!N.quitarAlarma) return { respuesta: SIN_MODULO9 };
      const etiqueta = S(a.etiqueta), m = S(a.hora).match(/(\d{1,2})[:.h]?(\d{2})?/);
      const horaTxt = m ? `${String(Math.min(23, Number(m[1]))).padStart(2, '0')}:${String(Math.min(59, Number(m[2] ?? 0))).padStart(2, '0')}` : undefined;
      const recordada = await buscarAlarma({ etiqueta: etiqueta || undefined, hora: horaTxt });
      // la que NOVA puso con ese nombre manda: el Reloj busca por el texto exacto
      const eti = recordada?.etiqueta ?? (etiqueta || null);
      const hora = recordada?.hora ?? horaTxt;
      if (!eti && !hora) return { respuesta: { ok: false, motivo: 'need the alarm label or its time', alarmas_que_pusiste: alarmasRecordadas() } };
      const ok = eti ? N.quitarAlarma(eti, null, null) : N.quitarAlarma(null, Number(hora!.slice(0, 2)), Number(hora!.slice(3, 5)));
      if (!ok) return { respuesta: { ok: false, motivo: 'the Clock app did not answer; open it with ver_alarmas' } };
      if (recordada) olvidarAlarma(recordada);
      const que = eti ?? hora!;
      return { respuesta: { ok: true, alarma: que, nota: 'if the Clock has several alarms with that label it asks them on screen' }, accion: { icono: 'alarm-outline', texto: t('Alarm «{x}» off', { x: que }) } };
    }
    case 'ver_alarmas': {
      if (!N.verAlarmas) return { respuesta: SIN_MODULO9 };
      return { respuesta: { ok: N.verAlarmas(), alarmas_que_pusiste: alarmasRecordadas() }, accion: { icono: 'alarm-outline', texto: t('Your alarms') }, fuera: true };
    }
    case 'llamar': {
      const q = await quien(S(a.a), S(a.contacto_id) || undefined);
      if (!q.ok) return { respuesta: q.respuesta };
      const tel = q.c.telefonos[0];
      if (!tel) return { respuesta: { ok: false, motivo: `${q.c.nombre} has no phone number saved` } };
      await permiso('llamadas');
      if (!N.llamar(tel)) return { respuesta: { ok: false, motivo: 'could not start the call' } };
      return { respuesta: { ok: true, a: q.c.nombre }, accion: { icono: 'call', texto: t('Calling {x}', { x: q.c.nombre }) }, fuera: true };
    }
    case 'navegar': {
      const destino = S(a.destino);
      if (!destino) return { respuesta: { ok: false, motivo: 'need a destination' } };
      if (!N.navegar(destino, S(a.modo) || null, S(a.app) || null)) return { respuesta: { ok: false, motivo: 'no maps app answered' } };
      return { respuesta: { ok: true }, accion: { icono: 'navigate', texto: t('On the way to {x}', { x: destino }) }, fuera: true };
    }
  }
  return null;
}
