/* Tarjetas que NOVA muestra dentro de la conversación mientras habla de algo: la medida con su historia y su banda
   habitual, la radiación, la semana, el entrenamiento, hueso y músculo, el resumen del día y el plan.
   NOVA las pide con llamadas de función (servidor/voz.mjs); sin conexión, las reglas locales las adjuntan. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { hh, hoy, SEMANA } from '../engine/motor';
import { Banda, banda, fuera } from './Banda';
import { Anillos, Barritas, Constelacion, Serie, TrazaViva } from './Graficos';
import { Barra, C, Lbl, Num, Toque, Txt } from './tema';
import { useIdioma, type Traductor } from '../i18n';

export const GRAFICOS = ['hrv', 'sleep', 'heart_rate', 'spo2', 'skin_temp', 'respiration', 'readiness', 'radiation', 'mood_week', 'training', 'bone', 'muscle', 'summary', 'plan'] as const;
export type Grafico = (typeof GRAFICOS)[number];

type Medida = { t: string; u: string; serie: number[]; fmt: (v: number) => string; fuente: string; nota?: string };

/** los textos se guardan en inglés y se traducen al dibujar la tarjeta */
function medidas(tr: Traductor): Partial<Record<Grafico, Medida>> {
  const H = hoy(tr), { t } = tr;
  const r1 = (v: number) => String(Math.round(v)), d1 = (v: number) => v.toFixed(1);
  return {
    hrv: { t: 'Heart rate variability', u: 'ms', serie: H.histVfc, fmt: r1, fuente: 'RMSSD, chest strap', nota: 'Lower than usual often means incomplete recovery.' },
    sleep: { t: 'Sleep', u: '', serie: H.histSueno, fmt: v => hh(v), fuente: 'Wearable, night total', nota: t('Deep sleep {h} last night.', { h: hh(H.suenoProfundo) }) },
    heart_rate: { t: 'Resting heart rate', u: 'bpm', serie: H.histFc, fmt: r1, fuente: 'Chest strap, at rest' },
    spo2: { t: 'Oxygen saturation', u: '%', serie: H.histSpo2, fmt: r1, fuente: 'SpO₂, wearable' },
    skin_temp: { t: 'Skin temperature', u: '°C', serie: H.histPiel, fmt: d1, fuente: 'Wearable' },
    respiration: { t: 'Respiration', u: '/min', serie: H.histResp, fmt: r1, fuente: 'Chest strap' },
  };
}

function Marco({ children, titulo, fuente, ir }: { children: React.ReactNode; titulo: string; fuente?: string; ir?: () => void }) {
  const { t } = useIdioma();
  return (
    <Animated.View entering={FadeIn.duration(280)} style={{ alignSelf: 'stretch', borderRadius: 24, padding: 16, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Lbl t={t(titulo)} style={{ flex: 1 }} />
        {ir ? (
          <Toque onPress={ir} label={t('Open {que}', { que: t(titulo) })} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Txt f="m" size={12.5} color={C.nova}>{t('Open')}</Txt>
            <Ionicons name="chevron-forward" size={13} color={C.nova} />
          </Toque>
        ) : null}
      </View>
      {children}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.sig, opacity: 0.8 }} />
        <Txt size={11.5} color={C.t3}>{t('Simulated')}{fuente ? ` · ${t(fuente)}` : ''}</Txt>
      </View>
    </Animated.View>
  );
}

/** una medida con sus últimos 15 días contra la banda habitual */
function TarjetaMedida({ m, w, ir }: { m: Medida; w: number; ir?: () => void }) {
  const { t } = useIdioma();
  const b = banda(m.serie.slice(0, -1)), hoyV = m.serie[m.serie.length - 1], af = fuera(m.serie);
  const dif = (hoyV - b.med) / b.med;
  return (
    <Marco titulo={m.t} fuente={m.fuente} ir={ir}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Num v={m.fmt(hoyV)} u={m.u ? t(m.u) : undefined} size={36} color={af ? C.aviso : C.t1} />
          <Txt size={13} color={C.t3}>{t('today · usual {v}', { v: `${m.fmt(b.med)}${m.u ? ` ${t(m.u)}` : ''}` })}</Txt>
        </View>
        <View style={{ paddingHorizontal: 10, height: 26, borderRadius: 13, justifyContent: 'center', backgroundColor: af ? C.avisoSuave : C.sigSuave }}>
          <Txt f="s" size={13} color={af ? C.aviso : C.nova}>{dif >= 0 ? '+' : '−'}{Math.abs(Math.round(dif * 100))}%</Txt>
        </View>
      </View>
      <Banda serie={m.serie} w={w} h={74} />
      <View style={{ flexDirection: 'row' }}>
        <Txt size={11.5} color={C.t3} style={{ flex: 1 }}>{t('15 days ago')}</Txt>
        <Txt size={11.5} color={C.t3}>{t('shaded: your usual range')}</Txt>
        <Txt size={11.5} color={C.t3} style={{ flex: 1, textAlign: 'right' }}>{t('today')}</Txt>
      </View>
      {m.nota ? <Txt size={13} lh={18} color={C.t2}>{t(m.nota)}</Txt> : null}
    </Marco>
  );
}

export function TarjetaGrafico({ tipo }: { tipo: string }) {
  const { width } = useWindowDimensions();
  const W = Math.min(width, 520) - 40 - 34;
  const tr = useIdioma(), { t } = tr;
  const H = hoy(tr);
  const m = medidas(tr)[tipo as Grafico];
  if (m) return <TarjetaMedida m={m} w={W} ir={tipo === 'hrv' || tipo === 'sleep' ? () => router.push('/evidencia') : () => router.navigate({ pathname: '/salud', params: { seg: 'cuerpo' } })} />;

  switch (tipo as Grafico) {
    case 'readiness': {
      const af = H.preparacion < H.habitual - 8;
      return (
        <Marco titulo="Readiness" fuente="HRV and sleep against your last 14 days" ir={() => router.push('/evidencia')}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Num v={String(H.preparacion)} u="/ 100" size={36} color={af ? C.aviso : C.t1} />
              <Txt size={13} color={C.t3}>{t('usual {v}', { v: `${H.habitual - 8}–${H.habitual + 8}` })}</Txt>
            </View>
          </View>
          <Barritas w={W} h={64} vals={H.histPrep.map(v => v / 100)} col={af ? C.aviso : C.sig} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {SEMANA.map(d => <Txt key={d.dia} size={11.5} color={C.t3} style={{ width: W / 7, textAlign: 'center' }}>{t(d.dia)}</Txt>)}
          </View>
        </Marco>
      );
    }
    case 'radiation': {
      const p = H.dosis / H.limite;
      return (
        <Marco titulo="Radiation dose" fuente="dosimeter, MSL RAD rates" ir={() => router.navigate('/')}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Num v={String(H.dosis)} u="mSv" size={36} />
              <Txt size={13} color={C.t3}>{t('this mission · +{n} mSv today', { n: H.dosisDia })}</Txt>
            </View>
            <Txt f="s" size={15} color={C.aviso}>{t('{p}% of limit', { p: Math.round(p * 100) })}</Txt>
          </View>
          <Serie w={W} h={64} vals={H.histDosis} col={C.aviso} />
          <View style={{ flexDirection: 'row' }}>
            <Txt size={11.5} color={C.t3} style={{ flex: 1 }}>{t('30 days ago')}</Txt>
            <Txt size={11.5} color={C.t3}>{t('today')}</Txt>
          </View>
          <Barra v={p} color={C.aviso} />
          <View style={{ flexDirection: 'row' }}>
            <Txt size={11.5} color={C.t3} style={{ flex: 1 }}>0</Txt>
            <Txt size={11.5} color={C.t3}>{t('career limit {n} mSv', { n: H.limite })}</Txt>
          </View>
        </Marco>
      );
    }
    case 'mood_week': {
      const animo = SEMANA.reduce((a, d) => a + d.animo, 0) / SEMANA.length;
      return (
        <Marco titulo="Your week" fuente="evening check-ins" ir={() => router.navigate({ pathname: '/salud', params: { seg: 'mente' } })}>
          <Num v={animo.toFixed(1)} u={t('/ 5 average mood')} size={30} />
          <Constelacion w={W} h={170} dias={SEMANA} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {['height · mood', 'size · sleep', 'color · stress'].map(k => <Txt key={k} size={11.5} color={C.t3}>{t(k)}</Txt>)}
          </View>
        </Marco>
      );
    }
    case 'training': {
      const [fz, fm] = H.ejercicio.fuerza, [cd, cm] = H.ejercicio.cardio;
      return (
        <Marco titulo="Training today" fuente="ARED and cycle ergometer" ir={() => router.navigate({ pathname: '/salud', params: { seg: 'cuerpo' } })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
            <Anillos size={110} anillos={[{ v: fz / fm, col: C.ok, r: 50, w: 11 }, { v: cd / cm, col: C.nova, r: 34, w: 11 }]} />
            <View style={{ gap: 10 }}>
              {([['Resistance', fz, fm, C.ok], ['Cardio', cd, cm, C.nova]] as const).map(([k, v, mx, col]) => (
                <View key={k}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: col }} />
                    <Txt size={13.5} color={C.t2}>{t(k)}</Txt>
                  </View>
                  <Txt size={18} ls={-0.3}>{t('{v} of {m} min', { v, m: mx })}</Txt>
                </View>
              ))}
            </View>
          </View>
        </Marco>
      );
    }
    case 'bone':
    case 'muscle': {
      const hueso = tipo === 'bone';
      return (
        <Marco titulo={hueso ? 'Hip bone density' : 'Leg muscle mass'} fuente="since launch" ir={() => router.navigate({ pathname: '/salud', params: { seg: 'cuerpo' } })}>
          <Num v={hueso ? `−${Math.abs(H.hueso)}` : String(H.musculo)} u={t(hueso ? '% per month' : '% of launch')} size={34} />
          <Serie w={W} h={64} vals={hueso ? H.histHueso : H.histMusculo} col={C.ok} area />
          <Txt size={13} lh={18} color={C.t2}>{t(hueso ? 'Expected in microgravity. Resistance training slows it.' : 'Within the range for this point of the mission.')}</Txt>
        </Marco>
      );
    }
    case 'summary': {
      const celda = (W - 8) / 2;
      const filas: [string, string, string, boolean][] = [
        ['Heart', String(H.fc), 'bpm', false],
        ['Readiness', String(H.preparacion), '/ 100', H.preparacion < H.habitual - 8],
        ['Sleep', hh(H.sueno), '', true],
        ['HRV', String(H.vfc), 'ms', true],
      ];
      return (
        <Marco titulo="Today at a glance" ir={() => router.navigate('/')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {filas.map(([k, v, u, af]) => (
              <View key={k} style={{ width: celda, padding: 12, borderRadius: 16, backgroundColor: C.s2 }}>
                <Txt size={12.5} color={C.t2}>{t(k)}</Txt>
                <Num v={v} u={u ? t(u) : undefined} size={24} color={af ? C.aviso : C.t1} style={{ marginTop: 4 }} />
              </View>
            ))}
          </View>
          <TrazaViva w={W} h={34} bpm={H.fc} latidos={4} />
        </Marco>
      );
    }
    case 'plan':
      return (
        <Marco titulo="Today's plan" ir={() => router.navigate('/')}>
          {[['08:30', 'Breakfast and medication', 'Done'], ['10:00', 'Spacewalk prep', 'Now · with Kenji in Node 2'], ['13:30', 'Resistance training', '60 min on ARED'], ['21:00', 'Evening check-in', 'About a minute with Nova']].map(([h, k, d], i) => (
            <View key={h} style={{ flexDirection: 'row', gap: 12, paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
              <Txt f="mono" size={13} color={i === 1 ? C.nova : C.t3} style={{ width: 46, paddingTop: 2 }}>{h}</Txt>
              <View style={{ flex: 1 }}>
                <Txt f="m" size={14.5} color={i === 0 ? C.t3 : C.t1}>{t(k)}</Txt>
                <Txt size={12.5} color={i === 1 ? C.nova : C.t3}>{t(d)}</Txt>
              </View>
            </View>
          ))}
        </Marco>
      );
    default:
      return null;
  }
}

/** sin conexión: qué gráfico corresponde a una pregunta (mismas palabras que el motor de reglas) */
export function graficoPara(q: string): Grafico | null {
  const t = q.toLowerCase(), tiene = (ws: string[]) => ws.some(w => t.includes(w));
  if (tiene(['how am i', 'cómo estoy', 'como estoy'])) return 'summary';
  if (tiene(['readiness', 'why', 'preparación', 'por qué'])) return 'readiness';
  if (tiene(['sleep', 'slept', 'dorm', 'sueño'])) return 'sleep';
  if (tiene(['dose', 'radiation', 'radiación', 'dosis', 'msv'])) return 'radiation';
  if (tiene(['hrv', 'variab'])) return 'hrv';
  if (tiene(['heart', 'pulse', 'bpm', 'lpm', 'corazón', 'pulso'])) return 'heart_rate';
  if (tiene(['mood', 'week', 'ánimo', 'semana'])) return 'mood_week';
  if (tiene(['training', 'workout', 'exercise', 'entren', 'ejercicio'])) return 'training';
  if (tiene(['caminata', 'spacewalk'])) return 'readiness';
  if (tiene(['bone', 'hueso', 'ósea', 'osea'])) return 'bone';
  if (tiene(['muscle', 'músculo'])) return 'muscle';
  if (tiene(['plan', 'schedule', 'agenda', 'qué tengo', 'que tengo'])) return 'plan';
  return null;
}
