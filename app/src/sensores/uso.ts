/* Uso del teléfono (Android): tiempo en pantalla y desbloqueos de hoy, apps más usadas y la pantalla encendida
   anoche (23:00–06:00), con la última vez que lo usaste y la primera de la mañana. Módulo nativo propio
   (modules/nova-uso); el permiso se concede en Ajustes → Acceso al uso. */
import { NovaUso } from '../../modules/nova-uso';
import { cambiar } from './vivo';

export const usoDisponible = () => !!NovaUso;
export const usoConPermiso = () => { try { return !!NovaUso?.tienePermiso(); } catch { return false; } };
export const abrirPermisoUso = () => NovaUso?.abrirAjustes();

export async function leerUso() {
  if (!NovaUso || !usoConPermiso()) return;
  try {
    const ahora = new Date(), medianoche = new Date(ahora); medianoche.setHours(0, 0, 0, 0);
    const hoy = await NovaUso.uso(+medianoche, +ahora);
    // anoche: de las 23:00 de ayer a las 06:00 de hoy (o hasta ahora si aún no son las 6)
    const iniNoche = new Date(medianoche.getTime() - 3600e3), finNoche = new Date(Math.min(+ahora, medianoche.getTime() + 6 * 3600e3));
    const noche = await NovaUso.uso(+iniNoche, +finNoche);
    const nocheMin = noche.intervalos.reduce((a, i) => a + (i.fin - i.ini), 0) / 60e3;
    // última vez antes de dormir: el último encendido que terminó antes de las 4; primera de la mañana: el primero después de las 5
    const cuatro = medianoche.getTime() + 4 * 3600e3, cinco = medianoche.getTime() + 5 * 3600e3;
    const ultimoUso = noche.intervalos.filter(i => i.fin < cuatro).at(-1)?.fin;
    const primerUso = hoy.intervalos.find(i => i.ini > cinco)?.ini;
    cambiar(() => ({
      uso: {
        pantallaMin: hoy.pantallaMs / 60e3, desbloqueos: hoy.desbloqueos,
        apps: hoy.apps.map(a => ({ nombre: a.nombre, min: a.ms / 60e3 })),
        nocheMin, ultimoUso, primerUso, leido: Date.now(),
      },
    }));
  } catch {}
}
