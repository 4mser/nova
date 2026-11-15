/* Ciclo: seguimiento o supresión menstrual, privado por defecto (ver src/engine/ciclo.ts).
   Un toque para registrar el día, señales de cuidado con su fuente, insumos contra los días de misión y control
   explícito de quién ve qué. Nunca sale a la pantalla de la tripulación. */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, TextInput, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fechaDe } from '../engine/diario';
import {
  cambiarConfig, registrarDia, resumen, resumenParaCirujano, SINTOMAS, SINTOMAS_URGENTES, useCiclo,
  type Compartir, type Metodo, type Modo, type Sangrado, type Sintoma,
} from '../engine/ciclo';
import { leerNave } from '../cuenta/nave';
import { Interruptor } from '../ui/Interruptor';
import { Pantalla } from '../ui/Pantalla';
import { C, Cel, F, Lbl, Num, Seccion, Txt } from '../ui/tema';
import { useIdioma } from '../i18n';

const SANGRADO: { v: Sangrado; t: string }[] = [
  { v: 0, t: 'None' }, { v: 1, t: 'Spotting' }, { v: 2, t: 'Light' }, { v: 3, t: 'Medium' }, { v: 4, t: 'Heavy' },
];
const COL_SANGRE = ['rgba(255,255,255,0.08)', '#f2b4d1', '#ec8ab8', '#ec6aa8', '#c23a7e'];
const METODOS: { k: Metodo; t: string }[] = [
  { k: 'pildora_continua', t: 'Continuous pill' }, { k: 'implante', t: 'Implant' }, { k: 'diu_hormonal', t: 'Hormonal IUD' }, { k: 'otro', t: 'Other' },
];
/* lo que dice la evidencia de la biblioteca de NOVA, con su fuente */
const EVIDENCIA = [
  { t: 'Most astronauts on long missions suppress their period with the continuous combined pill. For a 3-year mission that is about 1,100 pills, and their stability in deep-space radiation has not been tested.', f: 'Jain & Wotring, npj Microgravity 2016' },
  { t: 'Long-acting options (implant, hormonal IUD) avoid daily pills, packaging and waste, but have not been tested in flight.', f: 'Jain & Wotring, npj Microgravity 2016' },
  { t: 'Combined pills raise the risk of venous blood clots; the first clot in space was reported in 2019. Irregular bleeding can predispose to anemia.', f: 'Frontiers in Physiology, 2025 review' },
  { t: 'The station recycles water from urine and was not designed for menstrual blood, so breakthrough bleeding needs its own containment on board.', f: 'Jain & Wotring 2016 · NASA-STD-3001 Vol. 2' },
  { t: 'In weightlessness, blood slows down in the neck veins in about half of crew members, women and men. NASA now checks every crewmember with an ultrasound of the jugular vein.', f: 'Marshall-Goebel et al., JAMA Netw Open 2019 · NASA OCHMO-MTB-007, 2026' },
  { t: 'After landing, feeling dizzy or faint on standing up is more common in women. Fluids, compression garments and a stand test before landing help.', f: 'npj Microgravity, 2025' },
  { t: 'NASA uses one career radiation limit for everyone, 600 mSv, set for the most sensitive case: a woman early in her career.', f: 'NASA-STD-3001 · OCHMO-TB-020' },
];

function Chip({ on, t, onPress, col }: { on: boolean; t: string; onPress: () => void; col?: string }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: 14, height: 38, borderRadius: 19, justifyContent: 'center', borderWidth: 1, borderColor: on ? col ?? C.t1 : C.l2, backgroundColor: on ? col ?? C.t1 : 'transparent' }}>
      <Txt f="m" size={14} color={on ? C.bg : C.t2}>{t}</Txt>
    </Pressable>
  );
}

/** campo numérico o de texto; se reinicia cuando cambia el valor guardado (key = valor) */
function Campo(p: { v?: number | string; onFin: (s: string) => void; ph: string; num?: boolean; ancho?: number }) {
  return <CampoInterno key={p.v != null ? String(p.v) : ''} {...p} />;
}
function CampoInterno({ v, onFin, ph, num = true, ancho = 92 }: { v?: number | string; onFin: (s: string) => void; ph: string; num?: boolean; ancho?: number }) {
  const [s, setS] = useState(v != null ? String(v) : '');
  return (
    <TextInput value={s} onChangeText={setS} onEndEditing={() => onFin(s)} placeholder={ph} placeholderTextColor={C.t3}
      keyboardType={num ? 'number-pad' : 'numbers-and-punctuation'} returnKeyType="done"
      style={{ width: ancho, height: 42, borderRadius: 14, backgroundColor: C.s2, paddingHorizontal: 12, color: C.t1, fontFamily: F.r, fontSize: 16, textAlign: 'center' }} />
  );
}

export default function Ciclo() {
  const { t, locale } = useIdioma(), { width } = useWindowDimensions();
  const W = Math.min(width, 520) - 40;
  const { config, dias } = useCiclo();
  const [ahora] = useState(() => Date.now());
  const hoy = fechaDe(ahora), d = dias[hoy] ?? { fecha: hoy, sangrado: 0 as Sangrado, sintomas: [] as Sintoma[] };
  const r = resumen();
  const [envio, setEnvio] = useState('');
  const pildora = config.modo === 'suprimir' && config.metodo === 'pildora_continua';

  // con «solo el resumen al cirujano», se manda a la nave una vez al día (nunca a la pantalla de la tripulación)
  useEffect(() => {
    const nave = leerNave();
    if (config.compartir !== 'resumen' || !nave.url) return;
    fetch(`${nave.url}/v1/privado`, { method: 'POST', headers: { 'content-type': 'application/json', ...(nave.token ? { 'x-nova-token': nave.token } : {}) },
      body: JSON.stringify({ trip: nave.asiento, tipo: 'ciclo', para: 'cirujano', resumen: resumenParaCirujano() }) })
      .then(x => setEnvio(x.ok ? t('Summary sent to the flight surgeon’s report') : t('The ship did not accept the summary')))
      .catch(() => setEnvio(t('Not linked to the ship')));
  }, [config.compartir, hoy, r.senales.length, t]);

  const sub = config.modo === 'seguir'
    ? r.diaCiclo ? t('Day {d} of your cycle', { d: r.diaCiclo }) : t('Log your first period to start')
    : t('{n} days with bleeding in the last 30', { n: r.sangradoIrruptivo30 });

  const textoSenal = (clave: string, datos?: Record<string, string | number>) => ({
    trombosis_pierna: datos?.estrogeno ? t('Leg pain or swelling while on a combined pill can be a blood clot. Tell the flight surgeon now.') : t('Leg pain or swelling can be a blood clot. Tell the flight surgeon now.'),
    trombosis_cuello: t('Neck pain or swelling can be a clot in the jugular vein, the most common place for clots in flight. Tell the flight surgeon now.'),
    urinaria: t('Burning when you pee can be a urinary infection. Drink more water and tell the flight surgeon; the medical kit has a test strip.'),
    regreso: t('Landing in {n} days. Dizziness on standing is more common in women after flight: plan a stand test with the flight surgeon, extra fluids and compression garments.', { n: datos?.n ?? '' }),
    eco_yugular: t('NASA checks every crewmember’s neck veins by ultrasound. Log the date of your last scan below.'),
    trombosis_pecho: t('Chest pain or shortness of breath: tell the flight surgeon now, and open Emergency on the ship screen if it is severe.'),
    anemia: t('Heavy bleeding for {n} days and low energy. Worth checking for anemia with the flight surgeon.', { n: datos?.dias ?? '' }),
    irruptivo: t('{n} days of breakthrough bleeding this month. Common with continuous pills; tell the flight surgeon if it keeps going, and use the onboard containment kit.', { n: datos?.dias ?? '' }),
    adherencia: t('{p}% of pills taken this month. Missed pills make breakthrough bleeding more likely.', { p: datos?.pct ?? '' }),
    insumos: t('Your pills run out {n} days before the end of the mission.', { n: datos?.faltan ?? '' }),
    toallas: t('{n} pads left.', { n: datos?.n ?? '' }),
  } as Record<string, string>)[clave] ?? clave;

  const ult30 = Array.from({ length: 30 }, (_, i) => fechaDe(ahora - (29 - i) * 864e5));
  const anchoBarra = (W - 36 - 29 * 3) / 30;

  return (
    <Pantalla titulo={t('Cycle')} sub={sub}>
      {/* estado */}
      <Cel style={{ padding: 18 }}>
        {config.modo === 'seguir' ? (
          <>
            <Lbl t={t('Your cycle')} />
            <Num v={r.diaCiclo ? String(r.diaCiclo) : '—'} u={t('day')} size={44} style={{ marginTop: 8 }} />
            <Txt size={14} color={C.t2} style={{ marginTop: 6 }}>
              {r.proximoEnDias != null ? (r.proximoEnDias > 0 ? t('Next period in about {n} days · average cycle {l} days', { n: r.proximoEnDias, l: r.largoMedio ?? '' }) : t('Your period may start any day now')) : t('Nova estimates your next period after two logged cycles.')}
            </Txt>
          </>
        ) : (
          <>
            <Lbl t={`${t('Suppression')} · ${t(METODOS.find(m => m.k === config.metodo)?.t ?? 'Method not set')}`} />
            <Num v={String(r.sangradoIrruptivo30)} u={t('days with bleeding · 30 d')} size={44} style={{ marginTop: 8 }} />
            {r.adherencia30 != null ? <Txt size={14} color={r.adherencia30 < 90 ? C.aviso : C.t2} style={{ marginTop: 6 }}>{t('{p}% of pills taken this month', { p: r.adherencia30 })}</Txt> : null}
          </>
        )}
      </Cel>

      {/* señales de cuidado */}
      {r.senales.map(s => (
        <View key={s.clave} style={{ marginTop: 8, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: s.nivel === 'urgente' ? 'rgba(236,106,168,0.5)' : s.nivel === 'atencion' ? 'rgba(242,180,87,0.4)' : C.l1, backgroundColor: s.nivel === 'urgente' ? '#2a0f1e' : s.nivel === 'atencion' ? '#1c150a' : C.s1, flexDirection: 'row', gap: 12 }}>
          <Ionicons name={s.nivel === 'urgente' ? 'alert-circle' : 'information-circle-outline'} size={20} color={s.nivel === 'urgente' ? C.alerta : s.nivel === 'atencion' ? C.aviso : C.t2} />
          <Txt size={14.5} lh={20} style={{ flex: 1 }} color={s.nivel === 'urgente' ? '#ffd3e7' : C.t1}>{textoSenal(s.clave, s.datos)}</Txt>
        </View>
      ))}

      {/* hoy */}
      <Seccion t={t('Today')} />
      <Cel style={{ padding: 16, gap: 14 }}>
        <View>
          <Lbl t={t('Bleeding')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {SANGRADO.map(o => <Chip key={o.v} on={d.sangrado === o.v} t={t(o.t)} col={o.v ? COL_SANGRE[o.v] : undefined} onPress={() => registrarDia(hoy, { sangrado: o.v })} />)}
          </View>
        </View>
        {pildora ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View><Txt size={15}>{t('Pill taken today')}</Txt>{config.pildoras != null ? <Txt size={12.5} color={C.t3}>{t('{n} left', { n: config.pildoras })}</Txt> : null}</View>
            <Interruptor on={!!d.pildora} label={t('Pill taken today')} onChange={v => registrarDia(hoy, { pildora: v })} />
          </View>
        ) : null}
        <View>
          <Lbl t={t('Symptoms')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {SINTOMAS.map(s => {
              const on = d.sintomas.includes(s);
              return <Chip key={s} on={on} t={t(s)} col={SINTOMAS_URGENTES.includes(s) ? C.alerta : C.lila} onPress={() => registrarDia(hoy, { sintomas: on ? d.sintomas.filter(x => x !== s) : [...d.sintomas, s] })} />;
            })}
          </View>
        </View>
      </Cel>

      {/* 30 días */}
      <Seccion t={t('Last 30 days')} />
      <Cel style={{ padding: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 54 }}>
          {ult30.map(f => {
            const x = dias[f], n = x?.sangrado ?? 0;
            return (
              <View key={f} style={{ width: anchoBarra, alignItems: 'center', gap: 4 }}>
                <View style={{ width: anchoBarra, height: 8 + n * 9, borderRadius: anchoBarra / 2, backgroundColor: COL_SANGRE[n] }} />
                {pildora ? <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: x?.pildora ? C.ok : x?.pildora === false ? C.aviso : 'transparent' }} /> : null}
              </View>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          <Txt size={12} color={C.t3}>{new Date(ult30[0]).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</Txt>
          <Txt size={12} color={C.t3}>{t('Today')}</Txt>
        </View>
      </Cel>

      {/* insumos */}
      <Seccion t={t('Supplies for the mission')} />
      <Cel style={{ padding: 16, gap: 12 }}>
        {pildora ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt size={15}>{t('Pills on board')}</Txt>
            <Campo v={config.pildoras} ph="0" onFin={s => cambiarConfig({ pildoras: s.trim() ? Math.max(0, parseInt(s, 10) || 0) : undefined })} />
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt size={15}>{t('Pads and liners')}</Txt>
          <Campo v={config.toallas} ph="0" onFin={s => cambiarConfig({ toallas: s.trim() ? Math.max(0, parseInt(s, 10) || 0) : undefined })} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt size={15}>{t('Mission ends')}</Txt>
          <Campo v={config.finMision} ph="2028-03-15" num={false} ancho={130} onFin={s => cambiarConfig({ finMision: /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) ? s.trim() : undefined })} />
        </View>
        {r.diasMision != null ? (
          <Txt size={13} color={r.faltanPildoras ? C.aviso : C.t3}>
            {pildora && r.diasPildoras != null
              ? r.faltanPildoras ? t('{p} pills for {m} mission days: {f} short.', { p: r.diasPildoras, m: r.diasMision, f: r.faltanPildoras }) : t('{p} pills for {m} mission days: enough.', { p: r.diasPildoras, m: r.diasMision })
              : t('{m} mission days left.', { m: r.diasMision })}
          </Txt>
        ) : null}
      </Cel>

      {/* controles que pide la NASA */}
      <Seccion t={t('Checks NASA asks for')} />
      <Cel style={{ padding: 16, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}><Txt size={15}>{t('Neck-vein ultrasound')}</Txt><Txt size={12.5} color={C.t3}>{t('Last scan of the jugular vein')}</Txt></View>
          <Campo v={config.ecoYugular} ph="2026-11-02" num={false} ancho={130} onFin={x => cambiarConfig({ ecoYugular: /^\d{4}-\d{2}-\d{2}$/.test(x.trim()) ? x.trim() : undefined })} />
        </View>
      </Cel>

      {/* configuración */}
      <Seccion t={t('How you manage it')} />
      <Cel style={{ padding: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {([['seguir', 'Track my cycle'], ['suprimir', 'Suppress my period']] as [Modo, string][]).map(([k, txt]) => <Chip key={k} on={config.modo === k} t={t(txt)} onPress={() => cambiarConfig({ modo: k })} />)}
        </View>
        {config.modo === 'suprimir' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {METODOS.map(m => <Chip key={m.k} on={config.metodo === m.k} t={t(m.t)} col={C.lila} onPress={() => cambiarConfig({ metodo: m.k })} />)}
          </View>
        ) : null}
        {pildora ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}><Txt size={15}>{t('Daily pill reminder')}</Txt><Txt size={12.5} color={C.t3}>{t('A quiet notification at the same time every day')}</Txt></View>
            <Campo v={config.horaPildora} ph="21:00" num={false} ancho={80} onFin={s => { if (/^\d{1,2}:\d{2}$/.test(s.trim())) cambiarConfig({ horaPildora: s.trim() }); }} />
            <View style={{ width: 10 }} />
            <Interruptor on={config.avisoPildora} label={t('Daily pill reminder')} onChange={v => cambiarConfig({ avisoPildora: v })} />
          </View>
        ) : null}
      </Cel>

      {/* privacidad */}
      <Seccion t={t('Who sees this')} />
      <Cel style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {([['nada', 'Only me'], ['resumen', 'Summary to the flight surgeon']] as [Compartir, string][]).map(([k, txt]) => <Chip key={k} on={config.compartir === k} t={t(txt)} col={C.nova} onPress={() => cambiarConfig({ compartir: k })} />)}
        </View>
        <Txt size={13} lh={18} color={C.t3}>
          {config.compartir === 'nada'
            ? t('Everything stays on this phone. The crew never sees it, and Nova on the ship does not either.')
            : t('Once a day, only a summary (method, days with breakthrough bleeding, pills taken, supplies and care signals) goes into the flight surgeon’s report. Never your daily log, and never to the crew screen.')}
        </Txt>
        {envio ? <Txt size={12.5} color={C.t2}>{envio}</Txt> : null}
      </Cel>

      {/* evidencia */}
      <Seccion t={t('What the evidence says')} />
      {EVIDENCIA.map(e => (
        <Cel key={e.t} style={{ padding: 16, marginBottom: 8 }}>
          <Txt size={14.5} lh={21}>{t(e.t)}</Txt>
          <Txt size={12} color={C.lila} style={{ marginTop: 8 }}>{e.f}</Txt>
        </Cel>
      ))}
      <Txt size={12.5} color={C.t3} lh={18} style={{ textAlign: 'center', marginTop: 10, paddingHorizontal: 10 }}>{t('Nova is not a medical device. Care signals point you to the flight surgeon; they are not a diagnosis.')}</Txt>
    </Pantalla>
  );
}
