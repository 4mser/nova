/* Recordatorios diarios de NOVA (notificaciones locales, funcionan con la app cerrada):
   · la mañana (8:00): cómo parte el día — eventos de la agenda, tareas que vencen, hábitos y el mejor hueco para foco
   · el check-in (21:00): solo si ese día todavía no lo hiciste
   Se reagendan cada vez que algo cambia (abrir la app, terminar el check-in, leer la agenda), con los datos de ese
   momento: así el aviso de mañana ya trae la agenda de mañana. Cada uno se apaga en Tú. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { aCargo } from './datos';
import * as Notifications from 'expo-notifications';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { useAhora } from '../ui/ahora';
import { avanceCheckIn } from '../ui/CheckIn';
import { fechaDe, useDiario } from '../engine/diario';
import { useHabitos } from '../engine/habitos';
import { traductorActual, useIdioma } from '../i18n';
import { ultimos, useHistoria } from '../sensores/historia';
import { delDia, huecos, useAgenda } from '../sensores/agenda';
import { leerClima, proximaLluvia } from '../sensores/clima';
import { useBitacora, useTareas, type Tarea } from './datos';
import { standupsDeHoy } from './standup';
import { configurarAvisos } from './momento';
import { useCrew, useSesion } from './sesion';

type Ajustes = { manana: boolean; checkin: boolean; standup: boolean; habitos: boolean; dormir: boolean };
const CLAVE = 'nova.recordatorios.v1';
let ajustes: Ajustes = { manana: true, checkin: true, standup: true, habitos: true, dormir: true };
const oyentes = new Set<() => void>();
export async function cargarRecordatorios() {
  try { const t = await AsyncStorage.getItem(CLAVE); if (t) { ajustes = { ...ajustes, ...JSON.parse(t) }; oyentes.forEach(o => o()); } } catch {}
}
export function cambiarRecordatorio(k: keyof Ajustes, v: boolean) {
  ajustes = { ...ajustes, [k]: v };
  AsyncStorage.setItem(CLAVE, JSON.stringify(ajustes)).catch(() => {});
  oyentes.forEach(o => o());
}
const leer = () => ajustes;
/** lo que está encendido ahora (para NOVA) */
export const leerRecordatorios = () => ajustes;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useRecordatoriosAjustes() { return useSyncExternalStore(suscribir, leer, leer); }

/** a las h:00 de hoy si todavía no pasa; si no, de mañana */
const proxima = (h: number, ahora: number) => { const d = new Date(ahora); d.setHours(h, 0, 0, 0); if (d.getTime() <= ahora + 60e3) d.setDate(d.getDate() + 1); return d; };

async function agendar(d: { pendientes: string[]; acostarse: number | null; conCrew: boolean; standupHecho: boolean; checkinHecho: boolean; tareas: Tarea[]; yo?: string; habitos: number; eventos: ReturnType<typeof useAgenda>['eventos']; agendaLeida: boolean }) {
  if (Platform.OS === 'web' || !(await Notifications.getPermissionsAsync()).granted) return;
  await configurarAvisos();
  const previas = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(previas.filter(n => ['manana', 'checkin', 'standup', 'habitos', 'dormir'].includes((n.content.data as { nova?: string } | undefined)?.nova ?? '')).map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  const { t, tp, locale } = traductorActual(), ahora = Date.now();

  if (ajustes.checkin) {
    // si hoy ya está hecho, el de mañana
    const cuando = proxima(21, ahora);
    if (d.checkinHecho && fechaDe(cuando.getTime()) === fechaDe(ahora)) cuando.setDate(cuando.getDate() + 1);
    await Notifications.scheduleNotificationAsync({
      content: { title: t('How was your day?'), body: t('Your check-in takes a minute. It is what lets me see how you are doing.'), data: { nova: 'checkin', url: '/journal' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: cuando, channelId: 'recordatorios' },
    }).catch(() => {});
  }

  // 20:00: los hábitos que hoy te faltan (si ya pasó la hora o no falta ninguno, no hay aviso hoy)
  if (ajustes.habitos && d.pendientes.length) {
    const cuando = new Date(ahora); cuando.setHours(20, 0, 0, 0);
    if (cuando.getTime() > ahora + 60e3) await Notifications.scheduleNotificationAsync({
      content: { title: tp(d.pendientes.length, '{n} habit left today', '{n} habits left today'), body: d.pendientes.slice(0, 3).join(' · '), data: { nova: 'habitos', url: '/' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: cuando, channelId: 'recordatorios' },
    }).catch(() => {});
  }
  // hora de dormir: 30 min antes de tu hora habitual (promedio real de la última semana)
  if (ajustes.dormir && d.acostarse != null) {
    const cuando = new Date(ahora), h = Math.floor(d.acostarse / 60) % 24, m = d.acostarse % 60;
    cuando.setHours(h, m, 0, 0);
    cuando.setTime(cuando.getTime() - 30 * 60e3);
    if (cuando.getTime() <= ahora + 60e3) cuando.setDate(cuando.getDate() + 1);
    const hh = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    await Notifications.scheduleNotificationAsync({
      content: { title: t('Bedtime in 30 minutes'), body: t('You usually go to sleep around {h}. Start winding down: screens off, lights low.', { h: hh }), data: { nova: 'dormir', url: '/' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: cuando, channelId: 'recordatorios' },
    }).catch(() => {});
  }

  // standup: 9:30 de lunes a viernes, solo con crew; si hoy ya está hecho, el próximo día hábil
  if (ajustes.standup && d.conCrew) {
    const cuando = proxima(9, ahora); cuando.setMinutes(30);
    if (cuando.getTime() <= ahora || (d.standupHecho && fechaDe(cuando.getTime()) === fechaDe(ahora))) cuando.setDate(cuando.getDate() + 1);
    while (cuando.getDay() === 0 || cuando.getDay() === 6) cuando.setDate(cuando.getDate() + 1);
    await Notifications.scheduleNotificationAsync({
      content: { title: t('Standup time'), body: t('Yesterday, today and what blocks you. Thirty seconds for your crew.'), data: { nova: 'standup', url: '/standup' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: cuando, channelId: 'recordatorios' },
    }).catch(() => {});
  }

  if (ajustes.manana) {
    const cuando = proxima(8, ahora), dia = cuando.getTime(), fecha = fechaDe(dia);
    const hora = (ts: number) => new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
    const partes: string[] = [];
    if (d.agendaLeida) {
      const evs = delDia(d.eventos, dia).filter(e => !e.todoElDia);
      partes.push(evs.length ? tp(evs.length, '{n} event, first at {h} ({x})', '{n} events, first at {h} ({x})', { h: hora(evs[0].ini), x: evs[0].titulo }) : t('nothing on your calendar'));
    }
    const vencen = d.tareas.filter(x => !x.hecha && x.vence && x.vence <= fecha && (!x.crew || aCargo(x).includes(d.yo ?? '')));
    if (vencen.length) partes.push(tp(vencen.length, '{n} task due', '{n} tasks due'));
    if (d.habitos) partes.push(tp(d.habitos, '{n} habit', '{n} habits'));
    const hueco = d.agendaLeida ? huecos(d.eventos, new Date(dia).setHours(8, 0, 0, 0)).find(x => x.fin - x.ini >= 60 * 60e3) : undefined;
    let cuerpo = partes.length ? t('Today: {x}.', { x: partes.join(' · ') }) : t('A new day. Tell me how you slept and I will help you plan it.');
    // el clima del día que toca (el aviso de mañana se arma con el pronóstico de mañana)
    const { clima } = leerClima();
    if (clima) {
      const d = fechaDe(dia) === fechaDe(ahora) ? clima.hoy : clima.manana;
      const lluvia = fechaDe(dia) === fechaDe(ahora) ? proximaLluvia(clima, dia) : undefined;
      cuerpo = `${Math.round(d.max)}°/${Math.round(d.min)}°${d.lluvia >= 50 ? ` · ${lluvia ? t('rain around {h}', { h: hora(lluvia.ts) }) : t('rain likely')}` : ''}. ${cuerpo}`;
    }
    if (hueco) cuerpo += ' ' + t('Best gap for focus: {a}–{b}.', { a: hora(hueco.ini), b: hora(hueco.fin) });
    await Notifications.scheduleNotificationAsync({
      content: { title: t('Good morning'), body: `${cuerpo} ${t('Tap and Nova will tell you about your day.')}`, data: { nova: 'manana', url: '/buenosdias' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: cuando, channelId: 'recordatorios' },
    }).catch(() => {});
  }
}

/** se monta una vez (en el layout, con sesión): reagenda cuando cambia lo que entra en los avisos, con un respiro */
export function useRecordatorios(activo: boolean) {
  const { registros } = useDiario(), { datos: tareas } = useTareas(), { habitos } = useHabitos(), { eventos, leido } = useAgenda();
  const a = useRecordatoriosAjustes(), { usuario } = useSesion(), crew = useCrew(), { datos: bitacora } = useBitacora(crew?.id ?? null);
  const ahora = useAhora(5 * 60e3), hoy = registros[fechaDe(ahora)], checkinHecho = avanceCheckIn(hoy).completo;
  const standupHecho = !!usuario && standupsDeHoy(bitacora, ahora).has(usuario.id);
  const { marcas } = useHabitos(), { dias } = useHistoria(), { t } = useIdioma();
  const pendientes = habitos.filter(h => !marcas[fechaDe(ahora)]?.includes(h.id)).map(h => t(h.nombre));
  // hora habitual de acostarse: promedio de la última semana (minutos desde medianoche, las 00:30 cuentan como 24:30)
  const inicios = ultimos(dias, 7).map(x => x.suenoIni).filter((x): x is number => x != null).map(ts => { const f = new Date(ts); const m = f.getHours() * 60 + f.getMinutes(); return m < 12 * 60 ? m + 24 * 60 : m; });
  const acostarse = inicios.length >= 3 ? Math.round(inicios.reduce((a, b) => a + b, 0) / inicios.length) : null;
  const firma = [activo, fechaDe(ahora), pendientes.join(), acostarse, a.habitos, a.dormir, checkinHecho, standupHecho, !!crew, a.manana, a.checkin, a.standup, habitos.length, leido, eventos.length, (tareas ?? []).filter(x => !x.hecha).map(x => `${x.id}${x.vence}`).join()].join('|');
  useEffect(() => {
    if (!activo) return;
    const id = setTimeout(() => { agendar({ pendientes, acostarse, conCrew: !!crew, standupHecho, checkinHecho, tareas: tareas ?? [], yo: usuario?.id, habitos: habitos.length, eventos, agendaLeida: !!leido }); }, 2000);
    return () => clearTimeout(id);
  }, [firma]); // eslint-disable-line react-hooks/exhaustive-deps
}
