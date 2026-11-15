/* NOVA en el héroe de Today, para jugar con ella:
   · arrastrar: la gira en 3D como una esfera (los ojos dan la vuelta y vuelven); al soltar sigue con inercia y se
     detiene de frente
   · pellizcar: estirarla
   · doble toque: una vuelta 3D completa
   · mantener apretada: la levantas; ahí sí se arrastra y va poniendo caritas mientras la mueves
   · un toque: abre su chat
   Con el scroll se encoge y se desvanece: en ese momento se «transporta» al zócalo de la barra. */
import * as Haptics from 'expo-haptics';
import { router, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withDecay, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { Expr } from './forma';
import { NovaOrb } from './NovaOrb';
import { useIdioma } from '../i18n';

const CARAS: Expr[] = ['feliz', 'sorprendida', 'pensativa', 'triste', 'dormida', 'normal'];
const PASO_CARA = 70; // px recorridos para cambiar de carita
const LIMITE = 120;

/** también fuera de Hoy (el foco): sin `y` no se encoge con el scroll; `alTocar` reemplaza abrir el chat; `orbes`/`halo` para
    una NOVA más calma; `enPaginador=false` si no vive en las pestañas (no intenta frenar el deslizamiento) */
export function NovaHeroe({ y: yExt, base, habla, alto = 212, size = 260, alTocar, orbes = 6, halo = true, enPaginador = true }: { y?: SharedValue<number>; base: Expr; habla?: SharedValue<number>; alto?: number; size?: number; alTocar?: () => void; orbes?: number; halo?: boolean; enPaginador?: boolean }) {
  const yLocal = useSharedValue(0), y = yExt ?? yLocal;
  // al bajar lo suficiente NOVA sale de la pantalla: se pausa hasta volver
  const [aLaVista, setALaVista] = useState(true);
  const { t } = useIdioma();
  useAnimatedReaction(() => y.value < alto + 140, (v, prev) => { if (prev !== null && v !== prev) scheduleOnRN(setALaVista, v); });
  const yaw = useSharedValue(0), pitch = useSharedValue(0), yaw0 = useSharedValue(0);
  const giro = useDerivedValue(() => [yaw.value, pitch.value]);
  const tx = useSharedValue(0), ty = useSharedValue(0), escala = useSharedValue(1), apr = useSharedValue(1);
  const agarrada = useSharedValue(0), recorrido = useSharedValue(0), px = useSharedValue(0), py = useSharedValue(0), cara = useSharedValue(-1);
  const mira = useSharedValue<number[] | null>(null);

  // expresión del momento; si trae duración, vuelve sola a la expresión base
  // e: una expresión del momento (null = la base, que puede cambiar desde afuera: en el foco, dormida al pausar)
  const [estado, setEstado] = useState<{ e: Expr | null; ms: number }>({ e: null, ms: 0 });
  useEffect(() => {
    if (!estado.ms) return;
    const id = setTimeout(() => setEstado({ e: null, ms: 0 }), estado.ms);
    return () => clearTimeout(id);
  }, [estado]);
  const poner = (e: Expr | null, ms = 0) => setEstado({ e, ms });
  const vibrar = (k: 0 | 1 | 2) => {
    Haptics.impactAsync([Haptics.ImpactFeedbackStyle.Light, Haptics.ImpactFeedbackStyle.Medium, Haptics.ImpactFeedbackStyle.Heavy][k]).catch(() => {});
  };
  const tic = () => { Haptics.selectionAsync().catch(() => {}); };
  const abrir = () => { vibrar(0); if (alTocar) alTocar(); else router.push('/nova'); };
  // mientras la tocas, el paginador no cambia de pantalla (si no, girarla te llevaría a Body)
  const navegacion = useNavigation();
  const paginar = (si: boolean) => { if (enPaginador) navegacion.setOptions({ swipeEnabled: si } as object); };

  // mantener apretada ~300 ms sin mover: la levantas; ahí se arrastra y va cambiando de carita.
  // (Un solo Pan que se activa tras la pulsación larga; el gesto LongPress combinado cerraba la app en Android.)
  const levantar = Gesture.Pan()
    .activateAfterLongPress(300)
    .onBegin(() => { scheduleOnRN(paginar, false); })
    .onStart(() => {
      agarrada.value = 1; recorrido.value = 0; cara.value = 0; px.value = 0; py.value = 0;
      apr.value = withSpring(1.12, { damping: 10, stiffness: 260 });
      scheduleOnRN(vibrar, 1);
      scheduleOnRN(poner, CARAS[0], 0);
    })
    .onUpdate(e => {
      mira.value = [Math.max(-1, Math.min(1, e.translationX / 90)), Math.max(-1, Math.min(1, e.translationY / 90))];
      const goma = (d: number) => { const a = Math.abs(d); return Math.sign(d) * (a < LIMITE ? a : LIMITE + (a - LIMITE) * 0.25); };
      tx.value = goma(e.translationX); ty.value = goma(e.translationY);
      recorrido.value += Math.hypot(e.translationX - px.value, e.translationY - py.value);
      px.value = e.translationX; py.value = e.translationY;
      const k = Math.floor(recorrido.value / PASO_CARA) % CARAS.length;
      if (k !== cara.value) { cara.value = k; scheduleOnRN(poner, CARAS[k], 0); scheduleOnRN(tic); }
    })
    .onEnd(e => {
      tx.value = withSpring(0, { velocity: e.velocityX, damping: 8, stiffness: 120 });
      ty.value = withSpring(0, { velocity: e.velocityY, damping: 8, stiffness: 120 });
      scheduleOnRN(vibrar, 0);
    })
    .onFinalize(() => {
      scheduleOnRN(paginar, true);
      mira.value = null;
      if (agarrada.value) { agarrada.value = 0; scheduleOnRN(poner, 'feliz', 1500); }
      tx.value = withSpring(0, { damping: 8, stiffness: 120 }); ty.value = withSpring(0, { damping: 8, stiffness: 120 });
      apr.value = withSpring(1, { damping: 9, stiffness: 240 });
    });

  // arrastrar enseguida: la gira en 3D
  const arrastre = Gesture.Pan()
    .minDistance(3)
    .onBegin(() => { scheduleOnRN(paginar, false); })
    .onStart(() => { yaw0.value = yaw.value; scheduleOnRN(poner, 'sorprendida', 0); })
    .onUpdate(e => {
      mira.value = [Math.max(-1, Math.min(1, e.translationX / 90)), Math.max(-1, Math.min(1, e.translationY / 90))];
      yaw.set(yaw0.value + e.translationX * 0.014);
      pitch.set(Math.max(-0.85, Math.min(0.85, -e.translationY * 0.007)));
    })
    .onEnd(e => {
      // sigue girando con la inercia del dedo y se detiene mirando al frente (la vuelta entera más cercana)
      const vuelta = 2 * Math.PI;
      yaw.set(withDecay({ velocity: e.velocityX * 0.014, deceleration: 0.993 }, fin => {
        'worklet';
        if (fin) yaw.set(withSpring(Math.round(yaw.value / vuelta) * vuelta, { damping: 11, stiffness: 70 }));
      }));
      const vueltas = Math.abs(e.velocityX) > 1500;
      scheduleOnRN(poner, vueltas ? 'sorprendida' : 'feliz', vueltas ? 1600 : 1200);
    })
    .onFinalize(() => {
      scheduleOnRN(paginar, true);
      mira.value = null;
      pitch.set(withSpring(0, { damping: 7, stiffness: 120 }));
    });

  // dos dedos: estirarla
  const pellizco = Gesture.Pinch()
    .onStart(() => { scheduleOnRN(poner, 'sorprendida', 0); })
    .onUpdate(e => { escala.value = Math.max(0.7, Math.min(1.45, e.scale)); })
    .onEnd(() => { escala.value = withSpring(1, { damping: 6, stiffness: 160 }); scheduleOnRN(poner, 'feliz', 1200); });

  // doble toque: una vuelta 3D completa; un toque: abre el chat
  const doble = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const vuelta = 2 * Math.PI, fin = Math.round(yaw.value / vuelta) * vuelta + vuelta;
      yaw.set(withTiming(fin, { duration: 900, easing: Easing.out(Easing.cubic) }));
      apr.value = withSequence(withTiming(0.88, { duration: 120 }), withSpring(1, { damping: 7 }));
      scheduleOnRN(vibrar, 1);
      scheduleOnRN(poner, 'feliz', 1400);
    });
  const toque = Gesture.Tap()
    .maxDuration(250)
    .onEnd(() => { apr.value = withSequence(withTiming(0.9, { duration: 90 }), withSpring(1, { damping: 8 })); scheduleOnRN(abrir); });

  // levantar (pulsación larga), girar (arrastre inmediato) y tocar compiten: gana el primero que se activa
  const gesto = Gesture.Simultaneous(Gesture.Race(levantar, arrastre, Gesture.Exclusive(doble, toque)), pellizco);

  const estilo = useAnimatedStyle(() => {
    const salida = interpolate(y.value, [0, 90], [1, 0], 'clamp');
    const s = apr.value * escala.value * (0.55 + 0.45 * salida);
    return {
      opacity: salida,
      transform: [
        { translateX: tx.value },
        { translateY: ty.value - (1 - salida) * 40 },
        { scale: s },
      ],
    };
  });

  return (
    <View style={{ height: alto, alignItems: 'center', justifyContent: 'center', marginTop: -8, zIndex: 5 }}>
      <GestureDetector gesture={gesto}>
        <Animated.View style={estilo} accessible accessibilityRole="button" accessibilityLabel={t('Nova. Tap to talk, drag to turn her around, hold to pick her up')}>
          <NovaOrb size={size} orbes={orbes} halo={halo} expr={estado.e ?? base} miraViva={mira} giro={giro} hablaViva={habla} activo={aLaVista} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
