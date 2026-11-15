import { fechaDe } from './diario';
/* El día a día (modo diario): lo que NOVA te dice al abrir la app, armado SOLO con datos reales —tus tareas, el
   check-in, el foco, tus pasos y tu sueño si los compartes, y el momento de la crew—. Si no sabe algo, no lo inventa. */
import type { Traductor } from '../i18n';
import { delDia, huecos, leerAgendaActual } from '../sensores/agenda';
import { leerClima, proximaLluvia, tipoClima } from '../sensores/clima';
import { cuentaDe, leerHabitos, metaDe, racha as rachaHabito } from './habitos';
import { leerMemoria } from './memoria';
import { leerCache, type EntradaCrew, type EstadoDia, type Meta } from '../cuenta/datos';
import { rango7, saludCrew } from './crewSalud';
import { leerRecordatoriosPropios } from './recordatoriosPropios';
import { leerRutina } from './rutina';
import { leerSesion } from '../cuenta/sesion';
import { leerRepaso, pendientesHoy } from './repaso';
import { leerHistoriaActual, recuperacion, ultimos } from '../sensores/historia';

export type Contexto = {
  ahora: number; nombre: string;
  tareasHoy: { titulo: string }[]; sinFecha?: { titulo: string }[]; checkinHecho: boolean; focoMin: number;
  pasos?: number; suenoH?: number; momentoAbierto: boolean; crewSubieron: number; crewTotal: number;
};

export const saludo = (tr: Traductor, ahora: number) => {
  const h = new Date(ahora).getHours();
  return tr.t(h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 20 ? 'Good afternoon' : 'Good evening');
};

const dur = (h: number) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} m`;

export function fraseDelDia(tr: Traductor, c: Contexto): { texto: string; expr: 'feliz' | 'pensativa' | 'sorprendida' | 'dormida' } {
  const { t, tp } = tr, h = new Date(c.ahora).getHours(), n = c.tareasHoy.length, primera = c.tareasHoy[0]?.titulo;
  if (c.momentoAbierto) return { texto: t("It's the crew moment! Share what you're doing right now."), expr: 'sorprendida' };
  if (h >= 23 || h < 5) return { texto: t('It is late. Put the phone down and I will keep your things for tomorrow.'), expr: 'dormida' };
  const sueno = c.suenoH != null ? (c.suenoH < 6 ? t('You slept {d}, less than you need. Go easy on yourself today.', { d: dur(c.suenoH) }) : t('You slept {d}.', { d: dur(c.suenoH) })) : '';
  if (h >= 19 && !c.checkinHecho) return { texto: `${t('How did today go?')} ${t('Your check-in takes a minute.')}`, expr: 'pensativa' };
  if (n && primera) {
    const tareas = tp(n, 'You have {n} thing for today.', 'You have {n} things for today.');
    return { texto: `${h < 12 && sueno ? `${sueno} ` : ''}${tareas} ${t('Start with «{t}»?', { t: primera })}`, expr: c.suenoH != null && c.suenoH < 6 ? 'pensativa' : 'feliz' };
  }
  // sin nada que venza hoy: lo pendiente sin fecha se nombra como tal (no como «para hoy»)
  const sf = c.sinFecha ?? [];
  if (sf.length && h < 19) return { texto: `${h < 12 && sueno ? `${sueno} ` : ''}${tp(sf.length, 'Nothing due today. You have {n} task with no date: «{t}».', 'Nothing due today. You have {n} tasks with no date, like «{t}».', { t: sf[0].titulo })}`, expr: 'feliz' };
  if (c.focoMin >= 25) return { texto: t('{n} minutes of focus today. Nice work.', { n: c.focoMin }), expr: 'feliz' };
  if (c.pasos != null && h >= 16 && c.pasos < 4000) return { texto: t('Only {n} steps so far. A 15-minute walk would do you good.', { n: c.pasos.toLocaleString(tr.locale) }), expr: 'pensativa' };
  return { texto: `${h < 12 && sueno ? `${sueno} ` : ''}${t('Your day is clear. Add what matters, or start a focus session with me.')}`, expr: 'feliz' };
}

/** el contexto que NOVA recibe en el día a día (en inglés: es para el modelo). Solo datos reales. */
export function contextoDiario(c: {
  ahora: number; nombre: string; tareas: { titulo: string; hecha: boolean; vence: string | null; deCrew: boolean; asignadaAMi: boolean }[];
  focoHoy: number; aprenderHoy: number; focoSemana: number;
  crew?: { nombre: string; miembros: string[]; subieron: string[]; momentoAbierto: boolean; retos: string[] };
}) {
  const d = new Date(c.ahora);
  const pend = c.tareas.filter(x => !x.hecha), hechas = c.tareas.filter(x => x.hecha);
  const linea = (x: (typeof c.tareas)[number]) => `"${x.titulo}"${x.vence ? ` (due ${x.vence})` : ''}${x.deCrew ? (x.asignadaAMi ? ' [crew, assigned to them]' : ' [crew]') : ''}`;
  return [
    `Now: ${d.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} (their local time). Today's date: ${fechaDe(c.ahora)}.`,
    `Name: ${c.nombre}.`,
    pend.length ? `Open tasks (${pend.length}): ${pend.slice(0, 15).map(linea).join('; ')}.` : 'No open tasks.',
    hechas.length ? `Done recently: ${hechas.slice(0, 8).map(x => `"${x.titulo}"`).join(', ')}.` : '',
    `Focus today: ${c.focoHoy} min; learning today: ${c.aprenderHoy} min; focus in the last 7 days: ${c.focoSemana} min.`,
    salud7(),
    agendaTxt(c.ahora),
    memoriaTxt(),
    habitosTxt(c.ahora),
    climaTxt(c.ahora),
    bitacoraTxt(c.crew?.nombre),
    metasTxt(),
    saludCrewTxt(),
    recordatoriosTxt(),
    rutinaTxt(),
    githubTxt(),
    githubCrewTxt(),
    externasTxt(),
    stravaTxt(),
    listasTxt(),
    c.crew ? `Crew "${c.crew.nombre}": ${c.crew.miembros.join(', ')}. Shared a photo today: ${c.crew.subieron.join(', ') || 'nobody yet'}.${c.crew.momentoAbierto ? ' The daily crew photo moment is happening RIGHT NOW (10 minutes to share).' : ''}${c.crew.retos.length ? ` Active challenges: ${c.crew.retos.join('; ')}.` : ''}` : 'Not in a crew yet.',
  ].filter(Boolean).join('\n');
}

/** la última semana de Health Connect, en números, y la recuperación contra su propia línea base (si hay datos) */
function salud7() {
  const { dias } = leerHistoriaActual(), sem = ultimos(dias, 7);
  const sue = sem.filter(d => d.suenoH != null), pas = sem.filter(d => d.pasos != null);
  if (!sue.length && !pas.length) return '';
  const r = recuperacion(dias);
  const partes = [
    sue.length ? `sleep per night ${sue.map(d => `${d.fecha.slice(5)} ${d.suenoH!.toFixed(1)}h`).join(', ')}` : '',
    pas.length ? `steps per day ${pas.map(d => `${d.fecha.slice(5)} ${d.pasos}`).join(', ')}` : '',
    r ? `recovery vs their own 28-day baseline: ${r.nivel}${r.vfc ? ` (HRV ${Math.round(r.vfc.semana)} vs usual ${Math.round(r.vfc.base)} ms)` : ''}${r.reposo ? ` (resting HR ${Math.round(r.reposo.semana)} vs usual ${Math.round(r.reposo.base)})` : ''}` : '',
  ].filter(Boolean);
  return `Health Connect, last 7 days: ${partes.join('; ')}. Never diagnose; compare them only with themselves.`;
}

/** su agenda de hoy y mañana (calendarios del teléfono) y los huecos libres de hoy, para proponer foco con criterio */
function agendaTxt(ahora: number) {
  const { eventos, leido } = leerAgendaActual();
  if (!leido) return '';
  const h = (ts: number) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const lista = (evs: typeof eventos) => evs.map(e => (e.todoElDia ? `all day "${e.titulo}"` : `${h(e.ini)}-${h(e.fin)} "${e.titulo}"`)).join('; ') || 'nothing';
  const libres = huecos(eventos, ahora).map(x => `${h(x.ini)}-${h(x.fin)}`).join(', ');
  return `Calendar today: ${lista(delDia(eventos, ahora))}. Tomorrow: ${lista(delDia(eventos, ahora + 864e5))}.${libres ? ` Free gaps left today: ${libres}.` : ''}`;
}

/** sus hábitos (hechos hoy o no, con racha) y lo que le toca repasar: para que NOVA use los nombres exactos */
function habitosTxt(ahora: number) {
  const { habitos, marcas } = leerHabitos(), f = new Date(ahora), hoy = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
  const tarjetas = pendientesHoy(leerRepaso().tarjetas, ahora);
  return [
    habitos.length ? `Habits: ${habitos.map(h => `"${h.nombre}" ${metaDe(h) > 1 ? `${cuentaDe(h, hoy)}/${metaDe(h)} ${h.unidad ?? ''} today` : marcas[hoy]?.includes(h.id) ? 'done today' : 'not yet today'}, streak ${rachaHabito(marcas, h.id, ahora)}`).join('; ')}.` : 'No habits set yet.',
    tarjetas.length ? `To review today (spaced repetition): ${tarjetas.map(x => `"${x.tema}"`).join(', ')}.` : '',
  ].filter(Boolean).join(' ');
}

/** las últimas entradas de la bitácora de la crew (lo que esté en caché), con autor y tipo */
function bitacoraTxt(crewNombre?: string) {
  const { crews, crewId } = leerSesion(), crew = crews.find(x => x.id === crewId);
  if (!crew) return '';
  const lista = (leerCache<EntradaCrew[]>(`bitacora:${crew.id}`) ?? []).slice(0, 8);
  if (!lista.length) return '';
  const quien = (id: string | null) => (id ? crew.miembros.find(m => m.id === id)?.nombre.split(/\s+/)[0] : 'anónimo') ?? '?';
  const h = (ts: number) => new Date(ts).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  return `Crew log of "${crewNombre ?? crew.nombre}" (latest first; use buscar_bitacora for older things): ${lista.map(e => `[${h(e.ts)}] ${e.tipo === 'resumen' ? 'NOVA weekly summary' : `${quien(e.usuario)} (${e.tipo})`}: ${[e.texto.slice(0, e.tipo === 'resumen' ? 500 : 160), e.audio?.transcripcion ? `voice note: ${e.audio.transcripcion.slice(0, 200)}` : e.audio ? 'voice note' : ''].filter(Boolean).join(' — ')}`).join(' | ')}.`;
}

/** el clima de su ciudad hoy y mañana (Open-Meteo), para planear y recomendar con criterio */
function climaTxt(ahora: number) {
  const { clima, ciudad } = leerClima();
  if (!clima) return '';
  const ll = proximaLluvia(clima, ahora), h = (ts: number) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `Weather in ${ciudad.nombre}: now ${Math.round(clima.ahora.temp)}°C ${tipoClima(clima.ahora.codigo).t.toLowerCase()}; today ${Math.round(clima.hoy.min)}–${Math.round(clima.hoy.max)}°C, rain chance ${clima.hoy.lluvia}%${ll ? ` (likely around ${h(ll.ts)})` : ''}, UV ${Math.round(clima.hoy.uv)}; tomorrow ${Math.round(clima.manana.min)}–${Math.round(clima.manana.max)}°C, rain chance ${clima.manana.lluvia}%.`;
}

/** lo que NOVA recuerda de esta persona (lo más nuevo primero) */
function memoriaTxt() {
  const { recuerdos } = leerMemoria();
  return recuerdos.length ? `What you remember about them (from earlier conversations; use it naturally, do not recite it): ${recuerdos.slice(0, 30).map(r => `[${r.tipo}] ${r.texto}`).join('; ')}.` : '';
}

/** cómo viene cada persona de la crew (solo lo que comparte): nivel de hoy, días seguidos con señales bajas y números */
function saludCrewTxt() {
  const { crews, crewId, usuario } = leerSesion(), crew = crews.find(x => x.id === crewId);
  if (!crew) return '';
  const ahora = Date.now(), r = rango7(ahora);
  const estados = leerCache<EstadoDia[]>(`estado:${crew.id}:${r.desde}:${r.hasta}`);
  if (!estados?.length) return '';
  const filas = saludCrew(crew.miembros.map(m => m.id), estados, ahora).filter(s => s.usuario !== usuario?.id).map(s => {
    const m = crew.miembros.find(x => x.id === s.usuario), d = [...s.dias].reverse().find(x => x.nivel !== 'sin');
    if (!d) return `${m?.nombre.split(/\s+/)[0]}: not shared this week`;
    const e = d.e!, n = [e.suenoH ? `slept ${e.suenoH} h` : '', e.animo ? `mood ${e.animo}/5` : '', e.energia ? `energy ${e.energia}/5` : '', e.recup ? `recovery ${['', 'low', 'normal', 'good'][e.recup]}` : ''].filter(Boolean).join(', ');
    return `${m?.nombre.split(/\s+/)[0]}: ${d.nivel === 'bien' ? 'doing well' : d.nivel === 'atento' ? 'one low signal' : 'several low signals'} (${d.fecha}: ${n})${s.racha >= 2 ? `, ${s.racha} rough days in a row` : ''}`;
  });
  return filas.length ? `Crew wellbeing (only what each one chose to share; never diagnose, be discreet and caring, suggest a kind gesture if someone has rough days): ${filas.join(' | ')}.` : '';
}

/** sus listas (nombres y lo pendiente), para que NOVA use los nombres exactos */
function listasTxt() {
  const ls = leerCache<{ nombre: string; crew: string | null; items: { texto: string; hecho: boolean }[] }[]>('listas');
  if (!ls?.length) return 'Lists: none yet (they can ask you to create one).';
  return `Lists: ${ls.map(l => `"${l.nombre}"${l.crew ? ' (crew)' : ''}: ${l.items.filter(i => !i.hecho).slice(0, 8).map(i => i.texto).join(', ') || 'nothing pending'}`).join(' | ')}.`;
}

/** lo pendiente en GitHub, si conectó su cuenta (lo que haya en caché) */
function githubTxt() {
  const g = leerCache<{ login: string; prs: { titulo: string; repo: string; numero: number }[]; revisar: { titulo: string; repo: string; numero: number }[]; issues: { titulo: string; repo: string; numero: number }[]; hoy: { commits: number; contribuciones?: number } }>('github:resumen');
  if (!g) return '';
  const l = (x: { titulo: string; repo: string; numero: number }[]) => x.slice(0, 5).map(i => `${i.repo}#${i.numero} "${i.titulo}"`).join('; ') || 'none';
  return `GitHub (@${g.login}): reviews requested: ${l(g.revisar)}. Their open PRs: ${l(g.prs)}. Issues assigned: ${l(g.issues)}. Contributions today: ${g.hoy.contribuciones ?? g.hoy.commits} (${g.hoy.commits} commits).`;
}

/** lo último en los repos del equipo (últimas 48 h): deploys, CI y PRs */
function githubCrewTxt() {
  const { crews, crewId } = leerSesion(), crew = crews.find(x => x.id === crewId);
  if (!crew) return '';
  const g = leerCache<{ repos: { repo: string }[]; eventos: { tipo: string; repo: string; titulo: string; detalle: string | null; ts: number }[] }>(`github:crew:${crew.id}`);
  if (!g?.repos.length) return '';
  const recientes = g.eventos.filter(e => Date.now() - e.ts < 48 * 3600e3).slice(0, 10);
  const h = (ts: number) => new Date(ts).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  return `Crew GitHub repos: ${g.repos.map(r => r.repo).join(', ')}. Last 48 h: ${recientes.length ? recientes.map(e => `[${h(e.ts)}] ${e.tipo} ${e.repo.split('/')[1]}: ${e.titulo}${e.detalle ? ` (${e.detalle})` : ''}`).join('; ') : 'nothing new'} (use estado_github for more).`;
}

/** lo pendiente en Todoist, Google Tasks y Linear (si conectó alguno) */
function externasTxt() {
  const x = leerCache<{ tareas: { fuente: string; titulo: string; vence: string | null }[] }>('externas');
  if (!x?.tareas.length) return '';
  return `Tasks in other apps: ${x.tareas.slice(0, 15).map(y => `"${y.titulo}" (${y.fuente}${y.vence ? `, due ${y.vence}` : ''})`).join('; ')}.`;
}

/** su semana en Strava */
function stravaTxt() {
  const s = leerCache<{ actividades: { nombre: string; tipo: string; fecha: string; km: number; min: number; fc: number | null }[]; semana: { n: number; min: number; km: number } }>('strava');
  if (!s) return '';
  return `Strava, last 7 days: ${s.semana.n} activities, ${s.semana.min} min, ${s.semana.km} km. Latest: ${s.actividades.slice(0, 4).map(a => `${a.tipo} "${a.nombre}" ${a.fecha.slice(0, 10)} ${a.min} min${a.km ? ` ${a.km} km` : ''}${a.fc ? ` avg HR ${a.fc}` : ''}`).join('; ') || 'none'}.`;
}

/** su rutina fija (trabajo, reus de siempre, clases…): ya está sumada a la agenda y a los huecos libres */
function rutinaTxt() {
  const { bloques } = leerRutina();
  const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (!bloques.length) return 'Weekly routine: not set yet (if they mention work hours or fixed meetings, save them with agregar_rutina; until then, do not assume the whole day is free).';
  return `Weekly routine (already counted as busy in the calendar and free gaps): ${bloques.map(b => `"${b.titulo}" (${b.tipo}) ${b.dias.map(d => D[d]).join('/')} ${b.ini}-${b.fin}`).join('; ')}.`;
}

/** los recordatorios que vienen (los que pidió a NOVA y los que agregó en la app) */
function recordatoriosTxt() {
  const ahora = Date.now(), l = leerRecordatoriosPropios().lista.filter(r => r.cuando > ahora && !r.hecho).slice(0, 8);
  if (!l.length) return 'Upcoming reminders: none.';
  return `Upcoming reminders (visible in Today → Reminders): ${l.map(r => `${new Date(r.cuando).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })} "${r.texto}"${r.notif ? '' : ' (will NOT ring: notifications off)'}`).join('; ')}.`;
}

/** las metas del equipo con su estado y quién es responsable de cada resultado */
function metasTxt() {
  const { crews, crewId } = leerSesion(), crew = crews.find(x => x.id === crewId);
  if (!crew) return '';
  const metas = leerCache<Meta[]>(`metas:${crew.id}`) ?? [];
  if (!metas.length) return '';
  const quien = (id: string | null) => (id ? crew.miembros.find(m => m.id === id)?.nombre.split(/\s+/)[0] : null) ?? 'nobody';
  return `Crew goals: ${metas.map(m => `"${m.titulo}" due ${m.hasta}, ${Math.round(m.avance * 100)}% (expected ${Math.round(m.esperado * 100)}% by now, ${m.estado}): ${m.resultados.map(r => `${r.titulo} [${r.tipo === 'hito' ? (r.avance >= 1 ? 'done' : 'pending') : `${r.actual}/${r.meta}${r.unidad ? ' ' + r.unidad : ''}`}, owner ${quien(r.responsable)}]`).join('; ')}`).join(' | ')}.`;
}
