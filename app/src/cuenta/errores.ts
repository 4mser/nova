/* Errores de la app → la API de NOVA (POST /v1/errores), para enterarnos sin que nadie tenga que contarlo.
   Se capturan los errores globales de JS (también los fatales), las promesas rechazadas sin manejar y lo que cae en el
   ErrorBoundary de las pantallas. Cada reporte lleva la versión que corre de verdad (APK + actualización).
   Si no hay conexión (o la app se cierra antes de enviarlo), queda pendiente y se manda al abrir la próxima vez. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { API, tokenActual } from './api';

type Reporte = { mensaje: string; pila?: string; donde?: string; fatal?: boolean; version: string; plataforma: string };
const PEND = 'nova.errores.pendientes';
const vistos = new Map<string, number>();

const version = () => {
  if (Platform.OS === 'web') return 'web';
  const id = Updates.updateId?.slice(0, 7);
  return `${Updates.runtimeVersion ?? '?'}${id && !Updates.isEmbeddedLaunch ? `+${id}` : ''}`;
};

async function enviar(r: Reporte) {
  const cab: Record<string, string> = { 'content-type': 'application/json' };
  const tk = tokenActual();
  if (tk) cab.authorization = `Bearer ${tk}`;
  const res = await fetch(`${API}/v1/errores`, { method: 'POST', headers: cab, body: JSON.stringify(r) });
  if (!res.ok && res.status >= 500) throw new Error('sin enviar');
}

async function guardarPendiente(r: Reporte) {
  try {
    const l: Reporte[] = JSON.parse((await AsyncStorage.getItem(PEND)) ?? '[]');
    l.push(r);
    await AsyncStorage.setItem(PEND, JSON.stringify(l.slice(-20)));
  } catch {}
}

export function reportarError(e: unknown, o: { donde?: string; fatal?: boolean } = {}) {
  if (__DEV__) return;
  const err = e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e));
  // el mismo error repetido en un minuto se manda una vez
  const clave = `${err.message}|${o.donde ?? ''}`, ahora = Date.now();
  if (ahora - (vistos.get(clave) ?? 0) < 60e3) return;
  vistos.set(clave, ahora);
  const r: Reporte = { mensaje: `${err.name}: ${err.message}`.slice(0, 600), pila: err.stack?.slice(0, 6000), donde: o.donde, fatal: o.fatal, version: version(), plataforma: `${Platform.OS} ${Platform.Version}` };
  if (o.fatal) guardarPendiente(r); // por si la app se cierra antes de terminar el envío
  enviar(r).then(() => { if (o.fatal) AsyncStorage.removeItem(PEND).catch(() => {}); }, () => { if (!o.fatal) guardarPendiente(r); });
}

let instalado = false;
/** se llama una vez al arrancar: engancha los manejadores globales y manda lo que quedó pendiente */
export function instalarErrores() {
  if (instalado || __DEV__) return;
  instalado = true;
  const g = globalThis as unknown as {
    ErrorUtils?: { getGlobalHandler: () => (e: Error, fatal?: boolean) => void; setGlobalHandler: (f: (e: Error, fatal?: boolean) => void) => void };
    HermesInternal?: { enablePromiseRejectionTracker?: (o: { allRejections: boolean; onUnhandled: (id: number, e: unknown) => void }) => void };
  };
  const previo = g.ErrorUtils?.getGlobalHandler();
  g.ErrorUtils?.setGlobalHandler((e, fatal) => {
    reportarError(e, { donde: 'global', fatal });
    // a un error fatal le damos un instante para guardar/enviar antes de que la app se cierre
    if (fatal) setTimeout(() => previo?.(e, fatal), 350); else previo?.(e, fatal);
  });
  g.HermesInternal?.enablePromiseRejectionTracker?.({ allRejections: true, onUnhandled: (_id, e) => reportarError(e, { donde: 'promesa' }) });
  AsyncStorage.getItem(PEND).then(async t => {
    const l: Reporte[] = JSON.parse(t ?? '[]');
    if (!l.length) return;
    await AsyncStorage.removeItem(PEND);
    for (const r of l) await enviar(r).catch(() => guardarPendiente(r));
  }).catch(() => {});
}
