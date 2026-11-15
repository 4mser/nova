/* Los permisos de NOVA en un solo lugar: qué es cada uno, para qué sirve, cómo está y cómo pedirlo. Lo usan la
   bienvenida y Tú → Permisos. Si Android ya no deja volver a preguntar (lo negaste dos veces), el botón abre los
   Ajustes de la app. Las fuentes de datos (pasos, Health Connect, calendario) quedan además encendidas en «Tus datos». */
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { Pedometer } from 'expo-sensors';
import { Linking, Platform } from 'react-native';
import { agendaDisponible, pedirAgenda } from '../sensores/agenda';
import { consentir, leerConsentimiento } from '../sensores/fuentes';
import { pedirSalud, saludDisponible } from '../sensores/salud';
import { agendarResumen, permisoAvisos } from './momento';
import { NovaControl } from '../../modules/nova-control';

export type IdPermiso = 'avisos' | 'microfono' | 'actividad' | 'salud' | 'agenda' | 'camara' | 'sobreponer' | 'accesibilidad';
/** si: concedido · pedir: se puede pedir · ajustes: hay que ir a Ajustes · no: no existe en este teléfono/versión */
export type EstadoPermiso = 'si' | 'pedir' | 'ajustes' | 'no';
export type Permiso = { id: IdPermiso; titulo: string; para: string; icono: string; color: string };

export const PERMISOS: Permiso[] = [
  { id: 'avisos', titulo: 'Notifications', para: 'The crew moment, the end of a focus session, reviews and your morning briefing.', icono: 'notifications-outline', color: '#8fe6f5' },
  { id: 'microfono', titulo: 'Microphone', para: 'To talk with Nova out loud. It only listens while the conversation is open.', icono: 'mic-outline', color: '#a898ff' },
  { id: 'actividad', titulo: 'Physical activity', para: 'Your steps, counted by the phone.', icono: 'walk-outline', color: '#6fd6b0' },
  { id: 'salud', titulo: 'Health Connect', para: 'Sleep, heart rate, recovery and exercise from your watch or health app.', icono: 'fitness-outline', color: '#ec6aa8' },
  { id: 'agenda', titulo: 'Calendar', para: 'Your day, so Nova can suggest focus time in your free gaps.', icono: 'calendar-outline', color: '#f2b457' },
  { id: 'camara', titulo: 'Camera', para: 'To share your moment with the crew.', icono: 'camera-outline', color: '#46c8e8' },
  { id: 'sobreponer', titulo: 'Over other apps', para: 'So Nova can shrink to a bubble and stay with you when she opens another app.', icono: 'albums-outline', color: '#8fe6f5' },
  { id: 'accesibilidad', titulo: 'Accessibility', para: 'So Nova can see what is on screen and use apps for you («open the latest email»).', icono: 'hand-left-outline', color: '#a898ff' },
];

type Resp = { granted: boolean; canAskAgain?: boolean };
const estadoDe = (r: Resp | null): EstadoPermiso => (!r ? 'no' : r.granted ? 'si' : r.canAskAgain === false ? 'ajustes' : 'pedir');

// solo en exportaciones web de demostración (grabaciones y revisión visual): estados de ejemplo
const DEMO: Record<IdPermiso, EstadoPermiso> = { avisos: 'si', microfono: 'pedir', actividad: 'pedir', salud: 'pedir', agenda: 'ajustes', camara: 'si', sobreponer: 'ajustes', accesibilidad: 'ajustes' };

export async function estadoPermiso(id: IdPermiso): Promise<EstadoPermiso> {
  if (Platform.OS === 'web') return process.env.EXPO_PUBLIC_DEMO ? DEMO[id] : 'no';
  try {
    switch (id) {
      case 'avisos': return estadoDe(await Notifications.getPermissionsAsync());
      case 'microfono': return estadoDe(await getRecordingPermissionsAsync());
      case 'actividad': return estadoDe(await Pedometer.getPermissionsAsync());
      case 'camara': return estadoDe(await ImagePicker.getCameraPermissionsAsync());
      case 'salud': return !saludDisponible() ? 'no' : leerConsentimiento().salud ? 'si' : 'pedir';
      // los dos se dan en los Ajustes de Android (no hay diálogo): el botón los abre
      case 'sobreponer': return !NovaControl?.puedeSobreponer ? 'no' : NovaControl.puedeSobreponer() ? 'si' : 'ajustes';
      case 'accesibilidad': return !NovaControl?.accesibilidadActiva ? 'no' : NovaControl.accesibilidadActiva() ? 'si' : 'ajustes';
      case 'agenda': {
        if (!agendaDisponible()) return 'no';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const c = require('expo-calendar') as typeof import('expo-calendar');
        const e = estadoDe(await c.getCalendarPermissions());
        return e === 'si' && !leerConsentimiento().agenda ? 'pedir' : e;
      }
    }
  } catch { return 'no'; }
}

/** pide un permiso (y enciende su fuente de datos si corresponde); devuelve el estado nuevo */
export async function pedirPermiso(id: IdPermiso, alAvisos?: () => void): Promise<EstadoPermiso> {
  const antes = await estadoPermiso(id);
  if (antes === 'ajustes' && id === 'sobreponer') { NovaControl?.pedirSobreponer?.(); return antes; }
  if (antes === 'ajustes' && id === 'accesibilidad') { NovaControl?.abrirAccesibilidad?.(); return antes; }
  if (antes === 'ajustes') { Linking.openSettings().catch(() => {}); return antes; }
  if (antes === 'no' || antes === 'si') return antes;
  try {
    switch (id) {
      case 'avisos': if (await permisoAvisos()) { agendarResumen(); alAvisos?.(); } break;
      case 'microfono': await requestRecordingPermissionsAsync(); break;
      case 'actividad': if ((await Pedometer.requestPermissionsAsync()).granted) consentir('pasos', true); break;
      case 'camara': await ImagePicker.requestCameraPermissionsAsync(); break;
      case 'salud': if ((await pedirSalud()).ok) consentir('salud', true); break;
      case 'agenda': if ((await pedirAgenda()).ok) consentir('agenda', true); break;
    }
  } catch {}
  return estadoPermiso(id);
}
