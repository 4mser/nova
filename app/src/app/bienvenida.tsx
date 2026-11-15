/* Bienvenida: lo esencial de NOVA en seis páginas. Una sola NOVA viaja entre ellas (se mueve, se achica y cambia de
   cara con el deslizamiento) y cada página anima lo que se hace en la app: el check-in, el foco, el momento de la
   crew, las tareas y retos. Todo se calcula desde dos valores en el hilo de UI: el desplazamiento (x) y un reloj
   por página (cada escena corre su propia línea de tiempo, en bucle, desde que llega su página).
   Se ve una vez por cuenta; desde «Tú» se puede volver a ver. */
import { Ionicons } from '@expo/vector-icons';
import { Canvas, Circle, Points, RadialGradient, vec } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import Animated, { interpolateColor, useAnimatedProps, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useDerivedValue, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle as SvgCircle } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { terminarBienvenida } from '../cuenta/bienvenida';
import { agendarMomentos } from '../cuenta/momento';
import { ListaPermisos } from '../ui/ListaPermisos';
import { registrarPush } from '../cuenta/push';
import { useCrew, useSesion, type Usuario } from '../cuenta/sesion';
import { ESCALAS, nivelDe } from '../engine/diario';
import { useIdioma } from '../i18n';
import type { Expr } from '../nova/forma';
import { NovaOrb } from '../nova/NovaOrb';
import { colorNivel } from '../ui/CheckIn';
import { AvatarMiembro } from '../ui/Crew';
import { C, Txt } from '../ui/tema';

const N = 7, BASE = 280, PERM = 5; // PERM: la página de permisos
const CARAS: Expr[] = ['feliz', 'pensativa', 'normal', 'sorprendida', 'feliz', 'normal', 'feliz'];
const MIRAS: ([number, number] | undefined)[] = [undefined, [-0.7, 0.6], undefined, [0, -0.5], [0.7, 0.6], [-0.6, 0.5], undefined];
const TONOS = ['#46c8e8', '#a898ff', '#46c8e8', '#f2b457', '#6fd6b0', '#a898ff', '#8fe6f5'];

/* curvas y tramos (worklets) */
const pr = (u: number, a: number, d: number) => { 'worklet'; return Math.min(1, Math.max(0, (u - a) / d)); };
const eOut = (x: number) => { 'worklet'; return 1 - Math.pow(1 - x, 3); };
const eIO = (x: number) => { 'worklet'; return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const eBack = (x: number) => { 'worklet'; const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
/** un ciclo que entra, se queda y se va: 0→1 en [a, a+d], 1 hasta b, 1→0 en [b, b+d] */
const tramo = (u: number, a: number, b: number, d = 0.4) => { 'worklet'; return Math.min(eOut(pr(u, a, d)), 1 - pr(u, b, d)); };

type Marco = { W: number; H: number; top: number; alto: number; compacta: boolean };
type Esc = { i: number; x: SharedValue<number>; tt: SharedValue<number>; ini: SharedValue<number[]>; m: Marco };
/** segundos desde que llegó esta página (en bucle de `periodo`, después de `intro`) */
function useReloj({ i, tt, ini }: Esc, periodo: number, intro = 0) {
  return useDerivedValue(() => {
    const s = tt.value - ini.value[i];
    return s < intro ? s : intro + ((s - intro) % periodo);
  });
}

export default function Bienvenida() {
  const { width: W, height: H } = useWindowDimensions(), ins = useSafeAreaInsets();
  const { t } = useIdioma(), { usuario } = useSesion(), crew = useCrew();
  const nombre = (usuario?.nombre ?? '').split(' ')[0];
  const m: Marco = useMemo(() => {
    // pantallas bajas: la escena se acorta y el texto baja un punto, para que nada choque con los botones
    const top = ins.top + 48, compacta = H < 800;
    return { W, H, top, compacta, alto: compacta ? Math.max(290, H * 0.43) : Math.max(320, Math.min(430, H * 0.47)) };
  }, [W, H, ins.top]);

  const x = useSharedValue(0), tt = useSharedValue(0);
  // inicio de la línea de tiempo de cada página: las que no se ven quedan «antes de empezar» (vacías)
  const ini = useSharedValue<number[]>(Array.from({ length: N }, (_, i) => (i ? 1e9 : 0))), viva = useSharedValue<number[]>(Array.from({ length: N }, (_, i) => (i ? 0 : 1)));
  const [pag, setPag] = useState(0);
  const ref = useRef<Animated.ScrollView>(null);
  useFrameCallback(f => { tt.value += Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000); }, true);
  const onScroll = useAnimatedScrollHandler(e => {
    const v = e.contentOffset.x, q = v / W;
    x.value = v;
    const a = Math.max(0, Math.floor(q + 0.002)), b = Math.min(N - 1, Math.ceil(q - 0.002));
    const asentada = Math.abs(q - Math.round(q)) < 0.002;
    let cambia = false;
    const nv = viva.value.slice(), ni = ini.value.slice();
    for (let k = 0; k < N; k++) {
      const enVista = k === a || k === b;
      if (enVista && !nv[k]) { nv[k] = 1; ni[k] = tt.value; cambia = true; }
      // la que sale del todo vuelve a empezar desde cero la próxima vez
      if (asentada && !enVista && nv[k]) { nv[k] = 0; ni[k] = 1e9; cambia = true; }
    }
    if (cambia) { viva.value = nv; ini.value = ni; }
  });
  useAnimatedReaction(() => Math.round(x.value / W), (k, prev) => {
    if (prev === null || k === prev || k < 0 || k >= N) return;
    scheduleOnRN(setPag, k);
  }, [W]);
  useEffect(() => { Haptics.selectionAsync().catch(() => {}); }, [pag]);

  const ir = (k: number) => ref.current?.scrollTo({ x: k * W, animated: true });
  // con avisos concedidos: los momentos de la crew y el registro para push
  const { idioma } = useIdioma();
  const alAvisos = () => { agendarMomentos(crew ? { id: crew.id, nombre: crew.nombre } : null); registrarPush(idioma); };
  const terminar = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    terminarBienvenida();
  };

  const esc = (i: number): Esc => ({ i, x, tt, ini, m });
  const ultima = pag === N - 1;
  const textos = [
    { rot: 'NOVA', h: nombre ? t('Hi, {nombre}', { nombre }) : t('Hi'), b: t("I'm Nova, your assistant. Talk to me and I get things done: tasks, reminders, alarms, your calendar. And I look after your health, your focus and your team. Here is the essential in one minute.") },
    { rot: t('01 · Your day'), h: t('Your day, in order'), b: t('Every morning: weather, calendar, tasks and your best gap for focus. A one-minute check-in and your health data tell me what suits you today. Tap me any time to talk.') },
    { rot: t('02 · Focus'), h: t('Focus without distractions'), b: t('Pick how long and whether it is to work or to learn, with music if you like. Put the phone down and I keep the time; when it ends, I let you know.') },
    { rot: t('03 · Your crew'), h: t('One moment a day, together'), b: t('At a surprise hour I notify everyone at once. You have 10 minutes to share a photo of what you are doing, and it stays in the crew stories.') },
    { rot: t('04 · Your team'), h: t('Work as a team'), b: t('Daily standup, a shared log, goals with an owner for each result, tasks and challenges. Everyone sees the progress, and I let you know if someone gets stuck.') },
    { rot: t('05 · Permissions'), h: t('What Nova needs'), b: t('Only what you allow. You can change it any time in You → Permissions.') },
    { rot: t('Ready'), h: nombre ? t('All set, {nombre}', { nombre }) : t('All set'), b: t('Swipe sideways to move between Today, Crew, Log and Health. From any app, share something with me and I turn it into a task, a note or a reminder.') },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Fondo x={x} tt={tt} m={m} />
      <Animated.ScrollView ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={16} bounces={false} overScrollMode="never">
        {textos.map((tx, i) => (
          <View key={i} style={{ width: W, height: H }}>
            {i === 0 ? <EscenaHola {...esc(i)} /> : i === 1 ? <EscenaDia {...esc(i)} /> : i === 2 ? <EscenaFoco {...esc(i)} /> : i === 3 ? <EscenaCrew {...esc(i)} miembros={crew?.miembros ?? []} /> : i === 4 ? <EscenaJuntos {...esc(i)} miembros={crew?.miembros ?? []} /> : i === PERM ? null : <EscenaListo {...esc(i)} />}
            <Texto i={i} x={x} m={m} {...tx} arriba={i === PERM} />
            {i === PERM ? <PaginaPermisos i={i} x={x} m={m} alAvisos={alAvisos} /> : null}
          </View>
        ))}
      </Animated.ScrollView>
      <Viajera x={x} m={m} expr={CARAS[pag]} mira={MIRAS[pag]} />

      {/* saltar: lleva a la última página (la de los avisos), no cierra */}
      <View style={{ position: 'absolute', top: ins.top + 6, right: 16, opacity: ultima ? 0 : 1 }} pointerEvents={ultima ? 'none' : 'auto'}>
        <Pressable onPress={() => ir(PERM)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Skip')} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center' }}>
          <Txt f="m" size={14.5} color={C.t2}>{t('Skip')}</Txt>
        </Pressable>
      </View>

      <View style={{ position: 'absolute', left: 24, right: 24, bottom: ins.bottom + 22, flexDirection: 'row', alignItems: 'center' }}>
        {/* en la última, los puntos dejan su lugar al botón de avisos */}
        <Puntos x={x} W={W} />
        <Pressable onPress={() => (ultima ? terminar() : ir(pag + 1))} accessibilityRole="button" accessibilityLabel={ultima ? t('Start') : t('Next')}
          style={({ pressed }) => ({ height: 56, paddingHorizontal: 24, borderRadius: 28, backgroundColor: C.nova, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }], boxShadow: '0 10px 30px -10px rgba(70,200,232,0.7)' })}>
          <Txt f="s" size={16} color={C.tinta}>{ultima ? t('Start') : t('Next')}</Txt>
          <Ionicons name="arrow-forward" size={18} color={C.tinta} />
        </Pressable>
      </View>
    </View>
  );
}

/* ── piezas comunes ─────────────────────────────────────────────────────────────────────────────────────────── */

/** fondo: estrellas en tres capas con paralaje y un resplandor que sigue a NOVA y cambia de tono por página */
const ESTRELLAS = Array.from({ length: 90 }, (_, i) => { const h = (k: number) => { const v = Math.sin(i * 91.7 + k * 47.3) * 43758.5453; return v - Math.floor(v); }; return [h(1), h(2), i % 3]; });
const TONOS_A = TONOS.map(c => conAlfa(c, 0.3)), TONOS_B = TONOS.map(c => conAlfa(c, 0.06));
function conAlfa(hex: string, a: number) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
function capaEstrellas(x: number, k: number, W: number, H: number) {
  'worklet';
  const ancho = W * 1.6, out = [];
  for (const [a, b, c] of ESTRELLAS) {
    if (c !== k) continue;
    out.push(vec((((a * ancho - x * (0.06 + k * 0.07)) % ancho) + ancho) % ancho - W * 0.3, b * H * 0.92));
  }
  return out;
}
function Fondo({ x, tt, m }: { x: SharedValue<number>; tt: SharedValue<number>; m: Marco }) {
  const { W, H } = m;
  const c0 = useDerivedValue(() => capaEstrellas(x.value, 0, W, H));
  const c1 = useDerivedValue(() => capaEstrellas(x.value, 1, W, H));
  const c2 = useDerivedValue(() => capaEstrellas(x.value, 2, W, H));
  const op0 = useDerivedValue(() => 0.25 + 0.15 * Math.sin(tt.value * 1.3));
  const op2 = useDerivedValue(() => 0.5 + 0.25 * Math.sin(tt.value * 0.9 + 2));
  const nova = useDerivedValue(() => posNova(x.value / W, m));
  const centro = useDerivedValue(() => vec(nova.value[0], nova.value[1]));
  const gx = useDerivedValue(() => nova.value[0]), gy = useDerivedValue(() => nova.value[1]);
  const radio = useDerivedValue(() => 90 + nova.value[2] * 220);
  const colores = useDerivedValue(() => {
    const p = x.value / W, idx = [0, 1, 2, 3, 4, 5, 6];
    return [interpolateColor(p, idx, TONOS_A), interpolateColor(p, idx, TONOS_B), 'rgba(0,0,0,0)'];
  });
  return (
    <Canvas style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }} pointerEvents="none">
      <Circle cx={gx} cy={gy} r={radio}>
        <RadialGradient c={centro} r={radio} colors={colores} positions={[0, 0.55, 1]} />
      </Circle>
      <Points points={c0} mode="points" color="#c4f6fd" strokeWidth={1.2} strokeCap="round" opacity={op0} />
      <Points points={c1} mode="points" color="#c4f6fd" strokeWidth={1.6} strokeCap="round" opacity={0.35} />
      <Points points={c2} mode="points" color="#ffffff" strokeWidth={2.2} strokeCap="round" opacity={op2} />
    </Canvas>
  );
}

/** dónde va NOVA en cada página: [centro x, centro y, escala] (se interpola entre páginas, con un arco al viajar) */
function posNova(p: number, { W, top, alto, compacta }: Marco) {
  'worklet';
  const cy = top + alto * 0.5;
  const K = [
    [W / 2, cy - 6, 1],
    [W - 58, top + 34, 0.3],
    [W / 2, cy - (compacta ? 24 : 12), compacta ? 0.38 : 0.46],
    [W / 2, cy + 18, 0.44],
    [54, top + 30, 0.28],
    [W - 56, top + 20, 0.26],
    [W / 2, top + alto * 0.36, 0.8],
  ];
  const q = Math.max(0, Math.min(N - 1, p)), a = Math.floor(q), b = Math.min(N - 1, a + 1), f = eIO(q - a);
  const arco = Math.sin(Math.PI * (q - a)) * 34;
  return [K[a][0] + (K[b][0] - K[a][0]) * f, K[a][1] + (K[b][1] - K[a][1]) * f - arco, K[a][2] + (K[b][2] - K[a][2]) * f];
}

function Viajera({ x, m, expr, mira }: { x: SharedValue<number>; m: Marco; expr: Expr; mira?: [number, number] }) {
  const st = useAnimatedStyle(() => {
    const [cx, cy, s] = posNova(x.value / m.W, m);
    return { transform: [{ translateX: cx - BASE / 2 }, { translateY: cy - BASE / 2 }, { scale: s }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: BASE, height: BASE }, st]}>
      <NovaOrb size={BASE} orbes={6} expr={expr} mira={mira} />
    </Animated.View>
  );
}

const paralaje = (rel: number, k: number, W: number) => { 'worklet'; return { opacity: 1 - Math.min(1, Math.abs(rel) * (1.5 + k * 0.4)), transform: [{ translateX: rel * W * (0.32 + k * 0.1) }] }; };
function Texto({ i, x, m, rot, h, b, arriba }: { i: number; x: SharedValue<number>; m: Marco; rot: string; h: string; b: string; arriba?: boolean }) {
  // paralaje: el texto se queda un poco atrás de su página y se desvanece al irse (rótulo, título y cuerpo a destiempo)
  const s0 = useAnimatedStyle(() => paralaje(x.value / m.W - i, 0, m.W));
  const s1 = useAnimatedStyle(() => paralaje(x.value / m.W - i, 1, m.W));
  const s2 = useAnimatedStyle(() => paralaje(x.value / m.W - i, 2, m.W));
  return (
    <View style={{ position: 'absolute', left: 28, right: arriba ? 90 : 28, top: arriba ? m.top + 2 : m.top + m.alto + 6 }}>
      <Animated.View style={s0}><Txt f="mono" size={12} ls={1.4} color={C.nova} style={{ textTransform: 'uppercase' }}>{rot}</Txt></Animated.View>
      <Animated.View style={s1}><Txt f="s" size={m.compacta ? 25 : 29} ls={-1.1} lh={m.compacta ? 29 : 33} style={{ marginTop: 8 }}>{h}</Txt></Animated.View>
      <Animated.View style={s2}><Txt size={m.compacta ? 14.5 : 15.5} lh={m.compacta ? 20.5 : 22.5} color={C.t2} style={{ marginTop: 10 }}>{b}</Txt></Animated.View>
    </View>
  );
}

function Puntos({ x, W }: { x: SharedValue<number>; W: number }) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center' }}>
      {Array.from({ length: N }, (_, i) => <Punto key={i} i={i} x={x} W={W} />)}
    </View>
  );
}
function Punto({ i, x, W }: { i: number; x: SharedValue<number>; W: number }) {
  const st = useAnimatedStyle(() => {
    const d = Math.max(0, 1 - Math.abs(x.value / W - i));
    return { width: 7 + d * 19, backgroundColor: interpolateColor(d, [0, 1], ['rgba(255,255,255,0.16)', C.nova]) };
  });
  return <Animated.View style={[{ height: 7, borderRadius: 4 }, st]} />;
}

/** página de permisos: la lista completa debajo del texto, con el mismo paralaje que el resto */
function PaginaPermisos({ i, x, m, alAvisos }: { i: number; x: SharedValue<number>; m: Marco; alAvisos: () => void }) {
  const st = useAnimatedStyle(() => paralaje(x.value / m.W - i, 2, m.W));
  return (
    <Animated.View style={[{ position: 'absolute', left: 20, right: 20, top: m.top + (m.compacta ? 146 : 158) }, st]}>
      {/* en la bienvenida, filas cortas (el para qué de cada uno está en Tú → Permisos) */}
      <ListaPermisos compacta alAvisos={alAvisos} />
    </Animated.View>
  );
}

/* ── escenas ────────────────────────────────────────────────────────────────────────────────────────────────── */

/** 0 · Hola: NOVA al centro, ondas que salen de ella y lo que cuida orbitando alrededor */
const ORBITA: [keyof typeof Ionicons.glyphMap, string][] = [['heart', C.alerta], ['moon', C.lila], ['timer-outline', C.nova], ['people', C.aviso], ['book-outline', C.ok], ['checkmark-done', C.sig]];
function EscenaHola(e: Esc) {
  const s = useReloj(e, 1e9);
  const { W, top, alto } = e.m, cx = W / 2, cy = top + alto * 0.5 - 6;
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} pointerEvents="none">
      {[0, 1, 2].map(k => <Onda key={k} k={k} s={s} cx={cx} cy={cy} />)}
      {ORBITA.map(([ic, col], k) => <ChipOrbita key={k} k={k} s={s} cx={cx} cy={cy} rx={Math.min(W * 0.4, 170)} ry={alto * 0.3} ic={ic} col={col} />)}
    </View>
  );
}
function Onda({ k, s, cx, cy }: { k: number; s: SharedValue<number>; cx: number; cy: number }) {
  const st = useAnimatedStyle(() => {
    const u = ((s.value + k * 1.2) % 3.6) / 3.6;
    return { opacity: (1 - u) * 0.5 * pr(s.value, 0.3, 0.8), transform: [{ scale: 0.4 + u * 1.3 }] };
  });
  return <Animated.View style={[{ position: 'absolute', left: cx - 120, top: cy - 120, width: 240, height: 240, borderRadius: 120, borderWidth: 1, borderColor: C.nova }, st]} />;
}
function ChipOrbita({ k, s, cx, cy, rx, ry, ic, col }: { k: number; s: SharedValue<number>; cx: number; cy: number; rx: number; ry: number; ic: keyof typeof Ionicons.glyphMap; col: string }) {
  const st = useAnimatedStyle(() => {
    const a = s.value * 0.32 + (k * Math.PI * 2) / ORBITA.length - 0.6;
    const prof = (Math.sin(a) + 1) / 2; // 0 atrás, 1 adelante
    const ent = eBack(pr(s.value, 0.25 + k * 0.1, 0.6));
    return {
      opacity: pr(s.value, 0.25 + k * 0.1, 0.25) * (0.45 + 0.55 * prof),
      transform: [{ translateX: cx + Math.cos(a) * rx * ent - 22 }, { translateY: cy + Math.sin(a) * ry * ent - 22 }, { scale: (0.7 + 0.35 * prof) * ent }],
    };
  });
  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 44, height: 44, borderRadius: 22, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }, st]}>
      <Ionicons name={ic} size={19} color={col} />
    </Animated.View>
  );
}

/** 1 · Tu día: un check-in que se va llenando (toque, barras, palabra) y NOVA respondiendo debajo */
const FILAS = [{ e: ESCALAS[0], v: 4 }, { e: ESCALAS[1], v: 3 }, { e: ESCALAS[3], v: 4 }];
function EscenaDia(e: Esc) {
  const s = useReloj(e, 8.5);
  const tr = useIdioma(), { t } = tr, { top } = e.m;
  const card = useAnimatedStyle(() => ({ opacity: tramo(s.value, 0.1, 7.9, 0.5), transform: [{ translateY: (1 - eOut(pr(s.value, 0.1, 0.6))) * 26 }] }));
  const burbuja = useAnimatedStyle(() => { const k = tramo(s.value, 4.2, 7.7, 0.5); return { opacity: k, transform: [{ translateY: (1 - eBack(pr(s.value, 4.2, 0.6))) * 18 }, { scale: 0.94 + 0.06 * k }] }; });
  return (
    <View style={{ position: 'absolute', left: 24, right: 24, top: top + (e.m.compacta ? 52 : 82) }} pointerEvents="none">
      <Animated.View style={[{ borderRadius: 24, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, paddingHorizontal: 16, paddingVertical: e.m.compacta ? 4 : 10 }, card]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
          <Txt f="s" size={15} style={{ flex: 1 }}>{t('Check-in')}</Txt>
          <Txt f="monoR" size={12} color={C.t3}>{t('today')}</Txt>
        </View>
        {FILAS.map((f, k) => <FilaCheck key={k} k={k} s={s} f={f} palabra={nivelDe(tr, f.e, f.v)} etiqueta={t(f.e.t)} alto={e.m.compacta ? 40 : 46} />)}
      </Animated.View>
      <Animated.View style={[{ marginTop: 10, marginRight: 30, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 20, borderTopLeftRadius: 6, backgroundColor: C.s2, borderWidth: 1, borderColor: 'rgba(168,152,255,0.25)' }, burbuja]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.lila }} />
          <Txt f="s" size={12.5} color={C.lila}>Nova</Txt>
        </View>
        <Txt size={e.m.compacta ? 13.5 : 14.5} lh={e.m.compacta ? 18.5 : 20}>{t('Good mood and you slept well. A good day for the hard task: start before noon.')}</Txt>
      </Animated.View>
    </View>
  );
}
function FilaCheck({ k, s, f, palabra, etiqueta, alto }: { k: number; s: SharedValue<number>; f: (typeof FILAS)[number]; palabra: string; etiqueta: string; alto: number }) {
  const t0 = 0.9 + k * 1.0, col = colorNivel(f.v, f.e.altoEsBueno);
  const toque = useAnimatedStyle(() => { const u = eOut(pr(s.value, t0, 0.6)); return { opacity: u > 0 && u < 1 ? (1 - u) * 0.9 : 0, transform: [{ scale: 0.3 + u * 1.2 }] }; });
  const pal = useAnimatedStyle(() => ({ opacity: pr(s.value, t0 + 0.35, 0.3), transform: [{ translateX: (1 - eOut(pr(s.value, t0 + 0.35, 0.4))) * 8 }] }));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height: alto, borderTopWidth: 1, borderTopColor: C.l1, gap: 12 }}>
      <Ionicons name={f.e.icono as keyof typeof Ionicons.glyphMap} size={17} color={C.t2} />
      <Txt size={14.5} color={C.t2} style={{ width: 74 }}>{etiqueta}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 20 }}>
        {[1, 2, 3, 4, 5].map(n => <Barrita key={n} n={n} v={f.v} col={col} s={s} t0={t0} />)}
        <Animated.View style={[{ position: 'absolute', left: (f.v - 1) * 9 - 13, top: -6, width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: col }, toque]} />
      </View>
      <Animated.View style={[{ flex: 1, alignItems: 'flex-end' }, pal]}><Txt f="m" size={14} color={col}>{palabra}</Txt></Animated.View>
    </View>
  );
}
function Barrita({ n, v, col, s, t0 }: { n: number; v: number; col: string; s: SharedValue<number>; t0: number }) {
  const st = useAnimatedStyle(() => ({ opacity: n <= v ? pr(s.value, t0 + 0.15 + n * 0.05, 0.12) : 0 }));
  const h = 20 * (0.3 + 0.14 * n);
  return (
    <View style={{ width: 5, height: h, borderRadius: 2.5, backgroundColor: C.l2 }}>
      <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 2.5, backgroundColor: col }, st]} />
    </View>
  );
}

/** 2 · Foco: el anillo se cierra alrededor de NOVA, la cuenta baja y al final se marca listo */
const ACirculo = Animated.createAnimatedComponent(SvgCircle);
function EscenaFoco(e: Esc) {
  const s = useReloj(e, 9);
  const { t } = useIdioma(), { W, top, alto } = e.m, cx = W / 2, cy = top + alto * 0.5 - (e.m.compacta ? 24 : 12);
  const RING = e.m.compacta ? 88 : 112, PER = 2 * Math.PI * RING;
  const prog = useDerivedValue(() => eIO(pr(s.value, 0.6, 6.4)));
  const arco = useAnimatedProps(() => ({ strokeDashoffset: PER * (1 - prog.value), stroke: prog.value >= 1 ? C.ok : C.nova }));
  const gira = useAnimatedStyle(() => ({ transform: [{ rotate: `${s.value * 8}deg` }], opacity: pr(s.value, 0, 0.6) }));
  const anillo = useAnimatedStyle(() => ({ opacity: tramo(s.value, 0, 8.5, 0.5), transform: [{ scale: 0.9 + 0.1 * eOut(pr(s.value, 0, 0.7)) }] }));
  const listo = useAnimatedStyle(() => { const k = tramo(s.value, 7.0, 8.4, 0.35); return { opacity: k, transform: [{ scale: eBack(pr(s.value, 7.0, 0.45)) }] }; });
  const [resto, setResto] = useState(25 * 60);
  useAnimatedReaction(() => Math.round(25 * 60 * (1 - prog.value)), (v, p) => { if (v !== p) scheduleOnRN(setResto, v); });
  const mm = String(Math.floor(resto / 60)).padStart(2, '0'), ss = String(resto % 60).padStart(2, '0');
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} pointerEvents="none">
      <Animated.View style={[{ position: 'absolute', left: cx - RING - 22, top: cy - RING - 22, width: (RING + 22) * 2, height: (RING + 22) * 2 }, gira]}>
        <Svg width={(RING + 22) * 2} height={(RING + 22) * 2}>
          <SvgCircle cx={RING + 22} cy={RING + 22} r={RING + 16} stroke="rgba(143,230,245,0.22)" strokeWidth={1.5} strokeDasharray="2 9" fill="none" />
        </Svg>
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: cx - RING - 8, top: cy - RING - 8 }, anillo]}>
        <Svg width={(RING + 8) * 2} height={(RING + 8) * 2} style={{ transform: [{ rotate: '-90deg' }] }}>
          <SvgCircle cx={RING + 8} cy={RING + 8} r={RING} stroke="rgba(255,255,255,0.08)" strokeWidth={7} fill="none" />
          <ACirculo cx={RING + 8} cy={RING + 8} r={RING} strokeWidth={7} strokeLinecap="round" fill="none" strokeDasharray={`${PER} ${PER}`} animatedProps={arco} />
        </Svg>
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: cy + RING + (e.m.compacta ? 10 : 18), alignItems: 'center' }, anillo]}>
        <Txt f="l" size={e.m.compacta ? 28 : 34} ls={-1}>{mm}:{ss}</Txt>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          <View style={{ paddingHorizontal: 12, height: 28, borderRadius: 14, backgroundColor: C.sigSuave, borderWidth: 1, borderColor: 'rgba(143,230,245,0.3)', justifyContent: 'center' }}><Txt f="m" size={12.5} color={C.nova}>{t('Focus')} · 25 min</Txt></View>
          <View style={{ paddingHorizontal: 12, height: 28, borderRadius: 14, borderWidth: 1, borderColor: C.l2, justifyContent: 'center' }}><Txt f="m" size={12.5} color={C.t3}>{t('Learning')}</Txt></View>
        </View>
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: cx + RING * 0.62, top: cy - RING * 0.92, flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: C.ok }, listo]}>
        <Ionicons name="checkmark" size={16} color={C.tinta} />
        <Txt f="s" size={13} color={C.tinta}>{t('Done')}</Txt>
      </Animated.View>
    </View>
  );
}

/** 3 · Crew: la crew orbita a NOVA; llega el aviso del momento y las fotos salen de cada uno hacia las historias */
const FOTOS: { col: [string, string]; ic: keyof typeof Ionicons.glyphMap }[] = [
  { col: ['#1d6f8c', '#0a2a3a'], ic: 'sunny-outline' },
  { col: ['#5a4bb0', '#1a1440'], ic: 'cafe-outline' },
  { col: ['#b0782a', '#3a2408'], ic: 'barbell-outline' },
];
function EscenaCrew(e: Esc & { miembros: Usuario[] }) {
  const s = useReloj(e, 9.5);
  const { t } = useIdioma(), { W, top, alto } = e.m, cx = W / 2, cy = top + alto * 0.5 + 18;
  const gente: (Usuario | null)[] = [...e.miembros.slice(0, 5)];
  while (gente.length < 4) gente.push(null);
  const rx = Math.min(W * 0.36, 150), ry = alto * 0.17;
  const aviso = useAnimatedStyle(() => { const k = tramo(s.value, 1.1, 8.8, 0.45); return { opacity: k, transform: [{ translateY: (1 - eBack(pr(s.value, 1.1, 0.6))) * -70 }] }; });
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} pointerEvents="none">
      {gente.map((u, k) => <Tripulante key={u?.id ?? `p${k}`} k={k} n={gente.length} u={u} s={s} cx={cx} cy={cy} rx={rx} ry={ry} />)}
      {FOTOS.map((f, k) => <Foto key={k} k={k} f={f} s={s} cx={cx} cy={cy} rx={rx} ry={ry} n={gente.length} quien={gente[k % gente.length]} alto={alto} top={top} />)}
      <Animated.View style={[{ position: 'absolute', left: 20, right: 20, top: top + 4, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 22, backgroundColor: 'rgba(15,21,29,0.96)', borderWidth: 1, borderColor: C.l2 }, aviso]}>
        <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: C.tinta, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(143,230,245,0.3)' }}>
          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: C.nova, boxShadow: '0 0 12px rgba(143,230,245,0.9)' }} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Txt f="s" size={14} style={{ flex: 1 }}>{t('Crew moment')}</Txt>
            <Txt f="monoR" size={11.5} color={C.t3}>{t('now')}</Txt>
          </View>
          <Txt size={13} lh={17} color={C.t2} numberOfLines={2}>{t('You have 10 minutes to share what you are doing.')}</Txt>
        </View>
      </Animated.View>
    </View>
  );
}
const anguloTrip = (s: number, k: number, n: number) => { 'worklet'; return s * 0.28 + (k * Math.PI * 2) / n + 0.4; };
function Tripulante({ k, n, u, s, cx, cy, rx, ry }: { k: number; n: number; u: Usuario | null; s: SharedValue<number>; cx: number; cy: number; rx: number; ry: number }) {
  const st = useAnimatedStyle(() => {
    const a = anguloTrip(s.value, k, n), prof = (Math.sin(a) + 1) / 2, ent = eBack(pr(s.value, 0.1 + k * 0.08, 0.6));
    return { opacity: pr(s.value, 0.1 + k * 0.08, 0.3) * (0.55 + 0.45 * prof), transform: [{ translateX: cx + Math.cos(a) * rx * ent - 20 }, { translateY: cy + Math.sin(a) * ry * ent - 20 }, { scale: (0.78 + 0.3 * prof) * ent }] };
  });
  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, st]}>
      {u ? <AvatarMiembro u={u} size={40} anillo={C.aviso} /> : (
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.s2, borderWidth: 1.5, borderColor: 'rgba(242,180,87,0.5)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="person" size={17} color={C.t3} />
        </View>
      )}
    </Animated.View>
  );
}
function Foto({ k, f, s, cx, cy, rx, ry, n, quien, alto, top }: { k: number; f: (typeof FOTOS)[number]; s: SharedValue<number>; cx: number; cy: number; rx: number; ry: number; n: number; quien: Usuario | null; alto: number; top: number }) {
  const t0 = 2.3 + k * 0.75, Wf = 78, Hf = 100;
  const fin = [cx + (k - 1) * 70, top + alto - Hf / 2 - 10, (k - 1) * 9];
  const st = useAnimatedStyle(() => {
    const a = anguloTrip(t0, k, n), x0 = cx + Math.cos(a) * rx, y0 = cy + Math.sin(a) * ry;
    const u = eIO(pr(s.value, t0, 0.85)), sale = 1 - pr(s.value, 8.7, 0.4);
    return {
      opacity: pr(s.value, t0, 0.15) * sale,
      transform: [{ translateX: x0 + (fin[0] - x0) * u - Wf / 2 }, { translateY: y0 + (fin[1] - y0) * u - Math.sin(Math.PI * u) * 40 - Hf / 2 }, { rotate: `${fin[2] * u}deg` }, { scale: 0.3 + 0.7 * eBack(pr(s.value, t0, 0.85)) }],
    };
  });
  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: Wf, height: Hf, borderRadius: 14, padding: 4, backgroundColor: '#e9eef3', boxShadow: '0 12px 24px -8px rgba(0,0,0,0.6)' }, st]}>
      <View style={{ flex: 1, borderRadius: 10, backgroundColor: f.col[1], overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', left: -20, top: -30, width: 110, height: 90, borderRadius: 55, backgroundColor: f.col[0], opacity: 0.85 }} />
        <Ionicons name={f.ic} size={28} color="rgba(255,255,255,0.85)" />
      </View>
      <View style={{ position: 'absolute', right: -6, bottom: -6 }}>
        {quien ? <AvatarMiembro u={quien} size={24} /> : <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="person" size={12} color={C.t3} /></View>}
      </View>
    </Animated.View>
  );
}

/** 4 · Tareas y retos: se marcan tareas y la barra del reto de la crew avanza */
function EscenaJuntos(e: Esc & { miembros: Usuario[] }) {
  const s = useReloj(e, 8.5);
  const { t, locale } = useIdioma(), { top } = e.m;
  const yo = useSesion().usuario;
  const otro = e.miembros.find(u => u.id !== yo?.id) ?? null;
  const TAREAS: { tx: string; crew: boolean; hecha: boolean }[] = [
    { tx: t('Go for a 30 min run'), crew: false, hecha: true },
    { tx: t('Buy what we need for Saturday'), crew: true, hecha: true },
    { tx: t('Rehearse the presentation'), crew: true, hecha: false },
  ];
  const a = useAnimatedStyle(() => ({ opacity: tramo(s.value, 0.1, 8.0, 0.5), transform: [{ translateY: (1 - eOut(pr(s.value, 0.1, 0.6))) * 24 }] }));
  const b = useAnimatedStyle(() => ({ opacity: tramo(s.value, 0.5, 8.0, 0.5), transform: [{ translateY: (1 - eOut(pr(s.value, 0.5, 0.6))) * 24 }] }));
  const avance = useDerivedValue(() => eIO(pr(s.value, 2.6, 2.4)) * 0.72);
  const barra = useAnimatedStyle(() => ({ width: `${avance.value * 100}%` }));
  const [pasos, setPasos] = useState(0);
  useAnimatedReaction(() => Math.round((avance.value * 50000) / 100) * 100, (v, p) => { if (v !== p) scheduleOnRN(setPasos, v); });
  return (
    <View style={{ position: 'absolute', left: 24, right: 24, top: top + (e.m.compacta ? 50 : 72) }} pointerEvents="none">
      <Animated.View style={[{ borderRadius: 24, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, paddingHorizontal: 16, paddingVertical: 6 }, a]}>
        {TAREAS.map((ta, k) => <FilaTarea key={k} k={k} s={s} {...ta} quien={ta.crew ? otro : null} alto={e.m.compacta ? 42 : 48} />)}
      </Animated.View>
      <Animated.View style={[{ marginTop: e.m.compacta ? 10 : 12, borderRadius: 24, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, padding: e.m.compacta ? 14 : 16 }, b]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="trophy-outline" size={16} color={C.aviso} />
          <Txt f="s" size={14.5} style={{ flex: 1 }}>{t('Crew challenge · 50,000 steps')}</Txt>
        </View>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: C.l2, marginTop: 12, overflow: 'hidden' }}>
          <Animated.View style={[{ height: 6, borderRadius: 3, backgroundColor: C.ok }, barra]} />
        </View>
        <View style={{ flexDirection: 'row', marginTop: 8 }}>
          <Txt f="monoR" size={12} color={C.t2} style={{ flex: 1 }}>{pasos.toLocaleString(locale)} / {(50000).toLocaleString(locale)}</Txt>
          <Txt f="monoR" size={12} color={C.ok}>{Math.round((pasos / 50000) * 100)}%</Txt>
        </View>
      </Animated.View>
    </View>
  );
}
function FilaTarea({ k, s, tx, crew, hecha, quien, alto }: { k: number; s: SharedValue<number>; tx: string; crew: boolean; hecha: boolean; quien: Usuario | null; alto: number }) {
  const t0 = 1.0 + k * 0.8;
  const marca = useAnimatedStyle(() => { const u = hecha ? pr(s.value, t0, 0.3) : 0; return { opacity: u, transform: [{ scale: eBack(u) }] }; });
  const texto = useAnimatedStyle(() => ({ opacity: hecha ? 1 - 0.5 * pr(s.value, t0 + 0.1, 0.3) : 1 }));
  const raya = useAnimatedStyle(() => ({ width: `${(hecha ? eOut(pr(s.value, t0 + 0.1, 0.35)) : 0) * 100}%` }));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: alto, borderTopWidth: k ? 1 : 0, borderTopColor: C.l1 }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[{ position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: C.ok, alignItems: 'center', justifyContent: 'center' }, marca]}>
          <Ionicons name="checkmark" size={15} color={C.tinta} />
        </Animated.View>
      </View>
      <Animated.View style={[{ flex: 1, alignItems: 'flex-start', justifyContent: 'center' }, texto]}>
        <View style={{ maxWidth: '100%', justifyContent: 'center' }}>
          <Txt size={14.5} numberOfLines={1}>{tx}</Txt>
          <Animated.View style={[{ position: 'absolute', left: 0, height: 1.5, backgroundColor: C.t2, top: '52%' }, raya]} />
        </View>
      </Animated.View>
      {crew ? (quien ? <AvatarMiembro u={quien} size={24} /> : <Ionicons name="people-outline" size={16} color={C.t3} />) : <Ionicons name="lock-closed-outline" size={15} color={C.t3} />}
    </View>
  );
}

/** 5 · Listo: NOVA celebra (chispas) y una barra en miniatura muestra cómo se navega deslizando */
const CHISPAS = Array.from({ length: 16 }, (_, i) => [(i / 16) * Math.PI * 2 + (i % 2) * 0.2, 0.7 + (i % 3) * 0.2]);
const TABS: { ic: keyof typeof Ionicons.glyphMap; t: string }[] = [{ ic: 'pulse', t: 'Today' }, { ic: 'people', t: 'Crew' }, { ic: 'heart', t: 'Body' }, { ic: 'happy', t: 'Mind' }];
function EscenaListo(e: Esc) {
  const s = useReloj(e, 1e9);
  const { t } = useIdioma(), { W, top, alto } = e.m, cx = W / 2, cy = top + alto * 0.36;
  const anchoBarra = Math.min(W - 64, 320), celda = (anchoBarra - 12) / 4;
  const barra = useAnimatedStyle(() => ({ opacity: pr(s.value, 0.5, 0.5), transform: [{ translateY: (1 - eOut(pr(s.value, 0.5, 0.6))) * 20 }] }));
  const pildora = useAnimatedStyle(() => {
    const c = Math.max(0, s.value - 1.4) / 1.5, a = Math.floor(c) % 4, f = eIO(Math.min(1, (c % 1) / 0.35));
    return { transform: [{ translateX: (a + (a === 3 ? -3 * f : f)) * celda }] };
  });
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} pointerEvents="none">
      {CHISPAS.map(([a, d], k) => <Chispa key={k} a={a} d={d} k={k} s={s} cx={cx} cy={cy} />)}
      <Animated.View style={[{ position: 'absolute', left: (W - anchoBarra) / 2, width: anchoBarra, top: top + alto - 70, height: 58, borderRadius: 29, backgroundColor: C.barra, borderWidth: 1, borderColor: C.l2, padding: 6, flexDirection: 'row' }, barra]}>
        <Animated.View style={[{ position: 'absolute', left: 6, top: 6, width: celda, height: 44, borderRadius: 22, backgroundColor: 'rgba(143,230,245,0.12)' }, pildora]} />
        {TABS.map(b => (
          <View key={b.t} style={{ width: celda, height: 44, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <Ionicons name={b.ic} size={18} color={C.t1} />
            <Txt f="m" size={10.5} color={C.t2}>{t(b.t)}</Txt>
          </View>
        ))}
      </Animated.View>
    </View>
  );
}
function Chispa({ a, d, k, s, cx, cy }: { a: number; d: number; k: number; s: SharedValue<number>; cx: number; cy: number }) {
  const st = useAnimatedStyle(() => {
    const u = ((s.value - 0.2 + (k % 4) * 0.12) % 4.5) / 1.3;
    const v = Math.min(1, Math.max(0, u)), r = 70 + eOut(v) * 110 * d;
    return { opacity: v > 0 && v < 1 ? Math.sin(Math.PI * v) : 0, transform: [{ translateX: cx + Math.cos(a) * r - 3 }, { translateY: cy + Math.sin(a) * r * 0.8 - 3 }, { scale: 1 - v * 0.5 }] };
  });
  return <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 6, height: 6, borderRadius: 3, backgroundColor: k % 3 ? C.nova : C.aviso, boxShadow: '0 0 8px rgba(143,230,245,0.9)' }, st]} />;
}
