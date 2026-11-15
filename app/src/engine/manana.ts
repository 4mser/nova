/* El resumen de la mañana: lo que NOVA te cuenta al empezar el día, en frases cortas (así la voz arranca al tiro y
   cada frase aparece mientras la dice). Solo con datos reales: cómo dormiste, el clima, tu agenda con la rutina,
   tareas y recordatorios de hoy, revisiones en GitHub, hábitos y el mejor hueco para concentrarte. */
import { leerCache, type Tarea, CLAVE_TAREAS, aCargo } from '../cuenta/datos';
import { leerSesion } from '../cuenta/sesion';
import type { Traductor } from '../i18n';
import { delDia, huecos, leerAgendaActual } from '../sensores/agenda';
import { leerClima, proximaLluvia, tipoClima } from '../sensores/clima';
import { leerHistoriaActual } from '../sensores/historia';
import { fechaDe } from './diario';
import { leerHabitos, tocaEl } from './habitos';
import { leerRecordatoriosPropios } from './recordatoriosPropios';

export type Manana = { frases: string[]; datos: { clima?: { temp: number; max: number; min: number; icono: string; texto: string }; eventos: { hora: string; titulo: string }[]; tareas: string[]; habitos: string[]; hueco?: string } };

export function componerManana(tr: Traductor, ahora = Date.now()): Manana {
  const { t, tp, locale } = tr;
  const hora = (ts: number) => new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  const hoy = fechaDe(ahora), frases: string[] = [];
  const nombre = (leerSesion().usuario?.nombre ?? '').split(/\s+/)[0];
  const h = new Date(ahora).getHours();

  // saludo y sueño
  const sueno = leerHistoriaActual().dias[hoy]?.suenoH;
  const saludo = h < 12 ? t('Good morning, {n}.', { n: nombre }) : h < 20 ? t('Good afternoon, {n}.', { n: nombre }) : t('Good evening, {n}.', { n: nombre });
  frases.push(sueno ? `${saludo} ${t('You slept {h} h {m} min.', { h: Math.floor(sueno), m: Math.round((sueno % 1) * 60) })}` : saludo);

  // clima
  const { clima } = leerClima();
  let climaD: Manana['datos']['clima'];
  if (clima) {
    const tipo = tipoClima(clima.hoy.codigo), lluvia = proximaLluvia(clima, ahora);
    climaD = { temp: Math.round(clima.ahora.temp), max: Math.round(clima.hoy.max), min: Math.round(clima.hoy.min), icono: tipo.icono, texto: t(tipo.t) };
    frases.push(t('Today: {c}, between {min}° and {max}°.', { c: t(tipo.t).toLowerCase(), min: climaD.min, max: climaD.max }) + (lluvia ? ` ${t('Take an umbrella: rain around {h}.', { h: hora(lluvia.ts) })}` : ''));
  }

  // agenda (con tu rutina)
  const { eventos } = leerAgendaActual();
  const deHoy = delDia(eventos, ahora).filter(e => !e.todoElDia && e.fin > ahora);
  if (deHoy.length) frases.push(tp(deHoy.length, 'You have {n} thing on your schedule: {x} at {h}.', 'You have {n} things on your schedule; the first, {x} at {h}.', { x: deHoy[0].titulo, h: hora(deHoy[0].ini) }));
  else frases.push(t('Your schedule is free today.'));

  // tareas y recordatorios
  const yo = leerSesion().usuario?.id;
  const tareas = (leerCache<Tarea[]>(CLAVE_TAREAS) ?? []).filter(x => !x.hecha && x.vence && x.vence <= hoy && (!x.crew || aCargo(x).includes(yo ?? '')));
  const recordatorios = leerRecordatoriosPropios().lista.filter(r => !r.hecho && r.cuando > ahora && fechaDe(r.cuando) === hoy);
  if (tareas.length || recordatorios.length) {
    const partes = [tareas.length ? tp(tareas.length, '{n} task for today, «{x}»', '{n} tasks for today, starting with «{x}»', { x: tareas[0]?.titulo ?? '' }) : '', recordatorios.length ? tp(recordatorios.length, '{n} reminder', '{n} reminders') : ''].filter(Boolean);
    frases.push(t('For today: {x}.', { x: partes.join(t(' and ')) }));
  }

  // GitHub
  const gh = leerCache<{ revisar: unknown[]; prs: unknown[] }>('github:resumen');
  if (gh?.revisar.length) frases.push(tp(gh.revisar.length, 'On GitHub, {n} review is waiting for you.', 'On GitHub, {n} reviews are waiting for you.'));

  // hábitos
  const habs = leerHabitos().habitos.filter(x => tocaEl(x, ahora));
  if (habs.length) frases.push(tp(habs.length, 'Today you have {n} habit: {x}.', 'Today you have {n} habits; start with {x}.', { x: t(habs[0].nombre).toLowerCase() }));

  // cierre: el mejor hueco para concentrarse
  const hueco = huecos(eventos, ahora).find(x => x.fin - x.ini >= 60 * 60e3);
  frases.push(hueco ? t('Your best gap to focus is {a} to {b}. Let’s go!', { a: hora(hueco.ini), b: hora(hueco.fin) }) : t('Have a great day. I am here if you need me.'));

  return {
    frases,
    datos: { clima: climaD, eventos: deHoy.slice(0, 4).map(e => ({ hora: hora(e.ini), titulo: e.titulo })), tareas: tareas.slice(0, 4).map(x => x.titulo), habitos: habs.map(x => t(x.nombre)), hueco: hueco ? `${hora(hueco.ini)}–${hora(hueco.fin)}` : undefined },
  };
}
