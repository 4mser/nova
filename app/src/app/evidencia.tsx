/* «See evidence»: la inferencia completa detrás del mensaje de NOVA, con sus límites. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hh, hoy } from '../engine/motor';
import { Banda } from '../ui/Banda';
import { C, Divisor, Grupo, Seccion, Tag, Txt } from '../ui/tema';
import { useIdioma } from '../i18n';

const fmt = (v: number, u: string) => (u === 'h' ? hh(v) : `${Math.round(v)} ${u}`);

export default function Evidencia() {
  const tr = useIdioma(), { t } = tr;
  const H = hoy(tr), { inf, resp } = H, ins = useSafeAreaInsets(), { width } = useWindowDimensions();
  const W = Math.min(width, 520) - 40 - 32;
  const series: Record<string, number[]> = { 'ev-rmssd': H.histVfc, 'ev-sueno': H.histSueno };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: ins.bottom + 30 }}>
        <Txt f="m" size={24} ls={-0.4}>{t('Why Nova said that')}</Txt>
        <Txt size={15} color={C.t2} lh={21} style={{ marginTop: 6 }}>{t('Nova only says what the evidence supports. This is everything it used, and nothing else.')}</Txt>

        <Grupo style={{ flexDirection: 'row', paddingHorizontal: 0, paddingVertical: 14, marginTop: 18, backgroundColor: C.s1 }}>
          {[
            [t('Assessment'), t(inf.estado === 'elevated' ? 'Incomplete recovery' : inf.estado === 'normal' ? 'Normal' : 'Unknown'), inf.estado === 'elevated' ? C.aviso : C.t1],
            [t('Confidence'), tr.tc('confianza', inf.confianza[0].toUpperCase() + inf.confianza.slice(1)), C.t1],
            [t('Signal quality'), `${Math.round(inf.calidad * 100)}%`, C.t1],
          ].map(([k, v, col], i) => (
            <View key={k} style={{ flex: 1, flexDirection: 'row' }}>
              {i > 0 && <Divisor v />}
              <View style={{ flex: 1, paddingHorizontal: 14 }}>
                <Txt size={12.5} color={C.t3}>{k}</Txt>
                <Txt f="m" size={15} lh={20} color={col} style={{ marginTop: 3 }}>{v}</Txt>
              </View>
            </View>
          ))}
        </Grupo>

        <Seccion t={t('Evidence')} nota={t('Against your last 14 days')} />
        <Grupo style={{ backgroundColor: C.s1 }}>
          {inf.evidencia.map((e, i) => {
            const p = Math.round(e.delta * 100);
            return (
              <View key={e.id}>
                {i > 0 && <Divisor />}
                <View style={{ paddingVertical: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Txt f="m" size={15} style={{ flex: 1 }}>{t(e.rasgo)}</Txt>
                    <Tag k={e.fuente === 'LIVE' ? 'LIVE' : 'SIMULATED'} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 6 }}>
                    <Txt f="l" size={30} ls={-0.5} style={{ flex: 1 }}>{fmt(e.valor, e.unidad)}</Txt>
                    <Txt f="m" size={15} color={p < -10 ? C.aviso : C.t1}>{p > 0 ? '+' : '−'}{Math.abs(p)}%</Txt>
                  </View>
                  <Txt size={13} color={C.t3}>{t('Usual {v}', { v: fmt(e.base, e.unidad) })}</Txt>
                  <View style={{ marginTop: 10 }}>{series[e.id] ? <Banda serie={series[e.id]} w={W} h={52} /> : null}</View>
                </View>
              </View>
            );
          })}
        </Grupo>
        <Txt size={13} color={C.t3} lh={18} style={{ marginTop: 8, paddingHorizontal: 2 }}>{t('The shaded band is your usual range and the dashed line is its median. Amber means today falls outside it.')}</Txt>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
          <Ionicons name={resp.requiereHumano ? 'medkit-outline' : 'checkmark-circle-outline'} size={17} color={C.t2} style={{ marginTop: 1 }} />
          <Txt size={14.5} color={C.t2} lh={21} style={{ flex: 1 }}>{t(resp.requiereHumano ? 'Because this affects training, a person decides. Your flight surgeon has the same evidence.' : 'Nothing here needs a person to review it.')}</Txt>
        </View>

        <Seccion t={t('Limits')} />
        <Txt size={14.5} color={C.t3} lh={21}>{inf.limites.map(l => { const x = t(l); return x[0].toUpperCase() + x.slice(1); }).join('. ')}. {t('Recovery model v{v}.', { v: inf.version })}</Txt>
      </ScrollView>
    </View>
  );
}
