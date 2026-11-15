/* Resumen de la semana: los últimos 7 días contra los 7 anteriores, con lo que de verdad se midió (Health Connect,
   check-ins, foco, hábitos y tareas). Las observaciones salen solo de tus datos y solo con muestras suficientes;
   nunca son diagnósticos. */
import type { Traductor } from '../i18n';
import type { Dia } from '../sensores/historia';
import { ESCALAS, fechaDe, nivelDe, type Registro } from './diario';
import type { Sesion } from './foco';
import type { Habito } from './habitos';

export type Semana = {
  desde: string; hasta: string;
  sueno?: { prom: number; antes?: number; mejor?: { fecha: string; h: number } };
  pasos?: { prom: number; antes?: number; diasMeta: number };
  foco: { min: number; antes: number; aprender: number; sesiones: number; mejor?: { fecha: string; min: number } };
  animo?: { prom: number; antes?: number; dias: number; mejor?: string; emociones: string[] };
  habitos: { nombre: string; dias: number }[];
  tareas: number;
  notas: string[];
  proxima?: string;
};

const prom = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const fechas = (n: number, hasta: number) => Array.from({ length: n }, (_, i) => fechaDe(hasta - (n - 1 - i) * 864e5));

export function calcularSemana(tr: Traductor, d: {
  ahora: number; historia: Record<string, Dia>; registros: Record<string, Registro>; sesiones: Sesion[];
  habitos: Habito[]; marcas: Record<string, string[]>; tareasHechas: number[]; metaPasos: number;
}): Semana {
  const { t, locale } = tr;
  const esta = fechas(7, d.ahora), antes = fechas(7, d.ahora - 7 * 864e5);
  const dia = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString(locale, { weekday: 'long' });
  const s: Semana = { desde: esta[0], hasta: esta[6], foco: { min: 0, antes: 0, aprender: 0, sesiones: 0 }, habitos: [], tareas: 0, notas: [] };

  // sueño y pasos (Health Connect)
  const sue = (fs: string[]) => fs.map(f => [f, d.historia[f]?.suenoH] as const).filter((x): x is readonly [string, number] => x[1] != null);
  const sE = sue(esta), sA = sue(antes);
  if (sE.length) { const m = [...sE].sort((a, b) => b[1] - a[1])[0]; s.sueno = { prom: prom(sE.map(x => x[1]))!, antes: prom(sA.map(x => x[1])), mejor: { fecha: m[0], h: m[1] } }; }
  const pas = (fs: string[]) => fs.map(f => d.historia[f]?.pasos).filter((x): x is number => x != null);
  const pE = pas(esta), pA = pas(antes);
  if (pE.length) s.pasos = { prom: prom(pE)!, antes: prom(pA), diasMeta: pE.filter(p => p >= d.metaPasos).length };

  // foco
  const enRango = (x: Sesion, fs: string[]) => fs.includes(fechaDe(x.ini));
  const fE = d.sesiones.filter(x => enRango(x, esta)), fA = d.sesiones.filter(x => enRango(x, antes));
  const porDia = new Map<string, number>();
  for (const x of fE) porDia.set(fechaDe(x.ini), (porDia.get(fechaDe(x.ini)) ?? 0) + x.min);
  const mejorFoco = [...porDia].sort((a, b) => b[1] - a[1])[0];
  s.foco = { min: fE.filter(x => x.tipo === 'foco').reduce((a, x) => a + x.min, 0), antes: fA.filter(x => x.tipo === 'foco').reduce((a, x) => a + x.min, 0), aprender: fE.filter(x => x.tipo === 'aprender').reduce((a, x) => a + x.min, 0), sesiones: fE.length, mejor: mejorFoco ? { fecha: mejorFoco[0], min: mejorFoco[1] } : undefined };

  // ánimo (check-in)
  const ani = (fs: string[]) => fs.map(f => [f, d.registros[f]?.valores.animo] as const).filter((x): x is readonly [string, number] => x[1] != null);
  const aE = ani(esta), aA = ani(antes);
  if (aE.length) {
    const cuenta = new Map<string, number>();
    for (const f of esta) for (const e of d.registros[f]?.emociones ?? []) cuenta.set(e, (cuenta.get(e) ?? 0) + 1);
    s.animo = { prom: prom(aE.map(x => x[1]))!, antes: prom(aA.map(x => x[1])), dias: aE.length, mejor: [...aE].sort((a, b) => b[1] - a[1])[0][0], emociones: [...cuenta].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e]) => e) };
  }

  s.habitos = d.habitos.map(h => ({ nombre: h.nombre, dias: esta.filter(f => d.marcas[f]?.includes(h.id)).length }));
  s.tareas = d.tareasHechas.filter(ts => esta.includes(fechaDe(ts))).length;

  // observaciones: solo con al menos 2 días en cada grupo
  const animoCon = (cond: (f: string) => boolean | null) => {
    const si: number[] = [], no: number[] = [];
    for (const f of [...antes, ...esta]) { const a = d.registros[f]?.valores.animo, c = cond(f); if (a == null || c == null) continue; (c ? si : no).push(a); }
    return si.length >= 2 && no.length >= 2 ? [prom(si)!, prom(no)!] as const : null;
  };
  const escala = ESCALAS[0], palabra = (v: number) => nivelDe(tr, escala, Math.max(1, Math.min(5, Math.round(v)))).toLowerCase();
  const porSueno = animoCon(f => { const h = d.historia[f]?.suenoH; return h == null ? null : h >= 7; });
  if (porSueno && Math.abs(porSueno[0] - porSueno[1]) >= 0.4) s.notas.push(t('The days you slept 7 h or more your mood averaged «{a}»; the others, «{b}».', { a: palabra(porSueno[0]), b: palabra(porSueno[1]) }));
  const porMover = animoCon(f => { const p = d.historia[f]?.pasos; return p == null ? null : p >= d.metaPasos; });
  if (porMover && porMover[0] - porMover[1] >= 0.4) s.notas.push(t('On days with {n}+ steps your mood was better: «{a}» against «{b}».', { n: d.metaPasos.toLocaleString(locale), a: palabra(porMover[0]), b: palabra(porMover[1]) }));
  const porFoco = animoCon(f => (porDiaTodos(d.sesiones, f) > 0 ? true : false));
  if (porFoco && porFoco[0] - porFoco[1] >= 0.4) s.notas.push(t('Days with a focus session felt better: «{a}» against «{b}».', { a: palabra(porFoco[0]), b: palabra(porFoco[1]) }));
  if (s.foco.mejor && s.foco.mejor.min >= 30) s.notas.push(t('Your best focus day was {dia}: {n} min.', { dia: dia(s.foco.mejor.fecha), n: s.foco.mejor.min }));
  if (s.animo?.mejor && s.animo.dias >= 3) s.notas.push(t('Your best day by mood: {dia}.', { dia: dia(s.animo.mejor) }));

  // una sola sugerencia para la próxima semana: lo que más se puede mejorar
  if (s.sueno && s.sueno.prom < 6.8) s.proxima = t('Sleep. Try going to bed 30 minutes earlier on weeknights.');
  else if (s.pasos && s.pasos.diasMeta <= 2) s.proxima = t('Movement. A 20-minute walk after lunch is usually enough to reach your steps.');
  else if (s.foco.sesiones < 3) s.proxima = t('Focus. Book three 25-minute sessions in your calendar, on the days you know are calmer.');
  else if (s.animo && s.animo.dias < 4) s.proxima = t('Check-in. Doing it most days is what lets me find patterns for you.');
  else if (s.habitos.some(h => h.dias <= 2)) s.proxima = t('Habits. Pick the one you skipped most and tie it to something you already do every day.');
  return s;
}

const porDiaTodos = (ses: Sesion[], f: string) => ses.filter(x => fechaDe(x.ini) === f).reduce((a, x) => a + x.min, 0);
