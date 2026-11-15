/* Tu día con la crew: si lo permites (Tú → Compartir mi día), NOVA manda cada 10 minutos tus pasos, minutos de foco
   y de aprendizaje, ejercicio, sueño y el ánimo y la energía del check-in. Solo números; nunca lo que escribes.
   Con «Compartir mi salud» (aparte) suma la recuperación contra tu propia línea base, la FC en reposo y la VFC. */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { fechaDe, leerDiario } from '../engine/diario';
import { minutosDe } from '../engine/foco';
import { leerFunciones, useFunciones } from '../engine/funciones';
import { leerHistoriaActual, recuperacion, ultimos } from '../sensores/historia';
import { leer as leerVivo } from '../sensores/vivo';
import { compartirEstado, compartirHistoria, invalidar, leerCache, type ActividadStrava } from './datos';
import { useSesion } from './sesion';

let ultimo = '';

/** minutos de Strava de un día (si está conectado): cuentan como ejercicio aunque no pasen por Health Connect */
function stravaMin(fecha: string) {
  const s = leerCache<{ actividades: ActividadStrava[] }>('strava');
  const m = (s?.actividades ?? []).filter(a => a.fecha.slice(0, 10) === fecha).reduce((x, a) => x + a.min, 0);
  return m || undefined;
}
const mayor = (a?: number, b?: number) => (a == null ? b : b == null ? a : Math.max(a, b));

function saludHoy() {
  if (!leerFunciones().compartirSalud) return { salud: 0 };
  const { dias } = leerHistoriaActual(), rec = recuperacion(dias), dos = ultimos(dias, 2).reverse();
  return {
    salud: 1, recup: rec ? { baja: 1, normal: 2, buena: 3 }[rec.nivel] : undefined,
    fcReposo: dos.find(d => d.fcReposo != null)?.fcReposo, vfc: dos.find(d => d.vfc != null)?.vfc,
  };
}
export async function enviarMiDia(crews: string[]) {
  if (!leerFunciones().compartirDia || !crews.length) return;
  const v = leerVivo(), hoy = fechaDe(Date.now()), r = leerDiario().registros[hoy];
  const d = {
    pasos: v.salud?.pasos ?? (v.sensores.pasos ? v.pasos : undefined),
    focoMin: minutosDe(hoy, 'foco'), aprendizajeMin: minutosDe(hoy, 'aprender'),
    ejercicioMin: mayor(v.salud?.ejercicioMin, stravaMin(hoy)), suenoH: v.salud?.sueno ? Math.round(v.salud.sueno.horas * 10) / 10 : undefined,
    animo: r?.valores.animo, energia: r?.valores.energia,
    ...saludHoy(),
  };
  const limpio = Object.fromEntries(Object.entries(d).filter(([, x]) => typeof x === 'number'));
  const huella = JSON.stringify([crews, limpio]);
  if (huella === ultimo) return;
  ultimo = huella;
  await Promise.all(crews.map(c => compartirEstado(c, limpio).catch(() => { ultimo = ''; })));
  invalidar('estado');
}

/** los 14 días anteriores, con lo que diga Health Connect y el foco guardado en el teléfono; solo si algo cambió */
let ultimaHistoria = '';
export async function enviarHistoria(crews: string[]) {
  if (!leerFunciones().compartirDia || !crews.length) return;
  const { dias } = leerHistoriaActual(), hoy = Date.now();
  const lista = Array.from({ length: 14 }, (_, i) => {
    const fecha = fechaDe(hoy - (i + 1) * 864e5), h = dias[fecha];
    const d = { fecha, pasos: h?.pasos, ejercicioMin: mayor(h?.ejercicioMin, stravaMin(fecha)), suenoH: h?.suenoH != null ? Math.round(h.suenoH * 10) / 10 : undefined, focoMin: minutosDe(fecha, 'foco') || undefined, aprendizajeMin: minutosDe(fecha, 'aprender') || undefined };
    return Object.fromEntries(Object.entries(d).filter(([, x]) => x !== undefined)) as { fecha: string };
  }).filter(d => Object.keys(d).length > 1);
  const huella = JSON.stringify([crews, lista]);
  if (!lista.length || huella === ultimaHistoria) return;
  ultimaHistoria = huella;
  const r = await Promise.all(crews.map(c => compartirHistoria(c, lista).catch(() => { ultimaHistoria = ''; return { actualizados: 0 }; })));
  if (r.some(x => x.actualizados)) invalidar('estado');
}

export function useCompartirDia() {
  const { crews } = useSesion(), { compartirDia, compartirSalud } = useFunciones();
  const ids = crews.map(c => c.id).join(',');
  useEffect(() => {
    if (!ids || !compartirDia) return;
    const lista = ids.split(',');
    const tic = () => { if (AppState.currentState === 'active') enviarMiDia(lista).then(() => enviarHistoria(lista)); };
    const primero = setTimeout(tic, 4000);
    const id = setInterval(tic, 10 * 60e3);
    const sub = AppState.addEventListener('change', s => { if (s === 'active') tic(); });
    return () => { clearTimeout(primero); clearInterval(id); sub.remove(); };
  }, [ids, compartirDia, compartirSalud]);
}
