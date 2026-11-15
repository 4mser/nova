/* Emergencia en el teléfono (modo misión): las mismas guías aprobadas de la nave (src/emergencia/protocolos.json,
   copia de nova-pc/tripulacion/ui/protocolos.json), sin internet y sin la consola. Un paso a la vez, en grande, con
   sí/no, cronómetro en las esperas, metrónomo por vibración para las compresiones y los signos en vivo de la persona
   si la nave está enlazada. Habla con la voz de NOVA de la nave (Kokoro); sin enlace, en silencio (nunca la voz robótica
   del teléfono). Cada paso queda en la bitácora de la nave para el cirujano de vuelo. */
import { Ionicons } from '@expo/vector-icons';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { leerNave } from '../cuenta/nave';
import { useNaveEstado, type TripNave } from '../cuenta/naveEstado';
import PROT from '../emergencia/protocolos.json';
import { useIdioma } from '../i18n';
import { C, Txt } from '../ui/tema';

type Paso = { id: string; tipo: 'pregunta' | 'accion' | 'espera' | 'fin'; texto: string; texto_es?: string; si?: string; no?: string; sig?: string; seg?: number;
  si_recupera?: string; no_recupera?: string; recupera?: Record<string, [number | null, number | null]>; grave?: boolean; metronomo?: number; mira?: string[]; medir?: string };
type Protocolo = { id: string; titulo: string; titulo_es?: string; fuente?: string; fuentes?: { id: string; pagina: number }[]; guia?: Paso[] };
type Persona = { id: string; corto: string; pronombre?: string };
type Entrada = { t: number; texto: string; grave?: boolean };

const PROTOCOLOS = (PROT as { protocolos: Protocolo[] }).protocolos.filter(p => p.guia?.length);
const ICONO: Record<string, keyof typeof Ionicons.glyphMap> = {
  paro_cardiaco: 'heart-dislike-outline', desmayo: 'body-outline', atragantamiento: 'hand-left-outline', anafilaxia: 'flower-outline',
  hemorragia: 'water-outline', convulsion: 'pulse-outline', descompresion: 'planet-outline', hipoglucemia: 'nutrition-outline',
  oxigeno_bajo: 'cloud-outline', fiebre: 'thermometer-outline',
};
const NOMBRES: Record<string, string> = { pulso: 'Heart rate', spo2: 'Oxygen', pa_sis: 'Blood pressure', fr: 'Breathing', glucosa: 'Blood sugar', temp: 'Temperature' };
const UNIDAD: Record<string, string> = { pulso: 'bpm', spo2: '%', pa_sis: 'mmHg', fr: '/min', glucosa: 'mg/dL', temp: '°C' };

const pron = (p?: string) => p?.startsWith('she') ? { el: 'she', su: 'her', lo: 'her' } : p?.startsWith('he') ? { el: 'he', su: 'his', lo: 'him' } : { el: 'they', su: 'their', lo: 'them' };
function rellenar(t: string, p: Persona) {
  const x = pron(p.pronombre);
  // en español los adjetivos llevan género: sujet{o} → sujeta / sujeto
  const o = p.pronombre?.startsWith('she') ? 'a' : p.pronombre?.startsWith('he') ? 'o' : 'e';
  return t.replace(/\{Nombre\}|\{nombre\}/g, p.corto).replace(/\{o\}/g, o).replace(/\{su\}/g, x.su).replace(/\{el\}/g, x.el).replace(/\{lo\}/g, x.lo)
    .replace(/(^|[.?!]\s+)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}
const ASIENTOS: Persona[] = ['T1', 'T2', 'T3', 'T4'].map(id => ({ id, corto: id }));
/** la hora, leída fuera del render (solo desde los botones y los temporizadores) */
const reloj = () => Date.now();
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* voz de NOVA de la nave (Kokoro) */
let reproductor: AudioPlayer | null = null, turnoVoz = 0;
async function decirNave(texto: string, idioma: 'en' | 'es' = 'en') {
  const { url } = leerNave(), yo = ++turnoVoz;
  try { reproductor?.remove(); } catch {} reproductor = null;
  if (!url) return;
  try {
    const r = await fetch(`${url}/v1/decir`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto, idioma }) });
    if (!r.ok || yo !== turnoVoz) return;
    const f = new File(Paths.cache, `emergencia-${yo % 4}.wav`);
    f.write(new Uint8Array(await r.arrayBuffer()));
    await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    if (yo !== turnoVoz) return;
    reproductor = createAudioPlayer({ uri: f.uri });
    reproductor.play();
  } catch {}
}
function callarNave() { turnoVoz++; try { reproductor?.remove(); } catch {} reproductor = null; }

function bitacoraNave(sesion: string, trip: string, protocolo: string, texto: string, grave?: boolean) {
  const { url } = leerNave();
  if (!url) return;
  fetch(`${url}/v1/bitacora`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tipo: 'emergencias', datos: { sesion, trip, protocolo, t: Date.now(), texto, grave: !!grave, desde: 'telefono' } }) }).catch(() => {});
}

export default function Emergencia() {
  const ins = useSafeAreaInsets(), { t, idioma } = useIdioma();
  const enIdioma = (p: Paso) => (idioma === 'es' && p.texto_es ? p.texto_es : p.texto);
  const { estado, tripulacion } = useNaveEstado();
  // la tripulación (nombres y pronombres) desde la nave; sin enlace, los asientos
  const crew: Persona[] = tripulacion.length ? tripulacion : ASIENTOS;
  // si se abrió desde «Ayudar a …», queda marcada esa persona; si no, tu propio asiento
  const { trip } = useLocalSearchParams<{ trip?: string }>();
  const [quien, setQuien] = useState(() => Math.max(0, Number((/^T[1-4]$/.test(trip ?? '') ? trip! : leerNave().asiento).slice(1)) - 1));
  const [prot, setProt] = useState<Protocolo | null>(null);
  const [pasoId, setPasoId] = useState('');
  const [log, setLog] = useState<Entrada[]>([]);
  const [inicio, setInicio] = useState(0);
  const [esperaDesde, setEsperaDesde] = useState(0);
  const [ahora, setAhora] = useState(() => Date.now());
  const sesion = useRef('');

  useEffect(() => { const id = setInterval(() => setAhora(Date.now()), 500); return () => clearInterval(id); }, []);
  useEffect(() => () => callarNave(), []);

  const persona = crew[quien] ?? { id: `T${quien + 1}`, corto: `T${quien + 1}` };
  const paso = prot?.guia?.find(p => p.id === pasoId);
  const tr: TripNave | undefined = estado?.trip[quien];

  // metrónomo por vibración en los pasos de compresiones
  const latido = useSharedValue(1);
  useEffect(() => {
    if (!paso?.metronomo) return;
    const id = setInterval(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}); latido.value = withSequence(withTiming(1.35, { duration: 60 }), withTiming(1, { duration: 300 })); }, 60000 / paso.metronomo);
    return () => clearInterval(id);
  }, [paso?.metronomo, latido]);
  const estiloLatido = useAnimatedStyle(() => ({ transform: [{ scale: latido.value }] }));

  const anotar = (texto: string, grave?: boolean) => {
    setLog(l => [{ t: reloj(), texto, grave }, ...l]);
    if (prot) bitacoraNave(sesion.current, persona.id, prot.id, texto, grave);
  };

  function ir(id: string, porque?: string) {
    if (!prot) return;
    const p = prot.guia!.find(x => x.id === id);
    if (!p) return;
    setPasoId(id);
    if (p.tipo === 'espera') setEsperaDesde(reloj());
    const texto = rellenar(p.texto, persona), visto = rellenar(enIdioma(p), persona);
    setLog(l => [{ t: reloj(), texto: (porque ? `${porque} → ` : '') + visto, grave: p.grave }, ...l]);
    // la bitácora del cirujano de vuelo queda en inglés
    bitacoraNave(sesion.current, persona.id, prot.id, (porque ? `${porque} → ` : '') + texto, p.grave);
    decirNave(visto, idioma === 'es' ? 'es' : 'en');
    if (p.grave) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }

  function empezar(p: Protocolo) {
    sesion.current = `${persona.id}-${p.id}-${reloj()}`;
    setProt(p); setInicio(reloj()); setLog([]);
    bitacoraNave(sesion.current, persona.id, p.id, `Guide started on the phone: ${p.titulo}`);
    setTimeout(() => {
      const primero = p.guia![0];
      setPasoId(primero.id);
      if (primero.tipo === 'espera') setEsperaDesde(reloj());
      const texto = rellenar(primero.texto, persona), visto = rellenar(enIdioma(primero), persona);
      setLog([{ t: reloj(), texto: visto, grave: primero.grave }]);
      bitacoraNave(sesion.current, persona.id, p.id, texto, primero.grave);
      decirNave(visto, idioma === 'es' ? 'es' : 'en');
    }, 0);
  }

  /* ¿se recuperó? con los valores de la nave; sin enlace la tripulación lo dice */
  function evaluar(p: Paso): { ok: boolean | null; resumen: string } {
    if (!p.recupera || !Object.keys(p.recupera).length) return { ok: true, resumen: '' };
    if (!tr) return { ok: null, resumen: '' };
    const ok = Object.entries(p.recupera).every(([k, [mn, mx]]) => {
      const v = (tr as unknown as Record<string, number>)[k];
      return tr.edades[k] > 0 && (mn == null || v >= mn) && (mx == null || v < mx);
    });
    const resumen = Object.keys(p.recupera).map(k => k === 'pa_sis' ? `BP ${Math.round(tr.pa_sis)}/${Math.round(tr.pa_dia)}` : `${NOMBRES[k] ?? k} ${Math.round((tr as unknown as Record<string, number>)[k])}`).join(', ');
    return { ok, resumen };
  }

  function responder(r: boolean) {
    if (!paso) return;
    Haptics.selectionAsync().catch(() => {});
    if (paso.tipo === 'pregunta') { anotar(`Answer: ${r ? 'yes' : 'no'}`); ir(r ? paso.si! : paso.no!); }
    else if (paso.tipo === 'accion') { anotar('Done'); ir(paso.sig!); }
    else if (paso.tipo === 'espera') {
      const e = evaluar(paso);
      const ok = e.ok ?? r; // sin datos de la nave, el botón que tocó la tripulación
      ir(ok ? paso.si_recupera! : paso.no_recupera!, e.resumen ? `Measured: ${e.resumen}` : ok ? 'Crew: back in range' : 'Crew: still out of range');
    } else { callarNave(); router.back(); }
  }

  const cerrar = () => { callarNave(); if (prot) bitacoraNave(sesion.current, persona.id, prot.id, 'Guide closed'); router.back(); };

  // ---------------------------------------------------------------- elegir
  if (!prot || !paso) {
    return (
      <View style={{ flex: 1, backgroundColor: '#07090d', paddingTop: ins.top + 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: C.alerta }} />
            <Txt f="s" size={13} color={C.alerta} ls={0.6}>{t('EMERGENCY GUIDE')}</Txt>
          </View>
          <Pressable onPress={cerrar} hitSlop={12} accessibilityLabel={t('Close')} style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={20} color={C.t2} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: ins.bottom + 30 }}>
          <Txt f="s" size={28} ls={-1} lh={32}>{t('Who needs help?')}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {crew.map((p, i) => ('vacio' in p && p.vacio ? null :
              <Pressable key={p.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setQuien(i); }} accessibilityRole="radio" accessibilityState={{ checked: quien === i }}
                style={{ height: 46, paddingHorizontal: 18, borderRadius: 23, justifyContent: 'center', backgroundColor: quien === i ? C.t1 : 'transparent', borderWidth: 1, borderColor: quien === i ? C.t1 : C.l2 }}>
                <Txt f="s" size={15} color={quien === i ? C.bg : C.t2}>{p.corto}</Txt>
              </Pressable>
            ))}
          </View>
          <Txt f="s" size={28} ls={-1} lh={32} style={{ marginTop: 28 }}>{t('What is happening?')}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {PROTOCOLOS.map(p => {
              const critico = p.id === 'paro_cardiaco' || p.id === 'atragantamiento' || p.id === 'anafilaxia' || p.id === 'hemorragia';
              return (
                <Pressable key={p.id} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); empezar(p); }} accessibilityRole="button"
                  style={({ pressed }) => ({ width: '48.6%', minHeight: 96, padding: 14, borderRadius: 20, justifyContent: 'space-between', backgroundColor: critico ? '#1c0b15' : C.s1, borderWidth: 1, borderColor: critico ? 'rgba(236,106,168,0.45)' : C.l1, opacity: pressed ? 0.7 : 1 })}>
                  <Ionicons name={ICONO[p.id] ?? 'medkit-outline'} size={24} color={critico ? C.alerta : C.t2} />
                  <Txt f="m" size={15} lh={19} color={critico ? '#ffd3e7' : C.t1}>{idioma === 'es' && p.titulo_es ? p.titulo_es : p.titulo}</Txt>
                </Pressable>
              );
            })}
          </View>
          <Txt size={12.5} lh={18} color={C.t3} style={{ marginTop: 22 }}>{t('Approved onboard protocols · demo, pending flight surgeon review. Works without the ship or the internet. Nova guides, the crew decides.')}</Txt>
        </ScrollView>
      </View>
    );
  }

  // ---------------------------------------------------------------- guía
  const n = log.filter(e => !e.texto.startsWith('Answer') && e.texto !== 'Done').length;
  const quedan = paso.tipo === 'espera' ? Math.max(0, (paso.seg ?? 0) - (ahora - esperaDesde) / 1000) : 0;
  const eval_ = paso.tipo === 'espera' ? evaluar(paso) : null;
  const signos = [...new Set(['pulso', 'spo2', 'pa_sis', 'fr', ...(paso.mira ?? [])])].filter(k => k !== 'pa_dia' && NOMBRES[k]).slice(0, 4);
  return (
    <View style={{ flex: 1, backgroundColor: paso.grave ? '#12060c' : '#07090d', paddingTop: ins.top + 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Txt f="s" size={13} color={C.alerta} ls={0.6}>{(idioma === 'es' && prot.titulo_es ? prot.titulo_es : prot.titulo).toUpperCase()}</Txt>
          <Txt size={13} color={C.t2} style={{ marginTop: 2 }}>{persona.corto} · {mmss((ahora - inicio) / 1000)}</Txt>
        </View>
        <Pressable onPress={cerrar} hitSlop={12} accessibilityLabel={t('Close')} style={{ height: 38, paddingHorizontal: 16, borderRadius: 19, borderWidth: 1, borderColor: C.l2, justifyContent: 'center' }}>
          <Txt f="m" size={14} color={C.t2}>{t('Close')}</Txt>
        </Pressable>
      </View>

      {tr ? (
        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 20, marginTop: 14 }}>
          {signos.map(k => {
            const tiene = tr.edades[k] > 0, nv = tr.niveles[k], col = nv === 'aviso_tierra' ? C.alerta : nv === 'atencion' ? C.aviso : C.t1;
            const v = !tiene ? '—' : k === 'pa_sis' ? `${Math.round(tr.pa_sis)}/${Math.round(tr.pa_dia)}` : String(Math.round((tr as unknown as Record<string, number>)[k]));
            return (
              <View key={k} style={{ flex: 1, padding: 10, borderRadius: 16, backgroundColor: C.s1, borderWidth: 1, borderColor: (paso.mira ?? []).includes(k) ? 'rgba(143,230,245,0.35)' : C.l1 }}>
                <Txt size={11.5} color={C.t2}>{t(NOMBRES[k])}</Txt>
                <Txt f="l" size={k === 'pa_sis' ? 20 : 26} ls={-1} color={col} style={{ marginTop: 2 }}>{v}</Txt>
                <Txt size={10.5} color={C.t3}>{UNIDAD[k]}</Txt>
              </View>
            );
          })}
        </View>
      ) : null}

      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 20, paddingTop: 26, paddingBottom: ins.bottom + 24 }}>
        <Txt f="s" size={12.5} color={C.t3} ls={0.6}>{paso.tipo === 'fin' ? (paso.grave ? t('ACT NOW') : t('DONE')) : t('STEP {n}', { n: Math.max(1, n) }).toUpperCase()}</Txt>
        <Txt f="m" size={29} lh={36} ls={-0.8} color={paso.grave ? '#ffd3e7' : C.t1} style={{ marginTop: 10 }}>{rellenar(enIdioma(paso), persona)}</Txt>

        {paso.metronomo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 }}>
            <Animated.View style={[{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.alerta }, estiloLatido]} />
            <Txt f="m" size={16} color="#ffd3e7">{t('{n} / min · push on every pulse you feel', { n: paso.metronomo })}</Txt>
          </View>
        ) : null}

        <View style={{ flex: 1, minHeight: 24 }} />

        {paso.tipo === 'espera' ? (
          <Txt f="l" size={44} ls={-2} style={{ marginBottom: 12 }} color={quedan > 0 ? C.t1 : C.ok}>{quedan > 0 ? mmss(quedan) : t('Now')}</Txt>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {paso.tipo === 'pregunta' ? (<>
            <Boton t={t('Yes')} pri onPress={() => responder(true)} />
            <Boton t={t('No')} onPress={() => responder(false)} />
          </>) : paso.tipo === 'accion' ? <Boton t={t('Done')} pri onPress={() => responder(true)} />
            : paso.tipo === 'espera' ? (eval_?.ok === null && paso.recupera && Object.keys(paso.recupera).length ? (<>
              <Boton t={t('Back in range')} pri onPress={() => responder(true)} />
              <Boton t={t('Still out of range')} onPress={() => responder(false)} />
            </>) : <Boton t={quedan > 0 ? t('Use the live reading') : t('Continue')} pri onPress={() => responder(true)} />)
            : <Boton t={t('Close guide')} pri onPress={() => responder(true)} />}
        </View>

        <Txt size={12} lh={17} color={C.t3} style={{ marginTop: 22 }}>
          {prot.fuente ? `${t('Source')}: ${prot.fuente}` : t('Approved onboard protocol')}{prot.fuentes?.length ? ` · ${t('pages')} ${[...new Set(prot.fuentes.map(f => f.pagina))].join(', ')}` : ''} · {t('demo, pending flight surgeon review')}
        </Txt>
        {log.length > 1 ? (
          <View style={{ marginTop: 18, gap: 6 }}>
            <Txt f="m" size={12.5} color={C.t3}>{t('Log for the flight surgeon')}</Txt>
            {log.slice(0, 5).map(e => (
              <View key={e.t + e.texto} style={{ flexDirection: 'row', gap: 10 }}>
                <Txt f="mono" size={11.5} color={C.t3}>{new Date(e.t).toTimeString().slice(0, 8)}</Txt>
                <Txt size={13} lh={18} color={e.grave ? '#ffd3e7' : C.t2} style={{ flex: 1 }}>{e.texto}</Txt>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Boton({ t, pri, onPress }: { t: string; pri?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ flex: 1, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: pri ? C.t1 : 'transparent', borderWidth: 1, borderColor: pri ? C.t1 : C.l2, opacity: pressed ? 0.75 : 1 })}>
      <Txt f="s" size={18} color={pri ? C.bg : C.t1}>{t}</Txt>
    </Pressable>
  );
}
