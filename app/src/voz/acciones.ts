/* Lo que NOVA puede HACER en la app desde la conversación (herramientas del modelo, perfil «diario»).
   Cada acción hace algo real y devuelve:
   · respuesta: lo que se le contesta al modelo (para que confirme con datos ciertos o diga qué faltó)
   · accion: la tarjetita que aparece en el chat («Hábito marcado: Tomar agua»)
   · ir: una pantalla para abrir después de que NOVA termine de hablar
   Las que necesitan algo nativo nuevo (escribir en el calendario) verifican que exista y, si no, lo dicen. */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { pedir } from '../cuenta/api';
import { NOMBRE_PROV } from '../cuenta/integraciones';
import { agregarItems, borrarItem, buscarBitacora, crearLista, listasAlDia, marcarItem, cambiarResultado, cambiarTarea, escribirBitacora, leerCache, nuevaMeta, nuevaTarea, nuevoReto, type Meta, type Metrica, type Tarea, type TipoBitacora, aCargo, completarExterna, crearExterna, type CargaPersona, type Externa, type GithubCrew } from '../cuenta/datos';
import { leerSesion } from '../cuenta/sesion';
import { configurarAvisos } from '../cuenta/momento';
import { cambiarRecordatorio, cargarRecordatorios, leerRecordatorios } from '../cuenta/recordatorios';
import { publicarStandup } from '../cuenta/standup';
import { escribir, fechaDe, leerDiario } from '../engine/diario';
import { agregarHabito, cuentaDe, leerHabitos, MAX_HABITOS, metaDe, SUGERIDOS, sumar } from '../engine/habitos';
import { crearTarjeta } from '../engine/repaso';
import { olvidar, recordar } from '../engine/memoria';
import { anotar } from '../engine/actividad';
import { borrarRecordatorio, crearRecordatorio, leerRecordatoriosPropios, moverRecordatorio } from '../engine/recordatoriosPropios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { agregarBloque, quitarPorTitulo, type TipoBloque } from '../engine/rutina';
import type { Traductor } from '../i18n';
import { agendaDisponible, leerAgenda } from '../sensores/agenda';
import type { CalendarioGh, ResumenGh, UsuarioGh } from '../cuenta/integraciones';
import { urlRed, type Redes } from '../cuenta/sesion';
import { anotarAlarma } from './alarmas';
import { ejecutarTelefono, HERRAMIENTAS_TELEFONO } from './telefono';

/** abre la app Reloj con una alarma o temporizador ya creados (el módulo llega con el APK 0.4.3) */
function intentLauncher() {
  if (Platform.OS !== 'android' || !requireOptionalNativeModule('ExpoIntentLauncher')) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const IL = require('expo-intent-launcher') as typeof import('expo-intent-launcher');
  return (accion: string, extra: Record<string, unknown>) => IL.startActivityAsync(accion, { extra });
}

/** alguien de la crew por su nombre dicho en voz alta («Luis», «Benja») */
function miembroPorNombre(nombre: string) {
  const { crews, crewId } = leerSesion(), crew = crews.find(c => c.id === crewId);
  return mejor(crew?.miembros ?? [], nombre, m => m.nombre);
}

/** accion.ir: dónde quedó lo que hizo NOVA (se toca en el chat y en /actividad); accion.donde: si vive fuera de la app */
export type Resultado = { respuesta: Record<string, unknown>; accion?: { icono: string; texto: string; ir?: string; donde?: string }; ir?: string; visual?: Visual };
/** cómo se ve en el chat lo que NOVA hizo (src/ui/TarjetasAccion.tsx) */
export type Visual =
  | { tipo: 'alarma'; hora: string; etiqueta?: string }
  | { tipo: 'temporizador'; segundos: number; etiqueta?: string }
  | { tipo: 'recordatorio'; hora: string; dia?: string; texto: string }
  | { tipo: 'tarea'; titulo: string; hecha?: boolean; crew?: boolean; para?: string[]; vence?: string; en?: string; movida?: boolean }
  | { tipo: 'habito'; nombre: string; icono?: string; color?: string; v: number; meta: number; unidad?: string; suma?: number; nuevo?: boolean; recordar?: string[] }
  | { tipo: 'lista'; lista: string; items: string[] }
  | { tipo: 'avisos'; cambios: { nombre: string; on: boolean }[] }
  | { tipo: 'bloque'; titulo: string; desde: string; minutos: number; donde?: string; rutina?: boolean }
  /** el mensaje que NOVA redactó y espera tu confirmación (se lee de telefono.ts: cambia si NOVA lo reescribe) */
  | { tipo: 'mensaje' }
  /** tu GitHub de hoy: commits, contribuciones, la semana y lo pendiente (src/ui/TarjetasGithub.tsx) */
  | { tipo: 'github'; login: string; commits: number; contribuciones: number; semana: number[]; repos: string[]; prs: number; revisar: number; issues: number; que: 'hoy' | 'semana' | 'pendientes' }
  /** el mapa del año: un día por celda */
  | { tipo: 'calendario'; login: string; total: number; desde: string; dias: { fecha: string; n: number }[] }
  /** una persona: sus redes (tocables) y su GitHub */
  | { tipo: 'persona'; nombre: string; foto?: string | null; redes: { red: string; url: string; usuario: string }[]; github?: { login: string; seguidores: number; repos: number; semana: number[]; bio?: string | null; empresa?: string | null; url: string } | null }
  | { tipo: 'foco'; min: number; que?: string }
  | { tipo: 'nota'; icono: string; titulo: string; texto?: string };
const S = (x: unknown) => (x == null ? '' : String(x).trim());
/** arma la tarjeta a partir de lo que la herramienta recibió (a) y devolvió (r) */
function visualDe(nombre: string, a: Record<string, unknown>, r: Resultado, t: Traductor['t']): Visual | undefined {
  const x = r.respuesta, acc = r.accion;
  switch (nombre) {
    case 'poner_alarma': return { tipo: 'alarma', hora: S(x.hora), etiqueta: S(a.etiqueta) || undefined };
    case 'poner_temporizador': return { tipo: 'temporizador', segundos: Math.max(1, Number(x.segundos) || 60), etiqueta: S(a.etiqueta) || undefined };
    case 'recordarme': return { tipo: 'recordatorio', hora: S(x.hora_local), dia: S(x.dia_txt) || undefined, texto: S(a.texto) };
    case 'cambiar_recordatorio': return x.borrado ? { tipo: 'nota', icono: 'trash-outline', titulo: t('Reminder deleted'), texto: S(x.recordatorio) } : { tipo: 'recordatorio', hora: S(x.hora_local), dia: S(x.dia_txt) || undefined, texto: S(x.recordatorio) };
    case 'cambiar_evento': return x.borrado ? { tipo: 'nota', icono: 'trash-outline', titulo: t('Event deleted'), texto: S(x.evento) } : { tipo: 'bloque', titulo: S(x.evento), desde: S(x.inicio), minutos: Number(x.minutos) || 60, donde: S(x.calendario) || undefined };
    case 'crear_tarea': return { tipo: 'tarea', titulo: S(a.titulo), crew: !!a.para_crew, para: (x.para as string[] | undefined)?.map(p => p.split(' ')[0]), vence: S(a.vence) || undefined, en: x.en ? NOMBRE_PROV[x.en as keyof typeof NOMBRE_PROV] : undefined };
    case 'editar_tarea': return { tipo: 'tarea', titulo: S(x.tarea), vence: S(x.vence_txt) || undefined, movida: true };
    case 'completar_tarea': return { tipo: 'tarea', titulo: S(x.tarea), hecha: true, en: x.en ? NOMBRE_PROV[x.en as keyof typeof NOMBRE_PROV] : undefined };
    case 'marcar_habito': return { tipo: 'habito', nombre: S(x.habito), icono: S(x.icono), color: S(x.color), v: Number(x.lleva) || 0, meta: Number(x.meta) || 1, unidad: x.unidad ? t(S(x.unidad)) : undefined, suma: Number(a.cantidad) > 0 ? Number(a.cantidad) : undefined };
    case 'crear_habito': return { tipo: 'habito', nombre: S(x.habito), icono: S(x.icono), color: S(x.color), v: 0, meta: Number(x.meta) || 1, nuevo: true, recordar: x.recordatorios as string[] | undefined };
    case 'agregar_a_lista': return { tipo: 'lista', lista: S(x.lista), items: (x.agregados as string[] | undefined) ?? [] };
    case 'ajustar_avisos': return { tipo: 'avisos', cambios: ((x.nombres as string[] | undefined) ?? []).map(n => ({ nombre: n, on: x.activar !== false })) };
    case 'bloquear_calendario': return { tipo: 'bloque', titulo: S(a.titulo) || t('Focus with Nova'), desde: S(x.inicio), minutos: Number(x.minutos) || 60, donde: S(x.calendario) || undefined };
    case 'escribir_diario': case 'hacer_standup': case 'dar_reconocimiento': case 'hacer_retro': case 'guardar_para_repasar': case 'recordar': case 'crear_meta': case 'crear_reto':
      return acc ? { tipo: 'nota', icono: acc.icono, titulo: acc.texto.length > 46 ? `${acc.texto.slice(0, 44)}…` : acc.texto, texto: S(a.texto ?? a.motivo ?? a.resumen ?? a.dato ?? a.hoy ?? a.bien ?? a.titulo) || undefined } : undefined;
  }
  return undefined;
}
type Ctx = { tr: Traductor; crew: { id: string; nombre: string } | null; tareas: Tarea[]; yo?: string };

/** normaliza para comparar nombres dichos en voz alta con lo guardado */
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
/** el mejor parecido por palabras en común (0..1) */
function parecido(a: string, b: string) {
  const A = new Set(norm(a).split(' ').filter(w => w.length > 2)), B = new Set(norm(b).split(' ').filter(w => w.length > 2));
  if (!A.size || !B.size) return norm(a) === norm(b) ? 1 : 0;
  let c = 0; for (const w of A) if (B.has(w) || [...B].some(x => x.startsWith(w) || w.startsWith(x))) c++;
  return c / Math.min(A.size, B.size);
}
function mejor<T>(lista: T[], texto: string, nombre: (x: T) => string) {
  let m: T | undefined, p = 0;
  for (const x of lista) { const q = parecido(texto, nombre(x)); if (q > p) { p = q; m = x; } }
  return p >= 0.5 ? m : undefined;
}
/* nombres de listas: «la lista de compras» ≠ «Lista de ideas»; sin las palabras de relleno, exacto primero */
const RELLENO = new Set(['lista', 'listas', 'list', 'mi', 'mis', 'la', 'el', 'de', 'del', 'para', 'the', 'my', 'of']);
const nombreLista = (s: string) => norm(s).split(' ').filter(w => !RELLENO.has(w)).join(' ') || norm(s);
function laLista<T extends { nombre: string }>(ls: T[], texto: string) {
  const t = nombreLista(texto);
  return ls.find(x => nombreLista(x.nombre) === t) ?? mejor(ls, t, x => nombreLista(x.nombre));
}
const tituloLista = (s: unknown) => String(s ?? '').trim().replace(/^(la |mi |the |my )?(lista|list)( de| of)? /i, '').slice(0, 40).replace(/^./, c => c.toUpperCase()) || 'Lista';

/** «18:30», «6 pm», «en 20 minutos» → instante; null si no se entiende */
export function cuandoDe(hora?: unknown, minutos?: unknown, ahora = Date.now(), dia?: unknown, fecha?: unknown): number | null {
  const min = Number(minutos);
  if (Number.isFinite(min) && min > 0) return ahora + min * 60e3;
  // un día concreto («el 23 de octubre» → 2026-10-23): ese día, a la hora dicha o a las 9:00
  const f = String(fecha ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (f) {
    const hm = String(hora ?? '').toLowerCase().match(/(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm)?/);
    let h = hm ? Number(hm[1]) : 9; const mm = hm ? Number(hm[2] ?? 0) : 0;
    if (hm?.[3] === 'pm' && h < 12) h += 12;
    if (hm?.[3] === 'am' && h === 12) h = 0;
    if (h > 23 || mm > 59) return null;
    return new Date(Number(f[1]), Number(f[2]) - 1, Number(f[3]), h, mm, 0, 0).getTime();
  }
  const m = String(hora ?? '').toLowerCase().match(/(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm)?/);
  if (!m) return null;
  let h = Number(m[1]); const mm = Number(m[2] ?? 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || mm > 59) return null;
  const d = new Date(ahora); d.setHours(h, mm, 0, 0);
  // «a las 11:40» dicho a las 15:00 sin am/pm: lo más probable es esta noche (23:40), no mañana a mediodía
  if (!m[3] && h >= 1 && h <= 11 && dia !== 'manana' && d.getTime() <= ahora + 30e3) { const pm = new Date(d); pm.setHours(h + 12); if (pm.getTime() > ahora + 30e3) return pm.getTime(); }
  // «mañana» manda; si no dijo el día y la hora ya pasó hoy, es mañana
  if (dia === 'manana' || (dia !== 'hoy' && d.getTime() <= ahora + 30e3)) d.setDate(d.getDate() + 1);
  return d.getTime();
}

const PANTALLAS: Record<string, string> = { github: '/github', acta: '/acta', retro: '/retro', kudos: '/kudos', carga: '/carga', conexiones: '/crew-conexiones', bitacora_crew: '/journal?vista=crew', standup: '/standup', foco: '/foco', habitos: '/habitos', repaso: '/repaso', resumen: '/resumen', crew: '/crew', cuerpo: '/salud?seg=cuerpo', mente: '/salud?seg=mente', diario: '/journal', compartir: '/compartir', permisos: '/permisos', datos: '/datos', recordatorios: '/recordatorios', rutina: '/rutina', actividad: '/actividad', memoria: '/memoria', mapa: '/mapa', salud_crew: '/crew-salud', metas: '/crew', tu: '/perfil', hoy: '/', integraciones: '/integraciones', habito: '/habitos', ajustes: '/ajustes', manana: '/buenosdias', listas: '/listas', nota: '/nota' };

/** dónde queda lo que hace cada herramienta (para el chat y el registro de actividad) */
const DESTINO: Record<string, (a: Record<string, unknown>) => string | undefined> = {
  marcar_habito: () => '/habitos', crear_habito: () => '/habitos', completar_tarea: () => '/', crear_tarea: a => (a.para_crew ? '/crew' : '/'),
  recordarme: () => '/recordatorios', cambiar_recordatorio: () => '/recordatorios', bloquear_calendario: () => '/', cambiar_evento: () => '/', crear_reto: () => '/crew', crear_meta: () => '/crew', actualizar_resultado: () => '/crew',
  escribir_diario: a => (a.para_crew ? '/journal?vista=crew' : '/journal'), hacer_standup: () => '/journal?vista=crew', guardar_para_repasar: () => '/repaso',
  agregar_a_lista: () => '/listas', marcar_en_lista: () => '/listas', crear_lista: () => '/listas', quitar_de_lista: () => '/listas',
  dar_reconocimiento: () => '/journal?vista=crew', hacer_retro: () => '/retro',
  recordar: () => '/memoria', olvidar: () => '/memoria', agregar_rutina: () => '/rutina', quitar_rutina: () => '/rutina',
};

/** ejecuta la herramienta y anota lo hecho en «Lo que hizo NOVA», con el lugar donde quedó */
export async function ejecutar(nombre: string, a: Record<string, unknown>, ctx: Ctx): Promise<(Resultado & { fuera?: boolean }) | null> {
  // lo del teléfono (música, cámara, apps…) no se anota en «Lo que hizo NOVA»: pasa y ya
  if (HERRAMIENTAS_TELEFONO.has(nombre)) return ejecutarTelefono(nombre, a, ctx.tr.t);
  const r = await ejecutarUna(nombre, a, ctx);
  if (r && r.respuesta.ok !== false) r.visual ??= visualDe(nombre, a, r, ctx.tr.t);
  if (r?.accion) {
    r.accion.ir ??= DESTINO[nombre]?.(a);
    if (nombre === 'poner_alarma' || nombre === 'poner_temporizador') r.accion.donde = ctx.tr.t('In the phone Clock app');
    anotar({ icono: r.accion.icono, texto: r.accion.texto, ir: r.accion.ir, donde: r.accion.donde });
  }
  return r;
}

/** el día dicho de vuelta: '' hoy, «mañana», o la fecha («jueves 23 oct») */
function diaTxt(ts: number, t: Traductor['t'], locale: string) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const d = Math.round((new Date(ts).setHours(0, 0, 0, 0) - hoy.getTime()) / 864e5);
  return d === 0 ? '' : d === 1 ? t('tomorrow') : new Date(ts).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
}

/* el calendario donde NOVA escribe: el PERSONAL (el principal de tu cuenta), nunca uno compartido como el de un
   equipo, salvo que lo nombres. En Android el principal de Google tiene título = correo de la cuenta. */
type CalMod = typeof import('expo-calendar');
type Cal = Awaited<ReturnType<CalMod['getCalendars']>>[number];
function elegirCalendario(cals: Cal[], nombre?: string) {
  const escribibles = cals.filter(c => c.allowsModifications);
  if (nombre) { const n = mejor(escribibles, nombre, c => `${c.title} ${c.source?.name ?? ''}`); if (n) return n; }
  const puntaje = (c: Cal) =>
    (c.isPrimary ? 8 : 0) + (c.ownerAccount && c.title === c.ownerAccount ? 6 : 0) + (c.ownerAccount && c.source?.name === c.ownerAccount ? 2 : 0) +
    (c.accessLevel === 'owner' ? 2 : 0) + (c.source?.isLocalAccount ? -1 : 0) + (/holiday|feriad|birthday|cumplea|crew|team|equipo/i.test(c.title) ? -10 : 0);
  return [...escribibles].sort((p, q) => puntaje(q) - puntaje(p))[0];
}
/* eventos que creó NOVA (para moverlos o borrarlos después aunque el calendario los renombre) */
const CLAVE_EVENTOS = 'nova.eventos.creados';
type EvNova = { id: string; titulo: string; ini: number };
async function eventosNova(): Promise<EvNova[]> { try { return JSON.parse((await AsyncStorage.getItem(CLAVE_EVENTOS)) ?? '[]'); } catch { return []; } }
async function guardarEventosNova(l: EvNova[]) { await AsyncStorage.setItem(CLAVE_EVENTOS, JSON.stringify(l.filter(e => e.ini > Date.now() - 30 * 864e5).slice(-80))).catch(() => {}); }

async function ejecutarUna(nombre: string, a: Record<string, unknown>, { tr, crew, tareas, yo }: Ctx): Promise<Resultado | null> {
  const { t, locale } = tr;
  const hora = (ts: number) => new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  switch (nombre) {
    case 'marcar_habito': {
      const { habitos } = leerHabitos(), hoy = fechaDe(Date.now());
      const h = mejor(habitos, String(a.nombre ?? ''), x => `${x.nombre} ${t(x.nombre)}`);
      if (!h) return { respuesta: { ok: false, motivo: 'no such habit', habitos: habitos.map(x => t(x.nombre)) } };
      const meta = metaDe(h), cant = Number(a.cantidad);
      // con cantidad suma eso; sin cantidad, lo deja cumplido (completa lo que falte)
      sumar(h.id, Number.isFinite(cant) && cant > 0 ? cant : Math.max(0, meta - cuentaDe(h, hoy)), hoy);
      const v = cuentaDe(h, fechaDe(Date.now())), u = h.unidad ? t(h.unidad) : '';
      return { respuesta: { ok: true, habito: t(h.nombre), lleva: v, meta, unidad: h.unidad ?? null, cumplido: v >= meta, icono: h.icono, color: h.color }, accion: { icono: 'checkmark-circle', texto: meta > 1 ? t('{x}: {v} of {m} {u}', { x: t(h.nombre), v, m: meta, u }) : t('Habit done: {x}', { x: t(h.nombre) }), ir: `/habito?id=${h.id}` } };
    }
    case 'crear_habito': {
      const texto = String(a.nombre ?? '').trim();
      if (!texto) return { respuesta: { ok: false } };
      if (leerHabitos().habitos.length >= MAX_HABITOS) return { respuesta: { ok: false, motivo: `already ${MAX_HABITOS} habits, the maximum` } };
      const sug = mejor(SUGERIDOS, texto, x => `${x.nombre} ${t(x.nombre)}`);
      const MAPA: Record<string, number> = { dom: 0, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6 };
      const dias = Array.isArray(a.dias) ? a.dias.map(d => MAPA[norm(String(d)).slice(0, 3)]).filter((d): d is number => d !== undefined) : undefined;
      const recordarH = Array.isArray(a.recordar) ? a.recordar.map(x => String(x).match(/^(\d{1,2})[:.h]?(\d{2})?/)).filter(Boolean).map(m => `${m![1].padStart(2, '0')}:${m![2] ?? '00'}`) : undefined;
      const meta = Number(a.meta);
      if (Platform.OS !== 'web' && recordarH?.length) await configurarAvisos();
      const nuevo = agregarHabito({
        ...(sug ?? { nombre: texto.slice(0, 40), icono: 'star-outline', color: '#8fe6f5' }),
        ...(Number.isFinite(meta) && meta > 1 ? { meta: Math.round(meta), paso: meta >= 20 ? 5 : 1, unidad: String(a.unidad ?? '').slice(0, 12) || undefined } : {}),
        ...(dias?.length ? { dias } : {}), ...(recordarH?.length ? { recordar: recordarH } : {}),
      });
      if (!nuevo) return { respuesta: { ok: false, motivo: 'already exists' } };
      const n = t(nuevo.nombre);
      return { respuesta: { ok: true, habito: n, meta: nuevo.meta ?? 1, recordatorios: nuevo.recordar ?? [], icono: nuevo.icono, color: nuevo.color }, accion: { icono: 'repeat', texto: t('New habit: {x}', { x: n }), ir: `/habito?id=${nuevo.id}` } };
    }
    case 'completar_tarea': {
      const abiertas = tareas.filter(x => !x.hecha && (!x.crew || !aCargo(x).length || aCargo(x).includes(yo ?? '')));
      const ta = mejor(abiertas, String(a.titulo ?? ''), x => x.titulo);
      if (!ta) {
        // ¿es de Todoist, Google Tasks o Linear?
        const ext = (await pedir<{ tareas: Externa[] }>('/v1/externas').catch(() => ({ tareas: [] as Externa[] }))).tareas;
        const te = mejor(ext, String(a.titulo ?? ''), x => x.titulo);
        if (te) { await completarExterna(te); return { respuesta: { ok: true, tarea: te.titulo, en: te.fuente }, accion: { icono: 'checkmark-done', texto: t('Done in {x}: {t}', { x: NOMBRE_PROV[te.fuente], t: te.titulo }), donde: NOMBRE_PROV[te.fuente] } }; }
        return { respuesta: { ok: false, motivo: 'no matching open task', abiertas: [...abiertas.slice(0, 10).map(x => x.titulo), ...ext.slice(0, 6).map(x => `${x.titulo} (${x.fuente})`)] } };
      }
      await cambiarTarea(ta.id, { hecha: true }).catch(() => {});
      return { respuesta: { ok: true, tarea: ta.titulo }, accion: { icono: 'checkmark-done', texto: t('Done: {x}', { x: ta.titulo }) } };
    }
    case 'recordarme': {
      const cuando = cuandoDe(a.hora, a.en_minutos, Date.now(), a.dia, a.fecha);
      const texto = String(a.texto ?? '').trim();
      if (!texto || !cuando) return { respuesta: { ok: false, motivo: 'need what and when (HH:MM, a date YYYY-MM-DD or minutes from now)' } };
      if (cuando <= Date.now()) return { respuesta: { ok: false, motivo: 'that time already passed' } };
      // queda guardado y visible (Hoy y /recordatorios) aunque los avisos estén apagados
      if (Platform.OS !== 'web') await configurarAvisos();
      const { suena } = await crearRecordatorio(texto, cuando, 'nova', t('Reminder'));
      const dt = diaTxt(cuando, t, locale), dia = dt ? `${dt} ` : '';
      return {
        respuesta: { ok: true, hora_local: hora(cuando), dia_txt: dt, cuando: new Date(cuando).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }), visible_en: 'Today screen → Reminders', ...(suena ? {} : { aviso: 'saved, but notifications are off so it will not ring: tell them to turn notifications on in You → Permissions' }) },
        accion: { icono: 'alarm-outline', texto: t('Reminder {d}{h}: {x}', { d: dia, h: hora(cuando), x: texto }) + (suena ? '' : ` · ${t('notifications off')}`) },
      };
    }
    case 'bloquear_calendario': {
      // con fecha y sin hora (o todo_el_dia): evento de día completo ese día
      const todoDia = !!a.todo_el_dia || (!!S(a.fecha) && !S(a.hora));
      const ini = cuandoDe(todoDia ? '00:00' : a.hora, undefined, Date.now(), a.dia, a.fecha), min = todoDia ? 1440 : Math.max(10, Math.min(480, Math.round(Number(a.minutos) || 60)));
      const titulo = String(a.titulo ?? '').trim() || t('Focus with Nova');
      if (!ini) return { respuesta: { ok: false, motivo: 'need a start time HH:MM or a date YYYY-MM-DD' } };
      if (!agendaDisponible()) return { respuesta: { ok: false, motivo: 'calendar access needs the newer app version (0.4.1)' } };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const C = require('expo-calendar') as typeof import('expo-calendar');
      const p = await C.requestCalendarPermissions().catch(() => null);
      if (!p?.granted) return { respuesta: { ok: false, motivo: 'calendar permission denied' } };
      const cal = elegirCalendario(await C.getCalendars(C.EntityTypes.EVENT), S(a.calendario) || undefined);
      if (!cal) return { respuesta: { ok: false, motivo: 'no writable calendar on this phone' } };
      const ev = await cal.createEvent({ title: titulo, startDate: new Date(ini), endDate: new Date(ini + min * 60e3), allDay: todoDia, notes: t('Created by Nova') });
      await guardarEventosNova([...(await eventosNova()), { id: ev.id, titulo, ini }]);
      leerAgenda();
      const dt = diaTxt(ini, t, locale), cuando = todoDia ? (dt || t('today')) : `${dt ? `${dt} ` : ''}${hora(ini)}–${hora(ini + min * 60e3)}`;
      return {
        respuesta: { ok: true, fecha: fechaDe(ini), dia_txt: dt, inicio: todoDia ? 'all day' : hora(ini), minutos: min, calendario: cal.title, cuenta: cal.source?.name },
        accion: { icono: 'calendar', texto: t('In your calendar ({c}): {x}, {w}', { c: cal.title, x: titulo, w: cuando }) },
      };
    }
    case 'cambiar_recordatorio': {
      // mover o borrar un recordatorio que ya existe (los de NOVA y los tuyos)
      const pendientes = leerRecordatoriosPropios().lista.filter(x => !x.hecho);
      const r = mejor(pendientes, S(a.recordatorio), x => x.texto);
      if (!r) return { respuesta: { ok: false, motivo: 'no matching reminder', pendientes: pendientes.slice(0, 10).map(x => `${x.texto} (${new Date(x.cuando).toLocaleString('en-GB')})`) } };
      if (a.borrar) { await borrarRecordatorio(r.id); return { respuesta: { ok: true, borrado: true, recordatorio: r.texto }, accion: { icono: 'trash-outline', texto: t('Reminder deleted: {x}', { x: r.texto }) } }; }
      const ant = new Date(r.cuando);
      const cuando = cuandoDe(S(a.hora) || `${ant.getHours()}:${String(ant.getMinutes()).padStart(2, '0')}`, a.en_minutos, Date.now(), a.dia, S(a.fecha) || (S(a.hora) ? undefined : fechaDe(r.cuando)));
      if (!cuando || cuando <= Date.now()) return { respuesta: { ok: false, motivo: 'need a new future date (YYYY-MM-DD) and/or time' } };
      await moverRecordatorio(r.id, cuando, t('Reminder'));
      const dt = diaTxt(cuando, t, locale);
      return { respuesta: { ok: true, recordatorio: r.texto, hora_local: hora(cuando), dia_txt: dt, cuando: new Date(cuando).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false }) }, accion: { icono: 'alarm-outline', texto: t('Reminder {d}{h}: {x}', { d: dt ? `${dt} ` : '', h: hora(cuando), x: r.texto }) } };
    }
    case 'cambiar_evento': {
      // mover o borrar un evento del calendario: primero los que creó NOVA, si no, cualquiera editable de los próximos 4 meses
      if (!agendaDisponible()) return { respuesta: { ok: false, motivo: 'calendar access needs the newer app version (0.4.1)' } };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const C = require('expo-calendar') as typeof import('expo-calendar');
      const p = await C.requestCalendarPermissions().catch(() => null);
      if (!p?.granted) return { respuesta: { ok: false, motivo: 'calendar permission denied' } };
      const cals = (await C.getCalendars(C.EntityTypes.EVENT)).filter(c => c.allowsModifications);
      const desde = new Date(Date.now() - 2 * 864e5), hasta = new Date(Date.now() + 120 * 864e5);
      const todos = (await C.listEvents(cals, desde, hasta)).filter(e => e.status !== C.EventStatus.CANCELED);
      const propios = new Set((await eventosNova()).map(e => e.id));
      const de = todos.filter(e => propios.has(e.id) || /by Nova|por Nova/i.test(e.notes ?? ''));
      const ev = mejor(de, S(a.evento), e => e.title ?? '') ?? mejor(todos.filter(e => !e.recurrenceRule), S(a.evento), e => e.title ?? '');
      if (!ev) return { respuesta: { ok: false, motivo: 'no matching event', creados_por_nova: de.slice(0, 8).map(e => `${e.title} (${new Date(e.startDate).toLocaleString('en-GB')})`) } };
      const calNombre = cals.find(c => c.id === ev.calendarId)?.title;
      if (a.borrar) {
        await ev.delete();
        await guardarEventosNova((await eventosNova()).filter(e => e.id !== ev.id));
        leerAgenda();
        return { respuesta: { ok: true, borrado: true, evento: ev.title, calendario: calNombre }, accion: { icono: 'trash-outline', texto: t('Deleted from your calendar: {x}', { x: ev.title ?? '' }) } };
      }
      const iniAnt = new Date(ev.startDate), dur = +new Date(ev.endDate) - +iniAnt;
      const todoDia = a.todo_el_dia != null ? !!a.todo_el_dia : !!ev.allDay && !S(a.hora);
      const ini = cuandoDe(todoDia ? '00:00' : S(a.hora) || `${iniAnt.getHours()}:${String(iniAnt.getMinutes()).padStart(2, '0')}`, undefined, Date.now(), a.dia, S(a.fecha) || fechaDe(+iniAnt));
      if (!ini) return { respuesta: { ok: false, motivo: 'need a new date YYYY-MM-DD and/or time' } };
      const min = todoDia ? 1440 : Number(a.minutos) > 0 ? Math.round(Number(a.minutos)) : Math.round(dur / 60e3) || 60;
      await ev.update({ startDate: new Date(ini), endDate: new Date(ini + min * 60e3), allDay: todoDia });
      leerAgenda();
      const dt = diaTxt(ini, t, locale);
      return { respuesta: { ok: true, evento: ev.title, fecha: fechaDe(ini), inicio: todoDia ? 'all day' : hora(ini), minutos: min, calendario: calNombre }, accion: { icono: 'calendar', texto: t('Moved in your calendar: {x}, {w}', { x: ev.title ?? '', w: todoDia ? (dt || t('today')) : `${dt ? `${dt} ` : ''}${hora(ini)}` }) } };
    }
    case 'crear_reto': {
      if (!crew) return { respuesta: { ok: false, motivo: 'not in a crew' } };
      const metricas: Metrica[] = ['pasos', 'focoMin', 'aprendizajeMin', 'ejercicioMin', 'fotos', 'tareas'];
      const metrica = metricas.includes(a.metrica as Metrica) ? (a.metrica as Metrica) : 'pasos';
      const meta = Math.max(1, Math.round(Number(a.meta) || 0)), dias = Math.max(1, Math.min(60, Math.round(Number(a.dias) || 7)));
      const titulo = String(a.titulo ?? '').trim() || t('{n} together', { n: meta.toLocaleString(locale) });
      if (!meta) return { respuesta: { ok: false, motivo: 'need a goal number' } };
      await nuevoReto(crew.id, { titulo, metrica, meta, dias });
      return { respuesta: { ok: true }, accion: { icono: 'trophy-outline', texto: t('New challenge in {crew}: {x}', { crew: crew.nombre, x: titulo }) } };
    }
    case 'escribir_diario': {
      const texto = String(a.texto ?? '').trim();
      if (!texto) return { respuesta: { ok: false } };
      // a la bitácora del equipo (todos la ven) o a la personal (privada, en el teléfono)
      if (a.para_crew) {
        if (!crew) return { respuesta: { ok: false, motivo: 'not in a crew' } };
        const tipos: TipoBitacora[] = ['nota', 'avance', 'problema', 'decision'];
        const tipo = tipos.includes(a.tipo as TipoBitacora) ? (a.tipo as TipoBitacora) : 'nota';
        await escribirBitacora(crew.id, texto, tipo);
        return { respuesta: { ok: true, bitacora: 'crew', tipo }, accion: { icono: 'people-outline', texto: t('In the {crew} log: {x}', { crew: crew.nombre, x: texto.length > 60 ? `${texto.slice(0, 57)}…` : texto }) } };
      }
      const animo = Math.max(0, Math.min(4, Math.round(Number(a.animo ?? 2))));
      escribir({ texto, animo, etiquetas: [], compartir: false });
      return { respuesta: { ok: true, bitacora: 'personal' }, accion: { icono: 'book-outline', texto: t('Saved in your personal log') } };
    }
    case 'poner_alarma': {
      // una alarma de verdad en la app Reloj de Android (suena aunque el teléfono esté en silencio)
      const m = String(a.hora ?? '').match(/(\d{1,2})[:.h]?(\d{2})?/);
      if (!m) return { respuesta: { ok: false, motivo: 'need a time HH:MM' } };
      const hh = Math.min(23, Number(m[1])), mm = Math.min(59, Number(m[2] ?? 0));
      const lanzar = intentLauncher();
      if (!lanzar) return { respuesta: { ok: false, motivo: 'alarms need the newer app version (0.4.3)' } };
      await lanzar('android.intent.action.SET_ALARM', { 'android.intent.extra.alarm.HOUR': hh, 'android.intent.extra.alarm.MINUTES': mm, 'android.intent.extra.alarm.MESSAGE': String(a.etiqueta ?? 'NOVA'), 'android.intent.extra.alarm.SKIP_UI': true });
      const hTxt = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      // NOVA recuerda las alarmas que pone, para poder quitarlas por su nombre después
      anotarAlarma({ hora: hTxt, etiqueta: S(a.etiqueta) || undefined }).catch(() => {});
      return { respuesta: { ok: true, hora: hTxt, etiqueta: S(a.etiqueta) || undefined }, accion: { icono: 'alarm', texto: t('Alarm set for {h}', { h: hTxt }) + (a.etiqueta ? ` · ${a.etiqueta}` : '') } };
    }
    case 'poner_temporizador': {
      const seg = Math.round((Number(a.minutos) || 0) * 60 + (Number(a.segundos) || 0));
      if (seg < 5) return { respuesta: { ok: false, motivo: 'need a duration' } };
      const lanzar = intentLauncher();
      if (!lanzar) return { respuesta: { ok: false, motivo: 'timers need the newer app version (0.4.3)' } };
      await lanzar('android.intent.action.SET_TIMER', { 'android.intent.extra.alarm.LENGTH': seg, 'android.intent.extra.alarm.MESSAGE': String(a.etiqueta ?? 'NOVA'), 'android.intent.extra.alarm.SKIP_UI': true });
      return { respuesta: { ok: true, segundos: seg }, accion: { icono: 'timer-outline', texto: t('Timer: {x}', { x: seg >= 60 ? `${Math.round(seg / 60)} min` : `${seg} s` }) + (a.etiqueta ? ` · ${a.etiqueta}` : '') } };
    }
    case 'crear_meta': {
      if (!crew) return { respuesta: { ok: false, motivo: 'not in a crew' } };
      const titulo = String(a.titulo ?? '').trim();
      if (!titulo) return { respuesta: { ok: false, motivo: 'need the objective' } };
      const dias = Math.max(3, Math.min(365, Math.round(Number(a.dias) || 30)));
      const hasta = typeof a.hasta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.hasta) ? a.hasta : fechaDe(Date.now() + dias * 864e5);
      const rs = (Array.isArray(a.resultados) ? a.resultados : []).slice(0, 6).map((r: Record<string, unknown>) => {
        const quien = r.responsable ? miembroPorNombre(String(r.responsable)) : undefined;
        const numero = Number(r.meta) > 1;
        return { titulo: String(r.titulo ?? '').trim(), tipo: numero ? 'numero' as const : 'hito' as const, meta: numero ? Number(r.meta) : undefined, unidad: r.unidad ? String(r.unidad) : null, responsable: quien?.id ?? null };
      }).filter((r: { titulo: string }) => r.titulo);
      const m = await nuevaMeta(crew.id, { titulo, hasta, resultados: rs });
      return { respuesta: { ok: true, resultados: m.resultados.length, hasta }, accion: { icono: 'flag-outline', texto: t('New goal for {crew}: {x}', { crew: crew.nombre, x: titulo }) } };
    }
    case 'actualizar_resultado': {
      if (!crew) return { respuesta: { ok: false, motivo: 'not in a crew' } };
      const metas = leerCache<Meta[]>(`metas:${crew.id}`) ?? [];
      const todos = metas.flatMap(m => m.resultados.map(r => ({ ...r, meta: m })));
      const r = mejor(todos, String(a.resultado ?? ''), x => `${x.titulo} ${x.meta.titulo}`);
      if (!r) return { respuesta: { ok: false, motivo: 'no matching key result', resultados: todos.map(x => x.titulo).slice(0, 12) } };
      const c = a.hecho != null ? { hecho: !!a.hecho } : a.sumar != null ? { sumar: Number(a.sumar) } : a.valor != null ? { actual: Number(a.valor) } : r.tipo === 'hito' ? { hecho: true } : { sumar: 1 };
      await cambiarResultado(r.id, c);
      return { respuesta: { ok: true, resultado: r.titulo }, accion: { icono: 'flag', texto: t('Updated: {x}', { x: r.titulo }) } };
    }
    case 'recordar': {
      const tipos = ['meta', 'gusto', 'persona', 'rutina', 'salud', 'otro'] as const;
      const r = recordar(String(a.dato ?? ''), tipos.includes(a.tipo as never) ? (a.tipo as (typeof tipos)[number]) : 'otro');
      return r ? { respuesta: { ok: true }, accion: { icono: 'bookmark-outline', texto: t('Nova will remember: {x}', { x: r.texto }) } } : { respuesta: { ok: false } };
    }
    case 'olvidar': {
      const n = olvidar(String(a.dato ?? ''));
      return { respuesta: { ok: n > 0, olvidados: n }, accion: n ? { icono: 'trash-outline', texto: t('Forgotten') } : undefined };
    }
    case 'agregar_a_lista': {
      const items = (Array.isArray(a.items) ? a.items : String(a.items ?? '').split(',')).map(x => String(x).trim()).filter(Boolean);
      if (!items.length) return { respuesta: { ok: false, motivo: 'no items' } };
      const listas = await listasAlDia();
      let l = laLista(listas, String(a.lista ?? ''));
      if (!l) l = await crearLista(tituloLista(a.lista), 'list-outline', a.para_crew && crew ? crew.id : null);
      await agregarItems(l.id, items);
      return { respuesta: { ok: true, lista: l.nombre, agregados: items, visible_en: 'Your things → Lists' }, accion: { icono: 'list-outline', texto: t('{l}: + {x}', { l: l.nombre, x: items.join(', ') }), ir: `/lista?id=${l.id}` } };
    }
    case 'crear_lista': {
      const listas = await listasAlDia(), ya = laLista(listas, String(a.nombre ?? ''));
      const items = (Array.isArray(a.items) ? a.items : []).map(x => String(x).trim()).filter(Boolean);
      const l = ya && nombreLista(ya.nombre) === nombreLista(String(a.nombre ?? '')) ? ya : await crearLista(tituloLista(a.nombre), 'list-outline', a.para_crew && crew ? crew.id : null);
      if (items.length) await agregarItems(l.id, items);
      return { respuesta: { ok: true, lista: l.nombre, ya_existia: l === ya, agregados: items, visible_en: 'Your things → Lists' }, accion: { icono: 'list-outline', texto: t('{l}: + {x}', { l: l.nombre, x: items.join(', ') }), ir: `/lista?id=${l.id}` } };
    }
    case 'quitar_de_lista': {
      const listas = await listasAlDia();
      const l = laLista(listas, String(a.lista ?? ''));
      const it = l ? mejor(l.items, String(a.item ?? ''), x => x.texto) : null;
      if (!l || !it) return { respuesta: { ok: false, motivo: l ? 'no such item' : 'no such list', items: l?.items.map(i => i.texto) } };
      await borrarItem(l.id, it.id);
      return { respuesta: { ok: true, lista: l.nombre, quitado: it.texto }, accion: { icono: 'trash-outline', texto: `${l.nombre}: − ${it.texto}`, ir: `/lista?id=${l.id}` } };
    }
    case 'leer_lista': {
      const listas = await listasAlDia();
      const l = laLista(listas, String(a.lista ?? ''));
      if (!l) return { respuesta: { ok: false, motivo: 'no such list', listas: listas.map(x => x.nombre) } };
      return { respuesta: { ok: true, lista: l.nombre, pendientes: l.items.filter(i => !i.hecho).map(i => i.texto), hechos: l.items.filter(i => i.hecho).length }, ir: `/lista?id=${l.id}` };
    }
    case 'marcar_en_lista': {
      const listas = await listasAlDia();
      const l = laLista(listas, String(a.lista ?? ''));
      const it = l ? mejor(l.items, String(a.item ?? ''), x => x.texto) : null;
      if (!l || !it) return { respuesta: { ok: false, motivo: l ? 'no such item' : 'no such list', items: l?.items.map(i => i.texto) } };
      await marcarItem(l.id, it.id, a.hecho !== false);
      return { respuesta: { ok: true }, accion: { icono: 'checkmark-circle', texto: t('{l}: ✓ {x}', { l: l.nombre, x: it.texto }), ir: `/lista?id=${l.id}` } };
    }
    case 'agregar_rutina': {
      const MAPA: Record<string, number> = { dom: 0, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6 };
      const dias = (Array.isArray(a.dias) ? a.dias : String(a.dias ?? '').split(/[,\s]+/)).map(d => MAPA[norm(String(d)).slice(0, 3)]).filter((d): d is number => d !== undefined);
      const tipos: TipoBloque[] = ['trabajo', 'reunion', 'clase', 'ejercicio', 'traslado', 'otro'];
      const b = agregarBloque({ titulo: String(a.titulo ?? ''), tipo: tipos.includes(a.tipo as TipoBloque) ? (a.tipo as TipoBloque) : 'otro', dias, ini: String(a.inicio ?? ''), fin: String(a.fin ?? '') });
      if (!b) return { respuesta: { ok: false, motivo: 'need days and start/end as HH:MM' } };
      return { respuesta: { ok: true, guardado: `${b.titulo} ${b.ini}-${b.fin}`, visible_en: 'Today → Your schedule → Routine' }, accion: { icono: 'repeat', texto: t('Routine: {x} {a}–{b}', { x: b.titulo, a: b.ini, b: b.fin }) } };
    }
    case 'quitar_rutina': {
      const n = quitarPorTitulo(String(a.titulo ?? ''));
      return n ? { respuesta: { ok: true, quitados: n }, accion: { icono: 'remove-circle-outline', texto: t('Removed from your routine: {x}', { x: String(a.titulo) }) } } : { respuesta: { ok: false, motivo: 'no block with that name' } };
    }
    case 'buscar_bitacora': {
      // la persona va aparte (filtra por autor); sus nombres no se buscan como palabras del texto
      const ms0 = crew ? leerSesion().crews.find(c => c.id === crew.id)?.miembros ?? [] : [];
      const autor = a.quien ? miembroPorNombre(String(a.quien)) : undefined;
      const nombres = new Set(ms0.flatMap(m => norm(m.nombre).split(' ')));
      const q = norm(String(a.q ?? '')).split(' ').filter(w => w.length > 1 && ![...nombres].some(n => n.startsWith(w) || w.startsWith(n))).join(' ');
      if (q.length < 2 && !autor) return { respuesta: { ok: false, motivo: 'need words to search' } };
      const palabras = norm(q).split(/\s+/).filter(w => w.length > 1);
      const dia = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      // lo personal, solo si dejaste que NOVA lea tu diario
      const personal = !leerDiario().novaLee ? [] : leerDiario().entradas.filter(e => palabras.some(w => norm(e.texto).includes(w))).slice(0, 5).map(e => ({ cuando: dia(e.ts), texto: e.texto.slice(0, 300) }));
      let crewR: { quien: string; cuando: string; tipo: string; texto: string }[] = [];
      if (crew) {
        const ms = leerSesion().crews.find(c => c.id === crew.id)?.miembros ?? [];
        const quien = (id: string | null) => (id ? ms.find(m => m.id === id)?.nombre.split(/\s+/)[0] : 'anónimo') ?? '?';
        const l = await buscarBitacora(crew.id, q || ' ', autor?.id).catch(() => []);
        crewR = l.slice(0, 8).map(e => ({ quien: e.tipo === 'resumen' ? 'NOVA' : quien(e.usuario), cuando: dia(e.ts), tipo: e.tipo, texto: [e.texto, e.audio?.transcripcion ? `(voice note) ${e.audio.transcripcion}` : ''].filter(Boolean).join(' ').slice(0, 400) }));
      }
      return { respuesta: { ok: true, crew: crewR, personal } };
    }
    case 'hacer_standup': {
      if (!crew) return { respuesta: { ok: false, motivo: 'not in a crew' } };
      const hoy = String(a.hoy ?? '').trim();
      if (!hoy) return { respuesta: { ok: false, motivo: 'need at least what they will do today' } };
      await publicarStandup(crew.id, { ayer: String(a.ayer ?? ''), hoy, bloqueo: a.bloqueo ? String(a.bloqueo) : undefined });
      return { respuesta: { ok: true }, accion: { icono: 'chatbubbles-outline', texto: t('Standup posted to {crew}', { crew: crew.nombre }) } };
    }
    case 'guardar_para_repasar': {
      const tema = String(a.tema ?? '').trim(), nota = String(a.nota ?? '').trim();
      if (!tema || !nota) return { respuesta: { ok: false } };
      await crearTarjeta(tema, nota);
      return { respuesta: { ok: true, primer_repaso: 'tomorrow 19:00' }, accion: { icono: 'school-outline', texto: t('Saved to review: {x}', { x: tema }) } };
    }
    case 'abrir': {
      const ruta = PANTALLAS[String(a.pantalla ?? '')];
      return ruta ? { respuesta: { ok: true }, ir: ruta } : { respuesta: { ok: false } };
    }
    case 'crear_tarea': {
      const titulo = String(a.titulo ?? '').trim();
      if (!titulo) return { respuesta: { ok: false } };
      const vence = typeof a.vence === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.vence) ? a.vence : a.para_hoy ? fechaDe(Date.now()) : null;
      const destino = String(a.destino ?? 'nova');
      if (destino === 'todoist' || destino === 'google' || destino === 'linear') {
        try { await crearExterna(destino, titulo, vence); } catch (e) { return { respuesta: { ok: false, motivo: (e as Error).message } }; }
        return { respuesta: { ok: true, en: destino }, accion: { icono: 'checkmark-circle', texto: t('Added to {x}: {t}', { x: NOMBRE_PROV[destino], t: titulo }), donde: NOMBRE_PROV[destino] } };
      }
      const nombres = Array.isArray(a.para) ? a.para.map(String) : [];
      const gente = nombres.map(miembroPorNombre).filter((m): m is NonNullable<typeof m> => !!m);
      const faltan = nombres.filter(n => !miembroPorNombre(n));
      const deCrew = !!crew && (!!a.para_crew || gente.length > 0);
      const enlace = typeof a.enlace === 'string' && /^https?:\/\//.test(a.enlace) ? a.enlace : undefined;
      await nuevaTarea({ titulo, crew: deCrew ? crew!.id : null, vence, asignados: deCrew ? gente.map(m => m.id) : undefined, enlaces: enlace ? [enlace] : undefined });
      return { respuesta: { ok: true, para: gente.map(m => m.nombre), ...(faltan.length ? { no_encontrados: faltan } : {}) }, accion: { icono: 'checkmark-circle', texto: deCrew ? (gente.length ? t('Added to {crew} for {p}: {t}', { t: titulo, crew: crew!.nombre, p: gente.map(m => m.nombre.split(' ')[0]).join(', ') }) : t('Added to {crew}: {t}', { t: titulo, crew: crew!.nombre })) : t('Added to your tasks: {t}', { t: titulo }) } };
    }
    case 'asignar_tarea': {
      const deCrew = tareas.filter(x => !x.hecha && x.crew);
      const ta = mejor(deCrew, String(a.tarea ?? ''), x => x.titulo);
      if (!ta) return { respuesta: { ok: false, motivo: 'no matching crew task', abiertas: deCrew.slice(0, 10).map(x => x.titulo) } };
      const mas = (Array.isArray(a.agregar) ? a.agregar : []).map(n => miembroPorNombre(String(n))).filter(Boolean).map(m => m!.id);
      const menos = (Array.isArray(a.quitar) ? a.quitar : []).map(n => miembroPorNombre(String(n))).filter(Boolean).map(m => m!.id);
      const nuevos = [...new Set([...aCargo(ta).filter(x => !menos.includes(x)), ...mas])];
      await cambiarTarea(ta.id, { asignados: nuevos });
      const nombres = nuevos.map(id => leerSesion().crews.flatMap(c => c.miembros).find(m => m.id === id)?.nombre.split(' ')[0] ?? '?');
      return { respuesta: { ok: true, tarea: ta.titulo, a_cargo: nombres }, accion: { icono: 'people', texto: t('{t}: {p}', { t: ta.titulo, p: nombres.join(', ') || t('nobody') }), ir: '/crew' } };
    }
    case 'dar_reconocimiento': {
      if (!crew) return { respuesta: { ok: false, motivo: 'not in a crew' } };
      const gente = (Array.isArray(a.para) ? a.para : []).map(n => miembroPorNombre(String(n))).filter((m): m is NonNullable<typeof m> => !!m && m.id !== yo);
      const texto = String(a.texto ?? '').trim();
      if (!gente.length || !texto) return { respuesta: { ok: false, motivo: 'need who (crew member) and what for' } };
      await escribirBitacora(crew.id, JSON.stringify({ para: gente.map(m => m.id), texto }), 'kudos');
      return { respuesta: { ok: true, para: gente.map(m => m.nombre) }, accion: { icono: 'heart', texto: t('Kudos to {p}', { p: gente.map(m => m.nombre.split(' ')[0]).join(', ') }), ir: '/journal?vista=crew' } };
    }
    case 'hacer_retro': {
      if (!crew) return { respuesta: { ok: false, motivo: 'not in a crew' } };
      const r = { bien: String(a.bien ?? '').trim(), mejorar: String(a.mejorar ?? '').trim(), probar: String(a.probar ?? '').trim(), anonimo: a.anonimo !== false };
      if (!r.bien && !r.mejorar && !r.probar) return { respuesta: { ok: false, motivo: 'need at least one answer' } };
      await escribirBitacora(crew.id, JSON.stringify(r), 'retro');
      return { respuesta: { ok: true, anonima: r.anonimo }, accion: { icono: 'repeat', texto: t('Retro sent'), ir: '/retro' } };
    }
    case 'mi_github': {
      const que = (['hoy', 'semana', 'anio', 'pendientes'] as const).find(x => x === S(a.que)) ?? 'hoy';
      const sinGh = { ok: false, motivo: 'their GitHub is not connected (NOVA → Settings → Integrations → GitHub) or it could not load' };
      if (que === 'anio') {
        const c = await pedir<CalendarioGh>('/v1/github/calendario').catch(() => null);
        if (!c) return { respuesta: sinGh };
        const activos = c.dias.filter(d => d.n > 0).length, mejor = c.dias.reduce((m, d) => (d.n > m.n ? d : m), { fecha: '', n: 0 });
        let racha = 0; for (let i = c.dias.length - 1; i >= 0 && c.dias[i].n > 0; i--) racha++;
        return { respuesta: { ok: true, login: c.login, desde: c.desde, contribuciones_anio: c.total, dias_activos: activos, mejor_dia: mejor, racha_actual_dias: racha }, accion: { icono: 'logo-github', texto: t('{n} contributions this year', { n: c.total }) }, visual: { tipo: 'calendario', login: c.login, total: c.total, desde: c.desde, dias: c.dias } };
      }
      const g = await pedir<ResumenGh>(`/v1/github/resumen?tz=${new Date().getTimezoneOffset()}`).catch(() => null);
      if (!g) return { respuesta: sinGh };
      const visual = { tipo: 'github' as const, login: g.login, commits: g.hoy.commits, contribuciones: g.hoy.contribuciones ?? 0, semana: g.hoy.semana ?? [], repos: g.hoy.repos, prs: g.prs.length, revisar: g.revisar.length, issues: g.issues.length, que };
      if (que === 'pendientes') return { respuesta: { ok: true, prs_abiertos: g.prs.map(x => `${x.repo}#${x.numero} ${x.titulo}`), revisiones_que_te_piden: g.revisar.map(x => `${x.repo}#${x.numero} ${x.titulo}`), issues_asignados: g.issues.map(x => `${x.repo}#${x.numero} ${x.titulo}`) }, accion: { icono: 'logo-github', texto: t('{n} PRs · {m} reviews · {k} issues', { n: g.prs.length, m: g.revisar.length, k: g.issues.length }) }, visual };
      const semana = (g.hoy.semana ?? []).reduce((x, y) => x + y, 0);
      return { respuesta: { ok: true, commits_hoy: g.hoy.commits, contribuciones_hoy: g.hoy.contribuciones ?? 0, contribuciones_semana: semana, por_dia_semana: g.hoy.semana, repos_hoy: g.hoy.repos, prs_abiertos: g.prs.length, revisiones_pendientes: g.revisar.length, ...(g.errores?.length ? { avisos: g.errores } : {}) }, accion: { icono: 'logo-github', texto: que === 'semana' ? t('{n} contributions this week', { n: semana }) : t('{n} commits today', { n: g.hoy.commits }) }, visual };
    }
    case 'ficha_de': {
      const dicho = S(a.persona);
      const { usuario } = leerSesion();
      const esYo = !dicho || /^(yo|me|mi|m[ií]o|myself|my)$/i.test(dicho);
      const m = esYo ? usuario : miembroPorNombre(dicho);
      if (!m) return { respuesta: { ok: false, motivo: `no one in the crew sounds like "${dicho}"`, nota: 'only crew members (or themselves) have a profile in NOVA' } };
      const redes = (m.redes ?? {}) as Redes;
      // su GitHub: el que guardó en sus redes o la cuenta que conectó en NOVA
      let login = redes.github ?? null;
      if (!login && crew) { const gc = await pedir<GithubCrew>(`/v1/crews/${crew.id}/github`).catch(() => null); login = gc?.conectados.find(c => c.usuario === m.id)?.login ?? null; }
      const gh = login ? await pedir<UsuarioGh>(`/v1/github/usuario/${login}`).catch(() => null) : null;
      const lista = (Object.keys(redes) as (keyof Redes)[]).filter(k => redes[k]).map(k => ({ red: k, url: urlRed(k, redes[k]!), usuario: redes[k]! }));
      if (login && !lista.some(r => r.red === 'github')) lista.unshift({ red: 'github', url: `https://github.com/${login}`, usuario: login });
      const commits7 = gh ? gh.semana.reduce((x, y) => x + y, 0) : 0;
      return {
        respuesta: { ok: true, nombre: m.nombre, redes: lista.map(r => ({ red: r.red, url: r.url })), github: gh ? { login: gh.login, seguidores: gh.seguidores, repos_publicos: gh.repos, commits_ultimos_7_dias: commits7, bio: gh.bio, ultimos: gh.ultimos.slice(0, 4) } : login ? { login, nota: 'profile could not be loaded (is their GitHub connected?)' } : null, ...(lista.length ? {} : { nota: 'no networks saved: they can add them in You → Your networks (each crew member adds their own)' }) },
        accion: { icono: 'person-circle-outline', texto: m.nombre },
        visual: { tipo: 'persona', nombre: m.nombre, foto: m.foto, redes: lista, github: gh ? { login: gh.login, seguidores: gh.seguidores, repos: gh.repos, semana: gh.semana, bio: gh.bio, empresa: gh.empresa, url: gh.url } : null },
      };
    }
    case 'estado_github': {
      if (!crew) return { respuesta: { ok: false, motivo: 'not in a crew' } };
      const g = await pedir<GithubCrew>(`/v1/crews/${crew.id}/github`).catch(() => null);
      if (!g) return { respuesta: { ok: false, motivo: 'could not load' } };
      if (!g.repos.length) return { respuesta: { ok: true, repos: [], nota: 'No repos added yet: they can add them in Crew → GitHub.' } };
      return { respuesta: { ok: true, repos: g.repos.map(r => r.repo), eventos: g.eventos.slice(0, 15).map(e => ({ tipo: e.tipo, repo: e.repo, titulo: e.titulo, detalle: e.detalle, hace_min: Math.round((Date.now() - e.ts) / 60e3) })) }, ir: undefined };
    }
    case 'carga_equipo': {
      if (!crew) return { respuesta: { ok: false, motivo: 'not in a crew' } };
      const c = await pedir<{ personas: CargaPersona[]; sinNadie: number }>(`/v1/crews/${crew.id}/carga`).catch(() => null);
      if (!c) return { respuesta: { ok: false } };
      const nom = (id: string) => leerSesion().crews.flatMap(x => x.miembros).find(m => m.id === id)?.nombre.split(' ')[0] ?? '?';
      return { respuesta: { ok: true, personas: c.personas.map(p => ({ quien: nom(p.usuario), abiertas: p.abiertas, vencidas: p.vencidas, esta_semana: p.semana, cerradas_7d: p.hechas7, foco_h_7d: Math.round(p.focoMin7 / 60), nivel: p.nivel })), sin_responsable: c.sinNadie } };
    }
    case 'ajustar_avisos': case 'ver_avisos': {
      // los mismos interruptores de Ajustes → Avisos: los de la crew se guardan en la API (el servidor filtra antes de mandar);
      // los recordatorios de NOVA viven en el teléfono
      const CREW: Record<string, string> = { crew: 'Crew moments', equipo: 'Tasks', standup: 'Standups and blockers', bitacora: 'Crew log', retos: 'Challenges', github: 'GitHub', salud: 'Crew wellbeing' };
      const NOVA: Record<string, [string, 'manana' | 'checkin' | 'standup' | 'habitos' | 'dormir']> = { recordatorio_manana: ['Morning briefing · 8:00', 'manana'], recordatorio_standup: ['Crew standup · 9:30', 'standup'], recordatorio_habitos: ['Habits left · 20:00', 'habitos'], recordatorio_checkin: ['Check-in reminder · 21:00', 'checkin'], recordatorio_dormir: ['Bedtime', 'dormir'] };
      const prefs = await pedir<Record<string, boolean>>('/v1/yo/avisos').catch(() => null);
      await cargarRecordatorios();
      const loc = leerRecordatorios();
      const estado = () => ({ ...Object.fromEntries(Object.keys(CREW).map(k => [k, prefs?.[k] !== false])), ...Object.fromEntries(Object.entries(NOVA).map(([k, [, c]]) => [k, loc[c] !== false])) });
      if (nombre === 'ver_avisos') return { respuesta: { ok: true, activos: estado() } };
      const tipos = (Array.isArray(a.tipos) ? a.tipos : [a.tipo]).map(String).filter(x => CREW[x] || NOVA[x]), on = a.activar !== false;
      if (!tipos.length) return { respuesta: { ok: false, motivo: 'unknown type', tipos_validos: [...Object.keys(CREW), ...Object.keys(NOVA)] } };
      const crewN = tipos.filter(x => CREW[x]);
      if (crewN.length){
        if (!prefs) return { respuesta: { ok: false, motivo: 'could not reach the server' } };
        const n = { ...prefs }; crewN.forEach(x => { n[x] = on; });
        const ok = await pedir('/v1/yo/avisos', { metodo: 'PUT', json: n }).then(() => true, () => false);
        if (!ok) return { respuesta: { ok: false, motivo: 'could not save' } };
        Object.assign(prefs, n);
      }
      tipos.filter(x => NOVA[x]).forEach(x => cambiarRecordatorio(NOVA[x][1], on));
      const nombres = tipos.map(x => t(CREW[x] ?? NOVA[x][0])).join(', ');
      return { respuesta: { ok: true, cambiados: tipos, nombres: tipos.map(x => t(CREW[x] ?? NOVA[x][0])), activar: on, donde: 'Ajustes → Avisos' }, accion: { icono: on ? 'notifications-outline' : 'notifications-off-outline', texto: on ? t('Notifications on: {x}', { x: nombres }) : t('Notifications off: {x}', { x: nombres }), ir: '/ajustes' } };
    }
    case 'editar_tarea': {
      // cambiar la fecha (posponer, «es para fin de mes», quitarle la fecha), el nombre o la nota de una tarea abierta
      const abiertas = tareas.filter(x => !x.hecha);
      const ta = mejor(abiertas, S(a.tarea), x => x.titulo);
      if (!ta) return { respuesta: { ok: false, motivo: 'no matching open task', abiertas: abiertas.slice(0, 12).map(x => x.titulo) } };
      const c: { vence?: string | null; titulo?: string; nota?: string } = {};
      if (typeof a.vence === 'string') { if (/^\d{4}-\d{2}-\d{2}$/.test(a.vence)) c.vence = a.vence; else if (!a.vence.trim() || /^(none|null|sin)/i.test(a.vence)) c.vence = null; }
      if (a.sin_fecha === true) c.vence = null;
      if (S(a.titulo)) c.titulo = S(a.titulo).slice(0, 120);
      if (S(a.nota)) c.nota = S(a.nota).slice(0, 500);
      if (!Object.keys(c).length) return { respuesta: { ok: false, motivo: 'nothing to change: give vence (YYYY-MM-DD), sin_fecha, titulo or nota' } };
      const ok = await cambiarTarea(ta.id, c).then(() => true, () => false);
      if (!ok) return { respuesta: { ok: false, motivo: 'could not save' } };
      const titulo = c.titulo ?? ta.titulo, venceN = c.vence !== undefined ? c.vence : ta.vence;
      const fecha = venceN ? new Date(`${venceN}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }) : t('no date');
      return { respuesta: { ok: true, tarea: titulo, vence: venceN, vence_txt: fecha, sale_de_hoy: !!venceN && venceN > fechaDe(Date.now()) },
        accion: { icono: 'calendar-outline', texto: c.vence !== undefined ? t('{t}: moved to {f}', { t: titulo, f: fecha }) : t('Task updated: {t}', { t: titulo }), ir: '/' } };
    }
    case 'tareas_externas': {
      const x = await pedir<{ tareas: Externa[]; errores: string[] }>('/v1/externas').catch(() => null);
      if (!x) return { respuesta: { ok: false } };
      return { respuesta: { ok: true, tareas: x.tareas.slice(0, 30).map(y => ({ titulo: y.titulo, en: y.fuente, vence: y.vence })), errores: x.errores } };
    }
  }
  return null;
}
