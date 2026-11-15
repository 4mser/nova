/* Acta de reunión. Sin id: grabas la reunión (hasta 45 min, audio liviano de 32 kbps) o pegas tus notas, y NOVA saca
   el título, el resumen, las decisiones y las tareas con responsable y fecha. Se procesa en el servidor: puedes cerrar
   la app, la entrada aparece en la bitácora y se completa sola (te llega un aviso).
   Con id: el acta lista, con las tareas propuestas para crearlas (todas o las que elijas) y el enlace a Notion. */
import { Ionicons } from '@expo/vector-icons';
import { AudioQuality, IOSOutputFormat, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, type RecordingOptions } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { crearActa, crearTareasActa, leerJson, useBitacora, type Acta } from '../cuenta/datos';
import { useCrew } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { Apilados } from '../ui/Tareas';
import { BotonAncho, Chip, Hoja } from '../ui/Hoja';
import { ReproductorNota } from '../ui/NotaVoz';
import { C, Cel, F, Seccion, Txt } from '../ui/tema';

const MAX_MS = 45 * 60e3;
/** voz de reunión: mono, 16 kHz, 32 kbps → 45 min ≈ 11 MB (lo que Gemini acepta en un solo envío) */
const REUNION: RecordingOptions = {
  extension: '.m4a', sampleRate: 16000, numberOfChannels: 1, bitRate: 32000, isMeteringEnabled: true,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
};
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export default function ActaPantalla() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return id ? <VerActa id={id} /> : <NuevaActa />;
}

function NuevaActa() {
  const { t } = useIdioma(), crew = useCrew();
  const [modo, setModo] = useState<'grabar' | 'notas'>('grabar'), [titulo, setTitulo] = useState(''), [notas, setNotas] = useState('');
  const [enviando, setEnviando] = useState(false), [error, setError] = useState<string | null>(null);
  const enviar = async (audio?: { uri: string; ms: number }) => {
    if (!crew) return;
    setEnviando(true); setError(null);
    try {
      await crearActa(crew.id, { audio, notas: audio ? undefined : notas, titulo });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace({ pathname: '/journal', params: { vista: 'crew' } });
    } catch (e) { setError(t((e as Error).message)); setEnviando(false); }
  };
  return (
    <Hoja titulo={t('Meeting notes')} sub={t('Record the meeting or paste your notes. Nova writes the summary, the decisions and the tasks with who and when.')} volverA="/crew">
      <TextInput value={titulo} onChangeText={setTitulo} placeholder={t('Title (optional): Monday planning')} placeholderTextColor={C.t3} maxLength={120}
        style={{ marginTop: 18, height: 50, borderRadius: 16, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, paddingHorizontal: 14, color: C.t1, fontFamily: F.r, fontSize: 15.5 }} />
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 14 }}>
        <Chip t={t('Record')} icono="mic-outline" on={modo === 'grabar'} onPress={() => setModo('grabar')} />
        <Chip t={t('Paste notes')} icono="document-text-outline" on={modo === 'notas'} onPress={() => setModo('notas')} />
      </View>
      {modo === 'grabar' ? <Grabadora enviando={enviando} alTerminar={enviar} /> : (
        <View style={{ marginTop: 14, gap: 14 }}>
          <TextInput value={notas} onChangeText={setNotas} multiline maxLength={20000} placeholder={t('Paste the notes or the transcript of the meeting')} placeholderTextColor={C.t3}
            style={{ minHeight: 220, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, padding: 14, color: C.t1, fontFamily: F.r, fontSize: 15, textAlignVertical: 'top' }} />
          <BotonAncho t={t('Make the notes')} onPress={() => enviar()} activo={notas.trim().length > 40} cargando={enviando} />
        </View>
      )}
      {error ? <Txt size={13.5} color={C.alerta} style={{ marginTop: 12 }}>{error}</Txt> : null}
      <Txt size={12.5} lh={18} color={C.t3} style={{ marginTop: 18 }}>{t('Tell people you are recording. The audio stays in the crew log; only the crew can play it.')}</Txt>
    </Hoja>
  );
}

function Grabadora({ enviando, alTerminar }: { enviando: boolean; alTerminar: (a: { uri: string; ms: number }) => void }) {
  const { t } = useIdioma(), rec = useAudioRecorder(REUNION);
  const [estado, setEstado] = useState<'listo' | 'grabando' | 'pausa'>('listo'), [ms, setMs] = useState(0), [error, setError] = useState<string | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const late = useSharedValue(1), punto = useAnimatedStyle(() => ({ opacity: late.value }));
  useEffect(() => () => { clearInterval(tick.current); rec.stop().catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const empezar = async () => {
    setError(null);
    const p = await requestRecordingPermissionsAsync();
    if (!p.granted) { setError(t('Microphone access is off. Turn it on in Settings to talk to Nova.')); if (!p.canAskAgain) Linking.openSettings().catch(() => {}); return; }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true });
    await rec.prepareToRecordAsync();
    rec.record();
    setEstado('grabando');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    late.set(withRepeat(withTiming(0.25, { duration: 700 }), -1, true));
    tick.current = setInterval(() => { const s = rec.getStatus(); setMs(s.durationMillis); if (s.durationMillis >= MAX_MS) terminar(); }, 250);
  };
  const pausar = () => { if (estado === 'grabando') { rec.pause(); setEstado('pausa'); } else { rec.record(); setEstado('grabando'); } };
  const terminar = async () => {
    clearInterval(tick.current);
    const dura = rec.getStatus().durationMillis;
    try { await rec.stop(); } catch {}
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, allowsBackgroundRecording: false }).catch(() => {});
    if (!rec.uri || dura < 5000) { setEstado('listo'); setMs(0); setError(t('Too short: record at least a few seconds.')); return; }
    alTerminar({ uri: rec.uri, ms: dura });
  };
  return (
    <Cel style={{ marginTop: 14, alignItems: 'center', paddingVertical: 28, gap: 14 }}>
      {estado === 'listo' ? (
        <>
          <Pressable onPress={empezar} accessibilityLabel={t('Start recording')} style={{ width: 92, height: 92, borderRadius: 46, backgroundColor: C.lila, alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 36px -10px rgba(168,152,255,0.7)' }}>
            <Ionicons name="mic" size={38} color={C.tinta} />
          </Pressable>
          <Txt size={14} color={C.t2}>{t('Tap to start · up to 45 min')}</Txt>
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Animated.View style={[{ width: 10, height: 10, borderRadius: 5, backgroundColor: estado === 'grabando' ? C.alerta : C.t3 }, estado === 'grabando' ? punto : null]} />
            <Txt f="l" size={52} ls={-2}>{mmss(ms)}</Txt>
          </View>
          <Txt size={13.5} color={C.t2}>{estado === 'pausa' ? t('Paused') : t('Recording the meeting…')}</Txt>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
            <Pressable onPress={pausar} disabled={enviando} style={{ height: 48, paddingHorizontal: 20, borderRadius: 24, borderWidth: 1, borderColor: C.l2, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name={estado === 'pausa' ? 'play' : 'pause'} size={17} color={C.t1} /><Txt f="s" size={15}>{t(estado === 'pausa' ? 'Resume' : 'Pause')}</Txt>
            </Pressable>
            <Pressable onPress={terminar} disabled={enviando} style={{ height: 48, paddingHorizontal: 20, borderRadius: 24, backgroundColor: C.lila, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {enviando ? <ActivityIndicator color={C.tinta} /> : <><Ionicons name="sparkles" size={16} color={C.tinta} /><Txt f="s" size={15} color={C.tinta}>{t('Finish and summarize')}</Txt></>}
            </Pressable>
          </View>
        </>
      )}
      {error ? <Txt size={13} color={C.alerta}>{error}</Txt> : null}
    </Cel>
  );
}

function VerActa({ id }: { id: string }) {
  const { t, tp, locale } = useIdioma(), crew = useCrew(), { datos } = useBitacora(crew?.id ?? null);
  const e = datos?.find(x => x.id === id), a = e ? leerJson<Acta>(e) : null;
  const [elegidas, setElegidas] = useState<number[] | null>(null), [creando, setCreando] = useState(false), [error, setError] = useState<string | null>(null);
  const [verTx, setVerTx] = useState(false);
  if (!crew || !e || !a) return <Hoja titulo={t('Meeting notes')} volverA="/crew"><ActivityIndicator color={C.nova} style={{ marginTop: 30 }} /></Hoja>;
  if (a.estado !== 'lista') return <Hoja titulo={a.titulo ?? t('Meeting notes')} volverA="/crew"><Txt size={15} color={a.estado === 'error' ? C.alerta : C.t2} style={{ marginTop: 16 }}>{a.estado === 'error' ? t('Nova could not process this meeting. Try again with notes or a clearer recording.') : t('Nova is writing the meeting notes…')}</Txt></Hoja>;
  const tareas = a.tareas ?? [], porCrear = tareas.map((x, i) => (x.creada ? -1 : i)).filter(i => i >= 0);
  const sel = elegidas ?? porCrear;
  const crear = async () => {
    setCreando(true); setError(null);
    try { const n = await crearTareasActa(e.id, sel); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); setElegidas([]); if (!n) setError(t('Nothing to create.')); }
    catch (x) { setError(t((x as Error).message)); } finally { setCreando(false); }
  };
  const fecha = new Date(e.ts).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <Hoja titulo={a.titulo ?? t('Meeting notes')} sub={fecha} volverA="/crew"
      pie={porCrear.length ? <BotonAncho t={tp(sel.length, 'Create {n} task', 'Create {n} tasks')} onPress={crear} activo={sel.length > 0} cargando={creando} color={C.lila} /> : undefined}>
      {e.audio ? <View style={{ marginTop: 12 }}><ReproductorNota audio={e.audio} /></View> : null}
      {a.resumen ? <Txt size={16} lh={23.5} style={{ marginTop: 16 }}>{a.resumen}</Txt> : null}
      {a.notion ? (
        <Pressable onPress={() => Linking.openURL(a.notion!).catch(() => {})} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <Ionicons name="document-text-outline" size={15} color={C.t2} /><Txt f="m" size={13.5} color={C.t2}>{t('Also saved in Notion')} ↗</Txt>
        </Pressable>
      ) : null}
      {a.decisiones?.length ? (
        <>
          <Seccion t={t('Decisions')} nota={String(a.decisiones.length)} />
          <Cel style={{ gap: 10 }}>
            {a.decisiones.map((d, i) => <View key={i} style={{ flexDirection: 'row', gap: 10 }}><Ionicons name="git-commit-outline" size={16} color={C.lila} style={{ marginTop: 2 }} /><Txt size={15} lh={21} style={{ flex: 1 }}>{d}</Txt></View>)}
          </Cel>
        </>
      ) : null}
      {tareas.length ? (
        <>
          <Seccion t={t('Tasks')} nota={porCrear.length ? t('tap to choose') : t('all created')} />
          <Cel style={{ paddingVertical: 4 }}>
            {tareas.map((x, i) => {
              const on = !x.creada && sel.includes(i);
              return (
                <Pressable key={i} disabled={!!x.creada} onPress={() => setElegidas(on ? sel.filter(k => k !== i) : [...sel, i])} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
                  <Ionicons name={x.creada ? 'checkmark-circle' : on ? 'checkbox' : 'square-outline'} size={20} color={x.creada ? C.ok : on ? C.lila : C.t3} />
                  <View style={{ flex: 1 }}>
                    <Txt size={15} lh={20} color={x.creada ? C.t2 : C.t1}>{x.titulo}</Txt>
                    {x.vence || x.creada ? <Txt size={12.5} color={C.t3}>{x.creada ? t('Created') : new Date(`${x.vence}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}</Txt> : null}
                  </View>
                  <Apilados ids={x.responsables} />
                </Pressable>
              );
            })}
          </Cel>
        </>
      ) : null}
      {a.temas?.length ? <Txt size={13} lh={19} color={C.t3} style={{ marginTop: 16 }}>{t('Topics')}: {a.temas.join(' · ')}</Txt> : null}
      {e.audio?.transcripcion ? (
        <Pressable onPress={() => setVerTx(v => !v)} style={{ marginTop: 18 }}>
          <Txt f="m" size={13.5} color={C.nova}>{verTx ? t('Hide transcript') : t('Show transcript')}</Txt>
          {verTx ? <Txt size={14} lh={21} color={C.t2} style={{ marginTop: 8 }}>{e.audio.transcripcion}</Txt> : null}
        </Pressable>
      ) : null}
      {error ? <Txt size={13.5} color={C.alerta} style={{ marginTop: 12 }}>{error}</Txt> : null}
    </Hoja>
  );
}
