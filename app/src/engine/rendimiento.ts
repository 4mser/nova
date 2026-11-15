/* Rendimiento: «Automático» mide los cuadros por segundo reales del teléfono los primeros segundos de cada apertura y,
   si no llega a 50, pasa a modo liviano; «Máxima calidad» y «Rendimiento» lo fijan a mano (en Configuración).
   En modo liviano: NOVA anima a 30 cuadros y sin brillos desenfocados, la órbita y el NOVA de la barra quedan quietos,
   sin animaciones de entrada ni de reordenamiento, y las pestañas lejanas no se redibujan mientras no se ven. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export type ModoRendimiento = 'auto' | 'calidad' | 'rendimiento';
type Estado = { modo: ModoRendimiento; fps: number | null; ligero: boolean };
const CLAVE = 'nova.rendimiento.v1', UMBRAL = 50;
let e: Estado = { modo: 'auto', fps: null, ligero: false };
const oyentes = new Set<() => void>();
const calcular = (modo: ModoRendimiento, fps: number | null) => modo === 'rendimiento' || (modo === 'auto' && fps != null && fps < UMBRAL);
const poner = (n: Omit<Estado, 'ligero'>) => {
  e = { ...n, ligero: calcular(n.modo, n.fps) };
  oyentes.forEach(o => o());
  AsyncStorage.setItem(CLAVE, JSON.stringify({ modo: e.modo, fps: e.fps })).catch(() => {});
};

export async function cargarRendimiento() {
  try { const t = await AsyncStorage.getItem(CLAVE); if (t) { const j = JSON.parse(t); e = { modo: j.modo ?? 'auto', fps: j.fps ?? null, ligero: calcular(j.modo ?? 'auto', j.fps ?? null) }; oyentes.forEach(o => o()); } } catch {}
}
export const elegirModo = (modo: ModoRendimiento) => poner({ modo, fps: e.fps });
/** la medición nueva se mezcla con la anterior (una apertura lenta no cambia el modo de golpe) */
export const medido = (fps: number) => poner({ modo: e.modo, fps: Math.round(e.fps == null ? fps : e.fps * 0.5 + fps * 0.5) });

export const leerRendimiento = () => e;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useRendimiento() { return useSyncExternalStore(suscribir, leerRendimiento, leerRendimiento); }
export const useLigero = () => useRendimiento().ligero;
