/* Lo que NOVA dice fuera de la conversación (Hoy, el recorrido, el respaldo sin conexión), SIEMPRE con su voz real:
   el servidor de voz convierte el texto con la misma voz de las conversaciones (/decir). Nunca se usa la voz robótica
   del teléfono: si la voz de NOVA no está disponible, se queda en silencio y el texto se lee en pantalla.
   · preparar(texto): la descarga apenas se sabe qué va a decir (así, al decirlo, suena al tiro)
   · decir(texto): la dice (corta lo anterior); las frases ya escuchadas quedan guardadas en el teléfono
   · useDiciendo(): si está hablando, para que su cuerpo y su luz acompañen */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { idiomaActual } from '../i18n';

const BASE = process.env.EXPO_PUBLIC_VOZ_URL?.replace(/\/$/, '') ?? null;
const TOKEN = process.env.EXPO_PUBLIC_VOZ_TOKEN ?? '';
export const vozNovaDisponible = () => !!BASE;

const listos = new Map<string, Promise<string | null>>(); // texto → uri local (o la URL en web)
let player: AudioPlayer | null = null, actual = 0, hablando = false;
const oyentes = new Set<() => void>();
const poner = (v: boolean) => { if (hablando !== v) { hablando = v; oyentes.forEach(o => o()); } };

/** nombre de archivo estable para un texto (hash simple) */
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

export function preparar(texto: string): Promise<string | null> {
  const t = texto.trim(), idioma = idiomaActual(), clave = `${idioma}|${t}`;
  if (!BASE || !t) return Promise.resolve(null);
  const ya = listos.get(clave);
  if (ya) return ya;
  const url = `${BASE}/decir?i=${idioma}&k=${encodeURIComponent(TOKEN)}&t=${encodeURIComponent(t)}`;
  const p = (async () => {
    if (Platform.OS === 'web') { const r = await fetch(url); return r.ok ? URL.createObjectURL(await r.blob()) : null; }
    const f = new File(Paths.cache, `nova-dice-${idioma}-${hash(t)}.wav`);
    if (f.exists && f.size > 1000) return f.uri;
    const r = await fetch(url);
    if (!r.ok) return null;
    f.write(new Uint8Array(await r.arrayBuffer()));
    return f.uri;
  })().catch(() => null);
  p.then(u => { if (!u) listos.delete(clave); });
  listos.set(clave, p);
  return p;
}

let terminar: (() => void) | null = null;
/** suena un audio ya preparado y se resuelve al terminar (o si lo cortan) */
async function sonar(uri: string, yo: number) {
  await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  if (yo !== actual) return;
  await new Promise<void>(listo => {
    const p = createAudioPlayer({ uri });
    player = p; terminar = listo;
    // (los tipos públicos no exponen addListener, aunque el objeto nativo lo tiene)
    (p as unknown as { addListener: (e: 'playbackStatusUpdate', f: (s: { playing: boolean; didJustFinish: boolean }) => void) => void }).addListener('playbackStatusUpdate', s => {
      if (player !== p) return;
      if (s.didJustFinish) { p.remove(); player = null; terminar = null; listo(); }
      else poner(s.playing);
    });
    p.play();
    poner(true);
  });
}

export async function decir(texto: string) {
  const yo = ++actual;
  callar(false);
  const uri = await preparar(texto);
  if (!uri || yo !== actual) return false;
  await sonar(uri, yo);
  if (yo === actual) poner(false);
  return true;
}

/** varias frases seguidas: se preparan todas a la vez y suena cada una apenas está lista y terminó la anterior.
    `alDecir(i)` avisa qué frase empieza (para mostrarla en pantalla al mismo tiempo) */
export async function decirSeguido(frases: string[], alDecir?: (i: number) => void) {
  const yo = ++actual;
  callar(false);
  const listos = frases.map(f => preparar(f));
  for (let i = 0; i < frases.length; i++) {
    const uri = await listos[i];
    if (yo !== actual) return false;
    alDecir?.(i);
    if (uri) await sonar(uri, yo);
    if (yo !== actual) return false;
  }
  poner(false);
  return true;
}

export function callar(cancelar = true) {
  if (cancelar) actual++;
  if (player) { try { player.pause(); player.remove(); } catch {} player = null; }
  if (terminar) { const f = terminar; terminar = null; f(); }
  poner(false);
}

const leer = () => hablando;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useDiciendo() { return useSyncExternalStore(suscribir, leer, leer); }
