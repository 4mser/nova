/* Compartir una foto o un video (hasta 60 s) con la crew: eliges sacar una foto, grabar un video o sacarlo de la
   galería, le pones una frase si quieres y se envía. Si es el momento NOVA, arriba corre la cuenta de los 10 minutos
   «a tiempo». (Antes la cámara de fotos se abría sola al entrar y no dejaba ver las otras opciones.) */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View, useWindowDimensions } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_VIDEO_S, subirFoto, subirVideo } from '../cuenta/fotos';
import { limpiarPendiente, marcarPendiente, tomarRecuperado } from '../cuenta/pendiente';
import { VistaVideo } from '../ui/VistaVideo';
import { useCrew } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { volver } from '../ui/volver';
import { C, F, Txt } from '../ui/tema';

type Elegida = { uri: string; width: number; height: number; type?: string | null; duration?: number | null; fileSize?: number };

export default function Compartir() {
  const { momento } = useLocalSearchParams<{ momento?: string }>();
  const crew = useCrew(), { t } = useIdioma(), ins = useSafeAreaInsets(), { width } = useWindowDimensions();
  // si Android cerró NOVA mientras la cámara estaba abierta, lo que sacaste vuelve aquí
  const [foto, setFoto] = useState<Elegida | null>(() => tomarRecuperado()), [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false), [error, setError] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(id); }, []);

  const camara = useCallback(async () => {
    setError(null);
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) { setError(t('NOVA needs the camera to share your moment. You can allow it in Settings.')); return; }
    await marcarPendiente();
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    limpiarPendiente();
    if (!r.canceled && r.assets[0]) setFoto(r.assets[0]);
  }, [t]);
  const grabar = async () => {
    setError(null);
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) { setError(t('NOVA needs the camera to share your moment. You can allow it in Settings.')); return; }
    await marcarPendiente();
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: MAX_VIDEO_S, quality: 1 });
    limpiarPendiente();
    if (!r.canceled && r.assets[0]) setFoto(r.assets[0]);
  };
  const galeria = async () => {
    await marcarPendiente();
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 1, videoMaxDuration: MAX_VIDEO_S });
    limpiarPendiente();
    if (!r.canceled && r.assets[0]) setFoto(r.assets[0]);
  };
  const esVideo = foto?.type === 'video';

  const enviar = async () => {
    if (!foto || !crew || enviando) return;
    setEnviando(true); setError(null);
    try {
      if (esVideo) await subirVideo(crew.id, foto, texto); else await subirFoto(crew.id, foto, texto);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      volver();
    } catch (e) { setError(t((e as Error).message)); setEnviando(false); }
  };

  const m = crew?.hoy.momento ?? 0, abierto = !!momento && ahora >= m && ahora - m < 10 * 60e3;
  const resta = Math.max(0, m + 10 * 60e3 - ahora);
  const alto = foto ? Math.min((width - 32) * (foto.height / foto.width), 560) : 0;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <View style={{ paddingTop: ins.top + 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable onPress={() => volver()} hitSlop={10} accessibilityLabel={t('Close')}><Ionicons name="close" size={26} color={C.t1} /></Pressable>
        <View style={{ flex: 1 }}>
          <Txt f="s" size={17}>{t('Share with {crew}', { crew: crew?.nombre ?? '' })}</Txt>
          {abierto ? <Txt f="m" size={13} color={C.nova}>⚡ {t('{m}:{s} left to share on time', { m: Math.floor(resta / 60e3), s: String(Math.floor((resta % 60e3) / 1000)).padStart(2, '0') })}</Txt> : null}
        </View>
      </View>
      <View style={{ flex: 1, padding: 16, justifyContent: 'center' }}>
        {foto ? (
          <View style={{ borderRadius: 24, overflow: 'hidden', backgroundColor: C.s1 }}>
            {esVideo ? <VistaVideo fuente={foto.uri} ancho={width - 32} alto={alto} silencio={false} /> : <Image source={{ uri: foto.uri }} style={{ width: width - 32, height: alto }} contentFit="cover" />}
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <Txt f="s" size={26} ls={-0.8} lh={30}>{t('What are you doing right now?')}</Txt>
            <Txt size={15} lh={21} color={C.t2} style={{ marginBottom: 10 }}>{t('Share it with {crew} as a photo or a short video.', { crew: crew?.nombre ?? '' })}</Txt>
            <Opcion icono="camera" color={C.nova} titulo={t('Take a photo')} sub={t('With the camera, right now')} onPress={camara} principal />
            <Opcion icono="videocam" color={C.alerta} titulo={t('Record a video')} sub={t('Up to {s} seconds, with sound', { s: MAX_VIDEO_S })} onPress={grabar} />
            <Opcion icono="images" color={C.lila} titulo={t('From the gallery')} sub={t('A photo or a video you already have')} onPress={galeria} />
          </View>
        )}
        {error ? <Txt size={14} color={C.alerta} style={{ marginTop: 12, textAlign: 'center' }}>{error}</Txt> : null}
      </View>
      <View style={{ paddingHorizontal: 16, paddingBottom: ins.bottom + 14, gap: 10 }}>
        {foto ? (
          <>
          <TextInput value={texto} onChangeText={setTexto} placeholder={t('Say something (optional)')} placeholderTextColor={C.t3} maxLength={200}
            style={{ height: 50, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, paddingHorizontal: 16, color: C.t1, fontFamily: F.r, fontSize: 15.5 }} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={() => setFoto(null)} style={{ height: 52, paddingHorizontal: 18, borderRadius: 26, borderWidth: 1, borderColor: C.l2, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="arrow-undo-outline" size={18} color={C.t1} />
            <Txt f="s" size={15}>{t('Change')}</Txt>
          </Pressable>
          <Pressable onPress={enviar} disabled={!foto || enviando} style={({ pressed }) => ({ flex: 1, height: 52, borderRadius: 26, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: foto ? (pressed ? 0.8 : 1) : 0.4 })}>
            {enviando ? <ActivityIndicator color={C.tinta} /> : <><Ionicons name="paper-plane" size={17} color={C.tinta} /><Txt f="s" size={16} color={C.tinta}>{t('Share')}</Txt></>}
          </Pressable>
        </View>
          </>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

function Opcion({ icono, color, titulo, sub, onPress, principal }: { icono: keyof typeof Ionicons.glyphMap; color: string; titulo: string; sub: string; onPress: () => void; principal?: boolean }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} accessibilityRole="button" accessibilityLabel={titulo}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 22, backgroundColor: principal ? 'rgba(143,230,245,0.08)' : C.s1, borderWidth: 1, borderColor: principal ? 'rgba(143,230,245,0.35)' : C.l1, opacity: pressed ? 0.8 : 1 })}>
      <View style={{ width: 50, height: 50, borderRadius: 16, backgroundColor: `${color}22`, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icono} size={24} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt f="s" size={16.5}>{titulo}</Txt>
        <Txt size={13.5} color={C.t2}>{sub}</Txt>
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.t3} />
    </Pressable>
  );
}
