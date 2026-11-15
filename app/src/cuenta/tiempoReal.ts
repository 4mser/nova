/* Tiempo real: un WebSocket con la API mientras la app está abierta. El servidor solo avisa qué cambió; las consultas
   de ese tipo se recargan (datos.ts). Los avisos de otros miembros aparecen como un aviso breve arriba. */
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { API, tokenActual } from './api';
import { invalidar, type Tipo } from './datos';
import { hacerOrden, hacerPendientes, type Orden } from './ordenes';
import { leerSesion, useSesion } from './sesion';

export type Aviso = { id: number; tipo: Tipo; nombre?: string; titulo?: string; emoji?: string; hecha?: boolean; paraMi?: boolean };
let aviso: Aviso | null = null, n = 0;
const oyentes = new Set<() => void>();
const poner = (a: Aviso | null) => { aviso = a; oyentes.forEach(o => o()); };
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export const useAviso = () => useSyncExternalStore(suscribir, () => aviso, () => aviso);
export const cerrarAviso = () => poner(null);

/** se monta una vez en la raíz: conecta con sesión y app al frente; reconecta con espera creciente */
export function useTiempoReal() {
  const { usuario } = useSesion();
  useEffect(() => {
    if (!usuario) return;
    let ws: WebSocket | null = null, vivo = true, espera = 1000, reintento: ReturnType<typeof setTimeout> | undefined;
    const conectar = () => {
      if (!vivo || ws || AppState.currentState !== 'active' || !tokenActual()) return;
      ws = new WebSocket(`${API.replace(/^http/, 'ws')}/v1/vivo?k=${encodeURIComponent(tokenActual()!)}`);
      ws.onopen = () => { espera = 1000; invalidar('todo'); hacerPendientes(); };
      ws.onmessage = e => {
        let m: { tipo: string; de?: string; nombre?: string; titulo?: string; emoji?: string; puesta?: boolean; hecha?: boolean; para?: string | null; borrada?: boolean; borrado?: boolean };
        try { m = JSON.parse(String(e.data)); } catch { return; }
        if (m.tipo === 'hola') return;
        // NOVA en el Mac le pide algo al teléfono (src/cuenta/ordenes.ts)
        if (m.tipo === 'orden') { hacerOrden(m as unknown as Orden); return; }
        invalidar(m.tipo as Tipo);
        const yo = leerSesion().usuario?.id;
        if (!m.de || m.de === yo || m.borrada || m.borrado) return;
        if (m.tipo === 'foto' || m.tipo === 'reto' || (m.tipo === 'reaccion' && m.puesta && m.para === yo) || (m.tipo === 'tarea' && (m.hecha || m.para === yo)))
          poner({ id: ++n, tipo: m.tipo as Tipo, nombre: m.nombre, titulo: m.titulo, emoji: m.emoji, hecha: m.hecha, paraMi: m.para === yo });
      };
      ws.onclose = () => {
        ws = null;
        if (vivo && AppState.currentState === 'active') { reintento = setTimeout(conectar, espera); espera = Math.min(30e3, espera * 2); }
      };
      ws.onerror = () => {};
    };
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') conectar();
      else { clearTimeout(reintento); ws?.close(); ws = null; }
    });
    conectar();
    return () => { vivo = false; clearTimeout(reintento); sub.remove(); ws?.close(); };
  }, [usuario]);
}
