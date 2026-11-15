/* Lo que el teléfono sabe de la nave (modo misión con enlace): el estado de la tripulación (/v1/estado, cada 5 s),
   la misión real (/v1/mision: día, fase, retraso de la luz, conjunción; cada minuto) y la bandeja de Casa
   (/v1/casa: lo que la familia dejó, que llega con el retraso de la luz; cada minuto, guardada para verla sin enlace).
   Un solo lugar para Hoy, Crew, Emergencia, Casa y el widget. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFunciones } from '../engine/funciones';
import { leerNave, useNave } from './nave';

export type Nivel = 'normal' | 'esperado_vuelo' | 'atencion' | 'aviso_tierra' | 'sin_dato';
export type TripNave = {
  pulso: number; spo2: number; pa_sis: number; pa_dia: number; temp: number; fr: number; glucosa: number; vfc: number;
  sueno_h: number; animo: number; energia: number; pasos: number; nivel: Nivel;
  niveles: Record<string, Nivel>; edades: Record<string, number>;
};
export type EstadoNave = { t: number; trip: TripNave[]; cabina: { co2: number; o2: number; temp: number; nivel_co2: Nivel } };
export type MisionNave = { dia: number; fase: 'cruise' | 'mars' | 'return'; llegada_en_dias: number; distancia_km: number; luz_seg: number; conjuncion: boolean; total_dias: number };
export type MensajeCasa = { id: string; trip: string; de: string; relacion: string; texto: string; tipo: 'foto' | 'texto'; archivo?: string | null; enviado: number; llega: number; luz_ms: number };
export type RespuestaCasa = { id: string; a: string; texto: string; archivo?: string | null; creado: number; estado: 'en_cola' | 'enviado' };
export type Casa = { mensajes: MensajeCasa[]; en_camino: number; proximo_llega?: number | null; respuestas: RespuestaCasa[] };

/** `vacio`: con tripulación real, un asiento que nadie ocupa (no se muestra); `real`: lo ocupa alguien vinculado */
export type Tripulante = { id: string; nombre: string; corto: string; rol: string; ini: string; col: string; pronombre?: string; real?: boolean; vacio?: boolean };
export type SistemasNave = { nucleo: { en_linea: boolean; ultimo_contacto: number; comandos_conocidos: number; eventos_conocidos: number }; subida: { id: string; nombre: string; argumentos: string[]; motivo: string; enviado: number; llega: number; estado: string }[] };
type Instantanea = { estado: EstadoNave | null; mision: MisionNave | null; casa: Casa | null; tripulacion: Tripulante[]; sistemas: SistemasNave | null; vivo: boolean; recibido: number };
const CLAVE_CASA = 'nova.nave.casa.v1';
let inst: Instantanea = { estado: null, mision: null, casa: null, tripulacion: [], sistemas: null, vivo: false, recibido: 0 };
const oyentes = new Set<() => void>();
const cambiar = (c: Partial<Instantanea>) => { inst = { ...inst, ...c }; oyentes.forEach(o => o()); };
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export const leerNaveEstado = () => inst;
export const useNaveEstado = () => useSyncExternalStore(suscribir, leerNaveEstado, leerNaveEstado);

/** índice de mi asiento (T1 → 0) */
export const miIndice = () => Math.max(0, Number(leerNave().asiento.slice(1)) - 1);
export const urlArchivoCasa = (id: string) => `${leerNave().url}/v1/casa/archivo/${id}`;

async function json<T>(ruta: string): Promise<T | null> {
  const { url } = leerNave();
  if (!url) return null;
  const r = await fetch(url + ruta);
  return r.status === 200 ? ((await r.json()) as T) : null;
}

async function pedirEstado() {
  try {
    const e = await json<EstadoNave>('/v1/estado');
    cambiar(e ? { estado: e, vivo: true, recibido: Date.now() } : { vivo: false });
  } catch { cambiar({ vivo: false }); }
}
async function pedirMision() {
  try { const m = await json<MisionNave>('/v1/mision'); if (m) cambiar({ mision: m }); } catch {}
  try { const l = await json<Tripulante[]>('/tripulacion.json'); if (l?.length) cambiar({ tripulacion: l }); } catch {}
  try { const x = await json<SistemasNave>('/v1/sistemas'); if (x) cambiar({ sistemas: x }); } catch {}
}
export async function pedirCasa() {
  try {
    const c = await json<Casa>(`/v1/casa?trip=${leerNave().asiento}`);
    if (!c) return;
    const nuevo = c.mensajes[0]?.id !== inst.casa?.mensajes[0]?.id;
    cambiar({ casa: c });
    AsyncStorage.setItem(CLAVE_CASA, JSON.stringify(c)).catch(() => {});
    if (nuevo) {
      // el widget de Casa se prepara solo cuando llega algo nuevo
      try { (require('../widgets/casa') as typeof import('../widgets/casa')).actualizarWidgetCasa(c); } catch {} // eslint-disable-line @typescript-eslint/no-require-imports
    }
  } catch {}
}

/** responder a la familia: queda en la cola de bajada de la nave hasta el próximo contacto con la Tierra */
export async function responderCasa(a: string, texto: string, fotoBase64?: string) {
  const { url, asiento } = leerNave();
  if (!url) throw new Error('sin enlace');
  const r = await fetch(`${url}/v1/casa/respuesta`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trip: asiento, a, texto, ...(fotoBase64 ? { archivo_b64: fotoBase64 } : {}) }),
  });
  if (!r.ok) throw new Error(await r.text());
  await pedirCasa();
}

/** se monta una vez (en el layout): con modo misión y nave enlazada, mantiene todo al día */
export function useNaveEnVivo() {
  const { mision } = useFunciones(), { url, asiento } = useNave();
  useEffect(() => { AsyncStorage.getItem(CLAVE_CASA).then(t => { if (t && !inst.casa) cambiar({ casa: JSON.parse(t) }); }).catch(() => {}); }, []);
  useEffect(() => {
    if (!mision || !url) { cambiar({ estado: null, vivo: false }); return; }
    let vueltas = 0;
    const tic = () => {
      if (AppState.currentState !== 'active') return;
      pedirEstado();
      if (vueltas % 12 === 0) { pedirMision(); pedirCasa(); }
      vueltas++;
    };
    tic();
    const id = setInterval(tic, 5000);
    const sub = AppState.addEventListener('change', s => { if (s === 'active') { vueltas = 0; tic(); } });
    return () => { clearInterval(id); sub.remove(); };
  }, [mision, url, asiento]);
}
