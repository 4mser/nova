/* Tu semana en Cuerpo: sueño por noche, pasos por día y recuperación contra tu propia línea base (Health Connect).
   Cada tarjeta aparece solo si hay datos de verdad; sin Health Connect, una invitación a conectarlo. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useConsentimiento } from '../sensores/fuentes';
import { recuperacion, ultimos, useHistoria, type Dia } from '../sensores/historia';
import { useIdioma } from '../i18n';
import { C, Cel, Lbl, Seccion, Toque, Txt } from './tema';

const META_PASOS = 8000;
const durTxt = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };

/** barras por día con la inicial debajo; `banda` marca la zona sana (dos líneas finas) */
export function BarrasDias({ dias, valor, max, color, w, h = 74, linea, locale }: { dias: Dia[]; valor: (d: Dia) => number | undefined; max: number; color: (v: number) => string; w: number; h?: number; linea?: number; locale: string }) {
  const n = dias.length, ancho = w / n, bw = Math.min(16, ancho * 0.46);
  return (
    <View style={{ width: w }}>
      <View style={{ height: h, flexDirection: 'row', alignItems: 'flex-end' }}>
        {linea != null ? <View style={{ position: 'absolute', left: 0, right: 0, bottom: (linea / max) * h, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} /> : null}
        {dias.map((d, i) => {
          const v = valor(d), hoy = i === n - 1;
          return (
            <View key={d.fecha} style={{ width: ancho, alignItems: 'center' }}>
              <View style={{ width: bw, height: v != null ? Math.max(4, Math.min(1, v / max) * h) : 4, borderRadius: bw / 2, backgroundColor: v != null ? color(v) : 'rgba(255,255,255,0.08)', opacity: v != null && !hoy ? 0.85 : 1 }} />
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        {dias.map((d, i) => (
          <Txt key={d.fecha} f="monoR" size={11} color={i === n - 1 ? C.t1 : C.t3} style={{ width: ancho, textAlign: 'center' }}>
            {new Date(`${d.fecha}T12:00:00`).toLocaleDateString(locale, { weekday: 'narrow' }).toUpperCase()}
          </Txt>
        ))}
      </View>
    </View>
  );
}

export function SemanaCuerpo({ w }: { w: number }) {
  const { t, locale } = useIdioma(), { dias } = useHistoria(), { c } = useConsentimiento();
  const sem = ultimos(dias, 7);
  const sue = sem.map(d => d.suenoH).filter((x): x is number => x != null);
  const pas = sem.map(d => d.pasos).filter((x): x is number => x != null);
  const rec = recuperacion(dias);
  if (!sue.length && !pas.length && !rec) {
    if (c.salud) return null;
    return (
      <>
        <Seccion t={t('Your week')} />
        <Toque onPress={() => router.push('/datos')} label={t('Connect Health Connect')}>
          <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: C.sigSuave, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="fitness-outline" size={20} color={C.nova} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt f="s" size={15}>{t('Connect Health Connect')}</Txt>
              <Txt size={13} lh={18} color={C.t2} style={{ marginTop: 2 }}>{t('Your sleep, steps and recovery, night by night, from your watch or health app.')}</Txt>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.t3} />
          </Cel>
        </Toque>
      </>
    );
  }
  const dentro = w - 34;
  const prom = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return (
    <>
      <Seccion t={t('Your week')} nota={t('last 7 days')} />
      {rec ? <TarjetaRecuperacion r={rec} /> : null}
      {sue.length ? (
        <Cel style={{ marginTop: rec ? 8 : 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Lbl t={t('Sleep')} style={{ flex: 1 }} />
            <Txt size={13} color={C.t2}>{t('{h} on average', { h: durTxt(prom(sue)) })}</Txt>
          </View>
          <View style={{ marginTop: 14 }}>
            <BarrasDias dias={sem} valor={d => d.suenoH} max={10} linea={7} w={dentro} locale={locale} color={v => (v >= 7 && v <= 9 ? C.ok : v < 6 ? C.aviso : C.sig)} />
          </View>
          <Txt size={12.5} lh={17} color={C.t3} style={{ marginTop: 10 }}>{t('Green: between 7 and 9 hours. The line marks 7 h.')}</Txt>
        </Cel>
      ) : null}
      {pas.length ? (
        <Cel style={{ marginTop: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Lbl t={t('Steps')} style={{ flex: 1 }} />
            <Txt size={13} color={C.t2}>{t('{n} a day', { n: Math.round(prom(pas)).toLocaleString(locale) })}</Txt>
          </View>
          <View style={{ marginTop: 14 }}>
            <BarrasDias dias={sem} valor={d => d.pasos} max={Math.max(META_PASOS * 1.4, ...pas)} linea={META_PASOS} w={dentro} locale={locale} color={v => (v >= META_PASOS ? C.ok : C.nova)} />
          </View>
          <Txt size={12.5} color={C.t3} style={{ marginTop: 10 }}>{t('{n} of 7 days over {meta}', { n: pas.filter(p => p >= META_PASOS).length, meta: META_PASOS.toLocaleString(locale) })}</Txt>
        </Cel>
      ) : null}
    </>
  );
}

function TarjetaRecuperacion({ r }: { r: NonNullable<ReturnType<typeof recuperacion>> }) {
  const { t } = useIdioma();
  const col = r.nivel === 'buena' ? C.ok : r.nivel === 'baja' ? C.aviso : C.nova;
  const titulo = r.nivel === 'buena' ? t('Recovering well') : r.nivel === 'baja' ? t('Recovery lower than usual') : t('Recovery as usual');
  const consejo = r.nivel === 'buena' ? t('A good moment for a demanding workout or a long focus session.') : r.nivel === 'baja' ? t('Compatible with tiredness or stress. Prioritise sleep and keep training light today.') : t('Your body is in its usual range.');
  return (
    <Cel>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: col }} />
        <Txt f="s" size={16} style={{ flex: 1 }}>{titulo}</Txt>
      </View>
      <Txt size={14} lh={20} color={C.t2} style={{ marginTop: 6 }}>{consejo}</Txt>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
        {r.vfc ? <Dato k={t('HRV')} v={`${Math.round(r.vfc.semana)} ms`} base={t('you usually {v}', { v: `${Math.round(r.vfc.base)} ms` })} /> : null}
        {r.reposo ? <Dato k={t('Resting HR')} v={`${Math.round(r.reposo.semana)} ${t('bpm')}`} base={t('you usually {v}', { v: `${Math.round(r.reposo.base)}` })} /> : null}
      </View>
      <Txt size={11.5} lh={16} color={C.t3} style={{ marginTop: 12 }}>{t('Last 3 days compared with your own 28-day average. Not a medical assessment.')}</Txt>
    </Cel>
  );
}
function Dato({ k, v, base }: { k: string; v: string; base: string }) {
  return (
    <View style={{ flex: 1, padding: 12, borderRadius: 16, backgroundColor: C.s2 }}>
      <Txt size={12.5} color={C.t2}>{k}</Txt>
      <Txt f="l" size={22} ls={-0.6} style={{ marginTop: 4 }}>{v}</Txt>
      <Txt size={11.5} color={C.t3} style={{ marginTop: 2 }}>{base}</Txt>
    </View>
  );
}
