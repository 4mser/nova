/* Nota rápida: se abre grabando (desde el widget «Tu día», Tus cosas o el mapa). Dices lo que se te ocurrió, tocas para
   terminar y NOVA lo entiende y lo deja donde corresponde: tarea, recordatorio, lista o nota en tu bitácora (con las
   mismas herramientas que usa al hablarle, así también queda en «Lo que hizo NOVA»). Máximo 1 minuto. */
import { Ionicons } from '@expo/vector-icons';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CLAVE_TAREAS, leerCache, type Tarea } from '../cuenta/datos';
import { entenderNota, type NotaEntendida } from '../cuenta/notaRapida';
import { leerSesion } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { NovaOrb } from '../nova/NovaOrb';
import { volver } from '../ui/volver';
import { C, Cel, Txt } from '../ui/tema';
import { ejecutar, type Resultado } from '../voz/acciones';

const MAX = 60e3;
const ICONO: Record<NotaEntendida['tipo'], keyof typeof Ionicons.glyphMap> = { tarea: 'checkbox-outline', recordatorio: 'alarm-outline', lista: 'list-outline', nota: 'book-outline' };

export default function Nota() {
  const ins = useSafeAreaInsets(), tr = useIdioma(), { t } = tr;
  const rec = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const [estado, setEstado] = useState<'pidiendo' | 'grabando' | 'entendiendo' | 'listo' | 'error'>('pidiendo');
  const [ms, setMs] = useState(0), [nota, setNota] = useState<NotaEntendida | null>(null), [hecho, setHecho] = useState<Resultado | null>(null), [error, setError] = useState<string | null>(null);
  const [vuelta, setVuelta] = useState(0);
  const nivel = useSharedValue(0), cortado = useRef(false);
  const halo = useAnimatedStyle(() => ({ transform: [{ scale: 1 + nivel.value * 0.35 }], opacity: 0.25 + nivel.value * 0.5 }));

  const terminar = async () => {
    if (cortado.current) return;
    cortado.current = true;
    try { await rec.stop(); } catch {}
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    if (!rec.uri) { setEstado('error'); setError(t('Nothing was recorded.')); return; }
    setEstado('entendiendo');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const n = await entenderNota(rec.uri);
      setNota(n);
      if (!n.texto.trim()) { setEstado('error'); setError(t('I could not hear anything. Try again, a bit closer.')); return; }
      // se ejecuta con las herramientas de NOVA (queda donde corresponde y en «Lo que hizo NOVA»)
      const s = leerSesion(), crew = s.crews.find(c => c.id === s.crewId) ?? null;
      const ctx = { tr, crew: crew ? { id: crew.id, nombre: crew.nombre } : null, tareas: leerCache<Tarea[]>(CLAVE_TAREAS) ?? [], yo: s.usuario?.id };
      const r = n.tipo === 'tarea' ? await ejecutar('crear_tarea', { titulo: n.titulo, para_hoy: n.dia === 'hoy' }, ctx)
        : n.tipo === 'recordatorio' ? await ejecutar('recordarme', { texto: n.titulo, hora: n.hora ?? undefined, en_minutos: n.en_minutos ?? undefined, dia: n.dia ?? undefined }, ctx)
        : n.tipo === 'lista' ? await ejecutar('agregar_a_lista', { lista: n.lista ?? t('Ideas'), items: n.items.length ? n.items : [n.titulo] }, ctx)
        : await ejecutar('escribir_diario', { texto: n.texto }, ctx);
      // un recordatorio sin hora válida queda como tarea (nada se pierde)
      const final = r?.respuesta.ok === false && n.tipo === 'recordatorio' ? await ejecutar('crear_tarea', { titulo: n.titulo }, ctx) : r;
      setHecho(final);
      setEstado('listo');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) { setEstado('error'); setError(t((e as Error).message)); }
  };

  useEffect(() => {
    let vivo = true, id: ReturnType<typeof setInterval> | undefined;
    cortado.current = false;
    (async () => {
      if (Platform.OS === 'web') { setEstado('error'); setError(t('Quick notes work on the phone.')); return; }
      const p = await requestRecordingPermissionsAsync();
      if (!p.granted) { setEstado('error'); setError(t('Microphone access is off. Turn it on in Settings to talk to Nova.')); if (!p.canAskAgain) Linking.openSettings().catch(() => {}); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await rec.prepareToRecordAsync();
      rec.record();
      if (!vivo) return;
      setEstado('grabando');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      id = setInterval(() => {
        const s = rec.getStatus();
        setMs(s.durationMillis);
        if (s.metering !== undefined) nivel.set(withSpring(Math.max(0, Math.min(1, (s.metering + 55) / 50)), { damping: 14 }));
        if (s.durationMillis >= MAX) terminar();
      }, 120);
    })().catch(e => { setEstado('error'); setError(String((e as Error).message)); });
    return () => { vivo = false; if (id) clearInterval(id); if (!cortado.current) { cortado.current = true; rec.stop().catch(() => {}); } };
  }, [vuelta]); // eslint-disable-line react-hooks/exhaustive-deps

  const otra = () => { setNota(null); setHecho(null); setError(null); setMs(0); setEstado('pidiendo'); setVuelta(v => v + 1); };
  const s = Math.floor(ms / 1000);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: ins.top + 8, paddingBottom: ins.bottom + 24 }}>
      <View style={{ flexDirection: 'row', paddingHorizontal: 16 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <Txt f="mono" size={12} ls={1.4} color={C.nova} style={{ textTransform: 'uppercase' }}>{t('Quick note')}</Txt>
        <Pressable onPress={estado === 'grabando' ? terminar : undefined} disabled={estado !== 'grabando'} accessibilityRole="button" accessibilityLabel={t('Tap to finish')}
          style={{ width: 240, height: 240, alignItems: 'center', justifyContent: 'center', marginTop: 10 }}>
          {estado === 'grabando' ? <Animated.View style={[{ position: 'absolute', width: 210, height: 210, borderRadius: 105, backgroundColor: C.sigSuave, borderWidth: 1, borderColor: `${C.nova}55` }, halo]} /> : null}
          <NovaOrb size={200} orbes={estado === 'entendiendo' ? 4 : 2} expr={estado === 'listo' ? 'feliz' : estado === 'entendiendo' ? 'pensativa' : estado === 'error' ? 'triste' : 'normal'} />
        </Pressable>

        {estado === 'grabando' ? (
          <Animated.View entering={FadeIn} style={{ alignItems: 'center', gap: 6 }}>
            <Txt f="l" size={44} ls={-1.5}>{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</Txt>
            <Txt size={15} color={C.t2}>{t('Say it as it comes. Tap Nova to finish.')}</Txt>
            <Txt size={12.5} color={C.t3} style={{ marginTop: 4, textAlign: 'center' }}>{t('«Remind me at 6 to call mom» · «buy coffee» · «idea: …»')}</Txt>
          </Animated.View>
        ) : estado === 'entendiendo' || estado === 'pidiendo' ? (
          <View style={{ alignItems: 'center', gap: 10 }}>
            <ActivityIndicator color={C.nova} />
            <Txt size={15} color={C.t2}>{t(estado === 'pidiendo' ? 'Getting the microphone ready…' : 'Understanding…')}</Txt>
          </View>
        ) : estado === 'listo' && nota ? (
          <Animated.View entering={FadeInDown.duration(380)} style={{ alignSelf: 'stretch', gap: 10 }}>
            <Txt size={16} lh={23} color={C.t2} style={{ textAlign: 'center' }}>«{nota.texto}»</Txt>
            {hecho?.accion ? (
              <Pressable onPress={() => hecho.accion?.ir && router.replace(hecho.accion.ir as never)}>
                <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: `${C.nova}55` }}>
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.sigSuave, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={ICONO[nota.tipo]} size={19} color={C.nova} />
                  </View>
                  <Txt f="m" size={15} lh={20} style={{ flex: 1 }}>{hecho.accion.texto}</Txt>
                  {hecho.accion.ir ? <Txt f="s" size={13} color={C.nova}>{t('See')}</Txt> : null}
                </Cel>
              </Pressable>
            ) : <Txt size={14} color={C.aviso} style={{ textAlign: 'center' }}>{t('I understood it but could not save it. Try telling Nova directly.')}</Txt>}
          </Animated.View>
        ) : (
          <Txt size={15} lh={21} color={C.alerta} style={{ textAlign: 'center' }}>{error}</Txt>
        )}
      </View>
      {estado === 'listo' || estado === 'error' ? (
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20 }}>
          <Pressable onPress={otra} style={{ flex: 1, height: 52, borderRadius: 26, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}>
            <Ionicons name="mic-outline" size={17} color={C.t1} />
            <Txt f="m" size={15}>{t('Another one')}</Txt>
          </Pressable>
          <Pressable onPress={() => volver('/')} style={({ pressed }) => ({ flex: 1, height: 52, borderRadius: 26, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
            <Txt f="s" size={15.5} color={C.tinta}>{t('Done')}</Txt>
          </Pressable>
        </View>
      ) : estado === 'grabando' ? (
        <View style={{ paddingHorizontal: 20 }}>
          <Pressable onPress={terminar} style={({ pressed }) => ({ height: 56, borderRadius: 28, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: pressed ? 0.85 : 1 })}>
            <Ionicons name="checkmark" size={20} color={C.tinta} />
            <Txt f="s" size={16} color={C.tinta}>{t('Done, save it')}</Txt>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
