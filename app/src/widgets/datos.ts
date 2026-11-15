/* Lo que muestran los widgets. La app guarda una instantánea cada minuto (y al cambiar el diario o el check-in);
   el widget la lee aunque la app esté cerrada. El plan del día no se guarda: se calcula con la hora al dibujar,
   así «ahora» y «lo próximo» no quedan atrasados. El check-in guardado vale solo para su fecha. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { MISION } from '../engine/agenda';
import { CLAVE_TAREAS, leerCache, type Tarea, aCargo } from '../cuenta/datos';
import { leerSesion } from '../cuenta/sesion';
import { minutosDe } from '../engine/foco';
import { leerFunciones } from '../engine/funciones';
import { leerHabitos, racha as rachaHabito } from '../engine/habitos';
import { leerAgendaActual } from '../sensores/agenda';
import { leerHistoriaActual, recuperacion } from '../sensores/historia';
import { ESCALAS, fechaDe, leerDiario, nivelDe, preguntaDelDia, racha } from '../engine/diario';
import { hoy } from '../engine/motor';
import { leer as leerVivo } from '../sensores/vivo';
import { NovaWidget } from '../../modules/nova-widget';
import { widgetsDisponibles } from './disponible';
import { idiomaActual, traductor, type Idioma } from '../i18n';

export type DatosWidget = {
  nombre: string; sol: number; preparacion: number; habitual: number; frase: string; atencion: boolean;
  sueno: string; vfc: number;
  fc: number; fcVivo: boolean; serieFc: number[]; relojNombre?: string;
  avance: number; solesRestantes: number; sesionEnDias: number; sesion: string; dosis: number; limiteP: number;
  /** check-in de `fecha`: un valor 1–5 (o null) por escala, en el orden de ESCALAS */
  checkin: { fecha: string; valores: (number | null)[]; emociones: string[]; bueno?: string };
  entradas: number; racha: number; pregunta: string;
  /** idioma de la app al guardar: el widget se dibuja en él aunque la app esté cerrada */
  idioma: Idioma;
  /** día a día (lo normal) o modo misión (la versión espacial de la hackatón) */
  modo?: 'diario' | 'mision';
  /** el día a día, con datos reales (nada simulado) */
  dia?: DiaWidget;
  actualizado: number;
};

export type DiaWidget = {
  diaTxt: string; pasos?: number; suenoH?: number; fc?: number; fcVivo: boolean; fcReposo?: number; recup?: 'buena' | 'normal' | 'baja'; origen?: string;
  habitos: { nombre: string; hecho: boolean; color: string }[]; racha: number; focoMin: number;
  /** eventos de hoy y mañana (el widget calcula «ahora» y «lo próximo» al dibujarse) */
  eventos: { ini: number; fin: number; titulo: string; todoElDia: boolean; color?: string }[]; agenda: boolean;
  tareas: string[];
};

const CLAVE = 'nova.widget.v2';
/** colores de la escala del check-in (los mismos de la app) */
const NIVEL = ['#EC6AA8', '#F2B457', '#9AA4B2', '#46C8E8', '#6FD6B0'];

/** frase corta para el widget a partir del mensaje del día */
function fraseCorta(estado: string, t: (s: string) => string) {
  return t(estado === 'attention' ? 'You did not recover fully. Go easier today.' : estado === 'uncertain' ? 'Signal is weak. Check the strap.' : 'Recovered and steady. Good day ahead.');
}

/** la arma la app con todo lo que sabe ahora */
export function armar(): DatosWidget {
  const idioma = idiomaActual(), tr = traductor(idioma), H = hoy(tr), v = leerVivo(), D = leerDiario();
  const fcVivo = v.reloj.estado === 'conectado' && !!v.fc;
  const m = Math.round(H.sueno * 60), f = fechaDe(Date.now()), r = D.registros[f];
  return {
    nombre: H.nombre, sol: H.sol, preparacion: H.preparacion, habitual: H.habitual, frase: fraseCorta(H.resp.estado, tr.t), atencion: H.resp.estado === 'attention',
    sueno: `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}`, vfc: H.vfc,
    fc: Math.round(fcVivo ? v.fc! : H.fc), fcVivo, serieFc: (fcVivo && v.serieFc.length > 5 ? v.serieFc : H.histFc).slice(-40), relojNombre: fcVivo ? v.reloj.nombre : undefined,
    avance: MISION.avance, solesRestantes: MISION.solesRestantes, sesionEnDias: MISION.sesionEnDias, sesion: MISION.sesion, dosis: H.dosis, limiteP: H.dosis / H.limite,
    checkin: { fecha: f, valores: ESCALAS.map(e => r?.valores[e.id] ?? null), emociones: r?.emociones ?? [], bueno: r?.bueno },
    entradas: D.entradas.length, racha: racha(D.entradas), pregunta: preguntaDelDia(tr), idioma,
    modo: leerFunciones().mision ? 'mision' : 'diario', dia: armarDia(tr, f),
    actualizado: Date.now(),
  };
}

/** el día a día para los widgets: solo lo que de verdad se midió o anotaste */
function armarDia(tr: ReturnType<typeof traductor>, f: string): DiaWidget {
  const v = leerVivo(), s = v.salud, hist = leerHistoriaActual().dias, g = hist[f];
  const { habitos, marcas } = leerHabitos(), { eventos, leido } = leerAgendaActual(), yo = leerSesion().usuario?.id;
  const fcVivo = v.reloj.estado === 'conectado' && !!v.fc;
  const tareas = (leerCache<Tarea[]>(CLAVE_TAREAS) ?? []).filter(x => !x.hecha && (!x.vence || x.vence <= f) && (!x.crew || aCargo(x).includes(yo ?? ''))).map(x => x.titulo);
  return {
    diaTxt: new Date().toLocaleDateString(tr.locale, { weekday: 'long', day: 'numeric' }).replace(/^./, c => c.toUpperCase()),
    pasos: s?.pasos ?? g?.pasos ?? (v.sensores.pasos ? v.pasos : undefined), suenoH: s?.sueno?.horas ?? g?.suenoH,
    fc: fcVivo ? Math.round(v.fc!) : s?.fc, fcVivo, fcReposo: s?.fcReposo ?? g?.fcReposo, recup: recuperacion(hist)?.nivel,
    origen: fcVivo ? v.reloj.nombre : s?.origenes[0],
    habitos: habitos.map(h => ({ nombre: tr.t(h.nombre), hecho: !!marcas[f]?.includes(h.id), color: h.color })),
    racha: Math.max(0, ...habitos.map(h => rachaHabito(marcas, h.id))), focoMin: minutosDe(f),
    eventos: eventos.slice(0, 12).map(e => ({ ini: e.ini, fin: e.fin, titulo: e.titulo, todoElDia: e.todoElDia, color: e.color })), agenda: !!leido,
    tareas: tareas.slice(0, 6),
  };
}

export async function cargar(): Promise<DatosWidget> {
  try { const t = await AsyncStorage.getItem(CLAVE); if (t) return JSON.parse(t); } catch {}
  return armar();
}

export const WIDGETS = ['Corazon', 'Mision', 'Diario', 'Plan'] as const;

/** guarda la instantánea y redibuja los widgets que estén en la pantalla de inicio */
export async function actualizarWidgets() {
  if (Platform.OS !== 'android') return;
  const d = armar();
  try { await AsyncStorage.setItem(CLAVE, JSON.stringify(d)); } catch {}
  // los widgets con NOVA son nativos y animados (modules/nova-widget)
  try {
    const ci = d.checkin.valores, hechos = ci.filter(v => v != null).length, animo = ci[0];
    const completo = hechos === ESCALAS.length && !!animo, tr = traductor(d.idioma);
    // los widgets nativos no tienen textos propios: todo lo que muestran llega aquí, ya en el idioma de la app
    NovaWidget?.actualizar({
      prep: d.preparacion, atencion: d.atencion, sorpresa: d.fcVivo && d.fc > 100, sol: d.sol, frase: d.frase, sueno: d.sueno,
      ciValor: completo ? nivelDe(tr, ESCALAS[0], animo) : `${hechos}/${ESCALAS.length}`, ciEtiqueta: tr.t(completo ? 'mood' : 'check-in'),
      ciColor: completo ? NIVEL[animo - 1] : '#A898FF',
      etqPrep: tr.t('readiness'), etqSueno: tr.t('sleep'),
      vivaDormida: tr.t('Resting. Sleep well.'), vivaPensativa: tr.t('Go easier today'), vivaFeliz: tr.t('Tap to talk'),
    });
  } catch {}
  if (!widgetsDisponibles()) return;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { requestWidgetUpdate } = require('react-native-android-widget') as typeof import('react-native-android-widget');
  const { dibujar } = require('./Widgets') as typeof import('./Widgets');
  /* eslint-enable @typescript-eslint/no-require-imports */
  for (const w of WIDGETS) {
    try { await requestWidgetUpdate({ widgetName: w, renderWidget: info => dibujar(w, d, info) }); } catch {}
  }
}

/** en la app: refresca los widgets cada minuto y cada vez que cambia el diario (entradas o check-in) */
export function useWidgets(diario: object, idioma: string) {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    actualizarWidgets();
    const id = setInterval(actualizarWidgets, 60e3);
    return () => clearInterval(id);
  }, [diario, idioma]);
}
