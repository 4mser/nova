/* Sesiones de foco: un temporizador con NOVA. Cada sesión terminada (o cortada después de 5 min) queda registrada por
   fecha, con en qué te enfocaste. Se guarda en el teléfono; los minutos del día se comparten con la crew si lo permites. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { fechaDe } from './diario';

export type Sesion = { id: string; ini: number; min: number; meta: number; que?: string; tipo: 'foco' | 'aprender' };
/** la sesión en curso sobrevive si cierras la app: se guarda cuándo termina */
export type EnCurso = { ini: number; fin: number; meta: number; que?: string; tipo: 'foco' | 'aprender'; pausa?: number; aviso?: string };

const CLAVE = 'nova.foco.v1';
let sesiones: Sesion[] = [];
let enCurso: EnCurso | null = null;
let inst: { sesiones: Sesion[]; enCurso: EnCurso | null } = { sesiones, enCurso };
const oyentes = new Set<() => void>();
const avisar = () => { inst = { sesiones, enCurso }; oyentes.forEach(o => o()); };
const guardar = () => { AsyncStorage.setItem(CLAVE, JSON.stringify({ sesiones, enCurso })).catch(() => {}); avisar(); };

export async function cargarFoco() {
  try { const t = await AsyncStorage.getItem(CLAVE); if (t) { const j = JSON.parse(t); sesiones = j.sesiones ?? []; enCurso = j.enCurso ?? null; avisar(); } } catch {}
}

export function empezar(meta: number, tipo: EnCurso['tipo'], que?: string, aviso?: string) {
  const ini = Date.now();
  enCurso = { ini, fin: ini + meta * 60e3, meta, que, tipo, aviso };
  guardar();
}
export function pausar() {
  if (!enCurso || enCurso.pausa) return;
  enCurso = { ...enCurso, pausa: Date.now() }; guardar();
}
export function seguir() {
  if (!enCurso?.pausa) return;
  const p = Date.now() - enCurso.pausa;
  enCurso = { ...enCurso, fin: enCurso.fin + p, ini: enCurso.ini + p, pausa: undefined }; guardar();
}
/** termina (a tiempo o antes): cuenta si duró al menos 5 min */
export function terminar() {
  if (!enCurso) return null;
  const hasta = Math.min(enCurso.pausa ?? Date.now(), enCurso.fin);
  const min = Math.round((hasta - enCurso.ini) / 60e3);
  const s: Sesion = { id: `f${Date.now().toString(36)}`, ini: enCurso.ini, min, meta: enCurso.meta, que: enCurso.que, tipo: enCurso.tipo };
  const aviso = enCurso.aviso;
  enCurso = null;
  if (min >= 5) sesiones = [s, ...sesiones].slice(0, 500);
  guardar();
  return { sesion: min >= 5 ? s : null, aviso };
}

export const minutosDe = (fecha: string, tipo?: Sesion['tipo']) => sesiones.filter(s => fechaDe(s.ini) === fecha && (!tipo || s.tipo === tipo)).reduce((a, s) => a + s.min, 0);
export const leerFoco = () => inst;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useFoco() { return useSyncExternalStore(suscribir, leerFoco, leerFoco); }
