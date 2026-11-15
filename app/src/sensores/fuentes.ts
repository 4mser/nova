/* Las fuentes de datos reales que NOVA puede leer, y el consentimiento de cada una.
   Nada se lee sin un «sí» explícito; la elección se guarda en el teléfono y se puede cambiar cuando quieras.
   Todo queda en el teléfono: lo que sale está en «What you share». */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export type Fuente = 'movimiento' | 'pasos' | 'cabina' | 'bateria' | 'ruido' | 'reloj' | 'salud' | 'uso' | 'agenda';

export const FUENTES: { id: Fuente; titulo: string; lee: string; para: string; icono: string; apk?: boolean }[] = [
  { id: 'reloj', titulo: 'Watch heart rate', lee: 'Live heart rate and beat-to-beat intervals broadcast by your watch over Bluetooth.', para: 'Real-time heart rate and short-term HRV.', icono: 'watch-outline', apk: true },
  { id: 'salud', titulo: 'Health Connect', lee: 'Steps, heart rate, resting heart rate, HRV, sleep, SpO₂, exercise and calories saved by apps on this phone.', para: 'Your real recovery, sleep and activity, day by day.', icono: 'fitness-outline', apk: true },
  { id: 'agenda', titulo: 'Calendar', lee: 'Events for today and tomorrow from the calendars on this phone (Google Calendar included if it syncs here). Read only.', para: 'Knowing your day, so Nova can suggest focus time in your free gaps.', icono: 'calendar-outline', apk: true },
  { id: 'uso', titulo: 'Phone use', lee: 'Screen time, unlocks, most-used apps and when the screen was on at night. Never what you do inside apps.', para: 'Sleep hygiene and screen load, a known factor in rest and mood.', icono: 'phone-portrait-outline', apk: true },
  { id: 'movimiento', titulo: 'Movement', lee: 'Accelerometer: how much the phone moves, as still, moving or active.', para: 'Activity through the day.', icono: 'walk-outline' },
  { id: 'pasos', titulo: 'Steps', lee: 'Step counter of the phone, while Nova is open.', para: 'Daily activity.', icono: 'footsteps-outline' },
  { id: 'cabina', titulo: 'Cabin pressure and light', lee: 'Barometer and ambient light sensor.', para: 'Environment: pressure changes and light exposure, which shapes your body clock.', icono: 'speedometer-outline' },
  { id: 'bateria', titulo: 'Phone battery', lee: 'Battery level and whether it is charging.', para: 'Charging at night is a simple hint of when you went to bed.', icono: 'battery-half-outline' },
  { id: 'ruido', titulo: 'Noise around you', lee: 'A 5-second microphone sample every 5 minutes, only the loudness. No audio is recorded or sent.', para: 'Noise exposure, a real problem on long missions.', icono: 'volume-medium-outline' },
];

export type Consentimiento = Record<Fuente, boolean>;
const CLAVE = 'nova.consentimiento.v1';
const NADA: Consentimiento = { movimiento: false, pasos: false, cabina: false, bateria: false, ruido: false, reloj: false, salud: false, uso: false, agenda: false };

let actual: Consentimiento = NADA, cargado = false;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach(o => o());

export async function cargarConsentimiento() {
  try {
    const t = await AsyncStorage.getItem(CLAVE);
    if (t) actual = { ...NADA, ...JSON.parse(t) };
  } catch {}
  cargado = true;
  avisar();
}

export function consentir(f: Fuente, si: boolean) {
  actual = { ...actual, [f]: si };
  AsyncStorage.setItem(CLAVE, JSON.stringify(actual)).catch(() => {});
  avisar();
}

export const leerConsentimiento = () => actual;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useConsentimiento() {
  const c = useSyncExternalStore(suscribir, leerConsentimiento, leerConsentimiento);
  return { c, cargado, alguno: Object.values(c).some(Boolean) };
}
