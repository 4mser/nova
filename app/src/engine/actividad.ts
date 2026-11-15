/* Lo que hizo NOVA por ti: cada acción que ejecuta (tareas, recordatorios, hábitos, metas, bitácora, calendario,
   alarmas…) queda anotada con la hora y el lugar de la app donde vive, para encontrarla después en /actividad.
   Últimas 200, en el teléfono. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export type Hecho = { id: string; ts: number; icono: string; texto: string; ir?: string; donde?: string };
const CLAVE = 'nova.actividad.v1', MAX = 200;
let lista: Hecho[] = [];
let inst = { lista };
const oyentes = new Set<() => void>();
const guardar = () => { inst = { lista }; oyentes.forEach(o => o()); AsyncStorage.setItem(CLAVE, JSON.stringify(lista)).catch(() => {}); };

export async function cargarActividad() {
  try { const t = await AsyncStorage.getItem(CLAVE); if (t) { lista = JSON.parse(t); inst = { lista }; oyentes.forEach(o => o()); } } catch {}
}
export function anotar(h: Omit<Hecho, 'id' | 'ts'>) {
  lista = [{ ...h, id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, ts: Date.now() }, ...lista].slice(0, MAX);
  guardar();
}
export const leerActividad = () => inst;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useActividad() { return useSyncExternalStore(suscribir, leerActividad, leerActividad); }
