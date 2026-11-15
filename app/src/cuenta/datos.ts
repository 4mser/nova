/* Datos compartidos con la crew, con un caché mínimo: cada consulta tiene una clave, se pide una vez, se guarda y se
   vuelve a pedir cuando el tiempo real avisa que cambió algo de su tipo (o al volver a la app). */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { pedir, subirCuerpo } from './api';
import { alVaciarCola, pedirOEncolar } from './cola';
import { refrescarSesion } from './sesion';

export type Reaccion = { usuario: string; emoji: string };
export type Foto = { id: string; usuario: string; fecha: string; ts: number; texto: string | null; aTiempo: boolean; ancho: number | null; alto: number | null; url: string; mini: string; reacciones: Reaccion[]; mia: boolean; video?: { url: string; ms: number } };
/** adjunto de una tarea: un enlace (con el título de la página) o un archivo guardado en la API */
export type Adjunto = { id: string; tipo: 'enlace' | 'archivo'; nombre: string; url: string; mime: string | null; bytes: number | null; por: string | null; ts: number };
/** `asignados`: las personas a cargo (varias); `asignado` es la primera, por compatibilidad */
export type Tarea = { id: string; crew: string | null; creador: string; asignado: string | null; asignados?: string[]; titulo: string; nota: string | null; vence: string | null; hecha: boolean; hechaPor: string | null; hechaTs: number | null; orden: number; creado: number; adjuntos?: Adjunto[] };
/** quiénes tienen la tarea (con respaldo para respuestas viejas que solo traen `asignado`) */
export const aCargo = (t: Pick<Tarea, 'asignado' | 'asignados'>) => t.asignados?.length ? t.asignados : t.asignado ? [t.asignado] : [];
export type EstadoDia = { usuario: string; fecha: string; pasos?: number; focoMin?: number; animo?: number; energia?: number; suenoH?: number; ejercicioMin?: number; aprendizajeMin?: number;
  /** con «Compartir mi salud»: recuperación 1 baja · 2 normal · 3 buena (contra su propia línea base), FC en reposo, VFC; salud = 1 si lo comparte */
  recup?: number; fcReposo?: number; vfc?: number; salud?: number };
export type Metrica = 'pasos' | 'focoMin' | 'ejercicioMin' | 'aprendizajeMin' | 'fotos' | 'tareas';
export type Reto = { id: string; titulo: string; metrica: Metrica; meta: number; desde: string; hasta: string; creador: string; total: number; por: Record<string, number> };
/** una entrada de la bitácora de la crew (el registro del equipo) */
/** 'resumen' lo escribe NOVA los viernes (el repaso de la semana del equipo) */
/** 'retro' (la de los viernes, puede ser anónima), 'kudos' (reconocimiento a alguien) y 'acta' (NOVA resume una reunión) */
export type TipoBitacora = 'nota' | 'avance' | 'problema' | 'decision' | 'standup' | 'resumen' | 'retro' | 'kudos' | 'acta';
/** `usuario` es null en una retro anónima de otra persona; `mia` dice si la escribiste tú */
export type EntradaCrew = { id: string; usuario: string | null; mia?: boolean; ts: number; tipo: TipoBitacora; texto: string; audio?: { url: string; ms: number; transcripcion?: string } };
export type Retro = { bien: string; mejorar: string; probar: string; anonimo?: boolean };
export type Kudos = { para: string[]; texto: string };
export type TareaActa = { titulo: string; responsables: string[]; vence: string | null; creada: string | null };
export type Acta = { estado: 'procesando' | 'lista' | 'error'; titulo: string | null; resumen?: string; decisiones?: string[]; temas?: string[]; tareas?: TareaActa[]; notion?: string };
export function leerJson<T>(e: EntradaCrew): T | null { try { return JSON.parse(e.texto) as T; } catch { return null; } }
/** metas del equipo (OKR): un objetivo con plazo y resultados clave con responsable */
export type Resultado = { id: string; titulo: string; responsable: string | null; tipo: 'hito' | 'numero'; meta: number; actual: number; unidad: string | null; avance: number; actualizado: number };
export type Meta = { id: string; titulo: string; desde: string; hasta: string; creador: string; avance: number; esperado: number; estado: 'en_camino' | 'atrasada' | 'vencida' | 'lista'; resultados: Resultado[] };
export type ResultadoNuevo = { titulo: string; tipo: 'hito' | 'numero'; meta?: number; unidad?: string | null; responsable?: string | null };
export type Calendario = { mes: string; dias: Record<string, { fotos: number; personas: string[]; portada: string }> };

/** qué consultas dependen de qué avisos del servidor */
export type Tipo = 'foto' | 'reaccion' | 'tarea' | 'estado' | 'reto' | 'miembros' | 'bitacora' | 'meta' | 'integracion' | 'spotify' | 'github' | 'lista' | 'externa';

type Entrada = { datos?: unknown; error?: string; cargando: boolean; tipos: Tipo[]; fn: () => Promise<unknown>; pedida: number };
const cache = new Map<string, Entrada>();
const oyentes = new Set<() => void>();
let version = 0;
const avisar = () => { version++; oyentes.forEach(o => o()); };

async function cargar(clave: string) {
  const e = cache.get(clave);
  if (!e) return;
  e.cargando = true; e.pedida = Date.now();
  try { e.datos = await e.fn(); e.error = undefined; } catch (x) { e.error = (x as Error).message; }
  e.cargando = false;
  avisar();
}

/** el servidor avisó un cambio: se recarga todo lo que dependa de ese tipo */
export function invalidar(tipo: Tipo | 'todo') {
  if (tipo === 'miembros' || tipo === 'todo') refrescarSesion();
  for (const [k, e] of cache) if (tipo === 'todo' || e.tipos.includes(tipo)) cargar(k);
}
// al enviarse lo que quedó en cola sin señal, se refresca todo
alVaciarCola(() => invalidar('todo'));

const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };
const leerVersion = () => version;

export function useConsulta<T>(clave: string | null, fn: () => Promise<T>, tipos: Tipo[]) {
  useSyncExternalStore(suscribir, leerVersion, leerVersion);
  useEffect(() => {
    if (!clave) return;
    const e = cache.get(clave);
    if (!e) { cache.set(clave, { cargando: true, tipos, fn, pedida: 0 }); cargar(clave); }
    else { e.fn = fn; if (Date.now() - e.pedida > 60e3 && !e.cargando) cargar(clave); }
    // fn y tipos son nuevos en cada render: la clave es la que manda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);
  const e = clave ? cache.get(clave) : undefined;
  const recargar = useCallback(() => { if (clave) return cargar(clave); }, [clave]);
  return { datos: e?.datos as T | undefined, error: e?.error, cargando: !e || e.cargando, recargar };
}

/** lo último que hay en el caché para una clave (fuera de React) */
export const leerCache = <T>(clave: string) => cache.get(clave)?.datos as T | undefined;

/** cambia un dato en el caché al instante (antes de que responda el servidor) */
export function mutar<T>(clave: string, f: (d: T) => T) {
  const e = cache.get(clave);
  if (e?.datos !== undefined) { e.datos = f(e.datos as T); avisar(); }
}

/* ─── consultas ─── */
export const useFotos = (crew: string | null, desde?: string, hasta?: string) =>
  useConsulta<Foto[]>(crew ? `fotos:${crew}:${desde ?? ''}:${hasta ?? ''}` : null, () => pedir(`/v1/crews/${crew}/fotos?${new URLSearchParams({ ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}) })}`), ['foto', 'reaccion']);
export const useCalendario = (crew: string | null, mes: string) =>
  useConsulta<Calendario>(crew ? `cal:${crew}:${mes}` : null, () => pedir(`/v1/crews/${crew}/calendario?mes=${mes}`), ['foto']);
export const CLAVE_TAREAS = 'tareas';
export const useTareas = (activa = true) => useConsulta<Tarea[]>(activa ? CLAVE_TAREAS : null, () => pedir('/v1/tareas'), ['tarea']);
export const useEstados = (crew: string | null, desde?: string, hasta?: string) =>
  useConsulta<EstadoDia[]>(crew ? `estado:${crew}:${desde ?? ''}:${hasta ?? ''}` : null, () => pedir(`/v1/crews/${crew}/estado?${new URLSearchParams({ ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}) })}`), ['estado']);
export const useRetos = (crew: string | null) => useConsulta<Reto[]>(crew ? `retos:${crew}` : null, () => pedir(`/v1/crews/${crew}/retos`), ['reto', 'estado', 'foto', 'tarea']);

/* ─── acciones ─── */
export async function nuevaTarea(t: { titulo: string; crew?: string | null; asignado?: string | null; asignados?: string[]; vence?: string | null; nota?: string | null; enlaces?: string[] }) {
  const r = await pedirOEncolar<Tarea>('/v1/tareas', 'POST', t);
  // sin señal: se muestra al tiro (con id provisorio) y se crea de verdad al volver la red
  const visible: Tarea = r ?? { id: `local-${Date.now()}`, crew: t.crew ?? null, creador: '', asignado: t.asignados?.[0] ?? t.asignado ?? null, asignados: t.asignados ?? (t.asignado ? [t.asignado] : []), titulo: t.titulo, nota: t.nota ?? null, vence: t.vence ?? null, hecha: false, hechaPor: null, hechaTs: null, orden: 0, creado: Date.now() };
  mutar<Tarea[]>(CLAVE_TAREAS, l => [...l, visible]);
  return visible;
}
export async function cambiarTarea(id: string, c: Partial<Pick<Tarea, 'titulo' | 'nota' | 'vence' | 'asignado' | 'asignados' | 'hecha' | 'orden'>>) {
  mutar<Tarea[]>(CLAVE_TAREAS, l => l.map(t => (t.id === id ? { ...t, ...c } : t)));
  if (id.startsWith('local-')) return; // aún no existe en la API: se ajusta al sincronizar
  try { const r = await pedirOEncolar<Tarea>(`/v1/tareas/${id}`, 'PATCH', c); if (r) mutar<Tarea[]>(CLAVE_TAREAS, l => l.map(t => (t.id === id ? r : t))); }
  catch (e) { invalidar('tarea'); throw e; }
}
export async function borrarTarea(id: string) {
  mutar<Tarea[]>(CLAVE_TAREAS, l => l.filter(t => t.id !== id));
  try { await pedir(`/v1/tareas/${id}`, { metodo: 'DELETE' }); } catch (e) { invalidar('tarea'); throw e; }
}
export async function reaccionar(foto: string, emoji: string) { await pedir(`/v1/fotos/${foto}/reaccion`, { json: { emoji } }); invalidar('reaccion'); }
export async function borrarFoto(foto: string) { await pedir(`/v1/fotos/${foto}`, { metodo: 'DELETE' }); invalidar('foto'); }
export async function compartirEstado(crew: string, d: Omit<EstadoDia, 'usuario' | 'fecha'>) { await pedir(`/v1/crews/${crew}/estado`, { metodo: 'PUT', json: d }); }
/** los días anteriores (hasta 14) con números reales: un reto que empezó antes de conectar también los cuenta */
export async function compartirHistoria(crew: string, dias: ({ fecha: string } & Partial<Pick<EstadoDia, 'pasos' | 'focoMin' | 'ejercicioMin' | 'suenoH' | 'aprendizajeMin'>>)[]) { return pedir<{ actualizados: number }>(`/v1/crews/${crew}/estado/historia`, { json: { dias } }); }
export async function nuevoReto(crew: string, r: { titulo: string; metrica: Metrica; meta: number; dias: number }) { await pedir(`/v1/crews/${crew}/retos`, { json: r }); invalidar('reto'); }
export const useBitacora = (crew: string | null) => useConsulta<EntradaCrew[]>(crew ? `bitacora:${crew}` : null, () => pedir(`/v1/crews/${crew}/bitacora`), ['bitacora']);
/* listas (compras, ideas, libros…): tuyas o de la crew */
export type ItemLista = { id: string; texto: string; hecho: boolean; por: string | null; ts: number };
export type Lista = { id: string; nombre: string; icono: string | null; crew: string | null; creador: string; creado: number; items: ItemLista[] };
export const CLAVE_LISTAS = 'listas';
export const useListas = (activa = true) => useConsulta<Lista[]>(activa ? CLAVE_LISTAS : null, () => pedir('/v1/listas'), ['lista']);
const ponerLista = (l: Lista) => mutar<Lista[]>(CLAVE_LISTAS, ls => (ls.some(x => x.id === l.id) ? ls.map(x => (x.id === l.id ? l : x)) : [...ls, l]));
export async function crearLista(nombre: string, icono?: string, crew?: string | null) { const l = await pedir<Lista>('/v1/listas', { metodo: 'POST', json: { nombre, icono, crew: crew ?? null } }); ponerLista(l); return l; }
export async function borrarLista(id: string) { mutar<Lista[]>(CLAVE_LISTAS, ls => ls.filter(x => x.id !== id)); await pedir(`/v1/listas/${id}`, { metodo: 'DELETE' }); }
/** las listas al día para NOVA: las pide al servidor (la capa abierta desde fuera de la app parte sin nada en el
    caché, y buscar ahí decía «no existe» y creaba otra «Compras»); sin señal, lo último que haya en el caché */
export async function listasAlDia() {
  try {
    const ls = await pedir<Lista[]>('/v1/listas'), e = cache.get(CLAVE_LISTAS);
    if (e) { e.datos = ls; e.error = undefined; e.pedida = Date.now(); } else cache.set(CLAVE_LISTAS, { datos: ls, cargando: false, tipos: ['lista'], fn: () => pedir('/v1/listas'), pedida: Date.now() });
    avisar();
    return ls;
  } catch (x) {
    const c = leerCache<Lista[]>(CLAVE_LISTAS);
    if (c) return c;
    throw x;
  }
}
export async function agregarItems(lista: string, textos: string[]) { const l = await pedir<Lista>(`/v1/listas/${lista}/items`, { metodo: 'POST', json: { textos } }); ponerLista(l); return l; }
export async function marcarItem(lista: string, id: string, hecho: boolean) {
  mutar<Lista[]>(CLAVE_LISTAS, ls => ls.map(l => (l.id === lista ? { ...l, items: l.items.map(i => (i.id === id ? { ...i, hecho } : i)) } : l)));
  await pedir(`/v1/items/${id}`, { metodo: 'PATCH', json: { hecho } }).catch(() => invalidar('lista'));
}
export async function borrarItem(lista: string, id: string) {
  mutar<Lista[]>(CLAVE_LISTAS, ls => ls.map(l => (l.id === lista ? { ...l, items: l.items.filter(i => i.id !== id) } : l)));
  await pedir(`/v1/items/${id}`, { metodo: 'DELETE' }).catch(() => invalidar('lista'));
}
export async function limpiarLista(id: string) { const l = await pedir<Lista>(`/v1/listas/${id}/limpiar`, { metodo: 'POST' }); ponerLista(l); }

/** buscar en toda la bitácora de la crew (texto, transcripciones y standups), sin tildes ni mayúsculas */
export const buscarBitacora = (crew: string, q: string, autor?: string) => pedir<EntradaCrew[]>(`/v1/crews/${crew}/bitacora/buscar?${new URLSearchParams({ q, ...(autor ? { autor } : {}) })}`);
export async function escribirBitacora(crew: string, texto: string, tipo: TipoBitacora = 'nota') { const e = await pedirOEncolar<EntradaCrew>(`/v1/crews/${crew}/bitacora`, 'POST', { texto, tipo }); if (e) invalidar('bitacora'); return e; }
export async function borrarBitacora(id: string) { await pedir(`/v1/bitacora/${id}`, { metodo: 'DELETE' }); invalidar('bitacora'); }
export const useMetas = (crew: string | null) => useConsulta<Meta[]>(crew ? `metas:${crew}` : null, () => pedir(`/v1/crews/${crew}/metas`), ['meta']);
export async function nuevaMeta(crew: string, m: { titulo: string; hasta: string; resultados: ResultadoNuevo[] }) { const r = await pedir<Meta>(`/v1/crews/${crew}/metas`, { json: m }); invalidar('meta'); return r; }
export async function cambiarMeta(id: string, c: { titulo?: string; hasta?: string; cerrada?: boolean }) { await pedir(`/v1/metas/${id}`, { metodo: 'PATCH', json: c }); invalidar('meta'); }
export async function borrarMeta(id: string) { await pedir(`/v1/metas/${id}`, { metodo: 'DELETE' }); invalidar('meta'); }
export async function nuevoResultado(meta: string, r: ResultadoNuevo) { await pedir(`/v1/metas/${meta}/resultados`, { json: r }); invalidar('meta'); }
export async function cambiarResultado(id: string, c: { actual?: number; sumar?: number; hecho?: boolean; responsable?: string | null; titulo?: string }) { if (await pedirOEncolar(`/v1/resultados/${id}`, 'PATCH', c)) invalidar('meta'); }
export async function borrarResultado(id: string) { await pedir(`/v1/resultados/${id}`, { metodo: 'DELETE' }); invalidar('meta'); }
export async function borrarReto(id: string) { await pedir(`/v1/retos/${id}`, { metodo: 'DELETE' }); invalidar('reto'); }

/* ─────────── 0.5: adjuntos, equipo, GitHub de la crew, integraciones nuevas ─────────── */
const ponerTarea = (t: Tarea) => mutar<Tarea[]>(CLAVE_TAREAS, l => l.map(x => (x.id === t.id ? t : x)));
export async function adjuntarEnlace(tarea: string, url: string, nombre?: string) { const t = await pedir<Tarea>(`/v1/tareas/${tarea}/enlaces`, { json: { url, nombre } }); ponerTarea(t); return t; }
export async function quitarAdjunto(id: string) { const t = await pedir<Tarea>(`/v1/adjuntos/${id}`, { metodo: 'DELETE' }); ponerTarea(t); return t; }
/** archivo adjunto (documento, imagen, PDF…): el cuerpo es el archivo; máx. 15 MB */
export async function adjuntarArchivo(tarea: string, f: { uri: string; name: string; mimeType?: string | null; size?: number | null }) {
  if ((f.size ?? 0) > 15 * 1048576) throw new Error('Files up to 15 MB');
  const q = new URLSearchParams({ nombre: f.name.slice(0, 140), mime: f.mimeType || 'application/octet-stream' });
  const t = await subirCuerpo<Tarea>(`/v1/tareas/${tarea}/archivos?${q}`, f.uri, f.mimeType || 'application/octet-stream');
  ponerTarea(t); return t;
}

export type CargaPersona = { usuario: string; abiertas: number; vencidas: number; semana: number; hechas7: number; focoMin7: number; nivel: 'alta' | 'normal' | 'baja' };
export const useCarga = (crew: string | null) => useConsulta<{ personas: CargaPersona[]; sinNadie: number; media: number }>(crew ? `carga:${crew}` : null, () => pedir(`/v1/crews/${crew}/carga`), ['tarea', 'estado', 'miembros']);

/** acta de reunión: audio grabado (m4a) o notas escritas; NOVA la procesa en segundo plano */
export async function crearActa(crew: string, a: { audio?: { uri: string; ms: number }; notas?: string; titulo?: string }) {
  const q = new URLSearchParams({ ...(a.titulo?.trim() ? { titulo: a.titulo.trim() } : {}), ...(a.audio ? { ms: String(Math.round(a.audio.ms)) } : {}) });
  const e = a.audio ? await subirCuerpo<EntradaCrew>(`/v1/crews/${crew}/actas?${q}`, a.audio.uri, 'audio/mp4') : await pedir<EntradaCrew>(`/v1/crews/${crew}/actas?${q}`, { json: { notas: a.notas } });
  invalidar('bitacora'); return e;
}
export async function crearTareasActa(acta: string, indices?: number[]) { const r = await pedir<{ creadas: number }>(`/v1/actas/${acta}/tareas`, { json: { indices } }); invalidar('tarea'); invalidar('bitacora'); return r.creadas; }

export type EventoGh = { id: string; repo: string; tipo: 'ci_fallo' | 'ci_ok' | 'deploy_fallo' | 'deploy_ok' | 'pr_abierto' | 'pr_revision' | 'pr_mergeado' | 'pr_aprobado' | 'pr_cambios'; titulo: string; detalle: string | null; url: string; autor: string | null; ts: number };
export type GithubCrew = { repos: { repo: string; de: string; ts: number; error: string | null }[]; eventos: EventoGh[]; conectados: { login: string; usuario: string }[] };
export const useGithubCrew = (crew: string | null) => useConsulta<GithubCrew>(crew ? `github:crew:${crew}` : null, () => pedir(`/v1/crews/${crew}/github`), ['github']);
export const useMisRepos = (activo: boolean) => useConsulta<{ repo: string; privado: boolean }[]>(activo ? 'github:repos' : null, () => pedir('/v1/github/repos'), ['integracion']);
export async function agregarRepo(crew: string, repo: string) { await pedir(`/v1/crews/${crew}/github/repos`, { json: { repo } }); invalidar('github'); }
export async function quitarRepo(crew: string, repo: string) { await pedir(`/v1/crews/${crew}/github/repos/${encodeURIComponent(repo)}`, { metodo: 'DELETE' }); invalidar('github'); }

export type AjustesCrew = { slack: string | null; discord: string | null; espejo: string[]; notion: { pagina: string; titulo: string; de: string } | null; soyAdmin: boolean };
export const useAjustesCrew = (crew: string | null) => useConsulta<AjustesCrew>(crew ? `ajustes:${crew}` : null, () => pedir(`/v1/crews/${crew}/ajustes`), ['miembros', 'integracion']);
export async function cambiarAjustes(crew: string, c: { slack?: string | null; discord?: string | null; espejo?: string[]; notion?: { pagina: string; titulo: string } | null; probar?: boolean }) { await pedir(`/v1/crews/${crew}/ajustes`, { metodo: 'PATCH', json: c }); invalidar('integracion'); }
export const buscarPaginasNotion = (q: string) => pedir<{ id: string; titulo: string; url: string; icono: string | null }[]>(`/v1/notion/paginas?q=${encodeURIComponent(q)}`);

/** tareas de Todoist, Google Tasks y Linear juntas */
export type Externa = { fuente: 'todoist' | 'google' | 'linear'; id: string; titulo: string; vence: string | null; prioridad: number; url: string; lista?: string; estado?: string };
export const useExternas = (activo: boolean) => useConsulta<{ tareas: Externa[]; errores: string[] }>(activo ? 'externas' : null, () => pedir('/v1/externas'), ['externa', 'integracion']);
export async function completarExterna(x: Pick<Externa, 'fuente' | 'id'>) {
  mutar<{ tareas: Externa[]; errores: string[] }>('externas', d => ({ ...d, tareas: d.tareas.filter(t => !(t.fuente === x.fuente && t.id === x.id)) }));
  await pedir(`/v1/externas/${x.fuente}/${encodeURIComponent(x.id)}/completar`, { metodo: 'POST' }).catch(e => { invalidar('externa'); throw e; });
}
export async function crearExterna(fuente: Externa['fuente'], titulo: string, vence?: string | null) { await pedir(`/v1/externas/${fuente}`, { json: { titulo, vence } }); invalidar('externa'); }

export type ActividadStrava = { id: number; nombre: string; tipo: string; fecha: string; km: number; min: number; fc: number | null; fcMax: number | null; desnivel: number; url: string };
export const useStrava = (activo: boolean) => useConsulta<{ actividades: ActividadStrava[]; semana: { n: number; min: number; km: number } }>(activo ? 'strava' : null, () => pedir('/v1/strava/resumen'), ['integracion']);
