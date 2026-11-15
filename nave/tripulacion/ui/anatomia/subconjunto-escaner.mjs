// Arma el subconjunto liviano de anatomía para el escáner AR (celular y estación): solo lo que se ve "por dentro" del torso
// y la cabeza (corazón, pulmones, abdomen, riñones, caja torácica, columna, pelvis, cerebro, grandes vasos).
// Uso: node anatomia/subconjunto-escaner.mjs   → anatomia/escaner/hombre.json + hombre.bin.gz
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.dirname(new URL(import.meta.url).pathname);
const sx = 'hombre', atlas = JSON.parse(fs.readFileSync(path.join(DIR, sx, 'atlas.json')));
const bufs = atlas.chunks.map((_, i) => zlib.gunzipSync(fs.readFileSync(path.join(DIR, sx, `body-${i}.bin.gz`))));
// BodyParts3D no trae el hígado completo (solo el lóbulo caudado): se toma la cápsula del set femenino (HuBMAP, CC BY 4.0)
// y se lleva al cuerpo masculino calzando el lóbulo caudado de ambos modelos.
const atlasM = JSON.parse(fs.readFileSync(path.join(DIR, 'mujer', 'atlas.json')));
const bufsM = atlasM.chunks.map((_, i) => { const f = path.join(DIR, 'mujer', `body-${i}.bin.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)) : fs.readFileSync(path.join(DIR, 'mujer', `body-${i}.bin`)); });
const DESPLAZA_HIGADO = [-0.010, 0.059, -0.029];
const GRUPOS = [
  ['corazon', p => (p.system === 'cardiac' && !/ventricle of brain|lateral ventricle|third ventricle|fourth ventricle|interventricular foramen|choroid/i.test(p.name)) || /coronary|cardiac vein/i.test(p.name)],
  ['vasos', p => /^(arch of aorta|ascending aorta|descending thoracic aorta|abdominal aorta|descending aorta|inferior vena cava|superior vena cava|pulmonary trunk)$/i.test(p.name)],
  ['pulmones', p => p.system === 'respiratory' && !/nasal|pharyn|epiglott|palat|stylo|salpingo|concha|arytenoid|cricoid|thyroid|corniculate|larynx|vocal|cuneiform|ventricular fold/i.test(p.name)],
  ['higado', p => /liver|hepatic|gallbladder|cystic duct|bile duct/i.test(p.name) && p.system === 'digestive'],
  ['estomago', p => /stomach|esophag|oesophag/i.test(p.name) && p.system === 'digestive'],
  ['intestinos', p => /colon|intestine|jejun|ileum|duoden|caecum|cecum|rectum|appendix|sigmoid/i.test(p.name) && p.system === 'digestive'],
  ['bazo', p => /spleen|pancrea/i.test(p.name)],
  ['rinones', p => p.system === 'urinary' && /kidney|ureter|bladder/i.test(p.name)],
  ['cerebro', p => p.system === 'nervous' && !/nerve|ganglion|spinal|cord|dura|chiasm|plexus|nasociliary/i.test(p.name) && p.bounds[0][1] > 1.5],
  ['esqueleto', p => p.system === 'skeletal' && (/\brib\b|costal cartilage|sternum|manubrium|xiphoid|clavicle|scapula|thoracic vertebra|lumbar vertebra|cervical vertebra|atlas|axis|hip bone|sacrum|coccyx/i.test(p.name))],
  // the rest of the skeleton, one rigid segment per bone group, each carried by its own limb in the picture
  ['hueso', p => p.system === 'skeletal'],
];
const out = [], partes = []; let off = 0, verts = 0;
const pegar = b => { const pad = (4 - (off % 4)) % 4; if (pad) { out.push(Buffer.alloc(pad)); off += pad; } const o = off; out.push(Buffer.from(b)); off += b.byteLength; return o; };
for (const p of atlas.parts) {
  const g = GRUPOS.find(([, es]) => es(p)); if (!g) continue;
  if (p.bounds[1][1] < .75 && g[0] !== 'hueso') continue; // only bones go below the pelvis
  let grupo = g[0];
  if (grupo === 'hueso') { // which limb segment this bone belongs to, by name and place
    const c = [0, 1, 2].map(i => (p.bounds[0][i] + p.bounds[1][i]) / 2), lado = c[0] >= 0 ? 'I' : 'D', n = p.name;
    if (c[1] > 1.49 && Math.abs(c[0]) < .09) grupo = 'craneo';
    else if (/humerus/i.test(n)) grupo = 'brazo' + lado;
    else if (/radius|ulna/i.test(n) || (c[1] > .75 && c[1] < .92 && Math.abs(c[0]) > .19)) grupo = 'antebrazo' + lado; // forearm + hand
    else if (/femur|patella/i.test(n)) grupo = 'muslo' + lado;
    else if (/tibia|fibula/i.test(n) || c[1] < .44) grupo = 'pierna' + lado;                                         // shin + foot
    else continue;
  }
  const b = bufs[p.chunk];
  const pos = b.subarray(p.positions, p.positions + p.vertexCount * 12), nor = b.subarray(p.normals, p.normals + p.vertexCount * 6);
  const idx = new Uint32Array(b.buffer.slice(b.byteOffset + p.indices, b.byteOffset + p.indices + p.indexCount * 4));
  const i16 = p.vertexCount < 65536, ib = i16 ? Buffer.from(new Uint16Array(idx).buffer) : Buffer.from(idx.buffer);
  partes.push({ id: p.id, name: p.name, grupo, vertexCount: p.vertexCount, indexCount: p.indexCount, i16, positions: pegar(pos), normals: pegar(nor), indices: pegar(ib), bounds: p.bounds });
  verts += p.vertexCount;
}
for (const p of atlasM.parts.filter(p => /^Capsule of the liver$/.test(p.name))) {
  const b = bufsM[p.chunk];
  const pos = new Float32Array(b.buffer.slice(b.byteOffset + p.positions, b.byteOffset + p.positions + p.vertexCount * 12));
  for (let i = 0; i < pos.length; i++) pos[i] += DESPLAZA_HIGADO[i % 3];
  const nor = b.subarray(p.normals, p.normals + p.vertexCount * 6);
  const idx = new Uint32Array(b.buffer.slice(b.byteOffset + p.indices, b.byteOffset + p.indices + p.indexCount * 4));
  partes.push({ id: p.id, name: 'Liver', grupo: 'higado', vertexCount: p.vertexCount, indexCount: p.indexCount, i16: true, positions: pegar(Buffer.from(pos.buffer)), normals: pegar(nor), indices: pegar(Buffer.from(new Uint16Array(idx).buffer)),
    bounds: p.bounds.map(v => v.map((x, i) => x + DESPLAZA_HIGADO[i])) });
}
const bin = Buffer.concat(out), gz = zlib.gzipSync(bin, { level: 9 });
fs.writeFileSync(path.join(DIR, 'escaner', `${sx}.bin.gz`), gz);
fs.writeFileSync(path.join(DIR, 'escaner', `${sx}.json`), JSON.stringify({ fuente: 'BodyParts3D 4.0 (DBCLS, CC BY 4.0), subconjunto para el escáner', sexo: sx,
  // articulaciones de referencia del modelo (m): cabeza del húmero y cabeza del fémur, para calzar con los puntos de la cámara
  ref: { hombroI: [0.185, 1.395, -0.02], hombroD: [-0.185, 1.395, -0.02], caderaI: [0.095, 0.895, -0.01], caderaD: [-0.095, 0.895, -0.01] },
  // joints of the reference skeleton that the limb segments hang from (m; I = the person's left, +x)
  articulaciones: { hombro: [0.19, 1.395, -0.02], codo: [0.215, 1.12, -0.015], muneca: [0.25, 0.89, 0.005], cadera: [0.09, 0.89, -0.01], rodilla: [0.08, 0.46, -0.01], tobillo: [0.08, 0.075, -0.02] },
  partes }));
const c = {}; partes.forEach(p => c[p.grupo] = (c[p.grupo] || 0) + p.vertexCount);
console.log(partes.length, 'partes', verts, 'vértices', (bin.length / 1e6).toFixed(1), 'MB →', (gz.length / 1e6).toFixed(1), 'MB gz', JSON.stringify(c));
