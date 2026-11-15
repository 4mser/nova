/* Lo nuevo de NOVA: cuando la app se actualiza, NOVA cuenta con su voz qué cambió (src/app/novedades.tsx).
   Cada versión trae lo que NOVA dice al abrir y sus tarjetas; se muestra una vez, la primera vez que abres la app
   después de actualizar. Quien recién instala no la ve (parte con el recorrido, que ya lo muestra todo).
   Para una versión nueva: agregar una entrada AL INICIO de VERSIONES (con id nuevo) y sus textos en i18n. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Ionicons } from '@expo/vector-icons';
import { useSyncExternalStore } from 'react';
import { NovaControl } from '../../modules/nova-control';

export type Novedad = {
  icono: keyof typeof Ionicons.glyphMap;
  color: 'nova' | 'ok' | 'lila' | 'aviso';
  titulo: string;
  texto: string;
  /** lo que NOVA dice al mostrar esta tarjeta */
  dice: string;
  /** frases para probar, como chips */
  ejemplos?: string[];
  /** botón de la tarjeta */
  accion?: { texto: string; hacer: 'activar_asistente' | 'probar_asistente' | string };
  /** solo si el teléfono tiene el módulo de control (Android 0.6+) */
  soloControl?: boolean;
};
export type Version = { id: string; dice: string; novedades: Novedad[] };

export const VERSIONES: Version[] = [
  {
    id: '0.9.3',
    dice: 'I fixed how I close: hold the bubble, drop it at the bottom, or press back.',
    novedades: [
      {
        icono: 'close-circle-outline', color: 'nova', soloControl: true,
        titulo: 'I never get stuck again',
        texto: 'Hold the bubble to close me, or drag it to the bottom of the screen. With the full layer open, the back button closes me. And if I ever freeze, I let your taps through and close myself in a few seconds.',
        dice: 'Hold the bubble to close me, or press back.',
        ejemplos: ['Hold the bubble', 'Drag it to the bottom', 'Back button'],
      },
    ],
  },
  {
    id: '0.9.0',
    dice: 'I just updated. Now I stay with you in any app, and I can use it for you.',
    novedades: [
      {
        icono: 'ellipse-outline', color: 'nova', soloControl: true,
        titulo: 'I stay as a bubble',
        texto: 'When I open an app for you, I shrink to a small bubble that does not cover it. I keep listening and talking: drag it wherever you want, tap it to grow back.',
        dice: 'When I open an app, I shrink to a bubble and keep listening.',
        ejemplos: ['«Open Gmail»', '«Shrink»'],
        accion: { texto: 'Allow «over other apps»', hacer: 'permitir_sobreponer' },
      },
      {
        icono: 'hand-left-outline', color: 'lila', soloControl: true,
        titulo: 'I use your apps for you',
        texto: 'I see what is on screen and tap, type and scroll for you, step by step: the latest email, a search, a reply. Turn me on in Accessibility.',
        dice: 'With accessibility on, I use your apps for you.',
        ejemplos: ['«Open the latest email»', '«Search lo-fi on YouTube»', '«Reply to that»'],
        accion: { texto: 'Turn on in Accessibility', hacer: 'activar_accesibilidad' },
      },
      {
        icono: 'notifications-outline', color: 'ok', soloControl: true,
        titulo: 'Any notification, and your alarms',
        texto: '«What does the last notification say?» I read it from any app and open it if you ask. And I remember the alarms I set, so I can turn them off by name.',
        dice: 'I read any notification and I remember your alarms.',
        ejemplos: ['«What does the last notification say?»', '«Open it»', '«Turn off the alarm ir a Codegua»'],
      },
      {
        icono: 'scan-outline', color: 'aviso', soloControl: true,
        titulo: '«What does this say?»',
        texto: 'With an email, a page or a chat on screen, ask me to read it, summarize it or translate it. If it is a picture, I look at the screen.',
        dice: 'Ask me what something on screen says.',
        ejemplos: ['«Read me this email»', '«Summarize this»', '«What is in this photo?»'],
      },
    ],
  },
  {
    id: '0.8.0',
    dice: 'I just updated. Now I see, I reply for you, and I stay with you.',
    novedades: [
      {
        icono: 'eye', color: 'nova', soloControl: true,
        titulo: 'I see what you show me',
        texto: 'Say «look at this» and point the camera: I tell you what it is, read it, translate it or add it up, while we talk.',
        dice: 'Say look at this and I see through the camera.',
        ejemplos: ['«Look at this, what is it?»', '«Translate this menu»', '«How much is all this?»'],
        accion: { texto: 'Try it now', hacer: 'probar_asistente' },
      },
      {
        icono: 'logo-whatsapp', color: 'ok', soloControl: true,
        titulo: 'WhatsApp without opening it',
        texto: 'If someone wrote you, I read it to you and send your reply straight to that chat. For everything else, the chat opens with the message ready.',
        dice: 'If someone wrote you, I read it and send your reply right there.',
        ejemplos: ['«What did Benja write?»', '«Reply that I am on my way»'],
      },
      {
        icono: 'albums', color: 'lila', soloControl: true,
        titulo: 'I stay on top of your apps',
        texto: 'When I open an app for you, I shrink to a small floating window and keep listening. If two contacts sound alike, I show them with their photo so you pick.',
        dice: 'When I open an app, I shrink and keep listening.',
      },
      {
        icono: 'moon', color: 'aviso', soloControl: true,
        titulo: 'Locked phone and do not disturb',
        texto: 'I answer with the phone locked, and I switch silent, vibrate or do not disturb when you ask.',
        dice: 'And I work with the phone locked.',
        ejemplos: ['«Put me on silent»', '«Do not disturb me»'],
      },
    ],
  },
  {
    id: '0.7.0',
    dice: 'I just updated. Now I can write to your people for you.',
    novedades: [
      {
        icono: 'logo-whatsapp', color: 'ok', soloControl: true,
        titulo: 'I write your messages',
        texto: 'Tell me who and what. I write it the way you would, read it to you and change whatever you want. When you say yes, the chat opens with the message ready: one tap and it is sent. WhatsApp, SMS or email.',
        dice: 'Tell me who to write to and what. I write it like you, read it to you, and you only confirm.',
        ejemplos: ['«Tell mom I will be late for lunch»', '«Wish Benja a happy birthday on WhatsApp»', '«Make it more formal»'],
        accion: { texto: 'Try it now', hacer: 'probar_asistente' },
      },
      {
        icono: 'call', color: 'nova', soloControl: true,
        titulo: 'Calls and directions',
        texto: 'I call any of your contacts and take you anywhere with Google Maps or Waze, by car, walking, bike or public transport.',
        dice: 'I also call whoever you want and take you anywhere.',
        ejemplos: ['«Call Luis»', '«Take me home»', '«How do I get to Costanera by metro?»'],
      },
    ],
  },
  {
    id: '0.6.0',
    dice: 'I just updated. Now I can help you outside the app.',
    novedades: [
      {
        icono: 'radio-button-on', color: 'nova', soloControl: true,
        titulo: 'Call me from any app',
        texto: 'Hold the power button, tap the NOVA tile in Quick Settings or «Listen to me» on the app icon. I open on top of whatever you are using.',
        dice: 'Call me from any app: hold the power button and I am listening.',
        accion: { texto: 'Turn it on', hacer: 'activar_asistente' },
      },
      {
        icono: 'musical-notes', color: 'ok', soloControl: true,
        titulo: 'Your music, by voice',
        texto: 'Pause, skip, ask what is playing, or tell me what you want to hear in Spotify or YouTube Music.',
        dice: 'Ask me for your music: pause, next, or whatever you want to hear on Spotify or YouTube Music.',
        ejemplos: ['«Pause»', '«Next song»', '«Play Lateralus by Tool on Spotify»'],
      },
      {
        icono: 'camera', color: 'lila', soloControl: true,
        titulo: 'Camera, apps and flashlight',
        texto: 'I open the camera (photo, video or selfie), any app by its name, the flashlight and the volume.',
        dice: 'And I open the camera, your apps and the flashlight with your voice.',
        ejemplos: ['«Open the camera for a selfie»', '«Open WhatsApp»', '«Turn on the flashlight»'],
        accion: { texto: 'Try it now', hacer: 'probar_asistente' },
      },
    ],
  },
];

/** las tarjetas de una versión que aplican a este teléfono */
export const novedadesDe = (v: Version) => v.novedades.filter(n => !n.soloControl || !!NovaControl);
/** la versión más nueva con algo que mostrar en este teléfono */
export const ultimaVersion = () => VERSIONES.find(v => novedadesDe(v).length > 0) ?? null;

const CLAVE = 'nova.novedades.vistas.v1';
let vista: string | null | undefined; // undefined: sin cargar · null: nunca vio ninguna
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach(o => o());

export async function cargarNovedades() {
  try { vista = await AsyncStorage.getItem(CLAVE); } catch { vista = null; }
  avisar();
}
export function marcarNovedadesVistas() {
  const u = ultimaVersion();
  if (!u) return;
  vista = u.id;
  AsyncStorage.setItem(CLAVE, u.id).catch(() => {});
  avisar();
}
/** lo que toca mostrar: todo lo de las versiones que no has visto (si saltaste varias, juntas), con la voz y el número
    de la más nueva. Sin nada pendiente (abierta desde Ajustes): la última versión. */
export function porMostrar(): Version | null {
  const u = ultimaVersion();
  if (!u) return null;
  const hasta = VERSIONES.findIndex(v => v.id === vista);
  const pendientes = (hasta < 0 ? VERSIONES : VERSIONES.slice(0, hasta)).flatMap(novedadesDe);
  return { id: u.id, dice: u.dice, novedades: pendientes.length ? pendientes : novedadesDe(u) };
}

/** hay novedades sin ver (false mientras no se ha leído qué viste) */
export const hayNovedades = () => vista !== undefined && !!ultimaVersion() && vista !== ultimaVersion()!.id;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useHayNovedades() { return useSyncExternalStore(suscribir, hayNovedades, hayNovedades); }
