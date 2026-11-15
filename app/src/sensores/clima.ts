/* Clima (Open-Meteo: gratis, sin clave). La ubicación es una ciudad que eliges en Tú (por defecto, la de la zona
   horaria del teléfono), así no hace falta el permiso de ubicación. Se pide cada 30 min como mucho y se guarda: sin
   señal se muestra lo último. Lo usan Hoy, el resumen de la mañana y NOVA. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export type Ciudad = { nombre: string; lat: number; lon: number; pais?: string };
export type Clima = {
  ciudad: string; leido: number;
  ahora: { temp: number; sensacion: number; codigo: number };
  hoy: { max: number; min: number; lluvia: number; uv: number; codigo: number };
  manana: { max: number; min: number; lluvia: number; codigo: number };
  /** próximas horas (desde ahora): hora en ms, temperatura, probabilidad de lluvia y código */
  horas: { ts: number; temp: number; lluvia: number; codigo: number }[];
};

const CLAVE = 'nova.clima.v1', CLAVE_CIUDAD = 'nova.clima.ciudad';
// ciudades por zona horaria, para partir sin preguntar
const POR_ZONA: Record<string, Ciudad> = {
  'America/Santiago': { nombre: 'Santiago', lat: -33.45, lon: -70.66, pais: 'Chile' },
  'America/Mexico_City': { nombre: 'Ciudad de México', lat: 19.43, lon: -99.13, pais: 'México' },
  'America/Bogota': { nombre: 'Bogotá', lat: 4.71, lon: -74.07, pais: 'Colombia' },
  'America/Lima': { nombre: 'Lima', lat: -12.05, lon: -77.04, pais: 'Perú' },
  'America/Argentina/Buenos_Aires': { nombre: 'Buenos Aires', lat: -34.6, lon: -58.38, pais: 'Argentina' },
  'Europe/Madrid': { nombre: 'Madrid', lat: 40.42, lon: -3.7, pais: 'España' },
};
const porDefecto = (): Ciudad => { try { return POR_ZONA[Intl.DateTimeFormat().resolvedOptions().timeZone] ?? POR_ZONA['America/Santiago']; } catch { return POR_ZONA['America/Santiago']; } };

let ciudad: Ciudad = porDefecto(), clima: Clima | null = null, pidiendo = false;
let inst: { ciudad: Ciudad; clima: Clima | null } = { ciudad, clima };
const oyentes = new Set<() => void>();
const avisar = () => { inst = { ciudad, clima }; oyentes.forEach(o => o()); };

export async function cargarClima() {
  try {
    const [c, k] = await Promise.all([AsyncStorage.getItem(CLAVE_CIUDAD), AsyncStorage.getItem(CLAVE)]);
    if (c) ciudad = JSON.parse(c);
    if (k) { const g = JSON.parse(k) as Clima; if (g.ciudad === ciudad.nombre) clima = g; }
    avisar();
  } catch {}
  refrescarClima();
}

export async function refrescarClima(forzar = false) {
  if (pidiendo || (!forzar && clima && Date.now() - clima.leido < 30 * 60e3)) return;
  pidiendo = true;
  try {
    const q = new URLSearchParams({
      latitude: String(ciudad.lat), longitude: String(ciudad.lon), timezone: 'auto', forecast_days: '2',
      current: 'temperature_2m,apparent_temperature,weather_code',
      hourly: 'temperature_2m,precipitation_probability,weather_code',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,weather_code',
    });
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
    if (!r.ok) return;
    const j = await r.json();
    const ahora = Date.now(), H = j.hourly, D = j.daily;
    // las horas vienen en hora local sin zona: se pasan a instante con el desfase que informa la API
    const ts = (s: string) => Date.parse(`${s}:00Z`) - j.utc_offset_seconds * 1000;
    const horas = (H.time as string[]).map((s, i) => ({ ts: ts(s), temp: H.temperature_2m[i], lluvia: H.precipitation_probability[i] ?? 0, codigo: H.weather_code[i] }))
      .filter(h => h.ts > ahora - 3600e3).slice(0, 18);
    clima = {
      ciudad: ciudad.nombre, leido: ahora,
      ahora: { temp: j.current.temperature_2m, sensacion: j.current.apparent_temperature, codigo: j.current.weather_code },
      hoy: { max: D.temperature_2m_max[0], min: D.temperature_2m_min[0], lluvia: D.precipitation_probability_max[0] ?? 0, uv: D.uv_index_max[0] ?? 0, codigo: D.weather_code[0] },
      manana: { max: D.temperature_2m_max[1], min: D.temperature_2m_min[1], lluvia: D.precipitation_probability_max[1] ?? 0, codigo: D.weather_code[1] },
      horas,
    };
    AsyncStorage.setItem(CLAVE, JSON.stringify(clima)).catch(() => {});
    avisar();
  } catch {} finally { pidiendo = false; }
}

/** busca una ciudad por nombre (geocodificación de Open-Meteo); devuelve hasta 5 */
export async function buscarCiudad(texto: string, idioma: string): Promise<Ciudad[]> {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(texto)}&count=5&language=${idioma}`);
  const j = await r.json();
  return (j.results ?? []).map((x: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }) => ({ nombre: x.name, lat: x.latitude, lon: x.longitude, pais: [x.admin1, x.country].filter(Boolean).join(', ') }));
}
export function elegirCiudad(c: Ciudad) {
  ciudad = c; clima = null;
  AsyncStorage.setItem(CLAVE_CIUDAD, JSON.stringify(c)).catch(() => {});
  avisar();
  refrescarClima(true);
}

/** código WMO → ícono de Ionicons y descripción (clave en inglés para traducir) */
export function tipoClima(codigo: number, noche = false): { icono: string; t: string } {
  if (codigo === 0) return { icono: noche ? 'moon-outline' : 'sunny-outline', t: 'Clear' };
  if (codigo <= 2) return { icono: noche ? 'cloudy-night-outline' : 'partly-sunny-outline', t: 'Partly cloudy' };
  if (codigo === 3) return { icono: 'cloud-outline', t: 'Cloudy' };
  if (codigo <= 48) return { icono: 'cloud-outline', t: 'Fog' };
  if (codigo <= 57) return { icono: 'rainy-outline', t: 'Drizzle' };
  if (codigo <= 67 || (codigo >= 80 && codigo <= 82)) return { icono: 'rainy-outline', t: 'Rain' };
  if (codigo <= 77 || codigo === 85 || codigo === 86) return { icono: 'snow-outline', t: 'Snow' };
  return { icono: 'thunderstorm-outline', t: 'Storm' };
}

/** la primera hora de hoy con lluvia probable (≥ 50 %), si la hay */
export function proximaLluvia(c: Clima, ahora = Date.now()) {
  const fin = new Date(ahora); fin.setHours(23, 59, 0, 0);
  return c.horas.find(h => h.ts >= ahora - 1800e3 && h.ts <= fin.getTime() && h.lluvia >= 50);
}

export const leerClima = () => inst;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useClima() { return useSyncExternalStore(suscribir, leerClima, leerClima); }
