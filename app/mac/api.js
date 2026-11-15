/* Cliente de la API de NOVA (api/servidor.mjs) desde el Mac: la misma cuenta, tareas y listas que el teléfono. */

class ErrorApi extends Error {
  constructor(estado, mensaje) { super(mensaje); this.estado = estado; }
}

/** YYYY-MM-DD en la hora local */
const fechaDe = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function crearApi(base, sesion) {
  let yoCache = null;

  async function pedir(ruta, o = {}) {
    const token = sesion.leer(), cab = {};
    if (token && !o.sinSesion) cab.authorization = `Bearer ${token}`;
    if (o.json !== undefined) cab['content-type'] = 'application/json';
    let r;
    try {
      r = await fetch(`${base}${ruta}`, { method: o.metodo ?? (o.json !== undefined ? 'POST' : 'GET'), headers: cab, body: o.json !== undefined ? JSON.stringify(o.json) : undefined, signal: AbortSignal.timeout(12000) });
    } catch { throw new ErrorApi(0, 'Sin conexión con la API de NOVA'); }
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new ErrorApi(r.status, j?.error ?? `Error ${r.status}`);
    return j;
  }

  async function yo() {
    const r = await pedir('/v1/yo');
    yoCache = { usuario: r.usuario, crew: r.crews?.[0] ?? null };
    return yoCache;
  }

  async function entrar(email, clave) {
    const r = await pedir('/v1/entrar', { json: { email, clave }, sinSesion: true });
    sesion.guardar(r.token);
    return yo();
  }

  /* tareas y listas quedan precargadas: abrir la conversación no espera a la API. Se recargan en segundo plano si
     tienen más de 1 min, y se descartan cuando una herramienta pudo cambiarlas (invalidar) */
  let datos = null;
  function cargar() {
    const p = Promise.all([
      yoCache ? Promise.resolve(yoCache) : yo().catch(() => null),
      pedir('/v1/tareas').catch(() => null),
      pedir('/v1/listas').catch(() => null),
    ]).then(r => { if (!r[1] || !r[2]) { if (datos?.p === p) datos = null; } else if (datos?.p === p) datos.r = r; return r; });
    datos = { p, t: Date.now(), r: datos?.r ?? null };
    return p;
  }
  function precargar() { if (sesion.leer() && (!datos || Date.now() - datos.t > 60e3)) cargar(); }
  function invalidar() { datos = null; if (sesion.leer()) cargar(); }

  /** lo que NOVA sabe al abrir la conversación en el Mac: el día, las tareas, las listas y qué puede hacer aquí */
  async function contexto() {
    const ahora = Date.now();
    // lo último que se tiene, al tiro; si no hay nada aún, se espera la carga
    const vigente = datos?.r && ahora - datos.t < 5 * 60e3 ? datos.r : null;
    precargar();
    const [y, t, l] = vigente ?? await (datos?.p ?? cargar());
    const tareas = t ?? [], listas = l ?? [];
    const pend = tareas.filter(x => !x.hecha), hechas = tareas.filter(x => x.hecha);
    const uid = y?.usuario?.id;
    const aCargo = x => (x.asignados?.length ? x.asignados : x.asignado ? [x.asignado] : []);
    const linea = x => `"${x.titulo}"${x.vence ? ` (due ${x.vence})` : ''}${x.crew ? (aCargo(x).includes(uid) ? ' [crew, assigned to them]' : ' [crew]') : ''}`;
    return [
      `Now: ${new Date(ahora).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} (their local time). Today's date: ${fechaDe(ahora)}.`,
      `Name: ${y?.usuario?.nombre ?? 'Nico'}.`,
      pend.length ? `Open tasks (${pend.length}): ${pend.slice(0, 15).map(linea).join('; ')}.` : 'No open tasks.',
      hechas.length ? `Done recently: ${hechas.slice(0, 8).map(x => `"${x.titulo}"`).join(', ')}.` : '',
      listas.length ? `Their lists: ${listas.map(l => `${l.nombre} (${l.items.filter(i => !i.hecho).length} pending)`).join(', ')}.` : '',
      y?.crew ? `Crew "${y.crew.nombre}": ${y.crew.miembros.map(m => m.nombre).join(', ')}.` : '',
      `WHERE THEY ARE: talking to you from the NOVA widget floating on their Mac desktop (their work computer).
On the Mac: tasks and lists, the crew log, GitHub, open Mac apps, music, volume, copy, a screenshot of the Mac (saved to the Desktop), look at or read the Mac screen (mirar_pantalla / leer_pantalla send you a picture of it), directions, and reminders or timers as Mac notifications while the widget is open.
Everything else (alarms, phone calendar, habits, memory, journal, messages, calls, notifications, flashlight, phone screenshot…) runs on their phone at a distance: use the same tools. If a tool answers pendiente=true, the NOVA app is closed on the phone and it will run when they tap the notification: say so in a few words.`,
    ].filter(Boolean).join('\n');
  }

  return { pedir, yo, entrar, contexto, precargar, invalidar, crew: () => yoCache?.crew ?? null, usuario: () => yoCache?.usuario ?? null };
}

module.exports = { crearApi, ErrorApi, fechaDe };
