/* Vista Body twin: el gemelo anatómico de cada astronauta, en 3D y tocable.
   · Anatomía real y abierta: BodyParts3D 4.0 (hombre adulto, 2.234 estructuras, © DBCLS, CC BY 4.0) y el set femenino del
     Human Reference Atlas del NIH (HuBMAP, CC BY 4.0). Son cuerpos de referencia, no el escáner de esta persona.
   · Cada región (corazón, pulmones, cerebro, ojos, cadera, columna, piernas, riñones, piel) se colorea con su estado:
     en vivo desde el núcleo F Prime, o estimado por el modelo de a bordo con tasas de la NASA (y lo dice).
   · Se gira, se acerca, se encienden capas y al tocar una estructura se abre su ficha: qué es, qué le hace el espacio,
     cómo está hoy y qué hacer. La línea de tiempo proyecta hueso y músculo hasta el regreso, con y sin ejercicio. */
import * as THREE from './lib/three.module.min.js';
import { OrbitControls } from './lib/OrbitControls.js';

const CARPETA = { hombre: 'anatomia/hombre/', mujer: 'anatomia/mujer/' };
const COLOR_EST = { normal: '#46c8e8', esperado_vuelo: '#46c8e8', vigilar: '#a898ff', atencion: '#f2b457', aviso_tierra: '#ec6aa8' };
const REAL = { skeletal: '#e6d9bf', muscular: '#9c3f36', arterial: '#c23a2e', venous: '#3b5596', nervous: '#e2c46a', respiratory: '#d79b9b', digestive: '#c48862', cardiac: '#b3302e', urinary: '#8f4a44', sensory: '#d8d0e8', connective: '#cfc6b0', reproductive: '#b97a7a', endocrine: '#c9a04f', lymphatic: '#7fa36b', integumentary: '#e0b9a0' };
const CAPAS = [['piel', 'Skin'], ['esqueleto', 'Skeleton'], ['organos', 'Organs'], ['musculos', 'Muscles'], ['vasos', 'Vessels'], ['nervios', 'Nerves']];

let ren = null, esc, cam, ctrl, raiz, cajaEl, corre = false, tAnt = 0, faseLatido = 0;
const modelos = {};            // sexo → { grupo, mallas, porRegion, listo }
let sexo = '', gT = 0, estilo = 'halo', sel = null, dia = null, conEj = true, estados = {}, firmaPanel = '', firmaMat = '';
const capas = new Set(['piel', 'esqueleto', 'organos']);
let vuelo = null, hoverT = 0, aroScan = null, polvo = null, hud = null, firmaHud = '';
const ecgBuf = new Array(140).fill(0);

/* ── carga ── */
async function bajar(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(url);
  if (!url.endsWith('.gz')) return r.arrayBuffer();
  return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
function capaDe(p) {
  const n = p.name;
  if (p.system === 'integumentary') return /^(skin|lip|eyebrow)$/i.test(n) || /^VH_F_(skin|fat)/.test(p.id) ? 'piel' : null;
  if (p.system === 'skeletal' || p.system === 'connective') return 'esqueleto';
  if (p.system === 'muscular') return 'musculos';
  if (p.system === 'arterial' || p.system === 'venous') return 'vasos';
  if (p.system === 'nervous' && /nerve|ganglion|spinal|cord|dura|chiasm/i.test(n)) return 'nervios';
  if (p.system === 'reproductive' && /mammary|lactiferous|areola|nipple|suspensory ligaments/i.test(n)) return 'piel';
  return 'organos';
}
async function cargar(sx) {
  if (modelos[sx]) return modelos[sx].promesa;
  const m = modelos[sx] = { grupo: new THREE.Group(), mallas: [], porRegion: {}, listo: false };
  m.promesa = (async () => {
    const atlas = await (await fetch(CARPETA[sx] + 'atlas.json')).json();
    let hechos = 0;
    const bufs = await Promise.all(atlas.chunks.map((c, i) => bajar(`${CARPETA[sx]}body-${i}.bin.gz`).then(b => { hechos++; avisoCarga(`Loading ${sx === 'mujer' ? 'female' : 'male'} anatomy · ${Math.round(hechos / atlas.chunks.length * 100)}%`); return b; })));
    for (const p of atlas.parts) {
      const capa = capaDe(p); if (!capa) continue;
      const b = bufs[p.chunk], g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b, p.positions, p.vertexCount * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Int16Array(b, p.normals, p.vertexCount * 3), 3, true));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(b, p.indices, p.indexCount), 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const r = REGIONES.find(R => R.es(p)), malla = new THREE.Mesh(g);
      malla.frustumCulled = false;   // la caja es la del reposo: al posar, una pieza que sale de ella desaparecería
      malla.userData = { p, capa, region: r ? r.id : null };
      malla.renderOrder = capa === 'piel' ? 10 : 0;
      m.grupo.add(malla); m.mallas.push(malla);
      if (r) (m.porRegion[r.id] = m.porRegion[r.id] || []).push(malla);
    }
    // centro de cada región (para el latido y para acercar la cámara)
    m.cajas = {};
    for (const [id, l] of Object.entries(m.porRegion)) { const c = new THREE.Box3(); l.forEach(x => c.union(x.geometry.boundingBox)); m.cajas[id] = c; }
    m.cajaTodo = new THREE.Box3().setFromObject(m.grupo);
    // ancla de cada región: el punto de su superficie más cercano al centro (ahí llega la línea del panel)
    m.anclas = {};
    for (const [id, l] of Object.entries(m.porRegion)) {
      const c = m.cajas[id].getCenter(new THREE.Vector3()); if (id === 'piel') c.set(m.cajas[id].max.x * .55, c.y + .32, m.cajas[id].max.z);
      let mejor = null, d2 = Infinity;
      for (const x of l) { const a = x.geometry.attributes.position, paso = Math.max(1, Math.floor(a.count / 4000));
        for (let i = 0; i < a.count; i += paso) { const dx = a.getX(i) - c.x, dy = a.getY(i) - c.y, dz = a.getZ(i) - c.z, q = dx * dx + dy * dy + dz * dz; if (q < d2) { d2 = q; mejor = [a.getX(i), a.getY(i), a.getZ(i)]; } } }
      if (mejor) m.anclas[id] = new THREE.Vector3(...mejor);
    }
    m.listo = true; firmaMat = '';
    return m;
  })();
  return m.promesa;
}
function avisoCarga(t) { const e = $('gCarga'); if (e) { e.textContent = t; e.hidden = !t; } }

/* ── materiales ── */
const mats = {};
function fresnel(col, k, pw) {
  return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { c: { value: new THREE.Color(col) }, k: { value: k }, p: { value: pw }, uJog: HU.uJog, uPuno: HU.uPuno, uModo: HU.uModo, uVis: HU.uVis, uS: HU.uS, ...HU_CARA() },
    vertexShader: VTX,
    fragmentShader: 'uniform vec3 c; uniform float k; uniform float p; varying vec3 vN; varying vec3 vV; varying float vVis; void main(){ float f = pow(1.-abs(dot(normalize(vN),vV)), p); gl_FragColor = vec4(c*f*k*vVis, vVis); }' });
}
/* holograma: cada sistema con su luz, brillo en el borde, líneas de escaneo y una banda que recorre el cuerpo.
   El corazón se enciende con cada latido y los pulmones con la respiración (uniformes compartidos por todo el cuerpo). */
const HU = { uT: { value: 0 }, uBeat: { value: 0 }, uBreath: { value: 0 }, uScan: { value: -1 }, uJog: { value: 0 }, uPh: { value: 0 }, uPuno: { value: 0 }, uModo: { value: 0 }, uVis: { value: Array.from({ length: 13 }, () => new THREE.Vector4(1, 1, 1, 1)) },
  // gestos de la cara en el espejo: zonas (centro + radio) con su desplazamiento, y la mandíbula (ángulo + traslación)
  uFc: { value: Array.from({ length: 24 }, () => new THREE.Vector4(0, -9, 0, .01)) }, uFd: { value: Array.from({ length: 24 }, () => new THREE.Vector3()) }, uMand: { value: new THREE.Vector4() } };
const HU_CARA = () => ({ uFc: HU.uFc, uFd: HU.uFd, uMand: HU.uMand });
/* trote: un esqueleto de 13 segmentos sobre el cuerpo de referencia masculino (articulaciones medidas en sus huesos;
   el frente mira a +z, la izquierda es +x). Los ángulos siguen las curvas de la carrera a trote (Novacheck 1998,
   «The biomechanics of running», Gait & Posture 7): cadera, rodilla con sus dos picos, tobillo, rotación de pelvis,
   contrarrotación del torso y brazos opuestos a las piernas. El pie de apoyo se asienta en el piso y hay fase de vuelo.
   Cada vértice se mezcla entre dos huesos cerca de la articulación para que la malla no se quiebre. Se detiene al
   elegir una parte para mirarla quieta. */
const J = { pel: [0, .95, -.03], cin: [0, 1.06, -.03], cue: [0, 1.5, -.035],
  cad: [.088, .89, -.02], rod: [.08, .455, -.015], tob: [.072, .085, -.035], hom: [.19, 1.39, -.025], cod: [.232, 1.115, -.02] };
// [fase 0–1 desde el contacto del pie, grados]; flexión positiva
const CURVAS = {
  cadera: [[0, 30], [.15, 17], [.3, 0], [.4, -11], [.5, -5], [.65, 19], [.8, 34], [.92, 32]],
  rodilla: [[0, 17], [.13, 39], [.27, 26], [.4, 22], [.55, 62], [.7, 96], [.84, 55], [.95, 20]],
  tobillo: [[0, 2], [.15, 17], [.32, 4], [.42, -24], [.55, -12], [.7, 0], [.9, 4]] };
function curva(k, f) {
  const c = CURVAS[k], n = c.length; f = ((f % 1) + 1) % 1;
  let i = n - 1; while (i > 0 && c[i][0] > f) i--;
  const a = c[i], b = c[(i + 1) % n], a0 = c[(i - 1 + n) % n], b1 = c[(i + 2) % n];
  const ta = a[0], tb = i + 1 < n ? b[0] : b[0] + 1, u = (f - ta) / (tb - ta);
  const u2 = u * u, u3 = u2 * u;   // Catmull-Rom cerrada
  return .5 * (2 * a[1] + (-a0[1] + b[1]) * u + (2 * a0[1] - 5 * a[1] + 4 * b[1] - b1[1]) * u2 + (-a0[1] + 3 * a[1] - 3 * b[1] + b1[1]) * u3);
}
const SEGS = 51, uS = Array.from({ length: SEGS }, () => new THREE.Matrix4());
HU.uS = { value: uS };
const _v = new THREE.Vector3(), rad = Math.PI / 180;
const enJ = (m, p, r) => new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]).multiply(r).multiply(new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2]));
const RX = a => new THREE.Matrix4().makeRotationX(a), RY = a => new THREE.Matrix4().makeRotationY(a), RZ = a => new THREE.Matrix4().makeRotationZ(a);
const lad = (p, s) => [p[0] * s, p[1], p[2]];
function poseTrote(fase, k) {
  // k: 0 quieto → 1 trotando (todos los ángulos se escalan, así entra y sale suave)
  const fD = fase, fI = fase + .5, rv = (x) => x * rad * k;
  const yaw = rv(7 * Math.sin(2 * Math.PI * (fase - .1)));                     // la pelvis gira con la pierna que avanza
  const root = new THREE.Matrix4();
  const pelvis = enJ(null, J.pel, RY(yaw).multiply(RX(rv(4))));
  uS[0].copy(root).multiply(pelvis);
  const torso = enJ(null, J.cin, RY(-yaw * 1.6).multiply(RX(rv(5))));           // contrarrotación del tórax y algo de inclinación
  uS[1].copy(uS[0]).multiply(torso);
  uS[2].copy(uS[1]).multiply(enJ(null, J.cue, RY(yaw * .5).multiply(RX(-rv(7)))));  // la cabeza mira al frente
  for (const [s, f, b] of [[1, fI, 3], [-1, fD, 6]]) {                           // izquierda (+x) y derecha
    const cad = lad(J.cad, s), rod = lad(J.rod, s), tob = lad(J.tob, s);
    uS[b].copy(uS[0]).multiply(enJ(null, cad, RX(-rv(curva('cadera', f))).multiply(RZ(rv(-s * 2)))));
    uS[b + 1].copy(uS[b]).multiply(enJ(null, rod, RX(rv(curva('rodilla', f)))));
    uS[b + 2].copy(uS[b + 1]).multiply(enJ(null, tob, RX(-rv(curva('tobillo', f)))));
  }
  for (const [s, f, b] of [[1, fD, 9], [-1, fI, 11]]) {                          // cada brazo va con la pierna contraria
    const hom = lad(J.hom, s), cod = lad(J.cod, s);
    const flex = 26 * Math.sin(2 * Math.PI * (f - .05)) - 6, codo = 82 + 14 * Math.sin(2 * Math.PI * (f - .05));
    uS[b].copy(uS[1]).multiply(enJ(null, hom, RX(-rv(flex)).multiply(RZ(rv(s * 5))).multiply(RY(rv(-s * 3)))));
    uS[b + 1].copy(uS[b]).multiply(enJ(null, cod, RX(-rv(codo)))).multiply(enJ(null, [s * .245, 0, -.02], RY(rv(-s * 85))));
  }
  // altura del cuerpo: una curva suave y fija (el promedio que asienta los pies) con un vaivén de menos de 1 cm, sin saltos
  if (baseTrote == null && k === 1) baseTrote = alturaMedia(fase);
  const ajuste = new THREE.Matrix4().makeTranslation(0, ((baseTrote ?? 0) + .007 * Math.cos(2 * Math.PI * 2 * (fase - .4))) * k, 0);
  for (const m of uS) m.premultiply(ajuste);
}
let baseTrote = null;
function bajoPies() { let b = Infinity; for (const [s, i] of [[1, 5], [-1, 8]]) for (const q of [[.075, .012, -.07], [.09, .012, .19]]) { _v.set(q[0] * s, q[1], q[2]).applyMatrix4(uS[i]); b = Math.min(b, _v.y); } return b; }
function alturaMedia(f0) { baseTrote = 0; let sum = 0; for (let i = 0; i < 40; i++) { poseTrote(i / 40, 1); sum += .012 - bajoPies(); } baseTrote = null; return sum / 40; }
/* galería de poses: cuando nadie está frente a la cámara, el gemelo pasa por posturas quietas (y el trote es una más).
   Cada pose son ángulos de articulación (grados); con ellos se arman los 33 puntos que daría MediaPipe y se posan con
   el mismo esqueleto fino del espejo (51 huesos, piel a 3 huesos), así cada postura se ve igual de bien que en vivo.
   Entre una y otra los ángulos se acercan suave; mientras está quieto respira, se balancea apenas y parpadea. */
const POSES = [
  { id: 'firme', n: 'Standing', a: { bA: [6, 0, 0, 12], bB: [6, 0, 0, 12], pA: [0, 2, 0, 2, 0], pB: [0, 2, 0, 2, 0] } },
  { id: 'cintura', n: 'Hands on hips', a: { bA: [48, -12, 55, 105], bB: [48, -12, 55, 105], pA: [0, 7, 0, 2, 0], pB: [0, 7, 0, 2, 0], cab: [0, -4, 0] } },
  { id: 'contra', n: 'At ease', a: { pel: [0, 0, -4], tor: [0, 5, 0], cab: [14, 3, -5], bA: [8, 4, 10, 18], bB: [14, -8, 0, 8], pA: [3, 9, 8, 12, 4], pB: [-3, 0, 0, 1, 0] } },
  { id: 'cruzados', n: 'Arms crossed', a: { cab: [0, -3, 0], bA: [18, 32, 80, 112], bB: [16, 38, 84, 118], pA: [0, 6, 0, 2, 0], pB: [0, 6, 0, 2, 0] } },
  { id: 'sentadilla', n: 'Squat', a: { pel: [0, 18, 0], tor: [0, 8, 0], cab: [0, -20, 0], bA: [6, 84, 0, 6], bB: [6, 84, 0, 6], pA: [16, 100, 14, 108, 26], pB: [16, 100, 14, 108, 26] } },
  { id: 'estocada', n: 'Lunge', a: { pel: [0, 2, 0], tor: [0, -4, 0], bA: [42, -12, 55, 100], bB: [42, -12, 55, 100], pA: [4, 82, 0, 88, 8], pB: [2, -22, 0, 82, -22] } },
  { id: 'saludo', n: 'Wave', a: { tor: [0, 0, -4], cab: [-8, 2, 5], bA: [8, 0, 0, 14], bB: [42, 30, -75, 112], pA: [0, 3, 0, 3, 0], pB: [0, 3, 0, 3, 0] } },
  { id: 'cuadriceps', n: 'Quad stretch', a: { pel: [0, 0, 3], tor: [0, 4, 0], bA: [4, -52, 0, 8], bB: [30, 0, 0, 14], pA: [2, -4, 0, 136, -10], pB: [0, 2, 0, 3, 2] } },
  { id: 'arriba', n: 'Reach up', a: { tor: [0, -5, 0], cab: [0, -16, 0], bA: [24, 158, 0, 12], bB: [24, 158, 0, 12], pA: [0, 0, 0, 1, -8], pB: [0, 0, 0, 1, -8] } },
  { id: 'pensar', n: 'Thinking', a: { tor: [0, 4, 0], cab: [-10, 10, 6], bA: [10, 30, 70, 110], bB: [4, 38, 40, 146], pA: [0, 4, 0, 4, 0], pB: [0, 4, 0, 4, 0] } },
  { id: 'lateral', n: 'Side bend', a: { tor: [0, 0, 14], cab: [0, 0, 6], bA: [14, 0, 0, 16], bB: [26, 150, 0, 14], pA: [8, 0, 0, 2, 0], pB: [8, 0, 0, 2, 0] } },
  { id: 'trote', n: 'Jogging', trote: true }];
const REPOSO_P = { a: {} };
const galeria = { elegida: 'auto', i: 0, t: 0, ang: null, modo1: false, parp: 0, tParp: 3 };
const ANG = ['pel', 'tor', 'cab', 'bA', 'bB', 'pA', 'pB'], LARGO = { pel: 3, tor: 3, cab: 3, bA: 4, bB: 4, pA: 5, pB: 5 };
const angulos = p => Object.fromEntries(ANG.map(k => [k, (p.a[k] || Array(LARGO[k]).fill(0)).slice()]));
// pel/tor: [giro, flexión adelante, inclinación lateral] · cab: [giro, cabeceo (+ abajo), ladeo]
// brazo: [abducción, flexión adelante, rotación interna, codo] · pierna: [abducción, flexión de cadera, rotación, rodilla, tobillo]
// A = lado +x del gemelo, B = lado −x
function puntosPose(A, ts) {
  const g = x => x * rad, resp = Math.sin(ts * Math.PI * 2 * 14 / 60), vaiv = Math.sin(ts * .7);
  const M0 = enJ(null, J.pel, RY(g(A.pel[0] + vaiv * .8)).multiply(RX(g(A.pel[1]))).multiply(RZ(g(A.pel[2]))));
  const M1 = M0.clone().multiply(enJ(null, J.cin, RY(g(A.tor[0])).multiply(RZ(-g(A.tor[2]))).multiply(RX(g(A.tor[1] + resp * .8)))));
  const Mh = M1.clone().multiply(enJ(null, J.cue, RY(g(A.cab[0] + Math.sin(ts * .31) * 3)).multiply(RX(g(A.cab[1] + Math.sin(ts * .23) * 1.5))).multiply(RZ(-g(A.cab[2])))));
  const P = new Array(33), en = (M, p) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(M);
  const CAB = { 0: [0, 1.584, .1], 1: [-.02, 1.625, .085], 2: [-.032, 1.625, .085], 3: [-.045, 1.623, .08], 4: [.02, 1.625, .085], 5: [.032, 1.625, .085], 6: [.045, 1.623, .08],
    7: [-.075, 1.615, -.005], 8: [.075, 1.615, -.005], 9: [-.022, 1.535, .09], 10: [.022, 1.535, .09] };
  for (const i in CAB) P[i] = en(Mh, CAB[i]);
  for (const [s, b, p, iH, iC] of [[1, A.bA, A.pA, 12, 24], [-1, A.bB, A.pB, 11, 23]]) {
    const hom = lad(J.hom, s), cod = lad(J.cod, s), mun = lad(PIV.mun, s), pun = lad(PIV.pun, s);
    const Mb = M1.clone().multiply(enJ(null, hom, RZ(s * g(b[0])).multiply(RX(-g(b[1]))).multiply(RY(-s * g(b[2])))));
    const Ma = Mb.clone().multiply(enJ(null, cod, RX(-g(b[3]))));
    P[iH] = en(M1, hom); P[iH + 2] = en(Mb, cod); P[iH + 4] = en(Ma, mun);
    for (const j of [6, 8, 10]) P[iH + j] = en(Ma, pun);
    const cad = lad(J.cad, s), rod = lad(J.rod, s), tob = lad(J.tob, s), tal = lad(PIV.tal, s), dedo = lad(PIV.dedo, s);
    const Mm = M0.clone().multiply(enJ(null, cad, RZ(s * g(p[0])).multiply(RX(-g(p[1]))).multiply(RY(-s * g(p[2])))));
    const Mp = Mm.clone().multiply(enJ(null, rod, RX(g(p[3]))));
    const Mf = Mp.clone().multiply(enJ(null, tob, RX(-g(p[4]))));
    P[iC] = en(M0, cad); P[iC + 2] = en(Mm, rod); P[iC + 4] = en(Mp, tob); P[iC + 6] = en(Mf, tal); P[iC + 8] = en(Mf, dedo);
  }
  // la mano sigue al antebrazo (sin los puntos de dedos, que en una pose inventada la quiebran)
  return { P, V: P.map((_, i) => i >= 17 && i <= 22 ? .05 : .99) };
}
const pesar = m => m.pPesar || (m.pPesar = pesarModelo(m));
const poseActual = () => POSES[galeria.elegida === 'auto' ? galeria.i : POSES.findIndex(p => p.id === galeria.elegida)] || POSES[0];
function entrarModo1(on) {
  galeria.modo1 = on; indicesEspejo(on); espejo.bis = {};
  for (const q of HU.uVis.value) q.set(1, 1, 1, 1);
  if (!on) { for (const m of uS) m.identity(); HU.uModo.value = 0; HU.uJog.value = 0; }
}
// activo: hay que mostrar poses (holograma, hombre, sin espejo). Si no, vuelve al reposo y suelta el esqueleto.
function galeriaPaso(dt, ts, activo) {
  const G = galeria;
  G.t += dt;
  if (G.elegida === 'auto' && G.t > (POSES[G.i].trote ? 9 : 6)) { G.i = (G.i + 1) % POSES.length; G.t = 0; pintarPoses(); }
  const meta = activo ? poseActual() : REPOSO_P, metaT = !!meta.trote;
  if (metaT || !activo) {
    if (G.modo1) {   // primero vuelve al reposo con el esqueleto fino; ahí el cambio de esqueleto no se nota
      posarGaleria(REPOSO_P, dt, ts, 4);
      if (ANG.every(k => G.ang[k].every(x => Math.abs(x) < 1.5))) entrarModo1(false);
      return;
    }
    HU.uModo.value = 0; const k = metaT ? 1 : 0;
    HU.uJog.value += (k - HU.uJog.value) * Math.min(1, dt * 3); if (HU.uJog.value < .002) HU.uJog.value = 0;
    HU.uPuno.value = HU.uJog.value; HU.uPh.value = (HU.uPh.value + dt * 1.42) % 1; poseTrote(HU.uPh.value, HU.uJog.value);
    return;
  }
  if (!G.modo1) {   // del trote a una pose: el trote se apaga y la pose parte del reposo
    if (HU.uJog.value > .01) { HU.uModo.value = 0; HU.uJog.value += -HU.uJog.value * Math.min(1, dt * 4); HU.uPuno.value = HU.uJog.value; HU.uPh.value = (HU.uPh.value + dt * 1.42) % 1; poseTrote(HU.uPh.value, HU.uJog.value); return; }
    entrarModo1(true); G.ang = angulos(REPOSO_P);
  }
  posarGaleria(meta, dt, ts, 2.2);
}
function posarGaleria(meta, dt, ts, vel) {
  const G = galeria, obj = angulos(meta), u = Math.min(1, dt * vel);
  if (!G.ang) G.ang = angulos(REPOSO_P);
  for (const k of ANG) G.ang[k] = G.ang[k].map((x, i) => x + (obj[k][i] - x) * u);
  // parpadeo cada 2–6 s
  G.tParp -= dt; if (G.tParp < 0) { G.parp = 1; G.tParp = 2 + Math.random() * 4; }
  G.parp = Math.max(0, G.parp - dt * 7);
  const { P, V } = puntosPose(G.ang, ts);
  const guard = { puntos: espejo.puntos, vis: espejo.vis, mano: espejo.mano, rostro: espejo.rostro, gestos: espejo.gestos, mirada: espejo.mirada };
  const b = Math.sin(G.parp * Math.PI);
  Object.assign(espejo, { puntos: P, vis: V, mano: null, rostro: null, gestos: null, mirada: { yaw: Math.sin(ts * .4) * .08, pitch: 0, parp: [b, b] } });
  HU.uModo.value = 1; HU.uJog.value = 1; HU.uPuno.value = 0;
  posarEspejo();
  Object.assign(espejo, guard);
}
// barra de poses (abajo, en el holograma)
function pintarPoses() {
  const g = $('gem'); if (!g) return;
  let b = $('gPoses');
  const ver = vista === 'gemelo' && sexo === 'hombre' && !espejo.on && estilo !== 'anatomia';
  if (!ver) { if (b) b.hidden = true; return; }
  if (!b) { b = document.createElement('div'); b.id = 'gPoses'; g.appendChild(b); }
  b.hidden = false;
  const act = poseActual().id, html = `<b>POSE</b><button data-gpose="auto" class="${galeria.elegida === 'auto' ? 'on' : ''}">Auto</button><i></i>`
    + POSES.map(p => `<button data-gpose="${p.id}" class="${p.id === act ? (galeria.elegida === 'auto' ? 'vivo' : 'on') : ''}">${p.n}</button>`).join('');
  if (b.innerHTML !== html) b.innerHTML = html;
}
/* espejo: el gemelo imita la postura de quien está frente a las cámaras.
   · Cada cámara (este computador y los teléfonos que abran camara.html) corre MediaPipe Pose en su propio equipo y
     entrega 33 puntos de mundo en metros. Nunca viaja la imagen.
   · Fusión: la orientación de cada cámara se estima sola, alineando su esqueleto con el de la cámara de referencia
     (método de Horn con cuaterniones, promediado en el tiempo); luego cada punto se combina pesando la confianza de
     cada vista y su eje de profundidad (MediaPipe estima peor la profundidad que lo que ve de frente, así que una
     cámara de lado corrige la profundidad de la de frente). Con más cámaras, el cuerpo sale más fiel.
   · Esqueleto de 16 huesos (pelvis, abdomen, tórax, cabeza, y en cada lado muslo, pierna, pie, brazo, antebrazo y
     mano). Cada vértice del cuerpo se ata a sus 3 huesos más cercanos por distancia a la cápsula de cada hueso
     normalizada por su grosor (así la piel del muslo no se va con la mano). Las estructuras chicas (huesos de la mano,
     rótula) van rígidas a un solo hueso.
   · Codos y rodillas son bisagras: el eje sale del plano que forman sus dos segmentos, así el brazo no se tuerce. La
     mano y el pie toman su giro propio de los puntos de dedos y talón. Un filtro One Euro quita el temblor.
   · Es un espejo: si levantas la mano derecha, el gemelo levanta la que ves a tu derecha. */
const espejo = { on: false, video: null, pose: null, cargando: false, tUlt: -1, puntos: null, vis: null, filtros: [], camaras: new Map(), fuente: null, ref: '', bis: {}, panelT: 0 };
const IDX = { nariz: 0, oreI: 7, oreD: 8, homI: 11, homD: 12, codI: 13, codD: 14, munI: 15, munD: 16, menI: 17, menD: 18, indI: 19, indD: 20,
  cadI: 23, cadD: 24, rodI: 25, rodD: 26, tobI: 27, tobD: 28, talI: 29, talD: 30, pieI: 31, pieD: 32 };
const PIV = { cha: [0, 1.24, -.045], mun: [.247, .89, .005], pun: [.266, .799, .0375], tal: [.073, .012, -.07], dedo: [.09, .015, .17], mand: [0, 1.575, 0] };
// falanges de la mano izquierda medidas en el modelo (extremos de su eje principal); la derecha es el reflejo en x.
// [punto MediaPipe Hands de la base, punto de la punta, base en reposo, punta en reposo]
const DEDOS = [
  [1, 2, [.2756, .8721, .0279], [.3059, .8422, .0495]], [2, 3, [.3043, .8427, .0482], [.3149, .8164, .0612]], [3, 4, [.3129, .8184, .0613], [.3227, .7982, .0719]],
  [5, 6, [.287, .7996, .0384], [.2988, .7653, .0548]], [6, 7, [.2985, .7668, .0534], [.3055, .7507, .0718]], [7, 8, [.3056, .7521, .0712], [.3083, .741, .0864]],
  [9, 10, [.2661, .8008, .0387], [.2723, .7632, .0622]], [10, 11, [.2725, .7644, .0604], [.2758, .7413, .0799]], [11, 12, [.2761, .7424, .0796], [.2771, .7329, .0951]],
  [13, 14, [.2474, .8053, .0392], [.2484, .769, .0602]], [14, 15, [.2483, .7701, .0595], [.2495, .7486, .0799]], [15, 16, [.2488, .7502, .0798], [.2504, .7441, .0942]],
  [17, 18, [.231, .812, .0417], [.226, .7823, .0579]], [18, 19, [.2258, .7838, .0577], [.2226, .7662, .071]], [19, 20, [.2234, .7663, .0695], [.2217, .756, .0821]]];
const MC2 = [.2871, .7979, .038], MC5 = [.2304, .8104, .0397];
// ojos y párpados superiores: cada globo gira con tu mirada y el párpado baja al parpadear (lado 1 = +x del gemelo = tu ojo derecho)
const B_DEDO = s => s > 0 ? 16 : 31, B_MAND = 46, B_OJO = s => s > 0 ? 47 : 48, B_PARP = s => s > 0 ? 49 : 50, NB = SEGS;
const OJO = { 1: [.032, 1.625, .07], [-1]: [-.032, 1.625, .07] };   // centro de cada globo; se mide en el modelo al armarlo
const PADRE = [-1, 0, 13, 0, 3, 4, 0, 6, 7, 13, 9, 13, 11, 1, 10, 12];
for (const [s, h] of [[1, 14], [-1, 15]]) for (let j = 0; j < 15; j++) PADRE[B_DEDO(s) + j] = j % 3 === 0 ? h : B_DEDO(s) + j - 1;
PADRE[B_MAND] = 2; for (const s of [1, -1]) PADRE[B_OJO(s)] = PADRE[B_PARP(s)] = 2;
const DESC = PADRE.map((_, i) => { const l = [], pila = [i]; while (pila.length) { const b = pila.pop(); PADRE.forEach((q, j) => { if (q === b) { l.push(j); pila.push(j); } }); } return l; });
// a qué cadena pertenece cada hueso: tronco, brazo izquierdo/derecho, pierna izquierda/derecha
const CADENA = Array.from({ length: NB }, (_, i) => [9, 10, 14].includes(i) || (i >= 16 && i < 31) ? 'bI' : [11, 12, 15].includes(i) || (i >= 31 && i < 46) ? 'bD' : [3, 4, 5].includes(i) ? 'pI' : [6, 7, 8].includes(i) ? 'pD' : 't');
function indicesEspejo(on) { const m = modelos.hombre; if (!m || !m.pesado) return; for (const x of m.mallas) { const u = x.geometry.userData; if (u.idxEspejo) x.geometry.setIndex(on ? u.idxEspejo : u.idxReposo); } }
const ALINEAR = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
class UnoEuro {   // Casiez, Roussel y Vogel 2012: corte bajo en reposo, alto al moverse
  constructor(fc = 1.6, beta = 1.5, dc = 1) { this.fc = fc; this.beta = beta; this.dc = dc; this.x = null; this.dx = 0; }
  paso(x, dt) {
    if (this.x == null) { this.x = x; return x; }
    const a = c => 1 / (1 + 1 / (2 * Math.PI * c * dt));
    const dx = (x - this.x) / dt; this.dx += a(this.dc) * (dx - this.dx);
    this.x += a(this.fc + this.beta * Math.abs(this.dx)) * (x - this.x); return this.x;
  }
}

/* ── huesos y pesos de la piel ── */
// [pivote, cápsula a, cápsula b, grosor, lado (1 izq, -1 der, 0 centro), tipo]
function huesosEspejo() {
  const H = [];
  H[0] = [J.pel, [0, .86, -.02], J.cin, .17, 0, 't'];
  H[1] = [J.cin, J.cin, PIV.cha, .155, 0, 't'];
  H[13] = [PIV.cha, PIV.cha, [0, 1.45, -.04], .165, 0, 't'];
  H[2] = [J.cue, [0, 1.47, -.03], [0, 1.72, -.01], .1, 0, 'c'];
  for (const [s, b, a, h] of [[1, 3, 9, 14], [-1, 6, 11, 15]]) {
    H[b] = [lad(J.cad, s), lad(J.cad, s), lad(J.rod, s), .085, s, 'p'];
    H[b + 1] = [lad(J.rod, s), lad(J.rod, s), lad(J.tob, s), .06, s, 'p'];
    H[b + 2] = [lad(J.tob, s), lad([.07, .04, -.05], s), lad([.09, .02, .15], s), .05, s, 'p'];
    H[a] = [lad(J.hom, s), lad(J.hom, s), lad(J.cod, s), .055, s, 'b'];
    H[a + 1] = [lad(J.cod, s), lad(J.cod, s), lad(PIV.mun, s), .042, s, 'b'];
    H[h] = [lad(PIV.mun, s), lad(PIV.mun, s), lad(PIV.pun, s), .03, s, 'm'];
    DEDOS.forEach((d, j) => { H[B_DEDO(s) + j] = [lad(d[2], s), lad(d[2], s), lad(d[3], s), j < 1 ? .014 : .011, s, 'f']; });
  }
  H[B_MAND] = [PIV.mand, PIV.mand, [0, 1.52, .06], .03, 0, 'j'];
  for (const s of [1, -1]) H[B_OJO(s)] = H[B_PARP(s)] = [OJO[s], OJO[s], OJO[s], .013, s, 'o'];
  return H;
}
function distCapsula(x, y, z, h) {
  const a = h[1], b = h[2], ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
  let t = ((x - a[0]) * ax + (y - a[1]) * ay + (z - a[2]) * az) / (ax * ax + ay * ay + az * az); t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = x - a[0] - t * ax, dy = y - a[1] - t * ay, dz = z - a[2] - t * az;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / h[3];
}
function permitido(h, x, y) {   // un brazo no toma el centro del tronco, una pierna no sube al tórax, cada lado es suyo
  const ax = Math.abs(x);
  if (h[4] && h[4] * x < -.02) return false;
  // por fuera de la cadera y el tronco (|x| > 20,5 cm, entre la mano y el hombro) solo hay brazo: la piel del brazo
  // nunca se ata a la pelvis ni al muslo (eso dejaba láminas colgando del antebrazo)
  if (ax > .205 && y > .7 && y < 1.42 && !'bmf'.includes(h[5])) return false;
  if (h[5] === 'b' && ax < .12) return false;
  if (h[5] === 'm' && ax < .2) return false;
  if (h[5] === 'p' && y > 1.0) return false;
  if (h[5] === 't' && y > 1.5) return false;    // la cara y los dientes van con la cabeza, nunca con el tórax
  if (h[5] === 'c' && y < 1.4) return false;
  if (h[5] === 'f' && (ax < .2 || y > .875)) return false;
  if (h[5] === 'j' || h[5] === 'o') return false;   // la mandíbula, los ojos y los párpados se atan por nombre
  return true;
}
const OJO_RE = /^(left|right) (cornea|iris|lens|sclera|choroid|vitreous body)$|^anterior chamber of (left|right) eyeball$|^optic part of (left|right) retina$|^suspensory ligament of (left|right) lens$/i;
// rigido: qué piezas chicas van enteras a un solo hueso (solo huesos: si un vaso o un músculo chico va rígido, al doblar
// una articulación se separa de su vecino). k: qué tan rápido pasa la piel de un hueso al siguiente. cadena: ver abajo.
const PESO = { k: 8, kPiel: 5, kPierna: 4, kHombro: 4, cadena: .6, rigido: p => p.system === 'skeletal' };
async function pesarModelo(m) {
  if (m.pesado === 6) return;
  // el centro de cada globo ocular sale de su esclera (antes de armar los huesos, que lo usan de pivote)
  for (const malla of m.mallas) if (/^(left|right) sclera$/i.test(malla.userData.p.name)) {
    const c = malla.geometry.boundingBox.getCenter(new THREE.Vector3()); OJO[c.x > 0 ? 1 : -1] = [c.x, c.y, c.z]; }
  const H = huesosEspejo(), N = H.length, dn = new Float32Array(N);
  // un vértice se mezcla solo entre su hueso más cercano y los vecinos de ese hueso en la cadena (padre e hijos):
  // así la piel del antebrazo no queda atada a la cadera ni la del brazo al abdomen, que era lo que dejaba
  // «cortinas» colgando al levantar el brazo. La caída es abrupta: fuera de la articulación, un solo hueso manda.
  const vecinos = PADRE.map((_, i) => new Set([i, PADRE[i], ...PADRE.map((q, j) => q === i ? j : -1)].filter(j => j >= 0)));
  let esPiel = false;
  const top3 = (x, y, z, bi, bw, o, solo) => {
    let mn = Infinity, b0 = 0;
    for (let i = 0; i < N; i++) { dn[i] = (!solo || solo.has(i)) && permitido(H[i], x, y) ? distCapsula(x, y, z, H[i]) : Infinity; if (dn[i] < mn) { mn = dn[i]; b0 = i; } }
    if (mn === Infinity) for (let i = 0; i < N; i++) { dn[i] = permitido(H[i], x, y) ? distCapsula(x, y, z, H[i]) : Infinity; if (dn[i] < mn) { mn = dn[i]; b0 = i; } }
    const vec = vecinos[b0];
    let i1 = b0, i2 = b0, i3 = b0, w1 = 1, w2 = 0, w3 = 0;
    const brazo0 = CADENA[b0][0] === 'b';
    for (const i of vec) { if (i === b0) continue;
      // en la piel, el brazo y el tronco se mezclan solo en el hombro: más abajo, la cara interna del brazo quedaba medio
      // atada al pecho y al levantar el brazo se desgarraba en picos
      const hombro = esPiel && brazo0 !== (CADENA[i][0] === 'b') ? Math.min(1, Math.max(0, (y - 1.22) / .12)) : 1;   // de nada a todo entre 1,22 y 1,34 m
      if (!hombro) continue;
      const w = Math.exp(-(!esPiel ? PESO.k : 'tp'.includes(CADENA[i][0]) && 'tp'.includes(CADENA[b0][0]) && (CADENA[i][0] === 'p' || CADENA[b0][0] === 'p') ? PESO.kPierna : brazo0 !== (CADENA[i][0] === 'b') ? PESO.kHombro : PESO.kPiel) * (dn[i] - mn)) * hombro; if (w < .03) continue;
      if (w > w2) { i3 = i2; w3 = w2; i2 = i; w2 = w; } else if (w > w3) { i3 = i; w3 = w; } }
    const t = w1 + w2 + w3; bi[o] = i1; bi[o + 1] = i2; bi[o + 2] = i3; bw[o] = w1 / t; bw[o + 1] = w2 / t; bw[o + 2] = w3 / t;
  };
  const deCadena = f => new Set(CADENA.map((c, i) => f(c) ? i : -1).filter(i => i >= 0));
  const BRAZO = { 1: deCadena(c => c === 'bI'), [-1]: deCadena(c => c === 'bD') }, NO_BRAZO = deCadena(c => c[0] !== 'b');
  const EJE_BRAZO = { 1: [9, 10, 14], [-1]: [11, 12, 15] };
  let k = 0;
  for (const malla of m.mallas) {
    const g = malla.geometry, a = g.attributes.position, n = a.count, bi = new Float32Array(n * 4), bw = new Float32Array(n * 4);
    const bb = g.boundingBox;
    const nom = malla.userData.p.name;
    let aleta = null; esPiel = malla.userData.capa === 'piel';
    if (/mandible|lower jaw|^(left|right) lower .*tooth$/i.test(nom)) { for (let i = 0; i < n; i++) { bi[i * 4] = B_MAND; bw[i * 4] = 1; } }
    else if (OJO_RE.test(nom) || /upper eyelid/i.test(nom)) {   // globo ocular entero (esclera, córnea, iris, cristalino…) o párpado superior
      const s = bb.getCenter(_v3).x > 0 ? 1 : -1, b = /upper eyelid/i.test(nom) ? B_PARP(s) : B_OJO(s);
      for (let i = 0; i < n; i++) { bi[i * 4] = b; bw[i * 4] = 1; }
    }
    else if (PESO.rigido(malla.userData.p) && bb.max.distanceTo(bb.min) < .1 && !(Math.abs(bb.getCenter(_v3).x) > .2 && bb.max.y < .875)) {          // estructura chica: rígida al hueso de su centro
      const c = bb.getCenter(new THREE.Vector3()), t = [0, 0, 0, 0], u = [0, 0, 0, 0]; top3(c.x, c.y, c.z, t, u, 0);
      for (let i = 0; i < n; i++) { bi[i * 4] = t[0]; bw[i * 4] = 1; }
    } else if (malla.userData.capa === 'piel') {
      // la piel entre el brazo y el tronco (bajo la axila) se decide por hacia dónde mira: la cara interna del brazo mira
      // al tronco y va solo con el brazo; el costado del tronco mira hacia afuera y nunca va con el brazo. Por distancia
      // sola, la cara interna del brazo quedaba atada al tronco y al levantar el brazo colgaba como una lámina
      const nr = g.attributes.normal; aleta = g.userData.aleta = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const x = a.getX(i), y = a.getY(i), z = a.getZ(i), ax = Math.abs(x), s = x > 0 ? 1 : -1, nx = nr.getX(i) * s;
        let solo, d = 1;
        if (y > .72 && y < 1.34 && ax > .12 && ax < .27) d = Math.min(...EJE_BRAZO[s].map(b => distCapsula(x, y, z, H[b]) * H[b][3]));   // metros al eje del brazo
        if (y > .72 && y < 1.24 && ax > .12 && ax < .27) solo = nx < -.25 && d < .065 ? BRAZO[s] : nx > .25 && d > .055 ? NO_BRAZO : undefined;
        top3(x, y, z, bi, bw, i * 4, solo);
        // aleta: la membrana que en reposo une la axila y el costado con el brazo. Va con el tronco, y al abrir el brazo
        // queda sobresaliendo como una lámina; en las poses no se dibuja
        if (y > .98 && y < 1.34 && ax > .15 && d < .09 && CADENA[bi[i * 4]][0] !== 'b') aleta[i] = Math.abs(nr.getX(i)) < .7 ? 1 : 2;
      }
      // las candidatas que miran de lado solo son aleta si tienen una cara opuesta a menos de 1 cm (lámina doble)
      const celda = .01, hash = new Map(), clave = (x, y, z) => `${Math.floor(x / celda)},${Math.floor(y / celda)},${Math.floor(z / celda)}`;
      for (let i = 0; i < n; i++) if (aleta[i] || (a.getY(i) > .86 && a.getY(i) < 1.36 && Math.abs(a.getX(i)) > .14 && Math.abs(a.getX(i)) < .3)) {
        const k = clave(a.getX(i), a.getY(i), a.getZ(i)); (hash.get(k) || hash.set(k, []).get(k)).push(i); }
      for (let i = 0; i < n; i++) if (aleta[i] === 2) {
        const x = a.getX(i), y = a.getY(i), z = a.getZ(i), cx = Math.floor(x / celda), cy = Math.floor(y / celda), cz = Math.floor(z / celda); let doble = false;
        for (let u = -1; u <= 1 && !doble; u++) for (let v = -1; v <= 1 && !doble; v++) for (let w = -1; w <= 1 && !doble; w++) for (const j of hash.get(`${cx + u},${cy + v},${cz + w}`) || []) {
          if (Math.hypot(a.getX(j) - x, a.getY(j) - y, a.getZ(j) - z) < .01 && nr.getX(i) * nr.getX(j) + nr.getY(i) * nr.getY(j) + nr.getZ(i) * nr.getZ(j) < -.3) { doble = true; break; } }
        aleta[i] = doble ? 1 : 0;
      }
    } else {
      for (let i = 0; i < n; i++) top3(a.getX(i), a.getY(i), a.getZ(i), bi, bw, i * 4);
      // una pieza que es casi toda de un brazo o una pierna (vaso, nervio, músculo) se queda en esa cadena y en su raíz:
      // así una vena del codo no se ata a la pelvis ni un músculo del muslo al tórax, y no se despega al moverse
      if (PESO.cadena && malla.userData.capa !== 'piel') {
        const cuenta = {}; for (let i = 0; i < n; i++) { const c = CADENA[bi[i * 4]]; cuenta[c] = (cuenta[c] || 0) + 1; }
        const [cad, nc] = Object.entries(cuenta).sort((x, y) => y[1] - x[1])[0];
        if (cad !== 't' && nc / n >= PESO.cadena && nc < n) {
          const solo = new Set(CADENA.map((c, i) => c === cad ? i : -1).filter(i => i >= 0)); solo.add(cad[0] === 'b' ? 13 : 0);
          for (let i = 0; i < n; i++) top3(a.getX(i), a.getY(i), a.getZ(i), bi, bw, i * 4, solo);
        }
      }
    }
    g.setAttribute('aBi', new THREE.BufferAttribute(bi, 4)); g.setAttribute('aBw', new THREE.BufferAttribute(bw, 4));
    // lo que se mueve con los gestos: la piel, los labios, las cejas y los cartílagos de la nariz
    g.setAttribute('aCara', new THREE.BufferAttribute(new Float32Array(n).fill(/^(skin|lip|eyebrow)$|nasal cartilage/i.test(nom) ? 1 : 0), 1));
    // la piel de referencia es una sola superficie que en reposo une el brazo con la cadera y un muslo con el otro;
    // para el espejo se quitan esos triángulos puente (si no, al abrir los brazos se estiran como alas)
    const cad = i => CADENA[bi[i * 4]], ix = (g.userData.idxReposo || g.index).array, quedan = [];
    for (let t = 0; t < ix.length; t += 3) {
      const A = ix[t], B = ix[t + 1], C = ix[t + 2], ca = cad(A), cb = cad(B), cc = cad(C);
      if (aleta && (aleta[A] || aleta[B] || aleta[C])) continue;
      if (ca !== cb || cb !== cc) {
        const yMax = Math.max(a.getY(A), a.getY(B), a.getY(C)), set = new Set([ca, cb, cc]);
        const brazo = set.has('bI') || set.has('bD'), otro = set.has('t') || set.has('pI') || set.has('pD');
        if ((brazo && otro && yMax < 1.31) || (set.has('pI') && set.has('pD')) || (brazo && (set.has('pI') || set.has('pD')))) continue;
      }
      quedan.push(A, B, C);
    }
    if (aleta && quedan.length < ix.length) g.userData.tapas = taparHoyos(ix, quedan, cad);
    g.userData.idxReposo = g.userData.idxReposo || g.index; g.userData.idxEspejo = quedan.length === ix.length ? g.userData.idxReposo : new THREE.BufferAttribute(new Uint32Array(quedan), 1);
    if (++k % 80 === 0) { avisoCarga(`Rigging the twin · ${Math.round(k / m.mallas.length * 100)}%`); await new Promise(r => setTimeout(r)); }
  }
  m.pesado = 6; avisoCarga('');
}

// Al quitar la aleta y los puentes, la piel de referencia queda abierta bajo la axila (ahí nunca tuvo costado: el
// tronco seguía directo al brazo). Cada hoyo nuevo se cierra con un abanico desde uno de sus bordes, siempre que todo
// su borde sea de una sola cadena (tronco, un brazo o una pierna) para que la tapa se mueva entera con ella.
function taparHoyos(ix, quedan, cad) {
  const bordes = l => { const c = new Map(); for (let t = 0; t < l.length; t += 3) for (let j = 0; j < 3; j++) {
    const u = l[t + j], v = l[t + (j + 1) % 3], k = u < v ? u + ',' + v : v + ',' + u; c.set(k, (c.get(k) || 0) + 1); } return c; };
  const antes = bordes(ix), ahora = bordes(quedan), sig = new Map();
  for (let t = 0; t < quedan.length; t += 3) for (let j = 0; j < 3; j++) {
    const u = quedan[t + j], v = quedan[t + (j + 1) % 3], k = u < v ? u + ',' + v : v + ',' + u;
    if (ahora.get(k) === 1 && antes.get(k) !== 1) (sig.get(v) || sig.set(v, []).get(v)).push(u);   // borde nuevo, recorrido al revés
  }
  let tapas = 0;
  while (sig.size) {
    const v0 = sig.keys().next().value, lazo = [v0]; let v = v0;
    for (let paso = 0; paso < 4000; paso++) {
      const l = sig.get(v); if (!l || !l.length) break; const w = l.pop(); if (!l.length) sig.delete(v);
      if (w === v0) break; lazo.push(w); v = w;
    }
    if (lazo.length < 3) continue;
    // la axila abierta es un solo borde que baja por el costado del tronco y sube por el brazo: se tapa cada tramo aparte
    const c0 = lazo.findIndex((x, i) => cad(x) !== cad(lazo[(i + lazo.length - 1) % lazo.length]));
    const giro = c0 > 0 ? [...lazo.slice(c0), ...lazo.slice(0, c0)] : lazo, tramos = [[giro[0]]];
    for (let i = 1; i < giro.length; i++) { if (cad(giro[i]) === cad(giro[i - 1])) tramos[tramos.length - 1].push(giro[i]); else tramos.push([giro[i]]); }
    for (const tr of tramos) { if (tr.length < 3) continue; for (let i = 1; i < tr.length - 1; i++) quedan.push(tr[0], tr[i], tr[i + 1]); tapas++; }
  }
  return tapas;
}

/* ── cámaras ── */
async function prenderEspejo() {
  if (espejo.on || espejo.cargando) return;
  if (sexo !== 'hombre') { const i = CREW.findIndex(c => c.ella !== 'her'); if (i >= 0) await ponerPersona(i); }
  espejo.cargando = true; marcarEspejo('Preparing…');
  try {
    await pesar(modelos.hombre);
    marcarEspejo('Starting camera…');
    if (!espejo.pose) {
      const { FilesetResolver, PoseLandmarker } = await import('./lib/mediapipe/vision_bundle.mjs');
      const fs = await FilesetResolver.forVisionTasks('lib/mediapipe/wasm');
      for (const delegate of ['GPU', 'CPU']) {
        try { espejo.pose = await PoseLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: 'lib/mediapipe/modelos/pose_landmarker_full.task', delegate }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: .5, minTrackingConfidence: .5, outputSegmentationMasks: true }); break; }
        catch (e) { if (delegate === 'CPU') throw e; }
      }
      // manos (21 puntos cada una) y cara (478 puntos + 52 gestos): mismo cuadro, todo en este computador
      const { HandLandmarker, FaceLandmarker } = await import('./lib/mediapipe/vision_bundle.mjs');
      try { espejo.manos = await HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: 'lib/mediapipe/modelos/hand_landmarker.task', delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: .5, minTrackingConfidence: .5 }); } catch (e) { console.warn('[espejo] manos', e); }
      try { espejo.cara = await FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: 'lib/mediapipe/modelos/face_landmarker.task', delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true }); } catch (e) { console.warn('[espejo] cara', e); }
    }
    // la cámara de este computador es opcional: si no hay, el espejo funciona solo con teléfonos
    try {
      const v = espejo.video || document.createElement('video');
      v.muted = true; v.playsInline = true;
      v.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
      await v.play();
      v.className = 'gEspejoCam';
      v.style.cssText = ESTILO_MINI;
      cajaEl.appendChild(v); espejo.video = v;
    } catch (e) { console.warn('[espejo] sin cámara local', e); espejo.video = null; }
    espejo.fuente = new EventSource('/v1/espejo/flujo');
    espejo.fuente.onmessage = ev => {
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      if (!d.w || d.w.length !== 33) { espejo.camaras.delete(d.cam); return; }
      const c = espejo.camaras.get(d.cam) || { id: d.cam, q: new THREE.Quaternion(), n: 0, err: null };
      Object.assign(c, { nombre: d.nombre, w: d.w, t: Date.now() }); espejo.camaras.set(d.cam, c);
    };
    espejo.filtros = Array.from({ length: 33 * 3 }, () => new UnoEuro()); espejo.puntos = null; espejo.tUlt = -1; espejo.bis = {};
    indicesEspejo(true); galeria.modo1 = false; galeria.ang = null;
    if (espejo.encuadrar == null) espejo.encuadrar = true;
    espejo.on = true; ctrl.autoRotate = false; sel = null; estilo = 'halo'; marcarCapas(); firmaMat = ''; aplicarMateriales(); pintarPanel();
    vuelo = { t: 0, de: [cam.position.clone(), ctrl.target.clone()], a: [new THREE.Vector3(0, .95, 4.3), new THREE.Vector3(0, .9, 0)] };
    panelCamaras(true);
    marcarEspejo('');
  } catch (e) {
    console.warn('[espejo]', e); marcarEspejo('Camera not available');
    setTimeout(() => marcarEspejo(''), 3000);
  } finally { espejo.cargando = false; }
}
function apagarEspejo() {
  if (camVista.on) { camVista.on = false; barraMezcla(false); $('gem').classList.remove('camara'); $('gCamara')?.classList.remove('on'); espejo.encuadrado = true; }
  if (espejo.encuadrado) soltarEncuadre();
  espejo.on = false; espejo.puntos = null; espejo.enc = null;
  const v = espejo.video; if (v) { (v.srcObject && v.srcObject.getTracks() || []).forEach(t => t.stop()); v.srcObject = null; v.remove(); }
  espejo.video = null;
  if (espejo.fuente) { espejo.fuente.close(); espejo.fuente = null; }
  espejo.camaras.clear(); espejo.ref = '';
  const p = $('gCams'); if (p) p.remove();
  for (const m of uS) m.identity();
  indicesEspejo(false); galeria.modo1 = false; galeria.ang = null; HU.uJog.value = 0; HU.uModo.value = 0;
  espejo.mano = espejo.rostro = espejo.gestos = espejo.mirada = null;
  marcarEspejo(''); if (ctrl) ctrl.autoRotate = true;
}
function marcarEspejo(txt) {
  const b = $('gEspejo'); if (b) { b.classList.toggle('on', espejo.on); b.textContent = txt || (espejo.on ? 'Stop mirroring' : 'Mirror me'); }
}
// lista de cámaras y enlace para sumar un teléfono
async function panelCamaras(armar) {
  let p = $('gCams');
  if (!p) {
    if (!armar) return;
    p = document.createElement('div'); p.id = 'gCams';
    p.style.cssText = 'position:absolute;left:14px;top:172px;width:236px;padding:12px 14px;border-radius:12px;background:rgba(4,14,24,.72);border:1px solid rgba(143,230,245,.28);backdrop-filter:blur(6px);font:500 11px var(--mono,monospace);color:rgba(220,240,250,.75);letter-spacing:.04em;z-index:4';
    p.innerHTML = '<div style="color:#8fe6f5;letter-spacing:.08em">CAMERAS</div><div id="gCamLista"></div><button id="gCamEnc" style="margin-top:10px;width:100%;height:30px;border-radius:9px;border:1px solid rgba(143,230,245,.35);color:#dff6fb;font:500 12px var(--sans,system-ui)"></button><button id="gCamMas" style="margin-top:10px;width:100%;height:30px;border-radius:9px;border:1px solid rgba(143,230,245,.35);color:#dff6fb;font:500 12px var(--sans,system-ui)">+ Add a phone camera</button><div id="gCamQr" hidden style="margin-top:10px;text-align:center"></div>';
    cajaEl.appendChild(p);
  }
  const ahora = Date.now(), fila = (col, a, b) => `<div style="display:flex;gap:8px;align-items:baseline;margin-top:7px"><i style="width:7px;height:7px;border-radius:50%;background:${col};flex:none"></i><span style="flex:1;color:#eef8fb">${a}</span><span>${b}</span></div>`;
  const filas = [...espejo.camaras.values()].map(c => {
    const viva = ahora - c.t < 600, ref = c.id === espejo.ref;
    const est = !viva ? 'no person' : ref ? 'reference' : c.err == null ? 'aligning…' : `aligned · ${(c.err * 100).toFixed(1)} cm`;
    return fila(viva ? (ref || (c.err != null && c.err < .06) ? '#46c8e8' : '#f2b457') : '#5b6573', c.nombre || c.id, est);
  });
  if (!espejo.video) filas.unshift(fila('#5b6573', 'This computer', 'no camera'));
  const l = $('gCamLista'); if (l) l.innerHTML = filas.join('') || fila('#5b6573', 'No cameras yet', '');
  const be = $('gCamEnc'); if (be) be.textContent = espejo.encuadrar ? 'Framing: as the camera sees you' : 'Framing: free 3D view';
}
async function mostrarQr() {
  const q = $('gCamQr'); if (!q) return;
  if (!q.hidden) { q.hidden = true; return; }
  try {
    const v = await (await fetch('/v1/espejo/camaras')).json(), ip = (v.ips || [])[0];
    const u = ip ? `https://${ip}:${v.https}/camara.html` : `${location.origin}/camara.html`;
    const { default: qrcode } = await import('./lib/qrcode.mjs');
    const c = qrcode(0, 'M'); c.addData(u); c.make();
    q.innerHTML = `<div style="background:#fff;padding:8px;border-radius:8px;display:inline-block">${c.createImgTag(3, 0)}</div><div style="margin-top:6px;word-break:break-all;color:#dff6fb">${u}</div><div style="margin-top:4px">Scan with the phone, accept the ship's certificate and press Start camera. Put it to the side or diagonal for the best depth.</div>`;
    q.hidden = false;
  } catch (e) { q.textContent = 'Could not get the ship address'; q.hidden = false; }
}

/* ── fusión de vistas ── */
// MediaPipe inventa los puntos que quedan fuera de la imagen (los codos bajo el escritorio) y a veces con confianza alta:
// un punto fuera del cuadro cuenta como no visto
const dentro = p => p.x > .01 && p.x < .99 && p.y > .01 && p.y < .99;
const _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4(), _v3 = new THREE.Vector3();
function horn(A, B, W) {   // rotación que lleva los puntos A a B (Horn 1987), con pesos; devuelve [cuaternión, error rms]
  let sw = 0; const ca = new THREE.Vector3(), cb = new THREE.Vector3();
  for (let i = 0; i < A.length; i++) { ca.addScaledVector(A[i], W[i]); cb.addScaledVector(B[i], W[i]); sw += W[i]; }
  ca.multiplyScalar(1 / sw); cb.multiplyScalar(1 / sw);
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  for (let i = 0; i < A.length; i++) {
    const a = A[i].clone().sub(ca), b = B[i].clone().sub(cb), w = W[i];
    Sxx += w * a.x * b.x; Sxy += w * a.x * b.y; Sxz += w * a.x * b.z; Syx += w * a.y * b.x; Syy += w * a.y * b.y; Syz += w * a.y * b.z; Szx += w * a.z * b.x; Szy += w * a.z * b.y; Szz += w * a.z * b.z;
  }
  const Nm = [[Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx], [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy], [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz]];
  // autovector del mayor autovalor por potencias, con un corrimiento que deja la matriz definida positiva
  const c = Nm.flat().reduce((m, x) => m + Math.abs(x), 0);
  let x = [1, 0, 0, 0];
  for (let it = 0; it < 60; it++) {
    const y = Nm.map((r, i) => r[0] * x[0] + r[1] * x[1] + r[2] * x[2] + r[3] * x[3] + c * x[i]);
    const n = Math.hypot(...y); x = y.map(v => v / n);
  }
  const q = new THREE.Quaternion(x[1], x[2], x[3], x[0]).normalize();
  let e = 0; for (let i = 0; i < A.length; i++) e += W[i] * A[i].clone().sub(ca).applyQuaternion(q).add(cb).distanceToSquared(B[i]);
  return [q, Math.sqrt(e / sw)];
}
const v3 = p => new THREE.Vector3(p[0], p[1], p[2]);
function fusionar() {
  const ahora = Date.now(), vivas = [...espejo.camaras.values()].filter(c => ahora - c.t < 400);
  if (!vivas.length) return null;
  let ref = vivas.find(c => c.id === espejo.ref) || vivas.find(c => c.id === 'local') || vivas.slice().sort((a, b) => a.id < b.id ? -1 : 1)[0];
  if (ref.id !== espejo.ref) { espejo.ref = ref.id; for (const c of espejo.camaras.values()) { c.n = 0; c.err = null; } }
  ref.q.identity(); ref.err = 0;
  for (const c of vivas) {
    if (c === ref) continue;
    const A = [], B = [], W = [];
    for (const i of ALINEAR) { const w = Math.min(c.w[i][3], ref.w[i][3]); if (w > .6) { A.push(v3(c.w[i])); B.push(v3(ref.w[i])); W.push(w * w); } }
    if (A.length < 6) continue;
    const [q, e] = horn(A, B, W);
    // MediaPipe a veces confunde izquierda y derecha vista de espaldas: esos cuadros no se usan para orientar
    if (e < .12) { c.q.slerp(q, c.n < 20 ? .35 : .05); c.n++; c.err = c.err == null ? e : c.err * .9 + e * .1; }
  }
  // cada punto: promedio ponderado por la confianza, con la profundidad de cada cámara valiendo 9 veces menos
  const usar = vivas.filter(c => c === ref || c.n >= 5), P = [], V = [];
  const L = new THREE.Matrix3(), Lp = new THREE.Vector3(), d = new THREE.Vector3(), M = new THREE.Matrix3(), tmp = new THREE.Vector3();
  for (let i = 0; i < 33; i++) {
    L.set(0, 0, 0, 0, 0, 0, 0, 0, 0); Lp.set(0, 0, 0); let vmax = 0;
    for (const c of usar) {
      const vi = c.w[i][3]; if (vi < .2) continue; vmax = Math.max(vmax, vi);
      const p = v3(c.w[i]).applyQuaternion(c.q); d.set(0, 0, 1).applyQuaternion(c.q);
      const k = 1 - 1 / 9, w = vi * vi, e = M.elements;
      // Λ = w (I - k d dᵀ)
      const xx = w * (1 - k * d.x * d.x), yy = w * (1 - k * d.y * d.y), zz = w * (1 - k * d.z * d.z), xy = -w * k * d.x * d.y, xz = -w * k * d.x * d.z, yz = -w * k * d.y * d.z;
      M.set(xx, xy, xz, xy, yy, yz, xz, yz, zz);
      for (let j = 0; j < 9; j++) L.elements[j] += e[j];
      Lp.add(tmp.copy(p).applyMatrix3(M));
    }
    if (vmax === 0) { P.push(v3(ref.w[i])); V.push(ref.w[i][3]); continue; }
    P.push(Lp.clone().applyMatrix3(L.clone().invert())); V.push(vmax);
  }
  return { P, V, n: usar.length };
}
function actualizarEspejo(dt) {
  // la cámara local entra a la fusión como una cámara más
  const v = espejo.video;
  if (v && v.readyState >= 2 && v.currentTime !== espejo.tUlt) {
    espejo.tUlt = v.currentTime;
    const r = espejo.pose.detectForVideo(v, performance.now()), w = r.worldLandmarks && r.worldLandmarks[0], n = r.landmarks && r.landmarks[0];
    if (w && n) { const c = espejo.camaras.get('local') || { id: 'local', nombre: 'This computer', q: new THREE.Quaternion(), n: 0, err: null };
      c.w = w.map((p, i) => [p.x, p.y, p.z, dentro(n[i]) ? n[i].visibility ?? 1 : 0]); c.t = Date.now(); espejo.camaras.set('local', c); }
    espejo.n2d = n; leerManosCara(v, n, dt);
    const mk = r.segmentationMasks && r.segmentationMasks[0];
    if (mk) {   // silueta de la persona (0–1 por píxel) para recortar el gemelo y medir el calce
      if (camVista.on) {
        const w = mk.width, h = mk.height, d = mk.getAsFloat32Array(), cv = espejo.mascara || (espejo.mascara = document.createElement('canvas'));
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; espejo.mImg = cv.getContext('2d').createImageData(w, h); }
        const img = espejo.mImg.data; for (let i = 0; i < d.length; i++) { img[i * 4] = img[i * 4 + 1] = img[i * 4 + 2] = 255; img[i * 4 + 3] = d[i] * 255; }
        cv.getContext('2d').putImageData(espejo.mImg, 0, 0); espejo.tMascara = performance.now();
        espejo.mDatos = Float32Array.from(d); espejo.mW = w; espejo.mH = h;
      }
      mk.close && mk.close();
    }
  }
  if (performance.now() - espejo.panelT > 500) { espejo.panelT = performance.now(); panelCamaras(false); }
  const f = fusionar();
  if (!f) { espejo.puntos = null; return; }
  // al espacio del gemelo, reflejado (espejo): x, y y z cambian de signo
  const fl = espejo.filtros, d = Math.max(1 / 120, dt);
  espejo.puntos = f.P.map((p, i) => new THREE.Vector3(-fl[i * 3].paso(p.x, d), -fl[i * 3 + 1].paso(p.y, d), -fl[i * 3 + 2].paso(p.z, d)));
  espejo.vis = f.V; espejo.nCam = f.n;
}

/* ── manos y cara (cámara de este computador) ── */
// MediaPipe Hands da 21 puntos por mano; cada mano se asigna a la muñeca del cuerpo más cercana en la imagen (la etiqueta
// izquierda/derecha del modelo supone imagen reflejada, así que no se usa). La cara da 478 puntos y 52 gestos.
const filtrosMano = { D: [], I: [] };
const lim = (x, a = -1, b = 1) => Math.min(b, Math.max(a, x));
function leerManosCara(v, n, dt) {
  const t = performance.now(), d = Math.max(1 / 120, dt), W = v.videoWidth || 640, Hh = v.videoHeight || 480;
  const qLocal = (espejo.camaras.get('local') || {}).q || new THREE.Quaternion();
  // a coordenadas del gemelo: misma orientación que el cuerpo fusionado (cámara de referencia) y reflejado
  const aGemelo = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(qLocal).multiply(new THREE.Vector3(-1, -1, -1));
  espejo.mano = { D: null, I: null }; espejo.mano2d = { D: null, I: null };
  if (espejo.manos) {
    const r = espejo.manos.detectForVideo(v, t), et = r.handedness || r.handednesses || [];
    const hs = (r.landmarks || []).map((lm, j) => ({ lm, wl: r.worldLandmarks[j], et: et[j] && et[j][0] && et[j][0].categoryName })).filter(h => h.wl);
    // de quién es cada mano: la muñeca del cuerpo más cercana; si el cuerpo no ve sus muñecas, la etiqueta del modelo
    // (que supone imagen reflejada: «Left» es tu mano derecha); dos manos nunca van al mismo lado
    const lado = h => {
      if (n) { const dist = k => Math.hypot(h.lm[0].x - n[k].x, h.lm[0].y - n[k].y), dD = dist(16), dI = dist(15); if (Math.min(dD, dI) < .12) return dD < dI ? 'D' : 'I'; }
      return h.et === 'Left' ? 'D' : h.et === 'Right' ? 'I' : null;
    };
    let lados = hs.map(lado);
    if (hs.length === 2 && (lados[0] === lados[1] || !lados[0] || !lados[1])) lados = hs[0].lm[0].x < hs[1].lm[0].x ? ['D', 'I'] : ['I', 'D'];   // tu derecha cae a la izquierda de la imagen
    hs.forEach((h, j) => {
      const k = lados[j]; if (!k) return;
      const f = filtrosMano[k]; if (!f.length) for (let i = 0; i < 63; i++) f.push(new UnoEuro(2, 2));
      espejo.mano[k] = h.wl.map((p, i) => { const q = aGemelo(p.x, p.y, p.z); return new THREE.Vector3(f[i * 3].paso(q.x, d), f[i * 3 + 1].paso(q.y, d), f[i * 3 + 2].paso(q.z, d)); });
      espejo.mano2d[k] = h.lm;
    });
  }
  // la cara va un cuadro sí y otro no (la cabeza se mueve más lento que las manos); su lectura vale 300 ms
  espejo.nCuadro = (espejo.nCuadro || 0) + 1;
  if (espejo.rostro && t - espejo.rostro.t > 300) espejo.rostro = null;
  if (espejo.cara && (espejo.nCuadro % 2 === 0 || !espejo.rostro)) {
    const r = espejo.cara.detectForVideo(v, t), lm = r.faceLandmarks && r.faceLandmarks[0];
    if (!lm) espejo.rostro = null;
    else {
      const P = i => aGemelo((lm[i].x - .5) * W, (lm[i].y - .5) * Hh, lm[i].z * W);
      const g = {}; ((r.faceBlendshapes && r.faceBlendshapes[0] && r.faceBlendshapes[0].categories) || []).forEach(c => { g[c.categoryName] = c.score; });
      // eje izquierda del gemelo = tu ojo derecho (33) menos tu ojo izquierdo (263), por el espejo; arriba = frente (10) menos mentón (152)
      const X = P(33).sub(P(263)), Y = P(10).sub(P(152));
      espejo.rostro = { x: X, y: Y, boca: g.jawOpen || 0, t };
      leerOjos(P, X, Y, lm.length >= 478);
      leerGestos(g);
    }
  }
  if (!espejo.rostro && espejo.mirada) { const m = espejo.mirada; m.yaw *= .9; m.pitch *= .9; m.parp = m.parp.map(x => x * .8); }
  if (!espejo.rostro && espejo.gestos) for (const k in espejo.gestos) espejo.gestos[k] *= .85;
}
// los 52 gestos de la cara (cejas, mejillas, nariz, labios, mandíbula), suavizados. Qué lado es «Left» en los gestos se
// comprueba solo: se compara el guiño de cada gesto con el párpado que se ve cerrar en los puntos de la cara.
function leerGestos(g) {
  const G = espejo.gestos || (espejo.gestos = {});
  for (const k in g) G[k] = G[k] == null ? g[k] : G[k] + (g[k] - G[k]) * .55;
  const m = espejo.mirada;
  if (m) espejo.ladoBS = (espejo.ladoBS || 0) * .995 + ((g.eyeBlinkRight || 0) - (g.eyeBlinkLeft || 0)) * (m.parp[0] - m.parp[1]);
}
/* zonas de la cara del gemelo (metros, en reposo; +x es el lado izquierdo del gemelo = tu lado derecho): cejas, párpados,
   mejillas, aletas de la nariz, comisuras, labios y mentón. Cada una se mueve como el músculo que la tira: la sonrisa
   sube y abre las comisuras y levanta la mejilla, el ceño baja y junta las cejas, el beso adelanta y cierra los labios. */
const EXAG = 1.35;   // un poco más marcado que en la vida real, para que se lea en el holograma
function gestosCara() {
  const G = espejo.gestos || {}, mir = espejo.mirada || { parp: [0, 0] }, zonas = [];
  // s = +1: tu lado derecho. Por defecto los nombres siguen la convención de ARKit (Right = tu derecha)
  const suf = s => (s > 0) === ((espejo.ladoBS || 0) >= 0) ? 'Right' : 'Left', g = (k, s) => G[s == null ? k : k + suf(s)] || 0;
  const mshift = .006 * (g('mouth', 1) - g('mouth', -1));
  const puck = g('mouthPucker'), fun = g('mouthFunnel'), cs = g('cheekPuff');
  const z = (c, r, d) => zonas.push([c, r, d]);
  for (const s of [1, -1]) {
    const j = s > 0 ? 0 : 1, bd = g('browDown', s), smile = g('mouthSmile', s);
    z([s * .016, 1.620, .080], .011, [-s * .0025 * bd, .0055 * g('browInnerUp') - .004 * bd, .001 * g('browInnerUp')]);
    z([s * .044, 1.619, .070], .012, [0, .006 * g('browOuterUp', s) - .003 * bd, 0]);
    z([s * .030, 1.603, .067], .008, [0, -.006 * (mir.parp[j] || 0) + .0025 * g('eyeWide', s), 0]);
    z([s * .030, 1.588, .064], .008, [0, .003 * g('eyeSquint', s) + .002 * g('cheekSquint', s), 0]);
    z([s * .042, 1.563, .074], .016, [s * .005 * cs, .004 * g('cheekSquint', s) + .003 * smile, .0025 * smile + .008 * cs]);
    z([s * .013, 1.565, .096], .008, [s * .001 * g('noseSneer', s), .003 * g('noseSneer', s), 0]);
    z([s * .026, 1.535, .082], .011, [mshift + s * (.005 * smile + .006 * g('mouthStretch', s) + .002 * g('mouthDimple', s) - .007 * puck - .004 * fun),
      .006 * smile - .005 * g('mouthFrown', s) - .001 * g('mouthStretch', s), -.003 * smile + .004 * puck + .003 * fun]);
    z([s * .013, 1.540, .088], .008, [mshift, .004 * g('mouthUpperUp', s) - .001 * g('mouthPress', s), 0]);
    z([s * .013, 1.530, .087], .008, [mshift, -.004 * g('mouthLowerDown', s) + .001 * g('mouthPress', s), 0]);
  }
  const up = (g('mouthUpperUp', 1) + g('mouthUpperUp', -1)) / 2, dn = (g('mouthLowerDown', 1) + g('mouthLowerDown', -1)) / 2;
  z([0, 1.541, .092], .010, [mshift, .003 * up + .002 * g('mouthShrugUpper'), .005 * puck + .004 * fun - .003 * g('mouthRollUpper')]);
  z([0, 1.529, .090], .010, [mshift, -.003 * dn + .003 * g('mouthShrugLower'), .005 * puck + .004 * fun - .003 * g('mouthRollLower')]);
  z([0, 1.510, .080], .015, [0, .003 * g('mouthShrugLower'), .002 * g('mouthShrugLower')]);
  zonas.forEach(([c, r, d], i) => { HU.uFc.value[i].set(c[0], c[1], c[2], r); HU.uFd.value[i].set(d[0] * EXAG, d[1] * EXAG, d[2] * EXAG); });
  // mandíbula: abre, se corre a un lado y se adelanta (el hueso y la piel del mentón juntos)
  const boca = espejo.rostro ? espejo.rostro.boca : (G.jawOpen || 0) * .85;
  HU.uMand.value.set(boca * .38, .006 * (g('jaw', 1) - g('jaw', -1)), 0, .006 * g('jawForward'));
  return HU.uMand.value;
}
// la expresión que domina, para el panel
function expresion() {
  const G = espejo.gestos; if (!G || !espejo.rostro) return '';
  const a = k => ((G[k + 'Left'] || 0) + (G[k + 'Right'] || 0)) / 2;
  const l = [['EYES CLOSED', a('eyeBlink') > .6 ? 1 : 0], ['SMILING', a('mouthSmile') * 1.2], ['SURPRISED', Math.min(G.browInnerUp || 0, a('eyeWide') + .3) * 1.1],
    ['FROWNING', a('browDown') * 1.1], ['KISS', (G.mouthPucker || 0) * .9], ['PUFFED CHEEKS', G.cheekPuff || 0], ['MOUTH OPEN', (G.jawOpen || 0) * .9],
    ['SAD', a('mouthFrown') * 1.2], ['WINK', Math.abs((G.eyeBlinkLeft || 0) - (G.eyeBlinkRight || 0)) > .5 ? .8 : 0]].sort((x, y) => y[1] - x[1]);
  return l[0][1] > .4 ? l[0][0] : 'NEUTRAL';
}
// mirada y párpados: el iris dentro de cada ojo (puntos 468 y 473) y la abertura de los párpados, en el marco de la cara.
// La abertura se compara con la más grande vista hace poco (cada persona tiene los ojos distintos).
function leerOjos(P, X, Y, iris) {
  const xn = X.clone().normalize(), yn = Y.clone().addScaledVector(xn, -Y.dot(xn)).normalize();
  const m = espejo.mirada || (espejo.mirada = { yaw: 0, pitch: 0, parp: [0, 0], abMax: [.3, .3], v0: null });
  // [lado del gemelo, esquina externa, esquina interna, párpado arriba, párpado abajo, centro del iris]
  const ojos = [[0, 33, 133, 159, 145, 468], [1, 263, 362, 386, 374, 473]];
  let h = 0, vv = 0;
  for (const [j, ext, int, sup, inf, ir] of ojos) {
    const c = P(ext).add(P(int)).multiplyScalar(.5), w = Math.max(1e-6, P(ext).distanceTo(P(int)));
    const ab = P(sup).distanceTo(P(inf)) / w;
    m.abMax[j] = Math.max(ab, m.abMax[j] * .998);
    const cierre = lim(1 - (ab / m.abMax[j] - .3) / .45, 0, 1);
    m.parp[j] += (cierre - m.parp[j]) * .6;
    if (iris) { const dI = P(ir).sub(c); h += dI.dot(xn) / w / 2; vv += dI.dot(yn) / w / 2; }
  }
  if (!iris) return;
  m.v0 = m.v0 == null ? vv : m.v0 + (vv - m.v0) * .01;   // el reposo vertical del iris cambia de persona a persona
  // el iris corre ~¼ del ancho del ojo de un extremo al centro: eso son ~30° de giro
  const yaw = lim(h / .22) * .5, pitch = -lim((vv - m.v0) / .12) * .35;
  m.yaw += (yaw - m.yaw) * .5; m.pitch += (pitch - m.pitch) * .5;
}

/* ── postura ── */
function base(x, yGuia) {   // rotación cuyo eje x es «izquierda» y el y es «arriba» (el frente sale de ambos)
  const X = x.clone().normalize(), Z = new THREE.Vector3().crossVectors(X, yGuia).normalize(), Y = new THREE.Vector3().crossVectors(Z, X);
  return new THREE.Matrix4().makeBasis(X, Y, Z);
}
function marco(dir, guia) {   // marco con dir como eje principal y guia (ortogonalizada) como segundo eje
  const D = dir.clone().normalize(), G = guia.clone().addScaledVector(D, -guia.dot(D)).normalize(), Z = new THREE.Vector3().crossVectors(G, D);
  return new THREE.Matrix4().makeBasis(G, D, Z);
}
const rotEntre = (dR, gR, dO, gO) => marco(dO, gO).multiply(marco(dR, gR).transpose());
const seg = (pPosado, R, pReposo) => new THREE.Matrix4().makeTranslation(pPosado.x, pPosado.y, pPosado.z).multiply(R).multiply(_m4.makeTranslation(-pReposo[0], -pReposo[1], -pReposo[2]));
const enP = (M, p) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(M);
const vr = (a, b) => new THREE.Vector3(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// eje de una bisagra (codo, rodilla): el plano de sus dos segmentos; estirada, hereda el del padre (y no salta)
function bisagra(clave, u, f, hPadre) {
  const c = new THREE.Vector3().crossVectors(u.clone().normalize(), f.clone().normalize()), s = c.length();
  const h = hPadre.clone().normalize().lerp(s > 1e-4 ? c.normalize() : hPadre, ss(.15, .45, s)).normalize();
  const prev = espejo.bis[clave];
  espejo.bis[clave] = prev && prev.dot(h) > -.3 ? prev.lerp(h, .5).normalize() : h; return espejo.bis[clave].clone();
}
function posarEspejo() {
  const P = espejo.puntos, V = espejo.vis;
  if (!P) { for (const m of uS) m.identity(); return; }
  const ve = (...k) => k.every(i => V[IDX[i]] > .5);
  // lado izquierdo del gemelo (+x) = tu lado derecho (espejo)
  const lado = k => ({ hom: P[IDX['hom' + k]], cod: P[IDX['cod' + k]], mun: P[IDX['mun' + k]], men: P[IDX['men' + k]], ind: P[IDX['ind' + k]],
    cad: P[IDX['cad' + k]], rod: P[IDX['rod' + k]], tob: P[IDX['tob' + k]], tal: P[IDX['tal' + k]], pie: P[IDX['pie' + k]], k });
  const L = lado('D'), R_ = lado('I');
  const hombros = L.hom.clone().sub(R_.hom), medH = L.hom.clone().add(R_.hom).multiplyScalar(.5);
  const caderasVis = ve('cadI', 'cadD'), medC = L.cad.clone().add(R_.cad).multiplyScalar(.5);
  const arriba = caderasVis ? medH.clone().sub(medC) : new THREE.Vector3(0, 1, 0);
  const R13 = base(hombros, arriba);
  const R0 = caderasVis ? base(L.cad.clone().sub(R_.cad), arriba) : base(new THREE.Vector3(hombros.x, 0, hombros.z), new THREE.Vector3(0, 1, 0));
  const q0 = new THREE.Quaternion().setFromRotationMatrix(R0), q13 = new THREE.Quaternion().setFromRotationMatrix(R13);
  const R1 = new THREE.Matrix4().makeRotationFromQuaternion(q0.clone().slerp(q13, .5));
  const M0 = seg(new THREE.Vector3(...J.pel), R0, J.pel); uS[0].copy(M0);
  const M1 = seg(enP(M0, J.cin), R1, J.cin); uS[1].copy(M1);
  const M13 = seg(enP(M1, PIV.cha), R13, PIV.cha); uS[13].copy(M13);
  // cabeza: orejas y nariz, mezclada con el tórax para que no cabecee con el ruido
  let Rh = R13;
  if (espejo.rostro) {   // la cara manda: orientación exacta de la cabeza con 478 puntos
    const Rc = base(espejo.rostro.x, espejo.rostro.y), qc = new THREE.Quaternion().setFromRotationMatrix(Rc);
    espejo.qCab = espejo.qCab ? espejo.qCab.slerp(qc, .5) : qc;
    Rh = new THREE.Matrix4().makeRotationFromQuaternion(espejo.qCab);
  } else if (ve('oreI', 'oreD', 'nariz')) {
    const X = P[IDX.oreD].clone().sub(P[IDX.oreI]), F = P[IDX.nariz].clone().sub(P[IDX.oreD].clone().add(P[IDX.oreI]).multiplyScalar(.5));
    const Rc = base(X, new THREE.Vector3().crossVectors(F, X)).multiply(RX(-.3));
    Rh = new THREE.Matrix4().makeRotationFromQuaternion(q13.clone().slerp(new THREE.Quaternion().setFromRotationMatrix(Rc), .75));
  }
  const M2 = seg(enP(M13, J.cue), Rh, J.cue); uS[2].copy(M2);
  const mand = gestosCara();
  uS[B_MAND].copy(M2).multiply(_m4.makeTranslation(mand.y, mand.z, mand.w)).multiply(enJ(null, PIV.mand, RX(mand.x)));
  // ojos: el globo gira con tu mirada; el párpado superior baja al parpadear y acompaña un poco la mirada hacia abajo
  const mir = espejo.mirada || { yaw: 0, pitch: 0, parp: [0, 0] }, G = espejo.gestos || {};
  for (const [s, j] of [[1, 0], [-1, 1]]) {
    const c = OJO[s], ancho = G[(s > 0) === ((espejo.ladoBS || 0) >= 0) ? 'eyeWideRight' : 'eyeWideLeft'] || 0;
    uS[B_OJO(s)].copy(seg(enP(M2, c), new THREE.Matrix4().multiplyMatrices(Rh, RY(mir.yaw)).multiply(RX(mir.pitch)), c));
    uS[B_PARP(s)].copy(seg(enP(M2, c), new THREE.Matrix4().multiplyMatrices(Rh, RX(mir.parp[j] * .6 + Math.max(0, mir.pitch) * .3 - ancho * .15)), c));
  }
  const Z = new THREE.Vector3(0, 0, 1);
  for (const [s, Q, b, a, h] of [[1, L, 3, 9, 14], [-1, R_, 6, 11, 15]]) {
    const k = Q.k, cad = lad(J.cad, s), rod = lad(J.rod, s), tob = lad(J.tob, s), hom = lad(J.hom, s), cod = lad(J.cod, s), mun = lad(PIV.mun, s), pun = lad(PIV.pun, s);
    const tal = lad(PIV.tal, s), dedo = lad(PIV.dedo, s);
    // pierna: la rodilla se dobla hacia atrás; si la cámara no la ve, cuelga en reposo bajo la pelvis
    const mR = vr(rod, cad), pR = vr(tob, rod), hRod = new THREE.Vector3().crossVectors(mR.clone().normalize(), Z.clone().negate());
    let Rm = R0, Rp = R0;
    if (caderasVis && ve('rod' + k, 'tob' + k)) {
      const mO = Q.rod.clone().sub(Q.cad), pO = Q.tob.clone().sub(Q.rod), hO = bisagra('r' + s, mO, pO, hRod.clone().applyMatrix4(R0));
      Rm = rotEntre(mR, hRod, mO, hO); Rp = rotEntre(pR, hRod, pO, hO);
    }
    const Mm = seg(enP(M0, cad), Rm, cad); uS[b].copy(Mm);
    const Mp = seg(enP(Mm, rod), Rp, rod); uS[b + 1].copy(Mp);
    const Rf = caderasVis && ve('tob' + k, 'tal' + k, 'pie' + k) ? rotEntre(vr(dedo, tal), vr(tob, tal), Q.pie.clone().sub(Q.tal), Q.tob.clone().sub(Q.tal)) : Rp;
    uS[b + 2].copy(seg(enP(Mp, tob), Rf, tob));
    // brazo: el codo se dobla hacia adelante
    const bR = vr(cod, hom), aR = vr(mun, cod), hCod = new THREE.Vector3().crossVectors(bR.clone().normalize(), Z);
    let Rb = R13, Ra = R13;
    // con el codo fuera de la imagen pero la muñeca o la mano a la vista, el codo que estima MediaPipe es coherente con ella
    if (ve('cod' + k) || ve('mun' + k) || (espejo.mano && espejo.mano[k])) {
      const bO = Q.cod.clone().sub(Q.hom), aO = ve('mun' + k) ? Q.mun.clone().sub(Q.cod) : bO.clone();
      const hO = bisagra('c' + s, bO, aO, hCod.clone().applyMatrix4(R13));
      Rb = rotEntre(bR, hCod, bO, hO); Ra = ve('mun' + k) ? rotEntre(aR, hCod, aO, hO) : Rb;
    }
    const Mb = seg(enP(M13, hom), Rb, hom); uS[a].copy(Mb);
    const Ma = seg(enP(Mb, cod), Ra, cod); uS[a + 1].copy(Ma);
    // mano: hacia los nudillos, con el giro que marcan índice y meñique
    let Rmano = Ra;
    const hm = espejo.mano && espejo.mano[k];
    if (hm) {   // la mano con sus 21 puntos: palma por muñeca, nudillo del medio, índice y meñique
      Rmano = rotEntre(vr(PIV.pun, PIV.mun).multiply(new THREE.Vector3(s, 1, 1)), vr(MC2, MC5).multiply(new THREE.Vector3(s, 1, 1)), hm[9].clone().sub(hm[0]), hm[5].clone().sub(hm[17]));
    } else if (ve('mun' + k, 'ind' + k, 'men' + k)) {
      const dO = Q.ind.clone().add(Q.men).multiplyScalar(.5).sub(Q.mun), gO = Q.ind.clone().sub(Q.men);
      if (dO.length() > .02 && gO.length() > .01) Rmano = rotEntre(vr(pun, mun), new THREE.Vector3(s, 0, 0), dO, gO);
    }
    const Mmano = seg(enP(Ma, mun), Rmano, mun); uS[h].copy(Mmano);
    // dedos: cada falange gira lo mínimo para apuntar como la tuya, encadenada desde la palma
    for (let f = 0; f < 5; f++) {
      let Rp = Rmano, Mp = Mmano;
      for (let j = 0; j < 3; j++) {
        const dd = DEDOS[f * 3 + j], a0 = lad(dd[2], s), b0 = lad(dd[3], s);
        let R = Rp;
        if (hm) { const rest = vr(b0, a0).normalize().applyMatrix4(Rp), obs = hm[dd[1]].clone().sub(hm[dd[0]]).normalize();
          R = new THREE.Matrix4().makeRotationFromQuaternion(_q.setFromUnitVectors(rest, obs)).multiply(Rp); }
        const M = seg(enP(Mp, a0), R, a0); uS[B_DEDO(s) + f * 3 + j].copy(M); Rp = R; Mp = M;
      }
    }
  }
  // los pies se asientan en el piso
  const dy = .012 - bajoPies(); _m4.makeTranslation(0, dy, 0); for (const m of uS) m.premultiply(_m4);
}
const TROTE = `uniform mat4 uS[${SEGS}]; uniform float uJog; uniform float uPuno; uniform float uModo; uniform vec4 uVis[13];
  float vis(float i){ int k = int(i + .5); return uVis[k / 4][k - 4 * (k / 4)]; } attribute vec4 aBi; attribute vec4 aBw;
  vec3 tr(int i, vec3 p){ return (uS[i] * vec4(p, 1.)).xyz; }
  vec3 rotX(vec3 p, vec3 c, float a){ p -= c; float s = sin(a), k = cos(a); return c + vec3(p.x, p.y*k - p.z*s, p.y*s + p.z*k); }
  // puño suelto: los dedos se cierran hacia la palma (en la pose de referencia la palma mira a +z)
  vec3 puno(vec3 p){ float d = 1. - smoothstep(.77, .81, p.y), m = 1. - smoothstep(.705, .745, p.y);
    p = rotX(p, vec3(0., .795, -.005), -1.15*uPuno*d);
    return rotX(p, vec3(0., .745, .03), -.9*uPuno*m*d); }
  // la cara (piel, labios y cejas): cada zona empuja la piel con caída gaussiana; bajo la boca la piel sigue a la mandíbula
  uniform vec4 uFc[24]; uniform vec3 uFd[24]; uniform vec4 uMand; attribute float aCara;
  vec3 cara(vec3 p){ if (aCara < .5 || p.y < 1.47 || p.z < -.02) return p;
    vec3 d = vec3(0.);
    for (int i = 0; i < 24; i++){ vec3 q = p - uFc[i].xyz; d += uFd[i] * exp(-dot(q, q) / (uFc[i].w * uFc[i].w)); }
    float wj = (1. - smoothstep(1.531, 1.538, p.y)) * smoothstep(1.485, 1.51, p.y) * (1. - smoothstep(.045, .068, abs(p.x))) * smoothstep(0., .035, p.z);
    return rotX(p, vec3(0., 1.575, 0.), uMand.x * wj) + uMand.yzw * wj + d; }
  vec3 trote(vec3 p){ if (uJog < .001) return p;
    if (uModo > .5) {   // espejo: cada vértice con sus 3 huesos y sus pesos
      vec4 q = vec4(cara(p), 1.);
      return (uS[int(aBi.x + .5)] * q).xyz * aBw.x + (uS[int(aBi.y + .5)] * q).xyz * aBw.y + (uS[int(aBi.z + .5)] * q).xyz * aBw.z; }
    float lado = p.x > 0. ? 1. : -1., ax = abs(p.x), y = p.y;
    int b = lado > 0. ? 3 : 6, a = lado > 0. ? 9 : 11;
    // borde brazo/tronco: junto a la cadera la mano cuelga a ~.245 y el muslo llega a ~.19, así que ahí el corte es más afuera
    // y más angosto (si no, al mover el brazo arrastra la piel de la cadera como una lámina)
    float sube = smoothstep(.95, 1.15, y), xb = mix(.212, .158, sube), an = mix(.006, .015, sube);
    float wa = smoothstep(.62, .72, y) * (1. - smoothstep(1.38, 1.47, y)) * smoothstep(xb - an, xb + an, ax);
    vec3 tronco = mix(mix(tr(0, p), tr(1, p), smoothstep(1.0, 1.14, y)), tr(2, p), smoothstep(1.47, 1.56, y));
    vec3 pierna = mix(mix(tr(b, p), tr(b + 1, p), 1. - smoothstep(.42, .5, y)), tr(b + 2, p), 1. - smoothstep(.07, .13, y));
    vec3 abajo = mix(tr(0, p), pierna, 1. - smoothstep(.83, .95, y));
    vec3 cuerpo = mix(tronco, abajo, 1. - smoothstep(.95, 1.02, y));
    vec3 h = puno(p);
    vec3 brazo = mix(tr(a, h), tr(a + 1, h), 1. - smoothstep(1.07, 1.16, y));
    return mix(cuerpo, brazo, wa); }`;
const VTX = `varying vec3 vN; varying vec3 vV; varying float vY; varying float vVis; ${TROTE}
  void main(){ vec3 p = trote(position), n = normalize(trote(position + normal*.01) - p);
    vVis = uModo > .5 ? vis(aBi.x) * aBw.x + vis(aBi.y) * aBw.y + vis(aBi.z) * aBw.z : 1.;
    vec4 w = modelMatrix*vec4(p,1.); vY = w.y; vec4 mv = viewMatrix*w; vN = normalize(normalMatrix*n); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`;
// el material anatómico (iluminado) también se posa con el esqueleto: si no, en Anatomy los órganos y huesos se quedan
// quietos en reposo mientras la piel se mueve
function conEsqueleto(m) {
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uJog: HU.uJog, uPuno: HU.uPuno, uModo: HU.uModo, uVis: HU.uVis, uS: HU.uS, ...HU_CARA() });
    sh.vertexShader = TROTE + '\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(trote(position + normal * .01) - trote(position));')
      .replace('#include <begin_vertex>', 'vec3 transformed = trote(position);');
  };
  m.customProgramCacheKey = () => 'esqueleto';
}
const HOLO_SIS = { skeletal: ['#e2f5ff', .07, 1.0], connective: ['#a6dcf2', .03, .55], nervous: ['#c7b8ff', .06, .85], cardiac: ['#ff5268', .18, 1.3],
  respiratory: ['#7fd2ff', .05, .8], arterial: ['#ff4d59', .05, .9], venous: ['#6494ff', .05, .85], digestive: ['#ff9a5a', .06, .8],
  urinary: ['#ff7399', .07, .85], endocrine: ['#ffc760', .07, .85], lymphatic: ['#7fdc9b', .05, .7], sensory: ['#d8ccff', .1, 1.0],
  reproductive: ['#ff8fb0', .05, .7], muscular: ['#e0607e', .012, .4] };
function holo(col, k0, kf, tipo) {
  return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uT: HU.uT, uBeat: HU.uBeat, uBreath: HU.uBreath, uScan: HU.uScan, uJog: HU.uJog, uPuno: HU.uPuno, uModo: HU.uModo, uVis: HU.uVis, uS: HU.uS, ...HU_CARA(), c: { value: new THREE.Color(col) }, k0: { value: k0 }, kf: { value: kf }, tipo: { value: tipo } },
    vertexShader: VTX,
    fragmentShader: `uniform vec3 c; uniform float k0, kf, tipo, uT, uBeat, uBreath, uScan; varying vec3 vN; varying vec3 vV; varying float vY; varying float vVis;
      void main(){ float f = pow(1.-abs(dot(normalize(vN),vV)), 2.); float k = k0 + kf*f;
        if (tipo > .5 && tipo < 1.5) k *= .55 + 1.2*uBeat;
        if (tipo > 1.5 && tipo < 2.5) k *= .8 + .35*uBreath;
        float sc = .84 + .16*sin(gl_FragCoord.y*1.3 - uT*24.);
        float banda = smoothstep(.04, 0., abs(vY - uScan));
        vec3 col = c*k*sc + vec3(.55,.9,1.)*banda*(.12 + .5*f);
        col *= vVis; gl_FragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)), 0., 1.)); }` });
}
function material(malla) {
  const { p, capa, region } = malla.userData, nivel = region ? (estados[region] || {}).nivel : null;
  const elegida = sel && region === sel, apagada = sel && region !== sel;
  const resalta = nivel && COLOR_EST[nivel] && nivel !== 'normal' && nivel !== 'esperado_vuelo';
  const clave = [estilo, capa === 'piel' ? 'piel' : capa + ':' + p.system, elegida ? 'sel' : resalta ? nivel : region && nivel ? 'reg' : '', apagada ? 'dim' : ''].join('|');
  if (mats[clave]) return mats[clave];
  let m;
  if (capa === 'piel') m = estilo === 'halo' ? fresnel('#8fe6f5', apagada ? .25 : .55, 3.2) : fresnel('#cfe3f0', apagada ? .25 : .55, 2.6);
  else if (estilo === 'anatomia') {
    m = new THREE.MeshStandardMaterial({ color: REAL[p.system] || '#aaa', roughness: p.system === 'skeletal' ? .55 : .42 });
    conEsqueleto(m);
    if (elegida) { m.emissive = new THREE.Color('#ffffff'); m.emissiveIntensity = .18; }
    else if (resalta) { m.emissive = new THREE.Color(COLOR_EST[nivel]); m.emissiveIntensity = .4; }
  } else {
    // holograma: el color de su sistema; la región elegida o con aviso se enciende con el color de su estado
    const tipo = region === 'corazon' || p.system === 'cardiac' ? 1 : region === 'pulmones' || p.system === 'respiratory' ? 2 : 0;
    const [c0, k0, kf] = capa === 'nervios' ? ['#ffd76a', .03, .6] : HOLO_SIS[p.system] || ['#8fd6f0', .015, .35];
    if (elegida) m = holo(c0, Math.max(.12, k0 * 3), kf * 1.7, tipo);       // la parte elegida brilla con el color de su sistema
    else if (resalta) m = holo(COLOR_EST[nivel], .1, .95, tipo);
    else if (apagada) m = holo(c0, k0 * .15, kf * .15, tipo);
    else m = holo(c0, k0, kf, tipo);
  }
  if (apagada && capa !== 'piel' && estilo === 'anatomia') { m.transparent = true; m.opacity = .18; m.depthWrite = false; }
  return mats[clave] = m;
}
function aplicarMateriales() {
  const m = modelos[sexo]; if (!m || !m.listo) return;
  const firma = [sexo, estilo, sel, [...capas].join(','), JSON.stringify(Object.fromEntries(Object.entries(estados).map(([k, v]) => [k, v.nivel])))].join('#');
  if (firma === firmaMat) return; firmaMat = firma;
  for (const x of m.mallas) { x.visible = capas.has(x.userData.capa) || (!!sel && x.userData.region === sel); x.material = material(x); } // visible booleano: three.js solo oculta con === false
}

/* ── escena ── */
function montar() {
  cajaEl = $('g3d');
  ren = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  ren.toneMapping = THREE.ACESFilmicToneMapping; ren.outputColorSpace = THREE.SRGBColorSpace;
  cajaEl.appendChild(ren.domElement);
  esc = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(28, 1, .02, 30);
  cam.position.set(.6, 1.05, 4.4);
  esc.add(new THREE.HemisphereLight('#dfefff', '#1a1410', .9));
  const l1 = new THREE.DirectionalLight('#ffffff', 2); l1.position.set(1.5, 2.5, 2); esc.add(l1);
  const l2 = new THREE.DirectionalLight('#8fe6f5', .8); l2.position.set(-2, 1, -1.5); esc.add(l2);
  raiz = new THREE.Group(); esc.add(raiz);
  // anillo en el piso
  const anillo = new THREE.Mesh(new THREE.RingGeometry(.42, .425, 96), new THREE.MeshBasicMaterial({ color: '#8fe6f5', transparent: true, opacity: .35, side: THREE.DoubleSide }));
  anillo.rotation.x = -Math.PI / 2; esc.add(anillo);
  const anillo2 = new THREE.Mesh(new THREE.RingGeometry(.58, .583, 96), new THREE.MeshBasicMaterial({ color: '#8fe6f5', transparent: true, opacity: .12, side: THREE.DoubleSide }));
  anillo2.rotation.x = -Math.PI / 2; esc.add(anillo2);
  // holograma: el anillo que acompaña a la banda de escaneo y un polvo de luz que sube alrededor del cuerpo
  aroScan = new THREE.Mesh(new THREE.RingGeometry(.3, .304, 128), new THREE.MeshBasicMaterial({ color: '#bfefff', transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  aroScan.rotation.x = -Math.PI / 2; esc.add(aroScan);
  { const n = 900, pos = new Float32Array(n * 3), sem = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = .22 + Math.pow(Math.random(), .7) * .5; pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 1.95; pos[i * 3 + 2] = Math.sin(a) * r; sem[i] = Math.random(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('sem', new THREE.BufferAttribute(sem, 1));
    polvo = new THREE.Points(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: HU.uT },
      vertexShader: 'attribute float sem; uniform float uT; varying float vA; void main(){ vec3 p = position; p.y = mod(p.y + uT*(.03 + .05*sem), 1.95); vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv; vA = (.25 + .75*sem) * smoothstep(0., .25, p.y) * smoothstep(1.95, 1.6, p.y) * (.6 + .4*sin(uT*2. + sem*40.)); gl_PointSize = (1.5 + 2.5*sem) * 3. / -mv.z; }',
      fragmentShader: 'varying float vA; void main(){ vec2 q = gl_PointCoord - .5; float d = dot(q,q); if (d > .25) discard; gl_FragColor = vec4(vec3(.55,.88,1.)*vA*(1.-d*4.), 1.); }' }));
    polvo.frustumCulled = false; esc.add(polvo); }
  ren.domElement.style.filter = 'drop-shadow(0 0 3px rgba(143,230,245,.55)) drop-shadow(0 0 16px rgba(110,190,255,.3))';
  // indicadores en vivo: pulso con su electro al ritmo del corazón del gemelo, cadencia del trote, respiración y oxígeno
  hud = document.createElement('div'); hud.id = 'gHud';
  hud.style.cssText = 'position:absolute;right:14px;top:118px;width:230px;padding:12px 14px;border-radius:12px;background:rgba(4,14,24,.62);border:1px solid rgba(143,230,245,.28);backdrop-filter:blur(6px);pointer-events:none;font:500 11px var(--mono,monospace);color:rgba(220,240,250,.7);letter-spacing:.08em;z-index:3';
  if (getComputedStyle(cajaEl).position === 'static') cajaEl.style.position = 'relative';
  cajaEl.appendChild(hud);
  ctrl = new OrbitControls(cam, ren.domElement);
  ctrl.target.set(0, .9, 0); ctrl.enableDamping = true; ctrl.dampingFactor = .08; ctrl.minDistance = .25; ctrl.maxDistance = 7;
  ctrl.autoRotate = true; ctrl.autoRotateSpeed = 6; ctrl.zoomSpeed = .8;
  ctrl.addEventListener('start', () => { ctrl.autoRotate = false; vuelo = null; });
  new ResizeObserver(medir).observe(cajaEl);
  medir();
  // tocar y pasar el cursor
  let abajo = null;
  ren.domElement.addEventListener('pointerdown', e => { abajo = [e.clientX, e.clientY]; });
  ren.domElement.addEventListener('pointerup', e => { if (abajo && Math.hypot(e.clientX - abajo[0], e.clientY - abajo[1]) < 5) tocar(e); abajo = null; });
  ren.domElement.addEventListener('pointermove', e => { const t = performance.now(); if (t - hoverT > 70) { hoverT = t; pasar(e); } });
  ren.domElement.addEventListener('pointerleave', () => { $('gEtq').hidden = true; });
}
function medir() {
  if (!ren) return;
  const w = cajaEl.offsetWidth, h = cajaEl.offsetHeight; if (!w || !h) return;
  const z = cajaEl.getBoundingClientRect().width / w || 1;
  ren.setPixelRatio(Math.min(2.2, (devicePixelRatio || 1) * z)); ren.setSize(w, h, false);
  ren.domElement.style.width = '100%'; ren.domElement.style.height = '100%';
  cam.aspect = w / h; cam.updateProjectionMatrix();
}
const ray = new THREE.Raycaster();
function golpe(e) {
  const m = modelos[sexo]; if (!m || !m.listo) return null;
  const r = ren.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cam);
  const vis = m.mallas.filter(x => x.visible && x.userData.capa !== 'piel' && !(sel && x.userData.region !== sel && x.material.opacity < .3));
  const h = ray.intersectObjects(vis, false)[0];
  if (h) return h.object;
  const piel = m.mallas.filter(x => x.visible && x.userData.capa === 'piel');
  const h2 = ray.intersectObjects(piel, false)[0];
  return h2 ? h2.object : null;
}
function pasar(e) {
  const o = golpe(e), etq = $('gEtq');
  if (!o) { etq.hidden = true; ren.domElement.style.cursor = ''; return; }
  const r = REGIONES.find(R => R.id === o.userData.region);
  const caja = $('gem').getBoundingClientRect(), z = caja.width / $('gem').offsetWidth;
  etq.innerHTML = `<b>${o.userData.p.name}</b>${r ? `<span>${r.n} · click for details</span>` : ''}`;
  etq.style.transform = `translate(${(e.clientX - caja.left) / z + 16}px, ${(e.clientY - caja.top) / z - 10}px)`;
  etq.hidden = false; ren.domElement.style.cursor = r ? 'pointer' : '';
}
function tocar(e) {
  const o = golpe(e);
  if (!o || !o.userData.region) { if (sel) elegir(null); return; }
  elegir(o.userData.region);
}

/* ── cámara ── */
function volarA(caja, factor = 1.5) {
  const c = caja.getCenter(new THREE.Vector3()), r = caja.getSize(new THREE.Vector3()).length() / 2;
  const sz = caja.getSize(new THREE.Vector3()), mitad = THREE.MathUtils.degToRad(cam.fov / 2);
  // que quepa a lo alto y a lo ancho
  const dist = Math.max(.3, Math.max(sz.y / 2 / Math.tan(mitad), Math.max(sz.x, sz.z) / 2 / Math.tan(mitad) / cam.aspect) * factor + sz.z / 2);
  const dir = cam.position.clone().sub(ctrl.target).normalize();
  vuelo = { t: 0, de: [cam.position.clone(), ctrl.target.clone()], a: [c.clone().add(dir.multiplyScalar(dist)), c] };
}
function verTodo() { const m = modelos[sexo]; if (m && m.cajaTodo) volarA(m.cajaTodo, 1.32); }

/* ── estado de cada región ── */
function calcular() {
  const tr = ultimo && ultimo.trip[gT], d = dia ?? (mision ? mision.dia : 0);
  for (const r of REGIONES) estados[r.id] = r.hoy(gT, tr, d, conEj);
}

function pintarPanel() {
  const c = CREW[gT], d = dia ?? (mision ? mision.dia : 0), proy = dia != null && mision && dia > mision.dia;
  const pastilla = s => s.vivo ? '<em class="pv">Live</em>' : s.estimado ? `<em class="pe">${proy ? 'Projection' : 'Estimated'}</em>` : '<em class="pn">Not measured</em>';
  const punto = s => `<i style="background:${COLOR_EST[s.nivel] || 'var(--t3)'}"></i>`;
  let h;
  if (!sel) {
    h = `<div class="gpcab"><b>${c.corto}'s body today</b><span>Reference ${c.ella === 'her' ? 'female' : 'male'} anatomy · click any part</span></div>` +
      REGIONES.map(r => { const s = estados[r.id] || {}; const hay = (modelos[sexo] && modelos[sexo].porRegion[r.id]) ? '' : ' sin3d';
        return `<button class="gpfila${hay}" data-gr="${r.id}">${punto(s)}<span><b>${r.n}</b><small>${s.texto || ''}</small></span><strong>${s.valor || '—'}</strong></button>`; }).join('');
  } else {
    const r = REGIONES.find(x => x.id === sel), s = estados[sel] || {};
    const reg = r.medir && typeof REG !== 'undefined' && REG[r.medir] ? `<button class="gpbtn pri" data-greg="${r.medir}">Log ${REG[r.medir].n.toLowerCase()}</button>` : '';
    h = `<button class="gpvolver" data-gr="">← All of ${c.corto}'s body</button>
      <div class="gpt">${punto(s)}<b>${r.n}</b>${pastilla(s)}</div>
      <div class="gpv">${s.valor || '—'}</div><div class="gps">${s.texto || ''}</div>
      ${modelos[sexo] && !modelos[sexo].porRegion[sel] ? '<div class="gps aviso">Not part of the female reference model; values still apply.</div>' : ''}
      <h4>What it does</h4><p>${r.funcion}</p>
      <h4>What space does</h4><p>${r.espacio}</p><p class="gpf">${r.fuente}</p>
      <h4>What to do</h4><p>${r.accion}</p>
      <div class="gpacc">${reg}<button class="gpbtn" data-gask="${r.id}">Ask Nova</button></div>`;
  }
  if (h !== firmaPanel) { firmaPanel = h; $('gPanel').innerHTML = h; }
  // línea de tiempo
  if (mision && mision.total_dias) {
    const tot = mision.total_dias, ent = $('gDia');
    ent.max = tot; if (document.activeElement !== ent) ent.value = d;
    $('gHoyM').style.left = (mision.dia / tot * 100) + '%';
    $('gMarte').style.left = Math.min(100, (mision.dia + (mision.llegada_en_dias || 0)) / tot * 100) + '%';
    $('gMarte').hidden = mision.fase !== 'cruise';
    $('gDiaTxt').innerHTML = `<b>Day ${Math.round(d)}</b> of ${tot}${proy ? ' · projection' : dia != null && dia < mision.dia ? ' · past' : ' · today'}`;
    $('gHoy').hidden = dia == null;
    $('gEj').classList.toggle('on', conEj);
  }
}

function elegir(id) {
  sel = id || null; firmaPanel = '';
  ctrl.autoRotate = estilo !== 'anatomia';   // en holograma sigue girando alrededor de la parte elegida
  const m = modelos[sexo];
  if (sel && m && m.cajas[sel]) volarA(m.cajas[sel], sel === 'piel' ? 1.12 : 1.5); else verTodo();
  aplicarMateriales(); pintarPanel();
}

/* ── cuadro ── */
function cuadro(t) {
  if (vista !== 'gemelo') { corre = false; if (camVista.on) vistaCamara(false); if (espejo.on) apagarEspejo(); return; }
  const dt = Math.min(.1, (t - tAnt) / 1000) || .016; tAnt = t;
  if (vuelo) {
    vuelo.t = Math.min(1, vuelo.t + dt / .7); const k = 1 - Math.pow(1 - vuelo.t, 3);
    cam.position.lerpVectors(vuelo.de[0], vuelo.a[0], k); ctrl.target.lerpVectors(vuelo.de[1], vuelo.a[1], k);
    if (vuelo.t >= 1) vuelo = null;
  }
  ctrl.update(dt);                                   // el giro va por tiempo, no por cuadro: igual de fluido a cualquier ritmo
  // latido al pulso en vivo
  const m = modelos[sexo], tr = ultimo && ultimo.trip[gT];
  const fc = tr && tr.edades.pulso > 0 && tr.edades.pulso <= 6 ? tr.pulso : 0;
  if (m && m.listo && m.porRegion.corazon) {
    faseLatido += dt * (fc || 60) / 60;
    const lat = fc ? Math.pow(Math.max(0, Math.sin(faseLatido * Math.PI * 2)), 6) : 0, s = 1 + lat * .06;
    const c = m.cajas.corazon.getCenter(new THREE.Vector3());
    for (const x of m.porRegion.corazon) { x.scale.setScalar(s); x.position.copy(c).multiplyScalar(1 - s); }
    HU.uBeat.value = lat;
  }
  // holograma vivo: respiración, líneas de escaneo y una banda que recorre el cuerpo de pies a cabeza cada 5 s
  const ts = t / 1000, holoOn = estilo !== 'anatomia', foco = !!(cajaEl && cajaEl.closest('#gem') && $('gem').classList.contains('foco'));
  const enEspejo = espejo.on && sexo === 'hombre';
  const jogMeta = (holoOn || enEspejo) && sexo === 'hombre' ? 1 : 0;
  const mh = modelos.hombre, posesListas = sexo === 'hombre' && mh && mh.pesado === 6;
  if (sexo === 'hombre' && mh && mh.listo && holoOn && !mh.pPesar) pesar(mh);   // el esqueleto fino se arma de fondo
  if (enEspejo) { HU.uJog.value = 1; HU.uPuno.value = 0; HU.uModo.value = 1; actualizarEspejo(dt); posarEspejo(); encuadrarEspejo(); visibilidades(espejo.enc && espejo.enc.n, dt); }
  else if (posesListas && (jogMeta || galeria.modo1)) galeriaPaso(dt, ts, !!jogMeta);
  else { HU.uJog.value += (jogMeta - HU.uJog.value) * Math.min(1, dt * 3); if (HU.uJog.value < .002) HU.uJog.value = 0;
    HU.uModo.value = 0; HU.uPuno.value = HU.uJog.value; HU.uPh.value = (HU.uPh.value + dt * 1.42) % 1; poseTrote(HU.uPh.value, HU.uJog.value); }
  if (t - (galeria.tBarra || 0) > 300) { galeria.tBarra = t; pintarPoses(); }
  HU.uT.value = ts; HU.uBreath.value = .5 + .5 * Math.sin(ts * Math.PI * 2 * 14 / 60);
  const fase = (ts % 5) / 5, alto = m && m.cajaTodo ? m.cajaTodo.max.y : 1.8;
  HU.uScan.value = fase < .7 && !foco && !camVista.on && !espejo.encuadrado ? alto * (fase / .7) : -1;
  if (aroScan) { aroScan.visible = holoOn && !foco && !camVista.on && !espejo.encuadrado && fase < .7; aroScan.position.y = HU.uScan.value; aroScan.material.opacity = .55 * Math.sin(Math.PI * fase / .7); }
  if (polvo) polvo.visible = holoOn && !camVista.on && !espejo.encuadrado;
  const filtro = holoOn ? 'drop-shadow(0 0 3px rgba(143,230,245,.55)) drop-shadow(0 0 16px rgba(110,190,255,.3))' : 'none';
  if (ren.domElement.style.filter !== filtro) ren.domElement.style.filter = filtro;
  pintarHud(tr, fc, dt);
  ren.render(esc, cam);
  if (camVista.on) componer();
  lineas(t / 1000);
  requestAnimationFrame(cuadro);
}

/* ── indicadores en vivo sobre el gemelo ── */
function pintarHud(tr, fc, dt) {
  if (!hud) return; const holoOn = estilo !== 'anatomia'; hud.hidden = !holoOn; if (!holoOn) return;
  // el electro avanza con el mismo latido que hace brillar el corazón del gemelo
  const ph = faseLatido % 1, q = x => Math.exp(-x * x);
  const v = fc ? q((ph - .3) * 40) - .25 * q((ph - .27) * 60) - .3 * q((ph - .34) * 60) + .18 * q((ph - .6) * 12) + .06 * q((ph - .15) * 25) : 0;
  ecgBuf.push(v); ecgBuf.shift();
  const W = 202, H = 34, d = ecgBuf.map((y, i) => `${i ? 'L' : 'M'}${(i / (ecgBuf.length - 1) * W).toFixed(1)} ${(H * .62 - y * H * .55).toFixed(1)}`).join('');
  const r = sel ? REGIONES.find(x => x.id === sel) : null, s = r ? estados[sel] || {} : null;
  const fila = (k, val, u, col = '#fff') => `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:6px"><span>${k}</span><b style="font:600 17px var(--sans,system-ui);letter-spacing:0;color:${col}">${val}<small style="font:500 10px var(--mono,monospace);color:rgba(220,240,250,.55);margin-left:3px">${u}</small></b></div>`;
  const pul = tr && fc ? Math.round(fc) : null, spo = tr && tr.spo2 > 0 ? Math.round(tr.spo2) : null, fr = tr && tr.fr > 0 ? Math.round(tr.fr) : null;
  const cab = `<div style="display:flex;justify-content:space-between;color:#8fe6f5"><span>● LIVE · BODY TWIN</span><span>${espejo.on ? (espejo.puntos ? `MIRRORING · ${espejo.nCam || 1} CAM${(espejo.nCam || 1) > 1 ? 'S' : ''}${expresion() ? ' · ' + expresion() : ''}` : 'LOOKING FOR YOU…') : sexo === 'hombre' ? (galeria.modo1 ? poseActual().n.toUpperCase() : HU.uJog.value > .5 ? 'JOGGING' : '') : ''}</span></div>`;
  const cuerpo = fila('PULSE', pul ?? '—', 'bpm', '#ff7a8a') + `<svg width="${W}" height="${H}" style="display:block;margin-top:2px"><path d="${d}" fill="none" stroke="#ff5268" stroke-width="1.6" stroke-linejoin="round"/></svg>`
    + (sexo === 'hombre' && !espejo.on && !galeria.modo1 && HU.uJog.value > .5 ? fila('CADENCE', 170, 'spm') : '') + (camVista.on && camVista.fit ? fila('BODY COVERED', Math.round(camVista.fit.cubre * 100), '%', '#8fe6f5') + fila('OUTSIDE BODY', Math.round(camVista.fit.fuera * 100), '%', camVista.fit.fuera > .15 ? '#f2b457' : '#8fe6f5') : '') + fila('BREATHING', fr ?? '—', '/min') + fila('SpO₂', spo ?? '—', '%')
    + (r ? `<div style="margin-top:9px;padding-top:8px;border-top:1px solid rgba(143,230,245,.2);color:#8fe6f5">${r.n.toUpperCase()}</div>` + fila('NOW', s.valor || '—', '', COLOR_EST[s.nivel] || '#fff') : '');
  hud.innerHTML = cab + cuerpo;
}

/* ── líneas del panel al cuerpo: cada fila (o la ficha abierta) apunta a su región ── */
const vTmp = new THREE.Vector3();
function lineas(t) {
  const m = modelos[sexo], svg = $('gLin'); if (!svg) return;
  if (!m || !m.listo || vuelo) { if (svg.innerHTML) svg.innerHTML = ''; return; }
  const gem = $('gem'), gr = gem.getBoundingClientRect(), z = gr.width / gem.offsetWidth || 1, W = cajaEl.offsetWidth, H = cajaEl.offsetHeight;
  svg.setAttribute('viewBox', `0 0 ${gem.offsetWidth} ${gem.offsetHeight}`);
  const filas = sel ? [[sel, document.querySelector('#gPanel .gpt')]] : [...document.querySelectorAll('#gPanel .gpfila[data-gr]')].map(f => [f.dataset.gr, f]);
  const panel = $('gPanel').getBoundingClientRect();
  let h = '', k = 0;
  for (const [id, el] of filas) {
    const a = m.anclas[id]; if (!a || !el) continue;
    const r = el.getBoundingClientRect(); if (r.bottom < panel.top + 4 || r.top > panel.bottom - 4) continue;
    vTmp.copy(a).project(cam); if (vTmp.z > 1 || Math.abs(vTmp.x) > 1.05 || Math.abs(vTmp.y) > 1.05) continue;
    const px = (vTmp.x + 1) / 2 * W, py = (1 - vTmp.y) / 2 * H;
    const ex = (panel.left - gr.left) / z, ey = (r.top + Math.min(r.height / 2, 22) - gr.top) / z, mx = ex - 28 - (k % 3) * 10;
    const col = COLOR_EST[(estados[id] || {}).nivel] || '#9aa4b2', op = sel ? .75 : .38;
    h += `<path d="M${ex} ${ey.toFixed(1)} H${mx} L${px.toFixed(1)} ${py.toFixed(1)}" fill="none" stroke="${col}" stroke-opacity="${op}" stroke-width="1"/>`
      + `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.2" fill="${col}"/><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(8 + 2.5 * Math.sin(t * 3 + k)).toFixed(1)}" fill="none" stroke="${col}" stroke-opacity=".45"/>`;
    k++;
  }
  svg.innerHTML = h;
}

/* ── abrir, cambiar de persona y refrescar ── */
async function ponerPersona(i) {
  if (espejo.on && CREW[i].ella === 'her') apagarEspejo();
  gT = i; sel = null; firmaPanel = ''; firmaMat = '';
  const sx = CREW[i].ella === 'her' ? 'mujer' : 'hombre';
  document.querySelectorAll('#gQuien button').forEach((b, j) => b.classList.toggle('on', j === gT));
  $('gNombre').textContent = CREW[i].nombre; $('gRol').textContent = `${CREW[i].rol} · mission day ${mision ? mision.dia : '—'}`;
  calcular(); pintarPanel(); novaGemelo();
  if (sx !== sexo) {
    Object.entries(modelos).forEach(([k, v]) => { if (v.grupo.parent) raiz.remove(v.grupo); });
    sexo = sx; avisoCarga('Loading anatomy…');
    const m = await cargar(sx); if (sexo !== sx) return;
    raiz.add(m.grupo); avisoCarga('');
    calcular(); aplicarMateriales(); pintarPanel(); verTodo(); ctrl.autoRotate = true;
  } else { aplicarMateriales(); verTodo(); }
}

function armar() {
  $('gQuien').innerHTML = CREW.map((c, j) => `<button data-gt="${j}">${c.corto}</button>`).join('');
  $('gCapas').innerHTML = CAPAS.map(([k, n]) => `<button data-gc="${k}">${n}</button>`).join('');
  marcarCapas();
}
function marcarCapas() {
  document.querySelectorAll('#gCapas button').forEach(b => b.classList.toggle('on', capas.has(b.dataset.gc)));
  document.querySelectorAll('#gEstilo button').forEach(b => b.classList.toggle('on', b.dataset.ge === estilo));
}

window.abrirGemelo = async function (i = gT) {
  cambiarVista('gemelo');
  if (!ren) { armar(); montar(); }
  if (typeof pedirBases === 'function') pedirBases().then(() => { calcular(); aplicarMateriales(); pintarPanel(); });
  medir();
  if (!corre) { corre = true; tAnt = performance.now(); requestAnimationFrame(cuadro); }
  await ponerPersona(i);
};
window.pintarGemelo = function () {
  if (!ren) return;
  calcular(); aplicarMateriales(); pintarPanel();
};
window.novaGemelo = function () {
  const c = CREW[gT]; calcular();
  const lista = REGIONES.map(r => [r, estados[r.id]]).filter(([, s]) => s && ['atencion', 'aviso_tierra', 'vigilar'].includes(s.nivel));
  $('novaDice').textContent = lista.length ? `In ${c.corto}'s body, ${lista.length === 1 ? 'one thing needs' : `${lista.length} things need`} watching. Click any part to see what space does to it and what to do.`
    : `${c.corto}'s body looks on plan for day ${mision ? mision.dia : '—'}. Click any part to see what space does to it.`;
  const fila = (col, b, txt) => `<div><i style="background:${col}"></i><span><b>${b}</b> ${txt}</span></div>`;
  $('ultimas').innerHTML = (lista.length ? lista : REGIONES.slice(0, 2).map(r => [r, estados[r.id]])).slice(0, 4)
    .map(([r, s]) => fila(COLOR_EST[s.nivel] || 'var(--t3)', r.n, `${s.valor} · ${s.texto}`)).join('');
};

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !ren) return;
  if (b.dataset.gt != null && b.closest('#gQuien')) ponerPersona(+b.dataset.gt);
  else if (b.dataset.gc) { capas.has(b.dataset.gc) ? capas.delete(b.dataset.gc) : capas.add(b.dataset.gc); marcarCapas(); firmaMat = ''; aplicarMateriales(); }
  else if (b.dataset.ge) { estilo = b.dataset.ge; marcarCapas(); firmaMat = ''; aplicarMateriales(); }
  else if (b.dataset.gr != null) elegir(b.dataset.gr);
  else if (b.dataset.greg) abrirRegistro(gT, b.dataset.greg);
  else if (b.dataset.gask) { const r = REGIONES.find(x => x.id === b.dataset.gask); preguntarNova(`How is ${CREW[gT].corto}'s ${r.n.toLowerCase()} doing, and what should we do?`); }
  else if (b.id === 'gHoy') { dia = null; calcular(); aplicarMateriales(); pintarPanel(); }
  else if (b.id === 'gEj') { conEj = !conEj; calcular(); aplicarMateriales(); pintarPanel(); }
  else if (b.id === 'gVer') elegir(null);
  else if (b.dataset.gpose) { galeria.elegida = b.dataset.gpose; galeria.t = 0; pintarPoses(); }
  else if (b.id === 'gEspejo') espejo.on ? apagarEspejo() : prenderEspejo();
  else if (b.id === 'gCamMas') mostrarQr();
  else if (b.id === 'gCamEnc') { espejo.encuadrar = !espejo.encuadrar; panelCamaras(false); }
  else if (b.id === 'gCamara') vistaCamara(!camVista.on);
  else if (b.dataset.gmodo) { camVista.modo = b.dataset.gmodo; aplicarMezcla(); }
  else if (b.id === 'gFoco' || b.id === 'gFocoSal') ponerFoco(!$('gem').classList.contains('foco'));
  else if (b.id === 'gPantalla') { const g = $('gem'); document.fullscreenElement ? document.exitFullscreen() : g.requestFullscreen?.().catch(() => {}); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'gMezcla') { camVista.mezcla = e.target.value / 100; aplicarMezcla(); return; }
  if (e.target.id !== 'gDia' || !mision) return;
  const v = +e.target.value; dia = Math.abs(v - mision.dia) < 2 ? null : v;
  calcular(); aplicarMateriales(); pintarPanel();
});
document.addEventListener('keydown', e => {
  if (vista !== 'gemelo' || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if (e.key === 'Escape' && sel) elegir(null);
  else if (e.key === 'f' || e.key === 'F') ponerFoco(!$('gem').classList.contains('foco'));
});
// vista de cámara: tu video de fondo y encima el mismo gemelo (todas sus capas), proyectado con la perspectiva de la
// cámara y calzado sobre tu cuerpo en la imagen: escala y posición por mínimos cuadrados sobre hombros, codos, muñecas,
// caderas, rodillas y tobillos, y luego cada hueso del brazo y la pierna se corrige para caer en su punto de la imagen.
const camVista = { on: false, s: null, T: null, mezcla: .55, modo: 'screen' };
// mezcla 0 = solo la cámara · 1 = solo el gemelo; el modo decide cómo se suman (normal, luz o rayos X)
function aplicarMezcla() {
  const m = camVista.mezcla, v = espejo.video, c = ren && ren.domElement; if (!v || !c) return;
  v.style.opacity = String(1 - .88 * Math.max(0, m - .35) / .65);
  v.style.filter = camVista.modo === 'rayosx' ? `grayscale(1) contrast(1.15) brightness(${(.75 - .35 * m).toFixed(2)})` : `brightness(${(1 - .45 * m).toFixed(2)})`;
  const k = $('gComp') || c;
  k.style.opacity = String(Math.min(1, .15 + 1.7 * m));
  k.style.mixBlendMode = camVista.modo === 'normal' ? 'normal' : camVista.modo === 'rayosx' ? 'screen' : 'lighten';
  if (k !== c) c.style.opacity = '0';
  const r = $('gMezcla'); if (r && +r.value !== Math.round(m * 100)) r.value = Math.round(m * 100);
  document.querySelectorAll('#gMezclaBar [data-gmodo]').forEach(b => b.classList.toggle('on', b.dataset.gmodo === camVista.modo));
}
function barraMezcla(on) {
  let b = $('gMezclaBar');
  if (!on) { if (b) b.remove(); $('gComp')?.remove(); const c = ren && ren.domElement; if (c) { c.style.opacity = ''; c.style.mixBlendMode = ''; } return; }
  if (!$('gComp')) { const cc = document.createElement('canvas'); cc.id = 'gComp';
    cc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;filter:drop-shadow(0 0 3px rgba(143,230,245,.5)) drop-shadow(0 0 14px rgba(110,190,255,.25))';
    cajaEl.appendChild(cc); }
  if (!b) {
    b = document.createElement('div'); b.id = 'gMezclaBar';
    b.innerHTML = `<span>Camera</span><input type="range" id="gMezcla" min="0" max="100" value="${Math.round(camVista.mezcla * 100)}"><span>Twin</span>
      <i></i><button data-gmodo="normal">Normal</button><button data-gmodo="screen">Light</button><button data-gmodo="rayosx">X-ray</button>`;
    $('gem').appendChild(b);
  }
  aplicarMezcla();
}
async function vistaCamara(on) {
  const g = $('gem');
  if (!on) {
    camVista.on = false; g.classList.remove('camara'); $('gCamara')?.classList.remove('on'); barraMezcla(false);
    if (espejo.video) espejo.video.style.cssText = ESTILO_MINI;
    if (espejo.on && espejo.encuadrar) { espejo.encuadrado = true; camVista.s = null; camVista.T = null; requestAnimationFrame(medir); return; }
    espejo.encuadrado = false; vistaLibre(); return;
  }
  if (!espejo.on) await prenderEspejo();
  if (!espejo.on || !espejo.video) return;
  camVista.on = true; camVista.s = null; g.classList.add('camara'); $('gCamara')?.classList.add('on');
  espejo.video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);z-index:0;pointer-events:none';
  ren.domElement.style.position = 'relative'; ren.domElement.style.zIndex = '1';
  ctrl.enabled = false; vuelo = null; barraMezcla(true); requestAnimationFrame(medir);
}
// Mirror me encuadra el gemelo como te ve la cámara: misma perspectiva, mismo tamaño y lo mismo dentro del cuadro (si la
// cámara te ve hasta los hombros, el gemelo se ve hasta los hombros). Se puede volver a la vista libre de cuerpo entero.
function encuadrarEspejo() {
  espejo.enc = fuenteEncuadre();
  if (!camVista.on) {
    if (espejo.encuadrar && espejo.enc && !espejo.encuadrado) { espejo.encuadrado = true; ctrl.enabled = false; ctrl.autoRotate = false; vuelo = null; camVista.s = null; camVista.T = null; }
    if (!espejo.encuadrar && espejo.encuadrado) soltarEncuadre();
  }
  if ((camVista.on || espejo.encuadrado) && espejo.enc) calzarACamara();
}
function soltarEncuadre() { espejo.encuadrado = false; vistaLibre(); }
// de vuelta a la vista libre: el gemelo en su lugar y la cámara de frente (encuadrada estaba en el origen, y volar desde
// ahí la dejaba mirando desde arriba)
function vistaLibre() {
  raiz.position.set(0, 0, 0); raiz.scale.setScalar(1); ctrl.enabled = true; cam.fov = 28; cam.updateProjectionMatrix();
  cam.position.set(0, .95, 4.3); cam.quaternion.identity(); ctrl.target.set(0, .9, 0); ctrl.update(); verTodo(); requestAnimationFrame(medir);
}
const ESTILO_MINI = 'position:absolute;left:14px;bottom:14px;width:176px;border-radius:10px;transform:scaleX(-1);opacity:.85;border:1px solid rgba(143,230,245,.35);z-index:3;pointer-events:none';
// el gemelo se dibuja solo dentro de tu silueta (la máscara de MediaPipe, reflejada y en «cover» como el video)
const tmpComp = document.createElement('canvas'), chicoA = document.createElement('canvas'), chicoB = document.createElement('canvas');
function dibujarMascara(ctx, W, H) {
  const v = espejo.video, m = espejo.mascara, vw = v.videoWidth || 640, vh = v.videoHeight || 480, k = Math.max(W / vw, H / vh), dw = vw * k, dh = vh * k;
  ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); ctx.drawImage(m, (W - dw) / 2, (H - dh) / 2, dw, dh); ctx.restore();
}
function componer() {
  const c = $('gComp'), r = ren.domElement; if (!c) return;
  const W = r.width, H = r.height; if (c.width !== W || c.height !== H) { c.width = W; c.height = H; tmpComp.width = W; tmpComp.height = H; }
  const t = tmpComp.getContext('2d'); t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, W, H); t.drawImage(r, 0, 0);
  const hay = espejo.mascara && performance.now() - (espejo.tMascara || 0) < 500;
  if (hay) { t.globalCompositeOperation = 'destination-in'; t.filter = 'blur(2px)'; dibujarMascara(t, W, H); t.filter = 'none'; t.globalCompositeOperation = 'source-over'; }
  const cx = c.getContext('2d'); cx.clearRect(0, 0, W, H); cx.drawImage(tmpComp, 0, 0);
  // calce: cuánto de tu silueta cubre la piel del gemelo y cuánto del gemelo cae fuera de ti (cada ~0,3 s, a 120 px)
  if (hay && performance.now() - (camVista.tFit || 0) > 300) {
    camVista.tFit = performance.now();
    const w = 120, h = Math.round(120 * H / W);
    for (const cv of [chicoA, chicoB]) { cv.width = w; cv.height = h; }
    const a = chicoA.getContext('2d', { willReadFrequently: true }), b = chicoB.getContext('2d', { willReadFrequently: true });
    a.drawImage(r, 0, 0, w, h); dibujarMascara(b, w, h);
    const da = a.getImageData(0, 0, w, h).data, db = b.getImageData(0, 0, w, h).data;
    let mod = 0, per = 0, ambos = 0;
    for (let i = 3; i < da.length; i += 4) { const x = da[i] > 30, y = db[i] > 128; if (x) mod++; if (y) per++; if (x && y) ambos++; }
    camVista.fit = per ? { cubre: ambos / per, fuera: mod ? 1 - ambos / mod : 0 } : null;
  }
}
// del punto normalizado de la imagen (sin reflejar) al NDC del lienzo, con el video reflejado y en «cover»
// de dónde sale el encuadre: con el video detrás (Camera view) es la cámara de este computador; en el espejo, la cámara de
// referencia (este computador o un teléfono, que manda dónde cae cada punto en su imagen y el tamaño de su video)
function fuenteEncuadre() {
  const v = espejo.video;
  if ((camVista.on || espejo.ref === 'local') && v && espejo.n2d) return { n: espejo.n2d, vw: v.videoWidth || 640, vh: v.videoHeight || 480, fov: 60, local: true };
  const c = espejo.camaras.get(espejo.ref);
  if (camVista.on || !c || !c.w || Date.now() - c.t > 400 || !(c.w[0] && c.w[0].length >= 8 && c.w[0][6] > 0)) return null;
  if (c.n2dT !== c.t) { c.n2d = c.w.map(p => ({ x: p[4], y: p[5], z: 0, visibility: p[3] })); c.n2dT = c.t; }
  return { n: c.n2d, vw: c.w[0][6], vh: c.w[0][7], fov: 66, local: false };   // cámara de teléfono: ~66° en su lado largo
}
// cómo cae la imagen de la cámara en el lienzo: con el video detrás lo llena («cover»); en el espejo se ve entera
// («contain»), así el gemelo queda encuadrado exactamente como te ve esa cámara
function lienzoCam() {
  const e = espejo.enc, v = espejo.video, vw = e ? e.vw : v && v.videoWidth || 640, vh = e ? e.vh : v && v.videoHeight || 480;
  const W = cajaEl.offsetWidth, H = cajaEl.offsetHeight;
  return { vw, vh, W, H, k: camVista.on ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh), fov: e ? e.fov : 60 };
}
function aNdc(p) {
  const { vw, vh, W, H, k } = lienzoCam();
  const px = (.5 - p.x) * vw * k + W / 2, py = (p.y - .5) * vh * k + H / 2;
  return [px / W * 2 - 1, -(py / H * 2 - 1)];
}
function camaraDeVideo() {
  const { vw, vh, H, k, fov: fc } = lienzoCam();
  // la cámara abarca fc grados en el lado largo de su imagen (computador ~60°, teléfono ~66°); tv = tangente de la mitad
  // del alto del lienzo, en esa misma escala
  const tv = (H / 2 / k) / (Math.max(vw, vh) / 2 / Math.tan(fc / 2 * Math.PI / 180));
  const fov = 2 * Math.atan(tv) * 180 / Math.PI;
  if (Math.abs(cam.fov - fov) > .01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  cam.position.set(0, 0, 0); cam.quaternion.identity(); return tv;
}
// la altura y el tamaño del gemelo en la imagen salen solo de lo rígido: cara, hombros y caderas. Brazos y piernas se
// acercan y alejan de la cámara (una mano levantada hacia ella se ve el doble de grande) y antes arrastraban todo el
// cuerpo; ahora se calzan después, hueso por hueso. El lado izquierdo del gemelo es tu derecho.
const ANCLAS = [[12, 9, 'hom', 1, 1.5], [24, 3, 'cad', 1, 1], [11, 11, 'hom', -1, 1.5], [23, 6, 'cad', -1, 1]];
const reposo = (k, s) => lad(k === 'mun' ? PIV.mun : J[k], s);
// mínimos cuadrados con pesos: s·q + T = punto de la imagen llevado a la profundidad D → [s, Tx, Ty]
function resolverCalce(pts) {
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  for (const p of pts) for (const [v, r] of [[[p.q.x, 1, 0], p.x], [[p.q.y, 0, 1], p.y]])
    for (let i = 0; i < 3; i++) { b[i] += p.w * v[i] * r; for (let j = 0; j < 3; j++) A[i][j] += p.w * v[i] * v[j]; }
  const M = new THREE.Matrix3().set(...A.flat()); if (Math.abs(M.determinant()) < 1e-9) return null;
  const x = new THREE.Vector3(...b).applyMatrix3(M.invert()); return [x.x, x.y, x.z];
}
function calzarACamara() {
  const n = espejo.enc && espejo.enc.n; if (!n) return;
  const tv = camaraDeVideo(), asp = cajaEl.offsetWidth / cajaEl.offsetHeight, D = 3, pts = [];
  const sumar = (i, q, peso) => { if (!(n[i].visibility > .5) || !dentro(n[i])) return; const [x, y] = aNdc(n[i]); pts.push({ q, x: x * D * tv * asp, y: y * D * tv, w: peso * n[i].visibility }); };
  for (const [i, b, k, sd, peso] of ANCLAS) sumar(i, enP(uS[b], reposo(k, sd)), peso);
  for (const [i, pr] of CABEZA) sumar(i, enP(uS[2], pr), 1);
  if (pts.length < 3) return;
  let sol = resolverCalce(pts);
  // un punto mal leído (una oreja tapada por la mano) no mueve todo: se descarta el que se aleja mucho y se resuelve otra vez
  if (sol && pts.length > 4) {
    const res = pts.map(p => Math.hypot(sol[0] * p.q.x + sol[1] - p.x, sol[0] * p.q.y + sol[2] - p.y)), med = [...res].sort((a, b) => a - b)[res.length >> 1];
    const buenos = pts.filter((_, j) => res[j] <= Math.max(2.5 * med, .02));
    if (buenos.length >= 3 && buenos.length < pts.length) sol = resolverCalce(buenos) || sol;
  }
  if (!sol || !(sol[0] > .2 && sol[0] < 5)) return;
  // un salto grande de tamaño casi siempre es un cuadro malo: se acepta, pero despacio
  const k = camVista.s == null ? 1 : Math.abs(sol[0] / camVista.s - 1) > .3 ? .08 : .4, T = new THREE.Vector3(sol[1], sol[2], -D);
  camVista.s = camVista.s == null ? sol[0] : camVista.s + (sol[0] - camVista.s) * k;
  camVista.T = camVista.T ? camVista.T.lerp(T, k) : T;
  raiz.scale.setScalar(camVista.s); raiz.position.copy(camVista.T);
  ajusteFino(n, tv, asp);
}
// cada articulación vista se lleva a su punto exacto de la imagen, a la profundidad que ya tenía: se traslada el pivote,
// se gira el hueso hacia el punto del hijo y se estira a su largo real; los huesos que cuelgan heredan el cambio
const filtros2d = {};
function punto2d(i, n) {
  const f = filtros2d[i] || (filtros2d[i] = [new UnoEuro(1.2, 2), new UnoEuro(1.2, 2)]), d = 1 / 30;
  return { x: f[0].paso(n[i].x, d), y: f[1].paso(n[i].y, d) };
}
function objetivo(i, n, qModelo, tv, asp) {   // punto de la imagen → espacio del modelo, a la profundidad de qModelo
  if (!(n[i].visibility > .5) || !dentro(n[i])) return null;
  const s = camVista.s, T = camVista.T, Z = s * qModelo.z + T.z, [x, y] = aNdc(punto2d(i, n));
  return new THREE.Vector3(x * -Z * tv * asp, y * -Z * tv, Z).sub(T).multiplyScalar(1 / s);
}
function moverHueso(b, nuevo) {   // nuevo = matriz del hueso b; sus descendientes reciben el mismo cambio
  const delta = nuevo.clone().multiply(uS[b].clone().invert()); uS[b].copy(nuevo);
  for (const d of DESC[b]) uS[d].premultiply(delta);
}
function corregir(b, pReposo, hReposo, objP, objH) {
  const M = uS[b], pAhora = enP(M, pReposo), hAhora = enP(M, hReposo), P0 = objP || pAhora;
  if (!objH && !objP) return;
  const a = hAhora.clone().sub(pAhora), bb = objH ? objH.clone().sub(P0) : a.clone();
  const k = Math.min(1.6, Math.max(.6, bb.length() / Math.max(1e-4, a.length())));
  const q = new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), bb.clone().normalize());
  const nuevo = new THREE.Matrix4().makeTranslation(P0.x, P0.y, P0.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
    .multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(new THREE.Matrix4().makeTranslation(-pAhora.x, -pAhora.y, -pAhora.z)).multiply(M);
  moverHueso(b, nuevo);
}
// ensancha un hueso del tronco en su eje izquierda-derecha (sin tocar a sus hijos: los brazos ya van a tus hombros)
function ensanchar(b, k) {
  const M = uS[b], eje = new THREE.Vector3().setFromMatrixColumn(M, 0).normalize(), piv = enP(M, b === 0 ? J.pel : b === 1 ? J.cin : PIV.cha);
  const S = new THREE.Matrix4().set(
    1 + (k - 1) * eje.x * eje.x, (k - 1) * eje.x * eje.y, (k - 1) * eje.x * eje.z, 0,
    (k - 1) * eje.y * eje.x, 1 + (k - 1) * eje.y * eje.y, (k - 1) * eje.y * eje.z, 0,
    (k - 1) * eje.z * eje.x, (k - 1) * eje.z * eje.y, 1 + (k - 1) * eje.z * eje.z, 0, 0, 0, 0, 1);
  uS[b].premultiply(new THREE.Matrix4().makeTranslation(-piv.x, -piv.y, -piv.z)).premultiply(S).premultiply(new THREE.Matrix4().makeTranslation(piv.x, piv.y, piv.z));
}
// ancho de la silueta perpendicular al hueso, en su punto medio (caminando en la máscara hasta salir del cuerpo)
function anchoSilueta(a, b, maxPx) {
  const d = espejo.mDatos, w = espejo.mW, h = espejo.mH; if (!d) return null;
  const ax = a.x * w, ay = a.y * h, bx = b.x * w, by = b.y * h, L = Math.hypot(bx - ax, by - ay); if (L < 8) return null;
  const px = -(by - ay) / L, py = (bx - ax) / L, mx = (ax + bx) / 2, my = (ay + by) / 2;
  const lado = sg => { for (let t = 0; t < maxPx; t++) { const x = Math.round(mx + sg * px * t), y = Math.round(my + sg * py * t);
    if (x < 0 || y < 0 || x >= w || y >= h || d[y * w + x] < .5) return t; } return null; };
  const t1 = lado(1), t2 = lado(-1); return t1 == null || t2 == null ? null : t1 + t2;
}
function grosor(b, n, i0, i1, p0, p1, r0, tv) {
  if (!camVista.on) return;
  if (!(n[i0].visibility > .5 && n[i1].visibility > .5) || !dentro(n[i0]) || !dentro(n[i1])) return;
  const M = uS[b], P = enP(M, p0), C = enP(M, p1), mid = P.clone().add(C).multiplyScalar(.5);
  const Z = camVista.s * mid.z + camVista.T.z, v = espejo.video, H = cajaEl.offsetHeight, vh = v.videoHeight || 480, kc = Math.max(cajaEl.offsetWidth / (v.videoWidth || 640), H / vh);
  const eje = C.clone().sub(P), escala = eje.length() / Math.max(1e-4, new THREE.Vector3(...p1).distanceTo(new THREE.Vector3(...p0)));
  const rPx = r0 * escala * camVista.s / -Z / tv * (H / 2) / kc * (espejo.mH / vh);   // radio del gemelo en píxeles de la máscara
  const obs = anchoSilueta(n[i0], n[i1], Math.round(rPx * 2.6)); if (obs == null) return;
  const r = THREE.MathUtils.clamp(obs / (2 * rPx), .75, 1.5), g = camVista.gro || (camVista.gro = {});
  g[b] = g[b] ? g[b] + (r - g[b]) * .2 : r;
  const a = eje.normalize(), k = g[b];
  const S = new THREE.Matrix4().set(k + (1 - k) * a.x * a.x, (1 - k) * a.x * a.y, (1 - k) * a.x * a.z, 0, (1 - k) * a.y * a.x, k + (1 - k) * a.y * a.y, (1 - k) * a.y * a.z, 0,
    (1 - k) * a.z * a.x, (1 - k) * a.z * a.y, k + (1 - k) * a.z * a.z, 0, 0, 0, 0, 1);
  uS[b].premultiply(new THREE.Matrix4().makeTranslation(-P.x, -P.y, -P.z)).premultiply(S).premultiply(new THREE.Matrix4().makeTranslation(P.x, P.y, P.z));
}
// visibilidad por hueso (0–1, suavizada): lo que la cámara no ve se desvanece en vez de dibujarse adivinado
const visHueso = new Float32Array(NB).fill(1);
function ponerVis(b, v, dt) { visHueso[b] += (v - visHueso[b]) * Math.min(1, dt * 6); const q = HU.uVis.value[b >> 2]; q.setComponent(b & 3, visHueso[b]); }
function visibilidades(n, dt) {
  const ve = i => n && n[i] && dentro(n[i]) ? THREE.MathUtils.clamp((n[i].visibility - .35) / .4, 0, 1) : 0;
  const todos = on => { for (let b = 0; b < NB; b++) ponerVis(b, on, dt); };
  if (!(camVista.on || espejo.encuadrado) || !n) { todos(1); return; }
  for (const b of [0, 1, 13]) ponerVis(b, Math.max(.35, Math.min(ve(11), ve(12), Math.max(ve(23), ve(24), .6))), dt);
  const vc = Math.max(ve(0), ve(7), ve(8), espejo.rostro ? 1 : 0);
  for (const b of [2, B_MAND, B_OJO(1), B_OJO(-1), B_PARP(1), B_PARP(-1)]) ponerVis(b, vc, dt);
  for (const [s, I] of [[1, { hom: 12, cod: 14, mun: 16, cad: 24, rod: 26, tob: 28 }], [-1, { hom: 11, cod: 13, mun: 15, cad: 23, rod: 25, tob: 27 }]]) {
    const [bb, aa, mm, pp, pie, mano] = s > 0 ? [9, 10, 3, 4, 5, 14] : [11, 12, 6, 7, 8, 15];
    // con la mano a la vista, el brazo se dibuja aunque el codo quede fuera (se resuelve con sus largos)
    const m2 = espejo.mano2d && espejo.mano2d[s > 0 ? 'D' : 'I'] ? 1 : 0, vm = Math.max(ve(I.mun), m2);
    ponerVis(bb, Math.min(ve(I.hom), Math.max(ve(I.cod), m2)), dt); ponerVis(aa, Math.max(Math.min(ve(I.cod), ve(I.mun)), m2), dt); ponerVis(mano, vm, dt);
    for (let j = 0; j < 15; j++) ponerVis(B_DEDO(s) + j, vm, dt);
    ponerVis(mm, Math.min(ve(I.cad), ve(I.rod)), dt); ponerVis(pp, Math.min(ve(I.rod), ve(I.tob)), dt); ponerVis(pie, ve(I.tob), dt);
  }
}
const CABEZA = [[0, [0, 1.605, .105]], [2, [-.032, 1.635, .075]], [5, [.032, 1.635, .075]], [7, [-.075, 1.6, -.005]], [8, [.075, 1.6, -.005]]];
// el punto de la imagen fija un rayo desde la cámara; sobre ese rayo se elige el punto que deja al hueso con su largo
// (de las dos soluciones, la más cercana a la profundidad que estima el modelo 3D). Así un antebrazo que apunta a la
// cámara no se aplasta: se acorta en la imagen porque va hacia ti, no porque se encoja.
function objetivoRayo(i, n, padre, hijo, tv, asp, largo) {   // largo: el del hueso si no se da
  if (!(n[i].visibility > .5) || !dentro(n[i])) return null;
  const s = camVista.s, T = camVista.T, [x, y] = aNdc(punto2d(i, n));
  const P = padre.clone().multiplyScalar(s).add(T), H = hijo.clone().multiplyScalar(s).add(T), L = largo != null ? largo * s : H.distanceTo(P);
  const d = new THREE.Vector3(x * tv * asp, y * tv, -1).normalize(), b = d.dot(P), c = P.lengthSq() - L * L, disc = b * b - c;
  let t;
  if (disc < 0) t = b;   // el punto queda más lejos que el largo del hueso: el más cercano posible (el hueso se estira)
  else { const t1 = b - Math.sqrt(disc), t2 = b + Math.sqrt(disc), z = -H.z; t = Math.abs(t1 * -d.z - z) < Math.abs(t2 * -d.z - z) ? t1 : t2; }
  return d.multiplyScalar(t).sub(T).multiplyScalar(1 / s);
}
// dos huesos (hombro → codo → muñeca) con sus largos: el codo queda en el círculo posible, del lado donde ya estaba
function codoIK(S, W, L1, L2, guia) {
  const u = W.clone().sub(S), d = lim(u.length(), Math.abs(L1 - L2) + 1e-3, (L1 + L2) * .999); u.normalize();
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const p = guia.clone().sub(S); p.addScaledVector(u, -p.dot(u));
  if (p.lengthSq() < 1e-6) p.set(0, -1, 0).addScaledVector(u, u.y);
  return S.clone().addScaledVector(u, a).addScaledVector(p.normalize(), h);
}
function ajusteFino(n, tv, asp) {
  // cabeza: se traslada para que nariz, ojos y orejas caigan en la cara (el cuello absorbe la diferencia)
  const dif = new THREE.Vector3(); let c = 0;
  for (const [i, pr] of CABEZA) { const q = enP(uS[2], pr), o = objetivo(i, n, q, tv, asp); if (o) { dif.add(o.sub(q)); c++; } }
  if (c >= 2) moverHueso(2, new THREE.Matrix4().makeTranslation(dif.x / c, dif.y / c, dif.z / c).multiply(uS[2]));
  // tamaño de la cabeza: el ancho entre tus orejas
  { const qD = enP(uS[2], CABEZA[4][1]), qI = enP(uS[2], CABEZA[3][1]), oD = objetivo(8, n, qD, tv, asp), oI = objetivo(7, n, qI, tv, asp);
    if (oD && oI) { const r = THREE.MathUtils.clamp(oD.distanceTo(oI) / qD.distanceTo(qI), .8, 1.4);
      camVista.cab = camVista.cab ? camVista.cab + (r - camVista.cab) * .2 : r;
      const c0 = oD.clone().add(oI).multiplyScalar(.5), k = camVista.cab;
      moverHueso(2, new THREE.Matrix4().makeTranslation(c0.x, c0.y, c0.z).multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(new THREE.Matrix4().makeTranslation(-c0.x, -c0.y, -c0.z)).multiply(uS[2])); } }
  // columna: el tórax gira (con su largo) para que el medio de tus hombros caiga en su punto de la imagen
  { const medR = [0, 1.39, -.025], P = enP(uS[13], PIV.cha), Q = enP(uS[13], medR);
    const nm = n[11] && n[12] && n[11].visibility > .5 && n[12].visibility > .5 && dentro(n[11]) && dentro(n[12])
      ? Object.assign([], { 33: { x: (n[11].x + n[12].x) / 2, y: (n[11].y + n[12].y) / 2, z: 0, visibility: 1 } }) : null;
    if (nm) { const o = objetivoRayo(33, nm, P, Q, tv, asp); if (o) corregir(13, PIV.cha, medR, null, o); } }
  // ancho del tronco: la distancia real entre tus hombros (y caderas) frente a la del gemelo
  const hD = enP(uS[9], J.hom), hI = enP(uS[11], lad(J.hom, -1)), oD = objetivo(12, n, hD, tv, asp), oI = objetivo(11, n, hI, tv, asp);
  if (oD && oI) {
    const r = THREE.MathUtils.clamp(oD.distanceTo(oI) / hD.distanceTo(hI), .8, 1.35);
    camVista.anchoT = camVista.anchoT ? camVista.anchoT + (r - camVista.anchoT) * .2 : r;
    for (const b of [13, 1, 0]) ensanchar(b, camVista.anchoT);
  }
  // brazos y piernas (izquierda del gemelo = tu derecha)
  for (const [s, k] of [[1, 'D'], [-1, 'I']]) {
    const I = k === 'D' ? { hom: 12, cod: 14, mun: 16, cad: 24, rod: 26, tob: 28 } : { hom: 11, cod: 13, mun: 15, cad: 23, rod: 25, tob: 27 };
    const [bb, aa, mm, pp] = s > 0 ? [9, 10, 3, 4] : [11, 12, 6, 7];
    const hom = lad(J.hom, s), cod = lad(J.cod, s), mun = lad(PIV.mun, s), cad = lad(J.cad, s), rod = lad(J.rod, s), tob = lad(J.tob, s);
    // la muñeca: la de la mano (21 puntos, más precisa) si se ve; si no, la del cuerpo
    const h2 = espejo.enc && espejo.enc.local && espejo.mano2d && espejo.mano2d[k], nn = h2 ? n.slice() : n;
    if (h2) nn[I.mun] = { x: h2[0].x, y: h2[0].y, z: 0, visibility: 1 };
    corregir(bb, hom, cod, objetivo(I.hom, n, enP(uS[bb], hom), tv, asp), null);
    if (n[I.cod].visibility > .5 && dentro(n[I.cod])) {
      corregir(bb, hom, cod, null, objetivoRayo(I.cod, n, enP(uS[bb], hom), enP(uS[bb], cod), tv, asp));
      corregir(aa, cod, mun, null, objetivoRayo(I.mun, nn, enP(uS[aa], cod), enP(uS[aa], mun), tv, asp));
    } else {
      // el codo fuera de la imagen (bajo el escritorio) y la mano a la vista: el codo se resuelve con los largos del brazo
      const S = enP(uS[bb], hom), E0 = enP(uS[bb], cod), W0 = enP(uS[aa], mun), L1 = S.distanceTo(E0), L2 = E0.distanceTo(W0);
      const W = objetivoRayo(I.mun, nn, S, W0, tv, asp, Math.min(S.distanceTo(W0), .97 * (L1 + L2)));
      if (W) { corregir(bb, hom, cod, null, codoIK(S, W, L1, L2, E0)); corregir(aa, cod, mun, null, W); }
    }
    corregir(mm, cad, rod, objetivo(I.cad, n, enP(uS[mm], cad), tv, asp), null);
    corregir(mm, cad, rod, null, objetivoRayo(I.rod, n, enP(uS[mm], cad), enP(uS[mm], rod), tv, asp));
    corregir(pp, rod, tob, null, objetivoRayo(I.tob, n, enP(uS[pp], rod), enP(uS[pp], tob), tv, asp));
    // grosor de cada extremidad: el ancho de tu silueta a mitad del hueso
    for (const [b, i0, i1, p0, p1, r0] of [[bb, I.hom, I.cod, hom, cod, .045], [aa, I.cod, I.mun, cod, mun, .037], [mm, I.cad, I.rod, cad, rod, .08], [pp, I.rod, I.tob, rod, tob, .055]])
      grosor(b, n, i0, i1, p0, p1, r0, tv);
  }
}
// foco: solo el gemelo, sin la tabla de regiones, las tarjetas, las líneas ni el anillo de escaneo
function ponerFoco(on) {
  const g = $('gem'); g.classList.toggle('foco', on);
  const b = $('gFoco'); if (b) b.classList.toggle('on', on);
  if (on) { sel = null; firmaMat = ''; aplicarMateriales(); }
  requestAnimationFrame(medir);
}
