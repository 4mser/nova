/* Tu semana con NOVA: cuatro números contra la semana anterior, lo que NOVA notó en tus datos, hábitos y una sola
   sugerencia para la próxima. Llega como aviso los domingos a las 19:30; también se abre desde Hoy y Mente. */
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTareas } from '../cuenta/datos';
import { useSesion } from '../cuenta/sesion';
import { EMOCIONES, ESCALAS, nivelDe, useDiario } from '../engine/diario';
import { useFoco } from '../engine/foco';
import { useHabitos } from '../engine/habitos';
import { calcularSemana } from '../engine/semana';
import { useIdioma } from '../i18n';
import { NovaOrb } from '../nova/NovaOrb';
import { useHistoria } from '../sensores/historia';
import { useAhora } from '../ui/ahora';
import { volver } from '../ui/volver';
import { C, Cel, MsgNova, Seccion, Txt } from '../ui/tema';

const META_PASOS = 8000;
const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}` : `${Math.round(m)} min`);

export default function Resumen() {
  const ins = useSafeAreaInsets(), tr = useIdioma(), { t, locale } = tr, { width } = useWindowDimensions();
  const { dias } = useHistoria(), { registros } = useDiario(), { sesiones } = useFoco(), { habitos, marcas } = useHabitos();
  const { datos: tareas } = useTareas(), { usuario } = useSesion();
  const ahora = useAhora();
  const s = calcularSemana(tr, { ahora, historia: dias, registros, sesiones, habitos, marcas, metaPasos: META_PASOS, tareasHechas: (tareas ?? []).filter(x => x.hecha && x.hechaPor === usuario?.id && x.hechaTs).map(x => x.hechaTs!) });
  const W = Math.min(width, 520) - 40, celda = (W - 8) / 2;
  const fmt = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const poco = !s.sueno && !s.pasos && !s.animo && !s.foco.sesiones && !s.tareas;
  const palabra = (v: number) => nivelDe(tr, ESCALAS[0], Math.max(1, Math.min(5, Math.round(v))));
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: ins.bottom + 30 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Txt f="mono" size={12} ls={1.2} color={C.nova} style={{ textTransform: 'uppercase' }}>{fmt(s.desde)} – {fmt(s.hasta)}</Txt>
            <Txt f="s" size={30} ls={-1.2} lh={34} style={{ marginTop: 6 }}>{t('Your week')}</Txt>
          </View>
          <NovaOrb size={110} orbes={2} expr={poco ? 'pensativa' : 'feliz'} />
        </View>

        {poco ? (
          <MsgNova>{t('This week I have almost no data about you. Do the check-in and connect Health Connect, and next Sunday I will have a real summary.')}</MsgNova>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
              <Dato w={celda} i={0} k={t('Sleep')} v={s.sueno ? hm(s.sueno.prom * 60) : '—'} sub={t('per night')} delta={s.sueno?.antes != null ? (s.sueno.prom - s.sueno.antes) * 60 : undefined} fmt={d => hm(Math.abs(d))} umbral={5} />
              <Dato w={celda} i={1} k={t('Steps')} v={s.pasos ? Math.round(s.pasos.prom).toLocaleString(locale) : '—'} sub={t('per day')} delta={s.pasos?.antes != null ? s.pasos.prom - s.pasos.antes : undefined} fmt={d => Math.round(Math.abs(d)).toLocaleString(locale)} umbral={50} />
              <Dato w={celda} i={2} k={t('Focus')} v={hm(s.foco.min)} sub={s.foco.aprender ? t('+ {m} learning', { m: hm(s.foco.aprender) }) : t('{n} sessions', { n: s.foco.sesiones })} delta={s.foco.min - s.foco.antes} fmt={d => hm(Math.abs(d))} umbral={1} />
              <Dato w={celda} i={3} k={t('Mood')} v={s.animo ? palabra(s.animo.prom) : '—'} sub={s.animo ? tr.tp(s.animo.dias, '{n} check-in', '{n} check-ins') : t('no check-ins')} delta={s.animo?.antes != null ? s.animo.prom - s.animo.antes : undefined} fmt={() => ''} chico umbral={0.15} />
            </View>

            {s.notas.length ? (
              <>
                <Seccion t={t('What I noticed')} />
                <View style={{ gap: 8 }}>{s.notas.map((n, i) => <Animated.View key={i} entering={FadeInDown.delay(300 + i * 120).duration(420)}><MsgNova>{n}</MsgNova></Animated.View>)}</View>
              </>
            ) : null}

            {s.animo?.emociones.length ? (
              <>
                <Seccion t={t('How you felt')} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {s.animo.emociones.filter(e => (EMOCIONES as readonly string[]).includes(e)).map(e => (
                    <View key={e} style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, justifyContent: 'center' }}><Txt size={14}>{t(e)}</Txt></View>
                  ))}
                </View>
              </>
            ) : null}

            {s.habitos.length ? (
              <>
                <Seccion t={t('Habits')} nota={t('days out of 7')} />
                <Cel style={{ gap: 12 }}>
                  {s.habitos.map(h => (
                    <View key={h.nombre} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Txt size={14.5} style={{ flex: 1 }} numberOfLines={1}>{t(h.nombre)}</Txt>
                      <View style={{ flexDirection: 'row', gap: 3 }}>{Array.from({ length: 7 }, (_, i) => <View key={i} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i < h.dias ? C.ok : 'rgba(255,255,255,0.08)' }} />)}</View>
                      <Txt f="mono" size={13} color={C.t2} style={{ width: 26, textAlign: 'right' }}>{h.dias}</Txt>
                    </View>
                  ))}
                </Cel>
              </>
            ) : null}

            {s.tareas ? <Txt size={14.5} color={C.t2} style={{ marginTop: 18, paddingHorizontal: 2 }}>{tr.tp(s.tareas, 'You finished {n} task this week.', 'You finished {n} tasks this week.')}</Txt> : null}
          </>
        )}

        {s.proxima ? (
          <>
            <Seccion t={t('For next week')} />
            <Cel style={{ borderColor: 'rgba(143,230,245,0.25)', flexDirection: 'row', gap: 12 }}>
              <Ionicons name="compass-outline" size={20} color={C.nova} style={{ marginTop: 1 }} />
              <Txt size={15.5} lh={22} style={{ flex: 1 }}>{s.proxima}</Txt>
            </Cel>
          </>
        ) : null}
        <Txt size={11.5} lh={16} color={C.t3} style={{ textAlign: 'center', marginTop: 22 }}>{t('Only from your own data, compared with yourself. Not a medical assessment.')}</Txt>
      </ScrollView>
    </View>
  );
}

function Dato({ w, i, k, v, sub, delta, fmt, chico, umbral = 0.01 }: { w: number; i: number; k: string; v: string; sub: string; delta?: number; fmt: (d: number) => string; chico?: boolean; umbral?: number }) {
  // un cambio menor que el umbral (5 min de sueño, 50 pasos, 1 min de foco) no se muestra como subida ni bajada
  const sube = delta != null && delta >= umbral, baja = delta != null && delta <= -umbral, { t } = useIdioma();
  return (
    <Animated.View entering={FadeInDown.delay(80 + i * 70).duration(420)} style={{ width: w }}>
      <Cel>
        <Txt f="m" size={13} color={C.t2}>{k}</Txt>
        <Txt f="l" size={chico ? 24 : 28} ls={-0.9} style={{ marginTop: 8 }} numberOfLines={1} adjustsFontSizeToFit>{v}</Txt>
        <Txt size={12} color={C.t3} numberOfLines={1} style={{ marginTop: 4 }}>{sub}</Txt>
        {sube || baja ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 }}>
            <Ionicons name={sube ? 'arrow-up' : 'arrow-down'} size={12} color={C.t2} />
            {fmt(delta!) ? <Txt f="monoR" size={11.5} color={C.t2}>{fmt(delta!)}</Txt> : null}
            <Txt size={11.5} color={C.t3}>{t('vs last week')}</Txt>
          </View>
        ) : null}
      </Cel>
    </Animated.View>
  );
}
