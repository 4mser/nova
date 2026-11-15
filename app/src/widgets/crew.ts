/* Datos del widget «Crew»: la última foto de hoy de cada persona, ya preparada para el widget (base64) para que se
   dibuje aunque la app esté cerrada. Se arma en la app cada vez que cambian las fotos de la crew.
   Calidad: se baja la foto COMPLETA (1440 px), se recorta al centro en cuadrado y se deja en 512 px. El widget arma
   una grilla de cuadrados, así ninguna foto se estira ni se ve borrosa, tenga la crew 2 o 12 personas. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

import { leerToken, pedir, urlConToken } from '../cuenta/api';
import type { Foto } from '../cuenta/datos';
import type { Crew } from '../cuenta/sesion';
import { idiomaActual, type Idioma } from '../i18n';
import { widgetsDisponibles } from './disponible';

export type FotoWidget = { id: string; nombre: string; hora: string; img: string; aTiempo?: boolean; video?: boolean };
export type DatosCrew = { crew: string; fecha: string; fotos: FotoWidget[]; total: number; miembros: number; idioma: Idioma; momento: number; faltan?: string[] };
const CLAVE = 'nova.widget.crew.v2', MAX = 9, LADO = 512;
const cacheImg = new Map<string, string>();

/** la foto completa, recortada al centro en cuadrado de 512 px (en caché por id: una foto no cambia) */
async function base64De(f: Foto) {
  if (cacheImg.has(f.id)) return cacheImg.get(f.id)!;
  const lista = new File(Paths.cache, `crewq-${f.id}.jpg`);
  if (!lista.exists) {
    const original = new File(Paths.cache, `crew-full-${f.id}.jpg`);
    if (!original.exists) await File.downloadFileAsync(urlConToken(f.url), original);
    const ref = await ImageManipulator.manipulate(original.uri).renderAsync();
    const lado = Math.min(ref.width, ref.height);
    const cuadrada = await ImageManipulator.manipulate(original.uri)
      .crop({ originX: Math.round((ref.width - lado) / 2), originY: Math.round((ref.height - lado) / 2), width: lado, height: lado })
      .resize({ width: Math.min(LADO, lado) })
      .renderAsync();
    const r = await cuadrada.saveAsync({ compress: 0.86, format: SaveFormat.JPEG });
    // dos actualizaciones del widget pueden preparar la misma foto a la vez: si ya está lista, se descarta la copia
    if (lista.exists) { try { new File(r.uri).delete(); } catch {} } else { try { new File(r.uri).move(lista); } catch { if (!lista.exists) throw new Error('No se pudo preparar la foto'); } }
    try { original.delete(); } catch {}
  }
  const b = `data:image/jpeg;base64,${await lista.base64()}`;
  cacheImg.set(f.id, b);
  return b;
}

export async function cargarCrewWidget(): Promise<DatosCrew | null> {
  try { const t = await AsyncStorage.getItem(CLAVE); return t ? JSON.parse(t) : null; } catch { return null; }
}

/** la última foto de cada persona hoy (hasta 9), la más nueva primero; y quiénes faltan */
export async function actualizarWidgetCrew(crew: Crew | null, fotos: Foto[] | undefined, redibujar = true) {
  if (Platform.OS !== 'android' || !widgetsDisponibles() || !crew || !fotos) return null;
  const porPersona = new Map<string, Foto>();
  for (const f of [...fotos].sort((a, b) => b.ts - a.ts)) if (!porPersona.has(f.usuario)) porPersona.set(f.usuario, f);
  const elegidas = [...porPersona.values()].slice(0, MAX);
  const lista: FotoWidget[] = [];
  for (const f of elegidas) {
    try {
      const m = crew.miembros.find(x => x.id === f.usuario);
      lista.push({ id: f.id, nombre: (m?.nombre ?? '').split(/\s+/)[0], hora: new Date(f.ts).toTimeString().slice(0, 5), img: await base64De(f), aTiempo: f.aTiempo, video: !!f.video });
    } catch {}
  }
  const faltan = crew.miembros.filter(m => !porPersona.has(m.id)).map(m => m.nombre.split(/\s+/)[0]);
  const d: DatosCrew = { crew: crew.nombre, fecha: crew.hoy.fecha, fotos: lista, total: porPersona.size, miembros: crew.miembros.length, idioma: idiomaActual(), momento: crew.hoy.momento, faltan };
  try { await AsyncStorage.setItem(CLAVE, JSON.stringify(d)); } catch {}
  if (!redibujar) return d;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { requestWidgetUpdate } = require('react-native-android-widget') as typeof import('react-native-android-widget');
  const { CrewWidget } = require('./Widgets') as typeof import('./Widgets');
  /* eslint-enable @typescript-eslint/no-require-imports */
  try { await requestWidgetUpdate({ widgetName: 'Crew', renderWidget: info => CrewWidget({ d, w: info.width, h: info.height, ahora: Date.now() }) }); } catch {}
  return d;
}

/** desde el widget, con la app cerrada (cada 30 min): pide a la API las fotos de hoy con la sesión guardada */
export async function refrescarCrewDesdeWidget(): Promise<DatosCrew | null> {
  try {
    if (!(await leerToken())) return null;
    const yo = await pedir<{ crews: Crew[] }>('/v1/yo');
    const elegida = await AsyncStorage.getItem('nova.sesion.crew');
    const crew = yo.crews.find(c => c.id === elegida) ?? yo.crews[0];
    if (!crew) return null;
    const fotos = await pedir<Foto[]>(`/v1/crews/${crew.id}/fotos?desde=${crew.hoy.fecha}&hasta=${crew.hoy.fecha}`);
    return await actualizarWidgetCrew(crew, fotos, false);
  } catch { return null; }
}
