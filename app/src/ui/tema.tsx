/* Sistema de los mockups del video de NOVA (bn-video/spaceapps/ui/ui.css): superficies planas con un borde fino,
   grilla de 8, números grandes en peso 300. Color por función: turquesa = dato en vivo, lila = NOVA,
   ámbar = radiación y lo que se sale de lo habitual, magenta = alerta. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View, type StyleProp, type TextProps, type TextStyle, type ViewProps, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useIdioma } from '../i18n';

export const C = {
  bg: '#05080c', s1: '#0a0f15', s2: '#0f151d', barra: '#0d131a', l1: 'rgba(255,255,255,0.06)', l2: 'rgba(255,255,255,0.1)',
  t1: '#f2f5f8', t2: '#9aa4b2', t3: '#5b6573',
  nova: '#8fe6f5', sig: '#46c8e8', sigSuave: 'rgba(70,200,232,0.12)', tinta: '#041218', lila: '#a898ff',
  aviso: '#f2b457', avisoSuave: 'rgba(242,180,87,0.14)', ok: '#6fd6b0', alerta: '#ec6aa8',
};
export const F = { l: 'SpaceGrotesk_300Light', r: 'SpaceGrotesk_400Regular', m: 'SpaceGrotesk_500Medium', s: 'SpaceGrotesk_600SemiBold', mono: 'IBMPlexMono_500Medium', monoR: 'IBMPlexMono_400Regular' };
export const RADIO = 24;

type T = TextProps & { f?: keyof typeof F; size?: number; color?: string; ls?: number; lh?: number };
export function Txt({ f = 'r', size = 15, color = C.t1, ls, lh, style, ...p }: T) {
  return <RNText {...p} style={[{ fontFamily: F[f], fontSize: size, color, letterSpacing: ls, lineHeight: lh, fontVariant: ['tabular-nums'] }, style]} />;
}

/** superficie para agrupar filas relacionadas */
export function Grupo({ style, ...p }: ViewProps) {
  return <View {...p} style={[{ backgroundColor: C.s1, borderRadius: RADIO, borderWidth: 1, borderColor: C.l1, paddingHorizontal: 16 }, style]} />;
}

export function Divisor({ v, inset = 0 }: { v?: boolean; inset?: number }) {
  return <View style={v ? { width: 1, alignSelf: 'stretch', backgroundColor: C.l1 } : { height: 1, marginLeft: inset, backgroundColor: C.l1 }} />;
}

/** título de sección: grande y sobrio, nota a la derecha */
export function Seccion({ t, nota }: { t: string; nota?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 24, marginBottom: 10, paddingHorizontal: 2 }}>
      <Txt f="s" size={19} ls={-0.5} style={{ flex: 1 }}>{t}</Txt>
      {typeof nota === 'string' ? <Txt size={13} color={C.t3}>{nota}</Txt> : nota}
    </View>
  );
}

/** rótulo de tarjeta */
export function Lbl({ t, color = C.t2, style }: { t: string; color?: string; style?: StyleProp<TextStyle> }) {
  return <Txt f="m" size={13} color={color} style={style}>{t}</Txt>;
}

/** tarjeta: superficie plana con un borde fino */
export function Cel({ style, ...p }: ViewProps) {
  return <View {...p} style={[{ padding: 16, borderRadius: RADIO, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1 }, style]} />;
}

/** número grande en peso 300 con su unidad */
export function Num({ v, u, size = 34, color = C.t1, style }: { v: string; u?: string; size?: number; color?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'baseline' }, style]}>
      <Txt f="l" size={size} ls={-size * 0.045} lh={size * 1.05} color={color}>{v}</Txt>
      {u ? <Txt size={Math.min(14, size * 0.42)} color={C.t2} style={{ marginLeft: 3 }}>{u}</Txt> : null}
    </View>
  );
}

/** mensaje de NOVA: punto y nombre en lila, texto claro */
export function MsgNova({ children, pie }: { children: ReactNode; pie?: ReactNode }) {
  return (
    <View style={{ paddingVertical: 18, paddingHorizontal: 20, borderRadius: RADIO, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.lila }} />
        <Txt f="s" size={13} color={C.lila}>Nova</Txt>
      </View>
      <Txt size={16} lh={23}>{children}</Txt>
      {pie}
    </View>
  );
}

/** cualquier cosa tocable: baja la opacidad y vibra suave */
export function Toque({ onPress, style, children, label }: { onPress: () => void; style?: StyleProp<ViewStyle>; children: ReactNode; label?: string }) {
  const o = useSharedValue(1);
  const st = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={() => { o.set(withTiming(0.55, { duration: 80 })); }}
      onPressOut={() => { o.set(withTiming(1, { duration: 160 })); }}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
    >
      <Animated.View style={[style, st]}>{children}</Animated.View>
    </Pressable>
  );
}

export function Boton({ t, onPress, icono, primario }: { t: string; onPress: () => void; icono?: keyof typeof Ionicons.glyphMap; primario?: boolean }) {
  return (
    <Toque
      onPress={onPress}
      label={t}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 20, borderRadius: 22, backgroundColor: primario ? C.nova : 'transparent', borderWidth: primario ? 0 : 1, borderColor: C.l2, boxShadow: primario ? '0 8px 28px -8px rgba(70,200,232,0.6)' : undefined }}
    >
      {icono ? <Ionicons name={icono} size={16} color={primario ? C.tinta : C.t1} /> : null}
      <Txt f="s" size={15} color={primario ? C.tinta : C.t1}>{t}</Txt>
    </Toque>
  );
}

/** procedencia del dato: siempre visible, nunca protagonista */
export function Tag({ k }: { k: 'SIMULATED' | 'LIVE' | 'PROTOTYPE' }) {
  const { t } = useIdioma();
  const txt = t(k === 'LIVE' ? 'Live' : k === 'PROTOTYPE' ? 'Prototype' : 'Simulated');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: k === 'LIVE' ? C.ok : k === 'PROTOTYPE' ? C.aviso : C.sig, opacity: k === 'LIVE' ? 1 : 0.8 }} />
      <Txt f="monoR" size={11.5} color={C.t3}>{txt}</Txt>
    </View>
  );
}

export function Valor({ v, u, size = 28, color = C.t1 }: { v: string; u?: string; size?: number; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
      <Txt f="l" size={size} ls={-size * 0.04} color={color}>{v}</Txt>
      {u ? <Txt size={Math.max(12, size * 0.4)} color={C.t2}>{u}</Txt> : null}
    </View>
  );
}

/** barra de avance: pista fina y relleno neutro */
export function Barra({ v, color = C.sig }: { v: number; color?: string }) {
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: C.l2, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(1, Math.min(100, v * 100))}%`, height: 4, borderRadius: 2, backgroundColor: color }} />
    </View>
  );
}
