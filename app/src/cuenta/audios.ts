/* Notas de voz de la bitácora de la crew: se sube el archivo grabado (m4a) tal cual, con su duración. */
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { API, ErrorApi, tokenActual } from './api';
import { invalidar, type EntradaCrew } from './datos';

export async function subirNotaVoz(crew: string, uri: string, ms: number, texto?: string): Promise<EntradaCrew> {
  const q = new URLSearchParams({ ms: String(Math.round(ms)), ...(texto?.trim() ? { texto: texto.trim() } : {}) });
  const url = `${API}/v1/crews/${crew}/bitacora/audio?${q}`;
  const cab = { authorization: `Bearer ${tokenActual()}`, 'content-type': 'application/octet-stream' };
  if (Platform.OS === 'web') {
    const b = await fetch(uri).then(r => r.arrayBuffer());
    const r = await fetch(url, { method: 'POST', headers: cab, body: b });
    const j = await r.json();
    if (!r.ok) throw new ErrorApi(r.status, j.error);
    invalidar('bitacora');
    return j;
  }
  const archivo = new File(uri);
  try {
    const r = await archivo.upload(url, { httpMethod: 'POST', headers: cab });
    const j = JSON.parse(r.body || '{}');
    if (r.status >= 400) throw new ErrorApi(r.status, j.error ?? `Error ${r.status}`);
    invalidar('bitacora');
    return j;
  } finally { try { archivo.delete(); } catch {} }
}
