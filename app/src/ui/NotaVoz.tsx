/* Notas de voz de la bitácora de la crew.
   · Grabador: punto rojo que late, tiempo y una onda con el nivel real del micrófono; enviar o descartar. Máx. 3 min.
   · Reproductor: play/pausa, barra de avance y duración. El audio se carga recién al tocar play (no uno por fila). */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { urlConToken } from '../cuenta/api';
import { subirNotaVoz } from '../cuenta/audios';
import { useIdioma } from '../i18n';
import { C, Txt } from './tema';

const MAX_MS = 180e3;
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function GrabadorNota({ crew, onListo, onCancelar }: { crew: string; onListo: () => void; onCancelar: () => void }) {
  const { t } = useIdioma();
  const rec = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const [ms, setMs] = useState(0), [niveles, setNiveles] = useState<number[]>([]), [estado, setEstado] = useState<'iniciando' | 'grabando' | 'enviando' | 'error'>('iniciando');
  const [error, setError] = useState<string | null>(null);
  const cortado = useRef(false);
  const late = useSharedValue(1);
  const punto = useAnimatedStyle(() => ({ opacity: late.value }));

  const parar = async (enviar: boolean) => {
    if (cortado.current) return;
    cortado.current = true;
    try { await rec.stop(); } catch {}
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    if (!enviar || !rec.uri || ms < 800) { onCancelar(); return; }
    setEstado('enviando');
    try { await subirNotaVoz(crew, rec.uri, ms); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); onListo(); }
    catch (e) { setError(t((e as Error).message)); setEstado('error'); }
  };

  useEffect(() => {
    let vivo = true, id: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const p = await requestRecordingPermissionsAsync();
      if (!p.granted) { setError(t('Microphone access is off. Turn it on in Settings to talk to Nova.')); setEstado('error'); if (!p.canAskAgain) Linking.openSettings().catch(() => {}); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await rec.prepareToRecordAsync();
      rec.record();
      if (!vivo) return;
      setEstado('grabando');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      late.set(withRepeat(withTiming(0.25, { duration: 600 }), -1, true));
      id = setInterval(() => {
        const s = rec.getStatus();
        setMs(s.durationMillis);
        if (s.metering !== undefined) setNiveles(n => [...n.slice(-31), Math.max(0, Math.min(1, (s.metering! + 60) / 60))]);
        if (s.durationMillis >= MAX_MS) parar(true);
      }, 150);
    })().catch(e => { setError(String((e as Error).message)); setEstado('error'); });
    return () => { vivo = false; if (id) clearInterval(id); if (!cortado.current) { cortado.current = true; rec.stop().catch(() => {}); } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingHorizontal: 14, borderRadius: 26, backgroundColor: C.s2 }}>
        <Animated.View style={[{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.alerta }, punto]} />
        <Txt f="mono" size={14} color={C.t1}>{mmss(ms)}</Txt>
        <View style={{ flex: 1, height: 28, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          {Array.from({ length: 32 }, (_, i) => { const v = niveles[niveles.length - 32 + i] ?? 0; return <View key={i} style={{ flex: 1, height: Math.max(3, v * 28), borderRadius: 2, backgroundColor: v ? C.nova : C.l2 }} />; })}
        </View>
        <Pressable onPress={() => parar(false)} hitSlop={8} accessibilityLabel={t('Discard')} disabled={estado === 'enviando'}>
          <Ionicons name="trash-outline" size={19} color={C.t3} />
        </Pressable>
        <Pressable onPress={() => parar(true)} disabled={estado !== 'grabando'} accessibilityLabel={t('Send voice note')} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', opacity: estado === 'grabando' ? 1 : 0.5 }}>
          {estado === 'enviando' || estado === 'iniciando' ? <ActivityIndicator color={C.tinta} size="small" /> : <Ionicons name="arrow-up" size={19} color={C.tinta} />}
        </Pressable>
      </View>
      {error ? <Txt size={13} color={C.alerta}>{error}</Txt> : <Txt size={12} color={C.t3}>{t('Recording · up to 3 minutes')}</Txt>}
    </View>
  );
}

export function ReproductorNota({ audio }: { audio: { url: string; ms: number } }) {
  const [activo, setActivo] = useState(false);
  if (!activo) return <BarraNota ms={audio.ms} onPlay={() => setActivo(true)} />;
  return <ReproductorActivo audio={audio} />;
}

function ReproductorActivo({ audio }: { audio: { url: string; ms: number } }) {
  const player = useAudioPlayer({ uri: urlConToken(audio.url) });
  const st = useAudioPlayerStatus(player);
  useEffect(() => { setAudioModeAsync({ playsInSilentMode: true }).catch(() => {}); player.play(); }, [player]);
  useEffect(() => { if (st.didJustFinish) { player.pause(); player.seekTo(0); } }, [st.didJustFinish, player]);
  const total = (st.duration || audio.ms / 1000) * 1000, pos = st.currentTime * 1000;
  return <BarraNota ms={total} pos={pos} sonando={st.playing} cargando={!st.isLoaded} onPlay={() => (st.playing ? player.pause() : player.play())} />;
}

function BarraNota({ ms, pos = 0, sonando, cargando, onPlay }: { ms: number; pos?: number; sonando?: boolean; cargando?: boolean; onPlay: () => void }) {
  const { t } = useIdioma();
  const p = ms ? Math.min(1, pos / ms) : 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
      <Pressable onPress={onPlay} accessibilityRole="button" accessibilityLabel={t(sonando ? 'Pause' : 'Play voice note')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.sigSuave, alignItems: 'center', justifyContent: 'center' }}>
        {cargando ? <ActivityIndicator color={C.nova} size="small" /> : <Ionicons name={sonando ? 'pause' : 'play'} size={16} color={C.nova} style={{ marginLeft: sonando ? 0 : 2 }} />}
      </Pressable>
      <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: C.l2 }}>
        <View style={{ width: `${p * 100}%`, height: 4, borderRadius: 2, backgroundColor: C.nova }} />
      </View>
      <Txt f="monoR" size={12} color={C.t3}>{mmss(sonando || pos ? pos : ms)}</Txt>
    </View>
  );
}
