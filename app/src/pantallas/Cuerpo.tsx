/* Body, como el mockup del video: corazón en vivo, tres signos, anillos de entrenamiento, hueso y músculo. */
import { useWindowDimensions, View } from 'react-native';
import { hoy } from '../engine/motor';
import { Anillos, Barritas, Serie, TrazaViva } from '../ui/Graficos';
import { PanelEnVivo } from '../ui/EnVivo';
import { SemanaCuerpo } from '../ui/Semana';
import { Pantalla } from '../ui/Pantalla';
import { C, Cel, Lbl, Num, Txt } from '../ui/tema';
import { useIdioma } from '../i18n';
import { useFunciones } from '../engine/funciones';
import { useVivo } from '../sensores/vivo';

export default function Body() {
  const { mision } = useFunciones();
  return mision ? <Cuerpo /> : <CuerpoDiario />;
}

const META_PASOS = 8000, META_EJERCICIO = 30;
/** Body en el día a día: solo lo que de verdad miden tu teléfono, tu reloj y Health Connect */
function CuerpoDiario() {
  const tr = useIdioma(), { t, locale } = tr, { width } = useWindowDimensions();
  const W = Math.min(width, 520) - 40;
  const v = useVivo(), s = v.salud;
  const pasos = s?.pasos ?? (v.sensores.pasos ? v.pasos : undefined), ej = s?.ejercicioMin;
  const hayAlgo = pasos != null || ej != null || s?.calorias != null;
  return (
    <Pantalla titulo={t('Body')} sub={t('From your watch, health apps and phone')}>
      {hayAlgo ? (
        <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 18, padding: 18, marginBottom: 16 }}>
          <Anillos size={118} anillos={[{ v: (pasos ?? 0) / META_PASOS, col: C.nova, r: 50, w: 11 }, { v: (ej ?? 0) / META_EJERCICIO, col: C.ok, r: 34, w: 11 }]} />
          <View style={{ gap: 12, flex: 1 }}>
            {([['Steps', pasos, META_PASOS, C.nova, ''], ['Exercise', ej, META_EJERCICIO, C.ok, ' min']] as const).map(([k, val, meta, col, u]) => (
              <View key={k}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: col }} />
                  <Txt size={14} color={C.t2}>{t(k)}</Txt>
                </View>
                <Txt size={19} ls={-0.4}>{val != null ? `${val.toLocaleString(locale)}${u}` : '—'} <Txt size={13} color={C.t3}>/ {meta.toLocaleString(locale)}{u}</Txt></Txt>
              </View>
            ))}
            {s?.calorias != null ? <Txt size={13} color={C.t3}>{t('{n} kcal active', { n: Math.round(s.calorias) })}</Txt> : null}
          </View>
        </Cel>
      ) : null}
      <PanelEnVivo w={W} />
      <SemanaCuerpo w={W} />
      <Txt size={12.5} color={C.t3} lh={18} style={{ textAlign: 'center', marginTop: 18, paddingHorizontal: 10 }}>{t('Everything here is real and stays on your phone. Nova is not a medical device.')}</Txt>
    </Pantalla>
  );
}

function Cuerpo() {
  const tr = useIdioma(), { t } = tr;
  const H = hoy(tr), { width } = useWindowDimensions();
  const W = Math.min(width, 520) - 40, celda = (W - 8) / 2, tercio = (W - 16) / 3;
  const [fz, fzMeta] = H.ejercicio.fuerza, [cd, cdMeta] = H.ejercicio.cardio;
  const vfcBaja = H.inf.evidencia[0].delta < -0.1;
  return (
    <Pantalla titulo={t('Body')} sub={t('Day {n} · everything in range', { n: H.sol })}>
      <PanelEnVivo w={W} />

      <Txt f="s" size={19} ls={-0.5} style={{ marginTop: 22, marginBottom: 10, paddingHorizontal: 2 }}>{t("Today's record")}</Txt>
      <Cel style={{ padding: 18 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Lbl t={t('Heart · simulated')} />
          <Txt f="m" size={13} color={C.t2}>{t('HRV')} <Txt f="m" size={13} color={vfcBaja ? C.aviso : C.t1}>{H.vfc} ms</Txt></Txt>
        </View>
        <Num v={String(H.fc)} u={t('bpm')} size={44} style={{ marginTop: 10 }} />
        <View style={{ marginTop: 10 }}><TrazaViva w={W - 38} h={54} bpm={H.fc} latidos={3.2} /></View>
      </Cel>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        {([['SpO₂', String(H.spo2), '%'], ['Skin', H.piel.toFixed(1), '°'], ['Breaths', String(H.resp_min), '/m']] as const).map(([k, v, u]) => (
          <Cel key={k} style={{ width: tercio, padding: 14 }}>
            <Lbl t={t(k)} />
            <Num v={v} u={u} size={26} style={{ marginTop: 8 }} />
          </Cel>
        ))}
      </View>

      <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 18, padding: 18, marginTop: 16 }}>
        <Anillos size={118} anillos={[{ v: fz / fzMeta, col: C.ok, r: 50, w: 11 }, { v: cd / cdMeta, col: C.nova, r: 34, w: 11 }]} />
        <View style={{ gap: 12 }}>
          {([['Resistance', fz, fzMeta, C.ok], ['Cardio', cd, cdMeta, C.nova]] as const).map(([k, v, m, col]) => (
            <View key={k}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: col }} />
                <Txt size={14} color={C.t2}>{t(k)}</Txt>
              </View>
              <Txt size={19} ls={-0.4}>{t('{v} of {m} min', { v, m })}</Txt>
            </View>
          ))}
        </View>
      </Cel>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Cel style={{ width: celda }}>
          <Lbl t={t('Bone, hip')} />
          <Num v={`−${Math.abs(H.hueso)}`} u={t('%/mo')} style={{ marginTop: 10 }} />
          <View style={{ marginTop: 10 }}><Serie w={celda - 32} h={30} vals={H.histHueso} col={C.ok} area={false} /></View>
        </Cel>
        <Cel style={{ width: celda }}>
          <Lbl t={t('Muscle')} />
          <Num v={String(H.musculo)} u={t('% of launch')} style={{ marginTop: 10 }} />
          <View style={{ marginTop: 10 }}><Barritas w={celda - 32} h={30} vals={H.histMusculo.slice(-10).map(v => (v - 90) / 12)} col={C.ok} /></View>
        </Cel>
      </View>

      <Txt size={12.5} color={C.t3} style={{ textAlign: 'center', marginTop: 18 }}>{t('Demo data. The heart trace is simulated until the chest strap is paired.')}</Txt>
    </Pantalla>
  );
}
