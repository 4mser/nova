/* Tu rutina: lo fijo de tu semana que no está en el calendario del teléfono (trabajo, reuniones de siempre, clases,
   gimnasio, traslados…). Se lo dices a NOVA («trabajo de lunes a viernes de 9 a 18», «los martes tengo reu a las
   10») o lo agregas en /rutina. Cuenta como ocupado para los huecos libres, la agenda de Hoy y lo que NOVA propone.
   Vive en el teléfono. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import type { Evento } from '../sensores/agenda';

export type TipoBloque = 'trabajo' | 'reunion' | 'clase' | 'ejercicio' | 'traslado' | 'otro';
/** dias: 0 = domingo … 6 = sábado; ini/fin «HH:MM» (fin puede ser menor que ini si cruza la medianoche) */
export type Bloque = { id: string; titulo: string; tipo: TipoBloque; dias: number[]; ini: string; fin: string };

export const TIPOS_BLOQUE: { k: TipoBloque; t: string; icono: string }[] = [
  { k: 'trabajo', t: 'Work', icono: 'briefcase-outline' }, { k: 'reunion', t: 'Meeting', icono: 'people-outline' },
  { k: 'clase', t: 'Class', icono: 'school-outline' }, { k: 'ejercicio', t: 'Exercise', icono: 'barbell-outline' },
  { k: 'traslado', t: 'Commute', icono: 'car-outline' }, { k: 'otro', t: 'Other', icono: 'ellipse-outline' },
];

const CLAVE = 'nova.rutina.v1';
let bloques: Bloque[] = [];
let inst = { bloques };
const oyentes = new Set<() => void>();
const guardar = () => { inst = { bloques }; oyentes.forEach(o => o()); AsyncStorage.setItem(CLAVE, JSON.stringify(bloques)).catch(() => {}); };

export async function cargarRutina() {
  try { const t = await AsyncStorage.getItem(CLAVE); if (t) { bloques = JSON.parse(t); inst = { bloques }; oyentes.forEach(o => o()); } } catch {}
}

const hhmm = (s: string) => { const m = String(s).match(/(\d{1,2})(?:[:.h](\d{2}))?/); if (!m) return null; const h = Number(m[1]), mm = Number(m[2] ?? 0); return h <= 24 && mm < 60 ? `${String(h % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : null; };
const minutos = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

/** agrega (o reemplaza uno con el mismo título y días) */
export function agregarBloque(b: Omit<Bloque, 'id' | 'ini' | 'fin'> & { ini: string; fin: string }) {
  const ini = hhmm(b.ini), fin = hhmm(b.fin);
  if (!ini || !fin || !b.dias.length || ini === fin) return null;
  const titulo = b.titulo.trim().slice(0, 60) || b.tipo;
  const igual = bloques.find(x => x.titulo.toLowerCase() === titulo.toLowerCase() && x.dias.join() === [...b.dias].sort().join());
  const nuevo: Bloque = { id: igual?.id ?? `b${Date.now().toString(36)}`, titulo, tipo: b.tipo, dias: [...new Set(b.dias)].sort(), ini, fin };
  bloques = [...bloques.filter(x => x.id !== nuevo.id), nuevo];
  guardar();
  return nuevo;
}
export function quitarBloque(id: string) { bloques = bloques.filter(x => x.id !== id); guardar(); }
/** quita por título (para la voz: «ya no tengo la reu de los martes») */
export function quitarPorTitulo(titulo: string) {
  const n = titulo.trim().toLowerCase();
  const antes = bloques.length;
  bloques = bloques.filter(x => !(n.length > 2 && x.titulo.toLowerCase().includes(n)));
  if (bloques.length !== antes) guardar();
  return antes - bloques.length;
}

/** los bloques de la rutina como eventos, desde el inicio de `desde` por `dias` días (para sumarlos a la agenda) */
export function eventosRutina(desde: number, dias = 2): Evento[] {
  const res: Evento[] = [];
  const d0 = new Date(desde); d0.setHours(0, 0, 0, 0);
  for (let i = 0; i < dias; i++) {
    const dia = new Date(d0); dia.setDate(d0.getDate() + i);
    for (const b of bloques) {
      if (!b.dias.includes(dia.getDay())) continue;
      const ini = dia.getTime() + minutos(b.ini) * 60e3;
      let fin = dia.getTime() + minutos(b.fin) * 60e3;
      if (fin <= ini) fin += 864e5;
      res.push({ id: `rutina|${b.id}|${ini}`, titulo: b.titulo, ini, fin, todoElDia: false, libre: false, color: '#a898ff', lugar: undefined });
    }
  }
  return res.sort((a, b) => a.ini - b.ini);
}

export const leerRutina = () => inst;
export const suscribirRutina = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
export function useRutina() { return useSyncExternalStore(suscribirRutina, leerRutina, leerRutina); }
