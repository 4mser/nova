/* Tu sesión: quién eres en NOVA y tus crews. Se carga al abrir la app (con el token guardado) y se refresca cuando
   algo cambia en la crew (tiempo real). Sin sesión, la app muestra la pantalla de entrada. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { cambiarNombre, leerPerfil } from '../engine/perfil';
import { alVencerSesion, API, guardarToken, leerToken, pedir, tokenActual, usuarioDelToken } from './api';
import { reportarError } from './errores';
import { borrarPush } from './push';

export type Redes = Partial<Record<'github' | 'linkedin' | 'instagram' | 'x' | 'sitio', string>>;
export type Usuario = { id: string; nombre: string; foto: string | null; email?: string; /** tus redes, como usuario (el enlace se arma en el cliente) */ redes?: Redes };
export type Miembro = Usuario & { rol: 'admin' | 'miembro'; unido: number };
export type Crew = {
  id: string; nombre: string; codigo: string; zona: string; soyAdmin: boolean; miembros: Miembro[];
  /** el día en la zona de la crew: su momento NOVA (instante) y quiénes ya compartieron foto */
  hoy: { fecha: string; momento: number; subieron: string[] };
};

type Estado = { listo: boolean; usuario: Usuario | null; crews: Crew[]; crewId: string | null; sinConexion: boolean };
let estado: Estado = { listo: false, usuario: null, crews: [], crewId: null, sinConexion: false };
const oyentes = new Set<() => void>();
const poner = (c: Partial<Estado>) => { estado = { ...estado, ...c }; oyentes.forEach(o => o()); };
const CACHE = 'nova.sesion.yo', CREW = 'nova.sesion.crew';

/* un 401 no basta para echar a nadie: se confirma con /v1/yo un momento después. Solo si la API vuelve a decir que
   la sesión no vale (clave cambiada, cuenta borrada) se cierra; y se reporta por qué, para poder revisarlo. */
let confirmando = false;
alVencerSesion(async ruta => {
  if (!estado.usuario || confirmando) return;
  confirmando = true;
  try {
    await new Promise(r => setTimeout(r, 1200));
    const tk = tokenActual();
    const r = await fetch(`${API}/v1/yo`, { headers: tk ? { authorization: `Bearer ${tk}` } : {} }).catch(() => null);
    if (r?.status === 401) {
      reportarError(new Error(`Sesión cerrada por la API (401 en ${ruta}, confirmado en /v1/yo)`), { donde: 'sesion' });
      await salir();
    }
  } finally { confirmando = false; }
});

/** al abrir la app: con token guardado se muestra lo último conocido al instante y se refresca por detrás */
export async function cargarSesion() {
  const t = await leerToken();
  if (!t) { poner({ listo: true }); return; }
  try {
    const [c, crewId] = await Promise.all([AsyncStorage.getItem(CACHE), AsyncStorage.getItem(CREW)]);
    if (c) { const j = JSON.parse(c); poner({ usuario: j.usuario, crews: j.crews, crewId: elegir(j.crews, crewId), listo: true }); }
    else poner({ crewId });
  } catch {}
  await refrescarSesion();
  // con sesión guardada nunca se muestra la entrada por falta de red: se entra con lo mínimo y se refresca después
  if (!estado.usuario) { const id = usuarioDelToken(t); if (id) poner({ usuario: { id, nombre: leerPerfil().nombre || '', foto: null } }); }
  poner({ listo: true });
}

const elegir = (crews: Crew[], id: string | null) => (crews.some(c => c.id === id) ? id : crews[0]?.id ?? null);

export async function refrescarSesion() {
  try {
    const yo = await pedir<{ usuario: Usuario; crews: Crew[] }>('/v1/yo');
    poner({ usuario: yo.usuario, crews: yo.crews, crewId: elegir(yo.crews, estado.crewId), sinConexion: false });
    // tu nombre en la app es el de tu cuenta (NOVA te llama así)
    if (yo.usuario.nombre && leerPerfil().nombre !== yo.usuario.nombre) cambiarNombre(yo.usuario.nombre);
    AsyncStorage.setItem(CACHE, JSON.stringify(yo)).catch(() => {});
  } catch (e) {
    if ((e as { estado?: number }).estado === 0) poner({ sinConexion: true });
  }
}

export async function entrar(email: string, clave: string) {
  const r = await pedir<{ token: string; usuario: Usuario }>('/v1/entrar', { json: { email, clave }, sinSesion: true });
  await guardarToken(r.token);
  poner({ usuario: r.usuario });
  await refrescarSesion();
}

export async function salir() {
  await borrarPush(); // con el token todavía válido
  await guardarToken(null);
  AsyncStorage.multiRemove([CACHE, CREW]).catch(() => {});
  poner({ usuario: null, crews: [], crewId: null });
}

export function elegirCrew(id: string) { poner({ crewId: id }); AsyncStorage.setItem(CREW, id).catch(() => {}); }

export async function crearCrew(nombre: string) {
  let zona: string | undefined;
  try { zona = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch {}
  const c = await pedir<Crew>('/v1/crews', { json: { nombre, zona } });
  await refrescarSesion(); elegirCrew(c.id);
  return c;
}
export async function unirseCrew(codigo: string) {
  const c = await pedir<Crew>('/v1/crews/unirse', { json: { codigo } });
  await refrescarSesion(); elegirCrew(c.id);
  return c;
}
/** admin: cambia el rol de alguien o lo saca de la crew */
export async function cambiarRol(crewId: string, uid: string, rol: 'admin' | 'miembro') { await pedir(`/v1/crews/${crewId}/miembros/${uid}`, { metodo: 'PATCH', json: { rol } }); await refrescarSesion(); }
export async function sacarDeCrew(crewId: string, uid: string) { await pedir(`/v1/crews/${crewId}/miembros/${uid}`, { metodo: 'DELETE' }); await refrescarSesion(); }
export async function salirDeCrew(crewId: string) {
  if (!estado.usuario) return;
  await pedir(`/v1/crews/${crewId}/miembros/${estado.usuario.id}`, { metodo: 'DELETE' });
  await refrescarSesion();
}
export async function cambiarNombreCuenta(nombre: string) { await pedir('/v1/yo', { metodo: 'PATCH', json: { nombre } }); await refrescarSesion(); }
export async function cambiarRedesCuenta(redes: Redes) { await pedir('/v1/yo', { metodo: 'PATCH', json: { redes } }); await refrescarSesion(); }
/** el enlace de una red a partir de lo guardado */
export const urlRed = (red: keyof Redes, v: string) => red === 'github' ? `https://github.com/${v}` : red === 'linkedin' ? `https://www.linkedin.com/in/${v}` : red === 'instagram' ? `https://instagram.com/${v}` : red === 'x' ? `https://x.com/${v}` : v;
export async function cambiarClave(actual: string, nueva: string) {
  const r = await pedir<{ token: string }>('/v1/yo/clave', { json: { actual, nueva } });
  await guardarToken(r.token);
}

export const leerSesion = () => estado;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useSesion() { return useSyncExternalStore(suscribir, leerSesion, leerSesion); }

/** la crew en la que estás mirando (puedes estar en varias) */
export function useCrew() {
  const s = useSesion();
  return s.crews.find(c => c.id === s.crewId) ?? null;
}
/** un miembro de cualquiera de tus crews por id */
export const miembroDe = (id: string) => { for (const c of estado.crews) { const m = c.miembros.find(x => x.id === id); if (m) return m; } return null; };
