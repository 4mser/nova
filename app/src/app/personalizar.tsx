/* Personalizar Hoy: qué secciones ves y en qué orden. Interruptor para mostrar u ocultar, flechas para subir o bajar.
   NOVA y su frase quedan siempre arriba. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { moverSeccion, mostrarSeccion, restablecerInicio, SECCIONES_HOY, useInicio } from '../engine/inicio';
import { useIdioma } from '../i18n';
import { Interruptor } from '../ui/Interruptor';
import { volver } from '../ui/volver';
import { C, Cel, Txt } from '../ui/tema';

export default function Personalizar() {
  const ins = useSafeAreaInsets(), { t } = useIdioma(), { orden, ocultas } = useInicio();
  const flecha = (icono: 'chevron-up' | 'chevron-down', on: boolean, f: () => void, label: string) => (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); f(); }} disabled={!on} accessibilityLabel={label} hitSlop={4}
      style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center', opacity: on ? 1 : 0.25 }}>
      <Ionicons name={icono} size={15} color={C.t2} />
    </Pressable>
  );
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); restablecerInicio(); }} hitSlop={8}><Txt f="m" size={13.5} color={C.t2}>{t('Reset')}</Txt></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: ins.bottom + 30 }}>
        <Txt f="s" size={30} ls={-1.2} lh={34}>{t('Customize Today')}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6, marginBottom: 16 }}>{t('Choose what you see and in which order. Nova always stays on top.')}</Txt>
        <Cel style={{ paddingVertical: 4 }}>
          {orden.map((id, i) => {
            const s = SECCIONES_HOY.find(x => x.id === id)!, visible = !ocultas.includes(id);
            return (
              <Animated.View key={id} layout={LinearTransition.duration(220)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
                <Ionicons name={s.icono as keyof typeof Ionicons.glyphMap} size={18} color={visible ? C.nova : C.t3} />
                <Txt size={15} color={visible ? C.t1 : C.t3} style={{ flex: 1 }} numberOfLines={1}>{t(s.t)}</Txt>
                {flecha('chevron-up', i > 0, () => moverSeccion(id, -1), t('Move up'))}
                {flecha('chevron-down', i < orden.length - 1, () => moverSeccion(id, 1), t('Move down'))}
                <Interruptor on={visible} label={t(s.t)} onChange={v => mostrarSeccion(id, v)} />
              </Animated.View>
            );
          })}
        </Cel>
      </ScrollView>
    </View>
  );
}
