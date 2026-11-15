/* Paginador en anillo: las pantallas se recorren arrastrando hacia el lado y al llegar al final se da la vuelta
   (Today ⇄ Body ⇄ Mind ⇄ Journal ⇄ You ⇄ Today). Es un navegador de pestañas de expo-router; cada página se mueve
   con Reanimated según `pos`, que no tiene tope (su resto módulo N es la página). Sin rebotes: el suelte es un timing. */
import { Freeze } from 'react-freeze';
import { useLigero } from '../engine/rendimiento';
import { withLayoutContext } from 'expo-router';
import { createNavigatorFactory, TabRouter, useIsFocused, useNavigationBuilder, type ParamListBase, type TabNavigationState } from 'expo-router/react-navigation';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Activa } from './activa';

type Opciones = { title?: string; swipeEnabled?: boolean };
type Descriptores = Record<string, { options: Opciones; render: () => ReactNode }>;
export type PropsBarra = {
  state: TabNavigationState<ParamListBase>;
  descriptors: Descriptores;
  navigation: { emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean }; navigate: (name: string, params?: object) => void };
};

const mod = (a: number, n: number) => ((a % n) + n) % n;

/* la pestaña que la barra marca: cambia apenas el deslizamiento pasa la mitad, sin esperar a la ruta
   (que cambia al terminar). Es un store aparte para que solo se redibuje la barra, no las pantallas */
let marcada = -1;
const oyentesMarca = new Set<() => void>();
function marcar(i: number) { if (i !== marcada) { marcada = i; oyentesMarca.forEach(o => o()); } }
const suscribirMarca = (o: () => void) => { oyentesMarca.add(o); return () => { oyentesMarca.delete(o); }; };
/** índice de la página que se ve (o `porDefecto` antes del primer gesto) */
export function useMarcada(porDefecto: number) {
  const m = useSyncExternalStore(suscribirMarca, () => marcada, () => marcada);
  return m < 0 ? porDefecto : m;
}
const SUELTE = { duration: 280, easing: Easing.out(Easing.cubic) };

/** de la página `de` a la `a`: por el anillo, por el camino más corto */
function salto(de: number, a: number, n: number) {
  const d = mod(a - de, n);
  return d > n / 2 ? d - n : d;
}

function Pagina({ i, n, pos, ancho, children }: { i: number; n: number; pos: SharedValue<number>; ancho: number; children: ReactNode }) {
  const st = useAnimatedStyle(() => {
    const d = (((i - pos.value + n / 2) % n) + n) % n - n / 2;
    return { transform: [{ translateX: d * ancho }], opacity: Math.abs(d) < 1.2 ? 1 : 0 };
  });
  return <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: ancho }, st]}>{children}</Animated.View>;
}

type PropsNavegador = {
  children: ReactNode; initialRouteName?: string; screenOptions?: Opciones; id?: string;
  tabBar: (p: PropsBarra) => ReactNode; fondo: string;
  /** cómo saltar entre estas rutas al tocar la barra: en el orden de la barra, sin dar la vuelta */
  enBarra: string[];
};

function Navegador({ children, initialRouteName, screenOptions, id, tabBar, fondo, enBarra }: PropsNavegador) {
  const { state, descriptors, navigation, NavigationContent } = useNavigationBuilder(TabRouter, { children, initialRouteName, screenOptions, id } as never);
  const n = state.routes.length, { width: ancho } = useWindowDimensions();
  // con un modal encima (NOVA, tus datos…) las pestañas no se ven: nada anima
  const enPrimerPlano = useIsFocused(), ligero = useLigero();
  const pos = useSharedValue(state.index);
  const meta = useSharedValue(state.index); // entero sin tope hacia donde va `pos`
  const propio = useSharedValue(-1); // índice que puso el gesto (para no animarlo dos veces)
  const swipe = (descriptors[state.routes[state.index].key].options as Opciones).swipeEnabled !== false;

  const ir = (destino: number) => {
    meta.set(destino);
    const i = mod(destino, n);
    if (i === state.index) return;
    propio.set(i);
    navigation.navigate(state.routes[i].name);
  };

  // durante un salto desde la barra la marca ya está puesta: no la mueven las páginas intermedias
  const externo = useSharedValue(0);
  useAnimatedReaction(() => { const r = Math.round(pos.value) % n; return r < 0 ? r + n : r; }, (v, prev) => { if (v !== prev && !externo.value) scheduleOnRN(marcar, v); });
  useEffect(() => { marcar(state.index); }, [state.index]);

  // cambios que no vienen del gesto (la barra, el avatar, un enlace): desliza una sola página aunque sean varias
  useEffect(() => {
    if (propio.get() === state.index) { propio.set(-1); return; }
    const de = mod(meta.get(), n);
    if (de === state.index) return;
    const a = state.routes[state.index].name, b = state.routes[de].name;
    const d = enBarra.includes(a) && enBarra.includes(b) ? enBarra.indexOf(a) - enBarra.indexOf(b) : salto(de, state.index, n);
    const fin = meta.get() + d;
    meta.set(fin);
    externo.set(1);
    const listo = (ok?: boolean) => { 'worklet'; if (ok) externo.value = 0; };
    pos.set(Math.abs(d) > 1 ? withSequence(withTiming(fin - Math.sign(d), { duration: 0 }), withTiming(fin, SUELTE, listo)) : withTiming(fin, SUELTE, listo));
  }, [state.index, state.routes, n, enBarra, pos, meta, propio, externo]);

  const base = useSharedValue(0);
  const arrastre = Gesture.Pan()
    .enabled(swipe)
    .activeOffsetX([-16, 16])
    .failOffsetY([-14, 14])
    .onStart(() => { cancelAnimation(pos); externo.set(0); base.set(pos.get()); })
    .onUpdate(e => { pos.set(base.get() - e.translationX / ancho); })
    .onEnd(e => {
      const desde = Math.round(base.get());
      const empuje = Math.max(-0.6, Math.min(0.6, (-e.velocityX / ancho) * 0.25));
      const destino = Math.max(desde - 1, Math.min(desde + 1, Math.round(pos.get() + empuje)));
      // la ruta cambia al terminar el deslizamiento: así el re-render no compite con la animación
      pos.set(withTiming(destino, SUELTE, fin => { if (fin) scheduleOnRN(ir, destino); }));
    });

  return (
    <NavigationContent>
      <GestureDetector gesture={arrastre}>
        <View style={{ flex: 1, backgroundColor: fondo, overflow: 'hidden' }}>
          {state.routes.map((r, i) => (
            <Activa.Provider key={r.key} value={enPrimerPlano && i === state.index}>
              <Pagina i={i} n={n} pos={pos} ancho={ancho}>
                {/* modo liviano: las pestañas que no son la actual ni sus vecinas (las que se asoman al deslizar) se congelan:
                    no se redibujan con cada cambio de datos hasta que vuelves a ellas */}
                <Freeze freeze={ligero && i !== state.index && Math.min(mod(i - state.index, n), mod(state.index - i, n)) > 1}>{descriptors[r.key].render()}</Freeze>
              </Pagina>
            </Activa.Provider>
          ))}
        </View>
      </GestureDetector>
      <Activa.Provider value={enPrimerPlano}>
      {tabBar({ state, descriptors: descriptors as unknown as Descriptores, navigation: navigation as unknown as PropsBarra['navigation'] })}
      </Activa.Provider>
    </NavigationContent>
  );
}

export const Paginador = withLayoutContext(createNavigatorFactory(Navegador)().Navigator);
