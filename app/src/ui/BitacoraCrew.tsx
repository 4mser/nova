/* Bitácora de la crew: el registro del equipo, como el de una misión. Cada entrada tiene autor, hora y tipo
   (nota · avance · problema · decisión). Se escribe arriba, se lee por día, se filtra por tipo y llega en tiempo real
   (y como aviso push a los demás). Tus entradas se borran manteniéndolas apretadas. NOVA también puede escribir aquí,
   y los viernes deja el resumen de la semana. Las notas de voz llegan con su transcripción; todo se puede buscar. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { router } from 'expo-router';
import { borrarBitacora, buscarBitacora, escribirBitacora, leerJson, useBitacora, type Acta, type EntradaCrew, type Kudos, type Retro, type TipoBitacora } from '../cuenta/datos';
import { useSesion, type Crew } from '../cuenta/sesion';
import { nombreDia } from '../engine/diario';
import { useIdioma } from '../i18n';
import { useAhora } from './ahora';
import { AvatarMiembro } from './Crew';
import { CuerpoStandup, TarjetaStandup } from './Standup';
import { GrabadorNota, ReproductorNota } from './NotaVoz';
import { leerStandup } from '../cuenta/standup';
import { C, Cel, F, Txt } from './tema';

export const TIPOS: { k: TipoBitacora; t: string; icono: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { k: 'nota', t: 'Note', icono: 'document-text-outline', color: C.t2 },
  { k: 'avance', t: 'Progress', icono: 'trending-up', color: C.ok },
  { k: 'problema', t: 'Issue', icono: 'alert-circle-outline', color: C.aviso },
  { k: 'decision', t: 'Decision', icono: 'git-commit-outline', color: C.lila },
];
// el standup tiene su propio flujo (/standup); en el registro se muestra con su color, pero no se elige arriba
const STANDUP = { k: 'standup' as TipoBitacora, t: 'Standup', icono: 'chatbubbles-outline' as keyof typeof Ionicons.glyphMap, color: C.nova };
const RESUMEN = { k: 'resumen' as TipoBitacora, t: 'Weekly summary', icono: 'sparkles-outline' as keyof typeof Ionicons.glyphMap, color: C.nova };
const ESPECIALES: Record<string, { k: TipoBitacora; t: string; icono: keyof typeof Ionicons.glyphMap; color: string }> = {
  standup: STANDUP, resumen: RESUMEN,
  retro: { k: 'retro', t: 'Retro', icono: 'repeat-outline', color: C.aviso },
  kudos: { k: 'kudos', t: 'Kudos entry', icono: 'heart-outline', color: C.alerta },
  acta: { k: 'acta', t: 'Meeting notes', icono: 'reader-outline', color: C.lila },
};
const deTipo = (k: TipoBitacora) => ESPECIALES[k] ?? TIPOS.find(x => x.k === k) ?? TIPOS[0];

/** accesos a lo que tiene su propia pantalla: acta de reunión, retro de la semana, reconocer a alguien */
function AccionesEquipo() {
  const { t } = useIdioma();
  const a = (k: string, icono: keyof typeof Ionicons.glyphMap, color: string, ir: '/acta' | '/retro' | '/kudos') => (
    <Pressable key={k} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push(ir); }} accessibilityRole="button"
      style={({ pressed }) => ({ flex: 1, height: 44, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, opacity: pressed ? 0.7 : 1 })}>
      <Ionicons name={icono} size={15} color={color} />
      <Txt f="m" size={13}>{k}</Txt>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
      {a(t('Meeting'), 'reader-outline', C.lila, '/acta')}
      {a(t('Retro'), 'repeat-outline', C.aviso, '/retro')}
      {a(t('Kudos'), 'heart-outline', C.alerta, '/kudos')}
    </View>
  );
}

export function BitacoraCrew({ crew }: { crew: Crew }) {
  const tr = useIdioma(), { t } = tr, { usuario } = useSesion();
  const { datos, cargando } = useBitacora(crew.id);
  const [tipo, setTipo] = useState<TipoBitacora>('nota'), [texto, setTexto] = useState(''), [enviando, setEnviando] = useState(false);
  const [filtro, setFiltro] = useState<TipoBitacora | null>(null), [error, setError] = useState<string | null>(null), [grabando, setGrabando] = useState(false);
  const enviar = async () => {
    const tx = texto.trim();
    if (!tx || enviando) return;
    setEnviando(true); setError(null);
    try { await escribirBitacora(crew.id, tx, tipo); setTexto(''); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }
    catch (e) { setError(t((e as Error).message)); }
    finally { setEnviando(false); }
  };
  const visibles = useMemo(() => (datos ?? []).filter(e => !filtro || e.tipo === filtro), [datos, filtro]);
  const porDia = useMemo(() => {
    const m = new Map<string, EntradaCrew[]>();
    for (const e of visibles) { const k = new Date(e.ts).toDateString(); m.set(k, [...(m.get(k) ?? []), e]); }
    return [...m.values()];
  }, [visibles]);
  const t0 = deTipo(tipo);
  // búsqueda en toda la bitácora (en el servidor: también lo que ya no está cargado)
  const [q, setQ] = useState(''), [res, setRes] = useState<{ q: string; l: EntradaCrew[] } | null>(null);
  const qLimpio = q.trim();
  useEffect(() => {
    if (qLimpio.length < 2) return;
    const id = setTimeout(() => { buscarBitacora(crew.id, qLimpio).then(l => setRes({ q: qLimpio, l }), () => setRes({ q: qLimpio, l: [] })); }, 350);
    return () => clearTimeout(id);
  }, [qLimpio, crew.id]);
  const buscando = qLimpio.length >= 2, resultados = buscando && res?.q === qLimpio ? res.l : null;

  return (
    <View>
      <TarjetaStandup crew={crew} />
      <View style={{ height: 10 }} />
      <AccionesEquipo />
      {/* escribir */}
      <Cel style={{ padding: 12, gap: 10 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
          {TIPOS.map(x => {
            const on = x.k === tipo;
            return (
              <Pressable key={x.k} onPress={() => { Haptics.selectionAsync().catch(() => {}); setTipo(x.k); }} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, flexDirection: 'row', gap: 5, alignItems: 'center', borderWidth: 1, borderColor: on ? x.color : C.l2, backgroundColor: on ? `${x.color}1f` : 'transparent' }}>
                <Ionicons name={x.icono} size={13} color={on ? x.color : C.t3} />
                <Txt f="m" size={12.5} color={on ? x.color : C.t3}>{t(x.t)}</Txt>
              </Pressable>
            );
          })}
        </ScrollView>
        {grabando ? <GrabadorNota crew={crew.id} onListo={() => setGrabando(false)} onCancelar={() => setGrabando(false)} /> : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <TextInput value={texto} onChangeText={setTexto} multiline maxLength={2000} placeholder={t('What happened, for the {crew} log…', { crew: crew.nombre })} placeholderTextColor={C.t3}
            style={{ flex: 1, minHeight: 46, maxHeight: 160, borderRadius: 16, backgroundColor: C.s2, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, color: C.t1, fontFamily: F.r, fontSize: 15.5, textAlignVertical: 'top' }} />
          {/* sin texto, el botón graba una nota de voz */}
          <Pressable onPress={texto.trim() ? enviar : () => setGrabando(true)} disabled={enviando} accessibilityRole="button" accessibilityLabel={texto.trim() ? t('Post to the log') : t('Record a voice note')}
            style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: t0.k === 'nota' ? C.nova : t0.color, alignItems: 'center', justifyContent: 'center' }}>
            {enviando ? <ActivityIndicator color={C.tinta} /> : <Ionicons name={texto.trim() ? 'arrow-up' : 'mic'} size={20} color={C.tinta} />}
          </Pressable>
        </View>
        )}
        {error ? <Txt size={13} color={C.alerta}>{error}</Txt> : null}
      </Cel>

      {/* buscar */}
      {(datos ?? []).length > 3 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, height: 42, paddingHorizontal: 14, borderRadius: 21, backgroundColor: C.s1, borderWidth: 1, borderColor: buscando ? C.nova : C.l1 }}>
          <Ionicons name="search" size={16} color={buscando ? C.nova : C.t3} />
          <TextInput value={q} onChangeText={setQ} placeholder={t('Search the log, voice notes included')} placeholderTextColor={C.t3} returnKeyType="search" autoCorrect={false}
            style={{ flex: 1, color: C.t1, fontFamily: F.r, fontSize: 15, paddingVertical: 0 }} />
          {q ? <Pressable onPress={() => setQ('')} hitSlop={10} accessibilityLabel={t('Clear search')}><Ionicons name="close-circle" size={17} color={C.t3} /></Pressable> : null}
        </View>
      ) : null}

      {buscando ? (
        <View style={{ marginTop: 14, gap: 8 }}>
          {!resultados ? <ActivityIndicator color={C.nova} style={{ marginTop: 10 }} /> : (
            <>
              <Txt f="m" size={13} color={C.t2} style={{ paddingHorizontal: 4 }}>{resultados.length ? tr.tp(resultados.length, '{n} result', '{n} results') : t('Nothing found for «{q}»', { q: qLimpio })}</Txt>
              {resultados.map(e => <FilaEntrada key={e.id} e={e} crew={crew} mia={e.mia ?? e.usuario === usuario?.id} conFecha />)}
            </>
          )}
        </View>
      ) : null}

      {/* filtros */}
      {!buscando && (datos ?? []).length > 3 ? (
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
          {TIPOS.map(x => {
            const n = (datos ?? []).filter(e => e.tipo === x.k).length, on = filtro === x.k;
            if (!n) return null;
            return (
              <Pressable key={x.k} onPress={() => setFiltro(on ? null : x.k)} style={{ height: 30, paddingHorizontal: 11, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: on ? `${x.color}26` : C.s1, borderWidth: 1, borderColor: on ? x.color : C.l1 }}>
                <Txt f="m" size={12} color={on ? x.color : C.t2}>{t(x.t)}</Txt>
                <Txt f="monoR" size={11} color={C.t3}>{n}</Txt>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* registro */}
      {cargando && !datos ? <ActivityIndicator color={C.nova} style={{ marginTop: 24 }} /> : null}
      {datos && !datos.length ? (
        <Txt size={14} lh={20} color={C.t2} style={{ marginTop: 18, paddingHorizontal: 4 }}>{t('The crew log is empty. Write the first entry: what you finished, what is blocking you or what you decided together.')}</Txt>
      ) : null}
      {!buscando && porDia.map(dia => (
        <Animated.View key={dia[0].id} entering={FadeIn.duration(220)} layout={LinearTransition.duration(220)} style={{ marginTop: 18, gap: 8 }}>
          <Txt f="m" size={13} color={C.t2} style={{ paddingHorizontal: 4 }}>{nombreDia(dia[0].ts, tr)}</Txt>
          {dia.map(e => <FilaEntrada key={e.id} e={e} crew={crew} mia={e.mia ?? e.usuario === usuario?.id} />)}
        </Animated.View>
      ))}
    </View>
  );
}

function FilaEntrada({ e, crew, mia, conFecha }: { e: EntradaCrew; crew: Crew; mia: boolean; conFecha?: boolean }) {
  const { t, locale } = useIdioma(), x = deTipo(e.tipo), nova = e.tipo === 'resumen', anonima = e.tipo === 'retro' && !e.usuario;
  const autor = crew.miembros.find(m => m.id === e.usuario);
  const [borrar, setBorrar] = useState(false);
  const hora = conFecha ? new Date(e.ts).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : new Date(e.ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <Pressable onLongPress={() => { if (mia) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); setBorrar(b => !b); } }} delayLongPress={350}>
      <Cel style={{ flexDirection: 'row', gap: 12, padding: 14, borderColor: x.k === 'nota' ? C.l1 : `${x.color}40` }}>
        {nova ? (
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.sigSuave, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="sparkles" size={15} color={C.nova} /></View>
        ) : anonima ? (
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.avisoSuave, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="eye-off-outline" size={15} color={C.aviso} /></View>
        ) : <AvatarMiembro u={autor} size={32} />}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Txt f="s" size={14}>{nova ? 'NOVA' : anonima ? t('Anonymous') : autor?.nombre.split(/\s+/)[0] ?? '—'}</Txt>
            {/* la píldora se achica (con «…») antes de que la hora se salga o salte de línea */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, height: 20, borderRadius: 10, backgroundColor: `${x.color}1f`, flexShrink: 1, minWidth: 0 }}>
              <Ionicons name={x.icono} size={11} color={x.color} />
              <Txt f="m" size={11} color={x.color} numberOfLines={1} style={{ flexShrink: 1 }}>{t(x.t)}</Txt>
            </View>
            <View style={{ flex: 1, minWidth: 4 }} />
            <Txt f="monoR" size={11.5} color={C.t3} numberOfLines={1} style={{ flexShrink: 0 }}>{hora}</Txt>
          </View>
          {e.tipo === 'standup' && leerStandup(e) ? <CuerpoStandup s={leerStandup(e)!} />
            : e.tipo === 'retro' ? <CuerpoRetro e={e} />
            : e.tipo === 'kudos' ? <CuerpoKudos e={e} crew={crew} />
            : e.tipo === 'acta' ? <CuerpoActa e={e} />
            : e.texto ? <Txt size={15} lh={21.5} style={{ marginTop: 5 }}>{e.texto}</Txt> : null}
          {e.audio ? <ReproductorNota audio={e.audio} /> : null}
          {e.audio && e.tipo !== 'acta' ? <Transcripcion e={e} /> : null}
          {borrar ? (
            <Pressable onPress={() => { borrarBitacora(e.id).catch(() => {}); }} style={{ alignSelf: 'flex-start', marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: C.alerta }}>
              <Ionicons name="trash-outline" size={14} color={C.alerta} />
              <Txt f="m" size={13} color={C.alerta}>{t('Delete')}</Txt>
            </Pressable>
          ) : null}
        </View>
      </Cel>
    </Pressable>
  );
}

/** lo que se dijo en la nota de voz (la escribe el servidor al recibirla); 4 líneas, se abre con un toque */
function Transcripcion({ e }: { e: EntradaCrew }) {
  const { t } = useIdioma(), [abierta, setAbierta] = useState(false), ahora = useAhora(20e3);
  const tx = e.audio?.transcripcion;
  if (!tx) return e.ts > ahora - 3 * 60e3 ? <Txt size={12.5} color={C.t3} style={{ marginTop: 8 }}>{t('Transcribing…')}</Txt> : null;
  if (tx === '(sin voz)') return null;
  return (
    <Pressable onPress={() => setAbierta(a => !a)} accessibilityRole="button" accessibilityLabel={t('Transcription')} style={{ marginTop: 10, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: C.l2 }}>
      <Txt size={14} lh={20} color={C.t2} numberOfLines={abierta ? undefined : 4}>{tx}</Txt>
    </Pressable>
  );
}

function CuerpoRetro({ e }: { e: EntradaCrew }) {
  const { t } = useIdioma(), r = leerJson<Retro>(e);
  if (!r) return null;
  const fila = (icono: keyof typeof Ionicons.glyphMap, color: string, titulo: string, v: string) => v ? (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
      <Ionicons name={icono} size={14} color={color} style={{ marginTop: 3 }} />
      <Txt size={14.5} lh={20} style={{ flex: 1 }}><Txt f="m" size={14.5} color={color}>{titulo} </Txt>{v}</Txt>
    </View>
  ) : null;
  return (
    <View style={{ marginTop: 2 }}>
      {fila('thumbs-up-outline', C.ok, t('Worked:'), r.bien)}
      {fila('construct-outline', C.aviso, t('Improve:'), r.mejorar)}
      {fila('flask-outline', C.nova, t('Try:'), r.probar)}
    </View>
  );
}
function CuerpoKudos({ e, crew }: { e: EntradaCrew; crew: Crew }) {
  const k = leerJson<Kudos>(e);
  if (!k) return null;
  const para = k.para.map(id => crew.miembros.find(m => m.id === id)).filter(Boolean);
  return (
    <View style={{ marginTop: 6, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Ionicons name="arrow-forward" size={13} color={C.alerta} />
        {para.map(m => <View key={m!.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingRight: 8, height: 24, borderRadius: 12, backgroundColor: 'rgba(236,106,168,0.12)' }}><AvatarMiembro u={m} size={24} /><Txt f="m" size={12.5}>{m!.nombre.split(/\s+/)[0]}</Txt></View>)}
      </View>
      <Txt size={15} lh={21.5}>{k.texto}</Txt>
    </View>
  );
}
function CuerpoActa({ e }: { e: EntradaCrew }) {
  const { t, tp } = useIdioma(), a = leerJson<Acta>(e);
  if (!a) return null;
  if (a.estado === 'procesando') return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}><ActivityIndicator size="small" color={C.lila} /><Txt size={14} color={C.t2}>{t('Nova is writing the meeting notes…')}</Txt></View>;
  if (a.estado === 'error') return <Txt size={14} color={C.alerta} style={{ marginTop: 6 }}>{t('Nova could not process this meeting. Try again with notes or a clearer recording.')}</Txt>;
  const pendientes = (a.tareas ?? []).filter(x => !x.creada).length;
  return (
    <Pressable onPress={() => router.push({ pathname: '/acta', params: { id: e.id } })} accessibilityRole="button" style={{ marginTop: 5, gap: 6 }}>
      <Txt f="s" size={15.5}>{a.titulo}</Txt>
      {a.resumen ? <Txt size={14.5} lh={20.5} color={C.t2} numberOfLines={3}>{a.resumen}</Txt> : null}
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <Txt f="m" size={12.5} color={C.lila} numberOfLines={1}>{tp(a.decisiones?.length ?? 0, '{n} decision', '{n} decisions')}</Txt>
        <Txt f="m" size={12.5} color={pendientes ? C.aviso : C.ok} numberOfLines={1} style={{ flexShrink: 1 }}>{pendientes ? tp(pendientes, '{n} to create', '{n} to create') : tp(a.tareas?.length ?? 0, '{n} task', '{n} tasks')}</Txt>
        <View style={{ flex: 1 }} />
        <Ionicons name="chevron-forward" size={15} color={C.nova} />
      </View>
    </Pressable>
  );
}
