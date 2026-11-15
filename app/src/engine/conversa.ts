/* Conversación de NOVA (etapa 1): reglas sobre el estado estructurado, sin LLM.
   Regla del contrato: toda afirmación de salud sale de la evidencia; si no la hay, NOVA lo dice. */
import { traductor, traductorActual, type Traductor } from '../i18n';
import { hh, hoy } from './motor';

/** `grafico`: tarjeta visual que NOVA muestra en la conversación (ver src/ui/TarjetasNova.tsx) */
export type Msg = { id: string; de: 'nova' | 'yo'; texto: string; refs?: string[]; tarjeta?: Entendido; voz?: boolean; grafico?: string; accion?: { icono: string; texto: string; ir?: string; donde?: string }; visual?: import('../voz/acciones').Visual };
export type Entendido = { animo: string; estres: string; fatiga: string };

let n = 0;
export const id = () => `m${++n}`;

const tiene = (t: string, ws: string[]) => ws.some(w => t.includes(w));

/** reglas locales (sin servidor): entiende inglés y español y responde en el idioma de la app */
export function responder(texto: string, tr: Traductor = traductorActual()): Msg {
  const t = texto.toLowerCase(), H = hoy(tr), { t: tx } = tr;
  const [vfc] = H.inf.evidencia;
  if (tiene(t, ['how am i', 'how are we', 'cómo estoy', 'como estoy', 'cómo voy', 'como voy'])) {
    return { id: id(), de: 'nova', refs: H.resp.evidenceRefs, texto: H.resp.mensaje };
  }
  if (tiene(t, ['why', 'readiness', 'hrv', 'recover', 'variab', 'por qué', 'por que', 'preparación', 'preparacion', 'vfc', 'recuper'])) {
    return { id: id(), de: 'nova', refs: ['ev-rmssd', 'ev-sueno'], texto: tx('Two things. Your HRV is {vfc} ms against your usual {base} ms, and you slept {sueno}. Together they lower your readiness to {prep}. Both readings are simulated in this prototype.', { vfc: H.vfc, base: Math.round(vfc.base), sueno: hh(H.sueno), prep: H.preparacion }) };
  }
  if (tiene(t, ['sleep', 'slept', 'tired', 'rest', 'sueño', 'dorm', 'cansad', 'descans'])) {
    return { id: id(), de: 'nova', refs: ['ev-sueno'], texto: tx('You slept {sueno}, below your usual for the third night. A 20 minute rest after lunch would help, and I can dim the cabin lights an hour earlier tonight.', { sueno: hh(H.sueno) }) };
  }
  if (tiene(t, ['dose', 'radiation', 'msv', 'storm', 'sun', 'dosis', 'radiaci', 'tormenta'])) {
    return { id: id(), de: 'nova', texto: tx("Your mission dose is {dosis} mSv, {p}% of your career limit. Today you're adding about {dia} mSv. No solar storm in the forecast.", { dosis: H.dosis, p: Math.round((H.dosis / H.limite) * 100), dia: H.dosisDia }) };
  }
  if (tiene(t, ['eva', 'spacewalk', 'walk', 'clear', 'caminata', 'salir'])) {
    return { id: id(), de: 'nova', refs: ['ev-rmssd', 'ev-sueno'], texto: tx("That decision belongs to your flight surgeon. I've sent them your readiness of {prep} and the evidence behind it, so you'll hear back before the briefing.", { prep: H.preparacion }) };
  }
  if (tiene(t, ['heart', 'pulse', 'bpm', 'lpm', 'corazón', 'corazon', 'pulso', 'latido'])) {
    return { id: id(), de: 'nova', texto: tx('Your heart is at {fc} bpm, steady and inside your range. The trace on Body is simulated until we pair the chest strap.', { fc: H.fc }) };
  }
  if (/\b(hi|hello|hey|nova|hola|buenas)\b/.test(t)) {
    return { id: id(), de: 'nova', texto: tx('Hi {nombre}. Ask me about your readiness, your sleep or your dose, or start your evening check-in.', { nombre: H.nombre }) };
  }
  return { id: id(), de: 'nova', texto: tx('I can only talk about what I measure: heart, sleep, mood, training and radiation. For anything else, your crew and the flight surgeon are the right people.') };
}

/** check-in de la tarde: lo que NOVA entendió del texto libre (en inglés o español). Devuelve los valores en inglés
    (los mismos que manda Gemini); la tarjeta los traduce al mostrarlos */
export function entender(texto: string): Entendido {
  const t = texto.toLowerCase();
  const animo = tiene(t, ['bad', 'awful', 'sad', 'lonely', 'miss', 'angry', 'estoy mal', 'me fue mal', 'muy mal', 'fatal', 'no muy bien', 'no tan bien', 'horrible', 'triste', 'soledad', 'me siento sol', 'extraño', 'echo de menos', 'enojad', 'rabia'])
    ? 'Low' : tiene(t, ['great', 'amazing', 'happy', 'good', 'well', 'fine', 'genial', 'increíble', 'feliz', 'bien', 'tranquil', 'excelente']) ? 'Good' : 'Okay';
  const estres = tiene(t, ['stress', 'anxious', 'worried', 'pressure', 'argument', 'angry', 'estrés', 'estres', 'ansios', 'preocupad', 'presión', 'presion', 'discusi', 'pelea', 'enojad'])
    ? 'High' : tiene(t, ['busy', 'long', 'hard', 'ocupad', 'largo', 'difícil', 'dificil', 'duro', 'pesado']) ? 'Moderate' : 'Low';
  const fatiga = tiene(t, ['exhausted', 'drained', 'very tired', 'agotad', 'exhaust', 'muy cansad', 'reventad'])
    ? 'High' : tiene(t, ['tired', 'sleepy', 'long day', 'cansad', 'sueño', 'día largo', 'dia largo']) ? 'Mild' : 'None';
  return { animo, estres, fatiga };
}

/** los datos del día en texto, para darle contexto a NOVA en la conversación en vivo (todo SIMULATED).
    Va en inglés a propósito: es contexto para el modelo, no algo que vea el astronauta */
export function datosDelDia(): string {
  const H = hoy(traductor('en')), [vfc, sueno] = H.inf.evidencia;
  return [
    `Recovery assessment: ${H.inf.estado === 'elevated' ? 'incomplete recovery' : 'normal'} (model ${H.inf.modelo} v${H.inf.version}, confidence ${H.inf.confianza}, signal quality ${Math.round(H.inf.calidad * 100)}%).`,
    `Heart rate variability (RMSSD): ${Math.round(vfc.valor)} ms today, usual ${Math.round(vfc.base)} ms (${Math.round(vfc.delta * 100)}%).`,
    `Sleep last night: ${hh(sueno.valor)}, usual ${hh(sueno.base)}; deep sleep ${hh(H.suenoProfundo)}. Third short night in a row.`,
    `Resting heart rate ${H.fc} bpm. SpO2 ${H.spo2}%. Skin temperature ${H.piel} °C. Respiration ${H.resp_min} per minute.`,
    `Readiness ${H.preparacion}/100, usual range ${H.habitual - 8}-${H.habitual + 8}.`,
    `Radiation: mission dose ${H.dosis} mSv, ${Math.round((H.dosis / H.limite) * 100)}% of career limit, about ${H.dosisDia} mSv today. No solar storm forecast.`,
    `Training today: resistance ${H.ejercicio.fuerza[0]} of ${H.ejercicio.fuerza[1]} min (ARED), cardio ${H.ejercicio.cardio[0]} of ${H.ejercicio.cardio[1]} min.`,
    `Microgravity: hip bone density ${H.hueso}% per month (expected; resistance training slows it), leg muscle ${H.musculo}% of launch mass.`,
    `Today's plan (ship time): 08:30 breakfast and medication (done), 10:00 spacewalk prep with Kenji in Node 2 (now), 13:30 resistance training, 16:00 science block (plant growth module), 21:00 evening check-in.`,
    `Private session with Dr. Elena Ruiz (she/her; flight psychologist on Earth, 18 min signal delay): Saturday 10:00 ship time.`,
    `Mission: cruise to Mars, Sol ${H.sol}, 62% of transit. Crew of 4. The chest strap (Polar H10) is not paired yet, so all readings are simulated.`,
  ].join('\n');
}
