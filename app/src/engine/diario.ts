/* Diario de misión: registro diario estructurado (6 escalas, emociones, lo bueno del día) y entradas escritas por Sol. Privado por defecto: solo sale hacia la Tierra la
   entrada que marques para la Dra. Ruiz, y solo si «Journal» está activado en «What you share».
   Se guarda en el teléfono (AsyncStorage). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { traductorActual, type Traductor } from '../i18n';
import { hoy } from './motor';
import { leerFunciones } from './funciones';

/* Los textos de abajo (ánimos, etiquetas, escalas, emociones) quedan en inglés porque también son los valores que se
   guardan; se traducen al mostrarlos (src/i18n/es.ts): t(e.t), nivelDe(…), animoDe(…) */
export const ANIMOS = ['Rough', 'Low', 'Okay', 'Good', 'Great'] as const;
export const ETIQUETAS = ['Crew', 'Family', 'Work', 'Body', 'Sleep', 'Earth', 'Training', 'Food', 'Science', 'Alone time'] as const;
/** en el día a día (sin modo misión) */
export const ETIQUETAS_DIA = ['Friends', 'Family', 'Work', 'Study', 'Body', 'Sleep', 'Training', 'Food', 'Love', 'Alone time'] as const;
export const etiquetas = (): readonly string[] => (leerFunciones().mision ? ETIQUETAS : ETIQUETAS_DIA);

export type Entrada = { id: string; ts: number; texto: string; animo: number; etiquetas: string[]; compartir: boolean };

/** registro del día: escalas de un solo ítem (1–5), emociones y lo bueno del día. Una por fecha. */
export type Escala = 'animo' | 'energia' | 'estres' | 'sueno' | 'conexion' | 'carga';
export type Registro = { fecha: string; valores: Partial<Record<Escala, number>>; emociones: string[]; bueno?: string; actualizado: number };

/** cada escala: la pregunta, una palabra por nivel (1–5) y si «alto» es bueno o malo (para el color) */
export const ESCALAS: { id: Escala; t: string; pregunta: string; niveles: [string, string, string, string, string]; altoEsBueno: boolean; icono: string }[] = [
  { id: 'animo', t: 'Mood', pregunta: 'How is your mood?', niveles: ['Very low', 'Low', 'Okay', 'Good', 'Very good'], altoEsBueno: true, icono: 'happy-outline' },
  { id: 'energia', t: 'Energy', pregunta: 'How much energy do you have?', niveles: ['Drained', 'Low', 'Steady', 'Good', 'Full'], altoEsBueno: true, icono: 'flash-outline' },
  { id: 'estres', t: 'Stress', pregunta: 'How stressed do you feel?', niveles: ['Calm', 'Mild', 'Some', 'High', 'Very high'], altoEsBueno: false, icono: 'pulse-outline' },
  { id: 'sueno', t: 'Sleep', pregunta: 'How did you sleep?', niveles: ['Poor', 'Restless', 'Fair', 'Good', 'Great'], altoEsBueno: true, icono: 'moon-outline' },
  { id: 'conexion', t: 'Crew', pregunta: 'How close do you feel to the crew?', niveles: ['Isolated', 'Distant', 'Neutral', 'Close', 'Very close'], altoEsBueno: true, icono: 'people-outline' },
  { id: 'carga', t: 'Workload', pregunta: "How heavy was today's work?", niveles: ['Light', 'Easy', 'Fair', 'Heavy', 'Overloaded'], altoEsBueno: false, icono: 'briefcase-outline' },
];
/** la palabra de un nivel (1–5) de una escala, en el idioma del traductor (la misma palabra cambia según la escala) */
export const nivelDe = (tr: Traductor, e: { id: Escala; niveles: readonly string[] }, v: number) => tr.tc(e.id, e.niveles[v - 1]);
/** el ánimo de una entrada escrita (0–4) en palabras */
export const animoDe = (tr: Traductor, i: number) => tr.tc('animos', ANIMOS[i]);
export const EMOCIONES = ['Calm', 'Focused', 'Proud', 'Grateful', 'Energized', 'Motivated', 'Homesick', 'Lonely', 'Anxious', 'Irritable', 'Tired', 'Bored'] as const;

export const fechaDe = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const CLAVE = 'nova.diario.v1';
let entradas: Entrada[] = [], cargado = false, compartir = false, novaLee = false;
let registros: Record<string, Registro> = {};
let instantanea = { entradas, compartir, registros, novaLee, cargado };
const oyentes = new Set<() => void>();
const avisar = () => { instantanea = { entradas, compartir, registros, novaLee, cargado }; oyentes.forEach(o => o()); };
const guardar = () => { AsyncStorage.setItem(CLAVE, JSON.stringify({ entradas, compartir, registros, novaLee })).catch(() => {}); avisar(); };

export async function cargarDiario() {
  if (cargado) return;
  try {
    const t = await AsyncStorage.getItem(CLAVE);
    if (t) { const j = JSON.parse(t); entradas = j.entradas ?? []; compartir = !!j.compartir; registros = j.registros ?? {}; novaLee = !!j.novaLee; }
  } catch {}
  cargado = true;
  avisar();
}

export function escribir(e: Omit<Entrada, 'id' | 'ts'> & { id?: string; ts?: number }) {
  if (e.id) entradas = entradas.map(x => (x.id === e.id ? { ...x, ...e, id: x.id, ts: x.ts } : x));
  else entradas = [{ ...e, id: `d${Date.now().toString(36)}`, ts: Date.now() }, ...entradas];
  guardar();
}
export function borrar(id: string) { entradas = entradas.filter(x => x.id !== id); guardar(); }
/** «Journal» en What you share: si está apagado, ninguna entrada sale del teléfono */
export function compartirDiario(si: boolean) { compartir = si; if (!si) entradas = entradas.map(e => ({ ...e, compartir: false })); guardar(); }

/** cambia el registro de hoy (se guarda solo) */
export function registrar(cambio: { valores?: Partial<Record<Escala, number>>; emociones?: string[]; bueno?: string }) {
  const f = fechaDe(Date.now()), r = registros[f] ?? { fecha: f, valores: {}, emociones: [], actualizado: 0 };
  registros = { ...registros, [f]: { ...r, ...cambio, valores: { ...r.valores, ...cambio.valores }, actualizado: Date.now() } };
  guardar();
}
/** NOVA solo lee los números del registro (nunca lo escrito) y solo si lo autorizas */
export function permitirNova(si: boolean) { novaLee = si; guardar(); }
export const leerDiario = () => instantanea;

/** para NOVA: hoy y el promedio de los últimos 7 registros, solo números */
export function resumenRegistro(): string | null {
  if (!novaLee) return null;
  const hoyR = registros[fechaDe(Date.now())], ult = Object.values(registros).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 7);
  if (!ult.length) return 'Journal log: nothing logged yet.';
  const prom = (e: Escala) => { const v = ult.map(r => r.valores[e]).filter((x): x is number => x != null); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '–'; };
  const hoyTxt = hoyR ? ESCALAS.filter(e => hoyR.valores[e.id] != null).map(e => `${e.t.toLowerCase()} ${hoyR.valores[e.id]}/5`).join(', ') + (hoyR.emociones.length ? `; feeling ${hoyR.emociones.join(', ').toLowerCase()}` : '') : 'not logged yet';
  return `Journal log (self-reported, shared with permission; never quote private writing): today ${hoyTxt}. 7-day averages: ${ESCALAS.map(e => `${e.t.toLowerCase()} ${prom(e.id)}`).join(', ')}.`;
}

const leer = () => instantanea;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useDiario() { return useSyncExternalStore(suscribir, leer, leer); }

/** Sol de una fecha: hoy es el Sol de la misión; cada día atrás, uno menos */
export function solDe(ts: number) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const h = new Date(); h.setHours(0, 0, 0, 0);
  return hoy().sol - Math.round((+h - +d) / 864e5);
}

/** días seguidos con al menos una entrada, terminando hoy o ayer */
export function racha(es: Entrada[]) {
  const sols = new Set(es.map(e => solDe(e.ts)));
  let s = hoy().sol;
  if (!sols.has(s)) s--;
  let n = 0;
  while (sols.has(s)) { n++; s--; }
  return n;
}

const PREGUNTAS = [
  'What surprised you today?',
  'What did you see out of the window that you want to remember?',
  'Who on the crew made your day easier?',
  'What are you looking forward to tomorrow?',
  'What did your body tell you today?',
  'What do you miss most from Earth right now?',
  'What went better than you expected?',
  'What would you tell yourself on launch day?',
  'What small thing helped you feel at home?',
  'What is weighing on you, if anything?',
];
const PREGUNTAS_DIA = [
  'What surprised you today?',
  'What do you want to remember from today?',
  'Who made your day easier?',
  'What are you looking forward to tomorrow?',
  'What did your body tell you today?',
  'What did you learn today?',
  'What went better than you expected?',
  'What are you grateful for right now?',
  'What would you do differently tomorrow?',
  'What is weighing on you, if anything?',
];
/** la pregunta del día cambia cada día */
export const preguntaDelDia = (tr: Traductor = traductorActual()) => {
  const l = leerFunciones().mision ? PREGUNTAS : PREGUNTAS_DIA;
  return tr.t(l[Math.floor(Date.now() / 864e5) % l.length]);
};

/** etiqueta de un día para agrupar: «Sol 214 · hoy» en misión; «Hoy», «Ayer» o la fecha en el día a día */
export function nombreDia(ts: number, tr: Traductor) {
  if (leerFunciones().mision) { const s = solDe(ts), h = hoy().sol; return `Sol ${s}${s === h ? ` · ${tr.t('today')}` : s === h - 1 ? ` · ${tr.t('yesterday')}` : ''}`; }
  const f = fechaDe(ts);
  if (f === fechaDe(Date.now())) return tr.t('Today');
  if (f === fechaDe(Date.now() - 864e5)) return tr.t('Yesterday');
  const d = new Date(ts).toLocaleDateString(tr.locale, { weekday: 'long', day: 'numeric', month: 'long' });
  return d[0].toUpperCase() + d.slice(1);
}
