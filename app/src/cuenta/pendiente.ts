/* Lo que sacaste con la cámara (o elegiste en la galería) cuando Android cerró NOVA mientras tanto: al volver, la app
   se recrea y el resultado queda pendiente en el sistema (ImagePicker.getPendingResultAsync). Antes de abrir la cámara
   se marca «compartir pendiente»; al arrancar, si hay resultado, se guarda aquí y se abre /compartir con él. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Platform } from 'react-native';

const CLAVE = 'nova.compartir.pendiente';
let recuperado: ImagePicker.ImagePickerAsset | null = null;

export const marcarPendiente = () => AsyncStorage.setItem(CLAVE, String(Date.now())).catch(() => {});
export const limpiarPendiente = () => AsyncStorage.removeItem(CLAVE).catch(() => {});
/** lo recuperado (una sola vez) */
export function tomarRecuperado() { const r = recuperado; recuperado = null; return r; }

/** al arrancar la app: si se estaba compartiendo y hay un resultado pendiente, vuelve a Compartir con él */
export async function recuperarCompartir() {
  if (Platform.OS !== 'android') return;
  const marca = Number(await AsyncStorage.getItem(CLAVE).catch(() => null));
  if (!marca || Date.now() - marca > 30 * 60e3) return;
  await limpiarPendiente();
  const r = await ImagePicker.getPendingResultAsync().catch(() => null);
  if (!r || !('assets' in r) || r.canceled || !r.assets?.[0]) return;
  recuperado = r.assets[0];
  setTimeout(() => router.push({ pathname: '/compartir', params: { recuperado: '1' } }), 600);
}
