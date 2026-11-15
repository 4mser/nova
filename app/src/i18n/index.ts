/* Idioma de la app: inglés o español, elegido en «Tú» y guardado en el teléfono. Por defecto, el del dispositivo
   (español si el teléfono está en español; si no, inglés).
   · Las claves son el texto en inglés: t('Good morning') busca en el diccionario español y, si falta, queda en inglés
   · interpolación: t('{n} days', { n: 3 }) · plurales: tp(n, '{n} entry', '{n} entries')
   · contexto, para palabras que cambian según de qué se habla: tc('energia', 'Low') → «Baja» (ánimo: «Bajo»)
   En componentes se usa SIEMPRE `const { t } = useIdioma()`: el React Compiler memoiza lo que no depende de nada
   reactivo, así que un t() global dentro de un componente no cambiaría al cambiar el idioma. El `t` global queda para
   lo que corre fuera de React (widgets, mensajes del motor que se guardan) o como valor por defecto. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { ES, ES_CTX } from './es';

export type Idioma = 'en' | 'es';
export type Vars = Record<string, string | number>;
export const IDIOMAS: { id: Idioma; nombre: string }[] = [{ id: 'en', nombre: 'English' }, { id: 'es', nombre: 'Español' }];

const CLAVE = 'nova.idioma.v1';

function delDispositivo(): Idioma {
  try { return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('es') ? 'es' : 'en'; } catch { return 'en'; }
}

const poner = (s: string, v?: Vars) => (v ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m)) : s);

/** el traductor de un idioma: un objeto fijo por idioma (su identidad cambia solo al cambiar de idioma) */
export type Traductor = {
  idioma: Idioma;
  /** 'es-CL' o 'en-US', para fechas y números */
  locale: string;
  t: (s: string, v?: Vars) => string;
  tp: (n: number, uno: string, varios: string, v?: Vars) => string;
  tc: (ctx: string, s: string, v?: Vars) => string;
};

function hacer(idioma: Idioma): Traductor {
  const es = idioma === 'es';
  const t = (s: string, v?: Vars) => poner(es ? ES[s] ?? s : s, v);
  return {
    idioma, locale: es ? 'es-CL' : 'en-US', t,
    tp: (n, uno, varios, v) => t(n === 1 ? uno : varios, { n, ...v }),
    tc: (ctx, s, v) => poner(es ? ES_CTX[`${ctx}|${s}`] ?? ES[s] ?? s : s, v),
  };
}
const T: Record<Idioma, Traductor> = { en: hacer('en'), es: hacer('es') };
export const traductor = (i: Idioma | undefined) => T[i === 'es' ? 'es' : 'en'];

let actual: Idioma = delDispositivo();
const oyentes = new Set<() => void>();

export async function cargarIdioma() {
  try {
    const g = await AsyncStorage.getItem(CLAVE);
    if ((g === 'es' || g === 'en') && g !== actual) { actual = g; oyentes.forEach(o => o()); }
  } catch {}
}

export function cambiarIdioma(i: Idioma) {
  if (i === actual) return;
  actual = i;
  AsyncStorage.setItem(CLAVE, i).catch(() => {});
  oyentes.forEach(o => o());
}

export const idiomaActual = () => actual;
/** el traductor activo (valor por defecto de las funciones del motor que producen texto) */
export const traductorActual = () => T[actual];
const leer = traductorActual;
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };

/** el traductor del idioma activo; el componente se redibuja al cambiar de idioma */
export function useIdioma() { return useSyncExternalStore(suscribir, leer, leer); }

/** fuera de React: siempre en el idioma activo */
export const t = (s: string, v?: Vars) => T[actual].t(s, v);
export const tp = (n: number, uno: string, varios: string, v?: Vars) => T[actual].tp(n, uno, varios, v);
export const tc = (ctx: string, s: string, v?: Vars) => T[actual].tc(ctx, s, v);
export const locale = () => T[actual].locale;

/** primera letra en mayúscula (los meses en español vienen en minúscula) */
export const mayus = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
