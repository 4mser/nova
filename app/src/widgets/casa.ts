/* Datos del widget «Casa»: la última foto que dejó la familia (llegada a la nave con el retraso de la luz), ya
   preparada en base64 para que Android la dibuje aunque la app esté cerrada. Se arma cuando llega algo nuevo. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

import type { Casa } from '../cuenta/naveEstado';
import { urlArchivoCasa } from '../cuenta/naveEstado';
import { idiomaActual, type Idioma } from '../i18n';
import { widgetsDisponibles } from './disponible';

export type DatosCasa = { de: string; relacion: string; texto: string; llega: number; img?: string; mas: number; idioma: Idioma };
const CLAVE = 'nova.widget.casa.v1', ANCHO = 960;

/** la foto completa en 960 px de ancho (proporción original; el widget la recorta al llenar) */
async function base64De(id: string) {
  const lista = new File(Paths.cache, `casa-${id}.jpg`);
  if (!lista.exists) {
    const original = new File(Paths.cache, `casa-full-${id}.jpg`);
    if (!original.exists) await File.downloadFileAsync(urlArchivoCasa(id), original);
    const r = await (await ImageManipulator.manipulate(original.uri).resize({ width: ANCHO }).renderAsync()).saveAsync({ compress: 0.84, format: SaveFormat.JPEG });
    if (lista.exists) { try { new File(r.uri).delete(); } catch {} } else { try { new File(r.uri).move(lista); } catch {} }
    try { original.delete(); } catch {}
  }
  return `data:image/jpeg;base64,${await lista.base64()}`;
}

export async function cargarCasaWidget(): Promise<DatosCasa | null> {
  try { const t = await AsyncStorage.getItem(CLAVE); return t ? JSON.parse(t) : null; } catch { return null; }
}

export async function actualizarWidgetCasa(c: Casa) {
  if (Platform.OS !== 'android' || !widgetsDisponibles() || !c.mensajes.length) return;
  const foto = c.mensajes.find(m => m.tipo === 'foto' && m.archivo), ultimo = c.mensajes[0];
  const elegido = foto ?? ultimo;
  let img: string | undefined;
  if (foto) { try { img = await base64De(foto.id); } catch {} }
  const d: DatosCasa = { de: elegido.de, relacion: elegido.relacion, texto: elegido.texto, llega: elegido.llega, img, mas: Math.max(0, c.mensajes.length - 1), idioma: idiomaActual() };
  try { await AsyncStorage.setItem(CLAVE, JSON.stringify(d)); } catch {}
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { requestWidgetUpdate } = require('react-native-android-widget') as typeof import('react-native-android-widget');
  const { CasaWidget } = require('./Widgets') as typeof import('./Widgets');
  /* eslint-enable @typescript-eslint/no-require-imports */
  try { await requestWidgetUpdate({ widgetName: 'Casa', renderWidget: info => CasaWidget({ d, w: info.width, h: info.height, ahora: Date.now() }) }); } catch {}
}
