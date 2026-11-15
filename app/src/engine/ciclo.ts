/* Ciclo: seguimiento o supresión menstrual, privado por defecto. Vive en el teléfono; a la nave (y de ahí al cirujano
   de vuelo) solo sale un resumen si la persona lo decide. Nunca aparece en la pantalla de la tripulación.
   Basado en la evidencia de la biblioteca de NOVA: Jain & Wotring 2016 (npj Microgravity) sobre supresión menstrual en
   astronautas, la revisión 2025 de Frontiers in Physiology (anemia, trombosis venosa) y NASA-STD-3001 Vol. 2
   (contención del sangrado a bordo). NOVA no es un dispositivo médico: las señales llevan a hablar con el cirujano. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { fechaDe, leerDiario } from './diario';
import { traductorActual } from '../i18n';

export type Modo = 'seguir' | 'suprimir';
export type Metodo = 'pildora_continua' | 'implante' | 'diu_hormonal' | 'otro';
export type Compartir = 'nada' | 'resumen';
/** 0 nada · 1 manchado · 2 leve · 3 moderado · 4 abundante */
export type Sangrado = 0 | 1 | 2 | 3 | 4;
export const SINTOMAS = ['Cramps', 'Headache', 'Low mood', 'Fatigue', 'Breast tenderness', 'Nausea', 'Burning when you pee', 'Leg pain or swelling', 'Neck pain or swelling', 'Chest pain or short of breath'] as const;
export type Sintoma = (typeof SINTOMAS)[number];
/** síntomas que nunca se dejan para después */
/* el cuello va aquí porque en vuelo los coágulos aparecieron en la vena yugular (Marshall-Goebel, JAMA Netw Open 2019) */
export const SINTOMAS_URGENTES: Sintoma[] = ['Leg pain or swelling', 'Neck pain or swelling', 'Chest pain or short of breath'];

export type DiaCiclo = { fecha: string; sangrado: Sangrado; sintomas: Sintoma[]; pildora?: boolean };
export type Config = {
  activo: boolean; modo: Modo; metodo: Metodo | null; horaPildora: string; avisoPildora: boolean;
  pildoras?: number; toallas?: number; finMision?: string; compartir: Compartir; notif?: string;
  /** fecha de la última ecografía de la vena yugular (la NASA la pide a toda la tripulación: OCHMO-MTB-007) */
  ecoYugular?: string;
};
const CLAVE = 'nova.ciclo.v1';
let config: Config = { activo: false, modo: 'seguir', metodo: null, horaPildora: '21:00', avisoPildora: false, compartir: 'nada' };
let dias: Record<string, DiaCiclo> = {};
let inst = { config, dias };
const oyentes = new Set<() => void>();
const avisar = () => { inst = { config, dias }; oyentes.forEach(o => o()); };
const guardar = () => { avisar(); AsyncStorage.setItem(CLAVE, JSON.stringify({ config, dias })).catch(() => {}); };

export async function cargarCiclo() {
  try {
    const t = await AsyncStorage.getItem(CLAVE);
    if (t) { const d = JSON.parse(t); config = { ...config, ...d.config }; dias = d.dias ?? {}; avisar(); }
  } catch {}
}
export const leerCiclo = () => inst;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export const useCiclo = () => useSyncExternalStore(suscribir, leerCiclo, leerCiclo);

export function cambiarConfig(c: Partial<Config>) {
  config = { ...config, ...c };
  guardar();
  if ('avisoPildora' in c || 'horaPildora' in c || 'modo' in c || 'metodo' in c || 'activo' in c) programarPildora().catch(() => {});
}

export function registrarDia(fecha: string, c: Partial<Omit<DiaCiclo, 'fecha'>>) {
  const antes = dias[fecha] ?? { fecha, sangrado: 0 as Sangrado, sintomas: [] };
  const nuevo = { ...antes, ...c };
  // al marcar la píldora de hoy se descuenta del inventario (y se devuelve si se desmarca)
  if (c.pildora !== undefined && c.pildora !== !!antes.pildora && config.pildoras != null) {
    config = { ...config, pildoras: Math.max(0, config.pildoras + (c.pildora ? -1 : 1)) };
  }
  dias = { ...dias, [fecha]: nuevo };
  guardar();
}

/** aviso diario para la píldora continua (se cancela al apagarlo o al cambiar de método) */
async function programarPildora() {
  if (Platform.OS === 'web') return;
  if (config.notif) { await Notifications.cancelScheduledNotificationAsync(config.notif).catch(() => {}); config = { ...config, notif: undefined }; }
  if (!config.activo || !config.avisoPildora || config.modo !== 'suprimir' || config.metodo !== 'pildora_continua') { guardar(); return; }
  const [h, m] = config.horaPildora.split(':').map(Number);
  const id = await Notifications.scheduleNotificationAsync({
    content: { title: 'Nova', body: traductorActual().t('Time for your pill. Tap to mark it taken.'), data: { nova: 'ciclo-pildora' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: h || 21, minute: m || 0, channelId: 'recordatorios' },
  });
  config = { ...config, notif: id };
  guardar();
}

// ---------------------------------------------------------------------------- cálculos

const DIA = 864e5;
const fechaN = (n: number) => fechaDe(Date.now() - n * DIA);
const ultimosDias = (n: number) => Array.from({ length: n }, (_, i) => fechaN(n - 1 - i)).map(f => dias[f] ?? { fecha: f, sangrado: 0 as Sangrado, sintomas: [] });

/** inicios de período: primer día con sangrado leve o más después de 2+ días sin sangrar */
export function inicios(): string[] {
  const fechas = Object.keys(dias).sort(), out: string[] = [];
  let ultimoSangrado = -Infinity;
  for (const f of fechas) {
    const t = new Date(f + 'T12:00:00').getTime();
    if (dias[f].sangrado >= 2) {
      if (t - ultimoSangrado > 2 * DIA) out.push(f);
      ultimoSangrado = t;
    }
  }
  return out;
}

export type Resumen = {
  modo: Modo;
  // seguimiento
  diaCiclo?: number; largoMedio?: number; proximoEnDias?: number; ciclos: number;
  // supresión
  sangradoIrruptivo30: number; adherencia30?: number;
  // insumos
  diasPildoras?: number; diasMision?: number; faltanPildoras?: number;
  // señales
  senales: { nivel: 'urgente' | 'atencion' | 'info'; clave: string; datos?: Record<string, string | number> }[];
};

export function resumen(): Resumen {
  const ult30 = ultimosDias(30), hoy = fechaDe(Date.now());
  const ini = inicios();
  const largos = ini.slice(1).map((f, i) => Math.round((new Date(f).getTime() - new Date(ini[i]).getTime()) / DIA)).filter(d => d >= 15 && d <= 60);
  const largoMedio = largos.length ? Math.round(largos.reduce((a, b) => a + b, 0) / largos.length) : undefined;
  const ultimoIni = ini.at(-1);
  const diaCiclo = ultimoIni ? Math.floor((new Date(hoy).getTime() - new Date(ultimoIni).getTime()) / DIA) + 1 : undefined;
  const r: Resumen = {
    modo: config.modo, ciclos: ini.length, largoMedio, diaCiclo,
    proximoEnDias: largoMedio && diaCiclo ? largoMedio - diaCiclo + 1 : undefined,
    sangradoIrruptivo30: config.modo === 'suprimir' ? ult30.filter(d => d.sangrado >= 1).length : 0,
    senales: [],
  };
  if (config.modo === 'suprimir' && config.metodo === 'pildora_continua') {
    const marcados = ult30.filter(d => d.pildora !== undefined);
    if (marcados.length >= 3) r.adherencia30 = Math.round(100 * marcados.filter(d => d.pildora).length / marcados.length);
  }
  if (config.finMision) {
    r.diasMision = Math.max(0, Math.ceil((new Date(config.finMision).getTime() - Date.now()) / DIA));
    if (config.metodo === 'pildora_continua' && config.pildoras != null) {
      r.diasPildoras = config.pildoras;
      r.faltanPildoras = Math.max(0, r.diasMision - config.pildoras);
    }
  }

  // señales (de lo más grave a lo menos)
  const hoyD = dias[hoy], recientes = ultimosDias(3).flatMap(d => d.sintomas);
  const estrogeno = config.modo === 'suprimir' && config.metodo === 'pildora_continua';
  for (const s of SINTOMAS_URGENTES) {
    if (recientes.includes(s)) r.senales.push({ nivel: 'urgente', clave: s === 'Leg pain or swelling' ? 'trombosis_pierna' : s === 'Neck pain or swelling' ? 'trombosis_cuello' : 'trombosis_pecho', datos: { estrogeno: estrogeno ? 1 : 0 } });
  }
  const abundantes = ultimosDias(7).filter(d => d.sangrado >= 4).length;
  const diario = leerDiario().registros, energias = ultimosDias(7).map(d => diario[d.fecha]?.valores.energia).filter((x): x is number => x != null);
  const energiaBaja = energias.length >= 2 && energias.reduce((a, b) => a + b, 0) / energias.length <= 2.5;
  if (abundantes >= 3 || (abundantes >= 2 && energiaBaja)) r.senales.push({ nivel: 'atencion', clave: 'anemia', datos: { dias: abundantes } });
  if (config.modo === 'suprimir' && r.sangradoIrruptivo30 >= 3) r.senales.push({ nivel: 'atencion', clave: 'irruptivo', datos: { dias: r.sangradoIrruptivo30 } });
  if (r.adherencia30 != null && r.adherencia30 < 90) r.senales.push({ nivel: 'atencion', clave: 'adherencia', datos: { pct: r.adherencia30 } });
  if (r.faltanPildoras) r.senales.push({ nivel: 'atencion', clave: 'insumos', datos: { faltan: r.faltanPildoras } });
  if (recientes.includes('Burning when you pee')) r.senales.push({ nivel: 'atencion', clave: 'urinaria' });
  if (r.diasMision != null && r.diasMision <= 30) r.senales.push({ nivel: 'info', clave: 'regreso', datos: { n: r.diasMision } });
  if (!config.ecoYugular) r.senales.push({ nivel: 'info', clave: 'eco_yugular' });
  if (config.modo === 'seguir' && hoyD && hoyD.sangrado >= 1 && config.toallas != null && config.toallas < 10) r.senales.push({ nivel: 'info', clave: 'toallas', datos: { n: config.toallas } });
  return r;
}

/** lo único que puede salir del teléfono (si la persona lo decide): un resumen sin detalle día a día */
export function resumenParaCirujano() {
  const r = resumen();
  return {
    modo: r.modo, metodo: config.metodo, sangrado_irruptivo_30d: r.sangradoIrruptivo30, adherencia_30d: r.adherencia30 ?? null,
    dias_de_pildoras: r.diasPildoras ?? null, faltan_pildoras: r.faltanPildoras ?? null, eco_yugular: config.ecoYugular ?? null,
    senales: r.senales.filter(s => s.nivel !== 'info').map(s => s.clave), fecha: fechaDe(Date.now()),
  };
}
