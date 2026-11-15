/* Conversación en tiempo real con NOVA (API Live de Gemini a través de servidor/voz.mjs).
   · el micrófono se envía en PCM mientras hablas; NOVA detecta cuándo terminaste y responde en tu idioma
   · su voz llega por partes: cada ~0,35 s se escribe un WAV y se encola en una playlist, así empieza a hablar enseguida
   · `habla` (0..1) sigue la envolvente real de lo que está sonando y mueve el cuerpo y la luz de NOVA
   · en Android con el módulo de control (0.8+), la voz va directo a un AudioTrack nativo: suena apenas llega, sin
     archivos ni cola de reproductores (unos 200 ms menos hasta la primera palabra y sin cortes entre trozos)
   · mientras NOVA habla no se envía el micrófono (medio dúplex), para que no se escuche a sí misma
   Si el servidor no responde (puede estar despertando), reintenta 3 veces; recién entonces `estado` queda en
   'sin_conexion' y la pantalla usa el motor de reglas local. `reconectar()` vuelve a intentarlo a pedido. */
import { createAudioPlaylist, setAudioModeAsync, useAudioStream, type AudioPlaylist, type AudioStreamBuffer } from 'expo-audio';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { cambiar as cambiarVivo } from '../sensores/vivo';
import { NovaControl } from '../../modules/nova-control';

/** la voz por AudioTrack nativo (solo con el APK 0.8+; en web y en versiones viejas, la playlist de expo-audio) */
const PISTA = Platform.OS === 'android' && typeof NovaControl?.audioAbrir === 'function' ? NovaControl : null;

export type EstadoVivo = 'conectando' | 'listo' | 'sin_conexion';
export type Eventos = {
  /** texto que NOVA va diciendo (llega en trozos) */
  dice: (trozo: string) => void;
  /** transcripción de lo que dijiste por voz (llega en trozos) */
  oye: (trozo: string) => void;
  finTurno: () => void;
  /** puede devolver (o prometer) la respuesta para el modelo; si no, se le contesta { ok: true } */
  herramienta: (nombre: string, args: Record<string, unknown>) => void | Record<string, unknown> | Promise<Record<string, unknown> | void>;
  /** se perdió el servidor de voz: la pantalla pasa al motor local */
  sinConexion: () => void;
};

const HZ_SALIDA = 24000;
// el primer fragmento de cada respuesta es cortito para que NOVA empiece a hablar enseguida; los siguientes, más
// largos, para que no haya cortes
const PRIMERO = Math.round(HZ_SALIDA * 2 * 0.12), SEGMENTO = Math.round(HZ_SALIDA * 2 * 0.4);
const PASO = 0.025; // s por punto de envolvente

export function urlVivo() {
  // APK independiente: el puente vive en la nube (Fly) y pide una clave. Las dos se fijan al compilar (eas.json).
  if (process.env.EXPO_PUBLIC_VOZ_URL) {
    const k = process.env.EXPO_PUBLIC_VOZ_TOKEN;
    return process.env.EXPO_PUBLIC_VOZ_URL.replace(/^http/, 'ws') + '/vivo' + (k ? `?k=${encodeURIComponent(k)}` : '');
  }
  const host = Platform.OS === 'web' && typeof location !== 'undefined' ? location.hostname : (Constants.expoConfig?.hostUri ?? '').split(':')[0];
  return host ? `ws://${host}:8132/vivo` : null;
}

// ── base64 ⇄ bytes (sin dependencias) ──
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const INV = new Uint8Array(128); for (let i = 0; i < 64; i++) INV[B64.charCodeAt(i)] = i;
function aBase64(b: Uint8Array) {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return s;
}
function deBase64(s: string) {
  const l = s.length, pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0, out = new Uint8Array((l * 3) / 4 - pad);
  for (let i = 0, j = 0; i < l; i += 4) {
    const n = (INV[s.charCodeAt(i)] << 18) | (INV[s.charCodeAt(i + 1)] << 12) | (INV[s.charCodeAt(i + 2)] << 6) | INV[s.charCodeAt(i + 3)];
    if (j < out.length) out[j++] = (n >> 16) & 255;
    if (j < out.length) out[j++] = (n >> 8) & 255;
    if (j < out.length) out[j++] = n & 255;
  }
  return out;
}

function wav(pcm: Uint8Array, hz: number) {
  const b = new Uint8Array(44 + pcm.length), v = new DataView(b.buffer);
  const txt = (o: number, t: string) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
  txt(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); txt(8, 'WAVE'); txt(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, hz, true);
  v.setUint32(28, hz * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, pcm.length, true);
  b.set(pcm, 44);
  return b;
}

/** envolvente RMS de un fragmento PCM s16le (0..1, con ganancia para que la voz normal llegue a ~0,8) */
function envolvente(pcm: Uint8Array, hz: number) {
  const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength), n = Math.floor(hz * PASO), m = Math.floor(pcm.length / 2 / n), out: number[] = [];
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let k = 0; k < n; k++) { const x = v.getInt16((i * n + k) * 2, true) / 32768; s += x * x; }
    out.push(Math.min(1, Math.sqrt(s / n) * 5));
  }
  return out;
}

/** fuera del hook: el compilador de React no deja mutar objetos dentro de él */
function ponerMudo(p: AudioPlaylist | null, v: boolean) { if (p) p.muted = v; }

function nivelMic(buf: ArrayBuffer) {
  const v = new DataView(buf), n = Math.floor(buf.byteLength / 2);
  let s = 0;
  for (let i = 0; i < n; i += 4) { const x = v.getInt16(i * 2, true) / 32768; s += x * x; }
  return Math.min(1, Math.sqrt(s / Math.max(1, n / 4)) * 7);
}

/** micrófono en el navegador: un AudioWorklet pasa el audio a PCM s16le a 16 kHz en bloques de 2048 muestras */
const WORKLET = `class Pcm extends AudioWorkletProcessor {
  constructor() { super(); this.b = new Int16Array(2048); this.n = 0; }
  process(inputs) {
    const f = inputs[0][0];
    if (f) for (let i = 0; i < f.length; i++) {
      this.b[this.n++] = Math.max(-1, Math.min(1, f[i])) * 32767;
      if (this.n === this.b.length) { this.port.postMessage(this.b.buffer.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('pcm', Pcm);`;
async function capturaWeb(alBuffer: (b: AudioStreamBuffer) => void) {
  const medio = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const fuente = ctx.createMediaStreamSource(medio);
  const nodo = new AudioWorkletNode(ctx, 'pcm');
  nodo.port.onmessage = e => alBuffer({ data: e.data as ArrayBuffer, sampleRate: ctx.sampleRate, channels: 1, timestamp: ctx.currentTime });
  fuente.connect(nodo);
  return { parar: () => { nodo.port.onmessage = null; nodo.disconnect(); fuente.disconnect(); medio.getTracks().forEach(t => t.stop()); ctx.close(); } };
}

/** asistente: la capa que se abre sobre otras apps (src/asistente). NOVA responde en pocas palabras, no saluda y su voz
    no toca el foco de audio (la capa lo maneja: la música baja mientras te escucha y vuelve al cerrarla). */
export function useNovaVivo({ modo, datos, nombre, sol, idioma, perfil = 'mision', asistente = false, eventos }: { modo: 'chat' | 'checkin'; datos: string; nombre: string; sol: number; idioma: 'en' | 'es'; perfil?: 'mision' | 'diario'; asistente?: boolean; eventos: Eventos }) {
  const [estado, setEstado] = useState<EstadoVivo>(() => (urlVivo() ? 'conectando' : 'sin_conexion'));
  const estadoRef = useRef(estado);
  useEffect(() => { estadoRef.current = estado; }, [estado]);
  const porMandar = useRef<string[]>([]);
  const [hablando, setHablando] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const habla = useSharedValue(0), nivel = useSharedValue(0);
  const ws = useRef<WebSocket | null>(null);
  const ev = useRef(eventos);
  useEffect(() => { ev.current = eventos; });
  // cada cambio de `intento` abre una conexión nueva (reintentos automáticos y el botón de reconectar)
  const [intento, setIntento] = useState(0);
  const fallos = useRef(0);
  const reconectar = useCallback(() => { fallos.current = 0; setEstado('conectando'); setIntento(i => i + 1); }, []);

  // ── salida: fragmentos encolados en una playlist ──
  const lista = useRef<AudioPlaylist | null>(null);
  const pendiente = useRef<Uint8Array[]>([]);
  const pendienteLen = useRef(0);
  const segmentos = useRef<{ env: number[]; archivo: File | null }[]>([]);
  const finTurno = useRef(false);
  const sonando = useRef(false);
  const mudo = useRef(false);
  const ignorar = useRef(false); // tras interrumpir, se descarta el resto de esa respuesta
  const n = useRef(0);
  // camino nativo: la envolvente de todo lo escrito en este turno, cuadros escritos y desde dónde se mide la reproducción
  const envTotal = useRef<number[]>([]);
  const escritos = useRef(0), base = useRef(0);

  const limpiarSalida = useCallback(() => {
    if (PISTA) { try { base.current = PISTA.audioParar(); } catch {} escritos.current = 0; envTotal.current = []; }
    lista.current?.clear();
    segmentos.current.forEach(s => { try { s.archivo?.delete(); } catch {} });
    segmentos.current = [];
    pendiente.current = []; pendienteLen.current = 0;
    finTurno.current = false; sonando.current = false;
    habla.set(0); setHablando(false);
  }, [habla]);

  const encolar = useCallback(() => {
    if (!pendienteLen.current) return;
    const pcm = new Uint8Array(pendienteLen.current);
    let o = 0; pendiente.current.forEach(c => { pcm.set(c, o); o += c.length; });
    pendiente.current = []; pendienteLen.current = 0;
    const bytes = wav(pcm, HZ_SALIDA);
    let uri: string, archivo: File | null = null;
    if (Platform.OS === 'web') uri = `data:audio/wav;base64,${aBase64(bytes)}`;
    else { archivo = new File(Paths.cache, `nova-vivo-${n.current++}.wav`); archivo.write(bytes); uri = archivo.uri; }
    const p = lista.current ?? (lista.current = createAudioPlaylist({ updateInterval: 50 }));
    ponerMudo(p, mudo.current);
    p.add({ uri });
    segmentos.current.push({ env: envolvente(pcm, HZ_SALIDA), archivo });
    if (!p.playing) { p.skipTo(segmentos.current.length - 1); p.play(); }
    if (!sonando.current) { sonando.current = true; setHablando(true); }
  }, []);

  // la envolvente sigue lo que está sonando; cuando termina el último fragmento del turno, NOVA se calla
  useEffect(() => {
    const id = setInterval(() => {
      if (PISTA) {
        if (!sonando.current) return;
        let reproducidos = 0;
        try { reproducidos = PISTA.audioReproducido() - base.current; } catch {}
        habla.set(envTotal.current[Math.min(envTotal.current.length - 1, Math.floor(reproducidos / (HZ_SALIDA * PASO)))] ?? 0);
        if (finTurno.current && reproducidos >= escritos.current - HZ_SALIDA * 0.03) limpiarSalida();
        return;
      }
      const p = lista.current;
      if (!p || !sonando.current) return;
      const seg = segmentos.current[p.currentIndex];
      if (seg) habla.set(seg.env[Math.min(seg.env.length - 1, Math.floor((p.currentTime ?? 0) / PASO))] ?? 0);
      const ultimo = p.currentIndex >= segmentos.current.length - 1;
      if (finTurno.current && ultimo && !p.playing && !pendienteLen.current) limpiarSalida();
    }, 30);
    return () => clearInterval(id);
  }, [habla, limpiarSalida]);

  // ── conexión ──
  useEffect(() => {
    const url = urlVivo();
    if (!url) return;
    let vivo = true;
    let listo = false, reintento: ReturnType<typeof setTimeout> | undefined;
    const caer = () => {
      if (!vivo) return;
      vivo = false;
      clearTimeout(espera);
      // el servidor duerme cuando nadie lo usa: los primeros fallos se reintentan solos
      if (fallos.current < 3) { fallos.current++; setEstado('conectando'); reintento = setTimeout(() => setIntento(i => i + 1), 700 * fallos.current); return; }
      setEstado('sin_conexion'); ev.current.sinConexion();
    };
    const s = new WebSocket(url);
    ws.current = s;
    // hasta 'listo' (despertar el servidor + abrir la sesión con Gemini) puede tardar; se espera hasta 15 s
    const espera = setTimeout(() => { if (!listo) { caer(); s.close(); } }, 15000);
    // idioma: el de la app; NOVA parte en él y luego sigue el idioma en que le hables
    // en el chat NOVA no saluda: queda escuchando apenas conecta (el check-in sí parte con su pregunta)
    s.onopen = () => { if (s.readyState === 1) s.send(JSON.stringify({ tipo: 'inicio', modo, idioma, perfil, asistente, saludar: !asistente && (modo === 'checkin' || perfil === 'mision'), contexto: { nombre, sol, datos } })); };
    s.onmessage = e => {
      // una conexión ya cerrada (React monta dos veces en desarrollo) no debe hablar: si no, el saludo suena doble
      if (!vivo) return;
      const m = JSON.parse(String(e.data));
      if (m.tipo === 'listo') { listo = true; fallos.current = 0; clearTimeout(espera); setEstado('listo'); estadoRef.current = 'listo'; for (const q of porMandar.current.splice(0)) s.send(JSON.stringify({ tipo: 'texto', texto: q })); if (PISTA) { try { PISTA.audioAbrir(HZ_SALIDA); PISTA.audioVolumen(mudo.current ? 0 : 1); base.current = 0; } catch {} } else if (!lista.current) lista.current = createAudioPlaylist({ updateInterval: 50 }); }
      else if (m.tipo === 'audio') {
        if (ignorar.current) return;
        finTurno.current = false;
        const c = deBase64(m.data);
        if (PISTA) {
          // directo al AudioTrack: suena enseguida; la envolvente se calcula acá para mover a NOVA
          try { PISTA.audioEscribir(m.data); } catch { return; }
          escritos.current += c.length / 2;
          envTotal.current.push(...envolvente(c, HZ_SALIDA));
          if (!sonando.current) { sonando.current = true; setHablando(true); }
          return;
        }
        pendiente.current.push(c); pendienteLen.current += c.length;
        if (pendienteLen.current >= (segmentos.current.length ? SEGMENTO : PRIMERO)) encolar();
      } else if (m.tipo === 'dice') { if (!ignorar.current) ev.current.dice(m.texto); }
      else if (m.tipo === 'oye') ev.current.oye(m.texto);
      else if (m.tipo === 'fin_turno') { if (ignorar.current) { ignorar.current = false; ev.current.finTurno(); return; } encolar(); finTurno.current = true; ev.current.finTurno(); }
      else if (m.tipo === 'interrumpido') { ignorar.current = false; limpiarSalida(); }
      else if (m.tipo === 'herramienta') {
        Promise.resolve(ev.current.herramienta(m.nombre, m.args ?? {}))
          .catch(e => ({ ok: false, error: String((e as Error)?.message ?? e) }))
          .then(r => { if (s.readyState === 1) s.send(JSON.stringify({ tipo: 'herramienta', id: m.id, nombre: m.nombre, respuesta: r ?? { ok: true } })); });
      } else if (m.tipo === 'error') caer();
    };
    s.onerror = caer;
    s.onclose = caer;
    return () => { vivo = false; clearTimeout(espera); clearTimeout(reintento); s.onmessage = null; s.onerror = null; s.onclose = null; s.close(); limpiarSalida(); };
  }, [modo, nombre, sol, datos, idioma, perfil, asistente, encolar, limpiarSalida, intento]);

  useEffect(() => () => { limpiarSalida(); lista.current?.destroy(); lista.current = null; if (PISTA) { try { PISTA.audioCerrar(); } catch {} } }, [limpiarSalida]);

  // ── entrada: micrófono en PCM 16 kHz ──
  const alBuffer = useCallback((b: AudioStreamBuffer) => {
    const s = ws.current;
    // medio dúplex: mientras NOVA habla no se manda el micrófono. El fin del habla se revisa también acá (llega con
    // cada buffer, sin timers): si la actividad quedó en segundo plano y Android congeló los timers, igual se destraba
    if (sonando.current && PISTA && finTurno.current) {
      let reproducidos = 0;
      try { reproducidos = PISTA.audioReproducido() - base.current; } catch {}
      if (reproducidos >= escritos.current - HZ_SALIDA * 0.03) limpiarSalida();
    }
    if (sonando.current) { nivel.set(0); return; }
    nivel.set(nivelMic(b.data));
    if (s?.readyState === WebSocket.OPEN) s.send(JSON.stringify({ tipo: 'audio', data: aBase64(new Uint8Array(b.data)), rate: b.sampleRate }));
  }, [nivel, limpiarSalida]);
  const { stream } = useAudioStream({ sampleRate: 16000, channels: 1, encoding: 'int16', onBuffer: alBuffer });

  // en web, expo-audio no captura en streaming: se usa getUserMedia directo
  const web = useRef<{ parar: () => void } | null>(null);
  const escuchar = useCallback(async () => {
    cambiarVivo(() => ({ vozActiva: true }));
    if (Platform.OS === 'web') { web.current = await capturaWeb(alBuffer); setEscuchando(true); return; }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldRouteThroughEarpiece: false, ...(asistente ? { interruptionMode: 'mixWithOthers' as const, shouldPlayInBackground: true } : {}) });
    await stream.start();
    setEscuchando(true);
  }, [stream, alBuffer, asistente]);
  const dejarDeEscuchar = useCallback(() => {
    if (web.current) { web.current.parar(); web.current = null; } else stream.stop();
    nivel.set(0);
    setEscuchando(false);
    cambiarVivo(() => ({ vozActiva: false }));
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, ...(asistente ? { interruptionMode: 'mixWithOthers' as const, shouldPlayInBackground: true } : {}) }).catch(() => {});
  }, [stream, nivel, asistente]);
  useEffect(() => () => { try { stream.stop(); } catch {} }, [stream]);

  // si la conexión no está lista (conectando o reconectando), el texto espera y sale apenas llegue 'listo'.
  // Mandar por un socket cerrado lanza INVALID_STATE_ERR y cierra la app.
  const texto = useCallback((t: string) => {
    const s = ws.current;
    if (s?.readyState === WebSocket.OPEN && estadoRef.current === 'listo') { try { s.send(JSON.stringify({ tipo: 'texto', texto: t })); return; } catch {} }
    porMandar.current.push(t);
  }, []);
  /** datos en vivo para NOVA, sin pedirle que responda */
  const contexto = useCallback((t: string) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ tipo: 'contexto', texto: t })); }, []);
  /** un cuadro de la cámara (JPEG en base64): NOVA ve lo que le muestras mientras hablan */
  const imagen = useCallback((b64: string) => { if (ws.current?.readyState === WebSocket.OPEN && estadoRef.current === 'listo') ws.current.send(JSON.stringify({ tipo: 'imagen', data: b64 })); }, []);
  const silenciar = useCallback((v: boolean) => { mudo.current = v; ponerMudo(lista.current, v); if (PISTA) { try { PISTA.audioVolumen(v ? 0 : 1); } catch {} } }, []);
  const interrumpir = useCallback(() => { if (sonando.current) ignorar.current = true; limpiarSalida(); }, [limpiarSalida]);

  return { estado, hablando, escuchando, habla, nivel, escuchar, dejarDeEscuchar, texto, contexto, imagen, silenciar, interrumpir, reconectar };
}
