/* El plan del día en hora de la nave (UTC), el mismo que muestran Today, los widgets y NOVA. */
export type Bloque = { h: string; t: string; d: string; min: number };
export const AGENDA: Bloque[] = [
  { h: '08:30', t: 'Breakfast and medication', d: 'Galley, with the crew', min: 30 },
  { h: '10:00', t: 'Spacewalk prep', d: 'With Kenji in Node 2', min: 180 },
  { h: '13:30', t: 'Resistance training', d: '60 min on ARED', min: 60 },
  { h: '16:00', t: 'Science block', d: 'Plant growth module', min: 120 },
  { h: '21:00', t: 'Evening check-in', d: 'About a minute in your journal', min: 10 },
];

const minutos = (hhmm: string) => { const [a, b] = hhmm.split(':').map(Number); return a * 60 + b; };
export const horaNave = (ts: number) => { const d = new Date(ts); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };

/** cada bloque con su estado a esta hora: hecho, ahora o después */
export function estadoAgenda(ts: number) {
  const ahora = minutos(horaNave(ts));
  return AGENDA.map(b => {
    const ini = minutos(b.h), fin = ini + b.min;
    return { ...b, estado: ahora >= fin ? ('hecho' as const) : ahora >= ini ? ('ahora' as const) : ('luego' as const), faltan: ini - ahora };
  });
}

/** lo próximo que no ha terminado (o el primero de mañana) */
export function proximo(ts: number) {
  return estadoAgenda(ts).find(b => b.estado !== 'hecho') ?? { ...AGENDA[0], estado: 'luego' as const, faltan: minutos(AGENDA[0].h) + 1440 - minutos(horaNave(ts)) };
}

/** la misión: avance hacia Marte y la próxima sesión con la psicóloga */
export const MISION = { avance: 0.62, solesRestantes: 131, tripulacion: 4, sesionEnDias: 2, sesion: 'Saturday, 10:00' };
