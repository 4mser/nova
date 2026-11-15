/* Health Connect (Android): lo que otras apps del teléfono guardaron — pasos, pulso, pulso en reposo, HRV, sueño,
   SpO₂, ejercicio y calorías. Solo lectura y solo con permiso. Huawei Health no escribe aquí; Google Fit, Samsung
   Health, Fitbit y otras sí. Necesita la versión de desarrollo de la app (en Expo Go no existe). */
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { leerHistoria, leerTodo, totalDia } from './historia';
import { cambiar, type Salud } from './vivo';

type HC = typeof import('react-native-health-connect');
const TIPOS = ['Steps', 'HeartRate', 'RestingHeartRate', 'HeartRateVariabilityRmssd', 'SleepSession', 'OxygenSaturation', 'ExerciseSession', 'ActiveCaloriesBurned'] as const;

export const saludDisponible = () => Platform.OS === 'android' && !!(TurboModuleRegistry.get('HealthConnect') ?? NativeModules.HealthConnect);

function modulo(): HC | null {
  if (!saludDisponible()) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-health-connect') as HC;
}

/** pide permiso de lectura (abre la pantalla de Health Connect); devuelve cuántos tipos concedió */
export async function pedirSalud(): Promise<{ ok: boolean; mensaje?: string }> {
  const hc = modulo();
  if (!hc) return { ok: false, mensaje: 'Needs the NOVA development build' };
  const estado = await hc.getSdkStatus();
  if (estado !== 3) return { ok: false, mensaje: estado === 2 ? 'Update Health Connect from the Play Store' : 'Health Connect is not installed' };
  await hc.initialize();
  const pedidos = TIPOS.map(recordType => ({ accessType: 'read' as const, recordType }));
  const dados = await hc.requestPermission(pedidos).catch(() => []);
  if (dados.length) return { ok: true };
  // la primera vez requestPermission a veces vuelve vacío aunque se haya aceptado: se confirma con lo concedido
  await new Promise(r => setTimeout(r, 400));
  const concedidos = await hc.getGrantedPermissions().catch(() => []);
  return concedidos.some(p => p.accessType === 'read') ? { ok: true } : { ok: false, mensaje: 'No permission granted in Health Connect' };
}

export async function leerSalud() {
  const hc = modulo();
  if (!hc) return;
  try {
    await hc.initialize();
    const ahora = new Date(), medianoche = new Date(ahora); medianoche.setHours(0, 0, 0, 0);
    const rango = (desde: Date) => ({ operator: 'between' as const, startTime: desde.toISOString(), endTime: ahora.toISOString() });
    const hace = (h: number) => new Date(ahora.getTime() - h * 3600e3);
    const origenes = new Set<string>();
    const anotar = (r: { metadata?: { dataOrigin?: string } }) => { const o = r.metadata?.dataOrigin; if (o) origenes.add(o.replace(/^com\.(google\.android\.apps\.)?/, '').split('.')[0]); };
    void rango;
    type Reg<T extends (typeof TIPOS)[number]> = Awaited<ReturnType<typeof hc.readRecords<T>>>['records'];
    const leer = async <T extends (typeof TIPOS)[number]>(t: T, desde: Date) => (await leerTodo(hc, t, desde, ahora)) as Reg<T>;
    const s: Salud = { serieFc: [], origenes: [], leido: Date.now() };

    // el total de hoy como lo cuenta Health Connect (sin duplicar si el reloj y el teléfono escriben pasos)
    const pasos = await leer('Steps', medianoche);
    if (pasos.length) { s.pasos = (await totalDia(hc, 'Steps', medianoche, ahora)) ?? pasos.reduce((a, r) => a + r.count, 0); pasos.forEach(anotar); }

    const fc = await leer('HeartRate', hace(12));
    const muestras = fc.flatMap(r => { anotar(r); return r.samples; }).sort((a, b) => +new Date(a.time) - +new Date(b.time));
    if (muestras.length) { s.fc = muestras[muestras.length - 1].beatsPerMinute; s.serieFc = muestras.slice(-60).map(m => m.beatsPerMinute); }

    const ultimo = <R extends { time: string }>(rs: R[]) => rs.sort((a, b) => +new Date(a.time) - +new Date(b.time)).at(-1);
    const reposo = ultimo(await leer('RestingHeartRate', hace(24 * 7)));
    if (reposo) { s.fcReposo = reposo.beatsPerMinute; anotar(reposo); }
    const vfc = ultimo(await leer('HeartRateVariabilityRmssd', hace(24 * 7)));
    if (vfc) { s.vfc = vfc.heartRateVariabilityMillis; anotar(vfc); }
    const spo2 = ultimo(await leer('OxygenSaturation', hace(24 * 7)));
    if (spo2) { s.spo2 = spo2.percentage; anotar(spo2); }

    const sueno = (await leer('SleepSession', hace(36))).sort((a, b) => +new Date(a.endTime) - +new Date(b.endTime)).at(-1);
    if (sueno) { const ini = +new Date(sueno.startTime), fin = +new Date(sueno.endTime); s.sueno = { horas: (fin - ini) / 3600e3, ini, fin }; anotar(sueno); }

    const ejercicio = await leer('ExerciseSession', medianoche);
    if (ejercicio.length) { s.ejercicioMin = (await totalDia(hc, 'ExerciseSession', medianoche, ahora)) ?? Math.round(ejercicio.reduce((a, r) => a + (+new Date(r.endTime) - +new Date(r.startTime)), 0) / 60e3); ejercicio.forEach(anotar); }
    const cal = await leer('ActiveCaloriesBurned', medianoche);
    if (cal.length) { s.calorias = (await totalDia(hc, 'ActiveCaloriesBurned', medianoche, ahora)) ?? cal.reduce((a, r) => a + r.energy.inKilocalories, 0); cal.forEach(anotar); }

    s.origenes = [...origenes];
    cambiar(() => ({ salud: s }));
    leerHistoria(hc).catch(() => {});
  } catch {
    cambiar(() => ({ salud: { serieFc: [], origenes: [], leido: Date.now() } }));
  }
}

/** diagnóstico para «Conecta tu reloj»: qué ve NOVA en Health Connect de verdad (sin adivinar) */
export type DiagSalud = { modulo: boolean; sdk?: number; permisos: string[]; registros: { tipo: string; n: number; origenes: string[]; ultimo?: string }[]; error?: string };
export async function diagnosticoSalud(): Promise<DiagSalud> {
  const hc = modulo();
  if (!hc) return { modulo: false, permisos: [], registros: [] };
  const d: DiagSalud = { modulo: true, permisos: [], registros: [] };
  try {
    d.sdk = await hc.getSdkStatus();
    if (d.sdk !== 3) return d;
    await hc.initialize();
    d.permisos = (await hc.getGrantedPermissions().catch(() => [])).filter(p => p.accessType === 'read').map(p => p.recordType);
    const ahora = new Date(), desde = new Date(ahora.getTime() - 7 * 864e5);
    for (const tipo of ['Steps', 'HeartRate', 'SleepSession', 'RestingHeartRate'] as const) {
      if (!d.permisos.includes(tipo)) { d.registros.push({ tipo, n: -1, origenes: [] }); continue; }
      try {
        const rs = (await hc.readRecords(tipo, { timeRangeFilter: { operator: 'between', startTime: desde.toISOString(), endTime: ahora.toISOString() } })).records as { metadata?: { dataOrigin?: string }; startTime?: string; time?: string; endTime?: string }[];
        const origenes = [...new Set(rs.map(r => r.metadata?.dataOrigin).filter(Boolean) as string[])];
        const ultimo = rs.map(r => r.endTime ?? r.time ?? r.startTime ?? '').sort().at(-1);
        d.registros.push({ tipo, n: rs.length, origenes, ultimo });
      } catch (e) { d.registros.push({ tipo, n: -2, origenes: [], ultimo: (e as Error).message }); }
    }
  } catch (e) { d.error = (e as Error).message; }
  return d;
}
