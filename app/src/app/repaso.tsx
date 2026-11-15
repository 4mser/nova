/* Repaso de una tarjeta: primero intentas recordar (sin mirar), después ves tu nota y dices si lo tenías.
   Sin id: la lista de lo que toca hoy y lo próximo. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { diasHasta, pendientesHoy, repasar, useRepaso, type Tarjeta } from '../engine/repaso';
import { useIdioma } from '../i18n';
import { NovaOrb } from '../nova/NovaOrb';
import { volver } from '../ui/volver';
import { C, Cel, F, Seccion, Toque, Txt } from '../ui/tema';

export default function Repaso() {
  const ins = useSafeAreaInsets(), { t } = useIdioma(), { id } = useLocalSearchParams<{ id?: string }>(), { tarjetas } = useRepaso();
  const tarjeta = id ? tarjetas.find(x => x.id === id) : undefined;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      {tarjeta ? <Uno key={tarjeta.id} c={tarjeta} /> : <Lista tarjetas={tarjetas} />}
      <View style={{ height: ins.bottom }} />
    </KeyboardAvoidingView>
  );
}

function Uno({ c }: { c: Tarjeta }) {
  const { t } = useIdioma();
  const [recuerdo, setRecuerdo] = useState(''), [ver, setVer] = useState(false), [listo, setListo] = useState<null | Tarjeta>(null);
  const responder = async (si: boolean) => {
    Haptics.notificationAsync(si ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setListo(await repasar(c.id, si));
  };
  if (listo) {
    const d = diasHasta(listo);
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <NovaOrb size={170} orbes={2} expr="feliz" />
        <Txt f="s" size={24} ls={-0.8} style={{ textAlign: 'center' }}>{listo.dominada ? t('You have it. No more reviews for this one.') : t('Next review in {n}', { n: t(d === 1 ? 'one day' : '{n} days', { n: d }) })}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ textAlign: 'center', marginTop: 8 }}>{t('Remembering a little later each time is what makes it stick.')}</Txt>
        <Pressable onPress={() => router.replace('/repaso')} style={({ pressed }) => ({ marginTop: 26, height: 52, paddingHorizontal: 28, borderRadius: 26, backgroundColor: C.nova, justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
          <Txt f="s" size={16} color={C.tinta}>{t('Continue')}</Txt>
        </Pressable>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8 }} keyboardShouldPersistTaps="handled">
      <Txt f="mono" size={12} ls={1.2} color={C.lila} style={{ textTransform: 'uppercase' }}>{t('Review')} · {c.repasos + 1}</Txt>
      <Txt f="s" size={28} ls={-1} lh={33} style={{ marginTop: 8 }}>{c.tema}</Txt>
      <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 8 }}>{t('Before looking: what do you remember? Write it or just think it.')}</Txt>
      <TextInput value={recuerdo} onChangeText={setRecuerdo} multiline placeholder={t('What I remember…')} placeholderTextColor={C.t3}
        style={{ marginTop: 16, minHeight: 110, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, padding: 14, color: C.t1, fontFamily: F.r, fontSize: 16, textAlignVertical: 'top' }} />
      {!ver ? (
        <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setVer(true); }} style={({ pressed }) => ({ marginTop: 16, height: 52, borderRadius: 26, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
          <Txt f="s" size={16} color={C.tinta}>{t('Show my note')}</Txt>
        </Pressable>
      ) : (
        <Animated.View entering={FadeInDown.duration(320)}>
          <Cel style={{ marginTop: 16, borderColor: 'rgba(168,152,255,0.3)' }}>
            <Txt f="m" size={12.5} color={C.lila}>{t('Your note')}</Txt>
            <Txt size={16} lh={23} style={{ marginTop: 6 }}>{c.nota || t('(no note)')}</Txt>
          </Cel>
          <Txt f="s" size={16} style={{ marginTop: 20, textAlign: 'center' }}>{t('Did you remember it?')}</Txt>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Pressable onPress={() => responder(false)} style={({ pressed }) => ({ flex: 1, height: 54, borderRadius: 27, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? C.s2 : 'transparent' })}>
              <Txt f="s" size={15.5}>{t('It was hard')}</Txt>
            </Pressable>
            <Pressable onPress={() => responder(true)} style={({ pressed }) => ({ flex: 1, height: 54, borderRadius: 27, backgroundColor: C.ok, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
              <Txt f="s" size={15.5} color={C.tinta}>{t('I had it')}</Txt>
            </Pressable>
          </View>
        </Animated.View>
      )}
    </ScrollView>
  );
}

function Lista({ tarjetas }: { tarjetas: Tarjeta[] }) {
  const { t } = useIdioma();
  const hoy = pendientesHoy(tarjetas), luego = tarjetas.filter(x => !x.dominada && !hoy.includes(x)).sort((a, b) => a.proximo - b.proximo), dominadas = tarjetas.filter(x => x.dominada);
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8 }}>
      <Txt f="s" size={30} ls={-1.2} lh={34}>{t('Review')}</Txt>
      <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6 }}>{t('What you learned in your learning sessions, at the right moment to remember it.')}</Txt>
      {!tarjetas.length ? (
        <Animated.View entering={FadeIn} style={{ alignItems: 'center', marginTop: 40 }}>
          <NovaOrb size={150} orbes={2} expr="pensativa" />
          <Txt size={15} lh={21} color={C.t2} style={{ textAlign: 'center', maxWidth: 300 }}>{t('Finish a learning session and write down the main idea: I will ask you about it tomorrow.')}</Txt>
        </Animated.View>
      ) : null}
      {hoy.length ? <><Seccion t={t('Today')} nota={String(hoy.length)} /><Filas ts={hoy} /></> : tarjetas.length ? <Txt size={14} color={C.ok} style={{ marginTop: 18 }}>{t('Nothing to review today.')}</Txt> : null}
      {luego.length ? <><Seccion t={t('Coming up')} /><Filas ts={luego} /></> : null}
      {dominadas.length ? <><Seccion t={t('Mastered')} nota={String(dominadas.length)} /><Filas ts={dominadas} /></> : null}
    </ScrollView>
  );
}
function Filas({ ts }: { ts: Tarjeta[] }) {
  const { t } = useIdioma();
  return (
    <Cel style={{ paddingVertical: 4 }}>
      {ts.map((c, i) => {
        const d = diasHasta(c);
        return (
          <Toque key={c.id} onPress={() => router.setParams({ id: c.id })} label={c.tema} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
            <Ionicons name={c.dominada ? 'ribbon-outline' : 'school-outline'} size={17} color={c.dominada ? C.ok : C.lila} />
            <Txt size={15} style={{ flex: 1 }} numberOfLines={1}>{c.tema}</Txt>
            <Txt f="monoR" size={12} color={C.t3}>{c.dominada ? '✓' : d === 0 ? t('today') : t('in {n} d', { n: d })}</Txt>
          </Toque>
        );
      })}
    </Cel>
  );
}
