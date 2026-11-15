/* Hábitos en Hoy: un anillo por hábito que se llena con lo que llevas del día (8 vasos, 20 páginas, 30 min…).
   Un toque suma un paso (o marca los de sí/no), con vibración; al completar, el anillo se cierra y la racha sube.
   Mantener apretado abre su ficha (historial, recordatorios, meta). Sin hábitos, una invitación a elegirlos. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { useEffect } from 'react';
import { fechaDe } from '../engine/diario';
import { cronometro, cuentaDe, diasSin, hecho, marcar, metaDe, racha, tipoDe, tocaEl, useHabitos, type Habito } from '../engine/habitos';
import { useIdioma } from '../i18n';
import { useAhora } from './ahora';
import { C, Cel, Seccion, Toque, Txt } from './tema';

const CirculoAnimado = Animated.createAnimatedComponent(Circle);

/** anillo de progreso (0–1) con el contenido al centro */
export function Anillo({ v, color, size = 64, grosor = 6, children }: { v: number; color: string; size?: number; grosor?: number; children?: React.ReactNode }) {
  const r = (size - grosor) / 2, L = 2 * Math.PI * r;
  const p = useSharedValue(0);
  useEffect(() => { p.set(withTiming(Math.min(1, v), { duration: 450 })); }, [v, p]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: L * (1 - p.value) }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={grosor} fill="none" />
        <CirculoAnimado cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={grosor} fill="none" strokeLinecap="round" strokeDasharray={`${L} ${L}`} animatedProps={props} />
      </Svg>
      {children}
    </View>
  );
}

export function TarjetaHabitos() {
  const { t } = useIdioma(), { habitos, marcas } = useHabitos();
  const ahora = useAhora(), hoy = fechaDe(ahora);
  const deHoy = habitos.filter(h => tocaEl(h, ahora)), hechos = deHoy.filter(h => hecho(marcas, h.id, hoy)).length;
  if (!habitos.length) {
    return (
      <>
        <Seccion t={t('Habits')} />
        <Toque onPress={() => router.push('/habitos')} label={t('Choose your habits')}>
          <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(111,214,176,0.12)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="repeat" size={20} color={C.ok} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt f="s" size={15}>{t('Choose your habits')}</Txt>
              <Txt size={13} lh={18} color={C.t2} style={{ marginTop: 2 }}>{t('Water, reading, moving… with a daily goal, reminders and your streak.')}</Txt>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.t3} />
          </Cel>
        </Toque>
      </>
    );
  }
  // filas de 3 anillos (las que no se completan quedan con huecos invisibles: nada se estira)
  const filas: (Habito | null)[][] = [];
  for (let i = 0; i < deHoy.length; i += 3) filas.push([...deHoy.slice(i, i + 3), ...Array(Math.max(0, 3 - deHoy.slice(i, i + 3).length)).fill(null)]);
  return (
    <>
      <Seccion t={t('Habits')} nota={
        <Pressable onPress={() => router.push('/habitos')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Edit habits')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt size={13} color={C.t3}>{t('{n} of {total} today', { n: hechos, total: deHoy.length })}</Txt>
          <Ionicons name="options-outline" size={15} color={C.nova} />
        </Pressable>
      } />
      <Cel style={{ paddingVertical: 14, paddingHorizontal: 8, gap: 14 }}>
        {filas.map((f, i) => (
          <View key={i} style={{ flexDirection: 'row' }}>
            {f.map((h, j) => <View key={h?.id ?? `v${j}`} style={{ flex: 1, alignItems: 'center' }}>{h ? <AnilloHabito h={h} hoy={hoy} n={racha(marcas, h.id, ahora)} /> : null}</View>)}
          </View>
        ))}
        {!deHoy.length ? <Txt size={13.5} color={C.t3} style={{ textAlign: 'center' }}>{t('No habits for today. Enjoy the day off.')}</Txt> : null}
      </Cel>
    </>
  );
}

function AnilloHabito({ h, hoy, n }: { h: Habito; hoy: string; n: number }) {
  const { t } = useIdioma(), { marcas, cuentas } = useHabitos();
  const tipo = tipoDe(h), corre = !!h.corriendo, ahora = useAhora(corre ? 1000 : 60e3);
  const v = cuentaDe(h, hoy, marcas, cuentas), meta = metaDe(h), ok = tipo === 'evitar' ? v === 0 : v >= meta;
  const sin = tipo === 'evitar' ? diasSin(h, ahora) : 0;
  const esc = useSharedValue(1);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: esc.value }] }));
  const ficha = () => router.push({ pathname: '/habito', params: { id: h.id } });
  const tocar = () => {
    // evitar: nada de toques accidentales (la recaída se registra en su ficha); tiempo: el toque prende o para el cronómetro
    if (tipo === 'evitar') { ficha(); return; }
    if (tipo === 'tiempo') { esc.set(withSequence(withTiming(0.88, { duration: 90 }), withSpring(1, { damping: 7, stiffness: 260 }))); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); cronometro(h.id); return; }
    const listo = marcar(h.id);
    esc.set(withSequence(withTiming(0.88, { duration: 90 }), withSpring(1, { damping: 7, stiffness: 260 })));
    if (listo && !ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); else Haptics.selectionAsync().catch(() => {});
  };
  return (
    <Pressable onPress={tocar} onLongPress={ficha} delayLongPress={350}
      accessibilityRole="button" accessibilityLabel={`${t(h.nombre)}: ${v} / ${meta}`} accessibilityHint={t('Tap to add, hold for details')} style={{ alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
      <Animated.View style={st}>
        <Anillo v={tipo === 'evitar' ? (ok ? 1 : 0) : v / meta} color={corre ? C.nova : h.color} size={66}>
          {tipo === 'evitar' ? <Txt f="s" size={19} color={ok ? h.color : C.alerta}>{sin}</Txt>
            : corre ? <Ionicons name="pause" size={21} color={C.nova} />
            : ok ? <Ionicons name="checkmark" size={24} color={h.color} /> : <Ionicons name={(tipo === 'tiempo' ? 'play' : h.icono) as keyof typeof Ionicons.glyphMap} size={21} color={v || tipo === 'tiempo' ? h.color : C.t2} />}
        </Anillo>
      </Animated.View>
      <Txt f="m" size={12.5} numberOfLines={1} style={{ textAlign: 'center' }}>{t(h.nombre)}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -3 }}>
        {tipo === 'evitar' ? <Txt f="monoR" size={11.5} color={C.t3}>{t('days without')}</Txt>
          : corre ? <Txt f="monoR" size={11.5} color={C.nova}>{Math.floor((ahora - h.corriendo!) / 60e3)}:{String(Math.floor(((ahora - h.corriendo!) / 1e3) % 60)).padStart(2, '0')}</Txt>
          : meta > 1 ? <Txt f="monoR" size={11.5} color={ok ? h.color : C.t3}>{v}/{meta}</Txt> : null}
        {n > 0 && tipo !== 'evitar' && !corre ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}><Ionicons name="flame" size={11} color={n >= 3 ? C.aviso : C.t3} /><Txt f="monoR" size={11.5} color={n >= 3 ? C.aviso : C.t3}>{n}</Txt></View> : null}
      </View>
    </Pressable>
  );
}
