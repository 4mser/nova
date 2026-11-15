/* Motor de NOVA (prototipo): datos SIMULATED deterministas + línea base personal + modelo de recuperación con abstención.
   Nada aquí es un modelo validado: está marcado como prototipo y la UI lo dice. */
import type { Evidencia, Inferencia, RespuestaNova } from './contratos';
import { traductorActual, type Traductor } from '../i18n';
import { iniciales, leerPerfil } from './perfil';

const h = (i: number) => { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); };

/** 14 días de historia simulada (para la línea base) + hoy */
export const DIAS = Array.from({ length: 15 }, (_, d) => ({
  rmssd: 42 + (h(d) - 0.5) * 8 - (d === 14 ? 11 : 0),
  sueno: 7 + (h(d + 30) - 0.5) * 1.2 - (d >= 12 ? 1.7 : 0),
  fc: 58 + (h(d + 60) - 0.5) * 4 + (d === 14 ? 4 : 0),
  animo: 3.6 + (h(d + 90) - 0.5) * 1.6,
  estres: 0.3 + h(d + 120) * 0.4,
}));

/** z robusto: (x − mediana) / (1,4826 · MAD) */
export function zRobusto(hist: number[], x: number) {
  const s = [...hist].sort((a, b) => a - b), med = s[Math.floor(s.length / 2)];
  const mad = [...hist.map(v => Math.abs(v - med))].sort((a, b) => a - b)[Math.floor(hist.length / 2)] || 1;
  return { z: (x - med) / (1.4826 * mad), base: med };
}

/** modelo de recuperación (prototipo): VFC + sueño frente a la base personal */
export function recuperacion(calidad = 0.94): Inferencia {
  const hist = DIAS.slice(0, 14), hoy = DIAS[14];
  if (calidad < 0.6) return { modelo: 'recovery', version: '0.1-proto', estado: 'unknown', confianza: 'low', calidad, evidencia: [], abstiene: true, motivo: 'LOW_SIGNAL_QUALITY', limites: ['prototype'] };
  const r = zRobusto(hist.map(d => d.rmssd), hoy.rmssd), s = zRobusto(hist.map(d => d.sueno), hoy.sueno);
  const ev: Evidencia[] = [
    { id: 'ev-rmssd', rasgo: 'Heart rate variability (RMSSD)', valor: hoy.rmssd, base: r.base, delta: (hoy.rmssd - r.base) / r.base, unidad: 'ms', fuente: 'SIMULATED' },
    { id: 'ev-sueno', rasgo: 'Sleep', valor: hoy.sueno, base: s.base, delta: (hoy.sueno - s.base) / s.base, unidad: 'h', fuente: 'SIMULATED' },
  ];
  const elevado = r.z < -1.5 && s.z < -1;
  return { modelo: 'recovery', version: '0.1-proto', estado: elevado ? 'elevated' : 'normal', confianza: Math.abs(r.z) > 2.5 ? 'high' : 'moderate', calidad, evidencia: ev, abstiene: false, limites: ['prototype', 'not clinically validated', 'simulated data'] };
}

/** NOVA solo explica lo que está en la evidencia (en el idioma del traductor) */
export function respuesta(inf: Inferencia, nombre: string, { t }: Traductor = traductorActual()): RespuestaNova {
  if (inf.abstiene) return { estado: 'uncertain', mensaje: t("I don't have a reliable signal right now, so I won't guess. Check the chest strap."), evidenceRefs: [], accion: 'monitor', requiereHumano: false };
  const [vfc, sueno] = inf.evidencia;
  if (inf.estado === 'elevated') {
    const p = Math.round(-vfc.delta * 100), hs = hh(sueno.valor);
    return { estado: 'attention', mensaje: t('{nombre}, your heart rate variability is {p}% below your usual, and you slept {hs}. That looks like incomplete recovery. Want to go easier today?', { nombre, p, hs }), evidenceRefs: inf.evidencia.map(e => e.id), accion: 'review', requiereHumano: true };
  }
  return { estado: 'nominal', mensaje: t('You slept well and your heart is steady, {nombre}. Everything is within your usual range.', { nombre }), evidenceRefs: inf.evidencia.map(e => e.id), accion: 'none', requiereHumano: false };
}

/** latido simulado: forma de onda tipo ECG para la traza en vivo */
export function ecg(fase: number) {
  const p = fase % 1;
  const g = (c: number, w: number, a: number) => a * Math.exp(-((p - c) ** 2) / (2 * w * w));
  return g(0.18, 0.025, 0.12) - g(0.37, 0.008, 0.18) + g(0.4, 0.012, 1) - g(0.43, 0.01, 0.28) + g(0.68, 0.045, 0.28);
}

/** el día de hoy, ya interpretado (lo que consumen las pantallas). En un componente se pasa el traductor de
    useIdioma(): así el React Compiler lo recalcula al cambiar de idioma (sin argumentos reactivos lo memoiza para siempre) */
export function hoy(tr: Traductor = traductorActual()) {
  const inf = recuperacion();
  const d = DIAS[14], hist = DIAS.slice(0, 14);
  const rz = zRobusto(hist.map(x => x.rmssd), d.rmssd).z, sz = zRobusto(hist.map(x => x.sueno), d.sueno).z;
  const preparacion = Math.max(30, Math.min(98, Math.round(82 + 3 * Math.max(-4, rz) + 2 * Math.max(-4, sz))));
  // preparación de los últimos 7 días, cada uno contra los 14 anteriores a hoy (misma fórmula)
  const histPrep = DIAS.slice(8).map(x => {
    const a = zRobusto(hist.map(y => y.rmssd), x.rmssd).z, b = zRobusto(hist.map(y => y.sueno), x.sueno).z;
    return Math.max(30, Math.min(98, Math.round(82 + 3 * Math.max(-4, a) + 2 * Math.max(-4, b))));
  });
  return {
    nombre: leerPerfil().nombre, iniciales: iniciales(leerPerfil().nombre), sol: 214, fase: tr.t('cruise to Mars'),
    inf, resp: respuesta(inf, leerPerfil().nombre.split(/\s+/)[0], tr), preparacion, habitual: 82, histPrep,
    histVfc: DIAS.map(x => x.rmssd), histFc: DIAS.map(x => x.fc), histSueno: DIAS.map(x => x.sueno),
    histSpo2: DIAS.map((_, i) => (i === 14 ? 98 : 97.6 + h(i + 400) * 1.1)), histPiel: DIAS.map((_, i) => (i === 14 ? 36.6 : 36.35 + h(i + 450) * 0.4)),
    histResp: DIAS.map((_, i) => (i === 14 ? 14 : 13 + h(i + 500) * 2.4)),
    histHueso: Array.from({ length: 12 }, (_, i) => 100 - i * 0.4 - (h(i + 200) - 0.5) * 0.2), histMusculo: Array.from({ length: 12 }, (_, i) => 100 - i * 0.35 + (h(i + 300) - 0.5) * 0.6),
    fc: Math.round(d.fc), vfc: Math.round(d.rmssd), sueno: d.sueno, suenoProfundo: d.sueno * 0.24,
    spo2: 98, piel: 36.6, resp_min: 14,
    dosis: 214, dosisDia: 1.84, limite: 600, // NASA-STD-3001: 600 mSv de carrera, igual para todas las edades y sexos
    // dosis acumulada de los últimos 30 días (crucero: ~1,84 mSv/día, MSL RAD)
    histDosis: Array.from({ length: 30 }, (_, i) => 214 - (29 - i) * 1.84 + (h(i + 600) - 0.5) * 0.6),
    ejercicio: { fuerza: [44, 60] as const, cardio: [34, 40] as const },
    hueso: -0.4, musculo: 96,
  };
}

export const hh = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}\u00a0h\u00a0${String(m % 60).padStart(2, "0")}\u00a0m`; };

/** semana de check-ins (constelación): ánimo 1..5, sueño h, estrés 0..1 */
export const SEMANA = DIAS.slice(8).map((d, i) => ({ dia: ['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'][i], animo: d.animo, sueno: d.sueno, estres: d.estres, entreno: i % 2 === 0 }));

/** horas en formato de reloj para tablas: 5.55 → "5:33" */
export const hm = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

/** estrés de los check-ins (0..1) en palabras */
export const nombreEstres = (e: number) => (e > 0.55 ? 'High' : e > 0.42 ? 'Mid' : 'Low');
