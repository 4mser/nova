/* Avisos push (Expo push → FCM): llegan con la app cerrada cuando alguien de la crew comparte su momento, reacciona a
   tu foto, te asigna una tarea o propone un reto. El permiso se pide en la bienvenida; aquí solo se registra el token
   de este teléfono en la API (y se borra al cerrar sesión). Sin Firebase configurado en el APK, no hace nada. */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { pedir } from './api';
import { configurarAvisos } from './momento';
import { reportarError } from './errores';

let registrado: string | null = null;

export async function registrarPush(idioma: string) {
  if (Platform.OS === 'web') return;
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    await configurarAvisos();
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await pedir('/v1/yo/push', { metodo: 'PUT', json: { token, idioma } });
    registrado = token;
  } catch (e) {
    // sin google-services.json en el APK, FCM no arranca: es esperable hasta tener Firebase, no se reporta
    if (!/Firebase|FCM|google-services|Default FirebaseApp/i.test(String((e as Error)?.message))) reportarError(e, { donde: 'push' });
  }
}

export async function borrarPush() {
  if (!registrado) return;
  const token = registrado;
  registrado = null;
  await pedir('/v1/yo/push', { metodo: 'DELETE', json: { token } }).catch(() => {});
}
