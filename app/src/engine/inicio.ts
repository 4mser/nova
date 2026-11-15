/* Hoy a tu medida: el orden de las secciones y cuáles se ocultan. NOVA y su frase van siempre arriba.
   Se edita en /personalizar; vive en el teléfono. Las secciones nuevas que traiga una actualización se suman al final. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export const SECCIONES_HOY = [
  { id: 'noto', t: 'Nova noticed', icono: 'sparkles-outline' },
  { id: 'numeros', t: 'Your numbers', icono: 'pulse-outline' },
  { id: 'recordatorios', t: 'Reminders', icono: 'alarm-outline' },
  { id: 'tareas', t: 'Your tasks', icono: 'checkbox-outline' },
  { id: 'externas', t: 'From your other apps', icono: 'apps-outline' },
  { id: 'habitos', t: 'Habits', icono: 'repeat' },
  { id: 'github', t: 'GitHub', icono: 'logo-github' },
  { id: 'agenda', t: 'Your schedule', icono: 'calendar-outline' },
  { id: 'clima', t: 'Weather', icono: 'partly-sunny-outline' },
  { id: 'semana', t: 'Your week', icono: 'stats-chart-outline' },
  { id: 'standup', t: 'Standup', icono: 'chatbubbles-outline' },
  { id: 'crew', t: 'Crew photo', icono: 'camera-outline' },
  { id: 'repaso', t: 'Review', icono: 'school-outline' },
  { id: 'checkin', t: 'Check-in', icono: 'happy-outline' },
  { id: 'fuentes', t: 'Data sources', icono: 'server-outline' },
] as const;
export type SeccionHoy = (typeof SECCIONES_HOY)[number]['id'];

const CLAVE = 'nova.inicio.v1';
const TODAS = SECCIONES_HOY.map(s => s.id) as SeccionHoy[];
let e: { orden: SeccionHoy[]; ocultas: SeccionHoy[] } = { orden: TODAS, ocultas: [] };
const oyentes = new Set<() => void>();
const guardar = () => { e = { ...e }; oyentes.forEach(o => o()); AsyncStorage.setItem(CLAVE, JSON.stringify(e)).catch(() => {}); };

export async function cargarInicio() {
  try {
    const t = await AsyncStorage.getItem(CLAVE);
    if (!t) return;
    const j = JSON.parse(t) as typeof e;
    const orden = j.orden.filter(x => TODAS.includes(x));
    // las secciones nuevas entran junto a la que tenían antes en el orden de fábrica (no al final)
    for (const x of TODAS) if (!orden.includes(x)) { const previa = TODAS[TODAS.indexOf(x) - 1]; const i = orden.indexOf(previa); orden.splice(i < 0 ? orden.length : i + 1, 0, x); }
    e = { orden, ocultas: (j.ocultas ?? []).filter(x => TODAS.includes(x)) };
    oyentes.forEach(o => o());
  } catch {}
}
export function moverSeccion(id: SeccionHoy, d: -1 | 1) {
  const i = e.orden.indexOf(id), j = i + d;
  if (i < 0 || j < 0 || j >= e.orden.length) return;
  const o = [...e.orden]; [o[i], o[j]] = [o[j], o[i]];
  e = { ...e, orden: o }; guardar();
}
export function mostrarSeccion(id: SeccionHoy, si: boolean) { e = { ...e, ocultas: si ? e.ocultas.filter(x => x !== id) : [...new Set([...e.ocultas, id])] }; guardar(); }
export function restablecerInicio() { e = { orden: TODAS, ocultas: [] }; guardar(); }

export const leerInicio = () => e;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useInicio() { return useSyncExternalStore(suscribir, leerInicio, leerInicio); }
