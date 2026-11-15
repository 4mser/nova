/* Standup del equipo: cada día, qué hice ayer, qué haré hoy y qué me bloquea. Se publica en la bitácora de la crew
   como una entrada de tipo «standup» con el contenido en JSON, para mostrarlo ordenado. */
import { fechaDe } from '../engine/diario';
import { escribirBitacora, type EntradaCrew } from './datos';

export type Standup = { ayer: string; hoy: string; bloqueo?: string };

export function leerStandup(e: EntradaCrew): Standup | null {
  if (e.tipo !== 'standup') return null;
  try { const j = JSON.parse(e.texto); return { ayer: String(j.ayer ?? ''), hoy: String(j.hoy ?? ''), bloqueo: j.bloqueo ? String(j.bloqueo) : undefined }; }
  catch { return { ayer: '', hoy: e.texto }; }
}

/** quién hizo su standup hoy (el último de cada uno) */
export function standupsDeHoy(entradas: EntradaCrew[] | undefined, ahora = Date.now()) {
  const hoy = fechaDe(ahora), m = new Map<string, EntradaCrew>();
  for (const e of entradas ?? []) if (e.tipo === 'standup' && fechaDe(e.ts) === hoy && e.usuario && !m.has(e.usuario)) m.set(e.usuario, e);
  return m;
}

export async function publicarStandup(crew: string, s: Standup) {
  const limpio: Standup = { ayer: s.ayer.trim(), hoy: s.hoy.trim(), ...(s.bloqueo?.trim() ? { bloqueo: s.bloqueo.trim() } : {}) };
  return escribirBitacora(crew, JSON.stringify(limpio), 'standup');
}
