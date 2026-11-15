/* Lo que NOVA sabe al abrir una conversación: el día (tareas, foco, crew, retos) o los datos de la misión, más lo que
   llega en vivo del reloj y el teléfono. Lo usan el chat (src/app/nova.tsx) y la capa del asistente (src/asistente). */
import { CLAVE_TAREAS, leerCache, type Reto, type Tarea, aCargo } from '../cuenta/datos';
import type { useCrew, useSesion } from '../cuenta/sesion';
import { datosDelDia } from '../engine/conversa';
import { contextoDiario } from '../engine/dia';
import { fechaDe, resumenRegistro } from '../engine/diario';
import { leerFoco, minutosDe } from '../engine/foco';
import { resumenVivo } from '../sensores/vivo';
import { alarmasRecordadas } from './alarmas';

type Crew = ReturnType<typeof useCrew>;
type Usuario = ReturnType<typeof useSesion>['usuario'];

export function datosConversacion({ mision, usuario, crew, nombre }: { mision: boolean; usuario: Usuario; crew: Crew; nombre: string }) {
  const alarmas = alarmasRecordadas();
  const alarmasTxt = alarmas.length ? `\nALARMS YOU SET in the phone Clock app (newest last; quitar_alarma removes one by its exact label or time): ${alarmas.map(a => `${a.hora}${a.etiqueta ? ` «${a.etiqueta}»` : ''}`).join(' · ')}` : '';
  const vivoTxt = `\nLIVE DEVICE DATA (real, from their watch and phone, updates during the conversation):\n${resumenVivo()}${resumenRegistro() ? `\n${resumenRegistro()}` : ''}${alarmasTxt}`;
  if (mision) return datosDelDia() + vivoTxt;
  const ahora = Date.now(), hoyF = fechaDe(ahora), nombreDe = (id: string) => crew?.miembros.find(m => m.id === id)?.nombre ?? '?';
  const tareas = (leerCache<Tarea[]>(CLAVE_TAREAS) ?? []).map(x => ({ titulo: x.titulo, hecha: x.hecha, vence: x.vence, deCrew: !!x.crew, asignadaAMi: aCargo(x).includes(usuario?.id ?? '') }));
  const semana = leerFoco().sesiones.filter(x => x.ini > ahora - 7 * 864e5 && x.tipo === 'foco').reduce((a, x) => a + x.min, 0);
  const retos = crew ? (leerCache<Reto[]>(`retos:${crew.id}`) ?? []).map(r => `${r.titulo} (${Math.round(r.total)} of ${r.meta}, until ${r.hasta})`) : [];
  return contextoDiario({
    ahora, nombre: usuario?.nombre ?? nombre, tareas, focoHoy: minutosDe(hoyF, 'foco'), aprenderHoy: minutosDe(hoyF, 'aprender'), focoSemana: semana,
    crew: crew ? { nombre: crew.nombre, miembros: crew.miembros.map(m => m.nombre), subieron: crew.hoy.subieron.map(nombreDe), momentoAbierto: ahora >= crew.hoy.momento && ahora - crew.hoy.momento < 10 * 60e3, retos } : undefined,
  }) + vivoTxt;
}
