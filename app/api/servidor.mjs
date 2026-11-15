/* API de NOVA: cuentas, tripulación (crew), fotos del día, tareas, estado compartido y retos, con aviso en tiempo real.
   Un solo proceso Node (22+) con SQLite (node:sqlite) y las fotos en disco, ambos en el volumen /data de Fly.
   Sin dependencias salvo `ws`. Las cuentas las crea el administrador (POST /v1/admin/cuentas con x-admin).

   Tiempo real: WebSocket en /v1/vivo?k=<token>. El servidor solo avisa «algo cambió» ({tipo, crew, id?}) y la app
   vuelve a pedir lo que le toca: así nunca viajan por el socket datos que la app no podría leer por HTTP.

   Uso local: DATOS=./datos SECRETO=x ADMIN=y node --no-warnings servidor.mjs   (puerto 8140) */
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer } from 'ws';

const PUERTO = Number(process.env.PUERTO ?? 8140);
const DATOS = process.env.DATOS ?? '/data';
const SECRETO = process.env.SECRETO;
const ADMIN = process.env.ADMIN;
if (!SECRETO || !ADMIN) throw new Error('Faltan SECRETO y ADMIN');
const FOTOS = join(DATOS, 'fotos');
mkdirSync(FOTOS, { recursive: true });
const MAX_FOTO = 6 * 1024 * 1024;
const ZONA = 'America/Santiago';

/* ─────────── base de datos ─────────── */
const db = new DatabaseSync(join(DATOS, 'nova.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, nombre TEXT NOT NULL, hash TEXT NOT NULL,
  foto TEXT, version INTEGER NOT NULL DEFAULT 1, creado INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS crews (
  id TEXT PRIMARY KEY, nombre TEXT NOT NULL, codigo TEXT UNIQUE NOT NULL, zona TEXT NOT NULL,
  creado_por TEXT NOT NULL REFERENCES usuarios(id), creado INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS miembros (
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE, usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  rol TEXT NOT NULL DEFAULT 'miembro', unido INTEGER NOT NULL, PRIMARY KEY (crew_id, usuario_id)
);
CREATE TABLE IF NOT EXISTS fotos (
  id TEXT PRIMARY KEY, crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE, usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL, ts INTEGER NOT NULL, texto TEXT, a_tiempo INTEGER NOT NULL DEFAULT 0, ancho INTEGER, alto INTEGER
);
CREATE INDEX IF NOT EXISTS fotos_crew_fecha ON fotos (crew_id, fecha);
CREATE TABLE IF NOT EXISTS reacciones (
  foto_id TEXT NOT NULL REFERENCES fotos(id) ON DELETE CASCADE, usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (foto_id, usuario_id, emoji)
);
CREATE TABLE IF NOT EXISTS tareas (
  id TEXT PRIMARY KEY, crew_id TEXT REFERENCES crews(id) ON DELETE CASCADE, creador TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  asignado TEXT REFERENCES usuarios(id) ON DELETE SET NULL, titulo TEXT NOT NULL, nota TEXT, vence TEXT,
  hecha_por TEXT REFERENCES usuarios(id) ON DELETE SET NULL, hecha_ts INTEGER, orden INTEGER NOT NULL DEFAULT 0, creado INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tareas_crew ON tareas (crew_id);
CREATE INDEX IF NOT EXISTS tareas_creador ON tareas (creador);
CREATE TABLE IF NOT EXISTS estados (
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE, usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL, datos TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (crew_id, usuario_id, fecha)
);
CREATE TABLE IF NOT EXISTS retos (
  id TEXT PRIMARY KEY, crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE, creador TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL, metrica TEXT NOT NULL, meta REAL NOT NULL, desde TEXT NOT NULL, hasta TEXT NOT NULL, creado INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bitacora (
  id TEXT PRIMARY KEY, crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE, usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL, tipo TEXT NOT NULL DEFAULT 'nota', texto TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bitacora_crew_ts ON bitacora (crew_id, ts);
CREATE TABLE IF NOT EXISTS metas (
  id TEXT PRIMARY KEY, crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE, creador TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL, desde TEXT NOT NULL, hasta TEXT NOT NULL, creado INTEGER NOT NULL, cerrada INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS resultados (
  id TEXT PRIMARY KEY, meta_id TEXT NOT NULL REFERENCES metas(id) ON DELETE CASCADE, titulo TEXT NOT NULL,
  responsable TEXT REFERENCES usuarios(id) ON DELETE SET NULL, tipo TEXT NOT NULL DEFAULT 'hito', meta REAL NOT NULL DEFAULT 1,
  actual REAL NOT NULL DEFAULT 0, unidad TEXT, orden INTEGER NOT NULL DEFAULT 0, actualizado INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS resultados_meta ON resultados (meta_id);
CREATE TABLE IF NOT EXISTS prefs_avisos (usuario_id TEXT PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE, datos TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS envios (clave TEXT PRIMARY KEY, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS dispositivos (
  token TEXT PRIMARY KEY, usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, idioma TEXT NOT NULL DEFAULT 'es', ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dispositivos_usuario ON dispositivos (usuario_id);
CREATE TABLE IF NOT EXISTS errores (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, usuario_id TEXT, version TEXT, plataforma TEXT,
  donde TEXT, mensaje TEXT NOT NULL, pila TEXT, fatal INTEGER NOT NULL DEFAULT 0
);
`);

const nuevoId = () => randomBytes(9).toString('base64url');
const uno = (sql, ...a) => db.prepare(sql).get(...a);
const todos = (sql, ...a) => db.prepare(sql).all(...a);
const correr = (sql, ...a) => db.prepare(sql).run(...a);

/* ─────────── claves y sesiones ─────────── */
function hashClave(clave) {
  const sal = randomBytes(16);
  return `s1$${sal.toString('base64')}$${scryptSync(clave, sal, 32).toString('base64')}`;
}
function claveOk(clave, hash) {
  const [, sal, h] = hash.split('$');
  const a = scryptSync(clave, Buffer.from(sal, 'base64'), 32), b = Buffer.from(h, 'base64');
  return a.length === b.length && timingSafeEqual(a, b);
}
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const firma = s => createHmac('sha256', SECRETO).update(s).digest('base64url');
/** sesión de 120 días; `v` cambia al cambiar la clave y deja sin efecto las sesiones anteriores */
function emitir(u) {
  const cuerpo = b64({ u: u.id, v: u.version, exp: Date.now() + 120 * 864e5 });
  return `${cuerpo}.${firma(cuerpo)}`;
}
function sesion(token) {
  if (!token) return null;
  const [cuerpo, f] = token.split('.');
  if (!cuerpo || !f) return null;
  const esperado = Buffer.from(firma(cuerpo)), dado = Buffer.from(f);
  if (esperado.length !== dado.length || !timingSafeEqual(esperado, dado)) return null;
  try {
    const { u, v, exp } = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
    if (exp < Date.now()) return null;
    const usuario = uno('SELECT * FROM usuarios WHERE id = ?', u);
    return usuario && usuario.version === v ? usuario : null;
  } catch { return null; }
}

/** intentos de entrada: 8 por correo cada 15 min */
const intentos = new Map();
function frenar(clave) {
  const ahora = Date.now(), lista = (intentos.get(clave) ?? []).filter(t => ahora - t < 15 * 60e3);
  intentos.set(clave, lista);
  return lista.length >= 8;
}

/* ─────────── fechas en la zona de la crew ─────────── */
const fmtFecha = zona => new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' });
const fechaEn = (ts, zona = ZONA) => fmtFecha(zona).format(new Date(ts));
const esFecha = f => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f);
/** desfase (min) de la zona en un instante: para convertir «19:42 en Santiago» a un instante UTC */
function desfase(ts, zona) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ts)).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ts / 60e3) * 60e3) / 60e3;
}
/** el momento NOVA del día: una hora sorpresa entre 10:00 y 21:30, la misma para toda la crew, decidida por un hash */
function momento(crew, fecha) {
  const h = createHash('sha256').update(`${crew.id}:${fecha}:${SECRETO}`).digest();
  const min = 600 + (h.readUInt32BE(0) % (21.5 * 60 - 600));
  const [a, m, d] = fecha.split('-').map(Number);
  const local = Date.UTC(a, m - 1, d, Math.floor(min / 60), min % 60);
  return local - desfase(local, crew.zona) * 60e3;
}
const sumarDias = (fecha, n) => { const d = new Date(`${fecha}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/* ─────────── tiempo real ─────────── */
const conexiones = new Map(); // usuario_id → Set<ws>
function avisarCrew(crewId, msg, salvo) {
  const ids = todos('SELECT usuario_id FROM miembros WHERE crew_id = ?', crewId).map(r => r.usuario_id);
  avisarA(ids, { ...msg, crew: crewId }, salvo);
}
function avisarA(ids, msg, salvo) {
  const txt = JSON.stringify(msg);
  for (const id of ids) for (const ws of conexiones.get(id) ?? []) if (ws !== salvo && ws.readyState === 1) ws.send(txt);
}

/* ─────────── avisos push (Expo push → FCM): llegan con la app cerrada ─────────── */
const TXT = {
  orden: { es: ['NOVA desde tu Mac', '{t} · toca para hacerlo'], en: ['NOVA from your Mac', '{t} · tap to do it'] },
  foto: { es: ['{n} compartió su momento', '{t}'], en: ['{n} shared their moment', '{t}'] },
  video: { es: ['{n} compartió un video', '{t}'], en: ['{n} shared a video', '{t}'] },
  fotoSin: { es: ['{n} compartió su momento', 'Mira su foto en las historias de {c}.'], en: ['{n} shared their moment', 'See it in the {c} stories.'] },
  reaccion: { es: ['{n} reaccionó {e} a tu foto', ''], en: ['{n} reacted {e} to your photo', ''] },
  asignada: { es: ['{n} te asignó una tarea', '{t}'], en: ['{n} gave you a task', '{t}'] },
  tareaCrew: { es: ['Nueva tarea en {c}', '{n}: {t}'], en: ['New task in {c}', '{n}: {t}'] },
  hecha: { es: ['{n} completó una tarea', '{t}'], en: ['{n} finished a task', '{t}'] },
  reto: { es: ['Nuevo reto en {c}', '{n} propuso: {t}'], en: ['New challenge in {c}', '{n} started: {t}'] },
  unido: { es: ['{n} se unió a {c}', 'Ya son {k} en la crew.'], en: ['{n} joined {c}', 'You are {k} in the crew now.'] },
  bitacora: { es: ['{n} · bitácora de {c}', '{t}'], en: ['{n} · {c} log', '{t}'] },
  standup: { es: ['Standup de {n}', '{t}'], en: ['{n}\'s standup', '{t}'] },
  bloqueo: { es: ['{n} está bloqueado', '{t}'], en: ['{n} is blocked', '{t}'] },
  resumenSemana: { es: ['La semana de {c}', '{t}'], en: ['{c}: the week', '{t}'] },
  cuidar: { es: ['Cuidemos a {n}', 'Lleva {d} días con {s}. Un mensaje o un café pueden ayudar.'], en: ['Look out for {n}', '{d} days in a row with {e}. A message or a coffee can help.'] },
  standupResumen: { es: ['Standup de {c}: {k} de {total}', '{t}'], en: ['{c} standup: {k} of {total}', '{t}'] },
  metaNueva: { es: ['Meta nueva en {c}', '«{t}»'], en: ['New goal in {c}', '"{t}"'] },
  resultadoListo: { es: ['{n} cumplió un resultado ✓', '«{t}» · {m}'], en: ['{n} hit a key result ✓', '"{t}" · {m}'] },
  metasSemana: { es: ['Metas de {c}: tu semana', '{t}'], en: ['{c} goals this week', '{t}'] },
  resultadoAsignado: { es: ['{n} te hizo responsable', '«{t}» · {m}'], en: ['{n} made you owner', '"{t}" · {m}'] },
  retoMitad: { es: ['{c} va a la mitad del reto', '«{t}»: {p}% · quedan {d} días'], en: ['{c} is halfway there', '"{t}": {p}% · {d} days left'] },
  retoListo: { es: ['¡Reto cumplido en {c}! 🏆', '«{t}» · {top} aportó más'], en: ['Challenge done in {c}! 🏆', '"{t}" · {top} did the most'] },
  prueba: { es: ['NOVA te llega 🚀', 'Los avisos de tu crew ya funcionan en este teléfono.'], en: ['NOVA reaches you 🚀', 'Crew notifications now work on this phone.'] },
  venceManana: { es: ['Mañana vence una tarea', '«{t}»'], en: ['A task is due tomorrow', '"{t}"'] },
  ciFallo: { es: ['❌ {r}: falló {w}', '{t} · {n}'], en: ['❌ {r}: {w} failed', '{t} · {n}'] },
  ciOk: { es: ['✅ {r}: {w} volvió a pasar', '{t}'], en: ['✅ {r}: {w} is passing again', '{t}'] },
  deployFallo: { es: ['🚨 Falló el deploy de {r}', '{e} · {t}'], en: ['🚨 {r} deploy failed', '{e} · {t}'] },
  deployOk: { es: ['🚀 {r} salió a {e}', '{t}'], en: ['🚀 {r} is live on {e}', '{t}'] },
  prAbierto: { es: ['{n} abrió un PR en {r}', '#{k} {t}'], en: ['{n} opened a PR in {r}', '#{k} {t}'] },
  prRevision: { es: ['{n} te pidió revisar un PR', '{r}#{k} {t}'], en: ['{n} asked for your review', '{r}#{k} {t}'] },
  prMergeado: { es: ['PR integrado en {r}', '#{k} {t} · {n}'], en: ['PR merged in {r}', '#{k} {t} · {n}'] },
  prAprobado: { es: ['{n} aprobó tu PR ✓', '{r}#{k} {t}'], en: ['{n} approved your PR ✓', '{r}#{k} {t}'] },
  prCambios: { es: ['{n} pidió cambios en tu PR', '{r}#{k} {t}'], en: ['{n} requested changes', '{r}#{k} {t}'] },
  acta: { es: ['Acta lista: {t}', '{d} decisiones · {k} tareas propuestas · de {n}'], en: ['Meeting notes ready: {t}', '{d} decisions · {k} tasks proposed · by {n}'] },
  kudos: { es: ['{n} te reconoció 🙌', '{t}'], en: ['{n} gave you kudos 🙌', '{t}'] },
  acceso: { es: ['🎟️ Nueva solicitud de acceso · #{k}', '{n} · {t}'], en: ['🎟️ New access request · #{k}', '{n} · {t}'] },
  retro: { es: ['Retro de la semana en {c}', 'Qué funcionó, qué no y qué probamos: 1 minuto.'], en: ['{c} weekly retro', 'What worked, what didn’t, what to try: 1 minute.'] },
};
/** cada aviso pertenece a una categoría que la persona puede apagar en Tú → Avisos */
const CATEGORIA = { orden: 'sistema', prueba: 'sistema', acceso: 'sistema', metaNueva: 'equipo', resultadoListo: 'equipo', metasSemana: 'equipo', resultadoAsignado: 'equipo', foto: 'crew', video: 'crew', fotoSin: 'crew', reaccion: 'crew', unido: 'crew', asignada: 'equipo', tareaCrew: 'equipo', hecha: 'equipo', venceManana: 'equipo', reto: 'retos', retoMitad: 'retos', retoListo: 'retos', bitacora: 'bitacora', standup: 'standup', bloqueo: 'standup', standupResumen: 'standup', cuidar: 'salud', resumenSemana: 'bitacora', ciFallo: 'github', ciOk: 'github', deployFallo: 'github', deployOk: 'github', prAbierto: 'github', prRevision: 'github', prMergeado: 'github', prAprobado: 'github', prCambios: 'github', acta: 'bitacora', kudos: 'crew', retro: 'equipo' };
const prefs = id => { try { return JSON.parse(uno('SELECT datos FROM prefs_avisos WHERE usuario_id = ?', id)?.datos ?? '{}'); } catch { return {}; } };
/** un envío programado se hace una sola vez (clave única) */
const unaVez = clave => { try { correr('INSERT INTO envios (clave, ts) VALUES (?, ?)', clave, Date.now()); return true; } catch { return false; } };
const llenar = (s, v) => s.replace(/\{(\w)\}/g, (_, k) => String(v[k] ?? ''));
async function push(ids, clave, v, url, salvo) {
  const cat = CATEGORIA[clave] ?? 'equipo';
  const destinos = [...new Set(ids)].filter(id => id && id !== salvo && prefs(id)[cat] !== false);
  if (!destinos.length) return;
  const toks = todos(`SELECT token, idioma FROM dispositivos WHERE usuario_id IN (${destinos.map(() => '?').join(',')})`, ...destinos);
  if (!toks.length) return;
  const msgs = toks.map(({ token, idioma }) => {
    const [titulo, cuerpo] = TXT[clave][idioma === 'en' ? 'en' : 'es'];
    return { to: token, title: llenar(titulo, v), body: llenar(cuerpo, v) || undefined, data: { url }, sound: 'default', channelId: 'crew', priority: 'high' };
  });
  try {
    const r = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(msgs) });
    const j = await r.json();
    (j.data ?? []).forEach((d, i) => {
      if (d.status !== 'error') return;
      if (d.details?.error === 'DeviceNotRegistered') correr('DELETE FROM dispositivos WHERE token = ?', msgs[i].to);
      else console.warn('push', d.details?.error ?? '', d.message);
    });
    if (j.errors) console.warn('push', JSON.stringify(j.errors).slice(0, 300));
  } catch (e) { console.warn('push', e.message); }
}
const idsCrew = crewId => todos('SELECT usuario_id FROM miembros WHERE crew_id = ?', crewId).map(r => r.usuario_id);

/* ─────────── vistas ─────────── */
const urlFoto = id => `/v1/fotos/${id}`;
/* tus redes (GitHub, LinkedIn, Instagram, X, sitio): se guardan como usuario, no como enlace; el cliente arma la URL */
const REDES = ['github', 'linkedin', 'instagram', 'x', 'sitio'];
const limpiarRed = (red, v) => {
  let t = String(v ?? '').trim();
  if (!t) return null;
  if (red === 'sitio') return /^https?:\/\//.test(t) ? t.slice(0, 160) : `https://${t}`.slice(0, 160);
  t = t.replace(/^https?:\/\/(www\.)?(github\.com|linkedin\.com\/in|instagram\.com|x\.com|twitter\.com)\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
  return /^[A-Za-z0-9._-]{1,60}$/.test(t) ? t : null;
};
const redesDe = u => { try { const r = JSON.parse(u.redes || '{}'); return Object.fromEntries(REDES.filter(k => r[k]).map(k => [k, r[k]])); } catch { return {}; } };
const verUsuario = u => ({ id: u.id, nombre: u.nombre, foto: u.foto ? `/v1/avatares/${u.id}?v=${u.foto}` : null, redes: redesDe(u) });
function verCrew(c, yo) {
  const miembros = todos('SELECT u.*, m.rol, m.unido FROM miembros m JOIN usuarios u ON u.id = m.usuario_id WHERE m.crew_id = ? ORDER BY m.unido', c.id)
    .map(u => ({ ...verUsuario(u), rol: u.rol, unido: u.unido }));
  const hoy = fechaEn(Date.now(), c.zona);
  const subieron = todos('SELECT DISTINCT usuario_id FROM fotos WHERE crew_id = ? AND fecha = ?', c.id, hoy).map(r => r.usuario_id);
  return { id: c.id, nombre: c.nombre, codigo: c.codigo, zona: c.zona, soyAdmin: miembros.some(m => m.id === yo && m.rol === 'admin'), miembros, hoy: { fecha: hoy, momento: momento(c, hoy), subieron } };
}
function verFoto(f, yo) {
  const r = todos('SELECT usuario_id AS usuario, emoji FROM reacciones WHERE foto_id = ? ORDER BY ts', f.id);
  return { id: f.id, usuario: f.usuario_id, fecha: f.fecha, ts: f.ts, texto: f.texto, aTiempo: !!f.a_tiempo, ancho: f.ancho, alto: f.alto, url: urlFoto(f.id), mini: `${urlFoto(f.id)}?mini=1`, reacciones: r, mia: f.usuario_id === yo,
    ...(f.video ? { video: { url: `${urlFoto(f.id)}?video=1`, ms: f.video } } : {}) };
}
/** una tarea con sus responsables (varias personas) y sus adjuntos (enlaces y archivos).
    `asignado` queda con el primero, para las versiones de la app que solo conocen uno */
function verTarea(t) {
  const asignados = todos('SELECT usuario_id FROM tarea_asignados WHERE tarea_id = ? ORDER BY ts', t.id).map(r => r.usuario_id);
  if (!asignados.length && t.asignado) asignados.push(t.asignado);
  const adjuntos = todos('SELECT * FROM adjuntos WHERE tarea_id = ? ORDER BY ts', t.id).map(verAdjunto);
  return { id: t.id, crew: t.crew_id, creador: t.creador, asignado: asignados[0] ?? null, asignados, titulo: t.titulo, nota: t.nota, vence: t.vence, hecha: !!t.hecha_ts, hechaPor: t.hecha_por, hechaTs: t.hecha_ts, orden: t.orden, creado: t.creado, adjuntos };
}
const verAdjunto = a => ({ id: a.id, tipo: a.tipo, nombre: a.nombre, url: a.tipo === 'enlace' ? a.url : `/v1/adjuntos/${a.id}`, mime: a.mime, bytes: a.bytes, por: a.por, ts: a.ts });

// notas de voz de la bitácora (columna nueva: se agrega si la base es anterior)
try { db.exec('ALTER TABLE usuarios ADD COLUMN redes TEXT'); } catch {}
try { db.exec('ALTER TABLE bitacora ADD COLUMN audio INTEGER'); } catch {}
try { db.exec('ALTER TABLE bitacora ADD COLUMN transcripcion TEXT'); } catch {}
db.exec(`CREATE TABLE IF NOT EXISTS listas (id TEXT PRIMARY KEY, usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, crew_id TEXT REFERENCES crews(id) ON DELETE CASCADE, nombre TEXT NOT NULL, icono TEXT, creado INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, lista_id TEXT NOT NULL REFERENCES listas(id) ON DELETE CASCADE, texto TEXT NOT NULL, hecho INTEGER NOT NULL DEFAULT 0, por TEXT, ts INTEGER NOT NULL);`);
db.exec('CREATE TABLE IF NOT EXISTS integraciones (usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, proveedor TEXT NOT NULL, datos TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (usuario_id, proveedor))');
// fotos con video: `video` = duración en ms (la foto completa es la portada del video)
try { db.exec('ALTER TABLE fotos ADD COLUMN video INTEGER'); } catch {}
// tareas v2: varias personas a cargo y adjuntos (enlaces o archivos de hasta 15 MB)
db.exec(`CREATE TABLE IF NOT EXISTS tarea_asignados (tarea_id TEXT NOT NULL REFERENCES tareas(id) ON DELETE CASCADE, usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, ts INTEGER NOT NULL, PRIMARY KEY (tarea_id, usuario_id));
CREATE TABLE IF NOT EXISTS adjuntos (id TEXT PRIMARY KEY, tarea_id TEXT NOT NULL REFERENCES tareas(id) ON DELETE CASCADE, tipo TEXT NOT NULL, nombre TEXT NOT NULL, url TEXT, mime TEXT, bytes INTEGER, por TEXT, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS adjuntos_tarea ON adjuntos (tarea_id);`);
// las tareas anteriores con una sola persona pasan a la tabla nueva (una vez)
db.exec('INSERT OR IGNORE INTO tarea_asignados (tarea_id, usuario_id, ts) SELECT id, asignado, creado FROM tareas WHERE asignado IS NOT NULL');
const ARCHIVOS = join(DATOS, 'archivos');
mkdirSync(ARCHIVOS, { recursive: true });
const AUDIOS = join(DATOS, 'audios');
mkdirSync(AUDIOS, { recursive: true });

/* ─────────── utilidades http ─────────── */
class Fallo extends Error { constructor(estado, msg) { super(msg); this.estado = estado; } }
const falla = (estado, msg) => { throw new Fallo(estado, msg); };
async function cuerpo(req, max = 64 * 1024) {
  const partes = []; let largo = 0;
  for await (const p of req) { largo += p.length; if (largo > max) falla(413, 'demasiado grande'); partes.push(p); }
  return Buffer.concat(partes);
}
async function json(req) {
  const b = await cuerpo(req);
  if (!b.length) return {};
  try { return JSON.parse(b.toString()); } catch { falla(400, 'JSON inválido'); }
}
const texto = (v, max, campo) => {
  if (v == null) return null;
  if (typeof v !== 'string') falla(400, `${campo} inválido`);
  const t = v.trim();
  if (t.length > max) falla(400, `${campo} muy largo`);
  return t || null;
};
const esJpeg = b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
function miembro(crewId, usuarioId) {
  const c = uno('SELECT c.*, m.rol FROM crews c JOIN miembros m ON m.crew_id = c.id WHERE c.id = ? AND m.usuario_id = ?', crewId, usuarioId);
  if (!c) falla(404, 'Crew not found');
  return c;
}
const codigoCrew = () => { for (;;) { const c = randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); if (!uno('SELECT 1 FROM crews WHERE codigo = ?', c)) return c; } };

/* ─────────── rutas ─────────── */
const rutas = [];
const ruta = (metodo, patron, fn, { publica = false } = {}) => {
  const claves = [];
  const re = new RegExp(`^${patron.replace(/:(\w+)/g, (_, k) => { claves.push(k); return '([^/]+)'; })}$`);
  rutas.push({ metodo, re, claves, fn, publica });
};

ruta('GET', '/v1/salud', () => ({ ok: true }), { publica: true });

ruta('POST', '/v1/entrar', async ({ req }) => {
  const { email, clave } = await json(req);
  const correo = String(email ?? '').trim().toLowerCase();
  if (!correo || !clave) falla(400, 'Missing email or password');
  if (frenar(correo)) falla(429, 'Too many attempts. Wait a few minutes.');
  const u = uno('SELECT * FROM usuarios WHERE email = ?', correo);
  if (!u || !claveOk(String(clave), u.hash)) { intentos.get(correo).push(Date.now()); falla(401, 'Wrong email or password'); }
  intentos.delete(correo);
  return { token: emitir(u), usuario: { ...verUsuario(u), email: u.email } };
}, { publica: true });

ruta('GET', '/v1/yo', ({ yo }) => {
  const crews = todos('SELECT c.* FROM crews c JOIN miembros m ON m.crew_id = c.id WHERE m.usuario_id = ? ORDER BY m.unido', yo.id);
  return { usuario: { ...verUsuario(yo), email: yo.email }, crews: crews.map(c => verCrew(c, yo.id)) };
});

ruta('PATCH', '/v1/yo', async ({ req, yo }) => {
  const { nombre, redes } = await json(req);
  const n = texto(nombre, 40, 'nombre');
  if (n) correr('UPDATE usuarios SET nombre = ? WHERE id = ?', n, yo.id);
  if (redes && typeof redes === 'object') {
    const actuales = redesDe(yo), nuevas = { ...actuales };
    for (const k of REDES) if (k in redes) { const v = limpiarRed(k, redes[k]); if (v) nuevas[k] = v; else delete nuevas[k]; }
    correr('UPDATE usuarios SET redes = ? WHERE id = ?', JSON.stringify(nuevas), yo.id);
  }
  for (const { crew_id } of todos('SELECT crew_id FROM miembros WHERE usuario_id = ?', yo.id)) avisarCrew(crew_id, { tipo: 'miembros' });
  return { ok: true };
});

ruta('PUT', '/v1/yo/foto', async ({ req, yo }) => {
  const b = await cuerpo(req, MAX_FOTO);
  if (!esJpeg(b)) falla(400, 'Debe ser JPEG');
  mkdirSync(join(DATOS, 'avatares'), { recursive: true });
  writeFileSync(join(DATOS, 'avatares', `${yo.id}.jpg`), b);
  const v = Date.now().toString(36);
  correr('UPDATE usuarios SET foto = ? WHERE id = ?', v, yo.id);
  for (const { crew_id } of todos('SELECT crew_id FROM miembros WHERE usuario_id = ?', yo.id)) avisarCrew(crew_id, { tipo: 'miembros' });
  return { foto: `/v1/avatares/${yo.id}?v=${v}` };
});

ruta('POST', '/v1/yo/clave', async ({ req, yo }) => {
  const { actual, nueva } = await json(req);
  if (!claveOk(String(actual ?? ''), yo.hash)) falla(401, 'The current password is wrong');
  if (typeof nueva !== 'string' || nueva.length < 8) falla(400, 'The new password needs at least 8 characters');
  correr('UPDATE usuarios SET hash = ?, version = version + 1 WHERE id = ?', hashClave(nueva), yo.id);
  return { token: emitir(uno('SELECT * FROM usuarios WHERE id = ?', yo.id)) };
});

ruta('GET', '/v1/avatares/:id', ({ p, res }) => {
  const f = join(DATOS, 'avatares', `${p.id.replace(/[^\w-]/g, '')}.jpg`);
  if (!existsSync(f)) falla(404, 'sin foto');
  res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' });
  res.end(readFileSync(f));
});

/* crew */
ruta('POST', '/v1/crews', async ({ req, yo }) => {
  const { nombre, zona } = await json(req);
  const n = texto(nombre, 40, 'nombre') ?? falla(400, 'Missing name');
  const z = typeof zona === 'string' && Intl.supportedValuesOf('timeZone').includes(zona) ? zona : ZONA;
  const id = nuevoId(), ahora = Date.now();
  correr('INSERT INTO crews (id, nombre, codigo, zona, creado_por, creado) VALUES (?, ?, ?, ?, ?, ?)', id, n, codigoCrew(), z, yo.id, ahora);
  correr("INSERT INTO miembros (crew_id, usuario_id, rol, unido) VALUES (?, ?, 'admin', ?)", id, yo.id, ahora);
  return verCrew(uno('SELECT * FROM crews WHERE id = ?', id), yo.id);
});

ruta('POST', '/v1/crews/unirse', async ({ req, yo }) => {
  const { codigo } = await json(req);
  const c = uno('SELECT * FROM crews WHERE codigo = ?', String(codigo ?? '').trim().toUpperCase());
  if (!c) falla(404, 'There is no crew with that code');
  if ((uno('SELECT COUNT(*) n FROM miembros WHERE crew_id = ?', c.id)).n >= 12) falla(409, 'The crew is full (12)');
  correr('INSERT OR IGNORE INTO miembros (crew_id, usuario_id, rol, unido) VALUES (?, ?, ?, ?)', c.id, yo.id, 'miembro', Date.now());
  avisarCrew(c.id, { tipo: 'miembros' });
  push(idsCrew(c.id), 'unido', { n: yo.nombre, c: c.nombre, k: idsCrew(c.id).length }, '/crew', yo.id);
  return verCrew(c, yo.id);
});

ruta('GET', '/v1/crews/:id', ({ p, yo }) => verCrew(miembro(p.id, yo.id), yo.id));

ruta('PATCH', '/v1/crews/:id', async ({ req, p, yo }) => {
  const c = miembro(p.id, yo.id);
  if (c.rol !== 'admin') falla(403, 'Only the crew admin can change it');
  const { nombre, nuevoCodigo } = await json(req);
  const n = texto(nombre, 40, 'nombre');
  if (n) correr('UPDATE crews SET nombre = ? WHERE id = ?', n, c.id);
  if (nuevoCodigo) correr('UPDATE crews SET codigo = ? WHERE id = ?', codigoCrew(), c.id);
  avisarCrew(c.id, { tipo: 'miembros' });
  return verCrew(uno('SELECT * FROM crews WHERE id = ?', c.id), yo.id);
});

ruta('DELETE', '/v1/crews/:id/miembros/:uid', ({ p, yo }) => {
  const c = miembro(p.id, yo.id);
  if (p.uid !== yo.id && c.rol !== 'admin') falla(403, 'Only you or the admin can do that');
  correr('DELETE FROM miembros WHERE crew_id = ? AND usuario_id = ?', c.id, p.uid);
  // si se va el último admin, el miembro más antiguo pasa a administrar; si no queda nadie, la crew se borra
  const quedan = todos('SELECT * FROM miembros WHERE crew_id = ? ORDER BY unido', c.id);
  if (!quedan.length) {
    for (const f of todos('SELECT id FROM fotos WHERE crew_id = ?', c.id)) borrarArchivos(f.id);
    correr('DELETE FROM crews WHERE id = ?', c.id);
  } else if (!quedan.some(m => m.rol === 'admin')) correr("UPDATE miembros SET rol = 'admin' WHERE crew_id = ? AND usuario_id = ?", c.id, quedan[0].usuario_id);
  avisarCrew(c.id, { tipo: 'miembros' });
  avisarA([p.uid], { tipo: 'miembros', crew: c.id });
  return { ok: true };
});

/* roles: el admin nombra o quita admins (la crew nunca queda sin admin) */
ruta('PATCH', '/v1/crews/:id/miembros/:uid', async ({ req, p, yo }) => {
  const c = miembro(p.id, yo.id);
  if (c.rol !== 'admin') falla(403, 'Only an admin can change roles');
  const { rol } = await json(req);
  if (rol !== 'admin' && rol !== 'miembro') falla(400, 'rol inválido');
  if (!uno('SELECT 1 FROM miembros WHERE crew_id = ? AND usuario_id = ?', c.id, p.uid)) falla(404, 'no existe');
  if (rol === 'miembro' && uno("SELECT COUNT(*) n FROM miembros WHERE crew_id = ? AND rol = 'admin'", c.id).n <= 1 && uno('SELECT rol FROM miembros WHERE crew_id = ? AND usuario_id = ?', c.id, p.uid).rol === 'admin') falla(409, 'The crew needs at least one admin');
  correr('UPDATE miembros SET rol = ? WHERE crew_id = ? AND usuario_id = ?', rol, c.id, p.uid);
  avisarCrew(c.id, { tipo: 'miembros' });
  return { ok: true };
});

/* invitación: un enlace https que se puede mandar por WhatsApp; en el teléfono abre NOVA en «Unirse» con el código */
ruta('GET', '/unirse/:codigo', ({ p, res }) => {
  const codigo = String(p.codigo).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const c = uno('SELECT nombre FROM crews WHERE codigo = ?', codigo);
  const nombre = (c?.nombre ?? 'NOVA').replace(/[&<>"]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[x]);
  const app = `intent://unirse?c=${codigo}#Intent;scheme=nova;package=solutions.bn.nova;end`;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Únete a ${nombre} en NOVA</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05080c;color:#f2f5f8;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}
.o{width:96px;height:96px;margin:0 auto 18px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#c4f6fd,#46c8e8 45%,#0a4458);box-shadow:0 0 60px #46c8e855}
h1{font-size:26px;margin:0 0 8px}p{color:#9aa4b2;margin:0 0 22px}a{display:inline-block;background:#8fe6f5;color:#041218;text-decoration:none;font-weight:600;padding:14px 26px;border-radius:28px}
.c{margin-top:22px;font:600 22px ui-monospace,monospace;letter-spacing:4px;color:#8fe6f5}</style></head>
<body><main><div class="o"></div><h1>${c ? `Únete a ${nombre}` : 'Invitación a NOVA'}</h1><p>${c ? 'Te invitaron a una crew en NOVA.' : 'Este código no existe o ya cambió.'}</p>${c ? `<a href="${app}">Abrir en NOVA</a><div class="c">${codigo}</div><p style="margin-top:10px">Si no se abre, en NOVA ve a Tripulación → Unirme e ingresa este código.</p>` : ''}</main></body></html>`);
}, { publica: true });

/** el momento NOVA de los próximos días (la app agenda las notificaciones locales con esto) */
ruta('GET', '/v1/crews/:id/momentos', ({ p, q, yo }) => {
  const c = miembro(p.id, yo.id), n = Math.min(14, Math.max(1, Number(q.get('dias') ?? 7)));
  const hoy = fechaEn(Date.now(), c.zona);
  return Array.from({ length: n }, (_, i) => { const f = sumarDias(hoy, i); return { fecha: f, ts: momento(c, f) }; });
});

/* fotos: el cuerpo trae la miniatura y la foto completa seguidas; x-largo-mini dice dónde se cortan */
function borrarArchivos(id) { for (const s of ['', '.mini']) rmSync(join(FOTOS, `${id}${s}.jpg`), { force: true }); rmSync(join(FOTOS, `${id}.mp4`), { force: true }); }
const MAX_VIDEO = 40 * 1024 * 1024;
const esMp4 = b => b.length > 12 && b.subarray(4, 8).toString() === 'ftyp';
/* video para la crew (hasta 60 s): el cuerpo trae la miniatura, la portada y el mp4 seguidos;
   x-largo-mini y x-largo-poster dicen dónde se corta cada uno */
ruta('POST', '/v1/crews/:id/videos', async ({ req, p, q, yo }) => {
  const c = miembro(p.id, yo.id);
  const b = await cuerpo(req, MAX_VIDEO + 2 * 1024 * 1024);
  const lm = Number(req.headers['x-largo-mini'] ?? 0), lp = Number(req.headers['x-largo-poster'] ?? 0);
  const mini = b.subarray(0, lm), poster = b.subarray(lm, lm + lp), mp4 = b.subarray(lm + lp);
  if (!lm || !lp || !esJpeg(mini) || !esJpeg(poster)) falla(400, 'Expected the two cover images');
  if (!esMp4(mp4)) falla(415, 'Only MP4 videos');
  if (mp4.length > MAX_VIDEO) falla(413, 'The video is too big (max 40 MB)');
  const ms = Math.max(500, Math.min(60e3, Math.round(Number(q.get('ms')) || 0)));
  const ahora = Date.now(), fecha = fechaEn(ahora, c.zona);
  if ((uno('SELECT COUNT(*) n FROM fotos WHERE crew_id = ? AND usuario_id = ? AND fecha = ?', c.id, yo.id, fecha)).n >= 12) falla(429, 'You already shared 12 photos today');
  const m = momento(c, fecha), aTiempo = ahora >= m && ahora - m <= 10 * 60e3 ? 1 : 0;
  const id = nuevoId();
  writeFileSync(join(FOTOS, `${id}.jpg`), poster);
  writeFileSync(join(FOTOS, `${id}.mini.jpg`), mini);
  writeFileSync(join(FOTOS, `${id}.mp4`), mp4);
  const texto_ = texto(q.get('texto'), 200, 'texto');
  correr('INSERT INTO fotos (id, crew_id, usuario_id, fecha, ts, texto, a_tiempo, ancho, alto, video) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, c.id, yo.id, fecha, ahora, texto_, aTiempo, Number(q.get('ancho')) || null, Number(q.get('alto')) || null, ms);
  avisarCrew(c.id, { tipo: 'foto', id, de: yo.id, nombre: yo.nombre });
  push(idsCrew(c.id), 'video', { n: yo.nombre, t: texto_ ?? '', c: c.nombre }, `/historias?fecha=${fecha}`, yo.id);
  return verFoto(uno('SELECT * FROM fotos WHERE id = ?', id), yo.id);
});

ruta('POST', '/v1/crews/:id/fotos', async ({ req, p, q, yo }) => {
  const c = miembro(p.id, yo.id);
  const b = await cuerpo(req, MAX_FOTO + 512 * 1024);
  const corte = Number(req.headers['x-largo-mini'] ?? 0);
  const mini = b.subarray(0, corte), completa = b.subarray(corte);
  if (!corte || !esJpeg(mini) || !esJpeg(completa)) falla(400, 'Expected two JPEG images');
  const ahora = Date.now(), fecha = fechaEn(ahora, c.zona);
  if ((uno('SELECT COUNT(*) n FROM fotos WHERE crew_id = ? AND usuario_id = ? AND fecha = ?', c.id, yo.id, fecha)).n >= 12) falla(429, 'You already shared 12 photos today');
  // «a tiempo»: dentro de los 10 minutos siguientes al momento NOVA de hoy
  const m = momento(c, fecha), aTiempo = ahora >= m && ahora - m <= 10 * 60e3 ? 1 : 0;
  const id = nuevoId();
  writeFileSync(join(FOTOS, `${id}.jpg`), completa);
  writeFileSync(join(FOTOS, `${id}.mini.jpg`), mini);
  const texto_ = texto(q.get('texto'), 200, 'texto');
  correr('INSERT INTO fotos (id, crew_id, usuario_id, fecha, ts, texto, a_tiempo, ancho, alto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, c.id, yo.id, fecha, ahora, texto_, aTiempo, Number(q.get('ancho')) || null, Number(q.get('alto')) || null);
  avisarCrew(c.id, { tipo: 'foto', id, de: yo.id, nombre: yo.nombre });
  push(idsCrew(c.id), texto_ ? 'foto' : 'fotoSin', { n: yo.nombre, t: texto_, c: c.nombre }, `/historias?fecha=${fecha}`, yo.id);
  return verFoto(uno('SELECT * FROM fotos WHERE id = ?', id), yo.id);
});

ruta('GET', '/v1/crews/:id/fotos', ({ p, q, yo }) => {
  const c = miembro(p.id, yo.id), hoy = fechaEn(Date.now(), c.zona);
  const desde = esFecha(q.get('desde')) ? q.get('desde') : sumarDias(hoy, -6), hasta = esFecha(q.get('hasta')) ? q.get('hasta') : hoy;
  return todos('SELECT * FROM fotos WHERE crew_id = ? AND fecha BETWEEN ? AND ? ORDER BY ts DESC LIMIT 400', c.id, desde, hasta).map(f => verFoto(f, yo.id));
});

/** calendario: por día, cuántas fotos y quiénes, con la primera como portada */
ruta('GET', '/v1/crews/:id/calendario', ({ p, q, yo }) => {
  const c = miembro(p.id, yo.id);
  const mes = /^\d{4}-\d{2}$/.test(q.get('mes') ?? '') ? q.get('mes') : fechaEn(Date.now(), c.zona).slice(0, 7);
  const filas = todos('SELECT id, fecha, usuario_id FROM fotos WHERE crew_id = ? AND fecha LIKE ? ORDER BY ts', c.id, `${mes}-%`);
  const dias = {};
  for (const f of filas) {
    const d = (dias[f.fecha] ??= { fotos: 0, personas: [], portada: `${urlFoto(f.id)}?mini=1` });
    d.fotos++; if (!d.personas.includes(f.usuario_id)) d.personas.push(f.usuario_id);
  }
  return { mes, dias };
});

ruta('GET', '/v1/fotos/:id', ({ req, p, q, yo, res }) => {
  const f = uno('SELECT * FROM fotos WHERE id = ?', p.id);
  if (!f) falla(404, 'no existe');
  miembro(f.crew_id, yo.id);
  if (q.get('video')) {
    // el reproductor pide el video por partes (Range): así parte al tiro y se puede adelantar
    const rv = join(FOTOS, `${f.id}.mp4`);
    if (!existsSync(rv)) falla(404, 'sin archivo');
    const largo = statSync(rv).size, rango = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    const cab = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=31536000, immutable' };
    if (!rango) { res.writeHead(200, { ...cab, 'content-length': largo }); createReadStream(rv).pipe(res); return; }
    let ini = rango[1] ? Number(rango[1]) : largo - Number(rango[2]), fin = rango[1] && rango[2] ? Number(rango[2]) : largo - 1;
    ini = Math.max(0, ini); fin = Math.min(largo - 1, fin);
    if (ini > fin) { res.writeHead(416, { 'content-range': `bytes */${largo}` }); res.end(); return; }
    res.writeHead(206, { ...cab, 'content-range': `bytes ${ini}-${fin}/${largo}`, 'content-length': fin - ini + 1 });
    createReadStream(rv, { start: ini, end: fin }).pipe(res); return;
  }
  const ruta_ = join(FOTOS, `${f.id}${q.get('mini') ? '.mini' : ''}.jpg`);
  if (!existsSync(ruta_)) falla(404, 'sin archivo');
  res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' });
  res.end(readFileSync(ruta_));
});

ruta('DELETE', '/v1/fotos/:id', ({ p, yo }) => {
  const f = uno('SELECT * FROM fotos WHERE id = ?', p.id);
  if (!f || f.usuario_id !== yo.id) falla(404, 'no existe');
  correr('DELETE FROM fotos WHERE id = ?', f.id);
  borrarArchivos(f.id);
  avisarCrew(f.crew_id, { tipo: 'foto', id: f.id, borrada: true });
  return { ok: true };
});

ruta('POST', '/v1/fotos/:id/reaccion', async ({ req, p, yo }) => {
  const f = uno('SELECT * FROM fotos WHERE id = ?', p.id);
  if (!f) falla(404, 'no existe');
  miembro(f.crew_id, yo.id);
  const { emoji } = await json(req);
  if (typeof emoji !== 'string' || !emoji || [...emoji].length > 4) falla(400, 'emoji inválido');
  const ya = uno('SELECT 1 FROM reacciones WHERE foto_id = ? AND usuario_id = ? AND emoji = ?', f.id, yo.id, emoji);
  if (ya) correr('DELETE FROM reacciones WHERE foto_id = ? AND usuario_id = ? AND emoji = ?', f.id, yo.id, emoji);
  else correr('INSERT INTO reacciones (foto_id, usuario_id, emoji, ts) VALUES (?, ?, ?, ?)', f.id, yo.id, emoji, Date.now());
  avisarCrew(f.crew_id, { tipo: 'reaccion', id: f.id, de: yo.id, nombre: yo.nombre, emoji, puesta: !ya, para: f.usuario_id });
  if (!ya) push([f.usuario_id], 'reaccion', { n: yo.nombre, e: emoji }, `/historias?fecha=${f.fecha}`, yo.id);
  return verFoto(f, yo.id);
});

/* tareas: sin crew = privadas (solo las ve quien las creó); con crew = compartidas con toda la crew */
function tareaVisible(id, yo) {
  const t = uno('SELECT * FROM tareas WHERE id = ?', id);
  if (!t) falla(404, 'no existe');
  if (t.crew_id) miembro(t.crew_id, yo.id); else if (t.creador !== yo.id) falla(404, 'no existe');
  return t;
}

ruta('GET', '/v1/tareas', ({ yo }) => {
  const filas = todos(`SELECT * FROM tareas WHERE (crew_id IS NULL AND creador = ?)
    OR crew_id IN (SELECT crew_id FROM miembros WHERE usuario_id = ?) ORDER BY hecha_ts IS NOT NULL, orden, creado`, yo.id, yo.id);
  return filas.map(verTarea);
});

ruta('POST', '/v1/tareas', async ({ req, yo }) => {
  const { titulo, nota, crew, asignado, asignados, vence, enlaces } = await json(req);
  const t = texto(titulo, 140, 'titulo') ?? falla(400, 'Missing title');
  if (crew) miembro(crew, yo.id);
  const gente = validarAsignados(crew, asignados ?? (asignado ? [asignado] : []));
  const id = nuevoId(), ahora = Date.now();
  correr('INSERT INTO tareas (id, crew_id, creador, asignado, titulo, nota, vence, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, crew ?? null, yo.id, gente[0] ?? null, t, texto(nota, 2000, 'nota'), esFecha(vence) ? vence : null, ahora);
  gente.forEach((u, i) => correr('INSERT INTO tarea_asignados (tarea_id, usuario_id, ts) VALUES (?, ?, ?)', id, u, ahora + i));
  if (Array.isArray(enlaces)) for (const e of enlaces.slice(0, 10)) await agregarEnlace(id, e, yo);
  if (crew) {
    avisarCrew(crew, { tipo: 'tarea', id, de: yo.id, nombre: yo.nombre, titulo: t, para: gente[0] ?? null });
    if (gente.length) push(gente, 'asignada', { n: yo.nombre, t }, '/crew', yo.id);
    else push(idsCrew(crew), 'tareaCrew', { n: yo.nombre, t, c: uno('SELECT nombre FROM crews WHERE id = ?', crew)?.nombre }, '/crew', yo.id);
    espejo(crew, 'tarea', `🆕 ${yo.nombre}: ${t}${gente.length ? ` → ${gente.map(nombreDe).join(', ')}` : ''}`);
  }
  return verTarea(uno('SELECT * FROM tareas WHERE id = ?', id));
});

ruta('PATCH', '/v1/tareas/:id', async ({ req, p, yo }) => {
  const t = tareaVisible(p.id, yo), b = await json(req);
  if ('titulo' in b) correr('UPDATE tareas SET titulo = ? WHERE id = ?', texto(b.titulo, 140, 'titulo') ?? t.titulo, t.id);
  if ('nota' in b) correr('UPDATE tareas SET nota = ? WHERE id = ?', texto(b.nota, 1000, 'nota'), t.id);
  if ('vence' in b) correr('UPDATE tareas SET vence = ? WHERE id = ?', esFecha(b.vence) ? b.vence : null, t.id);
  if ('orden' in b && Number.isFinite(b.orden)) correr('UPDATE tareas SET orden = ? WHERE id = ?', Math.round(b.orden), t.id);
  const antes = todos('SELECT usuario_id FROM tarea_asignados WHERE tarea_id = ?', t.id).map(r => r.usuario_id);
  let nuevos = [];
  if ('asignados' in b || 'asignado' in b) {
    const gente = validarAsignados(t.crew_id, 'asignados' in b ? b.asignados ?? [] : b.asignado ? [b.asignado] : []);
    correr('DELETE FROM tarea_asignados WHERE tarea_id = ?', t.id);
    const ahora = Date.now();
    gente.forEach((u, i) => correr('INSERT INTO tarea_asignados (tarea_id, usuario_id, ts) VALUES (?, ?, ?)', t.id, u, ahora + i));
    correr('UPDATE tareas SET asignado = ? WHERE id = ?', gente[0] ?? null, t.id);
    nuevos = gente.filter(u => !antes.includes(u));
  }
  if ('hecha' in b) correr('UPDATE tareas SET hecha_por = ?, hecha_ts = ? WHERE id = ?', b.hecha ? yo.id : null, b.hecha ? Date.now() : null, t.id);
  const nueva = uno('SELECT * FROM tareas WHERE id = ?', t.id);
  if (t.crew_id) {
    avisarCrew(t.crew_id, { tipo: 'tarea', id: t.id, de: yo.id, nombre: yo.nombre, titulo: nueva.titulo, hecha: 'hecha' in b ? !!b.hecha : undefined });
    if (nuevos.length) push(nuevos, 'asignada', { n: yo.nombre, t: nueva.titulo }, '/crew', yo.id);
    if (b.hecha && !t.hecha_ts) { push([t.creador, ...antes], 'hecha', { n: yo.nombre, t: nueva.titulo }, '/crew', yo.id); espejo(t.crew_id, 'hecha', `✅ ${yo.nombre} completó: ${nueva.titulo}`); }
  }
  return verTarea(nueva);
});

ruta('DELETE', '/v1/tareas/:id', ({ p, yo }) => {
  const t = tareaVisible(p.id, yo);
  if (t.crew_id && t.creador !== yo.id && miembro(t.crew_id, yo.id).rol !== 'admin') falla(403, 'Only whoever created it can delete it');
  for (const a of todos("SELECT id FROM adjuntos WHERE tarea_id = ? AND tipo = 'archivo'", t.id)) rmSync(join(ARCHIVOS, a.id), { force: true });
  correr('DELETE FROM tareas WHERE id = ?', t.id);
  if (t.crew_id) avisarCrew(t.crew_id, { tipo: 'tarea', id: t.id, borrada: true });
  return { ok: true };
});

/** personas a cargo: solo de la crew de la tarea, sin repetir, hasta 12 */
function validarAsignados(crew, lista) {
  if (!Array.isArray(lista)) falla(400, 'asignados inválido');
  const gente = [...new Set(lista.filter(x => typeof x === 'string' && x))].slice(0, 12);
  if (gente.length && !crew) falla(400, 'Tasks can only go to someone in the crew');
  for (const u of gente) if (!uno('SELECT 1 FROM miembros WHERE crew_id = ? AND usuario_id = ?', crew, u)) falla(400, 'Tasks can only go to someone in the crew');
  return gente;
}
const nombreDe = id => uno('SELECT nombre FROM usuarios WHERE id = ?', id)?.nombre.split(' ')[0] ?? '?';
/** título de una página (og:title o <title>) para mostrar el enlace con su nombre; 4 s como máximo */
async function tituloDe(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 NOVA', accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(4000) });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('html')) return null;
    const h = (await r.text()).slice(0, 200000);
    const m = h.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) ?? h.match(/<title[^>]*>([^<]+)/i);
    return m ? m[1].replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim().slice(0, 140) : null;
  } catch { return null; }
}
async function agregarEnlace(tareaId, e, yo) {
  const url = texto(typeof e === 'string' ? e : e?.url, 2000, 'url');
  if (!url || !/^https?:\/\/[^\s]+$/i.test(url)) falla(400, 'That does not look like a link');
  if ((uno('SELECT COUNT(*) n FROM adjuntos WHERE tarea_id = ?', tareaId)).n >= 20) falla(429, 'Up to 20 attachments per task');
  const nombre = texto(typeof e === 'object' ? e?.nombre : null, 140, 'nombre') ?? (await tituloDe(url)) ?? url.replace(/^https?:\/\//, '').slice(0, 140);
  const id = nuevoId();
  correr("INSERT INTO adjuntos (id, tarea_id, tipo, nombre, url, por, ts) VALUES (?, ?, 'enlace', ?, ?, ?, ?)", id, tareaId, nombre, url, yo.id, Date.now());
  return id;
}
const tocarTarea = (t, yo) => { if (t.crew_id) avisarCrew(t.crew_id, { tipo: 'tarea', id: t.id, de: yo.id, nombre: yo.nombre, titulo: t.titulo }); };
ruta('POST', '/v1/tareas/:id/enlaces', async ({ req, p, yo }) => {
  const t = tareaVisible(p.id, yo);
  await agregarEnlace(t.id, await json(req), yo);
  tocarTarea(t, yo);
  return verTarea(uno('SELECT * FROM tareas WHERE id = ?', t.id));
});
/* archivo adjunto: el cuerpo es el archivo; nombre y tipo van en la URL. Máx. 15 MB */
const MIME_OK = /^(image\/(jpeg|png|webp|gif|heic)|application\/(pdf|zip|json|msword|vnd\.openxmlformats-officedocument\.[\w.]+|vnd\.ms-[\w.]+|vnd\.oasis\.opendocument\.[\w.]+)|text\/(plain|csv|markdown)|audio\/(mp4|mpeg|aac|m4a)|video\/mp4)$/;
ruta('POST', '/v1/tareas/:id/archivos', async ({ req, p, q, yo }) => {
  const t = tareaVisible(p.id, yo);
  if ((uno('SELECT COUNT(*) n FROM adjuntos WHERE tarea_id = ?', t.id)).n >= 20) falla(429, 'Up to 20 attachments per task');
  const nombre = (texto(q.get('nombre'), 140, 'nombre') ?? 'archivo').replace(/[\/\\]/g, '-');
  const mime = String(q.get('mime') ?? 'application/octet-stream').toLowerCase();
  if (!MIME_OK.test(mime)) falla(415, 'That file type is not allowed');
  const b = await cuerpo(req, 15 * 1024 * 1024);
  if (!b.length) falla(400, 'Empty file');
  const id = nuevoId();
  writeFileSync(join(ARCHIVOS, id), b);
  correr("INSERT INTO adjuntos (id, tarea_id, tipo, nombre, mime, bytes, por, ts) VALUES (?, ?, 'archivo', ?, ?, ?, ?, ?)", id, t.id, nombre, mime, b.length, yo.id, Date.now());
  tocarTarea(t, yo);
  return verTarea(uno('SELECT * FROM tareas WHERE id = ?', t.id));
});
ruta('GET', '/v1/adjuntos/:id', ({ p, yo, res }) => {
  const a = uno('SELECT * FROM adjuntos WHERE id = ?', p.id) ?? falla(404, 'no existe');
  tareaVisible(a.tarea_id, yo);
  if (a.tipo !== 'archivo') falla(404, 'no existe');
  const f = join(ARCHIVOS, a.id);
  if (!existsSync(f)) falla(404, 'sin archivo');
  const d = readFileSync(f);
  res.writeHead(200, { 'content-type': a.mime, 'content-length': d.length, 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.nombre)}`, 'cache-control': 'private, max-age=31536000, immutable' });
  res.end(d);
});
ruta('DELETE', '/v1/adjuntos/:id', ({ p, yo }) => {
  const a = uno('SELECT * FROM adjuntos WHERE id = ?', p.id) ?? falla(404, 'no existe');
  const t = tareaVisible(a.tarea_id, yo);
  if (a.por !== yo.id && t.creador !== yo.id && !(t.crew_id && miembro(t.crew_id, yo.id).rol === 'admin')) falla(403, 'Only whoever added it can remove it');
  correr('DELETE FROM adjuntos WHERE id = ?', a.id);
  rmSync(join(ARCHIVOS, a.id), { force: true });
  tocarTarea(t, yo);
  return verTarea(uno('SELECT * FROM tareas WHERE id = ?', t.id));
});

/* estado del día que cada uno decide compartir con la crew (pasos, foco, ánimo, sueño…): base de las dinámicas */
const CAMPOS = { pasos: [0, 100000], focoMin: [0, 1440], animo: [1, 5], energia: [1, 5], suenoH: [0, 24], ejercicioMin: [0, 1440], aguaVasos: [0, 40], aprendizajeMin: [0, 1440], recup: [1, 3], fcReposo: [30, 150], vfc: [5, 250], salud: [0, 1] };
ruta('PUT', '/v1/crews/:id/estado', async ({ req, p, yo }) => {
  const c = miembro(p.id, yo.id), b = await json(req), datos = {};
  for (const [k, [lo, hi]] of Object.entries(CAMPOS)) if (typeof b[k] === 'number' && Number.isFinite(b[k])) datos[k] = Math.min(hi, Math.max(lo, b[k]));
  const fecha = fechaEn(Date.now(), c.zona);
  const previo = uno('SELECT datos FROM estados WHERE crew_id = ? AND usuario_id = ? AND fecha = ?', c.id, yo.id, fecha);
  const final = { ...(previo ? JSON.parse(previo.datos) : {}), ...datos };
  if (datos.salud === 0) for (const k of ['recup', 'fcReposo', 'vfc']) delete final[k]; // dejó de compartir su salud
  correr('INSERT OR REPLACE INTO estados (crew_id, usuario_id, fecha, datos, ts) VALUES (?, ?, ?, ?, ?)', c.id, yo.id, fecha, JSON.stringify(final), Date.now());
  avisarCrew(c.id, { tipo: 'estado', de: yo.id }, null);
  return final;
});

/** los días anteriores (hasta 14), con los números reales de Health Connect y del foco: así un reto que empezó antes
    de conectar o de abrir la app cuenta también esos días. Solo se completan campos de actividad; el ánimo y la salud
    de días pasados no se tocan */
const CAMPOS_HISTORIA = ['pasos', 'focoMin', 'ejercicioMin', 'suenoH', 'aprendizajeMin'];
ruta('POST', '/v1/crews/:id/estado/historia', async ({ req, p, yo }) => {
  const c = miembro(p.id, yo.id), { dias } = await json(req), hoy = fechaEn(Date.now(), c.zona), limite = sumarDias(hoy, -14);
  if (!Array.isArray(dias)) falla(400, 'dias inválido');
  let n = 0;
  for (const d of dias.slice(0, 15)) {
    if (!esFecha(d?.fecha) || d.fecha > hoy || d.fecha < limite) continue;
    const datos = {};
    for (const k of CAMPOS_HISTORIA) { const [lo, hi] = CAMPOS[k]; if (typeof d[k] === 'number' && Number.isFinite(d[k])) datos[k] = Math.min(hi, Math.max(lo, d[k])); }
    if (!Object.keys(datos).length) continue;
    const previo = uno('SELECT datos FROM estados WHERE crew_id = ? AND usuario_id = ? AND fecha = ?', c.id, yo.id, d.fecha);
    const antes = previo ? JSON.parse(previo.datos) : {};
    // nunca bajar un número ya compartido (el teléfono pudo leer menos de lo que había)
    const final = { ...antes };
    for (const [k, v] of Object.entries(datos)) final[k] = Math.max(v, antes[k] ?? 0);
    if (JSON.stringify(final) === JSON.stringify(antes)) continue;
    correr('INSERT OR REPLACE INTO estados (crew_id, usuario_id, fecha, datos, ts) VALUES (?, ?, ?, ?, ?)', c.id, yo.id, d.fecha, JSON.stringify(final), Date.now());
    n++;
  }
  if (n) avisarCrew(c.id, { tipo: 'estado', de: yo.id }, null);
  return { actualizados: n };
});

ruta('GET', '/v1/crews/:id/estado', ({ p, q, yo }) => {
  const c = miembro(p.id, yo.id), hoy = fechaEn(Date.now(), c.zona);
  const desde = esFecha(q.get('desde')) ? q.get('desde') : hoy, hasta = esFecha(q.get('hasta')) ? q.get('hasta') : hoy;
  return todos('SELECT usuario_id, fecha, datos FROM estados WHERE crew_id = ? AND fecha BETWEEN ? AND ?', c.id, desde, hasta)
    .map(r => ({ usuario: r.usuario_id, fecha: r.fecha, ...JSON.parse(r.datos) }));
});

/* retos de la crew: una meta para todos en un rango de fechas; el avance sale de los datos reales */
const METRICAS = ['pasos', 'focoMin', 'ejercicioMin', 'aprendizajeMin', 'fotos', 'tareas'];
function avanceReto(r) {
  const miembros = todos('SELECT usuario_id FROM miembros WHERE crew_id = ?', r.crew_id).map(m => m.usuario_id);
  const por = Object.fromEntries(miembros.map(id => [id, 0]));
  if (r.metrica === 'fotos') {
    for (const f of todos('SELECT usuario_id, COUNT(DISTINCT fecha) n FROM fotos WHERE crew_id = ? AND fecha BETWEEN ? AND ? GROUP BY usuario_id', r.crew_id, r.desde, r.hasta)) if (f.usuario_id in por) por[f.usuario_id] = f.n;
  } else if (r.metrica === 'tareas') {
    const ini = Date.parse(`${r.desde}T00:00:00Z`) - 864e5, fin = Date.parse(`${r.hasta}T23:59:59Z`) + 864e5;
    for (const t of todos('SELECT hecha_por, COUNT(*) n FROM tareas WHERE crew_id = ? AND hecha_ts BETWEEN ? AND ? GROUP BY hecha_por', r.crew_id, ini, fin)) if (t.hecha_por in por) por[t.hecha_por] = t.n;
  } else {
    for (const e of todos('SELECT usuario_id, datos FROM estados WHERE crew_id = ? AND fecha BETWEEN ? AND ?', r.crew_id, r.desde, r.hasta)) {
      const v = JSON.parse(e.datos)[r.metrica];
      if (typeof v === 'number' && e.usuario_id in por) por[e.usuario_id] += v;
    }
  }
  const total = Object.values(por).reduce((a, b) => a + b, 0);
  return { id: r.id, titulo: r.titulo, metrica: r.metrica, meta: r.meta, desde: r.desde, hasta: r.hasta, creador: r.creador, total, por };
}

ruta('GET', '/v1/crews/:id/retos', ({ p, yo }) => {
  const c = miembro(p.id, yo.id), hoy = fechaEn(Date.now(), c.zona);
  return todos('SELECT * FROM retos WHERE crew_id = ? AND hasta >= ? ORDER BY hasta', c.id, sumarDias(hoy, -7)).map(avanceReto);
});

ruta('POST', '/v1/crews/:id/retos', async ({ req, p, yo }) => {
  const c = miembro(p.id, yo.id), { titulo, metrica, meta, dias } = await json(req);
  const t = texto(titulo, 80, 'titulo') ?? falla(400, 'Missing title');
  if (!METRICAS.includes(metrica)) falla(400, 'métrica inválida');
  if (!(Number(meta) > 0)) falla(400, 'meta inválida');
  const hoy = fechaEn(Date.now(), c.zona), id = nuevoId();
  correr('INSERT INTO retos (id, crew_id, creador, titulo, metrica, meta, desde, hasta, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, c.id, yo.id, t, metrica, Number(meta), hoy, sumarDias(hoy, Math.min(60, Math.max(1, Number(dias) || 7)) - 1), Date.now());
  avisarCrew(c.id, { tipo: 'reto', id, de: yo.id, nombre: yo.nombre, titulo: t });
  push(idsCrew(c.id), 'reto', { n: yo.nombre, t, c: c.nombre }, '/crew', yo.id);
  return avanceReto(uno('SELECT * FROM retos WHERE id = ?', id));
});

ruta('DELETE', '/v1/retos/:id', ({ p, yo }) => {
  const r = uno('SELECT * FROM retos WHERE id = ?', p.id);
  if (!r) falla(404, 'no existe');
  const c = miembro(r.crew_id, yo.id);
  if (r.creador !== yo.id && c.rol !== 'admin') falla(403, 'Only whoever created it can delete it');
  correr('DELETE FROM retos WHERE id = ?', r.id);
  avisarCrew(c.id, { tipo: 'reto', id: r.id, borrado: true });
  return { ok: true };
});

/* bitácora de la crew: el registro del equipo (notas, avances, problemas y decisiones), de todos los miembros */
const TIPOS_BITACORA = ['nota', 'avance', 'problema', 'decision', 'standup', 'retro', 'kudos']; // 'resumen' y 'acta' los escribe NOVA
/** la retro anónima no dice quién la escribió (salvo a su autor, para que pueda borrarla) */
const anonima = b => { if (b.tipo !== 'retro') return false; try { return !!JSON.parse(b.texto).anonimo; } catch { return false; } };
const verBitacora = (b, yo) => ({ id: b.id, usuario: anonima(b) && b.usuario_id !== yo ? null : b.usuario_id, mia: b.usuario_id === yo, ts: b.ts, tipo: b.tipo, texto: b.texto, ...(b.audio ? { audio: { url: `/v1/audios/${b.id}`, ms: b.audio, ...(b.transcripcion ? { transcripcion: b.transcripcion } : {}) } } : {}) });

/* ─────────── Gemini (texto): transcribir notas de voz y escribir el resumen semanal ───────────
   La clave llega como secreto GEMINI_API_KEY; sin ella, no se transcribe y el resumen se arma sin IA. */
const GEMINI = process.env.GEMINI_API_KEY, MODELOS = (process.env.MODELO_TEXTO ?? 'gemini-2.5-flash,gemini-flash-latest,gemini-2.0-flash').split(',');
let modeloOk = null;
async function gemini(partes, max = 1200, enJson = false) {
  if (!GEMINI) return null;
  for (const m of modeloOk ? [modeloOk] : MODELOS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI },
      body: JSON.stringify({ contents: [{ role: 'user', parts: partes }], generationConfig: { temperature: 0.3, maxOutputTokens: max, ...(enJson ? { responseMimeType: 'application/json' } : {}), thinkingConfig: m.startsWith('gemini-2.5') ? { thinkingBudget: 0 } : undefined } }),
    }).catch(e => ({ ok: false, status: 0, text: async () => e.message }));
    if (r.status === 404) continue;
    if (!r.ok) { console.warn('gemini', m, r.status, (await r.text()).slice(0, 200)); return null; }
    modeloOk = m;
    const j = await r.json();
    return j.candidates?.[0]?.content?.parts?.map(x => x.text ?? '').join('').trim() || null;
  }
  return null;
}
const transcribiendo = new Set();
async function transcribir(id) {
  if (!GEMINI || transcribiendo.has(id)) return;
  const f = join(AUDIOS, `${id}.m4a`);
  if (!existsSync(f)) return;
  transcribiendo.add(id);
  try {
    const datos = readFileSync(f).toString('base64');
    const pedir = mime => gemini([{ text: 'Transcribe this voice note exactly, in the language it is spoken. Add punctuation. Output only the transcription, no comments. If there is no speech, output: (sin voz)' }, { inlineData: { mimeType: mime, data: datos } }], 2000);
    const t = (await pedir('audio/mp4')) ?? (await pedir('audio/aac'));
    if (!t) return;
    correr('UPDATE bitacora SET transcripcion = ? WHERE id = ?', t.slice(0, 6000), id);
    const b = uno('SELECT crew_id FROM bitacora WHERE id = ?', id);
    if (b) avisarCrew(b.crew_id, { tipo: 'bitacora', id });
  } catch (e) { console.warn('transcribir', id, e.message); } finally { transcribiendo.delete(id); }
}
// al arrancar: transcribe las notas que quedaron sin texto (por ejemplo, las de antes de tener la clave)
setTimeout(async () => { for (const b of todos('SELECT id FROM bitacora WHERE audio IS NOT NULL AND transcripcion IS NULL ORDER BY ts DESC LIMIT 30')) await transcribir(b.id); }, 30e3);
ruta('GET', '/v1/crews/:id/bitacora', ({ p, q, yo }) => {
  const c = miembro(p.id, yo.id), antes = Number(q.get('antes')) || Date.now() + 1;
  return todos('SELECT * FROM bitacora WHERE crew_id = ? AND ts < ? ORDER BY ts DESC LIMIT 60', c.id, antes).map(b => verBitacora(b, yo.id));
});
/** buscar en toda la bitácora de la crew: texto, transcripciones y respuestas del standup (sin tildes ni mayúsculas) */
const sinTildes = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
ruta('GET', '/v1/crews/:id/bitacora/buscar', ({ p, q, yo }) => {
  const c = miembro(p.id, yo.id), palabras = sinTildes(q.get('q')).split(/\s+/).filter(w => w.length > 1).slice(0, 6), autor = q.get('autor');
  if (!palabras.length && !autor) return [];
  // todas las palabras primero; si no, las que tengan al menos la mitad (las más recientes primero dentro de cada nivel)
  const minimo = Math.max(1, Math.ceil(palabras.length / 2));
  return todos(`SELECT * FROM bitacora WHERE crew_id = ?${autor ? ' AND usuario_id = ?' : ''} ORDER BY ts DESC LIMIT 2000`, c.id, ...(autor ? [autor] : []))
    .map(b => { const t = sinTildes(`${b.texto} ${b.transcripcion ?? ''}`); return { b, n: palabras.filter(w => t.includes(w)).length }; })
    .filter(x => !palabras.length || x.n >= minimo).sort((x, y) => y.n - x.n || y.b.ts - x.b.ts)
    .slice(0, 40).map(x => verBitacora(x.b, yo.id));
});
ruta('POST', '/v1/crews/:id/bitacora', async ({ req, p, yo }) => {
  const c = miembro(p.id, yo.id), { texto: tx, tipo } = await json(req);
  const t = texto(tx, 2000, 'texto') ?? falla(400, 'Missing text');
  const id = nuevoId(), ts = Date.now(), ti = TIPOS_BITACORA.includes(tipo) ? tipo : 'nota';
  correr('INSERT INTO bitacora (id, crew_id, usuario_id, ts, tipo, texto) VALUES (?, ?, ?, ?, ?, ?)', id, c.id, yo.id, ts, ti, t);
  avisarCrew(c.id, { tipo: 'bitacora', id, de: yo.id, nombre: yo.nombre });
  // el standup viaja como JSON {ayer, hoy, bloqueo}: el aviso muestra el plan de hoy (y el bloqueo, si hay)
  let resumen = t;
  if (ti === 'standup') { try { const j = JSON.parse(t); resumen = `${j.hoy ?? ''}${j.bloqueo ? ` · ⚠ ${j.bloqueo}` : ''}`; } catch {} }
  let bloqueo = null, j = null;
  if (['standup', 'retro', 'kudos'].includes(ti)) { try { j = JSON.parse(t); } catch { falla(400, 'Expected JSON'); } }
  if (ti === 'standup') bloqueo = j.bloqueo ?? null;
  if (ti === 'kudos') {
    // reconocimiento: le llega a quien se lo dieron; al resto, como entrada normal de la bitácora
    const para = (Array.isArray(j.para) ? j.para : []).filter(u => u !== yo.id && idsCrew(c.id).includes(u));
    if (!para.length) falla(400, 'Kudos need someone from the crew');
    push(para, 'kudos', { n: yo.nombre, t: String(j.texto ?? '').slice(0, 140) }, '/journal?vista=crew', yo.id);
    espejo(c.id, 'kudos', `🙌 ${yo.nombre} → ${para.map(nombreDe).join(', ')}: ${String(j.texto ?? '').slice(0, 400)}`);
  } else if (ti === 'retro') {
    // la retro no avisa a nadie: se junta en el resumen del viernes
  } else {
    push(idsCrew(c.id), bloqueo ? 'bloqueo' : ti === 'standup' ? 'standup' : 'bitacora', { n: yo.nombre, c: c.nombre, t: (bloqueo ?? resumen).slice(0, 140) }, '/journal?vista=crew', yo.id);
    if (ti === 'standup') espejo(c.id, bloqueo ? 'bloqueo' : 'standup', `🧭 *Standup de ${yo.nombre}*\nAyer: ${j.ayer || '—'}\nHoy: ${j.hoy || '—'}${bloqueo ? `\n⚠ Bloqueo: ${bloqueo}` : ''}`);
    if (ti === 'decision') espejo(c.id, 'decision', `📌 Decisión (${yo.nombre}): ${t}`);
  }
  return verBitacora(uno('SELECT * FROM bitacora WHERE id = ?', id), yo.id);
});
/* nota de voz para la bitácora de la crew: el cuerpo es el audio (m4a/aac), máx. 6 MB y 3 min */
ruta('POST', '/v1/crews/:id/bitacora/audio', async ({ req, p, q, yo }) => {
  const c = miembro(p.id, yo.id);
  const b = await cuerpo(req, 6 * 1024 * 1024);
  if (b.length < 1000) falla(400, 'Audio too short');
  const ms = Math.max(500, Math.min(180e3, Math.round(Number(q.get('ms')) || 0)));
  const id = nuevoId(), ts = Date.now(), tx = texto(q.get('texto'), 500, 'texto') ?? '';
  writeFileSync(join(AUDIOS, `${id}.m4a`), b);
  correr("INSERT INTO bitacora (id, crew_id, usuario_id, ts, tipo, texto, audio) VALUES (?, ?, ?, ?, 'nota', ?, ?)", id, c.id, yo.id, ts, tx, ms);
  avisarCrew(c.id, { tipo: 'bitacora', id, de: yo.id, nombre: yo.nombre });
  push(idsCrew(c.id), 'bitacora', { n: yo.nombre, c: c.nombre, t: `🎙 ${tx || `${Math.round(ms / 1000)} s`}` }, '/journal?vista=crew', yo.id);
  transcribir(id);
  return verBitacora(uno('SELECT * FROM bitacora WHERE id = ?', id), yo.id);
});
ruta('GET', '/v1/audios/:id', ({ p, yo, res }) => {
  const b = uno('SELECT * FROM bitacora WHERE id = ?', p.id) ?? falla(404, 'no existe');
  miembro(b.crew_id, yo.id);
  const f = join(AUDIOS, `${b.id}.m4a`);
  if (!existsSync(f)) falla(404, 'no existe');
  const d = readFileSync(f);
  res.writeHead(200, { 'content-type': 'audio/mp4', 'content-length': d.length, 'cache-control': 'private, max-age=31536000' }); res.end(d);
});
ruta('DELETE', '/v1/bitacora/:id', ({ p, yo }) => {
  const b = uno('SELECT * FROM bitacora WHERE id = ?', p.id);
  if (!b) falla(404, 'no existe');
  if (b.usuario_id !== yo.id && miembro(b.crew_id, yo.id).rol !== 'admin') falla(403, 'Only whoever wrote it can delete it');
  correr('DELETE FROM bitacora WHERE id = ?', b.id);
  rmSync(join(AUDIOS, `${b.id}.m4a`), { force: true });
  avisarCrew(b.crew_id, { tipo: 'bitacora', id: b.id, borrada: true });
  return { ok: true };
});

/* metas del equipo (OKR): un objetivo con un plazo y sus resultados clave, cada uno con responsable.
   Un resultado es un hito (hecho / no hecho) o un número (actual de una meta, con unidad). El estado sale del avance
   contra el tiempo transcurrido: atrasado si va bajo el 70 % de lo esperado a la fecha. */
const fraccion = r => Math.max(0, Math.min(1, r.tipo === 'hito' ? (r.actual >= 1 ? 1 : 0) : r.meta > 0 ? r.actual / r.meta : 0));
function verMeta(m, zona) {
  const rs = todos('SELECT * FROM resultados WHERE meta_id = ? ORDER BY orden, actualizado', m.id);
  const avance = rs.length ? rs.reduce((a, r) => a + fraccion(r), 0) / rs.length : 0;
  const hoy = fechaEn(Date.now(), zona), dias = d => Date.parse(`${d}T12:00:00Z`);
  const total = Math.max(1, (dias(m.hasta) - dias(m.desde)) / 864e5), pasados = Math.max(0, Math.min(total, (dias(hoy) - dias(m.desde)) / 864e5));
  const esperado = pasados / total;
  const estado = avance >= 1 ? 'lista' : hoy > m.hasta ? 'vencida' : esperado > 0.15 && avance < esperado * 0.7 ? 'atrasada' : 'en_camino';
  return { id: m.id, titulo: m.titulo, desde: m.desde, hasta: m.hasta, creador: m.creador, avance, esperado, estado,
    resultados: rs.map(r => ({ id: r.id, titulo: r.titulo, responsable: r.responsable, tipo: r.tipo, meta: r.meta, actual: r.actual, unidad: r.unidad, avance: fraccion(r), actualizado: r.actualizado })) };
}
const metaDe = (id, yo) => { const m = uno('SELECT * FROM metas WHERE id = ?', id) ?? falla(404, 'no existe'); return { m, c: miembro(m.crew_id, yo.id) }; };
const resultadoValido = (b, crewId) => {
  const titulo = texto(b.titulo, 140, 'titulo') ?? falla(400, 'Missing title');
  const tipo = b.tipo === 'numero' ? 'numero' : 'hito';
  const meta = tipo === 'numero' ? Number(b.meta) > 0 ? Number(b.meta) : falla(400, 'meta inválida') : 1;
  const responsable = b.responsable && uno('SELECT 1 FROM miembros WHERE crew_id = ? AND usuario_id = ?', crewId, b.responsable) ? b.responsable : null;
  return { titulo, tipo, meta, responsable, unidad: tipo === 'numero' ? texto(b.unidad, 20, 'unidad') : null };
};
ruta('GET', '/v1/crews/:id/metas', ({ p, yo }) => { const c = miembro(p.id, yo.id); return todos('SELECT * FROM metas WHERE crew_id = ? AND cerrada = 0 ORDER BY hasta', c.id).map(m => verMeta(m, c.zona)); });
ruta('POST', '/v1/crews/:id/metas', async ({ req, p, yo }) => {
  const c = miembro(p.id, yo.id), b = await json(req);
  const titulo = texto(b.titulo, 120, 'titulo') ?? falla(400, 'Missing title');
  const hoy = fechaEn(Date.now(), c.zona), hasta = esFecha(b.hasta) && b.hasta > hoy ? b.hasta : sumarDias(hoy, 30);
  const id = nuevoId(), ahora = Date.now();
  correr('INSERT INTO metas (id, crew_id, creador, titulo, desde, hasta, creado) VALUES (?, ?, ?, ?, ?, ?, ?)', id, c.id, yo.id, titulo, hoy, hasta, ahora);
  (Array.isArray(b.resultados) ? b.resultados.slice(0, 8) : []).forEach((r, i) => {
    const v = resultadoValido(r, c.id);
    correr('INSERT INTO resultados (id, meta_id, titulo, responsable, tipo, meta, unidad, orden, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', nuevoId(), id, v.titulo, v.responsable, v.tipo, v.meta, v.unidad, i, ahora);
    if (v.responsable && v.responsable !== yo.id) push([v.responsable], 'resultadoAsignado', { n: yo.nombre, t: v.titulo, m: titulo }, '/crew', yo.id);
  });
  avisarCrew(c.id, { tipo: 'meta', id });
  push(idsCrew(c.id), 'metaNueva', { c: c.nombre, t: titulo }, '/crew', yo.id);
  return verMeta(uno('SELECT * FROM metas WHERE id = ?', id), c.zona);
});
ruta('PATCH', '/v1/metas/:id', async ({ req, p, yo }) => {
  const { m, c } = metaDe(p.id, yo), b = await json(req);
  if ('titulo' in b) correr('UPDATE metas SET titulo = ? WHERE id = ?', texto(b.titulo, 120, 'titulo') ?? m.titulo, m.id);
  if ('hasta' in b && esFecha(b.hasta)) correr('UPDATE metas SET hasta = ? WHERE id = ?', b.hasta, m.id);
  if ('cerrada' in b) correr('UPDATE metas SET cerrada = ? WHERE id = ?', b.cerrada ? 1 : 0, m.id);
  avisarCrew(c.id, { tipo: 'meta', id: m.id });
  return verMeta(uno('SELECT * FROM metas WHERE id = ?', m.id), c.zona);
});
ruta('DELETE', '/v1/metas/:id', ({ p, yo }) => {
  const { m, c } = metaDe(p.id, yo);
  if (m.creador !== yo.id && c.rol !== 'admin') falla(403, 'Only whoever created it can delete it');
  correr('DELETE FROM metas WHERE id = ?', m.id);
  avisarCrew(c.id, { tipo: 'meta', id: m.id, borrada: true });
  return { ok: true };
});
ruta('POST', '/v1/metas/:id/resultados', async ({ req, p, yo }) => {
  const { m, c } = metaDe(p.id, yo), v = resultadoValido(await json(req), c.id);
  const n = uno('SELECT COUNT(*) n FROM resultados WHERE meta_id = ?', m.id).n;
  if (n >= 8) falla(409, 'Up to 8 key results per goal');
  correr('INSERT INTO resultados (id, meta_id, titulo, responsable, tipo, meta, unidad, orden, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', nuevoId(), m.id, v.titulo, v.responsable, v.tipo, v.meta, v.unidad, n, Date.now());
  if (v.responsable && v.responsable !== yo.id) push([v.responsable], 'resultadoAsignado', { n: yo.nombre, t: v.titulo, m: m.titulo }, '/crew', yo.id);
  avisarCrew(c.id, { tipo: 'meta', id: m.id });
  return verMeta(m, c.zona);
});
ruta('PATCH', '/v1/resultados/:id', async ({ req, p, yo }) => {
  const r = uno('SELECT * FROM resultados WHERE id = ?', p.id) ?? falla(404, 'no existe');
  const { m, c } = metaDe(r.meta_id, yo), b = await json(req), antes = fraccion(r);
  if ('actual' in b && Number.isFinite(Number(b.actual))) correr('UPDATE resultados SET actual = ?, actualizado = ? WHERE id = ?', Math.max(0, Number(b.actual)), Date.now(), r.id);
  if ('sumar' in b && Number.isFinite(Number(b.sumar))) correr('UPDATE resultados SET actual = MAX(0, actual + ?), actualizado = ? WHERE id = ?', Number(b.sumar), Date.now(), r.id);
  if ('hecho' in b) correr('UPDATE resultados SET actual = ?, actualizado = ? WHERE id = ?', b.hecho ? 1 : 0, Date.now(), r.id);
  if ('titulo' in b) correr('UPDATE resultados SET titulo = ? WHERE id = ?', texto(b.titulo, 140, 'titulo') ?? r.titulo, r.id);
  if ('responsable' in b) {
    const nuevo = b.responsable && uno('SELECT 1 FROM miembros WHERE crew_id = ? AND usuario_id = ?', c.id, b.responsable) ? b.responsable : null;
    correr('UPDATE resultados SET responsable = ? WHERE id = ?', nuevo, r.id);
    if (nuevo && nuevo !== yo.id && nuevo !== r.responsable) push([nuevo], 'resultadoAsignado', { n: yo.nombre, t: r.titulo, m: m.titulo }, '/crew', yo.id);
  }
  const ahora = uno('SELECT * FROM resultados WHERE id = ?', r.id);
  if (antes < 1 && fraccion(ahora) >= 1) push(idsCrew(c.id), 'resultadoListo', { n: yo.nombre, t: ahora.titulo, m: m.titulo }, '/crew', yo.id);
  avisarCrew(c.id, { tipo: 'meta', id: m.id });
  return verMeta(uno('SELECT * FROM metas WHERE id = ?', m.id), c.zona);
});
ruta('DELETE', '/v1/resultados/:id', ({ p, yo }) => {
  const r = uno('SELECT * FROM resultados WHERE id = ?', p.id) ?? falla(404, 'no existe');
  const { m, c } = metaDe(r.meta_id, yo);
  correr('DELETE FROM resultados WHERE id = ?', r.id);
  avisarCrew(c.id, { tipo: 'meta', id: m.id });
  return verMeta(m, c.zona);
});

/* preferencias de avisos: { crew, equipo, standup, bitacora, retos } (todo encendido si no hay nada) */
ruta('GET', '/v1/yo/avisos', ({ yo }) => prefs(yo.id));
ruta('PUT', '/v1/yo/avisos', async ({ req, yo }) => {
  const b = await json(req), limpio = {};
  for (const k of ['crew', 'equipo', 'standup', 'bitacora', 'retos', 'salud', 'github']) if (typeof b[k] === 'boolean') limpio[k] = b[k];
  correr('INSERT INTO prefs_avisos (usuario_id, datos) VALUES (?, ?) ON CONFLICT(usuario_id) DO UPDATE SET datos = excluded.datos', yo.id, JSON.stringify(limpio));
  return limpio;
});

/* dispositivos para avisos push: el token de Expo de cada teléfono (se borra al cerrar sesión o si FCM lo da de baja) */
ruta('PUT', '/v1/yo/push', async ({ req, yo }) => {
  const { token, idioma } = await json(req);
  if (typeof token !== 'string' || !/^ExponentPushToken\[[\w-]+\]$/.test(token)) falla(400, 'token inválido');
  correr('INSERT INTO dispositivos (token, usuario_id, idioma, ts) VALUES (?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET usuario_id = excluded.usuario_id, idioma = excluded.idioma, ts = excluded.ts',
    token, yo.id, idioma === 'en' ? 'en' : 'es', Date.now());
  return { ok: true };
});
ruta('DELETE', '/v1/yo/push', async ({ req, yo }) => {
  const { token } = await json(req);
  correr('DELETE FROM dispositivos WHERE token = ? AND usuario_id = ?', String(token ?? ''), yo.id);
  return { ok: true };
});

/* errores de la app: llegan con o sin sesión (también los de la pantalla de entrada); se guardan los últimos 3000 */
const erroresPorIp = new Map();
ruta('POST', '/v1/errores', async ({ req, q }) => {
  const ip = String(req.headers['fly-client-ip'] ?? req.socket.remoteAddress), ahora = Date.now();
  const r = erroresPorIp.get(ip) ?? { n: 0, desde: ahora };
  if (ahora - r.desde > 10 * 60e3) { r.n = 0; r.desde = ahora; }
  if (++r.n > 40) return { ok: false };
  erroresPorIp.set(ip, r);
  const b = await json(req), yo = sesion(tokenDe(req, q));
  const corta = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
  const mensaje = corta(b.mensaje, 600) ?? falla(400, 'Missing message');
  correr('INSERT INTO errores (ts, usuario_id, version, plataforma, donde, mensaje, pila, fatal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ahora, yo?.id ?? null, corta(b.version, 80), corta(b.plataforma, 40), corta(b.donde, 120), mensaje, corta(b.pila, 6000), b.fatal ? 1 : 0);
  correr('DELETE FROM errores WHERE id <= (SELECT MAX(id) - 3000 FROM errores)');
  return { ok: true };
}, { publica: true });
ruta('GET', '/v1/admin/errores', ({ q }) => todos(`SELECT e.*, u.nombre FROM errores e LEFT JOIN usuarios u ON u.id = e.usuario_id
  WHERE e.ts > ? ORDER BY e.id DESC LIMIT 300`, Date.now() - (Number(q.get('dias')) || 7) * 864e5), { publica: 'admin' });

/* acceso anticipado: la página nova-crew-web pide acceso conversando con NOVA. Un correo = una solicitud (si vuelve, se
   actualiza y conserva su número). Límite de 8 por IP por hora. Se ven con api/solicitudes.sh */
db.exec(`CREATE TABLE IF NOT EXISTS solicitudes (numero INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, nombre TEXT NOT NULL,
  para TEXT NOT NULL, equipo TEXT, usos TEXT, telefono TEXT, origen TEXT, ts INTEGER NOT NULL, actualizado INTEGER)`);
const accesoPorIp = new Map();
ruta('POST', '/v1/acceso', async ({ req }) => {
  const ip = String(req.headers['fly-client-ip'] ?? req.socket.remoteAddress), ahora = Date.now();
  const r = accesoPorIp.get(ip) ?? { n: 0, desde: ahora };
  if (ahora - r.desde > 60 * 60e3) { r.n = 0; r.desde = ahora; }
  if (++r.n > 8) falla(429, 'Muchas solicitudes seguidas. Prueba en un rato.');
  accesoPorIp.set(ip, r);
  const b = await json(req);
  const nombre = texto(b.nombre, 60, 'nombre') ?? falla(400, 'Falta tu nombre');
  const email = (texto(b.email, 120, 'email') ?? '').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) falla(400, 'Ese correo no parece válido');
  const para = b.para === 'equipo' ? 'equipo' : 'ti';
  const equipo = para === 'equipo' ? texto(b.equipo, 20, 'equipo') : null;
  const usos = JSON.stringify((Array.isArray(b.usos) ? b.usos : []).filter(x => typeof x === 'string').slice(0, 12).map(x => x.slice(0, 40)));
  const telefono = ['android', 'iphone'].includes(b.telefono) ? b.telefono : null;
  const origen = typeof b.origen === 'string' ? b.origen.slice(0, 120) : null;
  const previa = uno('SELECT numero FROM solicitudes WHERE email = ?', email);
  if (previa){
    correr('UPDATE solicitudes SET nombre = ?, para = ?, equipo = ?, usos = ?, telefono = ?, actualizado = ? WHERE numero = ?', nombre, para, equipo, usos, telefono, ahora, previa.numero);
    return { numero: previa.numero, ya: true };
  }
  const { lastInsertRowid } = correr('INSERT INTO solicitudes (email, nombre, para, equipo, usos, telefono, origen, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', email, nombre, para, equipo, usos, telefono, origen, ahora);
  const numero = Number(lastInsertRowid);
  // aviso al teléfono de quienes se anotaron (api/solicitudes.sh avisarme correo)
  const detalle = [para === 'equipo' ? `equipo ${equipo ?? ''}`.trim() : 'para sí', telefono === 'iphone' ? 'iPhone' : telefono === 'android' ? 'Android' : null, ...JSON.parse(usos).slice(0, 3)].filter(Boolean).join(' · ');
  push(todos('SELECT usuario_id FROM avisos_acceso').map(r => r.usuario_id), 'acceso', { k: String(numero).padStart(4, '0'), n: nombre, t: detalle }, '/');
  return { numero, ya: false };
}, { publica: true });
db.exec('CREATE TABLE IF NOT EXISTS avisos_acceso (usuario_id TEXT PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE)');
ruta('GET', '/v1/admin/solicitudes', () => todos('SELECT * FROM solicitudes ORDER BY numero DESC LIMIT 1000'), { publica: 'admin' });
ruta('DELETE', '/v1/admin/solicitudes/:n', ({ p }) => ({ borradas: Number(correr('DELETE FROM solicitudes WHERE numero = ?', Number(p.n)).changes) }), { publica: 'admin' });
/* quién recibe el aviso de cada solicitud nueva: { email, quitar? } */
ruta('POST', '/v1/admin/avisos-acceso', async ({ req }) => {
  const b = await json(req), u = uno('SELECT id, nombre FROM usuarios WHERE email = ?', String(b.email ?? '').toLowerCase()) ?? falla(404, 'No hay una cuenta con ese correo');
  if (b.quitar) correr('DELETE FROM avisos_acceso WHERE usuario_id = ?', u.id); else correr('INSERT OR IGNORE INTO avisos_acceso (usuario_id) VALUES (?)', u.id);
  return todos('SELECT u.nombre, u.email FROM avisos_acceso a JOIN usuarios u ON u.id = a.usuario_id');
}, { publica: 'admin' });

/* respaldo: copia consistente de la base (VACUUM INTO) + lista y descarga de fotos/avatares para copiarlos fuera de Fly */
ruta('GET', '/v1/admin/respaldo/base', ({ res }) => {
  const f = join(DATOS, 'respaldo.db');
  rmSync(f, { force: true });
  db.exec(`VACUUM INTO '${f}'`);
  const b = readFileSync(f); rmSync(f, { force: true });
  res.writeHead(200, { 'content-type': 'application/vnd.sqlite3', 'content-length': b.length }); res.end(b);
}, { publica: 'admin' });
ruta('GET', '/v1/admin/respaldo/archivos', () => {
  const lista = [];
  for (const dir of ['fotos', 'avatares', 'audios', 'archivos']) {
    const d = join(DATOS, dir);
    if (!existsSync(d)) continue;
    for (const n of readdirSync(d)) { const st = statSync(join(d, n)); if (st.isFile()) lista.push({ ruta: `${dir}/${n}`, tam: st.size, mod: st.mtimeMs }); }
  }
  return lista;
}, { publica: 'admin' });
ruta('GET', '/v1/admin/respaldo/archivo', ({ q, res }) => {
  const r = String(q.get('ruta') ?? '');
  if (!/^(fotos|avatares)\/[\w.-]+\.(jpg|mp4)$|^audios\/[\w-]+\.m4a$|^archivos\/[\w-]+$/.test(r)) falla(400, 'ruta inválida');
  const f = join(DATOS, r);
  if (!existsSync(f)) falla(404, 'no existe');
  const b = readFileSync(f);
  res.writeHead(200, { 'content-type': r.endsWith('.m4a') || r.endsWith('.mp4') ? 'video/mp4' : r.startsWith('archivos/') ? 'application/octet-stream' : 'image/jpeg', 'content-length': b.length }); res.end(b);
}, { publica: 'admin' });

/* administración de cuentas (solo con la clave de administrador) */
ruta('POST', '/v1/admin/cuentas', async ({ req }) => {
  const { email, nombre, clave } = await json(req);
  const correo = String(email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) falla(400, 'correo inválido');
  if (typeof clave !== 'string' || clave.length < 8) falla(400, 'la clave debe tener al menos 8 caracteres');
  const n = texto(nombre, 40, 'nombre') ?? correo.split('@')[0];
  const ya = uno('SELECT * FROM usuarios WHERE email = ?', correo);
  if (ya) { correr('UPDATE usuarios SET hash = ?, nombre = ?, version = version + 1 WHERE id = ?', hashClave(clave), n, ya.id); return { id: ya.id, actualizada: true }; }
  const id = nuevoId();
  correr('INSERT INTO usuarios (id, email, nombre, hash, creado) VALUES (?, ?, ?, ?, ?)', id, correo, n, hashClave(clave), Date.now());
  return { id, creada: true };
}, { publica: 'admin' });

ruta('POST', '/v1/admin/push-prueba', async ({ req }) => {
  const { email } = await json(req);
  const u = uno('SELECT id FROM usuarios WHERE email = ?', String(email ?? '').trim().toLowerCase()) ?? falla(404, 'no existe');
  const n = uno('SELECT COUNT(*) n FROM dispositivos WHERE usuario_id = ?', u.id).n;
  await push([u.id], 'prueba', {}, '/');
  return { dispositivos: n };
}, { publica: 'admin' });

/** prueba: escribe ya el resumen semanal de la crew de esa cuenta (sin aviso push si push=false) */
ruta('POST', '/v1/admin/resumen-prueba', async ({ req }) => {
  const { email, push: conPush } = await json(req);
  const u = uno('SELECT id FROM usuarios WHERE email = ?', String(email ?? '').trim().toLowerCase()) ?? falla(404, 'no existe');
  const c = uno('SELECT c.* FROM crews c JOIN miembros m ON m.crew_id = c.id WHERE m.usuario_id = ? ORDER BY m.unido LIMIT 1', u.id) ?? falla(404, 'sin crew');
  return verBitacora(await resumenSemana(c, conPush !== false));
}, { publica: 'admin' });

ruta('GET', '/v1/admin/cuentas', () => todos('SELECT id, email, nombre, creado FROM usuarios ORDER BY creado'), { publica: 'admin' });

ruta('DELETE', '/v1/admin/cuentas/:id', ({ p }) => {
  for (const f of todos('SELECT id FROM fotos WHERE usuario_id = ?', p.id)) borrarArchivos(f.id);
  correr('DELETE FROM usuarios WHERE id = ?', p.id);
  return { ok: true };
}, { publica: 'admin' });

/* ─────────── servidor ─────────── */
const tokenDe = (req, q) => (req.headers.authorization ?? '').replace(/^Bearer /, '') || q.get('k');
const adminOk = req => { const a = Buffer.from(String(req.headers['x-admin'] ?? '')), b = Buffer.from(ADMIN); return a.length === b.length && timingSafeEqual(a, b); };

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), q = url.searchParams;
  // la app web (pruebas) llama desde otro origen; la sesión va en la cabecera, sin cookies
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-largo-mini, x-admin');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    const r = rutas.find(x => x.metodo === req.method && x.re.test(url.pathname));
    if (!r) falla(404, 'ruta no encontrada');
    const m = url.pathname.match(r.re), p = Object.fromEntries(r.claves.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    let yo = null;
    if (r.publica === 'admin') { if (!adminOk(req)) falla(401, 'no autorizado'); }
    else if (!r.publica) { yo = sesion(tokenDe(req, q)); if (!yo) falla(401, 'Your session expired. Sign in again.'); }
    const salida = await r.fn({ req, res, p, q, yo });
    if (!res.headersSent) { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(salida ?? null)); }
  } catch (e) {
    const estado = e instanceof Fallo ? e.estado : 500;
    if (estado === 500) console.error(req.method, url.pathname, e);
    if (!res.headersSent) { res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: estado === 500 ? 'Server error' : e.message })); }
  }
});

const wss = new WebSocketServer({ noServer: true });
servidor.on('upgrade', (req, socket, cabeza) => {
  const url = new URL(req.url, 'http://x');
  const yo = url.pathname === '/v1/vivo' ? sesion(url.searchParams.get('k')) : null;
  if (!yo) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, cabeza, ws => {
    const set = conexiones.get(yo.id) ?? new Set();
    set.add(ws); conexiones.set(yo.id, set);
    ws.vivo = true;
    ws.on('pong', () => { ws.vivo = true; });
    ws.on('close', () => { set.delete(ws); if (!set.size) conexiones.delete(yo.id); });
    ws.send(JSON.stringify({ tipo: 'hola' }));
  });
});
// latido: corta las conexiones muertas (el teléfono se durmió sin cerrar)
setInterval(() => { for (const ws of wss.clients) { if (!ws.vivo) { ws.terminate(); continue; } ws.vivo = false; ws.ping(); } }, 30e3);

/* ─────────── nota rápida: un audio corto → lo que dijiste + qué es (tarea, recordatorio, lista o nota) ───────────
   La app lo ejecuta con las mismas herramientas de NOVA, así queda donde corresponde y en «Lo que hizo NOVA». */
ruta('POST', '/v1/nota-rapida', async ({ req, q }) => {
  if (!GEMINI) falla(503, 'Voice notes need the Gemini key on the server');
  const b = await cuerpo(req, 4 * 1024 * 1024);
  if (b.length < 800) falla(400, 'Audio too short');
  const listas = String(q.get('listas') ?? '').slice(0, 400), ahora = String(q.get('ahora') ?? '').slice(0, 40), idioma = q.get('i') === 'en' ? 'English' : 'Spanish';
  const pedir = mime => gemini([
    { text: `Transcribe this short voice note (${idioma}) and decide what it is. Local time now: ${ahora}. Their lists: ${listas || 'none'}.
Return ONLY JSON: {"texto": exact transcription, "tipo": "tarea" | "recordatorio" | "lista" | "nota", "titulo": short clean title in their language,
"hora": "HH:MM" 24h if a reminder has a time, "en_minutos": number if they said "in X minutes", "dia": "hoy" | "manana" if said,
"lista": existing list name (or a new short one) if tipo is lista, "items": [items] if tipo is lista}.
Rules: "recuérdame…"/"avísame…" = recordatorio; "agrega X a la lista…"/"comprar X" = lista; something to do = tarea; ideas, feelings, thoughts = nota. If there is no speech, tipo "nota" and texto "".` },
    { inlineData: { mimeType: mime, data: b.toString('base64') } },
  ], 800, true);
  const r = (await pedir('audio/mp4')) ?? (await pedir('audio/aac'));
  if (!r) falla(502, 'Could not understand the audio');
  try { const j = JSON.parse(r.replace(/^```json\s*|\s*```$/g, '')); return { texto: String(j.texto ?? ''), tipo: ['tarea', 'recordatorio', 'lista', 'nota'].includes(j.tipo) ? j.tipo : 'nota', titulo: String(j.titulo ?? j.texto ?? '').slice(0, 140), hora: j.hora ?? null, en_minutos: j.en_minutos ?? null, dia: j.dia ?? null, lista: j.lista ?? null, items: Array.isArray(j.items) ? j.items.map(String).slice(0, 20) : [] }; }
  catch { return { texto: r.slice(0, 500), tipo: 'nota', titulo: r.slice(0, 140), items: [] }; }
});

/* ─────────── listas: compras, ideas, libros… tuyas o compartidas con la crew (todos ven y marcan) ─────────── */
const verLista = l => ({ id: l.id, nombre: l.nombre, icono: l.icono, crew: l.crew_id, creador: l.usuario_id, creado: l.creado,
  items: todos('SELECT * FROM items WHERE lista_id = ? ORDER BY hecho, ts', l.id).map(i => ({ id: i.id, texto: i.texto, hecho: !!i.hecho, por: i.por, ts: i.ts })) });
function listaVisible(id, yo) {
  const l = uno('SELECT * FROM listas WHERE id = ?', id) ?? falla(404, 'no existe');
  if (l.crew_id) miembro(l.crew_id, yo.id); else if (l.usuario_id !== yo.id) falla(404, 'no existe');
  return l;
}
const avisarLista = l => { if (l.crew_id) avisarCrew(l.crew_id, { tipo: 'lista', id: l.id }); };
ruta('GET', '/v1/listas', ({ yo }) => {
  const crews = todos('SELECT crew_id FROM miembros WHERE usuario_id = ?', yo.id).map(m => m.crew_id);
  return todos(`SELECT * FROM listas WHERE (usuario_id = ? AND crew_id IS NULL)${crews.length ? ` OR crew_id IN (${crews.map(() => '?').join(',')})` : ''} ORDER BY creado`, yo.id, ...crews).map(verLista);
});
ruta('POST', '/v1/listas', async ({ req, yo }) => {
  const { nombre, icono, crew } = await json(req);
  const n = texto(nombre, 40, 'nombre') ?? falla(400, 'Missing name');
  if (crew) miembro(crew, yo.id);
  const id = nuevoId();
  correr('INSERT INTO listas (id, usuario_id, crew_id, nombre, icono, creado) VALUES (?, ?, ?, ?, ?, ?)', id, yo.id, crew ?? null, n, String(icono ?? '').slice(0, 40) || null, Date.now());
  const l = uno('SELECT * FROM listas WHERE id = ?', id); avisarLista(l);
  return verLista(l);
});
ruta('DELETE', '/v1/listas/:id', ({ p, yo }) => {
  const l = listaVisible(p.id, yo);
  if (l.usuario_id !== yo.id && (!l.crew_id || miembro(l.crew_id, yo.id).rol !== 'admin')) falla(403, 'Only whoever created it can delete it');
  correr('DELETE FROM listas WHERE id = ?', l.id); avisarLista(l);
  return { ok: true };
});
ruta('POST', '/v1/listas/:id/items', async ({ req, p, yo }) => {
  const l = listaVisible(p.id, yo), { textos, texto: uno1 } = await json(req);
  const lista = (Array.isArray(textos) ? textos : [uno1]).map(x => texto(x, 140, 'texto')).filter(Boolean).slice(0, 30);
  if (!lista.length) falla(400, 'Missing text');
  const ts = Date.now();
  lista.forEach((x, i) => correr('INSERT INTO items (id, lista_id, texto, por, ts) VALUES (?, ?, ?, ?, ?)', nuevoId(), l.id, x, yo.id, ts + i));
  avisarLista(l);
  return verLista(l);
});
ruta('PATCH', '/v1/items/:id', async ({ req, p, yo }) => {
  const it = uno('SELECT * FROM items WHERE id = ?', p.id) ?? falla(404, 'no existe');
  const l = listaVisible(it.lista_id, yo), b = await json(req);
  if (typeof b.hecho === 'boolean') correr('UPDATE items SET hecho = ? WHERE id = ?', b.hecho ? 1 : 0, it.id);
  if (b.texto) correr('UPDATE items SET texto = ? WHERE id = ?', texto(b.texto, 140, 'texto'), it.id);
  avisarLista(l);
  return { ok: true };
});
ruta('DELETE', '/v1/items/:id', ({ p, yo }) => {
  const it = uno('SELECT * FROM items WHERE id = ?', p.id) ?? falla(404, 'no existe');
  const l = listaVisible(it.lista_id, yo);
  correr('DELETE FROM items WHERE id = ?', it.id); avisarLista(l);
  return { ok: true };
});
/** borrar lo marcado de una lista (por ejemplo, después de comprar) */
ruta('POST', '/v1/listas/:id/limpiar', ({ p, yo }) => { const l = listaVisible(p.id, yo); correr('DELETE FROM items WHERE lista_id = ? AND hecho = 1', l.id); avisarLista(l); return verLista(l); });

/* ─────────── órdenes al teléfono: NOVA en el Mac (mac/) le pide algo al teléfono ───────────
   Alarmas, música, mensajes, un pantallazo del celular… lo que solo el teléfono puede hacer. Viven en memoria 10 min.
   Con la app abierta llegan al instante por el tiempo real ({tipo: 'orden'}); si no, un aviso push la abre y la app
   hace las pendientes al conectarse. El teléfono primero la «toma» (una sola vez, aunque haya varios abiertos) y
   después devuelve la respuesta, que el Mac consulta. */
const ordenes = new Map(); // id → { usuario, herramienta, args, resumen, creada, tomada, respuesta }
const VIDA_ORDEN = 10 * 60e3;
setInterval(() => { const viejo = Date.now() - VIDA_ORDEN; for (const [id, o] of ordenes) if (o.creada < viejo) ordenes.delete(id); }, 60e3);
const verOrden = (id, o) => ({ id, herramienta: o.herramienta, args: o.args, creada: o.creada });
const ordenDe = (id, yo) => { const o = ordenes.get(id); if (!o || o.usuario !== yo.id) falla(404, 'No such order'); return o; };
ruta('POST', '/v1/telefono/ordenes', async ({ req, yo }) => {
  const { herramienta, args, resumen } = await json(req);
  const h = texto(herramienta, 40, 'herramienta') ?? falla(400, 'Missing tool');
  if ([...ordenes.values()].filter(o => o.usuario === yo.id).length >= 30) falla(429, 'Too many pending orders');
  const id = nuevoId(), o = { usuario: yo.id, herramienta: h, args: args && typeof args === 'object' && !Array.isArray(args) ? args : {}, resumen: texto(resumen, 80, 'resumen') ?? h.replace(/_/g, ' '), creada: Date.now(), tomada: false, respuesta: null };
  ordenes.set(id, o);
  const abiertos = [...(conexiones.get(yo.id) ?? [])].filter(ws => ws.readyState === 1).length;
  if (abiertos) avisarA([yo.id], { tipo: 'orden', ...verOrden(id, o) });
  else await push([yo.id], 'orden', { t: o.resumen }, '/');
  return { id, entregada: abiertos > 0 };
});
ruta('GET', '/v1/telefono/ordenes', ({ yo }) => [...ordenes].filter(([, o]) => o.usuario === yo.id && !o.tomada).map(([id, o]) => verOrden(id, o)));
ruta('GET', '/v1/telefono/ordenes/:id', ({ p, yo }) => { const o = ordenDe(p.id, yo); return { estado: o.respuesta ? 'hecha' : o.tomada ? 'haciendo' : 'pendiente', respuesta: o.respuesta }; });
ruta('POST', '/v1/telefono/ordenes/:id/tomar', ({ p, yo }) => { const o = ordenDe(p.id, yo); if (o.tomada) return { ok: false }; o.tomada = true; return { ok: true }; });
ruta('POST', '/v1/telefono/ordenes/:id/respuesta', async ({ req, p, yo }) => {
  const o = ordenDe(p.id, yo), { respuesta } = await json(req);
  if (!o.respuesta) o.respuesta = respuesta && typeof respuesta === 'object' ? respuesta : { ok: true };
  return { ok: true };
});

/* ─────────── integraciones con cuenta: OAuth en el servidor ───────────
   La app pide un enlace firmado (dura 10 min), el navegador va al proveedor y vuelve aquí; los tokens quedan en el
   servidor (nunca en el teléfono) y la app consulta por esta API. Las credenciales de cada app de desarrollador llegan
   como secretos <PROVEEDOR>_ID / <PROVEEDOR>_SECRETO (las guarda api/integraciones.sh y las sube api/desplegar.sh).
   Cada proveedor dice cómo se pide el token (`auth`: credenciales en el cuerpo o en Basic; `json`: cuerpo JSON) y
   cómo saber el nombre de la cuenta. Los tokens que vencen (Spotify, Strava, Google, Linear) se renuevan solos. */
const PUBLICA = process.env.URL_PUBLICA ?? 'https://nova-bn-api.fly.dev';
const conBearer = (url, a, extra = {}) => fetch(url, { headers: { authorization: `Bearer ${a}`, 'user-agent': 'nova', ...extra }, signal: AbortSignal.timeout(10000) }).then(r => r.json());
const credencial = p => ({ id: process.env[`${p.toUpperCase()}_ID`], secreto: process.env[`${p.toUpperCase()}_SECRETO`] });
const PROV = {
  spotify: {
    autorizar: 'https://accounts.spotify.com/authorize', token: 'https://accounts.spotify.com/api/token', auth: 'basic', extra: { response_type: 'code' },
    scope: 'user-read-currently-playing user-read-playback-state user-modify-playback-state playlist-read-private user-read-recently-played',
    cuenta: async a => { const j = await conBearer('https://api.spotify.com/v1/me', a); return { cuenta: j.display_name ?? j.id, premium: j.product === 'premium' }; },
  },
  github: {
    autorizar: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token', auth: 'cuerpo', extra: { allow_signup: 'false' },
    scope: 'read:user repo',
    cuenta: async a => ({ cuenta: (await conBearer('https://api.github.com/user', a)).login }),
  },
  strava: {
    autorizar: 'https://www.strava.com/oauth/authorize', token: 'https://www.strava.com/oauth/token', auth: 'cuerpo', extra: { response_type: 'code', approval_prompt: 'auto' },
    scope: 'read,activity:read_all',
    cuenta: async (a, tok) => ({ cuenta: [tok.athlete?.firstname, tok.athlete?.lastname].filter(Boolean).join(' ') || 'Strava' }),
  },
  todoist: {
    autorizar: 'https://todoist.com/oauth/authorize', token: 'https://todoist.com/oauth/access_token', auth: 'cuerpo',
    scope: 'data:read_write',
    cuenta: async a => { const j = await conBearer('https://api.todoist.com/api/v1/user', a).catch(() => ({})); return { cuenta: j.full_name ?? j.email ?? 'Todoist' }; },
  },
  linear: {
    autorizar: 'https://linear.app/oauth/authorize', token: 'https://api.linear.app/oauth/token', auth: 'cuerpo', extra: { response_type: 'code', prompt: 'consent', actor: 'user' },
    scope: 'read,write',
    cuenta: async a => { const j = await linearGql(a, '{ viewer { name email } organization { name } }'); return { cuenta: `${j.viewer?.name ?? 'Linear'}${j.organization?.name ? ` · ${j.organization.name}` : ''}` }; },
  },
  notion: {
    autorizar: 'https://api.notion.com/v1/oauth/authorize', token: 'https://api.notion.com/v1/oauth/token', auth: 'basic', json: true, extra: { response_type: 'code', owner: 'user' },
    scope: null,
    cuenta: async (a, tok) => ({ cuenta: tok.workspace_name ?? tok.owner?.user?.name ?? 'Notion' }),
  },
  google: {
    autorizar: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', auth: 'cuerpo',
    extra: { response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    scope: 'openid email https://www.googleapis.com/auth/tasks',
    cuenta: async a => ({ cuenta: (await conBearer('https://openidconnect.googleapis.com/v1/userinfo', a)).email ?? 'Google' }),
  },
};
const vuelta = p => `${PUBLICA}/v1/integraciones/${p}/vuelta`;
const leerInt = (u, p) => { const r = uno('SELECT datos FROM integraciones WHERE usuario_id = ? AND proveedor = ?', u, p); return r ? JSON.parse(r.datos) : null; };
const guardarInt = (u, p, d) => correr('INSERT INTO integraciones (usuario_id, proveedor, datos, ts) VALUES (?, ?, ?, ?) ON CONFLICT(usuario_id, proveedor) DO UPDATE SET datos = excluded.datos, ts = excluded.ts', u, p, JSON.stringify(d), Date.now());
const quitarInt = (u, p) => correr('DELETE FROM integraciones WHERE usuario_id = ? AND proveedor = ?', u, p);

ruta('GET', '/v1/integraciones', ({ yo }) => {
  const res = {};
  for (const p of Object.keys(PROV)) { const d = leerInt(yo.id, p); res[p] = { disponible: !!credencial(p).id, conectado: !!d, cuenta: d?.cuenta ?? null }; }
  return res;
});
ruta('POST', '/v1/integraciones/:p/enlace', ({ p, yo }) => {
  const pr = PROV[p.p] ?? falla(404, 'no existe'), cr = credencial(p.p);
  if (!cr.id) falla(503, 'Not configured on the server yet');
  const cuerpo = b64({ u: yo.id, p: p.p, exp: Date.now() + 10 * 60e3 });
  const q = new URLSearchParams({ client_id: cr.id, redirect_uri: vuelta(p.p), state: `${cuerpo}.${firma(cuerpo)}`, ...(pr.scope ? { scope: pr.scope } : {}), ...(pr.extra ?? {}) });
  return { url: `${pr.autorizar}?${q}` };
});
/** pide un token al proveedor (código nuevo o renovación) con su forma de autenticarse */
async function pedirToken(p, campos) {
  const pr = PROV[p], cr = credencial(p);
  const cab = { accept: 'application/json', 'content-type': pr.json ? 'application/json' : 'application/x-www-form-urlencoded',
    ...(pr.auth === 'basic' ? { authorization: `Basic ${Buffer.from(`${cr.id}:${cr.secreto}`).toString('base64')}` } : {}) };
  const datos = { ...campos, ...(pr.auth === 'cuerpo' ? { client_id: cr.id, client_secret: cr.secreto } : {}) };
  const r = await fetch(pr.token, { method: 'POST', headers: cab, body: pr.json ? JSON.stringify(datos) : new URLSearchParams(datos), signal: AbortSignal.timeout(15000) });
  return r.json().catch(() => ({}));
}
const venceDe = tok => tok.expires_at ? tok.expires_at * 1000 - 60e3 : tok.expires_in ? Date.now() + tok.expires_in * 1000 - 60e3 : null;
const paginaVuelta = (res, ok, p, msg) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  const app = `intent://integracion?k=${p}&ok=${ok ? 1 : 0}#Intent;scheme=nova;package=solutions.bn.nova;end`;
  res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NOVA</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05080c;color:#f2f5f8;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}
h1{font-size:24px;margin:0 0 8px}p{color:#9aa4b2;margin:0 0 22px}a{display:inline-block;background:#8fe6f5;color:#041218;text-decoration:none;font-weight:600;padding:14px 26px;border-radius:28px}</style>
${ok ? `<script>setTimeout(function(){location.href=${JSON.stringify(app)}},600)</script>` : ''}</head>
<body><main><h1>${ok ? '¡Conectado!' : 'No se pudo conectar'}</h1><p>${ok ? 'Vuelve a NOVA para verlo.' : String(msg ?? '').replace(/[<>&]/g, '')}</p><a href="${app}">Volver a NOVA</a></main></body></html>`);
};
ruta('GET', '/v1/integraciones/:p/vuelta', async ({ p, q, res }) => {
  const pr = PROV[p.p];
  try {
    if (!pr || !credencial(p.p).id) throw new Error('no configurado');
    const [cuerpo, f] = String(q.get('state') ?? '').split('.');
    if (!cuerpo || f !== firma(cuerpo)) throw new Error('enlace inválido');
    const e = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
    if (e.p !== p.p || e.exp < Date.now()) throw new Error('el enlace venció, inténtalo de nuevo');
    if (!q.get('code')) throw new Error(q.get('error') ?? 'cancelado');
    const tok = await pedirToken(p.p, { grant_type: 'authorization_code', code: q.get('code'), redirect_uri: vuelta(p.p) });
    if (!tok.access_token) throw new Error(tok.error_description ?? tok.error ?? 'sin token');
    const d = { acceso: tok.access_token, refresco: tok.refresh_token ?? null, vence: venceDe(tok), ...(await pr.cuenta(tok.access_token, tok)) };
    if (p.p === 'notion') d.workspace = tok.workspace_id ?? null;
    guardarInt(e.u, p.p, d);
    paginaVuelta(res, true, p.p);
  } catch (err) { paginaVuelta(res, false, p.p, err.message); }
}, { publica: true });
ruta('DELETE', '/v1/integraciones/:p', ({ p, yo }) => { quitarInt(yo.id, p.p); cacheGh.delete(yo.id); return { ok: true }; });

/** token vigente; si venció y hay con qué, se renueva solo. Sin cuenta (o renovación rechazada) → 409 */
async function accesoDe(u, p) {
  const d = leerInt(u, p) ?? falla(409, 'Not connected');
  if (d.vence && d.vence < Date.now() && d.refresco) {
    const tok = await pedirToken(p, { grant_type: 'refresh_token', refresh_token: d.refresco });
    if (!tok.access_token) { quitarInt(u, p); falla(409, 'Not connected'); }
    Object.assign(d, { acceso: tok.access_token, refresco: tok.refresh_token ?? d.refresco, vence: venceDe(tok) });
    guardarInt(u, p, d);
  }
  return d.acceso;
}
const spotify = async (u, ruta, opciones = {}) => {
  const r = await fetch(`https://api.spotify.com/v1${ruta}`, { ...opciones, headers: { authorization: `Bearer ${await accesoDe(u, 'spotify')}`, 'content-type': 'application/json', ...(opciones.headers ?? {}) } });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) falla(r.status === 403 ? 403 : 502, j?.error?.reason === 'PREMIUM_REQUIRED' ? 'Spotify Premium is needed to control playback' : j?.error?.message ?? 'Spotify error');
  return j;
};
ruta('GET', '/v1/spotify/ahora', async ({ yo }) => {
  const j = await spotify(yo.id, '/me/player?additional_types=episode');
  if (!j?.item) return { sonando: false };
  const it = j.item;
  return { sonando: !!j.is_playing, titulo: it.name, artista: (it.artists ?? []).map(a => a.name).join(', ') || it.show?.name || '', imagen: (it.album?.images ?? it.images ?? [])[0]?.url ?? null, avance: j.progress_ms, duracion: it.duration_ms, dispositivo: j.device?.name ?? null, url: it.external_urls?.spotify ?? null };
});
ruta('GET', '/v1/spotify/playlists', async ({ yo }) => {
  const j = await spotify(yo.id, '/me/playlists?limit=30');
  return (j?.items ?? []).filter(Boolean).map(p => ({ id: p.id, nombre: p.name, imagen: p.images?.[0]?.url ?? null, canciones: p.tracks?.total ?? 0 }));
});
ruta('POST', '/v1/spotify/control', async ({ req, yo }) => {
  const { accion, playlist } = await json(req);
  const A = { play: ['PUT', '/me/player/play'], pause: ['PUT', '/me/player/pause'], next: ['POST', '/me/player/next'], previous: ['POST', '/me/player/previous'] };
  const [m, r] = A[accion] ?? falla(400, 'acción');
  await spotify(yo.id, r, { method: m, ...(accion === 'play' && playlist ? { body: JSON.stringify({ context_uri: `spotify:playlist:${String(playlist).replace(/[^A-Za-z0-9]/g, '')}` }) } : {}) });
  return { ok: true };
});

const github = async (u, ruta) => {
  const r = await fetch(`https://api.github.com${ruta}`, { headers: { authorization: `Bearer ${await accesoDe(u, 'github')}`, accept: 'application/vnd.github+json', 'user-agent': 'nova' } });
  if (r.status === 401) { quitarInt(u, 'github'); falla(409, 'Not connected'); }
  if (!r.ok) { const t = (await r.text()).slice(0, 300); console.warn('github', r.status, ruta.split('?')[0], t); falla(502, `GitHub ${r.status}: ${(() => { try { return JSON.parse(t).message; } catch { return t; } })()}`); }
  return r.json();
};
/** lo tuyo en GitHub: PRs abiertos, revisiones que te piden, issues asignados y lo que hiciste hoy.
    La búsqueda de GitHub permite ~30 consultas por minuto: el resumen queda en caché 3 min por persona (?fresco=1 lo salta
    pasado 30 s) y las búsquedas van de a una */
const cacheGh = new Map();
ruta('GET', '/v1/github/resumen', async ({ yo, q }) => {
  const c = cacheGh.get(yo.id), edad = c ? Date.now() - c.ts : Infinity;
  if (c && (edad < 180e3 && !(q.get('fresco') && edad > 30e3))) return c.datos;
  // tz: minutos de diferencia con UTC del teléfono (getTimezoneOffset), para que «hoy» sea tu día y no el de UTC
  const datos = await resumenGithub(yo, Number(q.get('tz')) || 0);
  // con partes fallidas, se reintenta al minuto (no a los 3)
  cacheGh.set(yo.id, { ts: datos.errores.length ? Date.now() - 120e3 : Date.now(), datos });
  return datos;
});
async function resumenGithub(yo, tz = 0) {
  const login = leerInt(yo.id, 'github')?.cuenta ?? falla(409, 'Not connected');
  // cada parte por separado: si una falla (permisos, límite de búsqueda), las demás se muestran igual y se dice cuál
  const errores = [];
  const buscar = (q, k) => github(yo.id, `/search/issues?per_page=15&sort=updated&q=${encodeURIComponent(q)}`)
    .then(j => (j.items ?? []).map(i => ({ titulo: i.title, url: i.html_url, repo: i.repository_url.split('/').slice(-2).join('/'), numero: i.number, actualizado: i.updated_at })))
    .catch(e => { if (e.estado === 409) throw e; errores.push(`${k}: ${e.message}`); return []; });
  const prs = await buscar(`is:pr is:open author:${login} archived:false`, 'prs');
  const revisar = await buscar(`is:pr is:open review-requested:${login} archived:false`, 'revisar');
  const issues = await buscar(`is:issue is:open assignee:${login} archived:false`, 'issues');
  const eventos = await github(yo.id, `/users/${login}/events?per_page=100`).catch(e => { if (e.estado === 409) throw e; errores.push(`eventos: ${e.message}`); return []; });
  // el inicio de tu día (con la zona del teléfono) y los últimos 7 días
  const local = new Date(Date.now() - tz * 60e3); local.setUTCHours(0, 0, 0, 0);
  const inicio = local.getTime() + tz * 60e3;
  const deHoy = eventos.filter(e => Date.parse(e.created_at) >= inicio);
  // contribuciones como las cuenta tu perfil (la lista de eventos ya no trae los commits): GraphQL
  const g = async (desde, hasta) => {
    const r = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { authorization: `Bearer ${await accesoDe(yo.id, 'github')}`, 'content-type': 'application/json', 'user-agent': 'nova' },
      body: JSON.stringify({ query: 'query($d:DateTime!,$h:DateTime!){viewer{contributionsCollection(from:$d,to:$h){totalCommitContributions totalPullRequestContributions totalIssueContributions totalPullRequestReviewContributions restrictedContributionsCount}}}', variables: { d: new Date(desde).toISOString(), h: new Date(hasta).toISOString() } }) });
    const j = await r.json().catch(() => null), c = j?.data?.viewer?.contributionsCollection;
    if (!c) { errores.push(`contribuciones: ${j?.errors?.[0]?.message ?? r.status}`); return null; }
    return { total: c.totalCommitContributions + c.totalPullRequestContributions + c.totalIssueContributions + c.totalPullRequestReviewContributions + c.restrictedContributionsCount, commits: c.totalCommitContributions };
  };
  const ahora = Date.now(), diasAtras = await Promise.all(Array.from({ length: 7 }, (_, i) => g(inicio - (6 - i) * 864e5, Math.min(ahora, inicio - (5 - i) * 864e5 - 1))));
  const hoyC = diasAtras[6];
  const commits = hoyC?.commits ?? 0;
  return { login, prs, revisar, issues, errores: errores.map(e => (/rate limit/i.test(e) ? `${e.split(':')[0]}: GitHub limit reached, retrying in a minute` : e)), hoy: { commits, contribuciones: hoyC?.total ?? 0, semana: diasAtras.map(x => x?.total ?? 0), eventos: deHoy.length, repos: [...new Set(deHoy.map(e => e.repo?.name).filter(Boolean))].slice(0, 5) } };
}

/* el mapa del año de GitHub (el mismo de tu perfil): un día por celda, desde el 1 de enero. Caché 10 min por persona */
const cacheCal = new Map();
ruta('GET', '/v1/github/calendario', async ({ yo }) => {
  const c = cacheCal.get(yo.id);
  if (c && Date.now() - c.ts < 600e3) return c.datos;
  const login = leerInt(yo.id, 'github')?.cuenta ?? falla(409, 'Not connected');
  const desde = new Date(new Date().getFullYear(), 0, 1).toISOString();
  const r = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { authorization: `Bearer ${await accesoDe(yo.id, 'github')}`, 'content-type': 'application/json', 'user-agent': 'nova' },
    body: JSON.stringify({ query: 'query($d:DateTime!,$h:DateTime!){viewer{contributionsCollection(from:$d,to:$h){contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}', variables: { d: desde, h: new Date().toISOString() } }) });
  const j = await r.json().catch(() => null), cal = j?.data?.viewer?.contributionsCollection?.contributionCalendar;
  if (!cal) falla(502, `GitHub: ${j?.errors?.[0]?.message ?? r.status}`);
  const datos = { login, desde: desde.slice(0, 10), total: cal.totalContributions, dias: cal.weeks.flatMap(w => w.contributionDays.map(d => ({ fecha: d.date, n: d.contributionCount }))) };
  cacheCal.set(yo.id, { ts: Date.now(), datos });
  return datos;
});
/* la ficha pública de cualquier login (para «el GitHub de Benja»): perfil y sus commits de la última semana, con tu token */
const cacheUsuGh = new Map();
ruta('GET', '/v1/github/usuario/:login', async ({ yo, p }) => {
  const login = String(p.login).toLowerCase().replace(/[^a-z0-9-]/g, '');
  const c = cacheUsuGh.get(login);
  if (c && Date.now() - c.ts < 300e3) return c.datos;
  const u = await github(yo.id, `/users/${login}`);
  const ev = await github(yo.id, `/users/${login}/events/public?per_page=100`).catch(() => []);
  const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
  const semana = Array.from({ length: 7 }, () => 0);
  for (const e of ev) {
    const d = Math.floor((Date.parse(e.created_at) - hoy0.getTime()) / 864e5) + 6; // 6 = hoy
    if (e.type === 'PushEvent' && d >= 0 && d <= 6) semana[d] += e.payload?.size ?? 1;
  }
  const ultimos = ev.slice(0, 6).map(e => ({ tipo: e.type.replace(/Event$/, ''), repo: e.repo?.name, ts: Date.parse(e.created_at) }));
  const datos = { login: u.login, nombre: u.name, foto: u.avatar_url, bio: u.bio, empresa: u.company, lugar: u.location, sitio: u.blog, x: u.twitter_username, seguidores: u.followers, siguiendo: u.following, repos: u.public_repos, url: u.html_url, semana, ultimos };
  cacheUsuGh.set(login, { ts: Date.now(), datos });
  return datos;
});

/* ─────────── Strava: tus actividades (correr, bici, gimnasio…) como ejercicio y recuperación ─────────── */
ruta('GET', '/v1/strava/resumen', async ({ yo }) => {
  const a = await accesoDe(yo.id, 'strava');
  const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${Math.floor(Date.now() / 1000) - 14 * 86400}&per_page=60`, { headers: { authorization: `Bearer ${a}` }, signal: AbortSignal.timeout(10000) });
  if (r.status === 401) { quitarInt(yo.id, 'strava'); falla(409, 'Not connected'); }
  if (!r.ok) falla(502, `Strava ${r.status}`);
  const acts = (await r.json()).map(x => ({ id: x.id, nombre: x.name, tipo: x.sport_type ?? x.type, fecha: x.start_date_local, km: Math.round((x.distance ?? 0) / 10) / 100, min: Math.round((x.moving_time ?? 0) / 60),
    fc: x.average_heartrate ? Math.round(x.average_heartrate) : null, fcMax: x.max_heartrate ? Math.round(x.max_heartrate) : null, desnivel: Math.round(x.total_elevation_gain ?? 0), url: `https://www.strava.com/activities/${x.id}` }));
  const semana = acts.filter(x => Date.parse(x.fecha) > Date.now() - 7 * 864e5);
  return { actividades: acts, semana: { n: semana.length, min: semana.reduce((s, x) => s + x.min, 0), km: Math.round(semana.reduce((s, x) => s + x.km, 0) * 10) / 10 } };
});

/* ─────────── tareas de afuera (Todoist, Google Tasks, Linear) en una sola lista ───────────
   Cada fuente se pide por separado: si una falla, las otras se muestran igual y se dice cuál. */
async function linearGql(a, query, variables = {}) {
  const r = await fetch('https://api.linear.app/graphql', { method: 'POST', headers: { authorization: `Bearer ${a}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) falla(409, 'Not connected');
  if (j.errors?.length) falla(502, `Linear: ${j.errors[0].message}`);
  return j.data ?? {};
}
const GT = 'https://tasks.googleapis.com/tasks/v1';
async function googleJ(u, url, opciones = {}) {
  const r = await fetch(url, { ...opciones, headers: { authorization: `Bearer ${await accesoDe(u, 'google')}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (r.status === 401) { quitarInt(u, 'google'); falla(409, 'Not connected'); }
  if (r.status === 204) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) falla(502, `Google ${r.status}: ${j?.error?.message ?? ''}`);
  return j;
}
async function todoistJ(u, ruta_, opciones = {}) {
  const a = await accesoDe(u, 'todoist');
  const r = await fetch(`https://api.todoist.com/api/v1${ruta_}`, { ...opciones, headers: { authorization: `Bearer ${a}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (r.status === 401 || r.status === 403) { quitarInt(u, 'todoist'); falla(409, 'Not connected'); }
  if (r.status === 204) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) falla(502, `Todoist ${r.status}`);
  return j;
}
const FUENTES = {
  todoist: {
    async listar(u) {
      const j = await todoistJ(u, `/tasks/filter?query=${encodeURIComponent('today | overdue | 7 days')}&limit=100`);
      return (j?.results ?? j ?? []).map(t => ({ id: String(t.id), titulo: t.content, vence: t.due?.date?.slice(0, 10) ?? null, prioridad: 5 - (t.priority ?? 1), url: `https://app.todoist.com/app/task/${t.id}` }));
    },
    completar: (u, id) => todoistJ(u, `/tasks/${encodeURIComponent(id)}/close`, { method: 'POST' }),
    crear: (u, { titulo, vence }) => todoistJ(u, '/tasks', { method: 'POST', body: JSON.stringify({ content: titulo, ...(vence ? { due_date: vence } : {}) }) }),
  },
  google: {
    async listar(u) {
      const listas = (await googleJ(u, `${GT}/users/@me/lists?maxResults=20`))?.items ?? [], fuera = [];
      for (const l of listas.slice(0, 8)) {
        const ts = (await googleJ(u, `${GT}/lists/${l.id}/tasks?showCompleted=false&showHidden=false&maxResults=100`))?.items ?? [];
        for (const t of ts) if (t.title?.trim()) fuera.push({ id: `${l.id}:${t.id}`, titulo: t.title, vence: t.due?.slice(0, 10) ?? null, prioridad: 0, lista: l.title, url: t.webViewLink ?? 'https://tasks.google.com' });
      }
      return fuera;
    },
    completar: (u, id) => { const [l, t] = id.split(':'); return googleJ(u, `${GT}/lists/${l}/tasks/${t}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) }); },
    crear: (u, { titulo, vence }) => googleJ(u, `${GT}/lists/@default/tasks`, { method: 'POST', body: JSON.stringify({ title: titulo, ...(vence ? { due: `${vence}T00:00:00.000Z` } : {}) }) }),
  },
  linear: {
    async listar(u) {
      const d = await linearGql(await accesoDe(u, 'linear'), '{ viewer { assignedIssues(first: 60, filter: { state: { type: { nin: ["completed", "canceled"] } } }) { nodes { id identifier title url priority dueDate state { name } team { key } } } } }');
      return (d.viewer?.assignedIssues?.nodes ?? []).map(i => ({ id: i.id, titulo: `${i.identifier} ${i.title}`, vence: i.dueDate ?? null, prioridad: i.priority ?? 0, estado: i.state?.name, url: i.url }));
    },
    async completar(u, id) {
      const a = await accesoDe(u, 'linear');
      const d = await linearGql(a, 'query($id: String!) { issue(id: $id) { team { states(filter: { type: { eq: "completed" } }) { nodes { id } } } } }', { id });
      const estado = d.issue?.team?.states?.nodes?.[0]?.id ?? falla(502, 'Linear: no "done" state');
      await linearGql(a, 'mutation($id: String!, $s: String!) { issueUpdate(id: $id, input: { stateId: $s }) { success } }', { id, s: estado });
    },
    async crear(u, { titulo, vence }) {
      const a = await accesoDe(u, 'linear');
      const d = await linearGql(a, '{ viewer { id teamMemberships(first: 1) { nodes { team { id } } } } }');
      const equipo = d.viewer?.teamMemberships?.nodes?.[0]?.team?.id ?? falla(400, 'Linear: you are not in any team');
      await linearGql(a, 'mutation($i: IssueCreateInput!) { issueCreate(input: $i) { success } }', { i: { teamId: equipo, title: titulo, assigneeId: d.viewer.id, ...(vence ? { dueDate: vence } : {}) } });
    },
  },
};
ruta('GET', '/v1/externas', async ({ yo }) => {
  const res = { tareas: [], errores: [] };
  for (const [f, x] of Object.entries(FUENTES)) {
    if (!leerInt(yo.id, f)) continue;
    try { for (const t of await x.listar(yo.id)) res.tareas.push({ fuente: f, ...t }); }
    catch (e) { res.errores.push(`${f}: ${e.message}`); }
  }
  res.tareas.sort((a, b) => (a.vence ?? '9999') .localeCompare(b.vence ?? '9999') || b.prioridad - a.prioridad);
  return res;
});
ruta('POST', '/v1/externas/:f/:id/completar', async ({ p, yo }) => { const x = FUENTES[p.f] ?? falla(404, 'no existe'); await x.completar(yo.id, p.id); return { ok: true }; });
ruta('POST', '/v1/externas/:f', async ({ req, p, yo }) => {
  const x = FUENTES[p.f] ?? falla(404, 'no existe'), b = await json(req);
  await x.crear(yo.id, { titulo: texto(b.titulo, 300, 'titulo') ?? falla(400, 'Missing title'), vence: esFecha(b.vence) ? b.vence : null });
  return { ok: true };
});

/* ─────────── ajustes de la crew: Slack, Discord y Notion (los cambia un admin) ─────────── */
db.exec('CREATE TABLE IF NOT EXISTS crew_ajustes (crew_id TEXT PRIMARY KEY REFERENCES crews(id) ON DELETE CASCADE, datos TEXT NOT NULL)');
const ajustesDe = id => { try { return JSON.parse(uno('SELECT datos FROM crew_ajustes WHERE crew_id = ?', id)?.datos ?? '{}'); } catch { return {}; } };
const ESPEJO_TIPOS = ['standup', 'bloqueo', 'tarea', 'hecha', 'github', 'resumen', 'acta', 'kudos', 'decision'];
ruta('GET', '/v1/crews/:id/ajustes', ({ p, yo }) => {
  const c = miembro(p.id, yo.id), a = ajustesDe(c.id);
  // las URLs de los webhooks son secretas: solo se dice si están y su final
  const oculta = u => (u ? `…${u.slice(-6)}` : null);
  return { slack: oculta(a.slack), discord: oculta(a.discord), espejo: a.espejo ?? ESPEJO_TIPOS.filter(t => t !== 'tarea'), notion: a.notion ? { pagina: a.notion.pagina, titulo: a.notion.titulo, de: a.notion.usuario } : null, soyAdmin: c.rol === 'admin' };
});
ruta('PATCH', '/v1/crews/:id/ajustes', async ({ req, p, yo }) => {
  const c = miembro(p.id, yo.id); if (c.rol !== 'admin') falla(403, 'Only admins can change this');
  const b = await json(req), a = ajustesDe(c.id);
  if ('slack' in b) { if (b.slack && !/^https:\/\/hooks\.slack\.com\/services\/[\w/]+$/.test(b.slack)) falla(400, 'That is not a Slack incoming webhook URL'); a.slack = b.slack || null; }
  if ('discord' in b) { if (b.discord && !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(b.discord)) falla(400, 'That is not a Discord webhook URL'); a.discord = b.discord || null; }
  if ('espejo' in b && Array.isArray(b.espejo)) a.espejo = b.espejo.filter(t => ESPEJO_TIPOS.includes(t));
  if ('notion' in b) {
    if (b.notion?.pagina) { if (!leerInt(yo.id, 'notion')) falla(409, 'Connect Notion first'); a.notion = { usuario: yo.id, pagina: String(b.notion.pagina).slice(0, 64), titulo: texto(b.notion.titulo, 200, 'titulo') ?? 'Notion' }; }
    else a.notion = null;
  }
  correr('INSERT INTO crew_ajustes (crew_id, datos) VALUES (?, ?) ON CONFLICT(crew_id) DO UPDATE SET datos = excluded.datos', c.id, JSON.stringify(a));
  if (b.probar) await espejo(c.id, null, `👋 NOVA quedó conectada con ${c.nombre}. Por aquí llegarán los avisos del equipo.`);
  return { ok: true };
});
/** manda un aviso del equipo a Slack y/o Discord si la crew los tiene y ese tipo está activo (null = siempre) */
async function espejo(crewId, tipo, txt) {
  const a = ajustesDe(crewId);
  if (!a.slack && !a.discord) return;
  if (tipo && !(a.espejo ?? ESPEJO_TIPOS.filter(t => t !== 'tarea')).includes(tipo)) return;
  const t = String(txt).slice(0, 1900);
  for (const [url, cuerpo_] of [[a.slack, { text: t }], [a.discord, { content: t, username: 'NOVA' }]]) {
    if (!url) continue;
    try { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo_), signal: AbortSignal.timeout(8000) }); if (!r.ok) console.warn('espejo', r.status); }
    catch (e) { console.warn('espejo', e.message); }
  }
}

/* ─────────── Notion: el resumen semanal y las actas de reunión quedan como páginas en el espacio del equipo ─────────── */
const NV = { 'Notion-Version': '2022-06-28', 'content-type': 'application/json' };
async function notionJ(u, ruta_, cuerpo_) {
  const r = await fetch(`https://api.notion.com/v1${ruta_}`, { method: cuerpo_ ? 'POST' : 'GET', headers: { ...NV, authorization: `Bearer ${await accesoDe(u, 'notion')}` }, body: cuerpo_ ? JSON.stringify(cuerpo_) : undefined, signal: AbortSignal.timeout(12000) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { quitarInt(u, 'notion'); falla(409, 'Not connected'); }
  if (!r.ok) falla(502, `Notion: ${j.message ?? r.status}`);
  return j;
}
const tituloNotion = pg => (Object.values(pg.properties ?? {}).find(x => x.type === 'title')?.title ?? []).map(t => t.plain_text).join('') || 'Sin título';
ruta('GET', '/v1/notion/paginas', async ({ yo, q }) => {
  const j = await notionJ(yo.id, '/search', { query: String(q.get('q') ?? '').slice(0, 100), filter: { property: 'object', value: 'page' }, page_size: 25 });
  return (j.results ?? []).map(pg => ({ id: pg.id, titulo: tituloNotion(pg), url: pg.url, icono: pg.icon?.emoji ?? null }));
});
/** una página nueva bajo la página elegida por la crew: título + párrafos (y viñetas para las líneas que parten con «· » o «- ») */
async function aNotion(crewId, titulo, cuerpoTxt) {
  const n = ajustesDe(crewId).notion;
  if (!n) return null;
  const bloques = String(cuerpoTxt).split('\n').filter(l => l.trim()).slice(0, 90).map(l => {
    const vin = /^\s*[·\-•]\s+/.test(l), t = l.replace(/^\s*[·\-•]\s+/, '').slice(0, 1900);
    return vin ? { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: t } }] } }
      : { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: t } }] } };
  });
  try { const pg = await notionJ(n.usuario, '/pages', { parent: { page_id: n.pagina }, properties: { title: { title: [{ type: 'text', text: { content: titulo.slice(0, 200) } }] } }, children: bloques }); return pg.url; }
  catch (e) { console.warn('notion', e.message); return null; }
}

/* ─────────── GitHub de la crew: CI, deploys y PRs de los repos del equipo ───────────
   Un admin o cualquiera con acceso agrega repos; cada 2 min la API los revisa con el token de quien lo agregó (o de
   otro miembro con GitHub) y avisa: un workflow falla o se arregla, un deploy falla o sale a producción (Vercel, Fly,
   Netlify… publican sus deploys en GitHub), un PR nuevo, revisión pedida a alguien de la crew, aprobado, cambios
   pedidos o integrado. La primera pasada solo aprende el estado actual: no avisa de lo viejo. */
db.exec(`CREATE TABLE IF NOT EXISTS crew_repos (crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE, repo TEXT NOT NULL, agregado_por TEXT NOT NULL, ts INTEGER NOT NULL, estado TEXT, error TEXT, PRIMARY KEY (crew_id, repo));
CREATE TABLE IF NOT EXISTS github_eventos (id TEXT PRIMARY KEY, crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE, repo TEXT NOT NULL, tipo TEXT NOT NULL, titulo TEXT NOT NULL, detalle TEXT, url TEXT, autor TEXT, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS github_eventos_crew ON github_eventos (crew_id, ts);`);
const esRepo = r => typeof r === 'string' && /^[\w.-]+\/[\w.-]+$/.test(r);
/** login de GitHub → miembro de la crew (por la cuenta que conectó en NOVA) */
function loginsCrew(crewId) {
  const m = new Map();
  for (const x of todos("SELECT i.usuario_id, i.datos FROM integraciones i JOIN miembros mb ON mb.usuario_id = i.usuario_id WHERE mb.crew_id = ? AND i.proveedor = 'github'", crewId)) {
    try { const l = JSON.parse(x.datos).cuenta; if (l) m.set(l.toLowerCase(), x.usuario_id); } catch {}
  }
  return m;
}
const verEvento = e => ({ id: e.id, repo: e.repo, tipo: e.tipo, titulo: e.titulo, detalle: e.detalle, url: e.url, autor: e.autor, ts: e.ts });
ruta('GET', '/v1/github/repos', async ({ yo }) => {
  const j = await github(yo.id, '/user/repos?sort=pushed&per_page=60&affiliation=owner,collaborator,organization_member');
  return j.map(r => ({ repo: r.full_name, privado: r.private, empujado: r.pushed_at }));
});
ruta('GET', '/v1/crews/:id/github', ({ p, yo }) => {
  const c = miembro(p.id, yo.id);
  return {
    repos: todos('SELECT repo, agregado_por, ts, error FROM crew_repos WHERE crew_id = ? ORDER BY ts', c.id).map(r => ({ repo: r.repo, de: r.agregado_por, ts: r.ts, error: r.error })),
    eventos: todos('SELECT * FROM github_eventos WHERE crew_id = ? ORDER BY ts DESC LIMIT 50', c.id).map(verEvento),
    conectados: [...loginsCrew(c.id).entries()].map(([login, u]) => ({ login, usuario: u })),
  };
});
ruta('POST', '/v1/crews/:id/github/repos', async ({ req, p, yo }) => {
  const c = miembro(p.id, yo.id), { repo } = await json(req);
  if (!esRepo(repo)) falla(400, 'Use owner/name');
  if ((uno('SELECT COUNT(*) n FROM crew_repos WHERE crew_id = ?', c.id)).n >= 15) falla(429, 'Up to 15 repos per crew');
  const r = await github(yo.id, `/repos/${repo}`); // si no tienes acceso, GitHub responde 404 y se dice
  correr('INSERT OR IGNORE INTO crew_repos (crew_id, repo, agregado_por, ts) VALUES (?, ?, ?, ?)', c.id, r.full_name, yo.id, Date.now());
  avisarCrew(c.id, { tipo: 'github' });
  sondearRepo(c.id, r.full_name).catch(() => {});
  return { ok: true, repo: r.full_name };
});
ruta('DELETE', '/v1/crews/:id/github/repos/:repo', ({ p, yo }) => {
  const c = miembro(p.id, yo.id), r = uno('SELECT * FROM crew_repos WHERE crew_id = ? AND repo = ?', c.id, p.repo) ?? falla(404, 'no existe');
  if (r.agregado_por !== yo.id && c.rol !== 'admin') falla(403, 'Only whoever added it or an admin');
  correr('DELETE FROM crew_repos WHERE crew_id = ? AND repo = ?', c.id, p.repo);
  avisarCrew(c.id, { tipo: 'github' });
  return { ok: true };
});
const FALLO_CI = ['failure', 'timed_out', 'startup_failure'];
const esProd = env => /prod|main|live/i.test(env ?? '');
async function sondearRepo(crewId, repo) {
  const fila = uno('SELECT * FROM crew_repos WHERE crew_id = ? AND repo = ?', crewId, repo);
  if (!fila) return;
  // token: quien lo agregó; si ya no tiene GitHub, otro miembro conectado
  const logins = loginsCrew(crewId);
  const quien = leerInt(fila.agregado_por, 'github') && idsCrew(crewId).includes(fila.agregado_por) ? fila.agregado_por : [...logins.values()][0];
  if (!quien) { correr('UPDATE crew_repos SET error = ? WHERE crew_id = ? AND repo = ?', 'Nobody in the crew has GitHub connected', crewId, repo); return; }
  const st = JSON.parse(fila.estado ?? 'null') ?? { runs: {}, fallas: {}, deps: {}, prs: {}, revs: {} }, primera = !fila.estado;
  const c = uno('SELECT * FROM crews WHERE id = ?', crewId), ids = idsCrew(crewId);
  const nombreGh = l => { const u = l && logins.get(l.toLowerCase()); return u ? nombreDe(u) : l ?? '?'; };
  const eventos = [];
  // `ts`: la hora real del hecho en GitHub. En la primera pasada los eventos de los últimos 7 días entran al historial
  // con su hora real, sin aviso push ni espejo (ya pasaron); desde ahí, solo lo nuevo avisa.
  const evento = (tipo, titulo, detalle, url, autor, destinos, clave, v, ts) => eventos.push({ tipo, titulo, detalle, url, autor, destinos, clave, v, ts: ts ? Date.parse(ts) : Date.now(), viejo: primera });
  const reciente = ts => ts && Date.parse(ts) > Date.now() - 7 * 864e5;
  try {
    // 1 · workflows (GitHub Actions): falla nueva, o vuelve a pasar después de fallar
    const runs = (await github(quien, `/repos/${repo}/actions/runs?per_page=20`)).workflow_runs ?? [];
    for (const r of runs.filter(x => x.status === 'completed').reverse()) {
      if (st.runs[r.id]) continue;
      st.runs[r.id] = r.conclusion;
      const k = `${r.workflow_id}:${r.head_branch}`, autor = r.triggering_actor?.login ?? r.actor?.login;
      if (FALLO_CI.includes(r.conclusion)) {
        if (!primera || reciente(r.updated_at)) evento('ci_fallo', `${r.name} falló`, `${r.display_title ?? ''} · ${r.head_branch}`, r.html_url, autor, ids, 'ciFallo', { r: repo, w: r.name, t: `${r.head_branch} · ${r.display_title ?? ''}`.slice(0, 120), n: nombreGh(autor) }, r.updated_at);
        st.fallas[k] = r.id;
      } else if (r.conclusion === 'success' && st.fallas[k]) {
        if (!primera || reciente(r.updated_at)) evento('ci_ok', `${r.name} volvió a pasar`, r.head_branch, r.html_url, autor, ids, 'ciOk', { r: repo, w: r.name, t: r.head_branch }, r.updated_at);
        delete st.fallas[k];
      }
    }
    st.runs = Object.fromEntries(Object.entries(st.runs).slice(-80));
    // 2 · deploys (los publican Vercel, Netlify, Fly, Render… o tus propias Actions)
    const deps = await github(quien, `/repos/${repo}/deployments?per_page=8`);
    for (const d of deps) {
      if (Date.parse(d.created_at) < Date.now() - 2 * 864e5) continue;
      const previo = st.deps[d.id];
      if (previo === 'success' || previo === 'failure' || previo === 'error') continue;
      const s = (await github(quien, `/repos/${repo}/deployments/${d.id}/statuses?per_page=1`))[0];
      if (!s) continue;
      st.deps[d.id] = s.state;
      if ((primera && !reciente(s.created_at)) || (!primera && s.state === previo)) continue;
      if (/^[0-9a-f]{40}$/.test(d.ref)) d.ref = d.ref.slice(0, 7);
      const env = d.environment ?? 'deploy', autor = d.creator?.login, url = s.log_url || s.target_url || s.environment_url || `https://github.com/${repo}/deployments`;
      if (s.state === 'failure' || s.state === 'error') evento('deploy_fallo', `Falló el deploy a ${env}`, `${d.ref}${s.description ? ` · ${s.description}` : ''}`, url, autor, ids, 'deployFallo', { r: repo, e: env, t: `${d.ref}${s.description ? ` · ${s.description}` : ''}`.slice(0, 120) }, s.created_at);
      else if (s.state === 'success' && esProd(env)) evento('deploy_ok', `Deploy en ${env}`, d.ref, s.environment_url || url, autor, ids, 'deployOk', { r: repo, e: env, t: d.ref }, s.created_at);
    }
    st.deps = Object.fromEntries(Object.entries(st.deps).slice(-40));
    // 3 · pull requests: nuevo, revisión pedida a alguien de la crew, integrado
    const prs = await github(quien, `/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=20`);
    for (const pr of prs) {
      const antes = st.prs[pr.number], estado = pr.merged_at ? 'merged' : pr.state, revisores = (pr.requested_reviewers ?? []).map(r => r.login.toLowerCase());
      st.prs[pr.number] = { e: estado, r: revisores, u: pr.updated_at };
      const autor = pr.user?.login, v = { r: repo, k: pr.number, t: pr.title.slice(0, 120), n: nombreGh(autor) };
      const delAutor = logins.get(autor?.toLowerCase() ?? '');
      if (primera) {
        // historia: PRs abiertos e integrados en los últimos 7 días, con su hora real
        if (reciente(pr.created_at) && !pr.draft) evento('pr_abierto', `PR #${pr.number}: ${pr.title}`, `por ${nombreGh(autor)}`, pr.html_url, autor, [], 'prAbierto', v, pr.created_at);
        if (pr.merged_at && reciente(pr.merged_at)) evento('pr_mergeado', `Integrado #${pr.number}: ${pr.title}`, `por ${nombreGh(pr.merged_by?.login ?? autor)}`, pr.html_url, autor, [], 'prMergeado', v, pr.merged_at);
        continue;
      }
      if (!antes && estado === 'open' && !pr.draft) evento('pr_abierto', `PR #${pr.number}: ${pr.title}`, `por ${nombreGh(autor)}`, pr.html_url, autor, ids.filter(x => x !== delAutor), 'prAbierto', v);
      for (const rv of revisores) if (!(antes?.r ?? []).includes(rv) && logins.get(rv)) evento('pr_revision', `Revisión pedida: #${pr.number} ${pr.title}`, `${nombreGh(autor)} → ${nombreGh(rv)}`, pr.html_url, autor, [logins.get(rv)], 'prRevision', v);
      if (antes && antes.e !== 'merged' && estado === 'merged') evento('pr_mergeado', `Integrado #${pr.number}: ${pr.title}`, `por ${nombreGh(pr.merged_by?.login ?? autor)}`, pr.html_url, autor, ids, 'prMergeado', { ...v, n: nombreGh(pr.merged_by?.login ?? autor) });
      // revisiones nuevas en PRs abiertos de alguien de la crew (como mucho 4 consultas por vuelta)
      if (estado === 'open' && delAutor && antes && antes.u !== pr.updated_at && (st._revs = (st._revs ?? 0) + 1) <= 4) {
        const revs = await github(quien, `/repos/${repo}/pulls/${pr.number}/reviews?per_page=30`).catch(() => []);
        for (const r of revs) {
          if (st.revs[r.id] || !['APPROVED', 'CHANGES_REQUESTED'].includes(r.state)) continue;
          st.revs[r.id] = 1;
          const v2 = { ...v, n: nombreGh(r.user?.login) };
          if (r.state === 'APPROVED') evento('pr_aprobado', `${nombreGh(r.user?.login)} aprobó #${pr.number}`, pr.title, r.html_url, r.user?.login, [delAutor], 'prAprobado', v2);
          else evento('pr_cambios', `${nombreGh(r.user?.login)} pidió cambios en #${pr.number}`, pr.title, r.html_url, r.user?.login, [delAutor], 'prCambios', v2);
        }
      }
    }
    if (primera) for (const pr of prs.filter(x => x.state === 'open').slice(0, 10)) for (const r of await github(quien, `/repos/${repo}/pulls/${pr.number}/reviews?per_page=30`).catch(() => [])) st.revs[r.id] = 1;
    delete st._revs;
    st.prs = Object.fromEntries(Object.entries(st.prs).sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 60));
    st.revs = Object.fromEntries(Object.entries(st.revs).slice(-200));
    correr('UPDATE crew_repos SET estado = ?, error = NULL WHERE crew_id = ? AND repo = ?', JSON.stringify(st), crewId, repo);
  } catch (e) {
    correr('UPDATE crew_repos SET error = ? WHERE crew_id = ? AND repo = ?', String(e.message).slice(0, 200), crewId, repo);
    return;
  }
  for (const e of eventos) {
    const id = nuevoId();
    correr('INSERT INTO github_eventos (id, crew_id, repo, tipo, titulo, detalle, url, autor, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, crewId, repo, e.tipo, e.titulo.slice(0, 200), (e.detalle ?? '').slice(0, 300), e.url, e.autor ?? null, e.ts);
    if (e.viejo) continue;
    push(e.destinos, e.clave, e.v, '/github');
    if (!['pr_revision', 'pr_aprobado', 'pr_cambios'].includes(e.tipo)) espejo(crewId, 'github', `${{ ci_fallo: '❌', ci_ok: '✅', deploy_fallo: '🚨', deploy_ok: '🚀', pr_abierto: '🔀', pr_mergeado: '🟣' }[e.tipo] ?? '•'} *${repo}* · ${e.titulo}${e.detalle ? ` — ${e.detalle}` : ''}\n${e.url}`);
  }
  if (eventos.length) avisarCrew(crewId, { tipo: 'github' });
  if (eventos.length) correr("DELETE FROM github_eventos WHERE crew_id = ? AND id NOT IN (SELECT id FROM github_eventos WHERE crew_id = ? ORDER BY ts DESC LIMIT 300)", crewId, crewId);
  void c;
}
// repos agregados antes de que existiera la historia (sin ningún evento): se vuelven a aprender con sus últimos 7 días
db.exec("UPDATE crew_repos SET estado = NULL WHERE NOT EXISTS (SELECT 1 FROM github_eventos e WHERE e.crew_id = crew_repos.crew_id AND e.repo = crew_repos.repo)");
let sondeando = false;
setInterval(async () => {
  if (sondeando) return; sondeando = true;
  try { for (const r of todos('SELECT crew_id, repo FROM crew_repos')) await sondearRepo(r.crew_id, r.repo).catch(e => console.warn('github crew', r.repo, e.message)); }
  finally { sondeando = false; }
}, 2 * 60e3);

/* ─────────── carga del equipo: cuánto tiene cada uno, para repartir mejor ─────────── */
ruta('GET', '/v1/crews/:id/carga', ({ p, yo }) => {
  const c = miembro(p.id, yo.id), hoy = fechaEn(Date.now(), c.zona), finSemana = sumarDias(hoy, 7), desde7 = Date.now() - 7 * 864e5;
  const gente = todos('SELECT u.id, u.nombre FROM miembros m JOIN usuarios u ON u.id = m.usuario_id WHERE m.crew_id = ? ORDER BY m.unido', c.id);
  const abiertas = todos('SELECT t.*, a.usuario_id AS quien FROM tareas t JOIN tarea_asignados a ON a.tarea_id = t.id WHERE t.crew_id = ? AND t.hecha_ts IS NULL', c.id);
  const sinNadie = uno('SELECT COUNT(*) n FROM tareas t WHERE t.crew_id = ? AND t.hecha_ts IS NULL AND NOT EXISTS (SELECT 1 FROM tarea_asignados a WHERE a.tarea_id = t.id)', c.id).n;
  const estados = todos('SELECT usuario_id, datos FROM estados WHERE crew_id = ? AND fecha > ?', c.id, sumarDias(hoy, -7));
  const personas = gente.map(g => {
    const mias = abiertas.filter(t => t.quien === g.id);
    const foco = estados.filter(e => e.usuario_id === g.id).reduce((s, e) => s + (JSON.parse(e.datos).focoMin ?? 0), 0);
    return { usuario: g.id, abiertas: mias.length, vencidas: mias.filter(t => t.vence && t.vence < hoy).length, semana: mias.filter(t => t.vence && t.vence >= hoy && t.vence <= finSemana).length,
      hechas7: uno('SELECT COUNT(*) n FROM tareas WHERE crew_id = ? AND hecha_por = ? AND hecha_ts > ?', c.id, g.id, desde7).n, focoMin7: Math.round(foco) };
  });
  const media = personas.reduce((s, x) => s + x.abiertas, 0) / Math.max(1, personas.length);
  return { personas: personas.map(x => ({ ...x, nivel: x.abiertas > media * 1.6 && x.abiertas >= 5 ? 'alta' : x.abiertas < media * 0.5 ? 'baja' : 'normal' })), sinNadie, media: Math.round(media * 10) / 10 };
});

/* ─────────── actas de reunión: graba (o pega notas) y NOVA saca el resumen, las decisiones y las tareas con responsable ───────────
   Se procesa en segundo plano: la entrada aparece al tiro en la bitácora como «procesando» y se completa sola. */
ruta('POST', '/v1/crews/:id/actas', async ({ req, p, q, yo }) => {
  const c = miembro(p.id, yo.id);
  if (!GEMINI) falla(503, 'Meeting notes need the Gemini key on the server');
  const esAudio = !String(req.headers['content-type'] ?? '').includes('json');
  const id = nuevoId(), ts = Date.now(), titulo = texto(q.get('titulo'), 120, 'titulo');
  let notas = null, ms = null;
  if (esAudio) {
    const b = await cuerpo(req, 24 * 1024 * 1024);
    if (b.length < 2000) falla(400, 'Audio too short');
    ms = Math.max(1000, Math.min(90 * 60e3, Math.round(Number(q.get('ms')) || 0)));
    writeFileSync(join(AUDIOS, `${id}.m4a`), b);
  } else {
    const j = await json(req);
    notas = texto(j.notas, 20000, 'notas') ?? falla(400, 'Missing notes');
  }
  correr("INSERT INTO bitacora (id, crew_id, usuario_id, ts, tipo, texto, audio) VALUES (?, ?, ?, ?, 'acta', ?, ?)", id, c.id, yo.id, ts, JSON.stringify({ estado: 'procesando', titulo }), ms);
  avisarCrew(c.id, { tipo: 'bitacora', id });
  procesarActa(id, c, yo, notas, titulo).catch(e => console.warn('acta', e.message));
  return verBitacora(uno('SELECT * FROM bitacora WHERE id = ?', id), yo.id);
});
async function procesarActa(id, c, yo, notas, titulo) {
  const gente = todos('SELECT u.id, u.nombre FROM miembros m JOIN usuarios u ON u.id = m.usuario_id WHERE m.crew_id = ?', c.id);
  const hoy = fechaEn(Date.now(), c.zona);
  const instr = `Eres NOVA, asistente del equipo «${c.nombre}». ${notas ? 'Estas son las notas de una reunión.' : 'Este audio es una reunión del equipo.'} Hoy es ${hoy}.
Personas del equipo: ${gente.map(g => g.nombre).join(', ')}.
Devuelve SOLO JSON: {"titulo": título corto de la reunión, "resumen": 2-4 frases, "decisiones": [frases], "tareas": [{"titulo": acción concreta, "responsables": [nombres EXACTOS de la lista, o vacío], "vence": "YYYY-MM-DD" si se dijo una fecha o plazo, o null}], "temas": [temas tratados], "transcripcion": ${notas ? 'null' : 'transcripción completa con puntuación'}}.
Escribe en el idioma de la reunión. No inventes: si algo no se dijo, déjalo vacío.`;
  const partes = notas ? [{ text: `${instr}\n\nNOTAS:\n${notas}` }] : [{ text: instr }, { inlineData: { mimeType: 'audio/mp4', data: readFileSync(join(AUDIOS, `${id}.m4a`)).toString('base64') } }];
  const r = await gemini(partes, 8000, true);
  let acta;
  try { acta = JSON.parse(String(r).replace(/^```json\s*|\s*```$/g, '')); } catch { acta = null; }
  if (!acta) { correr('UPDATE bitacora SET texto = ? WHERE id = ?', JSON.stringify({ estado: 'error', titulo }), id); avisarCrew(c.id, { tipo: 'bitacora', id }); return; }
  const porNombre = n => gente.find(g => sinTildes(g.nombre) === sinTildes(n))?.id ?? gente.find(g => sinTildes(g.nombre).split(' ')[0] === sinTildes(n).split(' ')[0])?.id;
  const final = {
    estado: 'lista', titulo: titulo ?? String(acta.titulo ?? 'Reunión').slice(0, 120), resumen: String(acta.resumen ?? '').slice(0, 1500),
    decisiones: (acta.decisiones ?? []).map(String).slice(0, 20), temas: (acta.temas ?? []).map(String).slice(0, 12),
    tareas: (acta.tareas ?? []).slice(0, 25).map(t => ({ titulo: String(t.titulo ?? '').slice(0, 140), responsables: (t.responsables ?? []).map(porNombre).filter(Boolean), vence: esFecha(t.vence) ? t.vence : null, creada: null })).filter(t => t.titulo),
  };
  correr('UPDATE bitacora SET texto = ?, transcripcion = ? WHERE id = ?', JSON.stringify(final), acta.transcripcion ? String(acta.transcripcion).slice(0, 60000) : null, id);
  avisarCrew(c.id, { tipo: 'bitacora', id });
  push(idsCrew(c.id), 'acta', { n: yo.nombre, t: final.titulo, k: final.tareas.length, d: final.decisiones.length }, '/journal?vista=crew', yo.id);
  const cuerpoTxt = [final.resumen, final.decisiones.length ? 'Decisiones:' : '', ...final.decisiones.map(d => `· ${d}`), final.tareas.length ? 'Tareas:' : '', ...final.tareas.map(t => `· ${t.titulo}${t.responsables.length ? ` — ${t.responsables.map(nombreDe).join(', ')}` : ''}${t.vence ? ` (${t.vence})` : ''}`)].filter(Boolean).join('\n');
  espejo(c.id, 'acta', `📝 *Acta: ${final.titulo}*\n${cuerpoTxt}`);
  const url = await aNotion(c.id, `Acta · ${final.titulo} · ${hoy}`, cuerpoTxt);
  if (url) { final.notion = url; correr('UPDATE bitacora SET texto = ? WHERE id = ?', JSON.stringify(final), id); }
}
/** crear las tareas que propuso el acta (todas o las elegidas), con sus responsables */
ruta('POST', '/v1/actas/:id/tareas', async ({ req, p, yo }) => {
  const b = uno("SELECT * FROM bitacora WHERE id = ? AND tipo = 'acta'", p.id) ?? falla(404, 'no existe');
  const c = miembro(b.crew_id, yo.id), acta = JSON.parse(b.texto), { indices } = await json(req);
  const elegir = Array.isArray(indices) ? indices : acta.tareas.map((_, i) => i);
  const ahora = Date.now(); let n = 0;
  for (const i of elegir) {
    const t = acta.tareas?.[i];
    if (!t || t.creada) continue;
    const id = nuevoId(), gente = t.responsables.filter(u => idsCrew(c.id).includes(u));
    correr('INSERT INTO tareas (id, crew_id, creador, asignado, titulo, nota, vence, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, c.id, yo.id, gente[0] ?? null, t.titulo, `De la reunión «${acta.titulo}»`, t.vence, ahora);
    gente.forEach((u, k) => correr('INSERT INTO tarea_asignados (tarea_id, usuario_id, ts) VALUES (?, ?, ?)', id, u, ahora + k));
    if (gente.length) push(gente, 'asignada', { n: yo.nombre, t: t.titulo }, '/crew', yo.id);
    t.creada = id; n++;
  }
  correr('UPDATE bitacora SET texto = ? WHERE id = ?', JSON.stringify(acta), b.id);
  avisarCrew(c.id, { tipo: 'tarea' }); avisarCrew(c.id, { tipo: 'bitacora', id: b.id });
  return { creadas: n, entrada: verBitacora(uno('SELECT * FROM bitacora WHERE id = ?', b.id), yo.id) };
});

/* ─────────── resumen semanal de la crew (viernes 17:00): NOVA lo escribe en la bitácora ───────────
   Los hechos salen de la base (metas, tareas cerradas, standups, bloqueos, decisiones, retos); Gemini solo los redacta.
   La salud va sin nombres: cuántas personas tuvieron días difíciles, nunca quiénes. */
/** lo que suma la v0.5 al resumen: retro, reconocimientos, actas y GitHub del equipo */
function hechosExtra(c, bit, desde) {
  const nom = id => nombreDe(id);
  const retros = bit.filter(b => b.tipo === 'retro').map(b => { try { return JSON.parse(b.texto); } catch { return null; } }).filter(Boolean);
  const kudos = bit.filter(b => b.tipo === 'kudos').map(b => { try { const j = JSON.parse(b.texto); return `${nom(b.usuario_id)} → ${(j.para ?? []).map(nom).join(', ')}: ${String(j.texto ?? '').slice(0, 80)}`; } catch { return null; } }).filter(Boolean);
  const actas = bit.filter(b => b.tipo === 'acta').map(b => { try { const j = JSON.parse(b.texto); return j.estado === 'lista' ? `«${j.titulo}» (${j.decisiones.length} decisiones)` : null; } catch { return null; } }).filter(Boolean);
  const gh = todos('SELECT tipo, repo, titulo FROM github_eventos WHERE crew_id = ? AND ts > ?', c.id, desde);
  const cuenta = k => gh.filter(e => e.tipo === k).length;
  return [
    retros.length ? `Retro (${retros.length} respuestas). Funcionó: ${retros.map(r => r.bien).filter(Boolean).slice(0, 4).join('; ')}. Mejorar: ${retros.map(r => r.mejorar).filter(Boolean).slice(0, 4).join('; ')}. Probar: ${retros.map(r => r.probar).filter(Boolean).slice(0, 3).join('; ')}` : '',
    kudos.length ? `Reconocimientos: ${kudos.slice(0, 4).join('; ')}` : '',
    actas.length ? `Reuniones con acta: ${actas.slice(0, 4).join('; ')}` : '',
    gh.length ? `GitHub: ${cuenta('pr_mergeado')} PRs integrados, ${cuenta('pr_abierto')} abiertos, ${cuenta('deploy_ok')} deploys a producción, ${cuenta('deploy_fallo')} deploys fallidos, ${cuenta('ci_fallo')} fallas de CI` : '',
  ];
}
async function resumenSemana(c, conPush = true) {
  const ahora = Date.now(), desde = ahora - 7 * 864e5, hoy = fechaEn(ahora, c.zona);
  const gente = todos('SELECT u.id, u.nombre FROM miembros m JOIN usuarios u ON u.id = m.usuario_id WHERE m.crew_id = ?', c.id);
  const nom = id => gente.find(g => g.id === id)?.nombre.split(' ')[0] ?? '?';
  const metas = todos('SELECT * FROM metas WHERE crew_id = ? AND cerrada = 0', c.id).map(m => verMeta(m, c.zona));
  const tareas = todos('SELECT titulo, hecha_por FROM tareas WHERE crew_id = ? AND hecha_ts > ?', c.id, desde);
  const porPersona = {}; for (const t of tareas) porPersona[nom(t.hecha_por)] = (porPersona[nom(t.hecha_por)] ?? 0) + 1;
  const pendientes = uno('SELECT COUNT(*) n FROM tareas WHERE crew_id = ? AND hecha_ts IS NULL', c.id).n;
  const bit = todos('SELECT * FROM bitacora WHERE crew_id = ? AND ts > ? ORDER BY ts', c.id, desde);
  const standups = bit.filter(b => b.tipo === 'standup');
  const bloqueos = standups.map(b => { try { const x = JSON.parse(b.texto); return x.bloqueo ? `${nom(b.usuario_id)}: ${x.bloqueo}` : null; } catch { return null; } }).filter(Boolean);
  const decisiones = bit.filter(b => b.tipo === 'decision').map(b => b.texto.slice(0, 160));
  const problemas = bit.filter(b => b.tipo === 'problema').map(b => b.texto.slice(0, 160));
  const avances = bit.filter(b => b.tipo === 'avance').map(b => `${nom(b.usuario_id)}: ${b.texto.slice(0, 120)}`);
  const retos = todos('SELECT * FROM retos WHERE crew_id = ? AND hasta >= ?', c.id, sumarDias(hoy, -7)).map(r => { const a = avanceReto(r); return `${r.titulo}: ${Math.round((a.total / r.meta) * 100)}%`; });
  const filas = todos('SELECT usuario_id, fecha, datos FROM estados WHERE crew_id = ? AND fecha > ?', c.id, sumarDias(hoy, -7));
  const dificiles = new Set(gente.filter(g => filas.filter(f => f.usuario_id === g.id && bajasSalud(JSON.parse(f.datos)).length).length >= 3).map(g => g.id)).size;
  const hechos = [
    metas.length ? `Metas: ${metas.map(m => `«${m.titulo}» ${Math.round(m.avance * 100)}% (esperado ${Math.round(m.esperado * 100)}%, ${m.estado.replace('_', ' ')}, vence ${m.hasta})`).join('; ')}` : '',
    `Tareas cerradas: ${tareas.length}${tareas.length ? ` (${Object.entries(porPersona).map(([n, k]) => `${n} ${k}`).join(', ')})` : ''}; pendientes: ${pendientes}`,
    tareas.length ? `Algunas cerradas: ${tareas.slice(0, 6).map(t => t.titulo).join('; ')}` : '',
    `Standups: ${standups.length} en la semana`,
    bloqueos.length ? `Bloqueos: ${bloqueos.slice(0, 5).join('; ')}` : 'Sin bloqueos reportados',
    decisiones.length ? `Decisiones: ${decisiones.slice(0, 5).join('; ')}` : '',
    problemas.length ? `Problemas: ${problemas.slice(0, 4).join('; ')}` : '',
    avances.length ? `Avances anotados: ${avances.slice(0, 5).join('; ')}` : '',
    retos.length ? `Retos: ${retos.join('; ')}` : '',
    dificiles ? `Bienestar: ${dificiles} persona(s) tuvieron 3 o más días con poco sueño, ánimo o energía bajos` : '',
    ...hechosExtra(c, bit, desde),
  ].filter(Boolean);
  const escrito = await gemini([{ text: `Eres NOVA, la asistente del equipo «${c.nombre}». Escribe el resumen de la semana para la bitácora del equipo, en español neutro (tú, sin voseo), cálido y directo, máximo 110 palabras, texto plano sin markdown ni títulos. Estructura: 1) una frase con cómo les fue; 2) 2–4 líneas que empiezan con «· » con lo más importante (avance de metas, lo cerrado, decisiones, bloqueos); 3) una línea final «Para la próxima semana: …» con UNA sugerencia concreta basada en los datos. No inventes nada que no esté en los hechos. Si hay un dato de bienestar, dilo en una sola línea tal cual es (poco descanso o energía baja) y con calidez, por ejemplo «· Algunos vienen con poco descanso: cuídense entre todos.»; nunca nombres a nadie, nunca hables de «momentos personales», problemas emocionales ni nada que el dato no diga. No saludes («Hola equipo»): empieza directo.\n\nHechos:\n${hechos.join('\n')}` }], 600);
  const texto = (escrito ?? [
    `Semana de ${c.nombre}:`,
    ...metas.slice(0, 3).map(m => `· «${m.titulo}» va en ${Math.round(m.avance * 100)}%${m.estado === 'atrasada' || m.estado === 'vencida' ? ' (atrasada)' : ''}`),
    `· ${tareas.length} tareas cerradas${tareas.length ? ` (${Object.entries(porPersona).map(([n, k]) => `${n} ${k}`).join(', ')})` : ''}, ${pendientes} pendientes`,
    bloqueos.length ? `· Bloqueos: ${bloqueos.slice(0, 3).join('; ')}` : '· Sin bloqueos reportados',
    decisiones.length ? `· Decisiones: ${decisiones.slice(0, 3).join('; ')}` : '',
    dificiles ? '· Algunos tuvieron días difíciles: cuídense entre todos.' : '',
  ].filter(Boolean).join('\n')).slice(0, 2000);
  const id = nuevoId();
  correr("INSERT INTO bitacora (id, crew_id, usuario_id, ts, tipo, texto) VALUES (?, ?, ?, ?, 'resumen', ?)", id, c.id, c.creado_por, ahora, texto);
  avisarCrew(c.id, { tipo: 'bitacora', id });
  if (conPush) push(gente.map(g => g.id), 'resumenSemana', { c: c.nombre, t: texto.split('\n')[0].slice(0, 140) }, '/journal?vista=crew');
  espejo(c.id, 'resumen', `📊 *La semana de ${c.nombre}*\n${texto}`);
  aNotion(c.id, `Semana de ${c.nombre} · ${hoy}`, texto).catch(() => {});
  return uno('SELECT * FROM bitacora WHERE id = ?', id);
}

/* ─────────── avisos programados (cada 5 min; cada uno se manda una sola vez) ─────────── */
/** señales bajas de un día compartido (mismas reglas que src/engine/crewSalud.ts) */
const bajasSalud = e => [e.suenoH > 0 && e.suenoH < 6 && 'sueno', e.animo != null && e.animo <= 2 && 'animo', e.energia != null && e.energia <= 2 && 'energia', e.recup === 1 && 'recup'].filter(Boolean);
const SENAL = { sueno: { es: 'poco sueño', en: 'little sleep' }, animo: { es: 'ánimo bajo', en: 'low mood' }, energia: { es: 'poca energía', en: 'low energy' }, recup: { es: 'recuperación baja', en: 'low recovery' } };
function horaEn(zona, ts = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zona, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(new Date(ts)).map(x => [x.type, x.value]));
  return { h: Number(p.hour) % 24, m: Number(p.minute), finde: p.weekday === 'Sat' || p.weekday === 'Sun' };
}
function programados() {
  const ahora = Date.now();
  for (const c of todos('SELECT * FROM crews')) {
    const hoy = fechaEn(ahora, c.zona), { h, finde } = horaEn(c.zona, ahora), ids = idsCrew(c.id);
    // 11:00, días hábiles: cómo va el standup del equipo (quién falta y los bloqueos)
    if (!finde && h >= 11 && h < 12 && unaVez(`standup:${c.id}:${hoy}`)) {
      const hechos = todos("SELECT b.usuario_id, b.texto, u.nombre FROM bitacora b JOIN usuarios u ON u.id = b.usuario_id WHERE b.crew_id = ? AND b.tipo = 'standup' AND b.ts > ?", c.id, ahora - 14 * 3600e3);
      const quien = new Map(hechos.map(x => [x.usuario_id, x]));
      if (quien.size) {
        const bloqueos = [...quien.values()].map(x => { try { return JSON.parse(x.texto).bloqueo ? x.nombre.split(' ')[0] : null; } catch { return null; } }).filter(Boolean);
        const faltan = todos('SELECT u.nombre, u.id FROM miembros m JOIN usuarios u ON u.id = m.usuario_id WHERE m.crew_id = ?', c.id).filter(u => !quien.has(u.id)).map(u => u.nombre.split(' ')[0]);
        const t = [bloqueos.length ? `⚠ ${bloqueos.join(', ')}` : '', faltan.length ? `${faltan.length <= 3 ? faltan.join(', ') : faltan.length} sin standup` : 'todos listos'].filter(Boolean).join(' · ');
        push(ids, 'standupResumen', { c: c.nombre, k: quien.size, total: ids.length, t }, '/journal?vista=crew');
      }
    }
    // lunes 9:00: cómo van las metas del equipo
    const dia = new Intl.DateTimeFormat('en-GB', { timeZone: c.zona, weekday: 'short' }).format(new Date(ahora));
    if (dia === 'Mon' && h >= 9 && h < 10 && unaVez(`metas:${c.id}:${hoy}`)) {
      const ms = todos('SELECT * FROM metas WHERE crew_id = ? AND cerrada = 0', c.id).map(m => verMeta(m, c.zona)).filter(m => m.estado !== 'lista');
      if (ms.length) {
        const atrasadas = ms.filter(m => m.estado === 'atrasada' || m.estado === 'vencida');
        const t = atrasadas.length ? `⚠ ${atrasadas.map(m => `«${m.titulo}» ${Math.round(m.avance * 100)}%`).join(' · ')}` : ms.map(m => `«${m.titulo}» ${Math.round(m.avance * 100)}%`).join(' · ');
        push(ids, 'metasSemana', { c: c.nombre, t: t.slice(0, 160) }, '/crew');
      }
    }
    // 19:00: tareas de la crew asignadas que vencen mañana
    if (h >= 19 && h < 20) {
      const manana = sumarDias(hoy, 1);
      for (const t of todos('SELECT * FROM tareas WHERE crew_id = ? AND vence = ? AND hecha_ts IS NULL AND asignado IS NOT NULL', c.id, manana))
        if (unaVez(`vence:${t.id}:${manana}`)) push([t.asignado], 'venceManana', { t: t.titulo }, '/crew');
    }
    // viernes 16:00: recordatorio de la retro (el resumen de las 17:00 la incluye)
    if (dia === 'Fri' && h >= 16 && h < 17 && unaVez(`retro:${c.id}:${hoy}`)) push(ids, 'retro', { c: c.nombre }, '/retro');
    // viernes 17:00: NOVA escribe el resumen de la semana en la bitácora
    if (dia === 'Fri' && h >= 17 && h < 18 && unaVez(`resumen:${c.id}:${hoy}`)) resumenSemana(c).catch(e => console.warn('resumen', e.message));
    // 12:00: alguien que comparte su salud lleva 3 días seguidos con señales bajas → aviso al resto (máx. uno cada 4 días por persona)
    if (h >= 12 && h < 13) {
      const fechas = [hoy, sumarDias(hoy, -1), sumarDias(hoy, -2)];
      const filas = todos(`SELECT usuario_id, fecha, datos FROM estados WHERE crew_id = ? AND fecha IN (?, ?, ?)`, c.id, ...fechas);
      for (const u of ids) {
        const d = fechas.map(f => { const r = filas.find(x => x.usuario_id === u && x.fecha === f); return r ? JSON.parse(r.datos) : null; });
        if (d[0]?.salud !== 1 || !d.every(x => x && bajasSalud(x).length)) continue;
        if (uno("SELECT 1 FROM envios WHERE clave LIKE ? AND ts > ?", `cuidar:${c.id}:${u}:%`, ahora - 4 * 864e5) || !unaVez(`cuidar:${c.id}:${u}:${hoy}`)) continue;
        const cuenta = {}; for (const x of d) for (const b of bajasSalud(x)) cuenta[b] = (cuenta[b] ?? 0) + 1;
        const top = Object.entries(cuenta).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
        const nombre = uno('SELECT nombre FROM usuarios WHERE id = ?', u)?.nombre.split(' ')[0] ?? '';
        push(ids, 'cuidar', { n: nombre, d: 3, s: top.map(k => SENAL[k].es).join(' y '), e: top.map(k => SENAL[k].en).join(' and ') }, '/crew-salud', u);
      }
    }
    // retos activos: aviso a la mitad y al cumplirse
    for (const r of todos('SELECT * FROM retos WHERE crew_id = ? AND desde <= ? AND hasta >= ?', c.id, hoy, hoy)) {
      const a = avanceReto(r), p = a.total / r.meta;
      if (p >= 1 && unaVez(`reto:${r.id}:100`)) {
        const top = Object.entries(a.por).sort((x, y) => y[1] - x[1])[0]?.[0];
        push(ids, 'retoListo', { c: c.nombre, t: r.titulo, top: uno('SELECT nombre FROM usuarios WHERE id = ?', top)?.nombre.split(' ')[0] ?? '' }, '/crew');
      } else if (p >= 0.5 && p < 1 && unaVez(`reto:${r.id}:50`)) {
        const d = Math.max(0, Math.round((Date.parse(`${r.hasta}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 864e5));
        push(ids, 'retoMitad', { c: c.nombre, t: r.titulo, p: Math.round(p * 100), d }, '/crew');
      }
    }
  }
}
setInterval(() => { try { programados(); } catch (e) { console.warn('programados', e.message); } }, 5 * 60e3);
setTimeout(() => { try { programados(); } catch {} }, 20e3);

servidor.listen(PUERTO, () => console.log(`API de NOVA en :${PUERTO} · datos en ${DATOS}`));
