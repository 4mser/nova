/* Unirse a una crew desde un enlace de invitación (nova://unirse?c=CODIGO): confirmar y entrar. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { unirseCrew, useSesion } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { NovaOrb } from '../nova/NovaOrb';
import { volver } from '../ui/volver';
import { C, Txt } from '../ui/tema';

export default function Unirse() {
  const ins = useSafeAreaInsets(), { t } = useIdioma(), { c } = useLocalSearchParams<{ c?: string }>(), { crews } = useSesion();
  const codigo = String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const ya = crews.find(x => x.codigo === codigo);
  const [uniendo, setUniendo] = useState(false), [error, setError] = useState<string | null>(null);
  const unirme = async () => {
    setUniendo(true); setError(null);
    try { await unirseCrew(codigo); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); router.replace('/crew'); }
    catch (e) { setError(t((e as Error).message)); setUniendo(false); }
  };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8 }}>
        <Pressable onPress={() => volver('/crew')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, paddingBottom: ins.bottom + 60 }}>
        <NovaOrb size={170} orbes={3} expr="feliz" />
        <Txt f="s" size={26} ls={-0.8} style={{ textAlign: 'center' }}>{ya ? t('You are already in {crew}', { crew: ya.nombre }) : t('Join the crew')}</Txt>
        <Txt f="mono" size={22} ls={5} color={C.nova} style={{ marginTop: 10 }}>{codigo}</Txt>
        {error ? <Txt size={14} color={C.alerta} style={{ marginTop: 14, textAlign: 'center' }}>{error}</Txt> : null}
        <Pressable onPress={ya ? () => router.replace('/crew') : unirme} disabled={uniendo || !codigo} style={({ pressed }) => ({ marginTop: 26, height: 54, paddingHorizontal: 32, borderRadius: 27, backgroundColor: C.nova, justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
          {uniendo ? <ActivityIndicator color={C.tinta} /> : <Txt f="s" size={16} color={C.tinta}>{ya ? t('Open the crew') : t('Join')}</Txt>}
        </Pressable>
      </View>
    </View>
  );
}
