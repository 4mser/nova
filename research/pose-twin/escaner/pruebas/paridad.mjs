/* Compara angulos.mjs con los resultados calculados por el código Python.
   Uso: node paridad.mjs casos.json perfil_js.json   (casos.json lo genera tests/test_escaner_paridad.py) */
import { readFileSync, writeFileSync } from 'node:fs';
import * as A from '../angulos.mjs';
import { SerieSentadilla, aCsv } from '../sentadilla.mjs';

const [rutaCasos, rutaPerfil] = process.argv.slice(2);
const casos = JSON.parse(readFileSync(rutaCasos, 'utf8'));
const fallos = [];
let comparaciones = 0;

function igual(js, py, donde, tol = 1e-9) {
  if (typeof py === 'number') {
    comparaciones++;
    if (typeof js !== 'number' || !(Math.abs(js - py) <= tol)) fallos.push(`${donde}: JS ${js} != Python ${py}`);
  } else if (py === null || typeof py !== 'object') {
    comparaciones++;
    if (js !== py) fallos.push(`${donde}: JS ${JSON.stringify(js)} != Python ${JSON.stringify(py)}`);
  } else {
    if (js === null || typeof js !== 'object') { fallos.push(`${donde}: JS ${JSON.stringify(js)} no es un objeto`); return; }
    const kp = Object.keys(py), kj = Object.keys(js);
    if (kp.join() !== kj.join()) fallos.push(`${donde}: claves JS [${kj}] != Python [${kp}]`);
    for (const k of kp) igual(js[k], py[k], `${donde}.${k}`, tol);
  }
}
const sinFecha = p => (p ? { ...p, creado: '' } : null);

casos.angulos.forEach((c, i) => igual(A.angulosArticulares(c.puntos, c.vis, c.umbral), c.esperado, `angulos[${i}]`));
casos.calidad.forEach((c, i) => igual(A.calidad(c.vis, A.CUERPO, c.umbral), c.esperado, `calidad[${i}]`));
casos.segmentos.forEach((c, i) => igual(A.longitudesSegmentos(c.mundo), c.esperado, `segmentos[${i}]`));
casos.redondeo.forEach(([x, d, y], i) => igual(A.redondear(x, d), y, `redondeo[${i}] (${x}, ${d})`, 0));
casos.estadistica.forEach((c, i) => {
  igual(A.mediana(c.x), c.mediana, `mediana[${i}]`);
  igual(A.percentil(c.x, 5), c.p5, `p5[${i}]`);
  igual(A.percentil(c.x, 95), c.p95, `p95[${i}]`);
});
casos.nombres.forEach(([entrada, esperado], i) => {
  let r; try { r = A.nombreSeguro(entrada); } catch { r = null; }
  igual(r, esperado, `nombre[${i}]`);
});
casos.filtro.forEach((secuencia, i) => {
  const f = new A.FiltroAngulos({ minCorte: 1.0, beta: 0.02 });
  secuencia.forEach((c, j) => igual(f.filtrar(c.entrada, c.t), c.esperado, `filtro[${i}][${j}]`));
});

casos.movimiento.forEach((c, i) => igual(A.movimiento(c.perfil), c.esperado, `movimiento[${i}]`));

casos.sentadillas.forEach((s, i) => {
  const serie = new SerieSentadilla({ segundosPreparacion: s.preparacion, segundosFin: s.fin });
  s.cuadros.forEach((c, j) => {
    serie.paso(c.angulos, c.t, c.vis);
    // las repeticiones completas solo se comparan al terminar (en Python la lista sigue creciendo)
    const e = serie.estado(c.t), p = c.esperado;
    igual({ ...e, repeticiones: null }, { ...p, repeticiones: null }, `sentadilla[${i}][${j}]`);
  });
  serie.terminar();
  const resultado = serie.resultado('');
  igual(resultado, s.resultado, `sentadilla[${i}].resultado`);
  const filas = aCsv(resultado).trimEnd().split('\r\n').map(f => [...f.matchAll(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)]
    .map(m => m[1].replace(/^"|"$/g, '').replaceAll('""', '"')));
  const valor = x => (x !== '' && !Number.isNaN(Number(x)) ? Number(x) : x);
  igual(filas.map(f => f.map(valor)), s.csv.map(f => f.map(valor)), `sentadilla[${i}].csv`);
});

let perfilFinal = null;
casos.sesiones.forEach((s, i) => {
  const sesion = new A.Sesion({ nombre: s.nombre });
  s.cuadros.forEach((c, j) => {
    if (c.calibrar !== null) sesion.iniciarCalibracion(c.calibrar);
    const e = sesion.paso(c.pose, c.t), p = c.esperado, donde = `sesion[${i}][${j}]`;
    igual(e.angulos, p.angulos, `${donde}.angulos`);
    igual(e.calidad, p.calidad, `${donde}.calidad`);
    igual(e.visMedia, p.vis_media, `${donde}.visMedia`);
    igual(e.calibrando, p.calibrando, `${donde}.calibrando`);
    igual(e.preparando, p.preparando, `${donde}.preparando`);
    igual(e.diferencias, p.diferencias, `${donde}.diferencias`, 1e-8);
    igual(e.resultado ? e.resultado.ok : null, p.ok, `${donde}.resultado`);
    igual(e.resultado ? e.resultado.aviso !== '' : null, p.pocos_fps, `${donde}.pocosFps`);
    igual(e.calibrando === null && /hubo movimiento/.test(e.resultado?.motivo ?? ''), p.movimiento, `${donde}.movimiento`);
  });
  igual(sinFecha(sesion.perfil), sinFecha(s.perfil), `sesion[${i}].perfil`, 0);
  if (s.nombre === 'paridad') perfilFinal = sesion.perfil;
});

if (perfilFinal) writeFileSync(rutaPerfil, JSON.stringify(perfilFinal, null, 2));
if (fallos.length) {
  console.error(`${fallos.length} diferencias de ${comparaciones} comparaciones:\n${fallos.slice(0, 20).join('\n')}`);
  process.exit(1);
}
console.log(`paridad OK: ${comparaciones} comparaciones`);
