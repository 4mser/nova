/* Barra flotante: una píldora opaca con cuatro pestañas y NOVA suspendida al centro, en un zócalo con su anillo
   orbital. NOVA está SIEMPRE ahí (antes se escondía mientras se veía en el héroe de Hoy y llegaba con una onda al
   hacer scroll: Nico la pidió fija, oct 2026, y de paso se ahorra el trabajo por cuadro). La pestaña activa se marca en blanco. */
import { Ionicons } from '@expo/vector-icons';
import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Fragment, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLigero } from '../engine/rendimiento';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NovaOrb } from '../nova/NovaOrb';
import { Orbita } from '../nova/Orbita';
import { useMarcada } from './Paginador';
import { C, Txt } from './tema';
import { useIdioma } from '../i18n';

const ICONOS: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  index: ['pulse-outline', 'pulse'],
  crew: ['people-outline', 'people'],
  journal: ['book-outline', 'book'],
  salud: ['heart-outline', 'heart'],
};
const ALTO = 68, ZOCALO = 76, FADE = 130;

/** lo que la barra usa del navegador de pestañas (el tipo de expo-router para el paginador es `any`) */
export type BarraProps = {
  state: { index: number; routes: { key: string; name: string; params?: object }[] };
  descriptors: Record<string, { options: { title?: string } }>;
  navigation: { emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean }; navigate: (name: string, params?: object) => void };
};

export function BarraTabs({ state, descriptors, navigation }: BarraProps) {
  const ins = useSafeAreaInsets(), { t } = useIdioma();
  const [ancho, setAncho] = useState(0);
  const idx = useMarcada(state.index); // se adelanta a la ruta mientras se desliza
  return (
    <>
    <Canvas style={{ pointerEvents: 'none',  position: 'absolute', left: 0, right: 0, bottom: 0, height: FADE }}>
      <Rect x={0} y={0} width={ancho + 64} height={FADE}>
        <LinearGradient start={vec(0, 0)} end={vec(0, FADE)} colors={['rgba(5,8,12,0)', 'rgba(5,8,12,0.92)', C.bg]} positions={[0, 0.55, 1]} />
      </Rect>
    </Canvas>
    <View style={{ pointerEvents: 'box-none',  position: 'absolute', left: 16, right: 16, bottom: Math.max(ins.bottom - 6, 14) }}>
      <View
        onLayout={e => setAncho(e.nativeEvent.layout.width)}
        style={{ height: ALTO, borderRadius: ALTO / 2, backgroundColor: C.barra, borderWidth: 1, borderColor: C.l2, flexDirection: 'row', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}
      >
        {state.routes.filter(r => ICONOS[r.name]).map((r, i) => {
          const on = state.routes[idx]?.key === r.key, d = descriptors[r.key], titulo = t(String(d.options.title ?? r.name));
          const [off, act] = ICONOS[r.name];
          return (
            <Fragment key={r.key}>
              {i === 2 && <View style={{ flex: 1.08 }} />}
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={titulo}
                onPress={() => {
                  const e = navigation.emit({ type: 'tabPress', target: r.key, canPreventDefault: true });
                  if (!on && !e.defaultPrevented) { Haptics.selectionAsync().catch(() => {}); navigation.navigate(r.name, r.params); }
                }}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }}
              >
                <Ionicons name={on ? act : off} size={23} color={on ? C.t1 : C.t3} />
                <Txt f="m" size={11} color={on ? C.t1 : C.t3}>{titulo}</Txt>
              </Pressable>
            </Fragment>
          );
        })}
      </View>
      <View style={{ pointerEvents: 'box-none', position: 'absolute', left: 0, right: 0, top: -(ZOCALO - ALTO) / 2 - 14, alignItems: 'center' }}>
        <NovaFlotante />
      </View>
    </View>
    </>
  );
}

function NovaFlotante() {
  const { t: tx } = useIdioma();
  const apr = useSharedValue(1);
  // en modo liviano el anillo queda quieto (es decoración)
  const ligero = useLigero();
  const escala = useAnimatedStyle(() => ({ transform: [{ scale: apr.value }] }));
  const O = ZOCALO * 1.3;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tx('Talk to Nova')}
      hitSlop={6}
      onPressIn={() => { apr.set(withTiming(0.93, { duration: 90 })); }}
      onPressOut={() => { apr.set(withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) })); }}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); router.push('/nova'); }}
      style={{ width: ZOCALO, height: ZOCALO }}
    >
      <View style={{ position: 'absolute', inset: 0, borderRadius: ZOCALO / 2, backgroundColor: C.bg, borderWidth: 1, borderColor: C.l2 }} />
      <Orbita size={ZOCALO} marcas={36} vel={0.8} activo={!ligero} />
      <Animated.View style={[{ pointerEvents: 'none',  position: 'absolute', left: (ZOCALO - O) / 2, top: (ZOCALO - O) / 2, width: O, height: O }, escala]}>
        <NovaOrb size={O} orbes={2} activo={!ligero} />
      </Animated.View>
    </Pressable>
  );
}

