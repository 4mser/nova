/* El recorrido guiado: una tarjeta de NOVA flotando sobre la app que te lleva pantalla por pantalla, te dice qué hay
   ahí (en voz alta si la voz de Hoy está encendida) y te pide hacer algo. Cuando lo haces, sigue sola. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFunciones } from '../engine/funciones';
import { fijarBase, irAPaso, terminarRecorrido, useRecorrido } from '../engine/recorrido';
import { useRecordatoriosPropios } from '../engine/recordatoriosPropios';
import { useRutina } from '../engine/rutina';
import { useIdioma } from '../i18n';
import { callar, decir, preparar } from '../voz/decir';
import { NovaOrb } from '../nova/NovaOrb';
import { C, Txt } from './tema';

type Paso = { ruta: string; texto: string; pide?: string; arriba?: boolean; listo?: 'rutina' | 'recordatorio' | 'hablo' };
const PASOS: Paso[] = [
  { ruta: '/', texto: 'Hi! I will show you everything in two minutes. This is Today: what matters now, your numbers, your reminders and your tasks.' },
  { ruta: '/rutina', texto: 'First, tell me your routine: your work or study hours and fixed meetings. That way I know when you are really free.', pide: 'Add a block (or skip and tell me later by voice)', listo: 'rutina' },
  { ruta: '/recordatorios', texto: 'Your reminders live here, the ones you ask me for and yours. Create a test one, for example «drink water» in 30 min.', pide: 'Create a reminder', listo: 'recordatorio' },
  { ruta: '/nova', texto: 'Now talk to me. Tap the microphone or write «What do I have today?». I can add tasks, reminders, alarms, habits and much more.', pide: 'Say or write something', listo: 'hablo', arriba: true },
  { ruta: '/journal', texto: 'This is your Log: the daily check-in (one minute) and, if you have a crew, the team log with standups and voice notes.' },
  { ruta: '/crew', texto: 'Crew: the photo of the day, standups, goals, tasks, challenges and how everyone is doing.' },
  { ruta: '/salud', texto: 'Health: body and mind, with real data from your watch and your check-ins.' },
  { ruta: '/perfil', texto: 'And in You are Your things and the Map with every screen. If you get lost, open it, or ask me «take me to…». That is all!' },
];

export function Recorrido() {
  const { activo, paso, senales, base } = useRecorrido(), { t } = useIdioma(), ins = useSafeAreaInsets(), { vozHoy } = useFunciones();
  const { bloques } = useRutina(), { lista } = useRecordatoriosPropios();
  const p = PASOS[paso];
  // al empezar, se preparan todas las frases del recorrido con la voz de NOVA (después suenan al tiro)
  useEffect(() => { if (activo && vozHoy) PASOS.forEach(x => preparar(t(x.texto))); }, [activo]); // eslint-disable-line react-hooks/exhaustive-deps

  // al entrar a un paso: ir a su pantalla, anotar cómo estaban las cosas y decirlo en voz alta
  useEffect(() => {
    if (!activo || !p) return;
    fijarBase({ rutina: bloques.length, recordatorio: lista.length });
    router.navigate(p.ruta as never);
    if (vozHoy) decir(t(p.texto));
    return () => { callar(); };
  }, [activo, paso]); // eslint-disable-line react-hooks/exhaustive-deps

  const cumplido = !!p?.listo && (p.listo === 'rutina' ? base.rutina != null && bloques.length > base.rutina : p.listo === 'recordatorio' ? base.recordatorio != null && lista.length > base.recordatorio : senales.includes(p.listo));
  const siguiente = () => {
    Haptics.selectionAsync().catch(() => {});
    if (paso >= PASOS.length - 1) { callar(); terminarRecorrido(); return; }
    irAPaso(paso + 1);
  };
  // hecho lo pedido: un respiro para ver el resultado y sigue sola
  useEffect(() => {
    if (!cumplido) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const id = setTimeout(siguiente, 1400);
    return () => clearTimeout(id);
  }, [cumplido]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!activo || !p) return null;
  const ultimo = paso === PASOS.length - 1;
  return (
    <Animated.View key={paso} entering={FadeInDown.duration(320)} exiting={FadeOutDown.duration(200)} pointerEvents="box-none"
      style={{ position: 'absolute', left: 12, right: 12, ...(p.arriba ? { top: ins.top + 64 } : { bottom: ins.bottom + 96 }), zIndex: 50, elevation: 50 }}>
      <View style={{ borderRadius: 24, backgroundColor: '#0d1620', borderWidth: 1, borderColor: `${C.nova}55`, padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}><NovaOrb size={52} expr={cumplido ? 'feliz' : 'normal'} orbes={0} /></View>
          <View style={{ flex: 1 }}>
            <Txt f="mono" size={11} color={C.nova} ls={1}>{t('TOUR · {a} OF {b}', { a: paso + 1, b: PASOS.length })}</Txt>
            <Txt size={14.5} lh={20.5} style={{ marginTop: 3 }}>{t(p.texto)}</Txt>
          </View>
        </View>
        {p.pide ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 36, borderRadius: 18, backgroundColor: cumplido ? `${C.ok}22` : C.sigSuave }}>
            <Ionicons name={cumplido ? 'checkmark-circle' : 'hand-left-outline'} size={16} color={cumplido ? C.ok : C.nova} />
            <Txt f="m" size={13} color={cumplido ? C.ok : C.nova} style={{ flex: 1 }} numberOfLines={1}>{cumplido ? t('Well done!') : t(p.pide)}</Txt>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => { callar(); terminarRecorrido(); }} hitSlop={8} style={{ paddingVertical: 8, paddingHorizontal: 4 }}>
            <Txt size={13} color={C.t3}>{t('Skip tour')}</Txt>
          </Pressable>
          <View style={{ flex: 1 }} />
          {paso > 0 ? (
            <Pressable onPress={() => irAPaso(paso - 1)} accessibilityLabel={t('Back')} style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="chevron-back" size={17} color={C.t2} />
            </Pressable>
          ) : null}
          <Pressable onPress={siguiente} style={{ height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center' }}>
            <Txt f="s" size={14} color={C.tinta}>{ultimo ? t('Finish') : p.pide && !cumplido ? t('Later') : t('Next')}</Txt>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}
