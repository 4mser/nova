/* Marco común de las hojas modales: botón para bajar, título grande, bajada y el contenido desplazable (que sube con
   el teclado). Lo usan las pantallas de equipo y de integraciones de la 0.5. */
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIdioma } from '../i18n';
import { volver } from './volver';
import { C, Txt } from './tema';

export function Hoja({ titulo, sub, children, volverA = '/', derecha, pie }: { titulo: string; sub?: string; children: ReactNode; volverA?: '/' | '/crew'; derecha?: ReactNode; pie?: ReactNode }) {
  const ins = useSafeAreaInsets(), { t } = useIdioma();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver(volverA)} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
        <View style={{ flex: 1 }} />
        {derecha}
      </View>
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: ins.bottom + (pie ? 100 : 30) }}>
        <Txt f="s" size={30} ls={-1.2} lh={34}>{titulo}</Txt>
        {sub ? <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6 }}>{sub}</Txt> : null}
        {children}
      </KeyboardAwareScrollView>
      {pie ? <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, paddingBottom: ins.bottom + 14, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.l1 }}>{pie}</View> : null}
    </View>
  );
}

/** botón principal ancho (enviar, guardar) */
export function BotonAncho({ t, onPress, activo = true, cargando, color = C.nova }: { t: string; onPress: () => void; activo?: boolean; cargando?: boolean; color?: string }) {
  return (
    <Pressable onPress={onPress} disabled={!activo || cargando} accessibilityRole="button" style={({ pressed }) => ({ height: 54, borderRadius: 27, backgroundColor: color, alignItems: 'center', justifyContent: 'center', opacity: activo ? (pressed ? 0.85 : 1) : 0.4 })}>
      {cargando ? <Ionicons name="hourglass-outline" size={20} color={C.tinta} /> : <Txt f="s" size={16} color={C.tinta}>{t}</Txt>}
    </Pressable>
  );
}

/** chip seleccionable */
export function Chip({ t, on, onPress, icono }: { t: string; on: boolean; onPress: () => void; icono?: keyof typeof Ionicons.glyphMap }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ height: 34, paddingHorizontal: 13, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: on ? C.sigSuave : 'transparent', borderWidth: 1, borderColor: on ? 'transparent' : C.l2 }}>
      {icono ? <Ionicons name={icono} size={14} color={on ? C.nova : C.t2} /> : null}
      <Txt f="m" size={13} color={on ? C.nova : C.t2}>{t}</Txt>
    </Pressable>
  );
}
