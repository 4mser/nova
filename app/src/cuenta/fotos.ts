/* Subir una foto a la crew: se achica en el teléfono (completa 1440 px y miniatura 360 px) y viajan juntas en un solo
   envío; la API las separa con `x-largo-mini`. Así las historias y el calendario cargan rápido con poca señal.
   Un video (hasta 60 s y 40 MB) viaja igual, con su portada y su miniatura sacadas del cuadro del medio: así el
   calendario, las historias y el widget lo muestran como una foto más (con su ícono de play). */
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { API, ErrorApi, tokenActual } from './api';
import { invalidar, type Foto } from './datos';

async function achicar(uri: string, lado: number, calidad: number, ancho: number, alto: number) {
  const ctx = ImageManipulator.manipulate(uri);
  if (Math.max(ancho, alto) > lado) ctx.resize(ancho >= alto ? { width: lado } : { height: lado });
  const img = await ctx.renderAsync();
  return img.saveAsync({ compress: calidad, format: SaveFormat.JPEG });
}

export async function subirFoto(crew: string, foto: { uri: string; width: number; height: number }, texto?: string): Promise<Foto> {
  const completa = await achicar(foto.uri, 1440, 0.82, foto.width, foto.height);
  const mini = await achicar(foto.uri, 360, 0.7, foto.width, foto.height);
  const q = new URLSearchParams({ ancho: String(completa.width), alto: String(completa.height), ...(texto?.trim() ? { texto: texto.trim() } : {}) });
  const url = `${API}/v1/crews/${crew}/fotos?${q}`;
  const cab = { authorization: `Bearer ${tokenActual()}`, 'content-type': 'application/octet-stream' };
  if (Platform.OS === 'web') {
    const [a, b] = await Promise.all([fetch(mini.uri).then(r => r.arrayBuffer()), fetch(completa.uri).then(r => r.arrayBuffer())]);
    const r = await fetch(url, { method: 'POST', headers: { ...cab, 'x-largo-mini': String(a.byteLength) }, body: new Blob([a, b]) });
    const j = await r.json();
    if (!r.ok) throw new ErrorApi(r.status, j.error);
    invalidar('foto');
    return j;
  }
  const a = await new File(mini.uri).bytes(), b = await new File(completa.uri).bytes();
  const junto = new Uint8Array(a.length + b.length);
  junto.set(a, 0); junto.set(b, a.length);
  const envio = new File(Paths.cache, `envio-${Date.now()}.bin`);
  envio.write(junto);
  try {
    const r = await envio.upload(url, { httpMethod: 'POST', headers: { ...cab, 'x-largo-mini': String(a.length) } });
    const j = JSON.parse(r.body || '{}');
    if (r.status >= 400) throw new ErrorApi(r.status, j.error ?? `Error ${r.status}`);
    invalidar('foto');
    return j;
  } finally {
    for (const f of [envio, new File(mini.uri), new File(completa.uri)]) try { f.delete(); } catch {}
  }
}

export const MAX_VIDEO_MB = 40, MAX_VIDEO_S = 60;

/** portada del video: el cuadro del medio, sacado con el reproductor de expo-video (sin módulo extra) */
async function portada(uri: string, ms: number) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createVideoPlayer } = require('expo-video') as typeof import('expo-video');
  const p = createVideoPlayer(uri);
  try {
    await new Promise<void>((ok, mal) => {
      if (p.status === 'readyToPlay') return ok();
      const t = setTimeout(() => mal(new Error('Could not read the video')), 10000);
      const s = p.addListener('statusChange', ({ status }) => { if (status === 'readyToPlay') { clearTimeout(t); s.remove(); ok(); } else if (status === 'error') { clearTimeout(t); s.remove(); mal(new Error('Could not read the video')); } });
    });
    const [cuadro] = await p.generateThumbnailsAsync([Math.min(1.5, (ms / 1000) / 2)], { maxWidth: 1440, maxHeight: 1440 });
    const grande = await (await ImageManipulator.manipulate(cuadro).renderAsync()).saveAsync({ compress: 0.82, format: SaveFormat.JPEG });
    const chica = await (await ImageManipulator.manipulate(cuadro).resize(grande.width >= grande.height ? { width: 360 } : { height: 360 }).renderAsync()).saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return { grande, chica };
  } finally { p.release(); }
}

export async function subirVideo(crew: string, v: { uri: string; width: number; height: number; duration?: number | null; fileSize?: number }, texto?: string): Promise<Foto> {
  if (Platform.OS === 'web') throw new Error('Videos are shared from the phone');
  const ms = Math.round(v.duration ?? 0);
  if (ms > MAX_VIDEO_S * 1000 + 500) throw new Error(`Videos up to ${MAX_VIDEO_S} seconds`);
  const archivo = new File(v.uri);
  if ((v.fileSize ?? archivo.size ?? 0) > MAX_VIDEO_MB * 1048576) throw new Error(`That video is too heavy (max ${MAX_VIDEO_MB} MB). Try a shorter one.`);
  const { grande, chica } = await portada(v.uri, ms || 1000);
  const a = await new File(chica.uri).bytes(), b = await new File(grande.uri).bytes(), c = await archivo.bytes();
  const junto = new Uint8Array(a.length + b.length + c.length);
  junto.set(a, 0); junto.set(b, a.length); junto.set(c, a.length + b.length);
  const envio = new File(Paths.cache, `video-${Date.now()}.bin`);
  envio.write(junto);
  const q = new URLSearchParams({ ms: String(ms || 1000), ancho: String(grande.width), alto: String(grande.height), ...(texto?.trim() ? { texto: texto.trim() } : {}) });
  try {
    const r = await envio.upload(`${API}/v1/crews/${crew}/videos?${q}`, { httpMethod: 'POST', headers: { authorization: `Bearer ${tokenActual()}`, 'content-type': 'application/octet-stream', 'x-largo-mini': String(a.length), 'x-largo-poster': String(b.length) } });
    const j = JSON.parse(r.body || '{}');
    if (r.status >= 400) throw new ErrorApi(r.status, j.error ?? `Error ${r.status}`);
    invalidar('foto');
    return j;
  } finally {
    for (const f of [envio, new File(chica.uri), new File(grande.uri)]) try { f.delete(); } catch {}
  }
}

/** tu foto de perfil también en la cuenta (la ve tu crew): 512 px */
export async function subirAvatar(uri: string) {
  const img = await (await ImageManipulator.manipulate(uri).resize({ width: 512 }).renderAsync()).saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  const url = `${API}/v1/yo/foto`, cab = { authorization: `Bearer ${tokenActual()}`, 'content-type': 'image/jpeg' };
  if (Platform.OS === 'web') { await fetch(url, { method: 'PUT', headers: cab, body: await fetch(img.uri).then(r => r.blob()) }); }
  else { await new File(img.uri).upload(url, { httpMethod: 'PUT', headers: cab }); try { new File(img.uri).delete(); } catch {} }
  invalidar('miembros');
}
