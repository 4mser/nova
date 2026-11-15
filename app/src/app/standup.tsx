/* Hacer el standup: tres respuestas cortas y se publica en la bitácora de la crew. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCrew } from '../cuenta/sesion';
import { publicarStandup } from '../cuenta/standup';
import { useIdioma } from '../i18n';
import { volver } from '../ui/volver';
import { C, F, Txt } from '../ui/tema';

export default function HacerStandup() {
  const ins = useSafeAreaInsets(), { t } = useIdioma(), crew = useCrew();
  const [ayer, setAyer] = useState(''), [hoy, setHoy] = useState(''), [bloqueo, setBloqueo] = useState(''), [nada, setNada] = useState(false);
  const [enviando, setEnviando] = useState(false), [error, setError] = useState<string | null>(null);
  const listo = !!crew && hoy.trim().length > 1 && !enviando;
  const enviar = async () => {
    if (!listo || !crew) return;
    setEnviando(true); setError(null);
    try { await publicarStandup(crew.id, { ayer, hoy, bloqueo: nada ? undefined : bloqueo }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); volver('/crew'); }
    catch (e) { setError(t((e as Error).message)); setEnviando(false); }
  };
  const campo = (valor: string, cambio: (s: string) => void, ph: string) => (
    <TextInput value={valor} onChangeText={cambio} multiline maxLength={500} placeholder={ph} placeholderTextColor={C.t3}
      style={{ minHeight: 70, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, padding: 14, color: C.t1, fontFamily: F.r, fontSize: 16, textAlignVertical: 'top' }} />
  );
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/crew')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: ins.bottom + 30 }} keyboardShouldPersistTaps="handled">
        <Txt f="s" size={30} ls={-1.2} lh={34}>{t('Standup')}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6 }}>{t('Three short answers for {crew}. It goes to the crew log and everyone sees it.', { crew: crew?.nombre ?? '' })}</Txt>
        <Paso icono="checkmark-done" color={C.ok} titulo={t('What did you get done yesterday?')} />
        {campo(ayer, setAyer, t('e.g. Finished the sensor board'))}
        <Paso icono="arrow-forward-circle-outline" color={C.nova} titulo={t('What will you do today?')} />
        {campo(hoy, setHoy, t('e.g. Test it on the bench with Luis'))}
        <Paso icono="alert-circle-outline" color={C.aviso} titulo={t('Is anything blocking you?')} />
        {nada ? null : campo(bloqueo, setBloqueo, t('What do you need, and from whom'))}
        <Pressable onPress={() => setNada(n => !n)} style={{ alignSelf: 'flex-start', marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: nada ? C.ok : C.l2, backgroundColor: nada ? 'rgba(111,214,176,0.12)' : 'transparent' }}>
          <Ionicons name={nada ? 'checkmark-circle' : 'ellipse-outline'} size={15} color={nada ? C.ok : C.t3} />
          <Txt f="m" size={13} color={nada ? C.ok : C.t2}>{t('Nothing is blocking me')}</Txt>
        </Pressable>
        {error ? <Txt size={13.5} color={C.alerta} style={{ marginTop: 12 }}>{error}</Txt> : null}
        <Pressable onPress={enviar} disabled={!listo} style={({ pressed }) => ({ marginTop: 26, height: 54, borderRadius: 27, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', opacity: listo ? (pressed ? 0.85 : 1) : 0.4 })}>
          {enviando ? <ActivityIndicator color={C.tinta} /> : <Txt f="s" size={16} color={C.tinta}>{t('Post standup')}</Txt>}
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

function Paso({ icono, color, titulo }: { icono: keyof typeof Ionicons.glyphMap; color: string; titulo: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 8 }}>
      <Ionicons name={icono} size={17} color={color} />
      <Txt f="s" size={15.5}>{titulo}</Txt>
    </View>
  );
}
