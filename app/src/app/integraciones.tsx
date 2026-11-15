/* Integraciones: todo lo que NOVA conecta, con su estado real y cómo conectarlo. Salud (Health Connect: Samsung
   Health, Google Fit, Fitbit, relojes), calendarios del teléfono (Google, Outlook…), reloj por Bluetooth, uso del
   teléfono, avisos, Spotify para el foco, clima, alarmas del Reloj, compartir desde otras apps, widgets y voz. */
import { Ionicons } from '@expo/vector-icons';
import { requireOptionalNativeModule } from 'expo';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAjustesCrew } from '../cuenta/datos';
import { NOMBRE_PROV, useIntegraciones } from '../cuenta/integraciones';
import { useCrew } from '../cuenta/sesion';
import { PLAYLISTS, useMusica } from '../engine/musica';
import { useIdioma } from '../i18n';
import { agendaDisponible, delDia, useAgenda } from '../sensores/agenda';
import { useClima } from '../sensores/clima';
import { useConsentimiento } from '../sensores/fuentes';
import { relojDisponible } from '../sensores/reloj';
import { saludDisponible } from '../sensores/salud';
import { usoDisponible } from '../sensores/uso';
import { useVivo } from '../sensores/vivo';
import { useAhora } from '../ui/ahora';
import { volver } from '../ui/volver';
import { C, Cel, Seccion, Txt } from '../ui/tema';

type Estado = 'ok' | 'conectar' | 'no';
type Integracion = { k: string; icono: keyof typeof Ionicons.glyphMap; color: string; t: string; d: string; estado: Estado; detalle: string; ir?: string };

export default function Integraciones() {
  const ins = useSafeAreaInsets(), { t } = useIdioma(), { c } = useConsentimiento(), v = useVivo(), agenda = useAgenda(), musica = useMusica(), { ciudad, clima } = useClima();
  const [avisos, setAvisos] = useState<boolean | null>(null), ahora = useAhora(60e3);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const leer = () => Notifications.getPermissionsAsync().then(p => setAvisos(p.granted), () => {});
    leer();
    const s = AppState.addEventListener('change', e => { if (e === 'active') leer(); });
    return () => s.remove();
  }, []);
  const web = Platform.OS === 'web', alarmas = !web && !!requireOptionalNativeModule('ExpoIntentLauncher');
  const playlist = musica.elegida === 'propia' ? musica.propiaNombre ?? t('your playlist') : PLAYLISTS.find(p => p.id === musica.elegida)?.nombre;
  const { datos: cuentas } = useIntegraciones(), sp = cuentas?.spotify, gh = cuentas?.github;
  const crew = useCrew(), { datos: aj } = useAjustesCrew(crew?.id ?? null);

  const lista: Integracion[] = [
    { k: 'salud', icono: 'fitness-outline', color: C.ok, t: 'Health Connect', d: t('Mi Fitness, Samsung Health, Zepp, Garmin and Fitbit: sleep, steps, heart, HRV.'),
      estado: !saludDisponible() ? 'no' : c.salud ? 'ok' : 'conectar', detalle: !saludDisponible() ? t('Android only') : c.salud ? (v.salud?.origenes.length ? t('Reading from {apps}', { apps: v.salud.origenes.join(', ') }) : t('Connected')) : t('Tap to connect'), ir: '/conectar-reloj' },
    { k: 'agenda', icono: 'calendar-outline', color: C.sig, t: t('Calendars'), d: t('Google Calendar, Outlook and any calendar synced on this phone. Read only.'),
      estado: !agendaDisponible() ? 'no' : c.agenda ? 'ok' : 'conectar', detalle: !agendaDisponible() ? t('Needs the newer app') : c.agenda ? t('{n} events today · choose which', { n: delDia(agenda.eventos, ahora).filter(e => !e.id.startsWith('rutina|')).length }) : t('Tap to connect'), ir: c.agenda ? '/integracion?k=calendario' : '/datos' },
    { k: 'reloj', icono: 'watch-outline', color: C.alerta, t: t('Watch or chest strap'), d: t('Huawei, Xiaomi, Samsung, Amazfit, Garmin and more: the steps for your brand.'),
      estado: !relojDisponible() ? 'no' : c.reloj ? 'ok' : 'conectar', detalle: !relojDisponible() ? t('Android only') : c.reloj ? (v.reloj.estado === 'conectado' ? t('Connected · {x}', { x: v.reloj.nombre ?? '' }) : t('On, searching')) : t('Tap to connect'), ir: '/conectar-reloj' },
    { k: 'avisos', icono: 'notifications-outline', color: C.aviso, t: t('Notifications'), d: t('Reminders, habits, your crew, the weekly summary and push from the team.'),
      estado: web ? 'no' : avisos ? 'ok' : 'conectar', detalle: web ? t('Phone only') : avisos ? t('On') : t('Off: tap to turn on'), ir: '/permisos' },
    { k: 'spotify', icono: 'musical-notes-outline', color: '#1DB954', t: 'Spotify', d: t('What is playing, your playlists and control from Nova; your focus playlist opens when focus starts.'),
      estado: sp?.conectado || (musica.elegida !== 'nada' && musica.elegida !== 'yt') ? 'ok' : 'conectar', detalle: sp?.conectado ? t('Connected as {x}', { x: sp.cuenta ?? '' }) : musica.elegida !== 'nada' && musica.elegida !== 'yt' ? t('Playlist: {x}', { x: t(playlist ?? '') }) : t('Connect your account'), ir: '/integracion?k=spotify' },
    { k: 'youtube', icono: 'logo-youtube', color: '#ff4e45', t: 'YouTube Music', d: t('If you use YouTube Music instead: your playlist opens when focus starts.'),
      estado: musica.elegida === 'yt' ? 'ok' : 'conectar', detalle: musica.elegida === 'yt' ? t('Focus playlist set') : t('Paste your playlist link'), ir: '/integracion?k=youtube' },
    { k: 'github', icono: 'logo-github', color: C.t1, t: 'GitHub', d: t('Your pull requests, reviews and assigned issues, as tasks and context for Nova.'),
      estado: gh?.conectado ? 'ok' : 'conectar', detalle: gh?.conectado ? t('Connected as {x}', { x: gh.cuenta ?? '' }) : gh && !gh.disponible ? t('Needs a 2-minute setup') : t('Connect your account'), ir: '/integracion?k=github' },
    { k: 'clima', icono: 'partly-sunny-outline', color: C.nova, t: t('Weather'), d: t('Open-Meteo, for your city. Nova uses it in the morning briefing and to warn you about rain.'),
      estado: 'ok', detalle: clima ? t('{c} · {n}°', { c: ciudad.nombre, n: Math.round(clima.ahora.temp) }) : ciudad.nombre, ir: '/perfil' },
    { k: 'reloj-app', icono: 'alarm-outline', color: C.lila, t: t('Clock app'), d: t('Nova sets real alarms and timers in your phone’s Clock: «wake me up at 7».'),
      estado: alarmas ? 'ok' : 'no', detalle: alarmas ? t('Ready, just ask Nova') : t('Needs the newer app') },
    { k: 'compartir', icono: 'share-social-outline', color: C.sig, t: t('Share to Nova'), d: t('From any app: Share → Nova, to save a link, a text or a photo as a task, a note or for the crew.'),
      estado: web ? 'no' : 'ok', detalle: web ? t('Phone only') : t('Ready') },
    { k: 'widgets', icono: 'apps-outline', color: C.ok, t: t('Home screen widgets'), d: t('Your day, habits and focus, and your crew photos, on the home screen.'),
      estado: Platform.OS === 'android' ? 'ok' : 'no', detalle: t('Hold the home screen → Widgets → NOVA') },
    { k: 'uso', icono: 'phone-portrait-outline', color: C.t2, t: t('Phone use'), d: t('Screen time and night use, for your rest. Never what you do inside apps.'),
      estado: !usoDisponible() ? 'no' : c.uso ? 'ok' : 'conectar', detalle: !usoDisponible() ? t('Android only') : c.uso ? t('Connected') : t('Tap to connect'), ir: '/datos' },
    ...(['strava', 'todoist', 'google', 'linear', 'notion'] as const).map(p => {
      const e = cuentas?.[p], m = MAS[p];
      return { k: p, icono: m.icono as keyof typeof Ionicons.glyphMap, color: m.color, t: NOMBRE_PROV[p], d: t(m.d), estado: (e?.conectado ? 'ok' : 'conectar') as Estado, detalle: e?.conectado ? t('Connected as {x}', { x: e.cuenta ?? '' }) : e && !e.disponible ? t('Needs a 2-minute setup') : t('Connect your account'), ir: `/integracion?k=${p}` };
    }),
  ];
  // lo de la crew: repos del equipo y canales donde NOVA también publica
  const deCrew: Item[] = crew ? [
    { k: 'gh-crew', icono: 'logo-github', color: C.t1, t: t('GitHub of the crew'), d: t('Failed deploys, broken CI, PRs and reviews of the team repos, to the right people.'), estado: gh?.conectado ? 'ok' : 'conectar', detalle: gh?.conectado ? t('Choose the repos') : t('Connect GitHub first'), ir: gh?.conectado ? '/github' : '/integracion?k=github' },
    { k: 'canales', icono: 'chatbubbles-outline', color: '#e2b4f5', t: 'Slack · Discord', d: t('Nova posts standups, blockers, GitHub, meeting notes and the weekly summary in your channel.'), estado: aj?.slack || aj?.discord ? 'ok' : 'conectar', detalle: aj?.slack || aj?.discord ? [aj.slack && 'Slack', aj.discord && 'Discord'].filter(Boolean).join(' · ') : t('A webhook per channel'), ir: '/crew-conexiones' },
    { k: 'notion-crew', icono: 'document-text-outline', color: C.t1, t: t('Notion of the crew'), d: t('The weekly summary and every meeting, as pages in your workspace.'), estado: aj?.notion ? 'ok' : 'conectar', detalle: aj?.notion?.titulo ?? t('Choose a page'), ir: '/crew-conexiones' },
  ] : [];
  const conectadas = [...lista, ...deCrew].filter(x => x.estado === 'ok').length, total = lista.length + deCrew.length;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: ins.bottom + 30 }}>
        <Txt f="s" size={30} ls={-1.2} lh={34}>{t('Integrations')}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6 }}>{t('{a} of {b} connected. The more you connect, the more Nova knows and the less you have to tell it.', { a: conectadas, b: total })}</Txt>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: C.l2, marginTop: 12 }}>
          <View style={{ width: `${(conectadas / total) * 100}%`, height: 6, borderRadius: 3, backgroundColor: C.nova }} />
        </View>

        {deCrew.length ? <><Seccion t={t('For your crew')} /><View style={{ gap: 8 }}>{deCrew.map(x => <FilaInt key={x.k} x={x} />)}</View></> : null}
        <Seccion t={t('Yours')} />
        <View style={{ gap: 8 }}>
          {lista.map(x => <FilaInt key={x.k} x={x} />)}
        </View>

        <Seccion t={t('Coming next')} />
        <Cel style={{ gap: 12 }}>
          {[{ t: 'Jira', d: t('Your assigned issues next to your tasks'), i: 'albums-outline' }, { t: 'Outlook · Microsoft Teams', d: t('Meetings and chats from work, with permission'), i: 'mail-outline' }, { t: 'Figma', d: t('Comments on your files as tasks'), i: 'color-palette-outline' }].map(x => (
            <View key={x.t} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name={x.i as keyof typeof Ionicons.glyphMap} size={18} color={C.t3} />
              <View style={{ flex: 1 }}>
                <Txt f="m" size={14.5} color={C.t2}>{x.t}</Txt>
                <Txt size={12.5} color={C.t3}>{x.d}</Txt>
              </View>
              <Txt f="mono" size={10.5} color={C.t3} ls={1}>{t('SOON')}</Txt>
            </View>
          ))}
        </Cel>
      </ScrollView>
    </View>
  );
}

type Item = Integracion;
const MAS = {
  strava: { icono: 'bicycle-outline', color: '#fc5200', d: 'Your runs, rides and workouts as exercise and recovery for Nova.' },
  todoist: { icono: 'checkbox-outline', color: '#e44332', d: 'Your Todoist tasks next to Nova’s: complete or add them from here or by voice.' },
  google: { icono: 'checkmark-done-outline', color: '#4f8df5', d: 'Google Tasks in your day, and Nova can add to them by voice.' },
  linear: { icono: 'git-network-outline', color: '#8e8cf8', d: 'Issues assigned to you in Linear, to close or create without leaving Nova.' },
  notion: { icono: 'document-text-outline', color: '#f2f5f8', d: 'Your Notion account, so the crew can save its summaries and meeting notes there.' },
} as const;

function FilaInt({ x }: { x: Item }) {
  const { t } = useIdioma();
  return (
            <Pressable disabled={!x.ir} onPress={() => x.ir && router.push(x.ir as never)} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
              <Cel style={{ flexDirection: 'row', gap: 12, padding: 14, opacity: x.estado === 'no' ? 0.55 : 1 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: `${x.color}1f`, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={x.icono} size={19} color={x.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt f="s" size={15}>{x.t}</Txt>
                  <Txt size={13} lh={18} color={C.t2} style={{ marginTop: 3 }}>{x.d}</Txt>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 20, borderRadius: 10, backgroundColor: x.estado === 'ok' ? `${C.ok}1f` : x.estado === 'conectar' ? C.sigSuave : C.s2 }}>
                      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: x.estado === 'ok' ? C.ok : x.estado === 'conectar' ? C.nova : C.t3 }} />
                      <Txt f="m" size={10.5} color={x.estado === 'ok' ? C.ok : x.estado === 'conectar' ? C.nova : C.t3}>{t(x.estado === 'ok' ? 'Connected' : x.estado === 'conectar' ? 'Connect' : 'Not available')}</Txt>
                    </View>
                    <Txt f="monoR" size={12} color={x.estado === 'ok' ? C.t1 : C.t3} style={{ flex: 1 }} numberOfLines={1}>{x.detalle}</Txt>
                  </View>
                </View>
                {x.ir ? <Ionicons name="chevron-forward" size={16} color={C.t3} style={{ alignSelf: 'center' }} /> : null}
              </Cel>
            </Pressable>
  );
}
