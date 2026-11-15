/* Un video de la crew (o el que estás por compartir): corre en bucle, sin controles encima; tocarlo pausa o sigue y el
   botón de abajo activa el sonido. Los de la API viajan con el token en la cabecera (en web, en la URL) y quedan en
   caché del teléfono para no bajarlos dos veces. */
import { Ionicons } from '@expo/vector-icons';
import { useEvent } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoPlayer, type VideoSource } from 'expo-video';
import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { API, imagen, tokenActual, urlConToken } from '../cuenta/api';
import { C } from './tema';

/** `fuente`: una URI local (file://, content://) o una ruta de la API (/v1/fotos/…?video=1) */
function origen(fuente: string): VideoSource {
  if (!fuente.startsWith('/')) return fuente;
  if (Platform.OS === 'web') return urlConToken(fuente);
  return { uri: `${API}${fuente}`, headers: { authorization: `Bearer ${tokenActual() ?? ''}` }, useCaching: true };
}

/** fuera del componente: el compilador de React no deja asignar propiedades a lo que devuelve un hook */
const ponerMudo = (p: VideoPlayer, v: boolean) => { p.muted = v; };

/** `controles={false}`: sin toques propios (las historias manejan los toques y el sonido desde afuera con `silencio`) */
export function VistaVideo({ fuente, ancho, alto, silencio = true, activo = true, portada, alTerminar, alListo, redondeo = 0, controles = true }:
  { fuente: string; ancho: number; alto: number; silencio?: boolean; activo?: boolean; portada?: string; alTerminar?: () => void; alListo?: () => void; redondeo?: number; controles?: boolean }) {
  const player = useVideoPlayer(origen(fuente), p => { p.loop = !alTerminar; p.muted = silencio; p.timeUpdateEventInterval = 0; });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const [mudoPropio, setMudo] = useState(silencio);
  // con controles manda el botón propio; sin controles, quien lo usa (las historias) con `silencio`
  const mudo = controles ? mudoPropio : silencio;
  // corre solo mientras se ve (la historia activa, la pantalla al frente)
  useEffect(() => { if (activo) player.play(); else player.pause(); }, [activo, player]);
  useEffect(() => { ponerMudo(player, mudo); }, [mudo, player]);
  useEffect(() => { if (status === 'readyToPlay' || status === 'error') alListo?.(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!alTerminar) return;
    const s = player.addListener('playToEnd', () => alTerminar());
    return () => s.remove();
  }, [alTerminar, player]);
  return (
    <View style={{ width: ancho, height: alto, borderRadius: redondeo, overflow: 'hidden', backgroundColor: '#000' }}>
      <Pressable onPress={() => (isPlaying ? player.pause() : player.play())} disabled={!controles} style={{ flex: 1 }} accessibilityRole="button">
        <VideoView player={player} style={{ width: ancho, height: alto }} contentFit="cover" nativeControls={false} surfaceType="textureView" />
        {portada && status !== 'readyToPlay' ? <Image source={imagen(portada)} style={{ position: 'absolute', inset: 0 }} contentFit="cover" /> : null}
        {controles && !isPlaying && status === 'readyToPlay' ? (
          <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
            <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="play" size={28} color="#fff" style={{ marginLeft: 3 }} />
            </View>
          </View>
        ) : null}
      </Pressable>
      {controles ? <Pressable onPress={() => setMudo(m => !m)} hitSlop={10} accessibilityLabel={mudo ? 'Sound on' : 'Mute'}
        style={{ position: 'absolute', right: 10, bottom: 10, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={mudo ? 'volume-mute' : 'volume-high'} size={16} color={C.t1} />
      </Pressable> : null}
    </View>
  );
}
