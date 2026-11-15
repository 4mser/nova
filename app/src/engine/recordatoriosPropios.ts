/* Tus recordatorios (los que pides a NOVA o agregas tú): siempre visibles en Hoy y en /recordatorios, se pueden
   posponer o borrar, y cada uno lleva su notificación programada en el teléfono. Si los avisos están apagados, el
   recordatorio igual queda guardado y la pantalla avisa que no va a sonar. Vive en el teléfono. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

export type Recordatorio = { id: string; texto: string; cuando: number; creado: number; de: 'nova' | 'tu'; notif?: string; hecho?: boolean };
const CLAVE = 'nova.recordatorios.v1';
let lista: Recordatorio[] = [];
let inst = { lista };
const oyentes = new Set<() => void>();
const guardar = () => { inst = { lista }; oyentes.forEach(o => o()); AsyncStorage.setItem(CLAVE, JSON.stringify(lista)).catch(() => {}); };

export async function cargarRecordatoriosPropios() {
  try {
    const t = await AsyncStorage.getItem(CLAVE);
    // se guardan los de las últimas 24 h ya pasados (para verlos como hechos) y todos los que vienen
    if (t) { lista = (JSON.parse(t) as Recordatorio[]).filter(r => r.cuando > Date.now() - 864e5); inst = { lista }; oyentes.forEach(o => o()); }
  } catch {}
  await importarProgramados();
}

/** los recordatorios que NOVA programó antes de existir esta lista (solo como notificación) se suman para verlos */
async function importarProgramados() {
  if (Platform.OS === 'web') return;
  try {
    const ya = new Set(lista.map(r => r.notif));
    const nuevos: Recordatorio[] = [];
    for (const n of await Notifications.getAllScheduledNotificationsAsync()) {
      const d = n.content.data as { nova?: string; id?: string } | undefined;
      if (d?.nova !== 'recordatorio' || d.id || ya.has(n.identifier)) continue;
      const tr = n.trigger as { value?: number; date?: number | string } | null;
      const cuando = typeof tr?.value === 'number' ? tr.value : tr?.date ? new Date(tr.date).getTime() : NaN;
      if (!Number.isFinite(cuando)) continue;
      nuevos.push({ id: `r${n.identifier.slice(0, 10)}`, texto: n.content.body ?? '', cuando, creado: Date.now(), de: 'nova', notif: n.identifier });
    }
    if (nuevos.length) { lista = [...lista, ...nuevos].sort((a, b) => a.cuando - b.cuando); guardar(); }
  } catch {}
}

async function programar(r: Recordatorio, titulo: string) {
  if (Platform.OS === 'web' || r.cuando <= Date.now()) return undefined;
  if (!(await Notifications.getPermissionsAsync()).granted) return undefined;
  return Notifications.scheduleNotificationAsync({
    content: { title: titulo, body: r.texto, data: { nova: 'recordatorio', id: r.id, url: '/recordatorios' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(r.cuando), channelId: 'recordatorios' },
  }).catch(() => undefined);
}

/** crea el recordatorio y su aviso; devuelve si va a sonar (false si los avisos están apagados) */
export async function crearRecordatorio(texto: string, cuando: number, de: Recordatorio['de'], titulo: string) {
  const r: Recordatorio = { id: `r${Date.now().toString(36)}`, texto: texto.trim().slice(0, 140), cuando, creado: Date.now(), de };
  r.notif = await programar(r, titulo);
  lista = [...lista, r].sort((a, b) => a.cuando - b.cuando);
  guardar();
  return { r, suena: !!r.notif };
}

export async function borrarRecordatorio(id: string) {
  const r = lista.find(x => x.id === id);
  if (r?.notif) await Notifications.cancelScheduledNotificationAsync(r.notif).catch(() => {});
  lista = lista.filter(x => x.id !== id);
  guardar();
}

/** mueve el recordatorio (posponer o cambiar la hora) y reprograma su aviso */
export async function moverRecordatorio(id: string, cuando: number, titulo: string) {
  const r = lista.find(x => x.id === id);
  if (!r) return;
  if (r.notif) await Notifications.cancelScheduledNotificationAsync(r.notif).catch(() => {});
  const nuevo = { ...r, cuando, hecho: false };
  nuevo.notif = await programar(nuevo, titulo);
  lista = lista.map(x => (x.id === id ? nuevo : x)).sort((a, b) => a.cuando - b.cuando);
  guardar();
}

export function marcarRecordatorio(id: string, hecho: boolean) { lista = lista.map(x => (x.id === id ? { ...x, hecho } : x)); guardar(); }

/** si los avisos se encendieron después, programa los que quedaron sin sonar */
export async function reprogramarSinAviso(titulo: string) {
  let cambio = false;
  for (const r of lista) if (!r.notif && !r.hecho && r.cuando > Date.now()) { const n = await programar(r, titulo); if (n) { r.notif = n; cambio = true; } }
  if (cambio) { lista = [...lista]; guardar(); }
}

export const leerRecordatoriosPropios = () => inst;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useRecordatoriosPropios() { return useSyncExternalStore(suscribir, leerRecordatoriosPropios, leerRecordatoriosPropios); }
