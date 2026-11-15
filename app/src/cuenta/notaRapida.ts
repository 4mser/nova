/* Nota rápida: sube el audio a la API, que lo transcribe y dice qué es (tarea, recordatorio, lista o nota) y sus datos. */
import { File } from 'expo-file-system';
import { idiomaActual } from '../i18n';
import { API, ErrorApi, tokenActual } from './api';
import { CLAVE_LISTAS, leerCache, type Lista } from './datos';

export type NotaEntendida = { texto: string; tipo: 'tarea' | 'recordatorio' | 'lista' | 'nota'; titulo: string; hora?: string | null; en_minutos?: number | null; dia?: 'hoy' | 'manana' | null; lista?: string | null; items: string[] };

export async function entenderNota(uri: string): Promise<NotaEntendida> {
  const listas = (leerCache<Lista[]>(CLAVE_LISTAS) ?? []).map(l => l.nombre).join(', ');
  const ahora = new Date().toLocaleString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false });
  const url = `${API}/v1/nota-rapida?${new URLSearchParams({ listas, ahora, i: idiomaActual() })}`;
  const archivo = new File(uri);
  try {
    const r = await archivo.upload(url, { httpMethod: 'POST', headers: { authorization: `Bearer ${tokenActual()}`, 'content-type': 'application/octet-stream' } });
    const j = JSON.parse(r.body || '{}');
    if (r.status >= 400) throw new ErrorApi(r.status, j.error ?? `Error ${r.status}`);
    return j;
  } finally { try { archivo.delete(); } catch {} }
}
