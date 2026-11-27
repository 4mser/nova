/* La sentadilla de lado está aparte, en sentadilla.mjs.
   Port a JavaScript de la parte pura de pose-twin: ángulos y abstención (pose_twin/geometria.py), filtro One-Euro
   (pose_twin/filtros.py), perfil y calibración (pose_twin/perfil.py) y la parte de pose_twin/sesion.py (Procesador.paso)
   que los une. Si cambia el Python, cambia esto; la prueba de paridad es tests/test_escaner_paridad.py.
   Sin DOM ni dependencias: se prueba con node. Puntos: arreglos [x, y, z]. Tiempos: segundos. */

/* ── geometria.py ── */
export const CUERPO = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
export const UMBRAL_VIS = 0.6;
const HOMBRO_I = 11, HOMBRO_D = 12, CODO_I = 13, CODO_D = 14, MUNECA_I = 15, MUNECA_D = 16;
const CADERA_I = 23, CADERA_D = 24, RODILLA_I = 25, RODILLA_D = 26, TOBILLO_I = 27, TOBILLO_D = 28;

export const ANGULOS = {
  codo_izq: [HOMBRO_I, CODO_I, MUNECA_I],
  codo_der: [HOMBRO_D, CODO_D, MUNECA_D],
  hombro_izq: [CODO_I, HOMBRO_I, CADERA_I],
  hombro_der: [CODO_D, HOMBRO_D, CADERA_D],
  cadera_izq: [HOMBRO_I, CADERA_I, RODILLA_I],
  cadera_der: [HOMBRO_D, CADERA_D, RODILLA_D],
  rodilla_izq: [CADERA_I, RODILLA_I, TOBILLO_I],
  rodilla_der: [CADERA_D, RODILLA_D, TOBILLO_D],
};

export const SEGMENTOS = {
  brazo_izq: [HOMBRO_I, CODO_I],
  brazo_der: [HOMBRO_D, CODO_D],
  antebrazo_izq: [CODO_I, MUNECA_I],
  antebrazo_der: [CODO_D, MUNECA_D],
  muslo_izq: [CADERA_I, RODILLA_I],
  muslo_der: [CADERA_D, RODILLA_D],
  pierna_izq: [RODILLA_I, TOBILLO_I],
  pierna_der: [RODILLA_D, TOBILLO_D],
  ancho_hombros: [HOMBRO_I, HOMBRO_D],
  ancho_caderas: [CADERA_I, CADERA_D],
};

const norma = v => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const resta = (a, b) => a.map((x, i) => x - b[i]);
const medio = (a, b) => a.map((x, i) => (x + b[i]) / 2);

/** Ángulo en grados (0-180) en el vértice v; NaN si algún lado mide cero. */
export function anguloVertice(a, v, b) {
  const u = resta(a, v), w = resta(b, v), nu = norma(u), nw = norma(w);
  if (nu < 1e-9 || nw < 1e-9) return NaN;
  const punto = u.reduce((s, x, i) => s + x * w[i], 0);
  const c = Math.min(1, Math.max(-1, punto / (nu * nw)));
  return Math.acos(c) * (180 / Math.PI);
}

/** Los 8 ángulos; null (abstención) si la visibilidad mínima de la terna es menor que el umbral. */
export function angulosArticulares(puntos, visibilidad, umbral = UMBRAL_VIS) {
  const res = {};
  for (const [nombre, [a, v, b]] of Object.entries(ANGULOS)) {
    if (Math.min(visibilidad[a], visibilidad[v], visibilidad[b]) < umbral) { res[nombre] = null; continue; }
    const ang = anguloVertice(puntos[a], puntos[v], puntos[b]);
    res[nombre] = Number.isNaN(ang) ? null : ang;
  }
  return res;
}

export function longitudesSegmentos(mundo) {
  const res = {};
  for (const [n, [a, b]] of Object.entries(SEGMENTOS)) res[n] = norma(resta(mundo[a], mundo[b]));
  res.torso = norma(resta(medio(mundo[HOMBRO_I], mundo[HOMBRO_D]), medio(mundo[CADERA_I], mundo[CADERA_D])));
  return res;
}

/* ── filtros.py ── */
function alfa(corteHz, dt) {
  const tau = 1 / (2 * Math.PI * corteHz);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  constructor({ minCorte = 1.0, beta = 0.02, corteDerivada = 1.0 } = {}) {
    Object.assign(this, { minCorte, beta, corteDerivada });
    this.reiniciar();
  }
  reiniciar() { this.x = null; this.dx = 0; this.t = null; }
  filtrar(x, t) {
    if (this.x === null || this.t === null || t <= this.t) { this.x = x; this.t = t; this.dx = 0; return x; }
    const dt = t - this.t, dx = (x - this.x) / dt;
    const ad = alfa(this.corteDerivada, dt);
    this.dx = ad * dx + (1 - ad) * this.dx;
    const a = alfa(this.minCorte + this.beta * Math.abs(this.dx), dt);
    this.x = a * x + (1 - a) * this.x;
    this.t = t;
    return this.x;
  }
}

/** Un One-Euro por ángulo. Si un ángulo se abstiene (null), su filtro se reinicia. */
export class FiltroAngulos {
  constructor(opciones) { this.opciones = opciones; this.f = new Map(); }
  filtrar(angulos, t) {
    const out = {};
    for (const [n, v] of Object.entries(angulos)) {
      let f = this.f.get(n);
      if (!f) { f = new OneEuro(this.opciones); this.f.set(n, f); }
      if (v === null) { f.reiniciar(); out[n] = null; } else out[n] = f.filtrar(v, t);
    }
    return out;
  }
  reiniciar() { for (const f of this.f.values()) f.reiniciar(); }
}

/* ── perfil.py ── */
export const VERSION = 1;
export const NOTA = 'Estadísticas de la persona de pie medidas con el modelo genérico. No es entrenamiento de red.';

/* Suma en el mismo orden que numpy (por pares en bloques de 8, hasta 128 valores): en el límite exacto de un
   umbral de calidad, sumar de izquierda a derecha da otro resultado en el último decimal. */
function sumaNumpy(v) {
  let s = 0, i = 0;
  if (v.length >= 8) {
    const r = v.slice(0, 8);
    for (i = 8; i < v.length - (v.length % 8); i += 8) for (let j = 0; j < 8; j++) r[j] += v[i + j];
    s = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
  }
  for (; i < v.length; i++) s += v[i];
  return s;
}

/** [texto, media de visibilidad]: "buena", "regular" o "baja". */
export function calidad(visibilidad, indices = CUERPO, umbral = UMBRAL_VIS) {
  const v = indices.map(i => visibilidad[i]);
  const media = sumaNumpy(v) / v.length;
  const frac = v.filter(x => x >= umbral).length / v.length;
  if (media >= 0.8 && frac >= 0.9) return ['buena', media];
  if (media >= 0.55 && frac >= 0.6) return ['regular', media];
  return ['baja', media];
}

/** Percentil con interpolación lineal (el método por defecto de numpy). */
export function percentil(valores, p) {
  const x = [...valores].sort((a, b) => a - b);
  const pos = (x.length - 1) * (p / 100), i = Math.floor(pos), f = pos - i;
  const a = x[i], b = x[Math.min(i + 1, x.length - 1)];
  return f >= 0.5 ? b - (b - a) * (1 - f) : a + (b - a) * f;
}
export function mediana(valores) {
  const x = [...valores].sort((a, b) => a - b), m = x.length >> 1;
  return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2;
}
const mad = x => { const m = mediana(x); return mediana(x.map(v => Math.abs(v - m))) * 1.4826; };

/** round() de Python: al par en los empates exactos (toFixed redondea los empates hacia arriba). */
export function redondear(x, d) {
  const exacto = Math.abs(x).toFixed(100), corte = exacto.indexOf('.') + 1 + d;
  if (/^50*$/.test(exacto.slice(corte))) {
    const abajo = exacto.slice(0, corte);
    if (Number(abajo.replace('.', '').at(-1)) % 2 === 0) return Math.sign(x) * Number(abajo);
  }
  return Number(x.toFixed(d));
}

function fechaLocal(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function construirPerfil(nombre, segmentos, angulos) {
  const segStats = {};
  const torso = segmentos.map(s => s.torso);
  for (const k of Object.keys(segmentos[0])) {
    const x = segmentos.map(s => s[k]);
    segStats[k] = {
      mediana_m: redondear(mediana(x), 4),
      mad_m: redondear(mad(x), 4),
      proporcion_torso: redondear(mediana(x.map((v, i) => v / Math.max(torso[i], 1e-6))), 4),
    };
  }
  const angStats = {};
  for (const k of Object.keys(ANGULOS)) {
    const x = angulos.map(a => a[k]).filter(v => v !== null && v !== undefined);
    angStats[k] = x.length === 0 ? null : {
      mediana: redondear(mediana(x), 2),
      mad: redondear(mad(x), 2),
      p5: redondear(percentil(x, 5), 2),
      p95: redondear(percentil(x, 95), 2),
      n: x.length,
    };
  }
  return { version: VERSION, nombre, creado: fechaLocal(), muestras: segmentos.length, nota: NOTA, segmentos: segStats, angulos: angStats };
}

/* Regla de quietud: mismos límites que perfil.py (técnicos, no clínicos). */
const RANGO_MAX_PIERNAS = 20.0, MAD_MAX_PIERNAS = 10.0, MAD_MAX_BRAZOS = 15.0, MIN_DATOS_QUIETUD = 10;
export const FPS_MIN_CAPTURA = 15.0;

export class CalibracionConMovimiento extends RangeError {
  constructor(detalle) {
    super(`Calibración rechazada porque hubo movimiento: ${detalle}. Quédate de pie y quieto durante toda la captura.`);
    this.detalle = detalle;
  }
}

/** Motivo si las estadísticas muestran movimiento; null si la captura fue quieta. */
export function movimiento(perfil) {
  let peor = 1.0, motivo = null;
  for (const k of Object.keys(ANGULOS)) {
    const e = perfil.angulos?.[k];
    if (!e || e.n < MIN_DATOS_QUIETUD) continue;
    const pierna = k.startsWith('cadera') || k.startsWith('rodilla');
    const medidas = [['dispersion MAD', e.mad, pierna ? MAD_MAX_PIERNAS : MAD_MAX_BRAZOS]];
    if (pierna) medidas.unshift(['rango p5-p95', e.p95 - e.p5, RANGO_MAX_PIERNAS]);
    for (const [que, valor, limite] of medidas) {
      if (valor / limite > peor) {
        const [art, lado] = k.split('_');
        peor = valor / limite;
        motivo = `${art} ${lado}: ${que} de ${redondear(valor, 0)} grados (maximo ${limite})`;
      }
    }
  }
  return motivo;
}

export class Calibrador {
  constructor({ segundos = 4.0, minMuestras = 15 } = {}) {
    this.segundos = segundos; this.minMuestras = minMuestras; this.inicio = null; this.segmentos = []; this.angulos = [];
    this.cuadros = 0; this.tPrimero = 0; this.tUltimo = 0;
  }
  iniciar(t) { this.inicio = t; this.segmentos = []; this.angulos = []; this.cuadros = 0; }
  /** Anota cada cuadro de la captura (con o sin persona) para medir los cuadros por segundo. */
  contar(t) { if (!this.cuadros) this.tPrimero = t; this.cuadros++; this.tUltimo = t; }
  get fpsCaptura() {
    const dt = this.tUltimo - this.tPrimero;
    return this.cuadros > 1 && dt > 0 ? (this.cuadros - 1) / dt : null;
  }
  get pocosFps() { const f = this.fpsCaptura; return f !== null && f < FPS_MIN_CAPTURA; }
  get activo() { return this.inicio !== null; }
  progreso(t) { return this.inicio === null ? 0 : Math.min(1, (t - this.inicio) / this.segundos); }
  agregar(mundo, angulos, calidadTxt) {
    if (!this.activo || calidadTxt !== 'buena') return;
    this.segmentos.push(longitudesSegmentos(mundo));
    this.angulos.push(angulos);
  }
  terminado(t) { return this.activo && this.progreso(t) >= 1; }
  construir(nombre) {
    this.inicio = null;
    if (this.segmentos.length < this.minMuestras) {
      throw new RangeError(`Calibración insuficiente: ${this.segmentos.length} cuadros con calidad buena `
        + `(se necesitan ${this.minMuestras}). Ponte de pie, cuerpo completo en cuadro y buena luz.`);
    }
    const perfil = construirPerfil(nombre, this.segmentos, this.angulos);
    const detalle = movimiento(perfil);
    if (detalle) throw new CalibracionConMovimiento(detalle);
    return perfil;
  }
}

export function nombreSeguro(nombre) {
  const limpio = nombre.trim().replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40);
  if (!limpio.replace(/^_+|_+$/g, '')) throw new RangeError('Nombre de perfil vacío o inválido.');
  return limpio;
}

/** Grados actuales menos la mediana de pie, y % de cambio del largo de cada segmento. */
export function diferencias(perfil, angulos, mundo) {
  const dAng = {};
  for (const [k, v] of Object.entries(angulos)) {
    const ref = perfil.angulos?.[k];
    dAng[k] = v === null || !ref ? null : v - ref.mediana;
  }
  const dSeg = {};
  if (mundo) {
    const actuales = longitudesSegmentos(mundo);
    for (const [k, ref] of Object.entries(perfil.segmentos ?? {})) {
      const m = ref.mediana_m;
      dSeg[k] = m <= 0 ? null : 100 * (actuales[k] - m) / m;
    }
  }
  return { angulos: dAng, segmentos: dSeg };
}

/* ── sesion.py (Procesador.paso, sin dibujo, CSV ni video) ── */
export class Sesion {
  /* 6 s de preparación y 6 s de captura: los mismos valores que `pose_twin live` (vivo.py). */
  constructor({ umbral = UMBRAL_VIS, segundosPreparacion = 6.0, segundosCalibracion = 6.0, nombre = 'perfil', perfil = null } = {}) {
    this.umbral = umbral; this.segundosPreparacion = segundosPreparacion;
    this.filtro = new FiltroAngulos({ minCorte: 1.0, beta: 0.02 });
    this.calibrador = new Calibrador({ segundos: segundosCalibracion });
    this.nombre = nombre; this.perfil = perfil;
    this.pendiente = false; this.prepHasta = 0; this.resultado = null;
  }
  get ocupada() { return this.pendiente || this.calibrador.activo; }
  /** t: instante en que se pide, en el mismo reloj que los cuadros. */
  iniciarCalibracion(t) {
    this.pendiente = true; this.prepHasta = t + this.segundosPreparacion; this.resultado = null;
  }
  /** pose: null (sin persona) o { puntos: 33 puntos 3D, visibilidad: 33, mundo: true si son metros 3D }. */
  paso(pose, t) {
    let calidadTxt = 'sin persona', visMedia = 0, crudos;
    if (pose) {
      [calidadTxt, visMedia] = calidad(pose.visibilidad, CUERPO, this.umbral);
      crudos = angulosArticulares(pose.puntos, pose.visibilidad, this.umbral);
    } else crudos = Object.fromEntries(Object.keys(ANGULOS).map(k => [k, null]));
    const angulos = this.filtro.filtrar(crudos, t);
    const mundo = pose && pose.mundo ? pose.puntos : null;

    let calibrando = null, preparando = null, recien = false;
    if (this.pendiente && t < this.prepHasta) preparando = this.prepHasta - t;
    else if (this.pendiente) { this.calibrador.iniciar(t); this.pendiente = false; }
    if (this.calibrador.activo) {
      this.calibrador.contar(t);
      if (mundo) this.calibrador.agregar(mundo, crudos, calidadTxt);
      calibrando = this.calibrador.progreso(t);
      if (this.calibrador.terminado(t)) {
        calibrando = null;
        const muestras = this.calibrador.segmentos.length;
        const aviso = this.calibrador.pocosFps ? `Aviso: solo ${redondear(this.calibrador.fpsCaptura, 0)} cuadros/s `
          + '(poca luz o equipo lento): usa más luz.' : '';
        try {
          this.perfil = this.calibrador.construir(this.nombre);
          this.resultado = { ok: true, muestras, aviso };
          recien = true;
        } catch (e) {
          if (!(e instanceof RangeError)) throw e;
          this.resultado = { ok: false, muestras, motivo: e.message, aviso };
        }
      }
    }
    const dif = this.perfil ? diferencias(this.perfil, angulos, mundo) : null;
    return {
      t, angulos, crudos, calidad: calidadTxt, visMedia, diferencias: dif, calibrando, preparando,
      muestras: this.calibrador.segmentos.length, resultado: this.resultado, perfilNuevo: recien,
    };
  }
}
