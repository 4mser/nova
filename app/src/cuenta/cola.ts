/* Cola sin conexión: lo que escribes sin señal (tareas, bitácora, standup, avances de metas) se guarda en el teléfono
   y se envía solo, en orden, apenas la API vuelve a responder (y al abrir la app). Si el servidor lo rechaza (4xx),
   se descarta; si es la red otra vez, se reintenta después. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { ErrorApi, estaEnLinea, pedir, suscribirRed } from './api';

type Pendiente = { id: string; ruta: string; metodo: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; json?: unknown; ts: number };
const CLAVE = 'nova.cola.v1';
let cola: Pendiente[] = [], vaciando = false, despues: (() => void) | null = null;
const oyentes = new Set<() => void>();
const guardar = () => { oyentes.forEach(o => o()); AsyncStorage.setItem(CLAVE, JSON.stringify(cola)).catch(() => {}); };

/** lo que hay que hacer cuando la cola se vacía (refrescar los datos) */
export const alVaciarCola = (f: () => void) => { despues = f; };

export async function cargarCola() {
  try { const t = await AsyncStorage.getItem(CLAVE); if (t) { cola = JSON.parse(t); oyentes.forEach(o => o()); } } catch {}
  vaciarCola();
  suscribirRed(() => { if (estaEnLinea()) vaciarCola(); });
}

/** pide a la API; si no hay red, lo deja en cola y devuelve null */
export async function pedirOEncolar<T>(ruta: string, metodo: Pendiente['metodo'], json?: unknown): Promise<T | null> {
  try { return await pedir<T>(ruta, { metodo, json }); }
  catch (e) {
    if ((e as ErrorApi).estado !== 0) throw e;
    cola = [...cola, { id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, ruta, metodo, json, ts: Date.now() }].slice(-200);
    guardar();
    return null;
  }
}

export async function vaciarCola() {
  if (vaciando || !cola.length) return;
  vaciando = true;
  let alguno = false;
  try {
    while (cola.length) {
      const p = cola[0];
      try { await pedir(p.ruta, { metodo: p.metodo, json: p.json }); alguno = true; }
      catch (e) { if ((e as ErrorApi).estado === 0) break; /* 4xx/5xx: no tiene arreglo reintentando */ }
      cola = cola.slice(1);
      guardar();
    }
  } finally { vaciando = false; }
  if (alguno) despues?.();
}

const leer = () => cola.length;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function usePendientes() { return useSyncExternalStore(suscribir, leer, leer); }
