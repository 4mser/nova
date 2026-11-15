/* Marco de cada pestaña, como en los mockups: título, subtítulo y avatar a la derecha.
   Al hacer scroll el título se recoge en una barra opaca. */
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { createContext, useContext, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { iniciales, usePerfil } from '../engine/perfil';
import { C, Txt } from './tema';
import { useIdioma } from '../i18n';
import { imagen } from '../cuenta/api';
import { useSesion } from '../cuenta/sesion';

/** tu foto (o tus iniciales); abre tu perfil */
export function Avatar({ size = 40 }: { size?: number }) {
  const p = usePerfil(), { t } = useIdioma(), { usuario } = useSesion();
  const remota = !p.foto && usuario?.foto ? imagen(usuario.foto) : undefined;
  return (
    <Pressable onPress={() => router.push('/perfil')} accessibilityLabel={t('Open your profile')} hitSlop={8}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {p.foto || remota ? <Image source={remota ?? { uri: p.foto }} style={{ width: size, height: size }} contentFit="cover" /> : <Txt f="s" size={size * 0.35} color={C.bg}>{iniciales(p.nombre)}</Txt>}
    </Pressable>
  );
}

/** algo para mostrar bajo el título (un selector de secciones): lo pone quien envuelve la pantalla, como Salud */
export const BajoTitulo = createContext<ReactNode>(null);

/** selector de dos o más secciones, ancho completo, con la activa en turquesa */
export function Selector<K extends string>({ opciones, valor, onCambio }: { opciones: { k: K; t: string; icono?: keyof typeof Ionicons.glyphMap }[]; valor: K; onCambio: (k: K) => void }) {
  return (
    <View style={{ flexDirection: 'row', padding: 4, gap: 4, borderRadius: 22, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, marginBottom: 14 }}>
      {opciones.map(o => {
        const on = o.k === valor;
        return (
          <Pressable key={o.k} onPress={() => { if (!on) { Haptics.selectionAsync().catch(() => {}); onCambio(o.k); } }} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ flex: 1, height: 38, borderRadius: 18, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.nova : 'transparent' }}>
            {o.icono ? <Ionicons name={o.icono} size={15} color={on ? C.tinta : C.t2} /> : null}
            <Txt f="s" size={14} color={on ? C.tinta : C.t2}>{o.t}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Pantalla({ titulo, sub, children, corto, y: yExt }: { titulo: string; sub: string; children: ReactNode; corto?: string; y?: SharedValue<number> }) {
  const ins = useSafeAreaInsets(), bajo = useContext(BajoTitulo);
  const yProp = useSharedValue(0), y = yExt ?? yProp;
  const onScroll = useAnimatedScrollHandler(e => { y.value = e.contentOffset.y; });
  const barra = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [50, 80], [0, 1], 'clamp') }));
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <KeyboardAwareScrollView bottomOffset={24} onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingTop: ins.top + 14, paddingHorizontal: 20, paddingBottom: ins.bottom + 120 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 }}>
          <View style={{ flex: 1 }}>
            <Txt f="s" size={30} ls={-1.2} lh={33}>{titulo}</Txt>
            <Txt size={15} color={C.t2} style={{ marginTop: 6 }}>{sub}</Txt>
          </View>
          <Avatar />
        </View>
        {bajo}
        {children}
      </KeyboardAwareScrollView>
      <Animated.View style={[{ pointerEvents: 'none',  position: 'absolute', top: 0, left: 0, right: 0, height: ins.top + 44, backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.l1, justifyContent: 'flex-end', paddingBottom: 12 }, barra]}>
        <Txt f="s" size={16} style={{ textAlign: 'center' }}>{corto ?? titulo}</Txt>
      </Animated.View>
    </View>
  );
}
