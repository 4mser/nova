/* Nuevo reto para la crew: qué se mide (sale de datos reales), la meta entre todos y cuántos días dura. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { nuevoReto, type Metrica } from '../cuenta/datos';
import { useCrew } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { volver } from '../ui/volver';
import { C, Cel, F, Txt } from '../ui/tema';

const OPCIONES: { m: Metrica; t: string; d: string; icono: keyof typeof Ionicons.glyphMap; metas: number[]; titulo: string }[] = [
  { m: 'pasos', t: 'Steps', d: 'From each phone or watch', icono: 'footsteps-outline', metas: [50000, 100000, 200000], titulo: '{n} steps together' },
  { m: 'focoMin', t: 'Focus', d: 'Minutes in focus sessions', icono: 'timer-outline', metas: [300, 600, 1200], titulo: '{n} minutes of focus' },
  { m: 'aprendizajeMin', t: 'Learning', d: 'Minutes in learning sessions', icono: 'school-outline', metas: [180, 420, 900], titulo: '{n} minutes learning' },
  { m: 'ejercicioMin', t: 'Exercise', d: 'Workouts from Health Connect', icono: 'barbell-outline', metas: [300, 600, 1000], titulo: '{n} minutes of exercise' },
  { m: 'fotos', t: 'Daily photo', d: 'Days each person shared a photo', icono: 'camera-outline', metas: [14, 21, 28], titulo: 'Photo every day' },
  { m: 'tareas', t: 'Tasks', d: 'Crew tasks done', icono: 'checkmark-done-outline', metas: [10, 20, 40], titulo: '{n} crew tasks' },
];
const DIAS = [7, 14, 30];

export default function NuevoReto() {
  const crew = useCrew(), { t, locale } = useIdioma(), ins = useSafeAreaInsets();
  const [o, setO] = useState(OPCIONES[0]), [meta, setMeta] = useState(OPCIONES[0].metas[1]), [dias, setDias] = useState(7);
  const [titulo, setTitulo] = useState(''), [enviando, setEnviando] = useState(false), [error, setError] = useState<string | null>(null);
  const porDefecto = t(o.titulo, { n: meta.toLocaleString(locale) });
  const crear = async () => {
    if (!crew || enviando) return;
    setEnviando(true); setError(null);
    try { await nuevoReto(crew.id, { titulo: titulo.trim() || porDefecto, metrica: o.m, meta, dias }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); volver(); }
    catch (e) { setError(t((e as Error).message)); setEnviando(false); }
  };
  const pastilla = (k: string, on: boolean, f: () => void) => (
    <Pressable key={k} onPress={() => { Haptics.selectionAsync().catch(() => {}); f(); }} style={{ flex: 1, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.nova : C.s1, borderWidth: on ? 0 : 1, borderColor: C.l1 }}>
      <Txt f="s" size={14.5} color={on ? C.tinta : C.t1}>{k}</Txt>
    </Pressable>
  );
  return (
    <KeyboardAwareScrollView bottomOffset={24} style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingTop: ins.top + 14, paddingHorizontal: 20, paddingBottom: ins.bottom + 30 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Txt f="s" size={26} ls={-1} style={{ flex: 1 }}>{t('New challenge')}</Txt>
        <Pressable onPress={() => volver()} hitSlop={10} accessibilityLabel={t('Close')}><Ionicons name="close" size={26} color={C.t2} /></Pressable>
      </View>
      <Txt size={15} color={C.t2} style={{ marginTop: 4 }}>{t('Everyone adds to the same goal.')}</Txt>

      <Txt f="m" size={13} color={C.t2} style={{ marginTop: 22, marginBottom: 8 }}>{t('What counts')}</Txt>
      <Cel style={{ paddingVertical: 4 }}>
        {OPCIONES.map((x, i) => {
          const on = x.m === o.m;
          return (
            <Pressable key={x.m} onPress={() => { setO(x); setMeta(x.metas[1]); Haptics.selectionAsync().catch(() => {}); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
              <Ionicons name={x.icono} size={19} color={on ? C.nova : C.t3} />
              <View style={{ flex: 1 }}>
                <Txt f={on ? 's' : 'r'} size={15}>{t(x.t)}</Txt>
                <Txt size={12.5} color={C.t3}>{t(x.d)}</Txt>
              </View>
              <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? C.nova : C.l2} />
            </Pressable>
          );
        })}
      </Cel>

      <Txt f="m" size={13} color={C.t2} style={{ marginTop: 20, marginBottom: 8 }}>{t('Goal, together')}</Txt>
      <View style={{ flexDirection: 'row', gap: 8 }}>{o.metas.map(v => pastilla(v.toLocaleString(locale), v === meta, () => setMeta(v)))}</View>

      <Txt f="m" size={13} color={C.t2} style={{ marginTop: 20, marginBottom: 8 }}>{t('Lasts')}</Txt>
      <View style={{ flexDirection: 'row', gap: 8 }}>{DIAS.map(d => pastilla(t('{n} days', { n: d }), d === dias, () => setDias(d)))}</View>

      <Txt f="m" size={13} color={C.t2} style={{ marginTop: 20, marginBottom: 8 }}>{t('Name')}</Txt>
      <TextInput value={titulo} onChangeText={setTitulo} placeholder={porDefecto} placeholderTextColor={C.t3} maxLength={80}
        style={{ height: 52, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, paddingHorizontal: 16, color: C.t1, fontFamily: F.r, fontSize: 15.5 }} />
      {error ? <Txt size={14} color={C.alerta} style={{ marginTop: 10 }}>{error}</Txt> : null}

      <Pressable onPress={crear} style={({ pressed }) => ({ marginTop: 24, height: 54, borderRadius: 27, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
        {enviando ? <ActivityIndicator color={C.tinta} /> : <Txt f="s" size={16} color={C.tinta}>{t('Start challenge')}</Txt>}
      </Pressable>
    </KeyboardAwareScrollView>
  );
}
