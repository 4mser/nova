/* Enlace con la nave (modo misión): el teléfono de cada astronauta le pasa sus datos reales al núcleo de a bordo de
   NOVA PC por la red de la nave, sin pasar por la Tierra ni por internet.
   · Cada 5 s: pulso y VFC del reloj o la banda de pecho, SpO2, pasos, luz y ruido.
   · Cada minuto (si cambió): sueño de anoche, pulso en reposo y, solo con «Compartir mi día», el ánimo y la energía
     del check-in. Solo números; nunca lo que escribes.
   Entra por el enlace HTTP de la nave (http://<pc-de-la-nave>:8750/v1/lote) y el núcleo lo trata con el mismo contrato
   que la estación médica (nova-pc/estacion/CONTRATO.md). También se puede leer el estado de la tripulación (/v1/estado). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { fechaDe, leerDiario } from '../engine/diario';
import { leerFunciones, useFunciones } from '../engine/funciones';
import { leerHistoriaActual, ultimos } from '../sensores/historia';
import { leer as leerVivo } from '../sensores/vivo';
import { leerPerfil } from '../engine/perfil';

export type Asiento = 'T1' | 'T2' | 'T3' | 'T4';
export type Pronombre = 'she/her' | 'he/him' | 'they/them';
export type Nave = { url: string; asiento: Asiento; token?: string; pronombre?: Pronombre };
export type EstadoEnlace = { ok: boolean; ultimo?: number; error?: string; enviadas: number };

const CLAVE = 'nova.nave.v1';
let nave: Nave = { url: '', asiento: 'T1' };
let enlace: EstadoEnlace = { ok: false, enviadas: 0 };
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach(o => o());
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };

export async function cargarNave() {
  try { const t = await AsyncStorage.getItem(CLAVE); if (t) { nave = { ...nave, ...JSON.parse(t) }; avisar(); } } catch {}
}
/** guarda la dirección de la nave (acepta «192.168.1.20», «nave.local:8750» o la URL completa) y el asiento */
export function cambiarNave(c: Partial<Nave>) {
  const url = c.url != null ? normalizar(c.url) : nave.url;
  nave = { ...nave, ...c, url };
  AsyncStorage.setItem(CLAVE, JSON.stringify(nave)).catch(() => {});
  enlace = { ok: false, enviadas: 0 };
  avisar();
}
function normalizar(s: string) {
  let u = s.trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//.test(u)) u = 'http://' + u;
  if (!/:\d+$/.test(u.replace(/^https?:\/\//, ''))) u += ':8750';
  return u;
}
export const leerNave = () => nave;
/** el escáner del cuerpo (AR) de la nave: va por el enlace seguro (8751), porque el navegador solo da la cámara a páginas
    seguras; lleva el asiento para abrir con esta persona elegida y el token si la nave lo pide */
export function urlEscaner(): string | null {
  const m = nave.url.match(/^https?:\/\/([^/:]+)/); if (!m) return null;
  const q = new URLSearchParams({ trip: nave.asiento, ...(nave.token ? { token: nave.token } : {}) });
  return `https://${m[1]}:8751/escaner.html?${q}`;
}
export const useNave = () => useSyncExternalStore(suscribir, leerNave, leerNave);
const leerEnlace = () => enlace;
export const useEnlaceEstado = () => useSyncExternalStore(suscribir, leerEnlace, leerEnlace);

type Medicion = { sensor: string; valor: number; unidad: string; calidad?: number };

async function enviar(mediciones: Medicion[]) {
  if (!nave.url || !mediciones.length) return;
  try {
    const r = await fetch(`${nave.url}/v1/lote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(nave.token ? { 'x-nova-token': nave.token } : {}) },
      // quién eres: la nave pone tu nombre (el de tu cuenta) y tus pronombres en tu asiento, en todas sus pantallas
      body: JSON.stringify({ trip: nave.asiento, fuente: 'nova-movil', mediciones, persona: leerPerfil().nombre ? { nombre: leerPerfil().nombre, pronombre: nave.pronombre, mente: !!leerFunciones().compartirDia } : undefined }),
    });
    const j = r.ok ? await r.json() : null;
    enlace = r.ok ? { ok: true, ultimo: Date.now(), enviadas: enlace.enviadas + (j?.enviadas ?? 0) } : { ...enlace, ok: false, error: `HTTP ${r.status}` };
  } catch {
    enlace = { ...enlace, ok: false, error: 'La nave no responde' };
  }
  avisar();
}

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** lo que cambia segundo a segundo */
function enVivo(): Medicion[] {
  const v = leerVivo(), m: Medicion[] = [];
  const relojVivo = v.reloj.estado === 'conectado' && Date.now() - v.actualizado < 15e3;
  if (relojVivo && num(v.fc)) m.push({ sensor: 'pulso', valor: v.fc, unidad: 'lpm', calidad: 0.95 });
  if (relojVivo && num(v.rmssd)) m.push({ sensor: 'vfc', valor: Math.round(v.rmssd), unidad: 'ms', calidad: 0.9 });
  if (num(v.salud?.spo2)) m.push({ sensor: 'spo2', valor: v.salud!.spo2!, unidad: '%', calidad: 0.8 });
  const pasos = v.salud?.pasos ?? (v.sensores.pasos ? v.pasos : undefined);
  if (num(pasos)) m.push({ sensor: 'pasos', valor: pasos, unidad: 'pasos' });
  if (num(v.luz)) m.push({ sensor: 'luz', valor: Math.round(v.luz), unidad: 'lux' });
  if (num(v.ruido)) m.push({ sensor: 'ruido', valor: Math.round(v.ruido), unidad: 'dB' });
  return m;
}

/** lo que cambia pocas veces al día */
let huellaDiaria = '';
function delDia(forzar = false): Medicion[] {
  const v = leerVivo(), m: Medicion[] = [];
  const sueno = v.salud?.sueno?.horas;
  if (num(sueno)) m.push({ sensor: 'sueno_h', valor: Math.round(sueno * 10) / 10, unidad: 'h' });
  const dos = ultimos(leerHistoriaActual().dias, 2).reverse(), fcReposo = v.salud?.fcReposo ?? dos.find(d => d.fcReposo != null)?.fcReposo;
  if (num(fcReposo)) m.push({ sensor: 'fc_reposo', valor: fcReposo, unidad: 'lpm' });
  // el check-in solo sale del teléfono si la persona comparte su día
  if (leerFunciones().compartirDia) {
    const r = leerDiario().registros[fechaDe(Date.now())];
    if (num(r?.valores.animo)) m.push({ sensor: 'animo', valor: r!.valores.animo!, unidad: '1-5' });
    if (num(r?.valores.energia)) m.push({ sensor: 'energia', valor: r!.valores.energia!, unidad: '1-5' });
  }
  const h = JSON.stringify(m);
  if (!forzar && h === huellaDiaria) return [];
  huellaDiaria = h;
  return m;
}

/** estado de la tripulación según la nave (para mostrarlo en el teléfono) */
export async function estadoTripulacion(): Promise<unknown | null> {
  if (!nave.url) return null;
  try { const r = await fetch(`${nave.url}/v1/estado`); return r.status === 200 ? await r.json() : null; } catch { return null; }
}

/** se monta una vez (en el layout): manda los datos mientras el modo misión esté encendido y haya nave configurada */
export function useEnlaceNave() {
  const { mision, compartirDia } = useFunciones(), { url, asiento } = useNave();
  useEffect(() => { cargarNave(); }, []);
  useEffect(() => {
    if (!mision || !url) return;
    huellaDiaria = '';
    let vueltas = 0;
    const tic = () => {
      if (AppState.currentState !== 'active') return;
      const lote = [...enVivo(), ...(vueltas % 12 === 0 ? delDia(vueltas === 0) : [])];
      vueltas++;
      enviar(lote);
    };
    tic();
    const id = setInterval(tic, 5000);
    const sub = AppState.addEventListener('change', s => { if (s === 'active') { huellaDiaria = ''; tic(); } });
    return () => { clearInterval(id); sub.remove(); };
  }, [mision, url, asiento, compartirDia]);
}
