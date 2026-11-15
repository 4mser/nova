/* Hábitos: pocos (hasta 6), con meta del día. Los de sí/no se cumplen con un toque; los de cantidad (8 vasos de agua,
   20 páginas, 30 min) suman con cada toque hasta la meta. `marcas` guarda los días cumplidos (lo usan la racha, el widget
   y el resumen); `cuentas` lo que llevas cada día. Cada hábito puede tener días de la semana y recordatorios a horas
   fijas (avisos diarios). La racha cuenta días seguidos hasta hoy (si hoy todavía no, hasta ayer). En el teléfono. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { t as traducir } from '../i18n';
import { fechaDe } from './diario';

/** meta: cuánto por día (1 = sí/no); paso: cuánto suma un toque; dias: 0=dom…6=sáb (vacío o ausente = todos);
    recordar: horas «HH:MM» de aviso diario; avisos: ids de esas notificaciones programadas */
/** tipo: 'si' (una vez), 'contar' (cantidad: vasos, páginas), 'tiempo' (minutos con cronómetro), 'evitar' (días sin:
    no fumar, sin azúcar; cuentas guarda las recaídas del día y el día cuenta como cumplido si no hubo); corriendo: inicio del cronómetro */
export type TipoHabito = 'si' | 'contar' | 'tiempo' | 'evitar';
export type Habito = { id: string; nombre: string; icono: string; color: string; creado: number; tipo?: TipoHabito; meta?: number; paso?: number; unidad?: string; dias?: number[]; recordar?: string[]; avisos?: string[]; corriendo?: number };
export const tipoDe = (h: Habito): TipoHabito => h.tipo ?? ((h.meta ?? 1) > 1 ? 'contar' : 'si');
export const TIPOS_HABITO: { k: TipoHabito; t: string; i: string }[] = [{ k: 'si', t: 'Yes / no', i: 'checkmark-circle-outline' }, { k: 'contar', t: 'Count', i: 'add-circle-outline' }, { k: 'tiempo', t: 'Time', i: 'timer-outline' }, { k: 'evitar', t: 'Avoid', i: 'ban-outline' }];
export const ICONOS_HABITO = ['water-outline', 'walk-outline', 'book-outline', 'leaf-outline', 'moon-outline', 'barbell-outline', 'bicycle-outline', 'nutrition-outline', 'cafe-outline', 'code-slash-outline', 'musical-notes-outline', 'brush-outline', 'language-outline', 'heart-outline', 'body-outline', 'create-outline', 'sunny-outline', 'phone-portrait-outline', 'ban-outline', 'wine-outline', 'medkit-outline', 'cash-outline', 'people-outline', 'star-outline'];
export const COLORES_HABITO = ['#46c8e8', '#6fd6b0', '#a898ff', '#f2b457', '#ec6aa8', '#8fe6f5', '#ff8a65', '#c5e86c'];
export const MAX_HABITOS = 20;
/** sugerencias (el nombre es la clave en inglés para traducir) */
export const SUGERIDOS: Omit<Habito, 'id' | 'creado'>[] = [
  { nombre: 'Drink water', icono: 'water-outline', color: '#46c8e8', meta: 8, paso: 1, unidad: 'glasses', recordar: ['10:00', '12:00', '14:00', '16:00', '18:00'] },
  { nombre: 'Move 30 min', icono: 'walk-outline', color: '#6fd6b0', meta: 30, paso: 10, unidad: 'min' },
  { nombre: 'Read', icono: 'book-outline', color: '#a898ff', meta: 20, paso: 5, unidad: 'pages', recordar: ['21:30'] },
  { nombre: 'Meditate', icono: 'leaf-outline', color: '#6fd6b0', meta: 10, paso: 5, unidad: 'min' },
  { nombre: 'In bed before midnight', icono: 'moon-outline', color: '#a898ff' },
  { nombre: 'No phone on waking', icono: 'phone-portrait-outline', color: '#f2b457' },
  { nombre: 'Stretch', icono: 'body-outline', color: '#8fe6f5' },
  { nombre: 'Journal', icono: 'create-outline', color: '#f2b457' },
];

const CLAVE = 'nova.habitos.v1';
let habitos: Habito[] = [], marcas: Record<string, string[]> = {}, cuentas: Record<string, Record<string, number>> = {};
let inst = { habitos, marcas, cuentas };
const oyentes = new Set<() => void>();
const guardar = () => { inst = { habitos, marcas, cuentas }; oyentes.forEach(o => o()); AsyncStorage.setItem(CLAVE, JSON.stringify(inst)).catch(() => {}); };
const widgets = () => {
  // el widget «Hábitos y foco» se redibuja al tiro (carga perezosa: los widgets importan este módulo)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  setTimeout(() => { try { (require('../widgets/datos') as typeof import('../widgets/datos')).actualizarWidgets(); } catch {} }, 300);
};

export const metaDe = (h: Habito) => (tipoDe(h) === 'evitar' ? 1 : Math.max(1, h.meta ?? 1));
export const pasoDe = (h: Habito) => Math.max(1, h.paso ?? 1);
/** ¿le toca hoy? (los que son solo algunos días no cuentan ni cortan la racha los otros días) */
export const tocaEl = (h: Habito, ts: number) => !h.dias?.length || h.dias.includes(new Date(ts).getDay());

export async function cargarHabitos() {
  try {
    const t = await AsyncStorage.getItem(CLAVE);
    if (t) {
      const j = JSON.parse(t);
      // los de antes: «Tomar agua» pasa a ser de 8 vasos (lo marcado como hecho cuenta como meta cumplida)
      habitos = (j.habitos ?? []).map((h: Habito) => (h.meta == null && h.nombre === 'Drink water' ? { ...h, meta: 8, paso: 1, unidad: 'glasses' } : h));
      marcas = j.marcas ?? {}; cuentas = j.cuentas ?? {};
      inst = { habitos, marcas, cuentas }; oyentes.forEach(o => o());
      sincronizarHabitos();
    }
  } catch {}
}

export function agregarHabito(h: Omit<Habito, 'id' | 'creado'>) {
  if (habitos.length >= MAX_HABITOS || habitos.some(x => x.nombre === h.nombre)) return null;
  const nuevo: Habito = { ...h, id: `h${Date.now().toString(36)}`, creado: Date.now() };
  habitos = [...habitos, nuevo];
  guardar();
  sincronizarHabitos();
  programarAvisos(nuevo.id);
  return nuevo;
}
export async function quitarHabito(id: string) {
  const h = habitos.find(x => x.id === id);
  for (const a of h?.avisos ?? []) await Notifications.cancelScheduledNotificationAsync(a).catch(() => {});
  habitos = habitos.filter(h => h.id !== id); guardar();
}
/** cambia meta, paso, unidad, días o recordatorios (y reprograma sus avisos) */
export function editarHabito(id: string, c: Partial<Omit<Habito, 'id' | 'creado' | 'avisos'>>) {
  habitos = habitos.map(h => (h.id === id ? { ...h, ...c } : h));
  guardar();
  if ('recordar' in c || 'dias' in c || 'nombre' in c) programarAvisos(id);
}

/** los de «evitar»: cada día desde que lo creaste cuenta como cumplido si no registraste una recaída.
    Se llama al abrir la app y al volver a ella (así el día nuevo entra solo) */
export function sincronizarHabitos(ahora = Date.now()) {
  let cambio = false;
  for (const h of habitos) {
    if (tipoDe(h) !== 'evitar') continue;
    for (let t = Math.max(h.creado, ahora - 400 * 864e5); fechaDe(t) <= fechaDe(ahora); t += 864e5) {
      const f = fechaDe(t), limpio = !(cuentas[f]?.[h.id] ?? 0), dia = marcas[f] ?? [], tiene = dia.includes(h.id);
      if (limpio !== tiene) { marcas = { ...marcas, [f]: limpio ? [...dia, h.id] : dia.filter(x => x !== h.id) }; cambio = true; }
    }
  }
  if (cambio) guardar();
}

/** días seguidos sin recaer (los de «evitar»): desde la última recaída o desde que lo creaste */
export function diasSin(h: Habito, ahora = Date.now()) {
  let n = 0;
  for (let t = ahora; t >= h.creado - 864e5 && n < 5000; t -= 864e5) { if (cuentas[fechaDe(t)]?.[h.id]) break; n++; }
  return Math.max(0, n - 1);
}

/** cronómetro de los de «tiempo»: al parar, suma los minutos a lo de hoy */
export function cronometro(id: string) {
  const h = habitos.find(x => x.id === id);
  if (!h) return;
  if (h.corriendo) {
    const min = Math.max(1, Math.round((Date.now() - h.corriendo) / 60e3));
    habitos = habitos.map(x => (x.id === id ? { ...x, corriendo: undefined } : x));
    sumar(id, min);
  } else { habitos = habitos.map(x => (x.id === id ? { ...x, corriendo: Date.now() } : x)); guardar(); }
}

/** lo que llevas hoy (o ese día): para los de sí/no, 0 o 1; para los de evitar, las recaídas */
export function cuentaDe(h: Habito, fecha: string, m = marcas, cu = cuentas) {
  const c = cu[fecha]?.[h.id];
  if (tipoDe(h) === 'evitar') return c ?? 0;
  if (c != null) return c;
  return m[fecha]?.includes(h.id) ? metaDe(h) : 0;
}

/** suma (o resta) a lo de hoy; al llegar a la meta queda cumplido. Devuelve si quedó cumplido */
export function sumar(id: string, n: number, fecha = fechaDe(Date.now())) {
  const h = habitos.find(x => x.id === id);
  if (!h) return false;
  const v = Math.max(0, cuentaDe(h, fecha) + n);
  cuentas = { ...cuentas, [fecha]: { ...(cuentas[fecha] ?? {}), [id]: v } };
  // los de evitar: el día queda cumplido mientras no haya recaídas
  const dia = marcas[fecha] ?? [], listo = tipoDe(h) === 'evitar' ? v === 0 : v >= metaDe(h);
  marcas = { ...marcas, [fecha]: listo ? [...new Set([...dia, id])] : dia.filter(x => x !== id) };
  guardar(); widgets();
  return listo;
}

/** un toque: los de sí/no se alternan; los de cantidad suman un paso (al pasarse de la meta, vuelven a 0) */
export function marcar(id: string, fecha = fechaDe(Date.now())) {
  const h = habitos.find(x => x.id === id);
  if (!h) return false;
  const v = cuentaDe(h, fecha), meta = metaDe(h);
  if (meta === 1) return sumar(id, v ? -v : 1, fecha);
  return sumar(id, v >= meta ? -v : pasoDe(h), fecha);
}

/** avisos diarios a las horas elegidas (solo los días que le toca) */
async function programarAvisos(id: string) {
  const h = habitos.find(x => x.id === id);
  if (!h || Platform.OS === 'web') return;
  for (const a of h.avisos ?? []) await Notifications.cancelScheduledNotificationAsync(a).catch(() => {});
  const ids: string[] = [];
  if ((await Notifications.getPermissionsAsync().catch(() => null))?.granted) {
    const nombre = traducir(h.nombre), dias = h.dias?.length ? h.dias : null;
    for (const hora of h.recordar ?? []) {
      const [hh, mm] = hora.split(':').map(Number);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
      const contenido = { title: nombre, body: metaDe(h) > 1 ? traducir('Tap the app to add to today’s count') : traducir('Done already? Mark it in Nova'), data: { nova: 'habito', id: h.id, url: `/habito?id=${h.id}` } };
      if (!dias) {
        const n = await Notifications.scheduleNotificationAsync({ content: contenido, trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: hh, minute: mm, channelId: 'recordatorios' } }).catch(() => null);
        if (n) ids.push(n);
      } else for (const d of dias) {
        const n = await Notifications.scheduleNotificationAsync({ content: contenido, trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: d + 1, hour: hh, minute: mm, channelId: 'recordatorios' } }).catch(() => null);
        if (n) ids.push(n);
      }
    }
  }
  habitos = habitos.map(x => (x.id === id ? { ...x, avisos: ids } : x));
  guardar();
}

export const hecho = (m: Record<string, string[]>, id: string, fecha: string) => !!m[fecha]?.includes(id);

/** días seguidos hechos, terminando hoy (o ayer, si hoy aún no) */
export function racha(m: Record<string, string[]>, id: string, ahora = Date.now()) {
  const h = habitos.find(x => x.id === id);
  const toca = (ts: number) => !h || tocaEl(h, ts);
  let n = 0, t = ahora;
  if (!hecho(m, id, fechaDe(t))) t -= 864e5;
  // los días que no le tocan se saltan (no suman ni cortan)
  for (let i = 0; i < 400; i++, t -= 864e5) { if (!toca(t)) continue; if (!hecho(m, id, fechaDe(t))) break; n++; }
  return n;
}

/** la mejor racha de la historia y el % cumplido en los últimos `dias` días que le tocaban */
export function estadisticas(h: Habito, m: Record<string, string[]>, ahora = Date.now(), dias = 30) {
  let toca = 0, hechos = 0;
  // solo los días desde que existe el hábito
  for (let i = 0; i < dias; i++) { const ts = ahora - i * 864e5; if (ts < h.creado - 864e5) break; if (!tocaEl(h, ts)) continue; toca++; if (hecho(m, h.id, fechaDe(ts))) hechos++; }
  const fechas = Object.keys(m).filter(f => m[f].includes(h.id)).sort();
  let mejor = 0, actual = 0, previo = 0;
  for (const f of fechas) { const ts = Date.parse(`${f}T12:00:00`); actual = previo && ts - previo <= 864e5 * 1.5 ? actual + 1 : 1; mejor = Math.max(mejor, actual); previo = ts; }
  return { pct: toca ? hechos / toca : 0, hechos, toca, mejor: Math.max(mejor, racha(m, h.id, ahora)) };
}

export const leerHabitos = () => inst;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useHabitos() { return useSyncExternalStore(suscribir, leerHabitos, leerHabitos); }
