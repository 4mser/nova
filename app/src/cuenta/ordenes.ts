/* Órdenes desde NOVA en el Mac (mac/): cuando le pides algo del teléfono al widget del escritorio (una alarma, música,
   leer tus mensajes, un pantallazo del celular…), la API se lo pasa al teléfono y la app lo hace con las mismas
   herramientas de la conversación (src/voz/acciones.ts). La respuesta vuelve al Mac para que NOVA la diga allá.
   · con la app abierta llegan al instante por el tiempo real (tipo «orden»)
   · con la app cerrada llega un aviso; al abrirla se hacen las pendientes (las de más de 10 min las borra la API)
   Cada orden se «toma» primero: si hay dos teléfonos o la web abiertos, la hace uno solo. */
import { pedir } from './api';
import { CLAVE_TAREAS, leerCache, type Tarea } from './datos';
import { leerSesion } from './sesion';
import { traductorActual } from '../i18n';
import { ejecutar } from '../voz/acciones';

export type Orden = { id: string; herramienta: string; args: Record<string, unknown>; creada: number };

const enCurso = new Set<string>();

export async function hacerOrden(o: Orden) {
  if (enCurso.has(o.id)) return;
  enCurso.add(o.id);
  try {
    const tomada = await pedir<{ ok: boolean }>(`/v1/telefono/ordenes/${o.id}/tomar`, { metodo: 'POST' }).catch(() => ({ ok: false }));
    if (!tomada.ok) return;
    const { usuario, crews, crewId } = leerSesion(), crew = crews.find(c => c.id === crewId) ?? null;
    let respuesta: Record<string, unknown>;
    try {
      const r = await ejecutar(o.herramienta, o.args ?? {}, { tr: traductorActual(), crew: crew ? { id: crew.id, nombre: crew.nombre } : null, tareas: leerCache<Tarea[]>(CLAVE_TAREAS) ?? [], yo: usuario?.id });
      respuesta = r?.respuesta ?? { ok: false, motivo: `${o.herramienta} is not a phone tool` };
    } catch (e) {
      respuesta = { ok: false, motivo: (e as Error).message };
    }
    await pedir(`/v1/telefono/ordenes/${o.id}/respuesta`, { json: { respuesta } }).catch(() => {});
  } finally {
    enCurso.delete(o.id);
  }
}

/** al conectar (la app se abrió, por ejemplo desde el aviso): hace las que quedaron esperando */
export async function hacerPendientes() {
  const l = await pedir<Orden[]>('/v1/telefono/ordenes').catch(() => [] as Orden[]);
  for (const o of l) await hacerOrden(o);
}
