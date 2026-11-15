/* Datos reales de los dispositivos: el reloj (pulso por Bluetooth), Health Connect, el uso del teléfono y sus sensores
   (pasos, movimiento, presión, luz, batería, ruido). Solo se llenan las fuentes con consentimiento (fuentes.ts).
   Un almacén simple al que se suscriben las pantallas y NOVA. Son datos REALES: se muestran con su procedencia,
   separados de los simulados. */
import { useSyncExternalStore } from 'react';

export type EstadoReloj = 'no_disponible' | 'apagado' | 'buscando' | 'conectado' | 'error';

export type Vivo = {
  reloj: { estado: EstadoReloj; nombre?: string; mensaje?: string };
  /** pulso del reloj (bpm) y su historia reciente (1 punto por segundo, hasta 2 min) */
  fc?: number;
  serieFc: number[];
  /** intervalos entre latidos (ms) si el reloj los manda → RMSSD */
  rr: number[];
  rmssd?: number;
  /** teléfono */
  pasos: number;
  movimiento: number; // 0..1, intensidad suavizada
  actividad: 'quieto' | 'moviendose' | 'activo';
  serieMov: number[];
  presion?: number; // hPa
  seriePresion: number[];
  luz?: number; // lux
  serieLuz: number[];
  sensores: { movimiento: boolean; pasos: boolean; presion: boolean; luz: boolean };
  bateria?: { nivel: number; cargando: boolean; desdeCarga?: number };
  /** ruido aproximado (dB), una muestra cada 5 min */
  ruido?: number;
  serieRuido: number[];
  /** Health Connect: lo que otras apps del teléfono guardaron */
  salud?: Salud;
  /** uso del teléfono hoy y anoche */
  uso?: UsoTelefono;
  /** la conversación por voz con NOVA usa el micrófono: el medidor de ruido espera */
  vozActiva: boolean;
  actualizado: number;
};

export type Salud = {
  pasos?: number; fc?: number; serieFc: number[]; fcReposo?: number; vfc?: number; spo2?: number;
  sueno?: { horas: number; ini: number; fin: number }; ejercicioMin?: number; calorias?: number;
  origenes: string[]; leido: number;
};
export type UsoTelefono = {
  pantallaMin: number; desbloqueos: number; apps: { nombre: string; min: number }[];
  nocheMin: number; ultimoUso?: number; primerUso?: number; leido: number;
};

let estado: Vivo = {
  reloj: { estado: 'apagado' }, serieFc: [], rr: [],
  pasos: 0, movimiento: 0, actividad: 'quieto', serieMov: [], seriePresion: [], serieLuz: [],
  sensores: { movimiento: false, pasos: false, presion: false, luz: false }, serieRuido: [], vozActiva: false, actualizado: 0,
};
const oyentes = new Set<() => void>();
let pendiente = false;

/** cambia el estado y avisa a las pantallas como mucho 4 veces por segundo */
export function cambiar(f: (v: Vivo) => Partial<Vivo>) {
  estado = { ...estado, ...f(estado), actualizado: Date.now() };
  if (pendiente) return;
  pendiente = true;
  setTimeout(() => { pendiente = false; oyentes.forEach(o => o()); }, 250);
}

export const leer = () => estado;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useVivo() { return useSyncExternalStore(suscribir, leer, leer); }

export const empujar = (serie: number[], v: number, max = 120) => (serie.length >= max ? [...serie.slice(serie.length - max + 1), v] : [...serie, v]);

/** RMSSD de los intervalos RR (ms) */
export function rmssd(rr: number[]) {
  if (rr.length < 4) return undefined;
  let s = 0;
  for (let i = 1; i < rr.length; i++) s += (rr[i] - rr[i - 1]) ** 2;
  return Math.sqrt(s / (rr.length - 1));
}

/** resumen en texto para NOVA (solo lo que de verdad está llegando) */
export function resumenVivo(): string {
  const v = estado, l: string[] = [];
  if (v.reloj.estado === 'conectado' && v.fc) {
    l.push(`LIVE from the watch (${v.reloj.nombre ?? 'smartwatch'}): heart rate ${Math.round(v.fc)} bpm right now${v.serieFc.length > 10 ? `, ${Math.round(Math.min(...v.serieFc.slice(-60)))}–${Math.round(Math.max(...v.serieFc.slice(-60)))} bpm over the last minute` : ''}.`);
    if (v.rmssd) l.push(`LIVE HRV from beat-to-beat intervals: RMSSD ${Math.round(v.rmssd)} ms (short window, less reliable than the overnight value).`);
  }
  if (v.sensores.movimiento) l.push(`LIVE from the phone: currently ${v.actividad === 'quieto' ? 'still' : v.actividad === 'moviendose' ? 'moving lightly' : 'active'}${v.sensores.pasos ? `, ${v.pasos} steps since the app opened` : ''}.`);
  if (v.presion) l.push(`LIVE cabin pressure from the phone barometer: ${v.presion.toFixed(1)} hPa.`);
  if (v.luz !== undefined) l.push(`LIVE ambient light: ${Math.round(v.luz)} lux.`);
  if (v.bateria) l.push(`Phone battery ${Math.round(v.bateria.nivel * 100)}%${v.bateria.cargando ? ', charging' : ''}.`);
  if (v.ruido) l.push(`Noise around: about ${Math.round(v.ruido)} dB (phone microphone, approximate).`);
  const s = v.salud, hm = (t: number) => new Date(t).toTimeString().slice(0, 5);
  if (s) {
    const p: string[] = [];
    if (s.pasos !== undefined) p.push(`${s.pasos} steps today`);
    if (s.fc) p.push(`latest heart rate ${Math.round(s.fc)} bpm`);
    if (s.fcReposo) p.push(`resting heart rate ${Math.round(s.fcReposo)} bpm`);
    if (s.vfc) p.push(`HRV ${Math.round(s.vfc)} ms`);
    if (s.spo2) p.push(`SpO2 ${Math.round(s.spo2)}%`);
    if (s.sueno) p.push(`slept ${s.sueno.horas.toFixed(1)} h (${hm(s.sueno.ini)}–${hm(s.sueno.fin)})`);
    if (s.ejercicioMin) p.push(`${s.ejercicioMin} min of exercise today`);
    if (s.calorias) p.push(`${Math.round(s.calorias)} active kcal`);
    l.push(p.length ? `REAL from Health Connect${s.origenes.length ? ` (${s.origenes.join(', ')})` : ''}: ${p.join('; ')}.` : 'Health Connect is on but has no data yet.');
  }
  const u = v.uso;
  if (u) l.push(`REAL phone use today: ${Math.round(u.pantallaMin)} min of screen time, ${u.desbloqueos} unlocks${u.apps.length ? `; most used: ${u.apps.slice(0, 3).map(a => `${a.nombre} ${Math.round(a.min)} min`).join(', ')}` : ''}. Last night the screen was on ${Math.round(u.nocheMin)} min between 23:00 and 06:00${u.ultimoUso ? `, last use ${hm(u.ultimoUso)}` : ''}${u.primerUso ? `, first pickup ${hm(u.primerUso)}` : ''}.`);
  return l.length ? l.join('\n') : 'No live device data right now (watch not connected).';
}

// solo en desarrollo web: permite cargar datos de demostración desde la consola (capturas del video de la app)
if ((__DEV__ || process.env.EXPO_PUBLIC_DEMO) && typeof window !== 'undefined') (window as unknown as { __novaVivo?: typeof cambiar }).__novaVivo = cambiar;
