/* Repaso espaciado de lo que aprendes: al terminar una sesión de «aprender» anotas lo principal y NOVA te lo vuelve a
   preguntar al día siguiente, y luego cada vez más espaciado si lo recordabas (1 → 3 → 7 → 16 → 35 días). Si te costó,
   vuelve mañana. Cada repaso agenda su aviso a las 19:00 del día que toca (funciona con la app cerrada).
   Se guarda en el teléfono. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useSyncExternalStore } from 'react';
import { traductorActual } from '../i18n';
import { fechaDe } from './diario';

export type Tarjeta = { id: string; tema: string; nota: string; creado: number; proximo: number; intervalo: number; aciertos: number; repasos: number; aviso?: string; dominada?: boolean };
const CLAVE = 'nova.repaso.v1', PASOS = [1, 3, 7, 16, 35];

let tarjetas: Tarjeta[] = [];
let inst = { tarjetas };
const oyentes = new Set<() => void>();
const guardar = () => { inst = { tarjetas }; oyentes.forEach(o => o()); AsyncStorage.setItem(CLAVE, JSON.stringify(tarjetas)).catch(() => {}); };

export async function cargarRepaso() {
  try { const t = await AsyncStorage.getItem(CLAVE); if (t) { tarjetas = JSON.parse(t); inst = { tarjetas }; oyentes.forEach(o => o()); } } catch {}
}

/** las 19:00 de dentro de `dias` días */
const tarde = (dias: number) => { const d = new Date(); d.setDate(d.getDate() + dias); d.setHours(19, 0, 0, 0); return d.getTime(); };

async function agendar(t: Tarjeta) {
  if (Platform.OS === 'web') return undefined;
  if (t.aviso) await Notifications.cancelScheduledNotificationAsync(t.aviso).catch(() => {});
  if (t.dominada || !(await Notifications.getPermissionsAsync()).granted) return undefined;
  const { t: tr } = traductorActual();
  return Notifications.scheduleNotificationAsync({
    content: { title: tr('Review: {tema}', { tema: t.tema }), body: tr('What do you remember? One minute is enough.'), data: { nova: 'repaso', url: `/repaso?id=${t.id}` } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Math.max(t.proximo, Date.now() + 60e3)), channelId: 'recordatorios' },
  }).catch(() => undefined);
}

export async function crearTarjeta(tema: string, nota: string) {
  const t: Tarjeta = { id: `r${Date.now().toString(36)}`, tema: tema.trim().slice(0, 120), nota: nota.trim().slice(0, 600), creado: Date.now(), proximo: tarde(PASOS[0]), intervalo: 0, aciertos: 0, repasos: 0 };
  t.aviso = await agendar(t);
  tarjetas = [t, ...tarjetas].slice(0, 300);
  guardar();
  return t;
}

/** resultado de un repaso: lo recordabas → el siguiente más lejos; te costó → mañana otra vez */
export async function repasar(id: string, recordaba: boolean) {
  const t = tarjetas.find(x => x.id === id);
  if (!t) return null;
  const intervalo = recordaba ? Math.min(t.intervalo + 1, PASOS.length) : 0;
  const n: Tarjeta = { ...t, intervalo, aciertos: t.aciertos + (recordaba ? 1 : 0), repasos: t.repasos + 1, dominada: recordaba && intervalo >= PASOS.length, proximo: tarde(PASOS[Math.min(intervalo, PASOS.length - 1)]) };
  n.aviso = await agendar(n);
  tarjetas = tarjetas.map(x => (x.id === id ? n : x));
  guardar();
  return n;
}

export async function borrarTarjeta(id: string) {
  const t = tarjetas.find(x => x.id === id);
  if (t?.aviso) Notifications.cancelScheduledNotificationAsync(t.aviso).catch(() => {});
  tarjetas = tarjetas.filter(x => x.id !== id);
  guardar();
}

/** las que tocan hoy (o quedaron atrasadas) */
export const pendientesHoy = (ts: Tarjeta[], ahora = Date.now()) => ts.filter(t => !t.dominada && fechaDe(t.proximo) <= fechaDe(ahora));
export const diasHasta = (t: Tarjeta) => Math.max(0, Math.round((new Date(fechaDe(t.proximo)).getTime() - new Date(fechaDe(Date.now())).getTime()) / 864e5));

export const leerRepaso = () => inst;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useRepaso() { return useSyncExternalStore(suscribir, leerRepaso, leerRepaso); }
