/* Cómo está cada persona de la crew, a partir de lo que cada una decide compartir: sueño, ánimo y energía del check-in
   (con «Compartir mi día») y la recuperación contra su propia línea base (con «Compartir mi salud», aparte).
   Reglas simples y prudentes, las mismas que usa la API para avisar: nada de diagnósticos, solo señales a cuidar.
     · bien: ninguna señal baja · atento: una · cuidar: dos o más
     · racha: días seguidos (hasta hoy, o ayer si hoy aún no hay datos) con al menos una señal baja */
import type { EstadoDia } from '../cuenta/datos';
import { fechaDe } from './diario';

export type Senal = 'sueno' | 'animo' | 'energia' | 'recup';
export type Nivel = 'bien' | 'atento' | 'cuidar' | 'sin';
export type DiaMiembro = { fecha: string; nivel: Nivel; bajas: Senal[]; e?: EstadoDia };
export type SaludMiembro = { usuario: string; hoy: DiaMiembro; dias: DiaMiembro[]; racha: number; comparteSalud: boolean };

export function bajasDe(e?: EstadoDia): Senal[] {
  if (!e) return [];
  const b: Senal[] = [];
  if (e.suenoH != null && e.suenoH > 0 && e.suenoH < 6) b.push('sueno');
  if (e.animo != null && e.animo <= 2) b.push('animo');
  if (e.energia != null && e.energia <= 2) b.push('energia');
  if (e.recup === 1) b.push('recup');
  return b;
}
const conDatos = (e?: EstadoDia) => !!e && (e.suenoH != null || e.animo != null || e.energia != null || e.recup != null);

export function nivelDia(fecha: string, e?: EstadoDia): DiaMiembro {
  if (!conDatos(e)) return { fecha, nivel: 'sin', bajas: [], e };
  const bajas = bajasDe(e);
  return { fecha, nivel: bajas.length >= 2 ? 'cuidar' : bajas.length === 1 ? 'atento' : 'bien', bajas, e };
}

/** los últimos `n` días (de más antiguo a hoy) de cada miembro */
export function saludCrew(miembros: string[], estados: EstadoDia[], ahora: number, n = 7): SaludMiembro[] {
  const fechas = Array.from({ length: n }, (_, i) => fechaDe(ahora - (n - 1 - i) * 864e5));
  const por = new Map(estados.map(e => [`${e.usuario}|${e.fecha}`, e]));
  return miembros.map(u => {
    const dias = fechas.map(f => nivelDia(f, por.get(`${u}|${f}`)));
    const hoy = dias[dias.length - 1];
    let racha = 0;
    for (let i = dias.length - (hoy.nivel === 'sin' ? 2 : 1); i >= 0 && (dias[i].nivel === 'atento' || dias[i].nivel === 'cuidar'); i--) racha++;
    return { usuario: u, hoy, dias, racha, comparteSalud: dias.some(d => d.e?.salud === 1) };
  });
}

/** el rango de 7 días que usan Crew, la salud de la crew y NOVA (misma clave de caché) */
export const rango7 = (ahora: number) => ({ desde: fechaDe(ahora - 6 * 864e5), hasta: fechaDe(ahora) });

/** el último día con datos (hoy, o ayer si hoy aún no compartió) */
export const ultimoDia = (s: SaludMiembro) => (s.hoy.nivel !== 'sin' ? s.hoy : s.dias[s.dias.length - 2]?.nivel !== 'sin' ? s.dias[s.dias.length - 2] : null);
