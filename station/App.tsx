/* NOVA Station · APK para la tablet común de la nave (vertical, siempre encendida).

   La app es liviana a propósito: abre la interfaz de NOVA Station que sirve la nave (station.html) en una WebView a
   pantalla completa, así cada mejora de la nave llega sola a la tablet. Lo nativo es solo lo que una página no puede:
   · el micrófono (Android no da micrófono a una página http): NOVA pide escuchar, la app graba AAC, lo manda a /v1/oir
     de la nave (que lo pasa a WAV y a whisper) y le devuelve el texto a la página;
   · vibrar al pasar la tarjeta o al levantar a NOVA;
   · leer el QR personal de un tripulante con la cámara frontal (la página pide «escanearQR» y recibe el texto);
   · modo quiosco: pantalla encendida, barras del sistema ocultas, vertical.
   Las tarjetas NFC las lee un lector externo que avisa directo a la nave (POST /v1/nfc); la tablet se entera por el
   enlace. Ajustes (dirección de la nave y nombre del lector): 5 toques seguidos en la esquina superior izquierda. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import * as NavigationBar from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

const C = { bg: '#05080c', s1: '#0a0f15', s2: '#0f151d', l2: 'rgba(255,255,255,0.14)', t1: '#f2f5f8', t2: '#a5afbd', t3: '#6d7786', ac: '#8fe6f5', nv: '#a898ff', al: '#ec6aa8', ok: '#6fd6b0' };
const CLAVE = 'nova-station:config';
type Config = { nave: string; lector: string };

const limpiarNave = (s: string) => {
  let u = s.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//.test(u)) u = 'http://' + u;
  if (u && !/:\d+$/.test(u.replace(/^https?:\/\//, ''))) u += ':8750';
  return u;
};

export default function App() {
  useKeepAwake();
  const [config, setConfig] = useState<Config | null>(null);
  const [cargada, setCargada] = useState(false);
  const [ajustes, setAjustes] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden').catch(() => {});
    }
    AsyncStorage.getItem(CLAVE).then(v => {
      const c = v ? (JSON.parse(v) as Config) : null;
      setConfig(c); setAjustes(!c?.nave); setCargada(true);
    }).catch(() => { setAjustes(true); setCargada(true); });
  }, []);

  if (!cargada) return <View style={s.fondo} />;
  return (
    <View style={s.fondo}>
      <StatusBar hidden />
      {ajustes || !config ? (
        <Ajustes inicial={config} alGuardar={async c => { await AsyncStorage.setItem(CLAVE, JSON.stringify(c)); setConfig(c); setAjustes(false); }} alCancelar={config ? () => setAjustes(false) : undefined} />
      ) : (
        <Station config={config} abrirAjustes={() => setAjustes(true)} />
      )}
    </View>
  );
}

function Station({ config, abrirAjustes }: { config: Config; abrirAjustes: () => void }) {
  const web = useRef<WebView>(null);
  const [error, setError] = useState<string | null>(null);
  const [clave, setClave] = useState(0);
  const url = `${config.nave}/station.html?lector=${encodeURIComponent(config.lector || 'station')}`;

  const aLaPagina = useCallback((msg: object) => {
    web.current?.injectJavaScript(`window.novaApp && window.novaApp(${JSON.stringify(msg)}); true;`);
  }, []);

  // micrófono nativo: graba hasta 1,2 s de silencio después de hablar (o 20 s), y manda el audio a la nave
  const rec = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const grabando = useRef(false), reloj = useRef<ReturnType<typeof setInterval> | null>(null);
  const terminar = useCallback(async (enviar: boolean) => {
    if (!grabando.current) return;
    grabando.current = false;
    if (reloj.current) { clearInterval(reloj.current); reloj.current = null; }
    try { await rec.stop(); } catch {}
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    const uri = rec.uri;
    if (!enviar || !uri) { aLaPagina({ tipo: 'oido', texto: '' }); return; }
    try {
      const r = await FileSystem.uploadAsync(`${config.nave}/v1/oir`, uri, {
        httpMethod: 'POST', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, headers: { 'content-type': 'audio/mp4' },
      });
      const j = r.status === 200 ? JSON.parse(r.body) : null;
      aLaPagina(j ? { tipo: 'oido', texto: j.texto || '' } : { tipo: 'error', texto: 'NOVA could not hear that' });
    } catch {
      aLaPagina({ tipo: 'error', texto: 'The ship is not answering' });
    }
    FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }, [rec, config.nave, aLaPagina]);

  const escuchar = useCallback(async () => {
    if (grabando.current) { terminar(true); return; }
    const p = await requestRecordingPermissionsAsync().catch(() => null);
    if (!p?.granted) { aLaPagina({ tipo: 'error', texto: 'Allow the microphone for NOVA Station in Android settings' }); return; }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await rec.prepareToRecordAsync();
      rec.record();
    } catch (e) { aLaPagina({ tipo: 'error', texto: String((e as Error).message || e) }); return; }
    grabando.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    let hayVoz = false, tVoz = Date.now();
    const t0 = Date.now();
    reloj.current = setInterval(() => {
      const st = rec.getStatus();
      const nivel = st.metering !== undefined ? Math.max(0, Math.min(1, (st.metering + 60) / 60)) : 0;
      aLaPagina({ tipo: 'nivel', v: nivel });
      if (nivel > 0.45) { hayVoz = true; tVoz = Date.now(); }
      if ((hayVoz && Date.now() - tVoz > 1200) || Date.now() - t0 > 20000) terminar(hayVoz);
      else if (!hayVoz && Date.now() - t0 > 7000) terminar(false); // nadie habló
    }, 120);
  }, [rec, terminar, aLaPagina]);

  // QR personal: cámara frontal (la que mira a quien está frente a la tablet), se cierra sola a los 40 s
  const [qrAbierto, setQrAbierto] = useState(false), [permCam, pedirCam] = useCameraPermissions();
  const qrLeido = useRef(false), qrReloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cerrarQR = useCallback((avisarPagina = true) => {
    setQrAbierto(false); if (qrReloj.current) clearTimeout(qrReloj.current);
    if (avisarPagina) aLaPagina({ tipo: 'qrCerrado' });
  }, [aLaPagina]);
  const escanearQR = useCallback(async () => {
    const p = permCam?.granted ? permCam : await pedirCam();
    if (!p?.granted) { aLaPagina({ tipo: 'error', texto: 'Allow the camera for NOVA Station in Android settings' }); return; }
    qrLeido.current = false; setQrAbierto(true); aLaPagina({ tipo: 'qrAbierto' });
    if (qrReloj.current) clearTimeout(qrReloj.current);
    qrReloj.current = setTimeout(() => cerrarQR(), 40000);
  }, [permCam, pedirCam, aLaPagina, cerrarQR]);

  const alMensaje = useCallback((e: WebViewMessageEvent) => {
    let m: { tipo?: string; ms?: number }; try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.tipo === 'escanearQR') { escanearQR(); return; }
    if (m.tipo === 'escuchar') escuchar();
    else if (m.tipo === 'parar') terminar(true);
    else if (m.tipo === 'vibrar') Haptics.impactAsync(m.ms && m.ms < 40 ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, [escuchar, terminar, escanearQR]);

  // 5 toques en la esquina superior izquierda abren los ajustes
  const toques = useRef<number[]>([]);
  const esquina = () => {
    const ahora = Date.now();
    toques.current = [...toques.current.filter(t => ahora - t < 3000), ahora];
    if (toques.current.length >= 5) { toques.current = []; abrirAjustes(); }
  };

  return (
    <View style={s.fondo}>
      <WebView
        key={clave}
        ref={web}
        source={{ uri: url }}
        style={s.fondo}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        mixedContentMode="always"
        overScrollMode="never"
        setBuiltInZoomControls={false}
        textZoom={100}
        cacheEnabled
        onMessage={alMensaje}
        onLoadStart={() => setError(null)}
        onError={e => setError(e.nativeEvent.description || 'The ship is not answering')}
        onHttpError={e => setError(`The ship answered ${e.nativeEvent.statusCode}`)}
        renderLoading={() => <View style={[s.fondo, s.centro]}><ActivityIndicator color={C.ac} /></View>}
        startInLoadingState
      />
      <Pressable onPress={esquina} style={s.esquina} accessibilityLabel="Settings (tap 5 times)" />
      {qrAbierto && (
        <View style={[StyleSheet.absoluteFill, s.centro, { backgroundColor: 'rgba(4,7,11,0.94)', padding: 40, gap: 22 }]}>
          <Text style={s.titulo}>Show your QR</Text>
          <Text style={[s.texto, { textAlign: 'center' }]}>NOVA app → Settings → Mission mode → Ship link → My station QR</Text>
          <View style={s.camara}>
            <CameraView style={StyleSheet.absoluteFill} facing="front" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => {
                if (qrLeido.current || !data) return;
                qrLeido.current = true; Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                cerrarQR(false); aLaPagina({ tipo: 'qr', texto: data });
              }} />
            <View pointerEvents="none" style={s.marcoQR} />
          </View>
          <Boton texto="Cancel" onPress={() => cerrarQR()} />
        </View>
      )}
      {error && (
        <View style={[StyleSheet.absoluteFill, s.centro, { backgroundColor: C.bg, padding: 40, gap: 18 }]}>
          <Text style={s.titulo}>Can't reach the ship</Text>
          <Text style={s.texto}>{error}{'\n'}{config.nave}</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Boton texto="Try again" pri onPress={() => { setError(null); setClave(k => k + 1); }} />
            <Boton texto="Settings" onPress={abrirAjustes} />
          </View>
        </View>
      )}
    </View>
  );
}

function Ajustes({ inicial, alGuardar, alCancelar }: { inicial: Config | null; alGuardar: (c: Config) => void; alCancelar?: () => void }) {
  const [nave, setNave] = useState(inicial?.nave || '');
  const [lector, setLector] = useState(inicial?.lector || 'station');
  const [prueba, setPrueba] = useState<{ ok: boolean; txt: string } | null>(null);
  const probar = async () => {
    const u = limpiarNave(nave);
    setPrueba({ ok: false, txt: 'Checking…' });
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(`${u}/v1/sesion?lector=${encodeURIComponent(lector || 'station')}`, { signal: ctl.signal });
      clearTimeout(t);
      const j = await r.json();
      setPrueba({ ok: true, txt: `Ship found · ${j.tarjetas ?? 0} crew cards linked` });
    } catch { setPrueba({ ok: false, txt: 'No answer. Check the address and that the tablet is on the ship network.' }); }
  };
  return (
    <View style={[s.fondo, { padding: 48, gap: 22, justifyContent: 'center' }]}>
      <Text style={s.titulo}>NOVA Station</Text>
      <Text style={s.texto}>The shared tablet of the ship. It opens NOVA Station from the ship's computer on this network. Crew cards are read by the external reader, which reports straight to the ship.</Text>
      <Text style={s.lbl}>SHIP ADDRESS</Text>
      <TextInput value={nave} onChangeText={setNave} placeholder="192.168.1.20:8750" placeholderTextColor={C.t3} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={s.input} />
      <Text style={s.lbl}>READER NAME</Text>
      <TextInput value={lector} onChangeText={setLector} placeholder="station" placeholderTextColor={C.t3} autoCapitalize="none" autoCorrect={false} style={s.input} />
      <Text style={[s.texto, { fontSize: 15 }]}>Use the same name the card reader sends as "lector". One reader per tablet.</Text>
      {prueba && <Text style={[s.texto, { color: prueba.ok ? C.ok : C.al }]}>{prueba.txt}</Text>}
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        <Boton texto="Test" onPress={probar} />
        <Boton texto="Save and open" pri onPress={() => { const u = limpiarNave(nave); if (u) alGuardar({ nave: u, lector: (lector || 'station').replace(/[^a-zA-Z0-9-]/g, '') || 'station' }); }} />
        {alCancelar && <Boton texto="Cancel" onPress={alCancelar} />}
      </View>
    </View>
  );
}

function Boton({ texto, onPress, pri }: { texto: string; onPress: () => void; pri?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.boton, pri && { backgroundColor: C.t1, borderColor: C.t1 }, pressed && { opacity: 0.7 }]}>
      <Text style={[s.botonTxt, pri && { color: C.bg }]}>{texto}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: C.bg },
  centro: { alignItems: 'center', justifyContent: 'center' },
  esquina: { position: 'absolute', top: 0, left: 0, width: 64, height: 64 },
  camara: { width: 520, maxWidth: '100%', aspectRatio: 1, borderRadius: 32, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: 'rgba(168,152,255,0.5)' },
  marcoQR: { position: 'absolute', left: '18%', top: '18%', right: '18%', bottom: '18%', borderRadius: 24, borderWidth: 3, borderColor: 'rgba(143,230,245,0.85)' },
  titulo: { color: C.t1, fontSize: 40, fontWeight: '600', letterSpacing: -1 },
  texto: { color: C.t2, fontSize: 18, lineHeight: 27, textAlign: 'left' },
  lbl: { color: C.t3, fontSize: 14, fontWeight: '600', letterSpacing: 1.5, marginBottom: -12 },
  input: { height: 64, borderRadius: 32, paddingHorizontal: 24, backgroundColor: C.s2, borderWidth: 1, borderColor: C.l2, color: C.t1, fontSize: 20 },
  boton: { height: 64, paddingHorizontal: 30, borderRadius: 32, borderWidth: 1, borderColor: C.l2, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center' },
  botonTxt: { color: C.t1, fontSize: 18, fontWeight: '600' },
});
