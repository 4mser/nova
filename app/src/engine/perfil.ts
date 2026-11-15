/* Perfil del astronauta: nombre y foto, guardados en el teléfono. El nombre se usa en toda la app (y NOVA lo dice);
   la foto se copia a los documentos de la app para que no dependa de la galería. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

export type Perfil = { nombre: string; rol: string; foto?: string };
const CLAVE = 'nova.perfil.v1';
let perfil: Perfil = { nombre: 'Amser', rol: 'Mission specialist' };
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach(o => o());
const guardar = () => { AsyncStorage.setItem(CLAVE, JSON.stringify(perfil)).catch(() => {}); avisar(); };

export async function cargarPerfil() {
  try { const t = await AsyncStorage.getItem(CLAVE); if (t) { perfil = { ...perfil, ...JSON.parse(t) }; avisar(); } } catch {}
}

export const leerPerfil = () => perfil;
export const iniciales = (n: string) => { const p = n.trim().split(/\s+/).filter(Boolean); return (p.length > 1 ? p[0][0] + p[1][0] : (p[0] ?? 'AM').slice(0, 2)).toUpperCase(); };

export function cambiarNombre(nombre: string) {
  const n = nombre.trim();
  if (!n) return;
  perfil = { ...perfil, nombre: n };
  guardar();
}

/** guarda una copia de la foto elegida (en web basta la uri) */
export function cambiarFoto(uri: string | undefined) {
  if (!uri) { perfil = { ...perfil, foto: undefined }; guardar(); return; }
  let final = uri;
  if (Platform.OS !== 'web') {
    try {
      const destino = new File(Paths.document, `perfil-${Date.now()}.jpg`);
      new File(uri).copy(destino);
      final = destino.uri;
    } catch {}
  }
  perfil = { ...perfil, foto: final };
  guardar();
}

const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function usePerfil() { return useSyncExternalStore(suscribir, leerPerfil, leerPerfil); }
