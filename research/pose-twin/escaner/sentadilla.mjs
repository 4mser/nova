/* Port a JavaScript de pose_twin/sentadilla.py (sentadilla vista de lado). Si cambia el Python, cambia esto; la
   prueba de paridad es tests/test_escaner_paridad.py. Solo medidas: no validado, no es medición médica.
   Sin DOM ni dependencias externas. Tiempos en segundos, ángulos en grados. */
import { redondear, mediana } from './angulos.mjs';

export const NOTA = 'no validado, no es medicion medica';

const DE_PIE_MIN = 140, DE_PIE_RANGO = 10, DE_PIE_VENTANA = 0.8, DE_PIE_MUESTRAS = 5;
export const ENTRADA = 30, SALIDA = 15, FONDO = 5, HUECO_MAX = 1.0;
const DURACION_MIN = 0.5, DURACION_MAX = 20, MUESTRAS_ABAJO = 3, CAMBIO_LADO = 0.1;
const COBERTURA_DIF = 0.8, COBERTURA_CADERA = 0.7;

const LADOS = ['izq', 'der'];
export const METRICAS = ['rodilla_min', 'cadera_min', 'bajada_s', 'subida_s', 'dif_rodilla', 'dif_cadera'];
export const COLUMNAS = ['n', 't_inicio_s', 'rodilla_min', 'cadera_min', 'lado', 'bajada_s', 'fondo_s', 'subida_s',
  'dif_rodilla', 'dif_cadera', 'calidad', 'cobertura'];

export function visibilidadLados(visibilidad) {
  return { izq: Math.min(...[23, 25, 27].map(i => visibilidad[i])), der: Math.min(...[24, 26, 28].map(i => visibilidad[i])) };
}

/** Mínimo tras una mediana de 3 cuadros, para que un solo cuadro erróneo no fije la flexión máxima. */
function minimo(x) {
  if (x.length < 3) return Math.min(...x);
  let m = Infinity;
  for (let i = 1; i < x.length - 1; i++) m = Math.min(m, mediana([x[i - 1], x[i], x[i + 1]]));
  return m;
}

export function estadistica(x) {
  const n = x.length;
  if (!n) return { n: 0, media: null, de: null, min: null, max: null };
  let suma = 0;
  for (const v of x) suma += v;
  const media = suma / n;
  let de = null;
  if (n > 1) {
    let cuad = 0;
    for (const v of x) cuad += (v - media) * (v - media);
    de = redondear(Math.sqrt(cuad / (n - 1)), 2);
  }
  return { n, media: redondear(media, 2), de, min: Math.min(...x), max: Math.max(...x) };
}

const r1 = v => (v === null ? null : redondear(v, 1));

export class SerieSentadilla {
  constructor({ segundosPreparacion = 8.0, segundosFin = 8.0 } = {}) {
    this.segundosPreparacion = segundosPreparacion; this.segundosFin = segundosFin;
    this.fase = 'preparando'; this.repeticiones = []; this.descartadas = []; this.referencia = null; this.sinVista = false;
    this.prepHasta = null; this.t0 = null; this.t = null; this.ventana = []; this.cuadros = [];
    this.tVisto = 0; this.tFinRep = 0; this.lado = null;
  }
  get terminada() { return this.fase === 'fin'; }

  elegir(angulos, vis) {
    const vistos = LADOS.filter(l => (angulos[`rodilla_${l}`] ?? null) !== null);
    if (!vistos.length) return null;
    if (!vistos.includes(this.lado)) {
      this.lado = vistos.reduce((a, b) => ((vis ? vis[b] : 0) > (vis ? vis[a] : 0) ? b : a));
    } else if (vis) {
      for (const l of vistos) if (vis[l] > vis[this.lado] + CAMBIO_LADO) this.lado = l;
    }
    return this.lado;
  }

  /** Un cuadro: ángulos (null = abstención), tiempo en segundos y visibilidad por lado (opcional). */
  paso(angulos, t, vis = null) {
    if (this.terminada || (this.t !== null && t <= this.t)) return;
    this.t = t;
    if (this.prepHasta === null) this.prepHasta = t + this.segundosPreparacion;
    if (t < this.prepHasta) return;
    if (this.t0 === null) { this.t0 = t; this.fase = 'buscando'; }
    const lado = this.elegir(angulos, vis);
    const x = lado === null ? null : angulos[`rodilla_${lado}`];
    this.sinVista = x === null;
    if (this.referencia === null) { this.buscarDePie(x, t); return; }
    if (t - this.tVisto > HUECO_MAX && (this.cuadros.length || this.fase === 'abajo')) {
      if (this.fase === 'abajo') this.descartar('se perdio la vista');
      this.cuadros = []; // hay que volver a estar de pie antes de contar otra
    }
    const cuadro = { t, x, lado };
    for (const k of ['rodilla_izq', 'rodilla_der', 'cadera_izq', 'cadera_der']) cuadro[k] = angulos[k] ?? null;
    if (x === null) {
      if (this.cuadros.length) this.cuadros.push(cuadro);
    } else {
      this.tVisto = t;
      const arriba = x >= this.referencia - SALIDA;
      if (this.fase === 'listo') {
        if (arriba) this.cuadros = [cuadro];
        else if (this.cuadros.length) {
          this.cuadros.push(cuadro);
          if (x <= this.referencia - ENTRADA) this.fase = 'abajo';
        }
      } else {
        this.cuadros.push(cuadro);
        if (arriba) { this.cerrarRep(); this.cuadros = [cuadro]; }
      }
    }
    if (this.fase === 'abajo' && this.cuadros.length && t - this.cuadros[0].t > DURACION_MAX) {
      this.descartar('demasiado larga'); this.cuadros = [];
    }
    if (this.segundosFin !== null && this.repeticiones.length && this.fase === 'listo'
      && t - this.tFinRep >= this.segundosFin) this.terminar();
  }

  buscarDePie(x, t) {
    if (x === null) { this.ventana = []; return; }
    this.ventana.push([t, x]);
    while (this.ventana.length > 1 && t - this.ventana[1][0] >= DE_PIE_VENTANA) this.ventana.shift();
    const v = this.ventana.map(p => p[1]), orden = [...v].sort((a, b) => a - b);
    if (v.length >= DE_PIE_MUESTRAS && t - this.ventana[0][0] >= DE_PIE_VENTANA
      && orden.at(-2) - orden[1] <= DE_PIE_RANGO && mediana(v) >= DE_PIE_MIN) {
      this.referencia = mediana(v); this.tVisto = t; this.fase = 'listo';
    }
  }

  descartar(motivo) {
    this.descartadas.push({ t_s: redondear(this.cuadros[0].t - this.t0, 2), motivo });
    this.fase = 'listo';
  }

  cerrarRep() {
    const c = this.cuadros, n = c.length, tIni = c[0].t, tFin = c[n - 1].t;
    const vistos = c.filter(q => q.x !== null);
    const abajo = vistos.filter(q => q.x <= this.referencia - ENTRADA).length;
    if (tFin - tIni < DURACION_MIN || abajo < MUESTRAS_ABAJO) { this.descartar('demasiado breve'); return; }
    const usos = l => vistos.filter(q => q.lado === l).length;
    const lado = usos('izq') >= usos('der') ? 'izq' : 'der';
    const min = minimo(vistos.map(q => q.x));
    const fondo = vistos.filter(q => q.x <= min + FONDO).map(q => q.t);
    const minimoDe = (k, cobertura) => {
      const v = c.map(q => q[k]).filter(x => x !== null);
      return v.length && v.length >= cobertura * n ? minimo(v) : null;
    };
    const diferencia = art => {
      const i = minimoDe(`${art}_izq`, COBERTURA_DIF), d = minimoDe(`${art}_der`, COBERTURA_DIF);
      const ambos = c.filter(q => q[`${art}_izq`] !== null && q[`${art}_der`] !== null).length;
      return i === null || d === null || ambos < COBERTURA_DIF * n ? null : redondear(i - d, 1);
    };
    const cobertura = vistos.length / n;
    let hueco = 0;
    for (let i = 1; i < vistos.length; i++) hueco = Math.max(hueco, vistos[i].t - vistos[i - 1].t);
    const fps = (n - 1) / (tFin - tIni);
    const calidad = cobertura >= 0.9 && hueco <= 0.3 && fps >= 15 ? 'buena' : cobertura >= 0.7 ? 'regular' : 'baja';
    this.repeticiones.push({
      n: this.repeticiones.length + 1, t_inicio_s: redondear(tIni - this.t0, 2),
      rodilla_min: r1(minimoDe(`rodilla_${lado}`, 0)), cadera_min: r1(minimoDe(`cadera_${lado}`, COBERTURA_CADERA)), lado,
      bajada_s: redondear(fondo[0] - tIni, 2), fondo_s: redondear(fondo.at(-1) - fondo[0], 2),
      subida_s: redondear(tFin - fondo.at(-1), 2), dif_rodilla: diferencia('rodilla'), dif_cadera: diferencia('cadera'),
      calidad, cobertura: redondear(cobertura, 2),
    });
    this.fase = 'listo';
    this.tFinRep = tFin;
  }

  /** Cierra la serie. Una repetición a medias (sin volver arriba) no se cuenta. */
  terminar() {
    if (this.terminada) return;
    if (this.fase === 'abajo') this.descartar('incompleta: no volvio a quedar de pie');
    this.fase = 'fin';
  }

  resumen() {
    return Object.fromEntries(METRICAS.map(k => [k, estadistica(this.repeticiones.map(r => r[k]).filter(v => v !== null))]));
  }

  estado(t) {
    let faltan = null;
    if (this.fase === 'preparando') faltan = this.prepHasta === null ? this.segundosPreparacion : Math.max(0, this.prepHasta - t);
    let finEn = null;
    if (this.segundosFin !== null && this.repeticiones.length && this.fase === 'listo') {
      finEn = Math.max(0, this.segundosFin - (t - this.tFinRep));
    }
    return {
      fase: this.fase, faltan_s: faltan, fin_en_s: finEn, n: this.repeticiones.length,
      descartadas: this.descartadas.length, sin_vista: this.sinVista,
      ultima: this.repeticiones.at(-1) ?? null,
      repeticiones: this.terminada ? this.repeticiones : null,
      resumen: this.terminada ? this.resumen() : null,
    };
  }

  resultado(creado = new Date().toISOString().slice(0, 19)) {
    return {
      version: 1, tipo: 'sentadilla_lateral', creado, nota: NOTA,
      unidades: 'angulos en grados (180 = extendido); tiempos en segundos; dif = izquierda menos derecha',
      parametros: { entrada_grados: ENTRADA, salida_grados: SALIDA, fondo_grados: FONDO, hueco_max_s: HUECO_MAX },
      referencia_de_pie: this.referencia === null ? null : redondear(this.referencia, 1),
      repeticiones: this.repeticiones, descartadas: this.descartadas, resumen: this.resumen(),
    };
  }
}

/** Una fila por repetición; celda vacía cuando hay abstención. Cada fila lleva la advertencia. */
export function aCsv(resultado) {
  const celda = v => (v === null ? '' : /[",\r\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
  const filas = [[...COLUMNAS, 'nota'], ...resultado.repeticiones.map(r => [...COLUMNAS.map(k => r[k]), resultado.nota])];
  return filas.map(f => f.map(celda).join(',') + '\r\n').join('');
}
