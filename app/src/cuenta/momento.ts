/* El momento NOVA: una vez al día, a una hora sorpresa (la misma para toda la crew), NOVA avisa «¡Momento de la crew!»
   y cada uno tiene 10 minutos para compartir una foto espontánea. La hora la decide la API; aquí se agendan las
   notificaciones locales de los próximos 7 días (funcionan con la app cerrada, sin servidor de push). */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { traductorActual } from '../i18n';
import { empezar } from '../engine/foco';
import { pedir } from './api';

const CANAL = 'momento';
let configurado = false;

/** cómo se muestran los avisos con la app abierta + canales de Android (el del momento y el de la crew, para los push) */
export async function configurarAvisos() {
  if (configurado || Platform.OS === 'web') return;
  configurado = true;
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
  if (Platform.OS === 'android') {
    const { t } = traductorActual();
    await Notifications.setNotificationChannelAsync(CANAL, { name: t('Crew moment'), importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 180, 120, 180], lightColor: '#8fe6f5' }).catch(() => {});
    await Notifications.setNotificationChannelAsync('recordatorios', { name: t('Reminders'), importance: Notifications.AndroidImportance.DEFAULT }).catch(() => {});
    await Notifications.setNotificationChannelAsync('crew', { name: t('Crew activity'), importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 120], lightColor: '#8fe6f5' }).catch(() => {});
  }
}

export async function permisoAvisos() {
  if (Platform.OS === 'web') return false;
  await configurarAvisos();
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return true;
  if (!p.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** agenda los momentos de la crew (borra los anteriores de NOVA); se llama al abrir la app y al cambiar de crew */
export async function agendarMomentos(crew: { id: string; nombre: string } | null) {
  if (Platform.OS === 'web') return;
  try {
    const previas = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(previas.filter(n => (n.content.data as { nova?: string } | undefined)?.nova === 'momento').map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    if (!crew || !(await permisoAvisos())) return;
    const lista = await pedir<{ fecha: string; ts: number }[]>(`/v1/crews/${crew.id}/momentos?dias=7`);
    const { t } = traductorActual();
    for (const m of lista) {
      if (m.ts < Date.now() + 5e3) continue;
      await Notifications.scheduleNotificationAsync({
        content: { title: t('Crew moment'), body: t('You have 10 minutes to share what you are doing with {crew}.', { crew: crew.nombre }), data: { nova: 'momento', url: '/compartir?momento=1' } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(m.ts), channelId: CANAL },
      });
    }
  } catch {}
}

/** el resumen de la semana: un aviso cada domingo a las 19:30 que abre /resumen (se reagenda al abrir la app) */
export async function agendarResumen() {
  if (Platform.OS === 'web' || !(await Notifications.getPermissionsAsync()).granted) return;
  try {
    await configurarAvisos();
    const previas = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(previas.filter(n => (n.content.data as { nova?: string } | undefined)?.nova === 'resumen').map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    const { t } = traductorActual();
    await Notifications.scheduleNotificationAsync({
      content: { title: t('Your week with Nova'), body: t('Sleep, focus, mood and what I noticed. Two minutes.'), data: { nova: 'resumen', url: '/resumen' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 1, hour: 19, minute: 30, channelId: 'recordatorios' },
    });
  } catch {}
}

/** empieza una sesión de foco y agenda el aviso del final (suena aunque la app esté cerrada) */
export async function iniciarFoco(min: number, tipo: 'foco' | 'aprender', que?: string) {
  const { t } = traductorActual();
  let aviso: string | undefined;
  if (Platform.OS !== 'web' && (await permisoAvisos())) {
    aviso = await Notifications.scheduleNotificationAsync({
      content: { title: t(tipo === 'foco' ? 'Focus session done' : 'Learning session done'), body: t('{n} minutes. Take a short break, you earned it.', { n: min }), data: { nova: 'foco', url: '/foco' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + min * 60e3), channelId: CANAL },
    }).catch(() => undefined);
  }
  empezar(min, tipo, que, aviso);
}
