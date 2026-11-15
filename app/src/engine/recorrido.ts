/* El recorrido con NOVA: después de la bienvenida, NOVA te pasea por la app paso a paso y te pide hacer cosas
   (contarle tu rutina, crear un recordatorio, hablarle…). Se hace una vez; se repite desde Tú → Mapa de NOVA.
   Las «señales» las emiten las pantallas cuando haces lo pedido (por ejemplo, 'hablo' al escribirle o hablarle). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

/** base: cuántas cosas había al entrar al paso (para notar que hiciste lo pedido) */
type Estado = { activo: boolean; paso: number; hecho: boolean; senales: string[]; cargado: boolean; base: Record<string, number> };
const CLAVE = 'nova.recorrido.v1';
let e: Estado = { activo: false, paso: 0, hecho: false, senales: [], cargado: false, base: {} };
const oyentes = new Set<() => void>();
const avisar = () => { oyentes.forEach(o => o()); };
const guardar = () => { avisar(); AsyncStorage.setItem(CLAVE, JSON.stringify({ hecho: e.hecho })).catch(() => {}); };

export async function cargarRecorrido() {
  let hecho = false;
  try { const t = await AsyncStorage.getItem(CLAVE); if (t) hecho = !!JSON.parse(t).hecho; } catch {}
  e = { ...e, hecho, cargado: true }; avisar();
}
export function empezarRecorrido() { e = { ...e, activo: true, paso: 0, senales: [], base: {} }; guardar(); }
export function irAPaso(paso: number) { e = { ...e, paso, senales: [], base: {} }; avisar(); }
export function terminarRecorrido() { e = { ...e, activo: false, hecho: true }; guardar(); }
export function fijarBase(base: Record<string, number>) { e = { ...e, base }; avisar(); }
/** una pantalla avisa que hiciste algo (solo cuenta si el recorrido está activo) */
export function senal(s: string) { if (e.activo && !e.senales.includes(s)) { e = { ...e, senales: [...e.senales, s] }; avisar(); } }

export const leerRecorrido = () => e;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useRecorrido() { return useSyncExternalStore(suscribir, leerRecorrido, leerRecorrido); }
