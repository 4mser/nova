/* Integraciones con cuenta (Spotify, GitHub): el OAuth y los tokens viven en la API; la app solo pide un enlace,
   abre el navegador y, al volver (nova://integracion?k=…), refresca. Spotify: lo que suena, tus playlists y control
   (play/pausa/siguiente, con Premium). GitHub: tus PRs, revisiones pendientes, issues asignados y lo de hoy. */
import { Linking } from 'react-native';
import { pedir } from './api';
import { invalidar, useConsulta } from './datos';

export type Proveedor = 'spotify' | 'github' | 'strava' | 'todoist' | 'linear' | 'notion' | 'google';
export const NOMBRE_PROV: Record<Proveedor, string> = { spotify: 'Spotify', github: 'GitHub', strava: 'Strava', todoist: 'Todoist', linear: 'Linear', notion: 'Notion', google: 'Google Tasks' };
export type EstadoInt = Partial<Record<Proveedor, { disponible: boolean; conectado: boolean; cuenta: string | null }>>;
export type Sonando = { sonando: boolean; titulo?: string; artista?: string; imagen?: string | null; avance?: number; duracion?: number; dispositivo?: string | null; url?: string | null };
export type Playlist = { id: string; nombre: string; imagen: string | null; canciones: number };
export type ItemGh = { titulo: string; url: string; repo: string; numero: number; actualizado: string };
export type CalendarioGh = { login: string; desde: string; total: number; dias: { fecha: string; n: number }[] };
export type UsuarioGh = { login: string; nombre: string | null; foto: string; bio: string | null; empresa: string | null; lugar: string | null; sitio: string | null; x: string | null; seguidores: number; siguiendo: number; repos: number; url: string; semana: number[]; ultimos: { tipo: string; repo: string; ts: number }[] };
export type ResumenGh = { login: string; prs: ItemGh[]; revisar: ItemGh[]; issues: ItemGh[]; errores?: string[]; hoy: { commits: number; contribuciones?: number; semana?: number[]; eventos: number; repos: string[] } };

export const useIntegraciones = (activo = true) => useConsulta<EstadoInt>(activo ? 'integraciones' : null, () => pedir('/v1/integraciones'), ['integracion']);
export async function conectar(p: Proveedor) {
  const { url } = await pedir<{ url: string }>(`/v1/integraciones/${p}/enlace`, { metodo: 'POST' });
  await Linking.openURL(url);
}
export async function desconectar(p: Proveedor) { await pedir(`/v1/integraciones/${p}`, { metodo: 'DELETE' }); invalidar('integracion'); }
export const refrescarIntegraciones = () => invalidar('integracion');

// cada integración se refresca por separado (tocar play en Spotify no vuelve a pedir lo de GitHub)
export const useSpotifyAhora = (activo: boolean) => useConsulta<Sonando>(activo ? 'spotify:ahora' : null, () => pedir('/v1/spotify/ahora'), ['spotify']);
export const usePlaylists = (activo: boolean) => useConsulta<Playlist[]>(activo ? 'spotify:playlists' : null, () => pedir('/v1/spotify/playlists'), ['spotify']);
export async function controlSpotify(accion: 'play' | 'pause' | 'next' | 'previous', playlist?: string) {
  await pedir('/v1/spotify/control', { metodo: 'POST', json: { accion, playlist } });
  setTimeout(() => invalidar('spotify'), 700);
}
export const useGithub = (activo: boolean) => useConsulta<ResumenGh>(activo ? 'github:resumen' : null, () => pedir(`/v1/github/resumen?tz=${new Date().getTimezoneOffset()}`), ['github']);
