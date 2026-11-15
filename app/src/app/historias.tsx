/* Historias de un día: las fotos y videos de la crew a pantalla completa, persona por persona. Tocar a la derecha avanza,
   a la izquierda retrocede, mantener pausa, deslizar hacia abajo cierra. Un video dura lo que dura (con botón de
   sonido); una foto, 5 s. Abajo, las reacciones. No desaparecen: quedan en el calendario. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { imagen } from '../cuenta/api';
import { borrarFoto, reaccionar, useFotos } from '../cuenta/datos';
import { useCrew, useSesion } from '../cuenta/sesion';
import { mayus, useIdioma } from '../i18n';
import { volver } from '../ui/volver';
import { VistaVideo } from '../ui/VistaVideo';
import { AvatarMiembro } from '../ui/Crew';
import { C, Txt } from '../ui/tema';

const DURA = 5000;
const EMOJIS = ['❤️', '🔥', '😂', '😮', '👏', '🚀'];

export default function Historias() {
  const { fecha, u } = useLocalSearchParams<{ fecha: string; u?: string }>();
  const crew = useCrew(), { usuario } = useSesion(), { t, locale } = useIdioma(), ins = useSafeAreaInsets(), { width, height } = useWindowDimensions();
  const { datos, cargando } = useFotos(crew?.id ?? null, fecha, fecha);
  // en orden: por persona (como en la crew), y las de cada persona de la más antigua a la más nueva
  const fotos = useMemo(() => {
    const l = [...(datos ?? [])].sort((a, b) => a.ts - b.ts);
    const orden = crew?.miembros.map(m => m.id) ?? [];
    return l.sort((a, b) => orden.indexOf(a.usuario) - orden.indexOf(b.usuario) || a.ts - b.ts);
  }, [datos, crew]);
  const [i, setI] = useState(0), [pausa, setPausa] = useState(false), [cargadaId, setCargadaId] = useState<string | null>(null), [conSonido, setConSonido] = useState(true);
  const iniciado = useRef(false);
  useEffect(() => {
    if (iniciado.current || !fotos.length) return;
    iniciado.current = true;
    const k = u ? fotos.findIndex(f => f.usuario === u) : 0;
    setI(Math.max(0, k));
  }, [fotos, u]);
  const f = fotos[Math.min(i, fotos.length - 1)];
  const autor = crew?.miembros.find(m => m.id === f?.usuario);

  // avance: una barra por foto; la actual se llena en 5 s (se detiene en pausa o mientras carga)
  const avance = useSharedValue(0);
  const siguiente = () => { if (i < fotos.length - 1) setI(i + 1); else volver(); };
  const anterior = () => setI(Math.max(0, i - 1));
  const cargada = !!f && cargadaId === f.id;
  useEffect(() => { avance.set(0); }, [i, avance]);
  useEffect(() => {
    if (!f || pausa || !cargada) return;
    const resta = (1 - avance.get()) * (f.video ? f.video.ms + 300 : DURA);
    avance.set(withTiming(1, { duration: resta }));
    const id = setTimeout(siguiente, resta);
    return () => { clearTimeout(id); avance.set(avance.get()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f?.id, pausa, cargada]);
  const barra = useAnimatedStyle(() => ({ width: `${avance.value * 100}%` }));

  // deslizar hacia abajo cierra
  const y = useSharedValue(0);
  const cerrarGesto = Gesture.Pan().activeOffsetY(14).failOffsetX([-20, 20])
    .onUpdate(e => { y.value = Math.max(0, e.translationY); })
    .onEnd(e => { if (e.translationY > 120) scheduleOnRN(volver); else y.value = withTiming(0, { duration: 200 }); });
  const mover = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }], opacity: 1 - Math.min(0.5, y.value / 600) }));

  if (!crew) return null;
  if (!f) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        {cargando ? <ActivityIndicator color={C.nova} /> : <Txt color={C.t2}>{t('No photos this day')}</Txt>}
      </View>
    );
  }
  const misReacciones = new Set(f.reacciones.filter(r => r.usuario === usuario?.id).map(r => r.emoji));
  const conteo = EMOJIS.map(e => [e, f.reacciones.filter(r => r.emoji === e).length] as const);
  const hora = new Date(f.ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  const dia = mayus(new Date(`${f.fecha}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }));
  return (
    <GestureDetector gesture={cerrarGesto}>
      <Animated.View style={[{ flex: 1, backgroundColor: '#000' }, mover]}>
        {f.video ? <VistaVideo key={f.id} fuente={f.video.url} portada={f.url} ancho={width} alto={height} silencio={!conSonido} activo={!pausa} controles={false} alListo={() => setCargadaId(f.id)} />
          : <Image source={imagen(f.url)} placeholder={imagen(f.mini)} style={{ width, height }} contentFit="cover" transition={120} onLoad={() => setCargadaId(f.id)} onError={() => setCargadaId(f.id)} />}
        {/* sombras para leer el texto sobre cualquier foto */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ins.top + 110, experimental_backgroundImage: 'linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0))' }} />
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 260, experimental_backgroundImage: 'linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0.7))' }} />

        {/* toques: izquierda atrás, derecha adelante, mantener pausa */}
        <View style={{ position: 'absolute', inset: 0, flexDirection: 'row' }}>
          <Pressable style={{ flex: 1 }} onPress={anterior} onLongPress={() => setPausa(true)} onPressOut={() => setPausa(false)} delayLongPress={180} accessibilityLabel={t('Previous')} />
          <Pressable style={{ flex: 2 }} onPress={siguiente} onLongPress={() => setPausa(true)} onPressOut={() => setPausa(false)} delayLongPress={180} accessibilityLabel={t('Next')} />
        </View>

        <View style={{ position: 'absolute', top: ins.top + 8, left: 12, right: 12, pointerEvents: 'box-none' }}>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {fotos.map((x, k) => (
              <View key={x.id} style={{ flex: 1, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}>
                {k < i ? <View style={{ flex: 1, backgroundColor: '#fff' }} /> : k === i ? <Animated.View style={[{ height: 2.5, backgroundColor: '#fff' }, barra]} /> : null}
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <AvatarMiembro u={autor} size={34} />
            <View style={{ flex: 1 }}>
              <Txt f="s" size={15} color="#fff">{f.mia ? t('You') : autor?.nombre ?? ''}</Txt>
              <Txt size={12.5} color="rgba(255,255,255,0.75)">{dia} · {hora}{f.aTiempo ? ` · ⚡ ${t('on time')}` : ''}</Txt>
            </View>
            {f.video ? (
              <Pressable hitSlop={10} accessibilityLabel={t(conSonido ? 'Mute' : 'Sound on')} onPress={() => setConSonido(x => !x)}>
                <Ionicons name={conSonido ? 'volume-high' : 'volume-mute'} size={21} color="#fff" />
              </Pressable>
            ) : null}
            {f.mia ? (
              <Pressable hitSlop={10} accessibilityLabel={t('Delete photo')} onPress={() => { borrarFoto(f.id).catch(() => {}); if (fotos.length <= 1) volver(); }}>
                <Ionicons name="trash-outline" size={21} color="#fff" />
              </Pressable>
            ) : null}
            <Pressable hitSlop={10} onPress={() => volver()} accessibilityLabel={t('Close')}><Ionicons name="close" size={26} color="#fff" /></Pressable>
          </View>
        </View>

        <View style={{ position: 'absolute', left: 16, right: 16, bottom: ins.bottom + 18, gap: 14, pointerEvents: 'box-none' }}>
          {f.texto ? <Txt f="m" size={17} lh={23} color="#fff">{f.texto}</Txt> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {conteo.map(([e, n]) => {
              const mia = misReacciones.has(e);
              return (
                <Pressable key={e} accessibilityLabel={e} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); reaccionar(f.id, e).catch(() => {}); }}
                  style={{ flex: 1, height: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: mia ? 'rgba(143,230,245,0.3)' : 'rgba(255,255,255,0.14)', borderWidth: mia ? 1 : 0, borderColor: C.nova }}>
                  <Txt size={18}>{e}</Txt>
                  {n ? <Txt f="s" size={12} color="#fff">{n}</Txt> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}
