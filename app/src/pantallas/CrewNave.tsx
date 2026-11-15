/* Crew en modo misión: la tripulación de la nave, en vivo desde el núcleo de a bordo (solo lo que cada persona
   comparte). Quien necesita atención va primero, con un botón para abrir la guía de emergencia para esa persona. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { miIndice, useNaveEstado, type Nivel, type TripNave } from '../cuenta/naveEstado';
import { useNave } from '../cuenta/nave';
import { useIdioma } from '../i18n';
import { Pantalla } from '../ui/Pantalla';
import { C, Cel, Txt } from '../ui/tema';

const RANGO: Record<Nivel, number> = { sin_dato: 0, normal: 1, esperado_vuelo: 2, atencion: 3, aviso_tierra: 4 };
const colorDe = (n?: Nivel) => n === 'aviso_tierra' ? C.alerta : n === 'atencion' ? C.aviso : n === 'sin_dato' || !n ? C.t3 : C.ok;
const ANIMO = ['', 'Low', 'Down', 'Okay', 'Good', 'Great'];

export default function CrewNave() {
  const { t } = useIdioma(), { url } = useNave();
  const { estado, tripulacion, vivo, mision } = useNaveEstado();
  const yo = miIndice();
  if (!url || !estado) {
    return (
      <Pantalla titulo={t('Crew')} sub={t('Onboard')}>
        <Cel style={{ padding: 20, gap: 8 }}>
          <Ionicons name="planet-outline" size={26} color={C.t3} />
          <Txt size={15} lh={21} color={C.t2}>{!url ? t('Link your phone to the ship (Settings → Mission mode → Ship link) to see how your crew is doing.') : t('Waiting for the ship’s onboard core…')}</Txt>
        </Cel>
      </Pantalla>
    );
  }
  // con tripulación real, los asientos que nadie ocupa no aparecen
  const filas = estado.trip.map((tr, i) => ({ tr, i, p: tripulacion[i] })).filter(f => !f.p?.vacio).sort((a, b) => RANGO[b.tr.nivel] - RANGO[a.tr.nivel] || a.i - b.i);
  const etiqueta = (tr: TripNave) => {
    const fuera = Object.entries(tr.niveles).filter(([k, n]) => (n === 'atencion' || n === 'aviso_tierra') && tr.edades[k] > 0).map(([k]) => k);
    const N: Record<string, string> = { pulso: t('heart rate'), spo2: t('oxygen'), pa_sis: t('blood pressure'), pa_dia: t('blood pressure'), temp: t('temperature'), fr: t('breathing'), glucosa: t('blood sugar'), sueno_h: t('sleep'), animo: t('mood'), energia: t('energy') };
    return fuera.length ? [...new Set(fuera.map(k => N[k] ?? k))].join(', ') : t('All in range');
  };
  return (
    <Pantalla titulo={t('Crew')} sub={vivo ? t('Live from the ship · day {n}', { n: mision?.dia ?? '' }) : t('No signal from the ship')}>
      {filas.map(({ tr, i, p }) => {
        const alerta = tr.nivel === 'atencion' || tr.nivel === 'aviso_tierra';
        const v = (k: keyof TripNave, dec = 0) => (tr.edades[k as string] > 0 ? (tr[k] as number).toFixed(dec) : '—');
        return (
          <View key={i} style={{ marginBottom: 10, borderRadius: 24, padding: 16, backgroundColor: tr.nivel === 'aviso_tierra' ? '#1c0b15' : tr.nivel === 'atencion' ? '#17120a' : C.s1, borderWidth: 1, borderColor: tr.nivel === 'aviso_tierra' ? 'rgba(236,106,168,0.45)' : tr.nivel === 'atencion' ? 'rgba(242,180,87,0.38)' : C.l1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: p?.col ?? C.nova }}>
                <Txt f="s" size={14} color={C.bg}>{p?.ini ?? `T${i + 1}`}</Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt f="s" size={17} ls={-0.3}>{p?.nombre ?? `T${i + 1}`}{i === yo ? ` · ${t('you')}` : ''}</Txt>
                <Txt size={13} color={C.t2}>{p ? t(p.rol) : ''}</Txt>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colorDe(tr.nivel) }} />
                <Txt f="m" size={12.5} color={colorDe(tr.nivel)} numberOfLines={1} style={{ maxWidth: 140 }}>{etiqueta(tr)}</Txt>
              </View>
            </View>
            <View style={{ flexDirection: 'row', marginTop: 14 }}>
              {([['Heart', v('pulso'), 'bpm', 'pulso'], ['Oxygen', v('spo2'), '%', 'spo2'], ['BP', tr.edades.pa_sis > 0 ? `${Math.round(tr.pa_sis)}/${Math.round(tr.pa_dia)}` : '—', '', 'pa_sis'], ['Temp', v('temp', 1), '°', 'temp']] as const).map(([n, val, u, k]) => (
                <View key={n} style={{ flex: 1 }}>
                  <Txt size={11.5} color={C.t3}>{t(n)}</Txt>
                  <Txt f="l" size={22} ls={-0.8} color={colorDe(tr.niveles[k]) === C.ok ? C.t1 : colorDe(tr.niveles[k])}>{val}<Txt size={11} color={C.t3}>{u ? ` ${u}` : ''}</Txt></Txt>
                </View>
              ))}
            </View>
            {tr.edades.sueno_h > 0 || tr.edades.animo > 0 ? (
              <Txt size={12.5} color={C.t3} style={{ marginTop: 10 }}>
                {[tr.edades.sueno_h > 0 ? t('Slept {h} h', { h: tr.sueno_h.toFixed(1) }) : '', tr.edades.animo > 0 ? t('Mood {m}', { m: t(ANIMO[Math.round(tr.animo)] ?? '') }) : ''].filter(Boolean).join(' · ')} · {t('shared from their phone')}
              </Txt>
            ) : null}
            {alerta && i !== yo ? (
              <Pressable onPress={() => router.push({ pathname: '/emergencia', params: { trip: `T${i + 1}` } })} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 12, height: 42, borderRadius: 21, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(236,106,168,0.55)', opacity: pressed ? 0.7 : 1 })}>
                <Ionicons name="medkit-outline" size={16} color={C.alerta} />
                <Txt f="s" size={14} color="#ffd3e7">{t('Help {n}', { n: p?.corto ?? `T${i + 1}` })}</Txt>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <Txt size={12.5} color={C.t3} lh={18} style={{ textAlign: 'center', marginTop: 10, paddingHorizontal: 10 }}>{t('Each crew member decides what they share. Mood, cycle and journal never appear here unless they choose to share them.')}</Txt>
    </Pantalla>
  );
}
