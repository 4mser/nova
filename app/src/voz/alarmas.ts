/* Las alarmas que NOVA puso en la app Reloj del teléfono. Android no deja leerlas de vuelta, así que NOVA las recuerda
   acá (hora y nombre) para poder quitarlas por su nombre («desactiva la alarma ir a Codegua») y para saber cuáles
   tiene puestas. Se olvidan solas después de una semana. */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Alarma = { hora: string; etiqueta?: string; t: number };
const CLAVE = 'nova.alarmas.v1';
const SEMANA = 7 * 864e5;
let lista: Alarma[] = [];
let cargada: Promise<void> | null = null;

export function cargarAlarmas() {
  if (cargada) return cargada;
  cargada = AsyncStorage.getItem(CLAVE).then(v => { if (v) lista = (JSON.parse(v) as Alarma[]).filter(a => Date.now() - a.t < SEMANA); }).catch(() => {});
  return cargada;
}
const guardar = () => AsyncStorage.setItem(CLAVE, JSON.stringify(lista.slice(-20))).catch(() => {});
const igual = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function anotarAlarma(a: { hora: string; etiqueta?: string }) {
  await cargarAlarmas();
  lista = lista.filter(x => !(x.hora === a.hora && igual(x.etiqueta ?? '', a.etiqueta ?? '')));
  lista.push({ ...a, t: Date.now() });
  guardar();
}

/** la alarma recordada que mejor calza con un nombre o una hora; null si ninguna */
export async function buscarAlarma({ etiqueta, hora }: { etiqueta?: string; hora?: string }): Promise<Alarma | null> {
  await cargarAlarmas();
  const q = (etiqueta ?? '').trim().toLowerCase();
  if (q) {
    const exacta = lista.find(a => igual(a.etiqueta ?? '', q));
    if (exacta) return exacta;
    const parecida = lista.filter(a => a.etiqueta && (a.etiqueta.toLowerCase().includes(q) || q.includes(a.etiqueta.toLowerCase()))).sort((a, b) => b.t - a.t)[0];
    if (parecida) return parecida;
  }
  if (hora) { const h = lista.filter(a => a.hora === hora).sort((a, b) => b.t - a.t)[0]; if (h) return h; }
  return null;
}
export function olvidarAlarma(a: Alarma) { lista = lista.filter(x => x !== a); guardar(); }
export const alarmasRecordadas = () => lista.slice(-10);
