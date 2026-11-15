/* Sesión de foco (o de aprendizaje) con NOVA: eliges cuánto y en qué, y NOVA se queda contigo con la cuenta.
   El fin se agenda como notificación, así que avisa aunque cierres la app. Las sesiones de 5 min o más se guardan. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { enviarMiDia } from '../cuenta/compartirDia';
import { cambiarTarea, useTareas, aCargo } from '../cuenta/datos';
import { iniciarFoco } from '../cuenta/momento';
import { useSesion } from '../cuenta/sesion';
import { fechaDe } from '../engine/diario';
import { minutosDe, pausar, seguir, terminar, useFoco, type EnCurso } from '../engine/foco';
import { abrirMusica, elegirMusica, guardarPropia, PLAYLISTS, useMusica } from '../engine/musica';
import { crearTarjeta } from '../engine/repaso';
import { useIdioma } from '../i18n';
import { volver } from '../ui/volver';
import { NovaHeroe } from '../nova/NovaHeroe';
import { NovaOrb } from '../nova/NovaOrb';
import { Anillos } from '../ui/Graficos';
import { C, Cel, F, Txt } from '../ui/tema';

const MINUTOS = [15, 25, 50, 90];
type Fin = { min: number; que?: string; tipo: EnCurso['tipo'] };

export default function Foco() {
  const { enCurso } = useFoco(), ins = useSafeAreaInsets();
  const [fin, setFin] = useState<Fin | null>(null);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: ins.top + 10, paddingBottom: ins.bottom + 16 }}>
      {enCurso ? <EnMarcha s={enCurso} alTerminar={setFin} /> : fin ? <Hecho fin={fin} /> : <Elegir />}
    </View>
  );
}

function Cerrar() {
  const { t } = useIdioma();
  return (
    <Pressable onPress={() => volver()} hitSlop={10} accessibilityLabel={t('Close')} style={{ alignSelf: 'flex-end', marginRight: 16 }}>
      <Ionicons name="chevron-down" size={28} color={C.t2} />
    </Pressable>
  );
}

function Elegir() {
  const { t } = useIdioma(), { datos } = useTareas(), { usuario } = useSesion();
  // desde un hueco de la agenda llega ?min= con la duración sugerida
  const { min: minParam } = useLocalSearchParams<{ min?: string }>();
  const [tipo, setTipo] = useState<EnCurso['tipo']>('foco'), [min, setMin] = useState(() => (MINUTOS.includes(Number(minParam)) ? Number(minParam) : 25)), [que, setQue] = useState('');
  const pendientes = (datos ?? []).filter(x => !x.hecha && (!x.crew || aCargo(x).includes(usuario?.id ?? ''))).slice(0, 4);
  const [ahora] = useState(() => Date.now()), hoyMin = minutosDe(fechaDe(ahora));
  const comenzar = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    iniciarFoco(min, tipo, que.trim() || undefined);
    // la música parte un instante después, para que se vea el temporizador antes de saltar a Spotify
    setTimeout(abrirMusica, 600);
  };

  return (
    <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ paddingHorizontal: 20 }} keyboardShouldPersistTaps="handled">
      <Cerrar />
      <View style={{ alignItems: 'center' }}><NovaOrb size={170} orbes={2} expr="pensativa" /></View>
      <Txt f="s" size={28} ls={-1} style={{ textAlign: 'center' }}>{t(tipo === 'foco' ? 'Focus with Nova' : 'Learn with Nova')}</Txt>
      <Txt size={14.5} color={C.t2} style={{ textAlign: 'center', marginTop: 4 }}>{hoyMin ? t('{n} min today so far', { n: hoyMin }) : t('One thing at a time. I keep the time.')}</Txt>

      <Cel style={{ padding: 6, flexDirection: 'row', gap: 6, marginTop: 22 }}>
        {(['foco', 'aprender'] as const).map(k => (
          <Pressable key={k} onPress={() => setTipo(k)} style={{ flex: 1, height: 44, borderRadius: 18, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: tipo === k ? C.nova : 'transparent' }}>
            <Ionicons name={k === 'foco' ? 'timer-outline' : 'school-outline'} size={16} color={tipo === k ? C.tinta : C.t2} />
            <Txt f="s" size={14.5} color={tipo === k ? C.tinta : C.t2}>{t(k === 'foco' ? 'Focus' : 'Learning')}</Txt>
          </Pressable>
        ))}
      </Cel>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {MINUTOS.map(m => (
          <Pressable key={m} onPress={() => { Haptics.selectionAsync().catch(() => {}); setMin(m); }} style={{ flex: 1, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: m === min ? C.sigSuave : C.s1, borderWidth: 1, borderColor: m === min ? C.nova : C.l1 }}>
            <Txt f="l" size={24} ls={-0.8} color={m === min ? C.nova : C.t1}>{m}</Txt>
            <Txt size={11.5} color={C.t3}>min</Txt>
          </Pressable>
        ))}
      </View>

      <MusicaFoco />

      <TextInput value={que} onChangeText={setQue} placeholder={t(tipo === 'foco' ? 'What are you working on?' : 'What are you learning?')} placeholderTextColor={C.t3} maxLength={120}
        style={{ marginTop: 10, height: 52, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, paddingHorizontal: 16, color: C.t1, fontFamily: F.r, fontSize: 15.5 }} />
      {pendientes.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {pendientes.map(x => (
            <Pressable key={x.id} onPress={() => setQue(x.titulo)} style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', borderWidth: 1, borderColor: que === x.titulo ? C.nova : C.l2 }}>
              <Txt size={13} color={que === x.titulo ? C.nova : C.t2} numberOfLines={1}>{x.titulo}</Txt>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Pressable onPress={comenzar} style={({ pressed }) => ({ marginTop: 24, height: 56, borderRadius: 28, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: pressed ? 0.85 : 1, boxShadow: '0 8px 28px -8px rgba(70,200,232,0.6)' })}>
        <Ionicons name="play" size={18} color={C.tinta} />
        <Txt f="s" size={16} color={C.tinta}>{t('Start {n} min', { n: min })}</Txt>
      </Pressable>
    </KeyboardAwareScrollView>
  );
}

function EnMarcha({ s, alTerminar }: { s: EnCurso; alTerminar: (f: Fin) => void }) {
  const { t } = useIdioma(), { width } = useWindowDimensions(), { crews } = useSesion();
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setAhora(Date.now()), 500); return () => clearInterval(id); }, []);
  const ref = s.pausa ?? ahora, resta = Math.max(0, s.fin - ref), total = s.meta * 60e3, v = 1 - resta / total;
  const cerrar = () => {
    const r = terminar();
    if (r?.aviso) Notifications.cancelScheduledNotificationAsync(r.aviso).catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    enviarMiDia(crews.map(c => c.id));
    alTerminar({ min: r?.sesion?.min ?? 0, que: s.que, tipo: s.tipo });
  };
  useEffect(() => { if (resta <= 0 && !s.pausa) cerrar(); });
  const D = Math.min(width - 60, 320);
  const [animo, setAnimo] = useState<string | null>(null);
  const animar = () => {
    const llevo = Math.max(1, Math.round((Math.min(ref, s.fin) - s.ini) / 60e3));
    const frases = [t('{n} min in. Keep going.', { n: llevo }), t('One thing at a time. You are doing it.'), t('Breathe out slowly. Back to it.'), mm > 0 ? t('Only {n} min left.', { n: mm + 1 }) : t('Almost there.')];
    setAnimo(frases[Math.floor(Math.random() * frases.length)]);
    setTimeout(() => setAnimo(null), 3500);
  };
  const mm = Math.floor(resta / 60e3), ss = Math.floor((resta % 60e3) / 1000);
  return (
    <View style={{ flex: 1 }}>
      <Cerrar />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Txt f="m" size={13} color={C.t2}>{t(s.tipo === 'foco' ? 'Focus' : 'Learning')}{s.que ? ` · ${s.que}` : ''}</Txt>
        <View style={{ width: D, height: D, alignItems: 'center', justifyContent: 'center', marginTop: 16 }}>
          <View pointerEvents="none" style={{ position: 'absolute', zIndex: 0 }}><Anillos size={D} anillos={[{ v, col: s.pausa ? C.t3 : C.nova, r: 56, w: 3 }]} /></View>
          {/* la misma NOVA de Hoy: se gira, se estira y se levanta; tocarla te da ánimo con lo que llevas */}
          <View style={{ zIndex: 2, elevation: 2, width: D, height: D, alignItems: 'center', justifyContent: 'center' }}>
            <NovaHeroe base={s.pausa ? 'dormida' : 'pensativa'} size={D * 0.9} alto={D} orbes={0} halo={false} enPaginador={false} alTocar={animar} />
          </View>
        </View>
        <Txt f="l" size={64} ls={-3} style={{ marginTop: 10 }}>{mm}:{String(ss).padStart(2, '0')}</Txt>
        <Txt size={14} color={animo ? C.lila : C.t3}>{animo ?? (s.pausa ? t('Paused') : t('Phone down. I will let you know.'))}</Txt>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20 }}>
        <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); if (s.pausa) seguir(); else pausar(); }} style={{ flex: 1, height: 54, borderRadius: 27, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}>
          <Ionicons name={s.pausa ? 'play' : 'pause'} size={18} color={C.t1} />
          <Txt f="s" size={15.5}>{t(s.pausa ? 'Resume' : 'Pause')}</Txt>
        </Pressable>
        <Pressable onPress={cerrar} style={{ flex: 1, height: 54, borderRadius: 27, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}>
          <Ionicons name="stop" size={16} color={C.t1} />
          <Txt f="s" size={15.5}>{t('Finish')}</Txt>
        </Pressable>
      </View>
    </View>
  );
}

function Hecho({ fin }: { fin: Fin }) {
  const { t } = useIdioma(), { datos } = useTareas();
  const tarea = fin.que ? (datos ?? []).find(x => !x.hecha && x.titulo === fin.que) : undefined;
  const [marcada, setMarcada] = useState(false);
  return (
    <View style={{ flex: 1, paddingHorizontal: 20 }}>
      <Cerrar />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <NovaOrb size={fin.tipo === 'aprender' && fin.min >= 5 ? 130 : 200} orbes={2} expr="feliz" />
        <Txt f="s" size={28} ls={-1} style={{ textAlign: 'center' }}>{fin.min >= 5 ? t('{n} minutes, well done', { n: fin.min }) : t('Short one. It still counts as trying.')}</Txt>
        <Txt size={15} color={C.t2} style={{ textAlign: 'center', marginTop: 6 }}>{t('Stand up, drink some water, look far away for a minute.')}</Txt>
        {tarea && !marcada ? (
          <Pressable onPress={() => { cambiarTarea(tarea.id, { hecha: true }).catch(() => {}); setMarcada(true); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }}
            style={{ marginTop: 22, height: 48, paddingHorizontal: 20, borderRadius: 24, borderWidth: 1, borderColor: C.ok, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="checkmark-circle-outline" size={18} color={C.ok} />
            <Txt f="s" size={15} color={C.ok}>{t('Mark «{t}» as done', { t: tarea.titulo })}</Txt>
          </Pressable>
        ) : null}
        {fin.tipo === 'aprender' && fin.min >= 5 ? <NotaAprendida tema={fin.que} /> : null}
      </View>
      <Pressable onPress={() => volver()} style={{ height: 54, borderRadius: 27, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center' }}>
        <Txt f="s" size={16} color={C.tinta}>{t('Done')}</Txt>
      </Pressable>
    </View>
  );
}

/** al terminar de aprender: lo principal en una o dos frases, para que NOVA te lo pregunte mañana y después */
function NotaAprendida({ tema }: { tema?: string }) {
  const { t } = useIdioma();
  const [nota, setNota] = useState(''), [hecha, setHecha] = useState(false);
  if (hecha) return (
    <View style={{ marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Ionicons name="school-outline" size={18} color={C.lila} />
      <Txt f="m" size={14.5} color={C.lila}>{t('Saved. I will ask you tomorrow at 7 pm.')}</Txt>
    </View>
  );
  return (
    <View style={{ alignSelf: 'stretch', marginTop: 22 }}>
      <Txt f="s" size={15}>{t('What did you learn?')}</Txt>
      <Txt size={13} lh={18} color={C.t2} style={{ marginTop: 2 }}>{t('The main idea in one or two sentences. I will ask you about it tomorrow, then less and less often.')}</Txt>
      <TextInput value={nota} onChangeText={setNota} multiline maxLength={600} placeholder={t('The main idea…')} placeholderTextColor={C.t3}
        style={{ marginTop: 10, minHeight: 76, borderRadius: 16, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, padding: 12, color: C.t1, fontFamily: F.r, fontSize: 15.5, textAlignVertical: 'top' }} />
      <Pressable disabled={!nota.trim()} onPress={() => { crearTarjeta(tema || t('Learning session'), nota).catch(() => {}); setHecha(true); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }}
        style={{ marginTop: 10, alignSelf: 'flex-start', height: 42, paddingHorizontal: 16, borderRadius: 21, borderWidth: 1, borderColor: 'rgba(168,152,255,0.45)', flexDirection: 'row', alignItems: 'center', gap: 8, opacity: nota.trim() ? 1 : 0.4 }}>
        <Ionicons name="school-outline" size={16} color={C.lila} />
        <Txt f="s" size={14} color={C.lila}>{t('Save to review')}</Txt>
      </Pressable>
    </View>
  );
}

/** música de foco: una fila de opciones; «Tu playlist» pide pegar el enlace de Spotify */
function MusicaFoco() {
  const { t } = useIdioma(), m = useMusica();
  const [pegando, setPegando] = useState(false), [enlace, setEnlace] = useState(''), [malo, setMalo] = useState(false);
  const chip = (id: string, nombre: string, onPress: () => void) => {
    const on = m.elegida === id;
    return (
      <Pressable key={id} onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} accessibilityRole="button" accessibilityState={{ selected: on }}
        style={{ height: 34, paddingHorizontal: 13, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: on ? C.ok : C.l2, backgroundColor: on ? 'rgba(111,214,176,0.12)' : 'transparent' }}>
        {id !== 'nada' ? <Ionicons name="musical-notes" size={13} color={on ? C.ok : C.t3} /> : null}
        <Txt size={13} color={on ? C.ok : C.t2}>{nombre}</Txt>
      </Pressable>
    );
  };
  return (
    <View style={{ marginTop: 14 }}>
      <Txt f="m" size={13} color={C.t2} style={{ marginBottom: 8 }}>{t('Focus music')}</Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {PLAYLISTS.map(p => chip(p.id, p.id === 'nada' ? t(p.nombre) : p.nombre, () => elegirMusica(p.id)))}
        {chip('propia', m.propia ? m.propiaNombre ?? t('Your playlist') : t('+ Your playlist'), () => (m.propia ? elegirMusica('propia') : setPegando(true)))}
        {m.yt ? chip('yt', 'YouTube Music', () => elegirMusica('yt')) : chip('yt-sumar', t('+ YouTube Music'), () => router.push({ pathname: '/integracion', params: { k: 'youtube' } }))}
      </ScrollView>
      {pegando ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <TextInput value={enlace} onChangeText={x => { setEnlace(x); setMalo(false); }} placeholder={t('Paste a Spotify playlist link')} placeholderTextColor={C.t3} autoCapitalize="none" autoCorrect={false}
            style={{ flex: 1, height: 44, borderRadius: 14, backgroundColor: C.s1, borderWidth: 1, borderColor: malo ? C.alerta : C.l1, paddingHorizontal: 12, color: C.t1, fontFamily: F.r, fontSize: 14 }} />
          <Pressable onPress={() => { if (guardarPropia(enlace)) { setPegando(false); setEnlace(''); } else setMalo(true); }} style={{ height: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: C.ok, justifyContent: 'center' }}>
            <Txt f="s" size={14} color={C.tinta}>{t('Save')}</Txt>
          </Pressable>
        </View>
      ) : null}
      {malo ? <Txt size={12.5} color={C.alerta} style={{ marginTop: 4 }}>{t('That does not look like a Spotify playlist link.')}</Txt> : null}
    </View>
  );
}
