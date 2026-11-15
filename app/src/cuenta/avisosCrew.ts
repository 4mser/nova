/* Qué avisos push de la crew quieres recibir (se guardan en la API: el servidor filtra antes de mandar). */
import { useEffect, useState } from 'react';
import { pedir } from './api';

export type CategoriaAviso = 'crew' | 'equipo' | 'standup' | 'bitacora' | 'retos' | 'salud' | 'github';
export type PrefsAvisos = Partial<Record<CategoriaAviso, boolean>>;

export function usePrefsAvisos() {
  const [prefs, setPrefs] = useState<PrefsAvisos | null>(null);
  useEffect(() => { pedir<PrefsAvisos>('/v1/yo/avisos').then(setPrefs, () => setPrefs({})); }, []);
  const cambiar = (k: CategoriaAviso, v: boolean) => {
    const n = { ...(prefs ?? {}), [k]: v };
    setPrefs(n);
    pedir('/v1/yo/avisos', { metodo: 'PUT', json: n }).catch(() => {});
  };
  return { prefs, cambiar };
}
