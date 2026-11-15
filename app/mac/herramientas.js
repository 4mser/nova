/* Lo que NOVA puede HACER desde el Mac (herramientas del perfil «diario» del puente de voz).
   · las de la cuenta (tareas, listas, bitácora de la crew, GitHub) van a la API, igual que en el teléfono
     (port de src/voz/acciones.ts)
   · las del Mac (apps, música, volumen, portapapeles, pantallazo, recordatorios) usan el sistema
   · las que viven solo en el teléfono contestan ok:false para que NOVA lo diga en vez de inventar
   Cada respuesta va tal cual al modelo: nunca dice que hizo algo que la herramienta no confirmó. */
const { clipboard, Notification, shell, systemPreferences } = require('electron');
const { execFile } = require('node:child_process');
const { homedir } = require('node:os');
const { join } = require('node:path');
const { readFile, unlink } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { fechaDe } = require('./api');

const correr = (cmd, args) => new Promise((ok, mal) => execFile(cmd, args, { timeout: 8000 }, (e, out) => (e ? mal(e) : ok(String(out).trim()))));
const osa = guion => correr('osascript', ['-e', guion]);
const S = x => (x == null ? '' : String(x).trim());

/* ── parecido de nombres dichos en voz alta (igual que en el teléfono) ── */
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function parecido(a, b) {
  const A = new Set(norm(a).split(' ').filter(w => w.length > 2)), B = new Set(norm(b).split(' ').filter(w => w.length > 2));
  if (!A.size || !B.size) return norm(a) === norm(b) ? 1 : 0;
  let c = 0; for (const w of A) if (B.has(w) || [...B].some(x => x.startsWith(w) || w.startsWith(x))) c++;
  return c / Math.min(A.size, B.size);
}
function mejor(lista, texto, nombre) {
  let m, p = 0;
  for (const x of lista) { const q = parecido(texto, nombre(x)); if (q > p) { p = q; m = x; } }
  return p >= 0.5 ? m : undefined;
}
/* nombres de listas: «la lista de compras» ≠ «Lista de ideas»; sin las palabras de relleno, exacto primero */
const RELLENO = new Set(['lista', 'listas', 'list', 'mi', 'mis', 'la', 'el', 'de', 'del', 'para', 'the', 'my', 'of']);
const nombreLista = s => norm(s).split(' ').filter(w => !RELLENO.has(w)).join(' ') || norm(s);
function laLista(ls, texto) {
  const t = nombreLista(texto);
  return ls.find(x => nombreLista(x.nombre) === t) ?? mejor(ls, t, x => nombreLista(x.nombre));
}
const titulo = s => S(s).replace(/^(la |mi |the |my )?(lista|list)( de| of)? /i, '').slice(0, 40).replace(/^./, c => c.toUpperCase()) || 'Lista';

/** «18:30», «6 pm», «en 20 minutos», un día o una fecha → instante (port de cuandoDe en src/voz/acciones.ts) */
function cuandoDe(hora, minutos, ahora = Date.now(), dia, fecha) {
  const min = Number(minutos);
  if (Number.isFinite(min) && min > 0) return ahora + min * 60e3;
  const lee = h => { const m = String(h ?? '').toLowerCase().match(/(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm)?/); if (!m) return null; let hh = Number(m[1]); const mm = Number(m[2] ?? 0); if (m[3] === 'pm' && hh < 12) hh += 12; if (m[3] === 'am' && hh === 12) hh = 0; return hh > 23 || mm > 59 ? null : { hh, mm, ampm: !!m[3] }; };
  const f = String(fecha ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (f) { const h = hora ? lee(hora) : { hh: 9, mm: 0 }; return h ? new Date(Number(f[1]), Number(f[2]) - 1, Number(f[3]), h.hh, h.mm).getTime() : null; }
  const h = lee(hora);
  if (!h) return null;
  const d = new Date(ahora); d.setHours(h.hh, h.mm, 0, 0);
  // «a las 11:40» dicho a las 15:00 sin am/pm: lo más probable es esta noche
  if (!h.ampm && h.hh >= 1 && h.hh <= 11 && dia !== 'manana' && d.getTime() <= ahora + 30e3) { const pm = new Date(d); pm.setHours(h.hh + 12); if (pm.getTime() > ahora + 30e3) return pm.getTime(); }
  if (dia === 'manana' || (dia !== 'hoy' && d.getTime() <= ahora + 30e3)) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/* recordatorios y temporizadores: avisos del Mac mientras el widget esté abierto (se pierden si se cierra) */
const MAX_ESPERA = 2 ** 31 - 1;
function avisar(cuando, titulo, texto) {
  const espera = cuando - Date.now();
  if (espera > MAX_ESPERA) return false;
  setTimeout(() => new Notification({ title: titulo, body: texto, silent: false }).show(), Math.max(0, espera));
  return true;
}
const hora = ts => new Date(ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });

/* ── el teléfono a distancia: la API le pasa la orden a la app (src/cuenta/ordenes.ts) y el Mac espera la respuesta ── */
/** las que existen en los dos lados: el Mac por defecto; el teléfono si NOVA manda donde: 'telefono' */
const EN_AMBOS = new Set(['pantallazo', 'mirar_pantalla', 'leer_pantalla', 'abrir_app', 'volumen', 'control_musica', 'poner_musica', 'copiar', 'navegar', 'recordarme', 'poner_temporizador']);
/** las de la cuenta, que el Mac hace directo con la API */
const EN_MAC = new Set(['crear_tarea', 'completar_tarea', 'editar_tarea', 'tareas_externas', 'agregar_a_lista', 'leer_lista', 'marcar_en_lista', 'crear_lista', 'ver_listas', 'quitar_de_lista','escribir_diario', 'buscar_bitacora', 'mi_github', 'estado_github', 'carga_equipo']);
const NOMBRES = { poner_alarma: 'Alarma', quitar_alarma: 'Quitar alarma', poner_temporizador: 'Temporizador', recordarme: 'Recordatorio', llamar: 'Llamar', poner_musica: 'Música', control_musica: 'Música', redactar_mensaje: 'Mensaje', enviar_mensaje: 'Enviar mensaje', leer_mensajes: 'Leer mensajes', leer_notificaciones: 'Leer notificaciones', pantallazo: 'Pantallazo', leer_pantalla: 'Leer la pantalla', linterna: 'Linterna', volumen: 'Volumen', modo_telefono: 'Modo del teléfono', marcar_habito: 'Hábito', navegar: 'Ruta', abrir_app: 'Abrir app', bloquear_calendario: 'Calendario', recordar: 'Recordar' };
const dormir = ms => new Promise(r => setTimeout(r, ms));

async function enTelefono(api, herramienta, args) {
  const detalle = Object.values(args).filter(v => typeof v === 'string' || typeof v === 'number').join(' · ');
  const resumen = `${NOMBRES[herramienta] ?? herramienta.replace(/_/g, ' ')}${detalle ? `: ${detalle}` : ''}`.slice(0, 80);
  let o;
  try { o = await api.pedir('/v1/telefono/ordenes', { json: { herramienta, args, resumen } }); }
  catch (e) { return { ok: false, motivo: e.estado === 404 ? 'the link with the phone is not deployed on the NOVA API yet' : e.message }; }
  // con la app abierta responde en uno o dos segundos; cerrada, la orden queda esperando el aviso
  const hasta = Date.now() + (o.entregada ? 20e3 : 3e3);
  while (Date.now() < hasta) {
    await dormir(600);
    const r = await api.pedir(`/v1/telefono/ordenes/${o.id}`).catch(() => null);
    if (r?.estado === 'hecha') return { ...r.respuesta, en: 'telefono' };
  }
  return { ok: false, pendiente: true, motivo: o.entregada ? 'sent to the phone, no answer yet' : 'the NOVA app is closed on the phone: a notification was sent and it runs when they tap it' };
}

/** la pantalla del Mac para que NOVA la vea (sin el widget encima) */
async function capturaMac(win, ancho = 1600) {
  if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') return { error: 'macOS has not allowed screen capture yet: System Settings → Privacy & Security → Screen Recording → turn on Electron (or NOVA), then reopen the widget' };
  const ruta = join(tmpdir(), `nova-${Date.now()}.jpg`), visible = win?.isVisible();
  if (visible) win.hide();
  await dormir(250);
  try {
    await correr('screencapture', ['-x', '-t', 'jpg', ruta]);
    await correr('sips', ['-Z', String(ancho), '-s', 'formatOptions', '70', ruta]);
    return { b64: (await readFile(ruta)).toString('base64') };
  } catch (e) { return { error: `screen capture failed: ${e.message}` }; }
  finally { if (visible) win.showInactive(); unlink(ruta).catch(() => {}); }
}

async function ejecutar(nombre, a, { api, win }) {
  const { donde, ...resto } = a;
  if (donde === 'telefono' && EN_AMBOS.has(nombre)) return enTelefono(api, nombre === 'mirar_pantalla' ? 'leer_pantalla' : nombre, resto);
  if (!EN_AMBOS.has(nombre) && !EN_MAC.has(nombre)) return enTelefono(api, nombre, resto);
  a = resto;
  const crew = api.crew(), yo = api.usuario()?.id;
  const tareas = () => api.pedir('/v1/tareas');
  const listas = () => api.pedir('/v1/listas');

  switch (nombre) {
    /* ── cuenta ── */
    case 'crear_tarea': {
      const titulo = S(a.titulo);
      if (!titulo) return { ok: false };
      if (['todoist', 'google', 'linear'].includes(S(a.destino))) return { ok: false, motivo: 'creating tasks in Todoist, Google Tasks or Linear only works from the phone' };
      const vence = /^\d{4}-\d{2}-\d{2}$/.test(S(a.vence)) ? S(a.vence) : a.para_hoy ? fechaDe(Date.now()) : null;
      const nombres = Array.isArray(a.para) ? a.para.map(String) : [];
      const miembros = crew?.miembros ?? [];
      const gente = nombres.map(n => mejor(miembros, n, m => m.nombre)).filter(Boolean);
      const faltan = nombres.filter(n => !mejor(miembros, n, m => m.nombre));
      const deCrew = !!crew && (!!a.para_crew || gente.length > 0);
      const enlace = /^https?:\/\//.test(S(a.enlace)) ? S(a.enlace) : undefined;
      await api.pedir('/v1/tareas', { json: { titulo, crew: deCrew ? crew.id : null, vence, asignados: deCrew ? gente.map(m => m.id) : undefined, enlaces: enlace ? [enlace] : undefined } });
      return { ok: true, para: gente.map(m => m.nombre), ...(faltan.length ? { no_encontrados: faltan } : {}) };
    }
    case 'completar_tarea': {
      const abiertas = (await tareas()).filter(x => !x.hecha && (!x.crew || !(x.asignados?.length || x.asignado) || (x.asignados ?? [x.asignado]).includes(yo)));
      const ta = mejor(abiertas, S(a.titulo), x => x.titulo);
      if (!ta) return { ok: false, motivo: 'no matching open task', abiertas: abiertas.slice(0, 12).map(x => x.titulo) };
      await api.pedir(`/v1/tareas/${ta.id}`, { metodo: 'PATCH', json: { hecha: true } });
      return { ok: true, tarea: ta.titulo };
    }
    case 'editar_tarea': {
      const abiertas = (await tareas()).filter(x => !x.hecha);
      const ta = mejor(abiertas, S(a.tarea), x => x.titulo);
      if (!ta) return { ok: false, motivo: 'no matching open task', abiertas: abiertas.slice(0, 12).map(x => x.titulo) };
      const c = {};
      if (typeof a.vence === 'string') { if (/^\d{4}-\d{2}-\d{2}$/.test(a.vence)) c.vence = a.vence; else if (!a.vence.trim() || /^(none|null|sin)/i.test(a.vence)) c.vence = null; }
      if (a.sin_fecha === true) c.vence = null;
      if (S(a.titulo)) c.titulo = S(a.titulo).slice(0, 120);
      if (S(a.nota)) c.nota = S(a.nota).slice(0, 500);
      if (!Object.keys(c).length) return { ok: false, motivo: 'nothing to change: give vence (YYYY-MM-DD), sin_fecha, titulo or nota' };
      await api.pedir(`/v1/tareas/${ta.id}`, { metodo: 'PATCH', json: c });
      const venceN = c.vence !== undefined ? c.vence : ta.vence;
      return { ok: true, tarea: c.titulo ?? ta.titulo, vence: venceN };
    }
    case 'tareas_externas': {
      const x = await api.pedir('/v1/externas');
      return { ok: true, tareas: x.tareas.slice(0, 30).map(y => ({ titulo: y.titulo, en: y.fuente, vence: y.vence })), errores: x.errores };
    }
    case 'agregar_a_lista': {
      const items = (Array.isArray(a.items) ? a.items : S(a.items).split(',')).map(x => S(x)).filter(Boolean);
      if (!items.length) return { ok: false, motivo: 'no items' };
      let l = laLista(await listas(), S(a.lista)), creada = false;
      if (!l) { l = await api.pedir('/v1/listas', { json: { nombre: titulo(a.lista), icono: 'list-outline', crew: a.para_crew && crew ? crew.id : null } }); creada = true; }
      // lo que ya está pendiente no se repite («comprar un basurero» = «basurero»)
      const clave = x => norm(x).replace(/^(?:comprar|compra|agregar|anotar)\s+/, '').replace(/^(?:un|una|unos|unas|el|la|los|las)\s+/, '').trim();
      const ya = (l.items ?? []).filter(i => !i.hecho).map(i => clave(i.texto));
      const nuevos = items.filter(x => !ya.includes(clave(x)));
      if (!nuevos.length) return { ok: true, lista: l.nombre, ya_estaban: items, pendientes: (l.items ?? []).filter(i => !i.hecho).map(i => i.texto) };
      const r = await api.pedir(`/v1/listas/${l.id}/items`, { json: { textos: nuevos } });
      // se confirma releyendo lo que quedó guardado, no lo que se mandó
      const quedan = (r?.items ?? []).filter(i => !i.hecho).map(i => i.texto);
      const faltan = nuevos.filter(x => !quedan.some(y => norm(y) === norm(x)));
      return { ok: !faltan.length, lista: l.nombre, creada, agregados: nuevos.filter(x => !faltan.includes(x)), ...(nuevos.length < items.length ? { ya_estaban: items.filter(x => !nuevos.includes(x)) } : {}), ...(faltan.length ? { no_guardados: faltan } : {}), pendientes: quedan };
    }
    case 'crear_lista': {
      const ls = await listas(), ya = laLista(ls, S(a.nombre));
      if (ya && nombreLista(ya.nombre) === nombreLista(S(a.nombre))) return { ok: true, lista: ya.nombre, ya_existia: true };
      const l = await api.pedir('/v1/listas', { json: { nombre: titulo(a.nombre), icono: S(a.icono) || 'list-outline', crew: a.para_crew && crew ? crew.id : null } });
      const items = (Array.isArray(a.items) ? a.items : []).map(x => S(x)).filter(Boolean);
      if (items.length) await api.pedir(`/v1/listas/${l.id}/items`, { json: { textos: items } });
      return { ok: true, lista: l.nombre, creada: true, agregados: items };
    }
    case 'ver_listas': {
      return { ok: true, listas: (await listas()).map(l => ({ nombre: l.nombre, pendientes: l.items.filter(i => !i.hecho).map(i => i.texto), hechos: l.items.filter(i => i.hecho).length, crew: !!l.crew })) };
    }
    case 'quitar_de_lista': {
      const l = laLista(await listas(), S(a.lista));
      const it = l ? mejor(l.items, S(a.item), x => x.texto) : null;
      if (!l || !it) return { ok: false, motivo: l ? 'no such item' : 'no such list', items: l?.items.map(i => i.texto) };
      await api.pedir(`/v1/items/${it.id}`, { metodo: 'DELETE' });
      return { ok: true, lista: l.nombre, quitado: it.texto };
    }
    case 'leer_lista': {
      const ls = await listas(), l = laLista(ls, S(a.lista));
      if (!l) return { ok: false, motivo: 'no such list', listas: ls.map(x => x.nombre) };
      return { ok: true, lista: l.nombre, pendientes: l.items.filter(i => !i.hecho).map(i => i.texto), hechos: l.items.filter(i => i.hecho).length };
    }
    case 'marcar_en_lista': {
      const l = laLista(await listas(), S(a.lista));
      const it = l ? mejor(l.items, S(a.item), x => x.texto) : null;
      if (!l || !it) return { ok: false, motivo: l ? 'no such item' : 'no such list', items: l?.items.map(i => i.texto) };
      await api.pedir(`/v1/items/${it.id}`, { metodo: 'PATCH', json: { hecho: a.hecho !== false } });
      return { ok: true };
    }
    case 'escribir_diario': {
      const texto = S(a.texto);
      if (!texto) return { ok: false };
      if (!a.para_crew) return { ok: false, motivo: 'the personal journal lives on the phone; only the crew log works from the Mac' };
      if (!crew) return { ok: false, motivo: 'not in a crew' };
      const tipo = ['nota', 'avance', 'problema', 'decision'].includes(a.tipo) ? a.tipo : 'nota';
      await api.pedir(`/v1/crews/${crew.id}/bitacora`, { json: { texto, tipo } });
      return { ok: true, bitacora: 'crew', tipo };
    }
    case 'buscar_bitacora': {
      if (!crew) return { ok: false, motivo: 'not in a crew (the personal journal lives on the phone)' };
      const autor = a.quien ? mejor(crew.miembros, S(a.quien), m => m.nombre) : undefined;
      const nombres = new Set(crew.miembros.flatMap(m => norm(m.nombre).split(' ')));
      const q = norm(S(a.q)).split(' ').filter(w => w.length > 1 && ![...nombres].some(n => n.startsWith(w) || w.startsWith(n))).join(' ');
      if (q.length < 2 && !autor) return { ok: false, motivo: 'need words to search' };
      const l = await api.pedir(`/v1/crews/${crew.id}/bitacora/buscar?${new URLSearchParams({ q: q || ' ', ...(autor ? { autor: autor.id } : {}) })}`);
      const quien = id => (id ? crew.miembros.find(m => m.id === id)?.nombre.split(/\s+/)[0] : 'anónimo') ?? '?';
      const dia = ts => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      return { ok: true, crew: l.slice(0, 8).map(e => ({ quien: e.tipo === 'resumen' ? 'NOVA' : quien(e.usuario), cuando: dia(e.ts), tipo: e.tipo, texto: [e.texto, e.audio?.transcripcion ? `(voice note) ${e.audio.transcripcion}` : ''].filter(Boolean).join(' ').slice(0, 400) })) };
    }
    case 'mi_github': {
      const sinGh = { ok: false, motivo: 'their GitHub is not connected in NOVA (phone → Settings → Integrations → GitHub) or it could not load' };
      if (S(a.que) === 'anio') {
        const c = await api.pedir('/v1/github/calendario').catch(() => null);
        if (!c) return sinGh;
        let racha = 0; for (let i = c.dias.length - 1; i >= 0 && c.dias[i].n > 0; i--) racha++;
        return { ok: true, login: c.login, contribuciones_anio: c.total, dias_activos: c.dias.filter(d => d.n > 0).length, racha_actual_dias: racha };
      }
      const g = await api.pedir(`/v1/github/resumen?tz=${new Date().getTimezoneOffset()}`).catch(() => null);
      if (!g) return sinGh;
      if (S(a.que) === 'pendientes') return { ok: true, prs_abiertos: g.prs.map(x => `${x.repo}#${x.numero} ${x.titulo}`), revisiones_que_te_piden: g.revisar.map(x => `${x.repo}#${x.numero} ${x.titulo}`), issues_asignados: g.issues.map(x => `${x.repo}#${x.numero} ${x.titulo}`) };
      return { ok: true, por_dia_semana: g.hoy.semana ?? [], commits_hoy: g.hoy.commits, contribuciones_hoy: g.hoy.contribuciones ?? 0, contribuciones_semana: (g.hoy.semana ?? []).reduce((x, y) => x + y, 0), repos_hoy: g.hoy.repos, prs_abiertos: g.prs.length, revisiones_pendientes: g.revisar.length };
    }
    case 'estado_github': {
      if (!crew) return { ok: false, motivo: 'not in a crew' };
      const g = await api.pedir(`/v1/crews/${crew.id}/github`);
      if (!g.repos.length) return { ok: true, repos: [], nota: 'No repos added yet: they can add them in Crew → GitHub.' };
      return { ok: true, repos: g.repos.map(r => r.repo), eventos: g.eventos.slice(0, 15).map(e => ({ tipo: e.tipo, repo: e.repo, titulo: e.titulo, detalle: e.detalle, hace_min: Math.round((Date.now() - e.ts) / 60e3) })) };
    }
    case 'carga_equipo': {
      if (!crew) return { ok: false, motivo: 'not in a crew' };
      const c = await api.pedir(`/v1/crews/${crew.id}/carga`);
      const nom = id => crew.miembros.find(m => m.id === id)?.nombre.split(' ')[0] ?? '?';
      return { ok: true, personas: c.personas.map(p => ({ quien: nom(p.usuario), abiertas: p.abiertas, vencidas: p.vencidas, esta_semana: p.semana, cerradas_7d: p.hechas7, foco_h_7d: Math.round(p.focoMin7 / 60), nivel: p.nivel })), sin_responsable: c.sinNadie };
    }

    /* ── el Mac ── */
    case 'recordarme': {
      const texto = S(a.texto);
      const cuando = cuandoDe(a.hora, a.en_minutos, Date.now(), a.dia, a.fecha);
      if (!texto || !cuando) return { ok: false, motivo: 'need what and when' };
      if (!avisar(cuando, 'NOVA te recuerda', texto)) return { ok: false, motivo: 'too far ahead for the Mac widget: ask on the phone' };
      return { ok: true, hora_local: hora(cuando), fecha: fechaDe(cuando), nota: 'Mac notification; it only fires if the widget is still open then' };
    }
    case 'poner_temporizador': {
      const seg = Math.max(1, (Number(a.minutos) || 0) * 60 + (Number(a.segundos) || 0));
      avisar(Date.now() + seg * 1000, 'Temporizador', S(a.etiqueta) || `${Math.round(seg / 60)} min`);
      return { ok: true, segundos: seg, termina: hora(Date.now() + seg * 1000) };
    }
    case 'abrir_app': {
      const app = S(a.nombre);
      try { await correr('open', ['-a', app]); return { ok: true, app }; } catch { return { ok: false, motivo: `no app called "${app}" on this Mac` }; }
    }
    case 'control_musica': {
      const reproductor = (await osa('if application "Spotify" is running then return "Spotify"\nif application "Music" is running then return "Music"\nreturn ""').catch(() => '')) || '';
      if (!reproductor) return { ok: false, motivo: 'nothing is playing on the Mac (neither Spotify nor Music is open)' };
      const orden = { pausar: 'pause', reanudar: 'play', siguiente: 'next track', anterior: 'previous track' }[S(a.accion)];
      if (orden) { await osa(`tell application "${reproductor}" to ${orden}`); return { ok: true, en: reproductor }; }
      const suena = await osa(`tell application "${reproductor}" to return (name of current track) & " — " & (artist of current track)`).catch(() => '');
      return suena ? { ok: true, suena, en: reproductor } : { ok: false, motivo: 'nothing playing' };
    }
    case 'poner_musica': {
      const q = S(a.busqueda);
      if (!q) return { ok: false };
      if (a.app === 'youtube_music') { await shell.openExternal(`https://music.youtube.com/search?q=${encodeURIComponent(q)}`); return { ok: true, en: 'YouTube Music', nota: 'search opened; they pick what to play' }; }
      await shell.openExternal(`spotify:search:${encodeURIComponent(q)}`);
      return { ok: true, en: 'Spotify', nota: 'search opened in Spotify; they pick what to play' };
    }
    case 'volumen': {
      const actual = Number(await osa('output volume of (get volume settings)').catch(() => 50));
      const accion = S(a.accion);
      if (accion === 'silenciar') { await osa('set volume output muted true'); return { ok: true, silenciado: true }; }
      const nivel = accion === 'nivel' ? Number(a.nivel) : accion === 'subir' ? actual + 15 : accion === 'bajar' ? actual - 15 : NaN;
      if (!Number.isFinite(nivel)) return { ok: false };
      const n = Math.max(0, Math.min(100, Math.round(nivel)));
      await osa(`set volume output volume ${n} without output muted`);
      return { ok: true, nivel: n };
    }
    case 'copiar': {
      const texto = S(a.texto);
      if (!texto) return { ok: false };
      clipboard.writeText(texto);
      return { ok: true };
    }
    case 'pantallazo': {
      if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') return { ok: false, motivo: 'macOS has not allowed screen capture yet: System Settings → Privacy & Security → Screen Recording → turn on Electron (or NOVA)' };
      const ruta = join(homedir(), 'Desktop', `NOVA ${new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.')}.png`);
      const visible = win?.isVisible();
      if (visible) win.hide();
      await dormir(250);
      try { await correr('screencapture', ['-x', ruta]); } catch { return { ok: false, motivo: 'the screenshot failed' }; } finally { if (visible) win.showInactive(); }
      // una vista chica para mostrarla en el panel (no va al modelo)
      const vista = join(tmpdir(), `nova-vista-${Date.now()}.jpg`);
      const _vista = await correr('sips', ['-Z', '900', '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', ruta, '--out', vista]).then(() => readFile(vista)).then(b => b.toString('base64')).catch(() => null);
      unlink(vista).catch(() => {});
      return { ok: true, guardado_en: 'Escritorio', ...(_vista ? { _vista } : {}) };
    }
    case 'mirar_pantalla': case 'leer_pantalla': {
      const c = await capturaMac(win);
      if (c.error) return { ok: false, motivo: c.error };
      // la imagen va a la conversación como cuadro de video (app.js la manda antes de la respuesta)
      return { ok: true, nota: 'a picture of their Mac screen was sent to you: answer about what you see', _imagen: c.b64 };
    }
    case 'navegar': {
      const destino = S(a.destino);
      if (!destino) return { ok: false };
      const modo = { auto: 'driving', caminando: 'walking', bicicleta: 'bicycling', transporte: 'transit' }[S(a.modo)] ?? 'driving';
      await shell.openExternal(a.app === 'waze' ? `https://waze.com/ul?q=${encodeURIComponent(destino)}&navigate=yes` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}&travelmode=${modo}`);
      return { ok: true, nota: 'directions opened in the browser' };
    }
  }
  return { ok: false, motivo: `${nombre} is not available on the Mac` };
}

module.exports = { ejecutar, cuandoDe };
