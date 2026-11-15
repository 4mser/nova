/* Cuerpo femenino joven para el gemelo: piel de MakeHuman (CC0; mujer de ~25 años, atlética: músculo 0,65, peso 0,4)
   con los órganos y el esqueleto del set femenino del NIH (HuBMAP, CC BY 4.0) ajustados dentro de esa silueta.
   El set del NIH viene de la Visible Human Female (59 años); su piel y su grasa se reemplazan, y sus estructuras se
   escalan en horizontal, por altura, solo donde no caben en el torso nuevo, con su centro alineado al del cuerpo nuevo.

   Uso: node ajustar-mujer.mjs <carpeta MakeHuman con base.obj y targets> <carpeta mujer (atlas.json + body-N.bin)> <salida> */
import fs from 'fs';
import path from 'path';

const [, , MH, ENT, SAL] = process.argv;
if (!MH || !ENT || !SAL) { console.error('uso: node ajustar-mujer.mjs <makehuman> <mujer> <salida>'); process.exit(1); }

/* ── piel joven desde MakeHuman ── */
const V = [], F = [], OJO = { 'joint-l-eye': new Set(), 'joint-r-eye': new Set() }; let g = '';
for (const l of fs.readFileSync(path.join(MH, 'base.obj'), 'utf8').split('\n')) {
  if (l.startsWith('v ')) V.push(l.split(/\s+/).slice(1, 4).map(Number));
  else if (l.startsWith('g ')) g = l.slice(2).trim();
  else if (l.startsWith('f ') && g === 'body') F.push(l.split(/\s+/).slice(1).filter(Boolean).map(x => +x.split('/')[0] - 1));
  else if (l.startsWith('f ') && OJO[g]) l.split(/\s+/).slice(1).filter(Boolean).forEach(x => OJO[g].add(+x.split('/')[0] - 1));
}
// mujer joven, músculo 0,65 y peso 0,4 (mezcla bilineal de los targets universales) y rasgos promedio de las tres etnias
const PESOS = { 'universal-female-young-averagemuscle-averageweight': .56, 'universal-female-young-averagemuscle-minweight': .14,
  'universal-female-young-maxmuscle-averageweight': .24, 'universal-female-young-maxmuscle-minweight': .06,
  'african-female-young': 1 / 3, 'asian-female-young': 1 / 3, 'caucasian-female-young': 1 / 3 };
for (const [t, w] of Object.entries(PESOS)) for (const l of fs.readFileSync(path.join(MH, t + '.target'), 'utf8').split('\n')) {
  if (!l || l[0] === '#') continue; const [i, x, y, z] = l.split(/\s+/).map(Number); if (Number.isNaN(i)) continue;
  V[i][0] += w * x; V[i][1] += w * y; V[i][2] += w * z;
}
const usa = new Map(), PP = [], TI = [];
for (const f of F) { const ids = f.map(i => { if (!usa.has(i)) { usa.set(i, PP.length / 3); PP.push(...V[i]); } return usa.get(i); }); for (let k = 1; k + 1 < ids.length; k++) TI.push(ids[0], ids[k], ids[k + 1]); }

/* ── set del NIH ── */
const A = JSON.parse(fs.readFileSync(path.join(ENT, 'atlas.json')));
const bufs = A.chunks.map((c, i) => fs.readFileSync(path.join(ENT, `body-${i}.bin`)));
const leer = p => { const b = bufs[p.chunk]; return { P: Float32Array.from(new Float32Array(b.buffer, b.byteOffset + p.positions, p.vertexCount * 3)), I: Uint32Array.from(new Uint32Array(b.buffer, b.byteOffset + p.indices, p.indexCount)) }; };
const FUERA = /^VH_F_(skin|fat_|areol|nipple|areola|mammary|main_lactiferous|suspensory_ligaments_)/;
const partes = A.parts.filter(p => !FUERA.test(p.id)).map(p => ({ ...p, ...leer(p) }));
const altoOrg = Math.max(...A.parts.filter(p => /VH_F_skin/.test(p.id)).map(p => p.bounds[1][1]));

// piel al mismo alto, pies en el piso, centrada en x
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < PP.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], PP[i + k]); mx[k] = Math.max(mx[k], PP[i + k]); }
const s = altoOrg / (mx[1] - mn[1]);
const piel = new Float32Array(PP.length);
for (let i = 0; i < PP.length; i += 3) { piel[i] = (PP[i] - (mn[0] + mx[0]) / 2) * s; piel[i + 1] = (PP[i + 1] - mn[1]) * s; piel[i + 2] = PP[i + 2] * s; }

/* ── perfil por altura: centro y fondo del cuerpo nuevo (tronco y cabeza, sin brazos) y de las estructuras ── */
const BANDA = .025, NB = Math.ceil(altoOrg / BANDA) + 2;
const banda = y => Math.max(0, Math.min(NB - 1, Math.floor(y / BANDA)));
const perfil = () => Array.from({ length: NB }, () => ({ z0: 1e9, z1: -1e9, x1: 0 }));
const pPiel = perfil(), pOrg = perfil();
const enTronco = (x, y) => y < .78 || Math.abs(x) < (y > 1.18 && y < 1.45 ? .17 : .22);
for (let i = 0; i < piel.length; i += 3) { if (!enTronco(piel[i], piel[i + 1])) continue; const b = pPiel[banda(piel[i + 1])]; b.z0 = Math.min(b.z0, piel[i + 2]); b.z1 = Math.max(b.z1, piel[i + 2]); b.x1 = Math.max(b.x1, Math.abs(piel[i])); }
for (const p of partes) for (let i = 0; i < p.P.length; i += 3) { const b = pOrg[banda(p.P[i + 1])]; b.z0 = Math.min(b.z0, p.P[i + 2]); b.z1 = Math.max(b.z1, p.P[i + 2]); b.x1 = Math.max(b.x1, Math.abs(p.P[i])); }
// por banda: cuánto hay que achicar (solo si no cabe, con 1,2 cm de margen) y cuánto mover en z
const MARGEN = .012, esc = new Float32Array(NB).fill(1), dz = new Float32Array(NB);
for (let b = 0; b < NB; b++) {
  const P = pPiel[b], O = pOrg[b]; if (O.z1 < O.z0 || P.z1 < P.z0) continue;
  const fondoP = P.z1 - P.z0 - 2 * MARGEN, fondoO = O.z1 - O.z0;
  const y = b * BANDA;
  let k = Math.min(1, fondoP / fondoO);
  if (y > .78) k = Math.min(k, (P.x1 - MARGEN) / Math.max(.01, O.x1)); // en el tronco también a lo ancho
  esc[b] = Math.max(.6, k);
  dz[b] = (P.z0 + P.z1) / 2 - (O.z0 + O.z1) / 2;
}
// suavizar a lo alto para que ninguna estructura se quiebre
const suave = a => a.map((_, i) => { let t = 0, n = 0; for (let j = -4; j <= 4; j++) { const v = a[i + j]; if (v !== undefined) { const w = 5 - Math.abs(j); t += v * w; n += w; } } return t / n; });
const escS = suave(Array.from(esc)), dzS = suave(Array.from(dz));
const muestra = (a, y) => { const f = y / BANDA - .5, i = Math.max(0, Math.min(NB - 2, Math.floor(f))), t = Math.max(0, Math.min(1, f - i)); return a[i] * (1 - t) + a[i + 1] * t; };
// piernas: cada lado se centra en su pierna nueva (la separación de las piernas no es la misma)
const LADO = () => Array.from({ length: NB }, () => [[1e9, -1e9], [1e9, -1e9]]);
const lPiel = LADO(), lOrg = LADO();
const anotar = (L, x, y) => { if (y > .86 || Math.abs(x) > .25) return; const s = x < 0 ? 0 : 1, r = L[banda(y)][s]; r[0] = Math.min(r[0], x); r[1] = Math.max(r[1], x); };
for (let i = 0; i < piel.length; i += 3) anotar(lPiel, piel[i], piel[i + 1]);
for (const p of partes) for (let i = 0; i < p.P.length; i += 3) anotar(lOrg, p.P[i], p.P[i + 1]);
const dxL = [0, 1].map(s => suave(Array.from({ length: NB }, (_, b) => { const P = lPiel[b][s], O = lOrg[b][s]; return P[1] > P[0] && O[1] > O[0] ? (P[0] + P[1]) / 2 - (O[0] + O[1]) / 2 : 0; })));
for (const p of partes) for (let i = 0; i < p.P.length; i += 3) {
  const y = p.P[i + 1], k = muestra(escS, y), zc = (pOrg[banda(y)].z0 + pOrg[banda(y)].z1) / 2;
  // las piernas se mueven de lado completo; desde la pelvis hacia arriba ese ajuste se desvanece
  const piernas = Math.max(0, Math.min(1, (.9 - y) / .12)), dx = piernas * muestra(dxL[p.P[i] < 0 ? 0 : 1], y);
  p.P[i] = p.P[i] * k + dx; p.P[i + 2] = zc + (p.P[i + 2] - zc) * k + muestra(dzS, y);
}

/* ── cabeza: los ojos del set del NIH van al centro de los ojos de la cara nueva (articulaciones de MakeHuman), y el
   resto de la cabeza (cerebro, nervios ópticos) se mueve y escala con ellos ── */
{
  const ojoMH = [...Object.values(OJO)].map(set => { const c = [0, 0, 0]; set.forEach(i => { for (let k = 0; k < 3; k++) c[k] += V[i][k] / set.size; });
    return [(c[0] - (mn[0] + mx[0]) / 2) * s, (c[1] - mn[1]) * s, c[2] * s]; });
  const centro = re => { const c = [0, 0, 0]; let n = 0; for (const p of partes.filter(p => re.test(p.id))) for (let i = 0; i < p.P.length; i += 3) { c[0] += p.P[i]; c[1] += p.P[i + 1]; c[2] += p.P[i + 2]; n++; } return c.map(v => v / n); };
  const ojoNIH = [centro(/vitreous_humor_L$/), centro(/vitreous_humor_R$/)];
  const mid = a => a[0].map((v, k) => (v + a[1][k]) / 2), dist = a => Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1], a[0][2] - a[1][2]);
  const cMH = mid(ojoMH), cNIH = mid(ojoNIH), k = Math.max(.8, Math.min(1.2, dist(ojoMH) / dist(ojoNIH)));
  console.log('ojos: separación MakeHuman', dist(ojoMH).toFixed(3), 'NIH', dist(ojoNIH).toFixed(3), '→ escala cabeza', k.toFixed(2), 'desplazamiento', cMH.map((v, i) => (v - cNIH[i]).toFixed(3)).join(','));
  const sm = (a, b, y) => { const t = Math.max(0, Math.min(1, (y - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (const p of partes) for (let i = 0; i < p.P.length; i += 3) {
    const w = sm(1.36, 1.46, p.P[i + 1]); if (!w) continue;
    for (let q = 0; q < 3; q++) { const nuevo = cMH[q] + (p.P[i + q] - cNIH[q]) * k; p.P[i + q] += w * (nuevo - p.P[i + q]); }
  }
}

/* ── control: cuántos puntos de las estructuras quedan fuera de la piel nueva (rayo en +x, regla par-impar) ── */
function dentro(x, y, z) {
  let n = 0;
  for (let t = 0; t < TI.length; t += 3) {
    const a = TI[t] * 3, b = TI[t + 1] * 3, c = TI[t + 2] * 3;
    const ay = piel[a + 1], by = piel[b + 1], cy = piel[c + 1], az = piel[a + 2], bz = piel[b + 2], cz = piel[c + 2];
    if ((ay > y && by > y && cy > y) || (ay < y && by < y && cy < y) || (az > z && bz > z && cz > z) || (az < z && bz < z && cz < z)) continue;
    const d = (by - ay) * (cz - az) - (bz - az) * (cy - ay); if (Math.abs(d) < 1e-12) continue;
    const u = ((y - ay) * (cz - az) - (z - az) * (cy - ay)) / d, v = ((by - ay) * (z - az) - (bz - az) * (y - ay)) / d;
    if (u < 0 || v < 0 || u + v > 1) continue;
    const xi = piel[a] + u * (piel[b] - piel[a]) + v * (piel[c] - piel[a]); if (xi > x) n++;
  }
  return n % 2 === 1;
}
let fuera = 0, total = 0; const peores = {};
const zonas = {}; for (const p of partes) for (let i = 0; i < p.P.length; i += 3 * 37) { const y = p.P[i + 1], zn = y > 1.42 ? "cabeza" : y > .8 ? "tronco" : "piernas"; const Z = zonas[zn] ??= [0, 0]; Z[1]++; total++; if (!dentro(p.P[i], p.P[i + 1], p.P[i + 2])) { Z[0]++; fuera++; if (zn !== "cabeza") peores[p.name] = (peores[p.name] || 0) + 1; } } console.log(zonas);
console.log(`fuera de la piel: ${fuera} de ${total} (${(fuera / total * 100).toFixed(1)} %)`, Object.entries(peores).sort((a, b) => b[1] - a[1]).slice(0, 8));

/* ── escribir ── */
fs.mkdirSync(SAL, { recursive: true });
const normales = (P, I) => { const n = new Float32Array(P.length);
  for (let i = 0; i < I.length; i += 3) { const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const q of [a, b, c]) { n[q] += nx; n[q + 1] += ny; n[q + 2] += nz; } }
  const o = new Int16Array(n.length); for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; for (let k = 0; k < 3; k++) o[i + k] = Math.round(n[i + k] / l * 32767); } return o; };
const alinear = b => b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - b.length % 4)]) : b;
const out = { version: 'nova-2', sex: 'female', source: 'MakeHuman 1.x base mesh and targets (CC0) + HuBMAP HRA Female v1.5 (CC BY 4.0)', scope: 'Young adult female silhouette with reference organs fitted inside', parts: [], chunks: [] };
let bloque = [], tam = 0, nb = 0, tri = 0;
const cerrar = () => { if (!bloque.length) return; const b = Buffer.concat(bloque); fs.writeFileSync(path.join(SAL, `body-${nb}.bin`), b); out.chunks.push({ url: `body-${nb}.bin`, bytes: b.length }); bloque = []; tam = 0; nb++; };
const todas = [{ id: 'MH_skin', name: 'Skin', system: 'integumentary', P: piel, I: Uint32Array.from(TI) }, ...partes];
for (const p of todas) {
  const n = normales(p.P, p.I), bp = alinear(Buffer.from(p.P.buffer, p.P.byteOffset, p.P.byteLength)), bn = alinear(Buffer.from(n.buffer)), bi = Buffer.from(p.I.buffer, p.I.byteOffset, p.I.byteLength);
  if (tam > 4e6) cerrar();
  let a = [1e9, 1e9, 1e9], z = [-1e9, -1e9, -1e9]; for (let i = 0; i < p.P.length; i += 3) for (let k = 0; k < 3; k++) { a[k] = Math.min(a[k], p.P[i + k]); z[k] = Math.max(z[k], p.P[i + k]); }
  out.parts.push({ id: p.id, name: p.name, system: p.system, chunk: nb, positions: tam, normals: tam + bp.length, indices: tam + bp.length + bn.length, vertexCount: p.P.length / 3, indexCount: p.I.length, bounds: [a.map(v => +v.toFixed(5)), z.map(v => +v.toFixed(5))] });
  bloque.push(bp, bn, bi); tam += bp.length + bn.length + bi.length; tri += p.I.length / 3;
}
cerrar(); out.triangles = tri;
fs.writeFileSync(path.join(SAL, 'atlas.json'), JSON.stringify(out));
console.log('estructuras', out.parts.length, '· triángulos', tri, '· escala mínima', Math.min(...escS).toFixed(2));
