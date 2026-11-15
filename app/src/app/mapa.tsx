/* El mapa de NOVA: todas las pantallas que existen, agrupadas, con qué hay en cada una y un toque para ir.
   Abajo, repetir el recorrido guiado. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCrew } from '../cuenta/sesion';
import { empezarRecorrido } from '../engine/recorrido';
import { useIdioma } from '../i18n';
import { volver } from '../ui/volver';
import { C, Cel, Seccion, Txt } from '../ui/tema';

type Lugar = { ir: string; icono: keyof typeof Ionicons.glyphMap; t: string; d: string; crew?: boolean };
const GRUPOS: { t: string; color: string; lugares: Lugar[] }[] = [
  { t: 'Your day', color: C.nova, lugares: [
    { ir: '/personalizar', icono: 'options-outline', t: 'Customize Today', d: 'Show, hide and reorder the sections of Today' },
    { ir: '/', icono: 'pulse-outline', t: 'Today', d: 'What matters now, your numbers, reminders, schedule and tasks' },
    { ir: '/nova', icono: 'sparkles-outline', t: 'Talk to Nova', d: 'By voice or text: tasks, reminders, alarms, habits, questions' },
    { ir: '/recordatorios', icono: 'alarm-outline', t: 'Reminders', d: 'The ones you ask Nova for and yours; postpone or delete' },
    { ir: '/nota', icono: 'mic-outline', t: 'Quick note', d: 'Say it and Nova saves it as a task, reminder, list item or note' },
    { ir: '/listas', icono: 'list-outline', t: 'Lists', d: 'Groceries, ideas, books… yours or shared with your crew' },
    { ir: '/buenosdias', icono: 'sunny-outline', t: 'Your morning', d: 'Nova tells you about your day with her voice' },
    { ir: '/rutina', icono: 'briefcase-outline', t: 'Your routine', d: 'Work, fixed meetings, classes: what keeps you busy every week' },
    { ir: '/foco', icono: 'timer-outline', t: 'Focus', d: 'Focus or learning sessions with a timer and music' },
    { ir: '/actividad', icono: 'list-outline', t: 'What Nova did', d: 'Everything you asked for and where it ended up' },
  ] },
  { t: 'You and your health', color: C.ok, lugares: [
    { ir: '/journal', icono: 'book-outline', t: 'Log', d: 'Daily check-in, your private entries and the month in colors' },
    { ir: '/salud?seg=cuerpo', icono: 'heart-outline', t: 'Body', d: 'Sleep, steps, heart and recovery from your watch' },
    { ir: '/salud?seg=mente', icono: 'happy-outline', t: 'Mind', d: 'Mood, stress and what Nova notices over the weeks' },
    { ir: '/habitos', icono: 'repeat', t: 'Habits', d: 'Up to 6 daily habits with streaks' },
    { ir: '/repaso', icono: 'school-outline', t: 'Review', d: 'What you learn, asked again at the right time' },
    { ir: '/resumen', icono: 'calendar-outline', t: 'Your week', d: 'Summary against last week, every Sunday' },
  ] },
  { t: 'Your crew', color: C.lila, lugares: [
    { ir: '/crew', icono: 'people-outline', t: 'Crew', d: 'Photo of the day, goals, tasks, challenges and calendar', crew: true },
    { ir: '/journal?vista=crew', icono: 'chatbubbles-outline', t: 'Crew log', d: 'Notes, decisions, voice notes and the weekly summary', crew: true },
    { ir: '/standup', icono: 'megaphone-outline', t: 'Standup', d: 'Yesterday, today and blockers, in three lines', crew: true },
    { ir: '/crew-salud', icono: 'fitness-outline', t: 'Crew wellbeing', d: 'How everyone is doing, only what each one shares', crew: true },
    { ir: '/meta', icono: 'flag-outline', t: 'New goal', d: 'Objective, deadline and key results with an owner', crew: true },
    { ir: '/invitar', icono: 'qr-code-outline', t: 'Invite', d: 'Link and QR to join your crew', crew: true },
  ] },
  { t: 'Settings', color: C.t2, lugares: [
    { ir: '/perfil', icono: 'person-outline', t: 'You', d: 'Profile, your things and your crew' },
    { ir: '/ajustes', icono: 'settings-outline', t: 'App settings', d: 'Performance, voice, notifications, language, connections and account' },
    { ir: '/memoria', icono: 'bookmark-outline', t: 'Nova’s memory', d: 'What Nova remembers about you; delete anything' },
    { ir: '/integraciones', icono: 'git-network-outline', t: 'Integrations', d: 'Health, calendars, watch, Spotify, alarms: what is connected' },
    { ir: '/permisos', icono: 'shield-checkmark-outline', t: 'Permissions', d: 'Microphone, notifications, health, calendar' },
    { ir: '/datos', icono: 'server-outline', t: 'Your data', d: 'What Nova can read and from where' },
  ] },
];

export default function Mapa() {
  const ins = useSafeAreaInsets(), { t } = useIdioma(), crew = useCrew();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: ins.bottom + 30 }}>
        <Txt f="s" size={30} ls={-1.2} lh={34}>{t('Map of Nova')}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6 }}>{t('Every screen in the app and what is in it. You can also ask Nova «take me to…».')}</Txt>
        <Pressable onPress={() => { volver('/'); setTimeout(empezarRecorrido, 400); }} style={({ pressed }) => ({ marginTop: 14, opacity: pressed ? 0.8 : 1 })}>
          <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: `${C.nova}55` }}>
            <Ionicons name="navigate-outline" size={19} color={C.nova} />
            <View style={{ flex: 1 }}>
              <Txt f="s" size={15}>{t('Tour with Nova')}</Txt>
              <Txt size={12.5} color={C.t3}>{t('Two minutes, step by step')}</Txt>
            </View>
            <Ionicons name="play" size={16} color={C.nova} />
          </Cel>
        </Pressable>
        {GRUPOS.map(g => (
          <View key={g.t}>
            <Seccion t={t(g.t)} />
            <Cel style={{ paddingVertical: 2 }}>
              {g.lugares.filter(l => !l.crew || crew).map((l, i) => (
                <Pressable key={l.ir} onPress={() => router.push(l.ir as never)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1, opacity: pressed ? 0.7 : 1 })}>
                  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: `${g.color}1f`, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={l.icono} size={16} color={g.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt f="m" size={15}>{t(l.t)}</Txt>
                    <Txt size={12.5} lh={17} color={C.t3}>{t(l.d)}</Txt>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={C.t3} />
                </Pressable>
              ))}
            </Cel>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
