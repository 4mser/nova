/* Convierte el set femenino del Human Reference Atlas (HuBMAP, CC BY 4.0) al formato de la anatomía de NOVA
   (el mismo de Human Atlas para BodyParts3D): bloques binarios con posiciones float32, normales int16 e índices uint32,
   y un atlas.json con cada estructura, su sistema y sus límites.

   Uso: node convertir-mujer.mjs <3d-vh-f-united.glb> <carpeta de salida>
   Necesita @gltf-transform/core y meshoptimizer (npm i @gltf-transform/core meshoptimizer).
   Adaptaciones: coordenadas llevadas al piso (pies en y = 0, centro en x/z = 0); cada malla simplificada con
   meshoptimizer (error relativo 0,3 %); normales recalculadas; se dejan fuera las estructuras del embarazo
   (placenta, amnios, cordón) y el modelo de ganglio linfático aumentado. */
import { NodeIO } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'fs';
import path from 'path';

const [, , entrada, salida] = process.argv;
if (!entrada || !salida) { console.error('uso: node convertir-mujer.mjs <glb> <salida>'); process.exit(1); }
await MeshoptSimplifier.ready;
fs.mkdirSync(salida, { recursive: true });

const FUERA = /placenta|amnion|umbilical|chorionic|basal_plate|^Yao_/i;
const SISTEMA = [
  [/^Allen_|spinal_cord|optic_nerve|optic_chiasm|dura_mater/i, 'nervous'],
  [/extraocular|rectus_femoris|quadriceps/i, 'muscular'],
  [/retina|fovea|macula|optic_disc|sclera|choroid|pupil|ciliary|lens|schlemm|aqueous|vitreous|iris|conjunctiva|cornea|trabecular|ora_serrata/i, 'sensory'],
  [/ventricle|atrium|interventricular|papillary_muscle|_valve/i, 'cardiac'],
  [/artery|aorta|aortic_arch|pulmonary_trunk|celiac_trunk|carotid|subclavian|brachiocephalic/i, 'arterial'],
  [/vein|vena_cava|coronary_sinus/i, 'venous'],
  [/bronch|hilum_(upper|lower|middle)?_?[LR]$|trachea|carina|arytenoid|cricoid|thyroid_cartilage|epiglot|corniculate/i, 'respiratory'],
  [/kidney|renal|calyx|ureter|bladder/i, 'urinary'],
  [/uter|ovar|fallopian|vagina|cervi|broad_ligament|mesosalpinx|mesovarium|cornua|mammary|lactiferous|areola|nipple|suspensory_ligaments_[LR]/i, 'reproductive'],
  [/spleen|thymus|tonsil/i, 'lymphatic'],
  [/colon|duoden|jejenum|ileum|ileocecal|caecum|appendix|rectum|liver|hepat|segment$|segment1$|quadrate|caudate|pancrea|ucinate|gallbladder|bile|cystic_duct|porta|falciform|ligamentum_venosum|round_ligament_of_liver|coronary_ligament|triangular_ligament/i, 'digestive'],
  [/ligament|meniscus|cartilage_of_knee|tendon/i, 'connective'],
  [/vertebra|sacrum|coccyx|pubis|ilium|ischium|femur|condyle|tibia|fibula|patella|trochlear|enthesis|perichondular|intercondylar/i, 'skeletal'],
  [/skin|fat_[LR]/i, 'integumentary'],
];
const sistemaDe = n => (SISTEMA.find(([r]) => r.test(n)) || [, 'connective'])[1];
const bonito = n => {
  let s = n.replace(/^VH_F_|^Allen_/, '').replace(/_+/g, ' ').trim();
  let lado = '';
  s = s.replace(/\s([LR])(\s[a-k])?$/, (m, l, x) => { lado = l === 'L' ? 'Left ' : 'Right '; return x || ''; });
  s = s.replace(/\s([LR])\s(sup|inf)$/, (m, l, x) => { lado = l === 'L' ? 'Left ' : 'Right '; return ' ' + x; });
  s = (lado + s).replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const doc = await new NodeIO().read(entrada);
const partes = [];
for (const nodo of doc.getRoot().listNodes()) {
  const malla = nodo.getMesh(); if (!malla) continue;
  const nombre = nodo.getName(); if (FUERA.test(nombre)) continue;
  const M = nodo.getWorldMatrix();
  const pos = [], idx = [];
  for (const prim of malla.listPrimitives()) {
    const a = prim.getAttribute('POSITION'); if (!a) continue;
    const base = pos.length / 3, n = a.getCount(), v = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      a.getElement(i, v);
      pos.push(M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14]);
    }
    const ix = prim.getIndices();
    if (ix) for (let i = 0; i < ix.getCount(); i++) idx.push(base + ix.getScalar(i));
    else for (let i = 0; i < n; i++) idx.push(base + i);
  }
  if (idx.length < 3) continue;
  partes.push({ nombre, pos: new Float32Array(pos), idx: new Uint32Array(idx) });
}

// piso y centro
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const p of partes) for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.pos[i + k]); mx[k] = Math.max(mx[k], p.pos[i + k]); }
const off = [-(mn[0] + mx[0]) / 2, -mn[1], -(mn[2] + mx[2]) / 2];
console.log('alto', (mx[1] - mn[1]).toFixed(3), 'm · estructuras', partes.length);

const out = { version: 'nova-1', sex: 'female', source: 'HuBMAP HRA 3D Reference Organ Set, Female v1.5', scope: 'Adult female reference organs, partial skeleton', parts: [], chunks: [] };
let bloque = [], tamBloque = 0, nBloque = 0, triTotal = 0;
const cerrar = () => {
  if (!bloque.length) return;
  const buf = Buffer.concat(bloque); fs.writeFileSync(path.join(salida, `body-${nBloque}.bin`), buf);
  out.chunks.push({ url: `body-${nBloque}.bin`, bytes: buf.length });
  bloque = []; tamBloque = 0; nBloque++;
};
const alinear = b => b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - b.length % 4)]) : b;
for (const p of partes) {
  for (let i = 0; i < p.pos.length; i += 3) { p.pos[i] += off[0]; p.pos[i + 1] += off[1]; p.pos[i + 2] += off[2]; }
  // soldar vértices repetidos antes de simplificar (las mallas vienen con caras sueltas)
  const mapa = new Map(), nuevos = [], remap = new Uint32Array(p.pos.length / 3);
  for (let i = 0; i < p.pos.length / 3; i++) {
    const k = `${Math.round(p.pos[i * 3] * 1e5)},${Math.round(p.pos[i * 3 + 1] * 1e5)},${Math.round(p.pos[i * 3 + 2] * 1e5)}`;
    let j = mapa.get(k); if (j === undefined) { j = nuevos.length / 3; mapa.set(k, j); nuevos.push(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]); }
    remap[i] = j;
  }
  let pos = new Float32Array(nuevos), idx = p.idx.map(i => remap[i]);
  if (idx.length > 300) {
    const objetivo = Math.max(300, Math.floor(idx.length / 3 * .3) * 3);
    const [s] = MeshoptSimplifier.simplify(idx, pos, 3, objetivo, 0.003);
    if (s.length >= 3) idx = s;
  }
  // compactar vértices usados
  const usa = new Int32Array(pos.length / 3).fill(-1), p2 = [];
  const i2 = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) { let j = usa[idx[i]]; if (j < 0) { j = usa[idx[i]] = p2.length / 3; p2.push(pos[idx[i] * 3], pos[idx[i] * 3 + 1], pos[idx[i] * 3 + 2]); } i2[i] = j; }
  pos = new Float32Array(p2); idx = i2;
  // normales suaves
  const nor = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const q of [a, b, c]) { nor[q] += nx; nor[q + 1] += ny; nor[q + 2] += nz; }
  }
  const n16 = new Int16Array(nor.length);
  let bmin = [1e9, 1e9, 1e9], bmax = [-1e9, -1e9, -1e9];
  for (let i = 0; i < nor.length; i += 3) {
    const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
    for (let k = 0; k < 3; k++) { n16[i + k] = Math.round(nor[i + k] / l * 32767); bmin[k] = Math.min(bmin[k], pos[i + k]); bmax[k] = Math.max(bmax[k], pos[i + k]); }
  }
  const bp = alinear(Buffer.from(pos.buffer)), bn = alinear(Buffer.from(n16.buffer)), bi = Buffer.from(idx.buffer);
  if (tamBloque > 4e6) cerrar();
  out.parts.push({ id: p.nombre, name: bonito(p.nombre), system: sistemaDe(p.nombre), chunk: nBloque, positions: tamBloque, normals: tamBloque + bp.length, indices: tamBloque + bp.length + bn.length,
    vertexCount: pos.length / 3, indexCount: idx.length, bounds: [bmin.map(v => +v.toFixed(5)), bmax.map(v => +v.toFixed(5))] });
  bloque.push(bp, bn, bi); tamBloque += bp.length + bn.length + bi.length; triTotal += idx.length / 3;
}
cerrar();
out.triangles = triTotal;
fs.writeFileSync(path.join(salida, 'atlas.json'), JSON.stringify(out));
const c = {}; out.parts.forEach(p => c[p.system] = (c[p.system] || 0) + 1);
console.log('triángulos', triTotal, '· bloques', out.chunks.length, '·', JSON.stringify(c));
