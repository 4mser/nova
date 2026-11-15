/* Colores y nombres de los niveles de salud de la crew (ver src/engine/crewSalud.ts). */
import type { Nivel } from '../engine/crewSalud';
import { C } from './tema';

export const COLOR_NIVEL: Record<Nivel, string> = { bien: C.ok, atento: C.aviso, cuidar: C.alerta, sin: C.l2 };
export const TXT_NIVEL: Record<Nivel, string> = { bien: 'Doing well', atento: 'Keep an eye', cuidar: 'Look out', sin: 'No data' };
