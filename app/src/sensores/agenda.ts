/* Tu agenda: los eventos de hoy y mañana de los calendarios del teléfono (en Android incluye Google Calendar si está
   sincronizado; también Outlook, Samsung, etc.). Solo lectura y solo con permiso. Sirve para que NOVA sepa qué tienes
   hoy y te proponga bloques de foco en los huecos libres. El módulo nativo llega con el APK 0.4.1: en APKs anteriores
   (que reciben este código por actualización) la fuente aparece como no disponible y nada se rompe. */
import { requireOptionalNativeModule } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { useSyncExternalStore } from 'react';
import { eventosRutina, leerRutina, suscribirRutina } from '../engine/rutina';

export type Evento = { id: string; titulo: string; ini: number; fin: number; todoElDia: boolean; lugar?: string; color?: string; libre: boolean };
type Cal = typeof import('expo-calendar');

export const agendaDisponible = () => Platform.OS !== 'web' && !!requireOptionalNativeModule('CalendarNext');
function modulo(): Cal | null {
  if (!agendaDisponible()) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-calendar') as Cal;
}

let eventos: Evento[] = [], leido = 0;
// lo que ven todos (Hoy, huecos libres, NOVA): el calendario del teléfono + tu rutina (trabajo, reus fijas, clases…)
const mezcla = () => {
  const rutina = leerRutina().bloques.length ? eventosRutina(Date.now(), 2) : [];
  return { eventos: [...eventos, ...rutina].sort((a, b) => a.ini - b.ini), leido: leido || (rutina.length ? Date.now() : 0) };
};
let inst = mezcla();
const oyentes = new Set<() => void>();
const avisar = () => { inst = mezcla(); oyentes.forEach(o => o()); };
suscribirRutina(avisar);

export async function pedirAgenda(): Promise<{ ok: boolean; mensaje?: string }> {
  const c = modulo();
  if (!c) return { ok: false, mensaje: 'Needs the NOVA 0.4.1 app' };
  const p = await c.requestCalendarPermissions().catch(() => null);
  return p?.granted ? { ok: true } : { ok: false, mensaje: 'Allow Calendar for Nova in Android settings' };
}

/** eventos desde el inicio de hoy hasta el final de mañana, de todos los calendarios visibles */
export async function leerAgenda() {
  const c = modulo();
  if (!c) return;
  try {
    if (!(await c.getCalendarPermissions()).granted) return;
    if (!ocultosLeidos) { try { ocultos = JSON.parse((await AsyncStorage.getItem(CLAVE_OCULTOS)) ?? '[]'); } catch {} ocultosLeidos = true; }
    const cals = (await c.getCalendars(c.EntityTypes.EVENT)).filter(x => x.isVisible !== false && !ocultos.includes(x.id));
    if (!cals.length) { eventos = []; leido = Date.now(); avisar(); return; }
    const ini = new Date(); ini.setHours(0, 0, 0, 0);
    const fin = new Date(ini.getTime() + 2 * 864e5);
    const color = new Map(cals.map(x => [x.id, x.color]));
    const lista = await c.listEvents(cals, ini, fin);
    eventos = lista
      .filter(e => e.status !== c.EventStatus.CANCELED)
      .map(e => ({
        id: `${e.id}|${new Date(e.startDate).getTime()}`, titulo: e.title || '—', ini: +new Date(e.startDate), fin: +new Date(e.endDate), todoElDia: !!e.allDay,
        lugar: e.location || undefined, color: color.get(e.calendarId) ?? undefined, libre: e.availability === c.Availability.FREE,
      }))
      .sort((a, b) => a.ini - b.ini);
    leido = Date.now();
    avisar();
  } catch { /* sin permiso o calendario raro: se deja lo último leído */ }
}
/* qué calendarios lee NOVA (se eligen en Integraciones → Calendarios) */
const CLAVE_OCULTOS = 'nova.agenda.ocultos';
let ocultos: string[] = [], ocultosLeidos = false;
export type Calendario = { id: string; titulo: string; color?: string; cuenta?: string; leido: boolean };
export async function listarCalendarios(): Promise<Calendario[]> {
  const c = modulo();
  if (!c || !(await c.getCalendarPermissions()).granted) return [];
  if (!ocultosLeidos) { try { ocultos = JSON.parse((await AsyncStorage.getItem(CLAVE_OCULTOS)) ?? '[]'); } catch {} ocultosLeidos = true; }
  return (await c.getCalendars(c.EntityTypes.EVENT)).filter(x => x.isVisible !== false)
    .map(x => ({ id: x.id, titulo: x.title, color: x.color, cuenta: x.source?.name, leido: !ocultos.includes(x.id) }));
}
export async function leerCalendario(id: string, si: boolean) {
  ocultos = si ? ocultos.filter(x => x !== id) : [...new Set([...ocultos, id])];
  await AsyncStorage.setItem(CLAVE_OCULTOS, JSON.stringify(ocultos)).catch(() => {});
  await leerAgenda();
}
export function olvidarAgenda() { eventos = []; leido = 0; avisar(); }

export const leerAgendaActual = () => inst;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useAgenda() { return useSyncExternalStore(suscribir, leerAgendaActual, leerAgendaActual); }

/** eventos de un día (los de todo el día primero) */
export function delDia(evs: Evento[], dia: number) {
  const a = new Date(dia); a.setHours(0, 0, 0, 0);
  const b = a.getTime() + 864e5;
  return evs.filter(e => e.ini < b && e.fin > a.getTime()).sort((x, y) => Number(y.todoElDia) - Number(x.todoElDia) || x.ini - y.ini);
}

/** huecos libres de al menos `min` minutos entre ahora y las `hasta` horas, dentro de 8:00–21:00, sin eventos que ocupen */
export function huecos(evs: Evento[], ahora: number, min = 45, hasta = 21) {
  const d = new Date(ahora), ini = new Date(d), fin = new Date(d);
  ini.setHours(8, 0, 0, 0); fin.setHours(hasta, 0, 0, 0);
  let t = Math.max(ahora, ini.getTime());
  // se redondea al próximo cuarto de hora
  t = Math.ceil(t / (15 * 60e3)) * 15 * 60e3;
  const ocupados = evs.filter(e => !e.todoElDia && !e.libre && e.fin > t && e.ini < fin.getTime()).sort((a, b) => a.ini - b.ini);
  const res: { ini: number; fin: number }[] = [];
  for (const e of ocupados) {
    if (e.ini - t >= min * 60e3) res.push({ ini: t, fin: e.ini });
    t = Math.max(t, e.fin);
  }
  if (fin.getTime() - t >= min * 60e3) res.push({ ini: t, fin: fin.getTime() });
  return res;
}
