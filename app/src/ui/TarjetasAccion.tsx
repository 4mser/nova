/* Lo que NOVA acaba de hacer, mostrado ahí mismo en el chat como la cosa real (no solo una línea de texto):
   la alarma con su interruptor que se enciende, la tarea que se tacha, el anillo del hábito que se llena, los ítems de la
   lista que entran uno a uno, los avisos que se apagan… Tocar la tarjeta lleva a donde quedó. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { Easing, FadeIn, interpolateColor, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { useIdioma } from '../i18n';
import type { Visual } from '../voz/acciones';
import { Calendario, TarjetaGithub, TarjetaPersona } from './TarjetasGithub';
import { C, Txt } from './tema';

type Accion = { icono: string; texto: string; ir?: string; donde?: string };
const ACirculo = Animated.createAnimatedComponent(Circle);
type Ico = keyof typeof Ionicons.glyphMap;

const SUAVE = Easing.out(Easing.cubic);
export function TarjetaAccion({ v, a }: { v: Visual; a?: Accion }) {
  const { t } = useIdioma();
  const ir = a?.ir;
  // entra con un fundido corto y sin rebote; sin animación de layout, para que los hijos animen tranquilos
  const op = useSharedValue(0);
  useEffect(() => { op.set(withTiming(1, { duration: 220, easing: SUAVE })); }, [op]);
  const st = useAnimatedStyle(() => ({ opacity: op.value, transform: [{ translateY: (1 - op.value) * 6 }] }));
  return (
    <Animated.View style={[{ alignSelf: 'flex-start', width: '86%', maxWidth: 340 }, st]}>
      <Pressable disabled={!ir} onPress={() => ir && router.push(ir as never)} accessibilityRole={ir ? 'link' : undefined}
        style={({ pressed }) => ({ borderRadius: 22, backgroundColor: C.s2, borderWidth: 1, borderColor: C.l1, padding: 14, opacity: pressed ? 0.8 : 1, overflow: 'hidden' })}>
        <Cuerpo v={v} />
        {ir || a?.donde ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.l1 }}>
            <Txt size={12} color={C.t3} style={{ flexShrink: 1 }}>{a?.donde ?? ''}</Txt>
            {ir ? <View style={{ flexDirection: 'row', alignItems: 'center' }}><Txt f="s" size={12.5} color={C.nova}>{t('See')}</Txt><Ionicons name="chevron-forward" size={13} color={C.nova} /></View> : null}
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

function Cuerpo({ v }: { v: Visual }) {
  switch (v.tipo) {
    case 'mensaje': return null; // va en su propia tarjeta (TarjetaMensaje)
    case 'github': return <TarjetaGithub v={v} />;
    case 'calendario': return <Calendario v={v} />;
    case 'persona': return <TarjetaPersona v={v} />;
    case 'alarma': return <Alarma hora={v.hora} etiqueta={v.etiqueta} />;
    case 'temporizador': return <Temporizador segundos={v.segundos} etiqueta={v.etiqueta} />;
    case 'recordatorio': return <Recordatorio hora={v.hora} dia={v.dia} texto={v.texto} />;
    case 'tarea': return <Tarea v={v} />;
    case 'habito': return <Habito v={v} />;
    case 'lista': return <Lista lista={v.lista} items={v.items} />;
    case 'avisos': return <Avisos cambios={v.cambios} />;
    case 'bloque': return <Bloque v={v} />;
    case 'foco': return <Foco min={v.min} que={v.que} />;
    case 'nota': return <Nota icono={v.icono} titulo={v.titulo} texto={v.texto} />;
  }
}

/* cabecera chica: ícono en su ficha + etiqueta en mayúsculas */
function Cab({ icono, color, texto }: { icono: Ico; color: string; texto: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: `${color}22`, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icono} size={15} color={color} /></View>
      <Txt f="m" size={11.5} color={color} ls={1.2} style={{ textTransform: 'uppercase' }}>{texto}</Txt>
    </View>
  );
}

/* un interruptor que se mueve solo (va de «antes» a «después») */
function Interruptor({ a, b, retraso = 260, color = C.ok }: { a: boolean; b: boolean; retraso?: number; color?: string }) {
  const p = useSharedValue(a ? 1 : 0);
  useEffect(() => {
    p.value = withDelay(retraso, withTiming(b ? 1 : 0, { duration: 260, easing: Easing.out(Easing.cubic) }));
    const id = setTimeout(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); }, retraso);
    return () => clearTimeout(id);
  }, [a, b, retraso, p]);
  const pista = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(p.value, [0, 1], [C.l2, color]) }));
  const pomo = useAnimatedStyle(() => ({ transform: [{ translateX: 3 + p.value * 18 }] }));
  return (
    <Animated.View style={[{ width: 46, height: 28, borderRadius: 14, justifyContent: 'center' }, pista]}>
      <Animated.View style={[{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' }, pomo]} />
    </Animated.View>
  );
}

/* anillo de avance animado (de «desde» a «hasta», 0–1) */
function Anillo({ desde, hasta, tam = 64, grosor = 7, color, children }: { desde: number; hasta: number; tam?: number; grosor?: number; color: string; children?: React.ReactNode }) {
  const r = (tam - grosor) / 2, L = 2 * Math.PI * r, p = useSharedValue(desde);
  useEffect(() => { p.value = withDelay(220, withTiming(hasta, { duration: 650, easing: Easing.out(Easing.cubic) })); }, [hasta, p]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: L * (1 - Math.max(0, Math.min(1, p.value))) }));
  return (
    <View style={{ width: tam, height: tam, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={tam} height={tam} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={tam / 2} cy={tam / 2} r={r} stroke={C.l2} strokeWidth={grosor} fill="none" />
        <ACirculo cx={tam / 2} cy={tam / 2} r={r} stroke={color} strokeWidth={grosor} fill="none" strokeLinecap="round" strokeDasharray={`${L} ${L}`} animatedProps={props} />
      </Svg>
      {children}
    </View>
  );
}

function Alarma({ hora, etiqueta }: { hora: string; etiqueta?: string }) {
  const { t } = useIdioma();
  return (
    <>
      <Cab icono="alarm" color={C.aviso} texto={t('Alarm set')} />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Txt f="l" size={40} ls={-1.5}>{hora}</Txt>
          <Txt size={13} color={C.t2}>{etiqueta || t('In the phone Clock app')}</Txt>
        </View>
        <Interruptor a={false} b />
      </View>
    </>
  );
}

function Temporizador({ segundos, etiqueta }: { segundos: number; etiqueta?: string }) {
  const { t } = useIdioma();
  const [quedan, setQuedan] = useState(segundos);
  useEffect(() => { const id = setInterval(() => setQuedan(q => Math.max(0, q - 1)), 1000); return () => clearInterval(id); }, []);
  const mm = `${Math.floor(quedan / 60)}:${String(quedan % 60).padStart(2, '0')}`;
  return (
    <>
      <Cab icono="timer-outline" color={C.sig} texto={t('Timer')} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Anillo desde={1} hasta={quedan / segundos} color={C.sig}><Ionicons name="hourglass-outline" size={20} color={C.nova} /></Anillo>
        <View><Txt f="l" size={34} ls={-1.2} style={{ fontVariant: ['tabular-nums'] }}>{mm}</Txt>{etiqueta ? <Txt size={13} color={C.t2}>{etiqueta}</Txt> : null}</View>
      </View>
    </>
  );
}

function Recordatorio({ hora, dia, texto }: { hora: string; dia?: string; texto: string }) {
  const { t } = useIdioma();
  const g = useSharedValue(0);
  useEffect(() => { g.value = withDelay(240, withSequence(...[14, -11, 6, 0].map(x => withTiming(x, { duration: 80 })))); }, [g]);
  const campana = useAnimatedStyle(() => ({ transform: [{ rotate: `${g.value}deg` }] }));
  return (
    <>
      <Cab icono="notifications-outline" color={C.lila} texto={t('Reminder')} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Animated.View style={[{ width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(168,152,255,0.14)', alignItems: 'center', justifyContent: 'center', transformOrigin: '50% 15%' }, campana]}>
          <Ionicons name="notifications" size={22} color={C.lila} />
        </Animated.View>
        <View style={{ flex: 1 }}>
          <Txt f="s" size={16} numberOfLines={2}>{texto}</Txt>
          <Txt size={13} color={C.t2}>{`${dia ? `${dia} · ` : `${t('Today')} · `}${hora}`}</Txt>
        </View>
      </View>
    </>
  );
}

function Tarea({ v }: { v: Extract<Visual, { tipo: 'tarea' }> }) {
  const { t } = useIdioma();
  const k = useSharedValue(0);
  useEffect(() => { if (v.hecha){ k.value = withDelay(260, withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) })); setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), 300); } }, [v.hecha, k]);
  const caja = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(k.value, [0, 1], ['rgba(0,0,0,0)', C.ok]), borderColor: interpolateColor(k.value, [0, 1], [C.t3, C.ok]), transform: [{ scale: 1 + 0.18 * Math.sin(Math.PI * k.value) }] }));
  const visto = useAnimatedStyle(() => ({ opacity: k.value }));
  const raya = useAnimatedStyle(() => ({ width: `${k.value * 100}%` }));
  return (
    <>
      <Cab icono={v.crew ? 'people-outline' : 'checkbox-outline'} color={C.ok} texto={v.hecha ? t('Task done') : v.movida ? t('Task moved') : v.crew ? t('Crew task') : v.en ? t('Added to {x}', { x: v.en }) : t('New task')} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Animated.View style={[{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' }, caja]}>
          <Animated.View style={visto}><Ionicons name="checkmark" size={16} color={C.tinta} /></Animated.View>
        </Animated.View>
        <View style={{ flex: 1 }}>
          <View style={{ alignSelf: 'flex-start' }}><Txt f="s" size={16} numberOfLines={2} color={v.hecha ? C.t2 : C.t1}>{v.titulo}</Txt>
            <Animated.View style={[{ position: 'absolute', left: 0, top: '50%', height: 2, backgroundColor: C.t2 }, raya]} /></View>
          {v.vence || v.para?.length ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
              {v.vence ? <Txt size={12.5} color={C.aviso}>{v.vence}</Txt> : null}
              {v.para?.map((p, i) => (
                <Animated.View key={p} entering={FadeIn.duration(180).delay(120 + i * 45)} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: [C.nova, C.lila, C.ok, C.aviso][i % 4], alignItems: 'center', justifyContent: 'center', marginLeft: i ? -6 : 0, borderWidth: 2, borderColor: C.s2 }}>
                  <Txt f="s" size={11} color={C.tinta}>{p[0]}</Txt>
                </Animated.View>
              ))}
              {v.para?.length ? <Txt size={12.5} color={C.t2}>{v.para.join(', ')}</Txt> : null}
            </View>
          ) : null}
        </View>
      </View>
    </>
  );
}

function Habito({ v }: { v: Extract<Visual, { tipo: 'habito' }> }) {
  const { t } = useIdioma();
  const meta = Math.max(1, v.meta), desde = v.nuevo ? 0 : Math.max(0, v.v - (v.suma ?? 1)) / meta;
  return (
    <>
      <Cab icono="repeat" color={v.color || C.sig} texto={v.nuevo ? t('New habit') : v.v >= meta ? t('Habit done') : t('Habit')} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Anillo desde={desde} hasta={v.v / meta} color={v.color || C.sig}><Ionicons name={(v.icono || 'star-outline') as Ico} size={22} color={v.color || C.nova} /></Anillo>
        <View style={{ flex: 1 }}>
          <Txt f="s" size={17}>{v.nombre}</Txt>
          <Txt size={13} color={C.t2}>{meta > 1 ? t('{v} of {m} {u}', { v: v.v, m: meta, u: v.unidad ?? '' }) : v.v >= 1 ? t('Done today') : t('Every day')}</Txt>
          {v.recordar?.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {v.recordar.slice(0, 5).map((h, i) => <Animated.View key={h} entering={FadeIn.duration(180).delay(140 + i * 40)} style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10, backgroundColor: 'rgba(168,152,255,0.14)' }}><Txt f="s" size={11.5} color={C.lila}>{h}</Txt></Animated.View>)}
            </View>
          ) : null}
        </View>
      </View>
    </>
  );
}

function Lista({ lista, items }: { lista: string; items: string[] }) {
  return (
    <>
      <Cab icono="list-outline" color={C.aviso} texto={lista} />
      <View style={{ gap: 8 }}>
        {items.map((x, i) => (
          <Animated.View key={`${x}${i}`} entering={FadeIn.duration(200).delay(90 + i * 55)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 18, height: 18, borderRadius: 6, borderWidth: 2, borderColor: C.aviso }} />
            <Txt size={15}>{x}</Txt>
            <Animated.View entering={FadeIn.duration(160).delay(190 + i * 55)}><Txt f="s" size={12} color={C.ok}>+</Txt></Animated.View>
          </Animated.View>
        ))}
      </View>
    </>
  );
}

function Avisos({ cambios }: { cambios: { nombre: string; on: boolean }[] }) {
  const { t } = useIdioma();
  const todosOn = cambios.every(c => c.on);
  return (
    <>
      <Cab icono={todosOn ? 'notifications-outline' : 'notifications-off-outline'} color={C.nova} texto={t('Notifications')} />
      <View style={{ gap: 10 }}>
        {cambios.map((c, i) => (
          <View key={c.nombre} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <Txt size={15} style={{ flexShrink: 1 }}>{c.nombre}</Txt>
            <Interruptor a={!c.on} b={c.on} retraso={350 + i * 220} color={C.sig} />
          </View>
        ))}
      </View>
    </>
  );
}

function Bloque({ v }: { v: Extract<Visual, { tipo: 'bloque' }> }) {
  const { t } = useIdioma();
  const fin = (() => { const [h, m] = v.desde.split(':').map(Number); const x = (h * 60 + m + v.minutos) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; })();
  return (
    <>
      <Cab icono="calendar" color={C.sig} texto={v.rutina ? t('Routine') : t('In your calendar')} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ width: 44, gap: 18, paddingTop: 2 }}><Txt size={11.5} color={C.t3}>{v.desde}</Txt><Txt size={11.5} color={C.t3}>{fin}</Txt></View>
        <Animated.View entering={FadeIn.duration(220).delay(120)} style={{ flex: 1, borderRadius: 12, backgroundColor: 'rgba(70,200,232,0.16)', borderLeftWidth: 3, borderLeftColor: C.sig, padding: 10 }}>
          <Txt f="s" size={15}>{v.titulo}</Txt>
          <Txt size={12.5} color={C.t2}>{`${v.desde}–${fin}${v.donde ? ` · ${v.donde}` : ''}`}</Txt>
        </Animated.View>
      </View>
    </>
  );
}

function Foco({ min, que }: { min: number; que?: string }) {
  const { t } = useIdioma();
  return (
    <>
      <Cab icono="timer" color={C.sig} texto={t('Focus')} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Anillo desde={0} hasta={1} tam={70} color={C.sig}><Txt f="s" size={18}>{min}</Txt></Anillo>
        <View style={{ flex: 1 }}><Txt f="s" size={16}>{que || t('Focus session')}</Txt><Txt size={13} color={C.t2}>{t('{n} minutes · I keep the time', { n: min })}</Txt></View>
      </View>
    </>
  );
}

function Nota({ icono, titulo, texto }: { icono: string; titulo: string; texto?: string }) {
  return (
    <>
      <Cab icono={icono as Ico} color={C.lila} texto={titulo} />
      {texto ? <Animated.View entering={FadeIn.delay(200)} style={{ borderLeftWidth: 2, borderLeftColor: 'rgba(168,152,255,0.5)', paddingLeft: 10 }}><Txt size={14.5} lh={20} color={C.t1} numberOfLines={4}>{texto}</Txt></Animated.View> : null}
    </>
  );
}

