/* Historia de Health Connect: un resumen por día (pasos, sueño de la noche que termina ese día, pulso en reposo, VFC,
   ejercicio y calorías) de los últimos 28 días. Se guarda en el teléfono (hasta 120 días) para ver tendencias, armar el
   resumen de la semana y comparar contigo mismo: tu línea base es tu promedio de 28 días, nunca una tabla genérica.
   Se lee al leer Health Connect (cada 5 min como mucho una vez cada 30 min). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { fechaDe } from '../engine/diario';

export type Dia = { fecha: string; pasos?: number; suenoH?: number; suenoIni?: number; suenoFin?: number; fcReposo?: number; vfc?: number; ejercicioMin?: number; calorias?: number };
type HC = typeof import('react-native-health-connect');

const CLAVE = 'nova.historia.v1', DIAS = 28, GUARDA = 120;
let dias: Record<string, Dia> = {}, ultima = 0;
let inst = { dias };
const oyentes = new Set<() => void>();
const avisar = () => { inst = { dias }; oyentes.forEach(o => o()); };

export async function cargarHistoria() {
  try { const t = await AsyncStorage.getItem(CLAVE); if (t) { dias = JSON.parse(t); avisar(); } } catch {}
}

const prom = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** todos los registros del rango, página por página (Health Connect entrega de a 1000: sin esto, un mes de pulso o de
    pasos se cortaba y faltaban días) */
export async function leerTodo(hc: HC, tipo: Parameters<HC['readRecords']>[0], desde: Date, hasta: Date) {
  const fuera: unknown[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await hc.readRecords(tipo, { timeRangeFilter: { operator: 'between', startTime: desde.toISOString(), endTime: hasta.toISOString() }, pageSize: 5000, ...(pageToken ? { pageToken } : {}) });
      fuera.push(...(r.records as unknown[]));
      pageToken = (r as { pageToken?: string }).pageToken || undefined;
      if (!pageToken) break;
    } catch { break; }
  }
  return fuera;
}

/** el total de un día como lo cuenta Health Connect: si dos apps escriben pasos (el reloj y el teléfono), los junta
    sin duplicar. Sumar registros sueltos contaba doble */
export async function totalDia(hc: HC, tipo: 'Steps' | 'ActiveCaloriesBurned' | 'ExerciseSession', ini: Date, fin: Date) {
  try {
    const r = await hc.aggregateRecord({ recordType: tipo, timeRangeFilter: { operator: 'between', startTime: ini.toISOString(), endTime: fin.toISOString() } }) as Record<string, unknown>;
    if (tipo === 'Steps') return (r.COUNT_TOTAL as number | undefined) ?? undefined;
    if (tipo === 'ActiveCaloriesBurned') return (r.ACTIVE_CALORIES_TOTAL as { inKilocalories: number } | undefined)?.inKilocalories;
    const s = (r.EXERCISE_DURATION_TOTAL as { inSeconds: number } | undefined)?.inSeconds;
    return s != null ? Math.round(s / 60) : undefined;
  } catch { return undefined; }
}

export async function leerHistoria(hc: HC, forzar = false) {
  if (!forzar && Date.now() - ultima < 30 * 60e3) return;
  ultima = Date.now();
  const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
  const desde = new Date(hoy0.getTime() - (DIAS - 1) * 864e5), ahora = new Date();
  const rango = { operator: 'between' as const, startTime: desde.toISOString(), endTime: ahora.toISOString() };
  void rango;
  const leer = (t: Parameters<HC['readRecords']>[0]) => leerTodo(hc, t, desde, ahora);
  const nuevo: Record<string, Dia> = {};
  const dia = (f: string) => (nuevo[f] ??= { fecha: f });

  // pasos, ejercicio y calorías: el total de cada día según Health Connect (sin duplicar entre apps)
  for (let i = 0; i < DIAS; i++) {
    const ini = new Date(hoy0.getTime() - i * 864e5), fin = i === 0 ? ahora : new Date(ini.getTime() + 864e5), f = fechaDe(ini.getTime());
    const [pasos, ejercicio, cal] = await Promise.all([totalDia(hc, 'Steps', ini, fin), totalDia(hc, 'ExerciseSession', ini, fin), totalDia(hc, 'ActiveCaloriesBurned', ini, fin)]);
    if (pasos) dia(f).pasos = pasos;
    if (ejercicio) dia(f).ejercicioMin = ejercicio;
    if (cal) dia(f).calorias = cal;
  }
  // sueño: la sesión más larga que termina cada día cuenta como «la noche» de ese día
  for (const r of (await leer('SleepSession')) as { startTime: string; endTime: string }[]) {
    const ini = +new Date(r.startTime), fin = +new Date(r.endTime), h = (fin - ini) / 3600e3, d = dia(fechaDe(fin));
    if (h > (d.suenoH ?? 0)) { d.suenoH = h; d.suenoIni = ini; d.suenoFin = fin; }
  }
  const porDia = (rs: { time: string }[], v: (r: never) => number, campo: 'fcReposo' | 'vfc') => {
    const g: Record<string, number[]> = {};
    for (const r of rs) (g[fechaDe(+new Date(r.time))] ??= []).push(v(r as never));
    for (const [f, xs] of Object.entries(g)) dia(f)[campo] = prom(xs);
  };
  porDia((await leer('RestingHeartRate')) as { time: string }[], (r: { beatsPerMinute: number }) => r.beatsPerMinute, 'fcReposo');
  porDia((await leer('HeartRateVariabilityRmssd')) as { time: string }[], (r: { heartRateVariabilityMillis: number }) => r.heartRateVariabilityMillis, 'vfc');

  // los días del rango se reemplazan enteros (Health Connect es la verdad); los más viejos se conservan
  const corte = fechaDe(desde.getTime());
  const viejos = Object.fromEntries(Object.entries(dias).filter(([f]) => f < corte));
  const todos = { ...viejos, ...nuevo };
  dias = Object.fromEntries(Object.entries(todos).sort(([a], [b]) => b.localeCompare(a)).slice(0, GUARDA));
  AsyncStorage.setItem(CLAVE, JSON.stringify(dias)).catch(() => {});
  avisar();
}

export const leerHistoriaActual = () => inst;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useHistoria() { return useSyncExternalStore(suscribir, leerHistoriaActual, leerHistoriaActual); }

/** los últimos n días (de hoy hacia atrás), con huecos donde no hay dato */
export function ultimos(h: Record<string, Dia>, n: number, hasta = Date.now()): Dia[] {
  return Array.from({ length: n }, (_, i) => { const f = fechaDe(hasta - (n - 1 - i) * 864e5); return h[f] ?? { fecha: f }; });
}

export type Recuperacion = { nivel: 'buena' | 'normal' | 'baja'; vfc?: { semana: number; base: number }; reposo?: { semana: number; base: number } };
/** recuperación prudente: VFC y pulso en reposo de los últimos 3 días contra tu propio promedio de 28 días.
    Hace falta al menos una semana de datos; nunca es un diagnóstico. */
export function recuperacion(h: Record<string, Dia>): Recuperacion | null {
  const d28 = ultimos(h, 28), d3 = d28.slice(-3);
  const val = (ds: Dia[], k: 'vfc' | 'fcReposo') => ds.map(d => d[k]).filter((x): x is number => x != null);
  const bV = val(d28, 'vfc'), bR = val(d28, 'fcReposo'), sV = val(d3, 'vfc'), sR = val(d3, 'fcReposo');
  const vfc = bV.length >= 7 && sV.length ? { semana: prom(sV)!, base: prom(bV)! } : undefined;
  const reposo = bR.length >= 7 && sR.length ? { semana: prom(sR)!, base: prom(bR)! } : undefined;
  if (!vfc && !reposo) return null;
  let puntos = 0;
  if (vfc) puntos += vfc.semana >= vfc.base * 1.05 ? 1 : vfc.semana <= vfc.base * 0.9 ? -1 : 0;
  if (reposo) puntos += reposo.semana <= reposo.base - 2 ? 1 : reposo.semana >= reposo.base + 3 ? -1 : 0;
  return { nivel: puntos > 0 ? 'buena' : puntos < 0 ? 'baja' : 'normal', vfc, reposo };
}
