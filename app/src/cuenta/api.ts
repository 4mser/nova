/* Cliente de la API de NOVA (api/servidor.mjs): cuentas, crew, fotos, tareas y retos.
   El token de la sesión vive en el almacén seguro del teléfono (Keystore); en web, en AsyncStorage. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** en desarrollo, la API local del Mac (mismo host que Metro); en el APK, la de Fly */
function base() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '');
  if (__DEV__) {
    const host = Constants.expoConfig?.hostUri?.split(':')[0];
    if (host) return `http://${host}:8140`;
    if (Platform.OS === 'web') return 'http://localhost:8140';
  }
  return 'https://nova-bn-api.fly.dev';
}
export const API = base();

const CLAVE = 'nova.sesion.token';
/** copia de respaldo en el almacenamiento privado de la app: algunos Android fallan al leer el Keystore al reabrir
    la app (tras cerrarla el sistema en segundo plano) y eso dejaba a la gente fuera de su sesión */
const RESPALDO = 'nova.sesion.token.respaldo';
let token: string | null = null;

export async function leerToken() {
  let t: string | null = null;
  if (Platform.OS !== 'web') { try { t = await SecureStore.getItemAsync(CLAVE); } catch {} }
  if (!t) { try { t = await AsyncStorage.getItem(Platform.OS === 'web' ? CLAVE : RESPALDO); } catch {} }
  token = t;
  return token;
}
export async function guardarToken(t: string | null) {
  token = t;
  if (Platform.OS !== 'web') {
    try { if (t) await SecureStore.setItemAsync(CLAVE, t); else await SecureStore.deleteItemAsync(CLAVE); } catch {}
  }
  try { const k = Platform.OS === 'web' ? CLAVE : RESPALDO; if (t) await AsyncStorage.setItem(k, t); else await AsyncStorage.removeItem(k); } catch {}
}
/** id de usuario guardado dentro del token (para seguir dentro aunque la API no responda al abrir) */
export function usuarioDelToken(t: string | null) {
  try { return t ? (JSON.parse(atob(t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))) as { u?: string }).u ?? null : null; } catch { return null; }
}
export const tokenActual = () => token;

/** ¿responde la API? Lo marca cada pedido: si falla por red, la app muestra «sin conexión» hasta que uno vuelva a andar */
let enLinea = true;
const oyentesRed = new Set<() => void>();
function ponerEnLinea(v: boolean) { if (v !== enLinea) { enLinea = v; oyentesRed.forEach(o => o()); } }
export const suscribirRed = (o: () => void) => { oyentesRed.add(o); return () => { oyentesRed.delete(o); }; };
export const estaEnLinea = () => enLinea;

export class ErrorApi extends Error {
  constructor(public estado: number, mensaje: string) { super(mensaje); }
}

/** si la sesión vence, la app vuelve a la pantalla de entrada */
let alVencer: ((ruta: string) => void) | null = null;
export const alVencerSesion = (f: (ruta: string) => void) => { alVencer = f; };

type Opciones = { metodo?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; json?: unknown; cuerpo?: BodyInit; cabeceras?: Record<string, string>; sinSesion?: boolean };

export async function pedir<T = unknown>(ruta: string, o: Opciones = {}): Promise<T> {
  const cab: Record<string, string> = { ...o.cabeceras };
  if (token && !o.sinSesion) cab.authorization = `Bearer ${token}`;
  if (o.json !== undefined) cab['content-type'] = 'application/json';
  let r: Response;
  try {
    r = await fetch(`${API}${ruta}`, { method: o.metodo ?? (o.json !== undefined || o.cuerpo ? 'POST' : 'GET'), headers: cab, body: o.json !== undefined ? JSON.stringify(o.json) : o.cuerpo });
  } catch {
    ponerEnLinea(false);
    throw new ErrorApi(0, 'No connection. Check your internet.');
  }
  ponerEnLinea(true);
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 401 && !o.sinSesion && token) alVencer?.(ruta);
    throw new ErrorApi(r.status, (j as { error?: string } | null)?.error ?? `Error ${r.status}`);
  }
  return j as T;
}

/** la imagen como URL con el token (para descargarla a un archivo, o en web, donde <img> no manda cabeceras) */
export const urlConToken = (ruta: string) => `${API}${ruta}${ruta.includes('?') ? '&' : '?'}k=${encodeURIComponent(token ?? '')}`;
/** imagen protegida de la API (foto de la crew o avatar) para expo-image: en el teléfono, con el token en la cabecera */
export const imagen = (ruta: string | null | undefined) =>
  !ruta ? undefined : Platform.OS === 'web' ? { uri: urlConToken(ruta) } : { uri: `${API}${ruta}`, headers: token ? { authorization: `Bearer ${token}` } : undefined, cacheKey: ruta };

/** sube un archivo del teléfono como cuerpo crudo (archivos adjuntos, actas) y devuelve el JSON de la API */
export async function subirCuerpo<T>(ruta: string, uri: string, tipo: string): Promise<T> {
  const url = `${API}${ruta}`, cab = { authorization: `Bearer ${token ?? ''}`, 'content-type': tipo };
  let estado: number, cuerpo: string;
  try {
    if (Platform.OS === 'web') {
      const r = await fetch(url, { method: 'POST', headers: cab, body: await fetch(uri).then(x => x.blob()) });
      estado = r.status; cuerpo = await r.text();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { File } = require('expo-file-system') as typeof import('expo-file-system');
      const r = await new File(uri).upload(url, { httpMethod: 'POST', headers: cab });
      estado = r.status; cuerpo = r.body;
    }
  } catch { ponerEnLinea(false); throw new ErrorApi(0, 'No connection. Check your internet.'); }
  ponerEnLinea(true);
  const j = (() => { try { return JSON.parse(cuerpo || 'null'); } catch { return null; } })();
  if (estado >= 400) throw new ErrorApi(estado, j?.error ?? `Error ${estado}`);
  return j as T;
}
