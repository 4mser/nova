/* Lo que NOVA recuerda de ti entre conversaciones: metas, gustos, personas importantes, rutinas, cosas a cuidar.
   Lo guarda ella misma con la herramienta «recordar» cuando le cuentas algo que vale la pena; tú lo ves y lo borras
   en Tú → Lo que NOVA recuerda. Vive en el teléfono (no sale a ningún servidor salvo como contexto de la conversación). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export type Recuerdo = { id: string; texto: string; tipo: 'meta' | 'gusto' | 'persona' | 'rutina' | 'salud' | 'otro'; ts: number };
const CLAVE = 'nova.memoria.v1', MAX = 60;
let recuerdos: Recuerdo[] = [];
let inst = { recuerdos };
const oyentes = new Set<() => void>();
const guardar = () => { inst = { recuerdos }; oyentes.forEach(o => o()); AsyncStorage.setItem(CLAVE, JSON.stringify(recuerdos)).catch(() => {}); };

export async function cargarMemoria() {
  try { const t = await AsyncStorage.getItem(CLAVE); if (t) { recuerdos = JSON.parse(t); inst = { recuerdos }; oyentes.forEach(o => o()); } } catch {}
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** agrega un recuerdo; si ya hay uno casi igual, lo reemplaza (lo más nuevo manda) */
export function recordar(texto: string, tipo: Recuerdo['tipo'] = 'otro') {
  const t = texto.trim().slice(0, 240);
  if (!t) return null;
  const n = norm(t), palabras = new Set(n.split(' ').filter(w => w.length > 3));
  const parecido = recuerdos.find(r => { const p = norm(r.texto).split(' ').filter(w => w.length > 3); const c = p.filter(w => palabras.has(w)).length; return p.length && c / Math.max(p.length, palabras.size) > 0.6; });
  const nuevo: Recuerdo = { id: parecido?.id ?? `m${Date.now().toString(36)}`, texto: t, tipo, ts: Date.now() };
  recuerdos = [nuevo, ...recuerdos.filter(r => r.id !== nuevo.id)].slice(0, MAX);
  guardar();
  return nuevo;
}

/** olvida lo que coincida con el texto (o por id) */
export function olvidar(textoOId: string) {
  const n = norm(textoOId);
  const antes = recuerdos.length;
  recuerdos = recuerdos.filter(r => r.id !== textoOId && !(n.length > 3 && norm(r.texto).includes(n)));
  if (recuerdos.length !== antes) guardar();
  return antes - recuerdos.length;
}

export const leerMemoria = () => inst;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useMemoria() { return useSyncExternalStore(suscribir, leerMemoria, leerMemoria); }
