/* Música de foco: al empezar una sesión, NOVA abre la playlist elegida en Spotify o en YouTube Music (un enlace; con
   Spotify conectado en Integraciones también se elige de tus playlists y se controla desde NOVA). Playlists editoriales
   de Spotify, la tuya de Spotify o la tuya de YouTube Music pegando su enlace. La elección se recuerda. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { useSyncExternalStore } from 'react';

export type Musica = { id: string; nombre: string; playlist?: string };
export const PLAYLISTS: Musica[] = [
  { id: 'nada', nombre: 'No music' },
  { id: 'deep', nombre: 'Deep Focus', playlist: '37i9dQZF1DWZeKCadgRdKQ' },
  { id: 'lofi', nombre: 'Lofi Beats', playlist: '37i9dQZF1DWWQRwui0ExPn' },
  { id: 'piano', nombre: 'Peaceful Piano', playlist: '37i9dQZF1DX4sWSpwq3LiO' },
];
const CLAVE = 'nova.musica.v1';
let inst: { elegida: string; propia?: string; propiaNombre?: string; yt?: string } = { elegida: 'nada' };
const oyentes = new Set<() => void>();
const poner = (n: typeof inst) => { inst = n; oyentes.forEach(o => o()); AsyncStorage.setItem(CLAVE, JSON.stringify(n)).catch(() => {}); };

export async function cargarMusica() {
  try { const t = await AsyncStorage.getItem(CLAVE); if (t) { inst = JSON.parse(t); oyentes.forEach(o => o()); } } catch {}
}
export const elegirMusica = (id: string) => poner({ ...inst, elegida: id });

/** acepta un enlace de Spotify (open.spotify.com/playlist/… o spotify:playlist:…) o de YouTube Music / YouTube
    (…playlist?list=…); devuelve false si no lo reconoce */
export function guardarPropia(enlace: string) {
  const yt = enlace.match(/[?&]list=([A-Za-z0-9_-]{10,})/);
  if (yt && /youtu/.test(enlace)) { poner({ ...inst, elegida: 'yt', yt: yt[1] }); return true; }
  const m = enlace.match(/playlist[/:]([A-Za-z0-9]{10,})/);
  if (!m) return false;
  poner({ ...inst, elegida: 'propia', propia: m[1], propiaNombre: undefined });
  return true;
}
/** una de tus playlists de Spotify (desde la cuenta conectada) */
export const elegirDeSpotify = (id: string, nombre: string) => poner({ ...inst, elegida: 'propia', propia: id, propiaNombre: nombre });

export async function abrirMusica() {
  if (inst.elegida === 'yt' && inst.yt) { Linking.openURL(`https://music.youtube.com/playlist?list=${inst.yt}`).catch(() => {}); return; }
  const id = inst.elegida === 'propia' ? inst.propia : PLAYLISTS.find(p => p.id === inst.elegida)?.playlist;
  if (!id) return;
  try { await Linking.openURL(`spotify:playlist:${id}`); }
  catch { Linking.openURL(`https://open.spotify.com/playlist/${id}`).catch(() => {}); }
}

export const leerMusica = () => inst;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useMusica() { return useSyncExternalStore(suscribir, leerMusica, leerMusica); }
