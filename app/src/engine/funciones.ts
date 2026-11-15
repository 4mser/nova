/* Funciones que se encienden aparte. «Modo misión» guarda todo lo del espacio (Sol, radiación, Marte, sesión con la
   psicóloga en la Tierra, banda de pecho) para activarlo después; apagado, NOVA es tu asistente del día a día y solo
   muestra datos reales. Se guarda en el teléfono. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

/** compartirSalud: recuperación, FC en reposo y VFC con la crew, y que la crew reciba un aviso si llevas días mal (apagado hasta que lo enciendas) */
/** vozHoy: NOVA dice en voz alta lo esencial al abrir Hoy (se apaga con el parlante junto a la frase) */
export type Funciones = { mision: boolean; compartirDia: boolean; compartirSalud: boolean; vozHoy: boolean };
const CLAVE = 'nova.funciones.v1';
let f: Funciones = { mision: false, compartirDia: true, compartirSalud: false, vozHoy: true };
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach(o => o());

export async function cargarFunciones() {
  try { const t = await AsyncStorage.getItem(CLAVE); if (t) { f = { ...f, ...JSON.parse(t) }; avisar(); } } catch {}
}
export function cambiarFuncion<K extends keyof Funciones>(k: K, v: Funciones[K]) {
  f = { ...f, [k]: v };
  AsyncStorage.setItem(CLAVE, JSON.stringify(f)).catch(() => {});
  avisar();
}
export const leerFunciones = () => f;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useFunciones() { return useSyncExternalStore(suscribir, leerFunciones, leerFunciones); }
