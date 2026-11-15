/* La bienvenida se ve una vez por cuenta (en este teléfono). La marca se guarda por usuario: si otra persona entra
   en el mismo teléfono, también la ve. Desde «Tú» se puede volver a ver. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

const clave = (id: string) => `nova.bienvenida.v1.${id}`;
/** quien vio la bienvenida antes de que tuviera la página de permisos los ve una vez, al abrir la app */
export const PERMISOS_VISTOS = 'nova.permisos.vistos.v1';
let estado: { id: string | null; vista: boolean | null } = { id: null, vista: null };
const oyentes = new Set<() => void>();
const poner = (e: typeof estado) => { estado = e; oyentes.forEach(o => o()); };
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
const leer = () => estado;

/** null mientras se lee la marca de esta cuenta; true si ya la vio */
export function useBienvenidaVista(usuarioId: string | null | undefined) {
  const e = useSyncExternalStore(suscribir, leer, leer);
  useEffect(() => {
    if (!usuarioId || estado.id === usuarioId) return;
    poner({ id: usuarioId, vista: null });
    AsyncStorage.getItem(clave(usuarioId)).then(v => { if (estado.id === usuarioId) poner({ id: usuarioId, vista: v === '1' }); }, () => poner({ id: usuarioId, vista: false }));
  }, [usuarioId]);
  return e.id === usuarioId ? e.vista : null;
}

export function terminarBienvenida() {
  if (!estado.id) return;
  AsyncStorage.setItem(PERMISOS_VISTOS, '1').catch(() => {}); // la bienvenida ya trae la página de permisos
  AsyncStorage.setItem(clave(estado.id), '1').catch(() => {});
  poner({ ...estado, vista: true });
}

export function verBienvenidaOtraVez() {
  if (!estado.id) return;
  AsyncStorage.removeItem(clave(estado.id)).catch(() => {});
  poner({ ...estado, vista: false });
}
