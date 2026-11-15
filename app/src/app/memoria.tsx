/* Lo que NOVA recuerda de ti: lo ves y lo borras. Ella lo agrega cuando le cuentas algo que vale la pena. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { olvidar, useMemoria, type Recuerdo } from '../engine/memoria';
import { useIdioma } from '../i18n';
import { NovaOrb } from '../nova/NovaOrb';
import { volver } from '../ui/volver';
import { C, Cel, Txt } from '../ui/tema';

const ICONO: Record<Recuerdo['tipo'], keyof typeof Ionicons.glyphMap> = { meta: 'flag-outline', gusto: 'heart-outline', persona: 'person-outline', rutina: 'time-outline', salud: 'medkit-outline', otro: 'bookmark-outline' };

export default function Memoria() {
  const ins = useSafeAreaInsets(), { t, locale } = useIdioma(), { recuerdos } = useMemoria();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: ins.bottom + 30 }}>
        <Txt f="s" size={30} ls={-1.2} lh={34}>{t('What Nova remembers')}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6 }}>{t('Things you told her that help her help you: goals, people, routines. It stays on this phone. Tell her "forget that" or delete it here.')}</Txt>
        {!recuerdos.length ? (
          <View style={{ alignItems: 'center', marginTop: 36 }}>
            <NovaOrb size={140} orbes={2} expr="pensativa" />
            <Txt size={15} lh={21} color={C.t2} style={{ textAlign: 'center', maxWidth: 300 }}>{t('Nothing yet. Tell her about your goals or what matters to you and she will keep it in mind.')}</Txt>
          </View>
        ) : (
          <Cel style={{ marginTop: 18, paddingVertical: 4 }}>
            {recuerdos.map((r, i) => (
              <Animated.View key={r.id} entering={FadeIn} exiting={FadeOut} layout={LinearTransition} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
                <Ionicons name={ICONO[r.tipo] ?? 'bookmark-outline'} size={17} color={C.lila} />
                <View style={{ flex: 1 }}>
                  <Txt size={15} lh={21}>{r.texto}</Txt>
                  <Txt size={11.5} color={C.t3} style={{ marginTop: 2 }}>{new Date(r.ts).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</Txt>
                </View>
                <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); olvidar(r.id); }} hitSlop={10} accessibilityLabel={t('Forget {x}', { x: r.texto })}>
                  <Ionicons name="close-circle" size={20} color={C.t3} />
                </Pressable>
              </Animated.View>
            ))}
          </Cel>
        )}
      </ScrollView>
    </View>
  );
}
