/* Pulso en vivo desde un reloj o banda por Bluetooth (perfil estándar Heart Rate, 0x180D / 0x2A37).
   Sirve para el Huawei Watch GT 2 con «HR Data Broadcasts» activado y para la Polar H10 de la etapa 2.
   Necesita la versión de desarrollo de la app (react-native-ble-plx es nativo): en Expo Go queda 'no_disponible'. */
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { cambiar, empujar, rmssd } from './vivo';

const SERVICIO = '0000180d-0000-1000-8000-00805f9b34fb';
const MEDIDA = '00002a37-0000-1000-8000-00805f9b34fb';

let gestor: BleManager | null = null;
let equipo: Device | null = null;
let monitor: Subscription | null = null;
let ultimoSegundo = 0;

export const relojDisponible = () => Platform.OS !== 'web' && !!NativeModules.BlePlx;

function bytes(b64: string) {
  const s = globalThis.atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Heart Rate Measurement: flags, pulso (8 o 16 bits), energía opcional y RR en 1/1024 s */
function leerMedida(b: Uint8Array) {
  const flags = b[0], ancho16 = flags & 1, conEnergia = flags & 8, conRR = flags & 16;
  let i = 1;
  const bpm = ancho16 ? b[i] | (b[i + 1] << 8) : b[i];
  i += ancho16 ? 2 : 1;
  if (conEnergia) i += 2;
  const rr: number[] = [];
  if (conRR) for (; i + 1 < b.length; i += 2) rr.push(((b[i] | (b[i + 1] << 8)) / 1024) * 1000);
  return { bpm, rr };
}

/** permisos de Bluetooth (Android 12+: buscar y conectar); se piden al activar la fuente */
export async function permisos() {
  if (Platform.OS !== 'android') return true;
  const P = PermissionsAndroid.PERMISSIONS, OK = PermissionsAndroid.RESULTS.GRANTED;
  // Android 12+: escanear y conectar (sin ubicación); antes, ubicación fina
  const lista = Number(Platform.Version) >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION];
  const r = await PermissionsAndroid.requestMultiple(lista);
  return lista.every(x => r[x] === OK);
}

export async function conectarReloj() {
  if (!relojDisponible()) { cambiar(() => ({ reloj: { estado: 'no_disponible' } })); return; }
  if (!(await permisos())) { cambiar(() => ({ reloj: { estado: 'error', mensaje: 'Bluetooth permission is off' } })); return; }
  // se carga recién aquí: en Expo Go el módulo nativo no existe
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BleManager: Gestor } = require('react-native-ble-plx') as typeof import('react-native-ble-plx');
  gestor ??= new Gestor();
  cambiar(() => ({ reloj: { estado: 'buscando' } }));
  const g = gestor;
  const listo = await new Promise<boolean>(ok => {
    const s = g.onStateChange(st => { if (st === 'PoweredOn') { s.remove(); ok(true); } if (st === 'PoweredOff' || st === 'Unauthorized') { s.remove(); ok(false); } }, true);
    setTimeout(() => ok(false), 6000);
  });
  if (!listo) { cambiar(() => ({ reloj: { estado: 'error', mensaje: 'Turn Bluetooth on' } })); return; }

  // 1) si el reloj ya está conectado al teléfono y expone pulso, se usa directo
  try {
    const ya = await g.connectedDevices([SERVICIO]);
    for (const d of ya) if (await usar(d)) return;
  } catch {}

  // 2) búsqueda: muchos relojes (el GT 2 entre ellos) no anuncian 0x180D antes de conectar; se prueban también
  //    los que parecen relojes o bandas por su nombre, y se confirma el servicio después de conectar
  const vistos = new Set<string>();
  let probando = false;
  const tope = setTimeout(() => {
    g.stopDeviceScan();
    if (!equipo) cambiar(() => ({ reloj: { estado: 'error', mensaje: 'No watch broadcasting heart rate was found. See «Connect your watch» for how to turn it on for your brand.' } }));
  }, 30000);
  g.startDeviceScan(null, { allowDuplicates: false }, async (err, d) => {
    if (err) { clearTimeout(tope); cambiar(() => ({ reloj: { estado: 'error', mensaje: err.message } })); return; }
    if (!d || equipo || probando || vistos.has(d.id)) return;
    const nombre = d.name ?? d.localName ?? '';
    const anunciaPulso = (d.serviceUUIDs ?? []).some(u => u.toLowerCase().startsWith('0000180d'));
    if (!anunciaPulso && !/huawei|honor|watch|gt ?\d|band|polar|h10|hrm|heart|garmin|amazfit|coros|wahoo/i.test(nombre)) return;
    vistos.add(d.id);
    probando = true;
    if (await usar(d)) { g.stopDeviceScan(); clearTimeout(tope); }
    probando = false;
  });
}

/** conecta, confirma que tenga el servicio de pulso y se suscribe; si no lo tiene, se desconecta y sigue buscando */
async function usar(d: Device) {
  try {
    const e = await d.connect({ timeout: 10000 });
    await e.discoverAllServicesAndCharacteristics();
    const servicios = await e.services();
    if (!servicios.some(s => s.uuid.toLowerCase() === SERVICIO)) { try { await e.cancelConnection(); } catch {} return false; }
    equipo = e;
    const nombre = e.name ?? e.localName ?? 'Smartwatch';
    cambiar(() => ({ reloj: { estado: 'conectado', nombre } }));
    e.onDisconnected(() => { equipo = null; monitor = null; cambiar(() => ({ reloj: { estado: 'apagado', mensaje: 'Watch disconnected' }, fc: undefined })); });
    monitor = e.monitorCharacteristicForService(SERVICIO, MEDIDA, (er, c) => {
      if (er || !c?.value) return;
      const { bpm, rr } = leerMedida(bytes(c.value));
      if (!bpm) return;
      const ahora = Date.now(), nuevoSegundo = ahora - ultimoSegundo >= 1000;
      if (nuevoSegundo) ultimoSegundo = ahora;
      cambiar(v => {
        const todos = rr.length ? [...v.rr, ...rr].slice(-120) : v.rr;
        return { fc: bpm, serieFc: nuevoSegundo ? empujar(v.serieFc, bpm) : v.serieFc, rr: todos, rmssd: rmssd(todos.slice(-60)) };
      });
    });
    return true;
  } catch {
    try { await d.cancelConnection(); } catch {}
    return false;
  }
}

export async function desconectarReloj() {
  monitor?.remove(); monitor = null;
  gestor?.stopDeviceScan();
  if (equipo) { try { await equipo.cancelConnection(); } catch {} }
  equipo = null;
  cambiar(() => ({ reloj: { estado: 'apagado' }, fc: undefined, serieFc: [], rr: [], rmssd: undefined }));
}

/** diagnóstico para «Conecta tu reloj»: todos los equipos Bluetooth que se ven cerca durante 12 s y si anuncian pulso */
export type DiagReloj = { modulo: boolean; permiso?: boolean; bluetooth?: string; equipos: { nombre: string; rssi: number | null; pulso: boolean }[]; conectados: string[]; error?: string };
export async function diagnosticoReloj(): Promise<DiagReloj> {
  if (!relojDisponible()) return { modulo: false, equipos: [], conectados: [] };
  const d: DiagReloj = { modulo: true, equipos: [], conectados: [] };
  d.permiso = await permisos();
  if (!d.permiso) return d;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BleManager: Gestor } = require('react-native-ble-plx') as typeof import('react-native-ble-plx');
    gestor ??= new Gestor();
    const g = gestor;
    d.bluetooth = await g.state();
    if (d.bluetooth !== 'PoweredOn') return d;
    // los que ya están conectados al teléfono y exponen pulso (p. ej. por la app del reloj)
    try { d.conectados = (await g.connectedDevices([SERVICIO])).map(x => x.name ?? x.id); } catch {}
    const vistos = new Map<string, { nombre: string; rssi: number | null; pulso: boolean }>();
    await new Promise<void>(fin => {
      g.startDeviceScan(null, { allowDuplicates: false }, (err, x) => {
        if (err) { d.error = err.message; return; }
        if (!x) return;
        const pulso = (x.serviceUUIDs ?? []).some(u => u.toLowerCase().startsWith('0000180d'));
        vistos.set(x.id, { nombre: x.name ?? x.localName ?? '', rssi: x.rssi, pulso });
      });
      setTimeout(() => { g.stopDeviceScan(); fin(); }, 12000);
    });
    d.equipos = [...vistos.values()].filter(e => e.nombre || e.pulso).sort((a, b) => Number(b.pulso) - Number(a.pulso) || (b.rssi ?? -999) - (a.rssi ?? -999)).slice(0, 25);
  } catch (e) { d.error = (e as Error).message; }
  return d;
}

/** estado rápido del Bluetooth para el asistente de conexión (sin pedir permisos ni buscar) */
export async function estadoBluetooth(): Promise<{ modulo: boolean; permiso: boolean; encendido: boolean }> {
  if (!relojDisponible()) return { modulo: false, permiso: false, encendido: false };
  const P = PermissionsAndroid.PERMISSIONS;
  const lista = Number(Platform.Version) >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION];
  const permiso = (await Promise.all(lista.map(x => PermissionsAndroid.check(x)))).every(Boolean);
  if (!permiso) return { modulo: true, permiso, encendido: false };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BleManager: Gestor } = require('react-native-ble-plx') as typeof import('react-native-ble-plx');
  gestor ??= new Gestor();
  return { modulo: true, permiso, encendido: (await gestor.state()) === 'PoweredOn' };
}
