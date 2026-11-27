/* Comprueba figura.mjs: qué perfiles se usan, de dónde sale cada medida y cómo se mezcla con lo visto en vivo.
   Datos sintéticos. Uso: node figura.mjs   (lo corre tests/test_escaner_figura.py) */
import assert from 'node:assert/strict';
import { construirPerfil, longitudesSegmentos, ANGULOS } from '../angulos.mjs';
import { medidasPerfil, mezclar, SEGMENTO_PERFIL, TOLERANCIA } from '../figura.mjs';

// puntos separados a distancias distintas, para que cada segmento tenga un largo propio
const mundo = Array.from({ length: 33 }, (_, i) => [0.011 * i, 0.0007 * i * i, 0.003 * i]);
const quieto = Object.fromEntries(Object.keys(ANGULOS).map(k => [k, 170]));
const perfil = construirPerfil('prueba', Array(20).fill(longitudesSegmentos(mundo)), Array(20).fill(quieto));

const { medidas, motivo } = medidasPerfil(perfil);
assert.equal(motivo, null);
const largo = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
const cerca = (x, y) => assert.ok(Math.abs(x - y) <= 5e-5, `${x} != ${y}`);
cerca(medidas.hombros, largo(mundo[11], mundo[12])); // sin el factor 1,18: lo aplica escaner.js
const medio = (a, b) => a.map((x, i) => (x + b[i]) / 2);
cerca(medidas.torso, largo(medio(mundo[11], mundo[12]), medio(mundo[23], mundo[24])));
// los mismos puntos que SEGMENTOS de escaner.js
const PUNTOS = { brazoI: [11, 13], brazoD: [12, 14], antebrazoI: [13, 15], antebrazoD: [14, 16],
  musloI: [23, 25], musloD: [24, 26], piernaI: [25, 27], piernaD: [26, 28] };
assert.deepEqual(Object.keys(SEGMENTO_PERFIL).sort(), Object.keys(PUNTOS).sort());
for (const [g, [a, b]] of Object.entries(PUNTOS)) cerca(medidas.segmentos[g], largo(mundo[a], mundo[b]));

// perfiles que no se usan
const rechazado = (p, texto) => { const r = medidasPerfil(p); assert.equal(r.medidas, null); assert.match(r.motivo, texto); };
rechazado(null, /no hay perfil/);
rechazado({ ...perfil, version: 2 }, /formato/);
rechazado({ ...perfil, muestras: 14 }, /menos de 15/);
const movido = structuredClone(perfil);
movido.angulos.rodilla_izq = { mediana: 120, mad: 12, p5: 60, p95: 175, n: 20 };
rechazado(movido, /movimiento/);
for (const malo of [0, -1, NaN, null, '0.3']) {
  const p = structuredClone(perfil); p.segmentos.muslo_der.mediana_m = malo; rechazado(p, /faltan largos/);
}
const sinTorso = structuredClone(perfil); delete sinTorso.segmentos.torso; rechazado(sinTorso, /faltan largos/);

// mezcla: sin perfil, el valor en vivo tal cual
for (const vivo of [0.2, 0.5, null]) { assert.equal(mezclar(null, vivo), vivo); assert.equal(mezclar(undefined, vivo), vivo); }
assert.equal(mezclar(0.4, null), 0.4);               // sin valor en vivo, el perfil
assert.equal(mezclar(0.42, 0.40), 0.42);             // cerca: el perfil, estable
assert.equal(mezclar(0.42, 0.41), 0.42);
cerca(mezclar(0.60, 0.40), 0.40 * (1 + TOLERANCIA)); // lejos: acotado
cerca(mezclar(0.20, 0.40), 0.40 * (1 - TOLERANCIA));
for (let v = 0.2; v < 0.7; v += 0.01) assert.ok(Math.abs(mezclar(0.4, v) - v) <= TOLERANCIA * v + 1e-12);
console.log('figura.mjs: correcto');
