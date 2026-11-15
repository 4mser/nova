/* NOVA · Body scan · sistema «Eyes»: salud ocular con visión por computador.

   Método y umbrales del diseño de visión ocular de Nicolás Richardson (repo del equipo, rama computer-vision-ocular,
   «CV - Salud Ocular»): MediaPipe Face Landmarker (Apache 2.0, el mismo archivo que él midió: sha256 64184e22…),
   478 puntos con iris. Corre en este mismo dispositivo, sobre la cámara a resolución completa (con la imagen de 512 px
   que va a la nave el iris mide ~17 px; aquí mide bastante más). No sale ninguna imagen.

   Qué mide (todo en diámetros de iris; los mm suponen un iris de 11,7 mm y son una estimación [INF]):
     · A      apertura del ojo: párpado superior a inferior, sobre la línea perpendicular a las comisuras
     · MRD1n  pupila → párpado superior (proxy: el centro del iris reemplaza al reflejo corneal)
     · MRD2n  pupila → párpado inferior (proxy)
     · EAR    índice de apertura (parpadeo): parpadeo = EAR < 0,6 × mediana abierta durante ≥ 2 cuadros
     · distancia a la cámara, por el tamaño del iris
   Puerta de quietud (su propuesta): en 1 s, IOD < 2 %, giro (roll) < 2°, yaw y pitch < 3°; se excluyen los parpadeos
   (EAR < 0,75 × mediana) y ±3 cuadros.
   La revisión guiada (20 s mirando el punto rojo) guarda la mediana en la nave (/v1/ojos) y la compara con la línea
   base de esa persona y esa cámara. Solo avisa «seguimiento» si el cambio supera el cambio mínimo detectable (MDC95 con
   reposicionamiento) que él midió: A 0,155 · MRD1n 0,101 · MRD2n 0,073 diámetros de iris. La distancia pupila-ceja
   (PTB) no se usa: en sus pruebas su MDC (3,3 mm) aún no permite detectar cambios útiles. No es un diagnóstico ni
   nombra SANS.

   Cansancio (no emociones): NOVA no adivina lo que alguien siente por su cara (Barrett et al., Psychol Sci Public Interest
   2019: los gestos no indican emociones de forma confiable). Mide señales de somnolencia con respaldo:
     · PERCLOS: % del último minuto con los ojos ≥ 80 % cerrados (apertura frente a la propia apertura abierta);
       Dinges y Grace, FHWA-MCRT-98-006 (1998). Aquí: ≥ 7,5 % «algunos signos», ≥ 15 % «cansancio».
     · duración de los parpadeos y cierres de ≥ 0,5 s (se alargan con el sueño)
     · bostezos: boca muy abierta (jawOpen > 0,55) durante ≥ 1,2 s
   Solo se ve en el escáner y en la revisión que la persona hace; no es un diagnóstico. */
import { FilesetResolver, FaceLandmarker } from './lib/mediapipe/vision_bundle.mjs';

const IRIS_MM = 11.7;
const MDC = { A: .155, m1: .101, m2: .073 };          // diámetros de iris (Richardson, suelo de ruido 14-11-2026, peor ojo)
const OJOS = {
  R: { a: 33, b: 133, sup: 159, inf: 145, ear: [[160, 144], [158, 153]], borde: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7, 33] },
  L: { a: 362, b: 263, sup: 386, inf: 374, ear: [[385, 380], [387, 373]], borde: [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382, 362] },
};
const CEJAS = { R: [70, 63, 105, 66, 107], L: [300, 293, 334, 296, 336] };
const IRIS_PARES = [[469, 471], [470, 472], [474, 476], [475, 477]];

export const ojos = { modelo: null, cargando: null, error: '', cara: null, hist: [], parpadeos: [], tUlt: 0, abajo: 0, flash: 0, revision: null, resultado: null,
  cerrado: 0, duraciones: [], bostezos: [], boca: 0 };

export function cargarOjos() {
  if (ojos.cargando) return ojos.cargando;
  ojos.cargando = (async () => {
    const fs = await FilesetResolver.forVisionTasks('lib/mediapipe/wasm');
    for (const delegate of ['GPU', 'CPU']) {
      try {
        ojos.modelo = await FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: 'lib/mediapipe/modelos/face_landmarker.task', delegate },
          runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
        return ojos.modelo;
      } catch (e) { if (delegate === 'CPU') { ojos.error = String(e.message || e); throw e; } }
    }
  })();
  return ojos.cargando;
}

const d2 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const med = l => { const v = l.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : NaN; };
const rango = l => { const v = l.filter(Number.isFinite); return v.length ? Math.max(...v) - Math.min(...v) : 0; };

/* un cuadro: puntos → métricas (coordenadas en píxeles del video, y hacia abajo) */
function metricas(L, vw, vh, matriz) {
  const P = i => [L[i].x * vw, L[i].y * vh];
  const s = IRIS_PARES.reduce((a, [i, j]) => a + d2(P(i), P(j)), 0) / IRIS_PARES.length;   // diámetro del iris (px)
  const out = { s };
  for (const [n, o] of Object.entries(OJOS)) {
    const a = P(o.a), b = P(o.b), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], w = d2(a, b);
    const ex = [(b[0] - a[0]) / w, (b[1] - a[1]) / w], ey = [-ex[1], ex[0]];
    const y = p => (p[0] - m[0]) * ey[0] + (p[1] - m[1]) * ey[1];
    // el iris de este ojo: el centro (468 o 473) más cercano al punto medio de sus comisuras
    const c = [468, 473].map(P).sort((p, q) => d2(p, m) - d2(q, m))[0];
    const yS = y(P(o.sup)), yI = y(P(o.inf)), yC = y(c);
    out[n] = { A: (yI - yS) / s, m1: (yC - yS) / s, m2: (yI - yC) / s, ear: (d2(P(o.ear[0][0]), P(o.ear[0][1])) + d2(P(o.ear[1][0]), P(o.ear[1][1]))) / (2 * w), m, c };
  }
  out.ear = (out.R.ear + out.L.ear) / 2;
  out.iod = d2(out.R.c, out.L.c);
  out.roll = Math.atan2(out.L.m[1] - out.R.m[1], out.L.m[0] - out.R.m[0]) * 180 / Math.PI;
  if (matriz) { const e = matriz.data; out.yaw = Math.atan2(e[8], e[10]) * 180 / Math.PI; out.pitch = Math.asin(Math.max(-1, Math.min(1, -e[9]))) * 180 / Math.PI; }
  return out;
}

/* cada cuadro del escáner: detecta, calcula, cuenta parpadeos y decide si el cuadro sirve (quietud, sin parpadeo) */
export function medirOjos(video, ahora, hfov) {
  if (!ojos.modelo || video.readyState < 2) return null;
  if (ahora - ojos.tUlt < 30) return ojos.cara;                 // ~30 por segundo bastan
  ojos.tUlt = ahora;
  let r; try { r = ojos.modelo.detectForVideo(video, ahora); } catch { return ojos.cara; }
  const L = r?.faceLandmarks?.[0];
  if (!L) { ojos.cara = null; return null; }
  const vw = video.videoWidth, vh = video.videoHeight, x = metricas(L, vw, vh, r.facialTransformationMatrixes?.[0]);
  x.t = ahora; x.lm = L; x.vw = vw; x.vh = vh;
  x.boca = r.faceBlendshapes?.[0]?.categories?.find(c => c.categoryName === 'jawOpen')?.score ?? 0;
  x.Am = (x.R.A + x.L.A) / 2;
  x.dist = (vw / 2) / Math.tan(hfov / 2) * (IRIS_MM / 10) / x.s;   // cm, por el tamaño del iris
  const h = ojos.hist; h.push(x); while (h.length && ahora - h[0].t > 60000) h.shift();
  // ojo abierto de referencia: lo habitual de los últimos 5 s (percentil 70, para no contar los parpadeos)
  const ears = h.filter(f => ahora - f.t < 5000).map(f => f.ear).sort((a, b) => a - b), abierto = ears[Math.floor(ears.length * .7)] || x.ear;
  x.abierto = abierto;
  // PERCLOS: cuánto se cierra el ojo frente a su apertura abierta habitual (percentil 70 de los últimos 5 s)
  const As = h.filter(f => ahora - f.t < 5000).map(f => f.Am).sort((a, b) => a - b), Aab = As[Math.floor(As.length * .7)] || x.Am;
  x.cierre = Math.max(0, Math.min(1, 1 - x.Am / Aab));
  // duración de cada parpadeo (desde que baja de 0,6 × abierto hasta que vuelve)
  if (x.ear < .6 * abierto) { if (!ojos.cerrado) ojos.cerrado = ahora; }
  else if (ojos.cerrado) { const d = ahora - ojos.cerrado; ojos.cerrado = 0; if (d >= 60 && d <= 4000) ojos.duraciones.push({ t: ahora, d }); }
  while (ojos.duraciones.length && ahora - ojos.duraciones[0].t > 60000) ojos.duraciones.shift();
  // bostezo: boca muy abierta ≥ 1,2 s (uno por episodio)
  if (x.boca > .55) { if (!ojos.boca) ojos.boca = ahora; else if (ojos.boca > 0 && ahora - ojos.boca >= 1200) { ojos.bostezos.push(ahora); ojos.boca = -1; } }
  else ojos.boca = 0;
  while (ojos.bostezos.length && ahora - ojos.bostezos[0] > 300000) ojos.bostezos.shift();
  // parpadeo: EAR < 0,6 × abierto durante ≥ 2 cuadros
  if (x.ear < .6 * abierto) { ojos.abajo++; if (ojos.abajo === 2) { ojos.parpadeos.push(ahora); ojos.flash = ahora; } } else ojos.abajo = 0;
  while (ojos.parpadeos.length && ahora - ojos.parpadeos[0] > 60000) ojos.parpadeos.shift();
  // quietud en el último segundo
  const ult = h.filter(f => ahora - f.t < 1000), iodM = med(ult.map(f => f.iod));
  x.quieto = ult.length > 8 && rango(ult.map(f => f.iod)) / iodM < .02 && rango(ult.map(f => f.roll)) < 2
    && (x.yaw == null || (rango(ult.map(f => f.yaw)) < 3 && rango(ult.map(f => f.pitch)) < 3));
  // fuera los cuadros cerca de un parpadeo (EAR < 0,75 × abierto, ±3 cuadros ≈ ±100 ms)
  if (x.ear < .75 * abierto) h.forEach(f => { if (ahora - f.t < 110) f.parpadeo = true; });
  x.parpadeo = x.ear < .75 * abierto;
  ojos.cara = x;
  if (ojos.revision) acumular(x);
  return x;
}

/* lo que se muestra: la mediana del último segundo con los cuadros que sirven */
export function lecturaOjos(ahora) {
  const v = ojos.hist.filter(f => ahora - f.t < 1200 && f.quieto && !f.parpadeo);
  if (v.length < 4) return null;
  const q = k => ({ R: med(v.map(f => f.R[k])), L: med(v.map(f => f.L[k])) });
  return { A: q('A'), m1: q('m1'), m2: q('m2'), dist: med(v.map(f => f.dist)) };
}
export function parpadeosMin(ahora) {
  const h = ojos.hist; if (!h.length) return null;
  const visto = (ahora - h[0].t) / 1000; if (visto < 15) return { n: null, seg: visto };
  return { n: ojos.parpadeos.length * 60 / Math.min(60, visto), seg: visto };
}

/* cansancio del último minuto; null mientras no haya 30 s de cara */
export function fatiga(ahora) {
  const v = ojos.hist.filter(f => ahora - f.t < 60000); if (!v.length) return null;
  const seg = (ahora - v[0].t) / 1000; if (seg < 30) return { nivel: null, seg };
  const perclos = v.filter(f => f.cierre >= .8).length / v.length;
  const ds = ojos.duraciones.map(x => x.d), durMed = ds.length ? med(ds) : null, largos = ds.filter(d => d >= 500).length, bostezos = ojos.bostezos.length;
  let p = perclos >= .15 ? 2 : perclos >= .075 ? 1 : 0;
  if (largos >= 2) p++; if (bostezos >= 2) p++;
  return { nivel: p >= 2 ? 'cansado' : p === 1 ? 'algo' : 'alerta', perclos, durMed, largos, bostezos, seg };
}
export const NIVEL_FATIGA = { alerta: 'alert', algo: 'some signs of tiredness', cansado: 'tired' };

/* ── revisión guiada: 20 s mirando el punto rojo; se guarda la mediana y se compara con la línea base ── */
export function empezarRevision(trip, camara) {
  ojos.resultado = null;
  ojos.revision = { trip, camara, t0: performance.now(), cuadros: 0, sirven: [], p0: ojos.parpadeos.length };
}
function acumular(x) {
  const r = ojos.revision; r.cuadros++;
  if (x.quieto && !x.parpadeo) r.sirven.push(x);
}
export function progresoRevision(ahora) { const r = ojos.revision; return r ? Math.min(1, (ahora - r.t0) / 20000) : 0; }
export async function terminarRevision(BASE, TOKEN) {
  const r = ojos.revision; ojos.revision = null; if (!r) return null;
  const quietud = r.cuadros ? r.sirven.length / r.cuadros : 0;
  if (r.sirven.length < 90 || quietud < .5) { ojos.resultado = { error: `Too much movement (${Math.round(quietud * 100)}% steady). Rest your head, look at the red dot and try again.` }; return ojos.resultado; }
  const m = (o, k) => +med(r.sirven.map(f => f[o][k])).toFixed(4);
  const parp = ojos.hist.length ? ojos.parpadeos.filter(t => t >= r.t0).length * 3 : null;   // en 20 s → por minuto
  const rec = { trip: r.trip, camara: r.camara, n: r.sirven.length, quietud: +quietud.toFixed(2),
    A_R: m('R', 'A'), A_L: m('L', 'A'), m1_R: m('R', 'm1'), m1_L: m('L', 'm1'), m2_R: m('R', 'm2'), m2_L: m('L', 'm2'),
    parpadeos_min: parp, dist_cm: +med(r.sirven.map(f => f.dist)).toFixed(1), metodo: 'Face Landmarker · Richardson CV ocular v0' };
  const fa = fatiga(performance.now());
  if (fa?.nivel) Object.assign(rec, { perclos: +(fa.perclos * 100).toFixed(1), dur_parpadeo_ms: fa.durMed == null ? null : Math.round(fa.durMed), cierres_largos: fa.largos, bostezos: fa.bostezos, alerta: fa.nivel });
  let historial = [];
  try {
    const res = await fetch(BASE + '/v1/ojos', { method: 'POST', headers: { 'content-type': 'application/json', ...(TOKEN ? { 'x-nova-token': TOKEN } : {}) }, body: JSON.stringify(rec) });
    if (res.ok) historial = (await res.json()).historial || [];
  } catch {}
  ojos.resultado = { rec, ...comparar(rec, historial), guardada: historial.length > 0 };
  return ojos.resultado;
}
/* línea base: las revisiones anteriores de esa persona con la misma cámara (mediana); hace falta al menos 3 */
function comparar(rec, historial) {
  const antes = historial.filter(h => h.camara === rec.camara && h.t !== historial[historial.length - 1]?.t);
  const filas = [['Eye opening', 'A', 'A'], ['Upper lid to pupil', 'm1', 'm1'], ['Lower lid to pupil', 'm2', 'm2']].flatMap(([n, k]) => ['R', 'L'].map(o => {
    const v = rec[`${k}_${o}`], base = antes.length >= 3 ? med(antes.map(h => h[`${k}_${o}`])) : null, dif = base == null ? null : v - base;
    return { n, ojo: o === 'R' ? 'right' : 'left', mm: v * IRIS_MM, base: base == null ? null : base * IRIS_MM, dif: dif == null ? null : dif * IRIS_MM, fuera: dif != null && Math.abs(dif) > MDC[k], mdc: MDC[k] * IRIS_MM };
  }));
  return { filas, previas: antes.length, seguimiento: filas.some(f => f.fuera) };
}

/* ── dibujo: el holograma de los ojos sobre la cara ── */
export function pintarOjos(c, { W, H, k, t, recorte, frente, texto }) {
  const x = ojos.cara; if (!x) return false;
  const { sx, sy, sw, sh } = recorte, f = W / sw;
  const A = (p) => { let X = (p[0] - sx) * f, Y = (p[1] - sy) * f; if (frente) X = W - X; return [X, Y]; };
  const Q = i => A([x.lm[i].x * x.vw, x.lm[i].y * x.vh]);
  c.save();
  // la malla de la cara, tenue
  c.fillStyle = 'rgba(143,230,245,.28)';
  for (let i = 0; i < 468; i += 3) { const [X, Y] = Q(i); c.fillRect(X - .8 * k, Y - .8 * k, 1.6 * k, 1.6 * k); }
  c.shadowColor = '#8fe6f5'; c.shadowBlur = 8 * k; c.lineJoin = 'round';
  // las cejas: punteadas y tenues (todavía no se usan para medir)
  c.setLineDash([3 * k, 4 * k]); c.strokeStyle = 'rgba(191,238,250,.35)'; c.lineWidth = 1.2 * k;
  for (const l of Object.values(CEJAS)) { c.beginPath(); l.forEach((i, j) => { const [X, Y] = Q(i); j ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.stroke(); }
  c.setLineDash([]);
  const vivo = lecturaOjos(performance.now());
  for (const [n, o] of Object.entries(OJOS)) {
    // borde de los párpados
    c.strokeStyle = '#8fe6f5'; c.lineWidth = 1.6 * k; c.beginPath();
    o.borde.forEach((i, j) => { const [X, Y] = Q(i); j ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.stroke();
    // el iris
    const ci = A(x[n].c), r = x.s * f / 2;
    c.strokeStyle = '#d8f7ff'; c.lineWidth = 1.4 * k; c.beginPath(); c.arc(ci[0], ci[1], r, 0, 7); c.stroke();
    c.fillStyle = '#d8f7ff'; c.beginPath(); c.arc(ci[0], ci[1], 1.6 * k, 0, 7); c.fill();
    // la apertura: una regla al costado de afuera del ojo, del párpado superior al inferior
    const s = Q(o.sup), i2 = Q(o.inf), afuera = (n === 'R') !== frente ? -1 : 1, dx = afuera * (r * 2.2 + 10 * k);
    c.strokeStyle = '#a898ff'; c.lineWidth = 1.4 * k; c.beginPath();
    c.moveTo(s[0] + dx - 4 * k, s[1]); c.lineTo(s[0] + dx + 4 * k, s[1]); c.moveTo(s[0] + dx, s[1]); c.lineTo(i2[0] + dx, i2[1]); c.moveTo(i2[0] + dx - 4 * k, i2[1]); c.lineTo(i2[0] + dx + 4 * k, i2[1]); c.stroke();
    if (vivo) { c.shadowBlur = 0; texto(c, s[0] + dx + afuera * 8 * k, (s[1] + i2[1]) / 2 + 4 * k, `${(vivo.A[n] * IRIS_MM).toFixed(1)} mm`, { f: 12 * k, w: 600, col: '#cfc6ff', alin: afuera < 0 ? 'right' : 'left' }); c.shadowBlur = 8 * k; }
  }
  // parpadeo: un destello suave en los dos ojos
  const fl = Math.max(0, 1 - (performance.now() - ojos.flash) / 400);
  if (fl > 0) for (const n of ['R', 'L']) { const ci = A(x[n].c); c.strokeStyle = `rgba(255,255,255,${fl * .7})`; c.lineWidth = 2 * k; c.beginPath(); c.arc(ci[0], ci[1], x.s * f * (1.4 - fl * .3), 0, 7); c.stroke(); }
  c.restore();
  return true;
}

/* el punto donde mirar (la cámara frontal está arriba al centro) y el avance de la revisión */
export function pintarFijacion(c, { W, k, t, texto, frente }) {
  if (!ojos.revision) return;
  const x = W / 2, y = 30 * k, p = progresoRevision(performance.now());
  c.save();
  c.fillStyle = '#ff3b3b'; c.shadowColor = '#ff3b3b'; c.shadowBlur = 14 * k; c.beginPath(); c.arc(x, y, 5 * k, 0, 7); c.fill(); c.shadowBlur = 0;
  c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 3 * k; c.beginPath(); c.arc(x, y, 14 * k, 0, 7); c.stroke();
  c.strokeStyle = '#8fe6f5'; c.beginPath(); c.arc(x, y, 14 * k, -Math.PI / 2, -Math.PI / 2 + p * 2 * Math.PI); c.stroke();
  const q = ojos.cara?.quieto;
  texto(c, x, y + 36 * k, frente ? 'Look at the red dot · keep your head still' : 'Ask them to look at the camera · keep still', { f: 14 * k, w: 500, alin: 'center' });
  texto(c, x, y + 56 * k, !ojos.cara ? 'No face in view' : q ? `Steady · ${Math.ceil(20 - p * 20)} s` : 'Hold still…', { f: 12.5 * k, col: q ? '#8fe6f5' : '#f2b457', alin: 'center' });
  c.restore();
}

/* panel de lectura en vivo */
export function panelOjos(c, { W, H, k, texto, nombre, angosto, yPie }) {
  const ahora = performance.now(), v = lecturaOjos(ahora), p = parpadeosMin(ahora), x = ojos.cara;
  // el cansancio va debajo si cabe entre la cabecera y la barra de botones
  const conFatiga = !angosto && yPie - 120 * k >= 448 * k;
  const pw = angosto ? W - 32 * k : Math.min(300 * k, W * .36), ph = (conFatiga ? 448 : 300) * k;
  const px = angosto ? 16 * k : W - pw - 20 * k, py = angosto ? yPie - ph - 10 * k : Math.max(110 * k, Math.min(H / 2 - ph / 2, yPie - ph - 10 * k));
  c.save(); c.fillStyle = 'rgba(4,14,22,.66)'; c.strokeStyle = 'rgba(143,230,245,.3)'; c.lineWidth = 1 * k;
  c.beginPath(); c.roundRect(px, py, pw, ph, 10 * k); c.fill(); c.stroke(); c.restore();
  texto(c, px + 16 * k, py + 26 * k, 'EYES · LIVE', { f: 11 * k, w: 600, col: '#8fe6f5', esp: 2 * k });
  texto(c, px + pw - 16 * k, py + 26 * k, nombre || '', { f: 11 * k, col: 'rgba(244,247,250,.55)', alin: 'right' });
  const fila = (i, n, val, sub, col = '#f4f7fa') => {
    const y = py + (54 + i * 38) * k;
    texto(c, px + 16 * k, y, n, { f: 11.5 * k, col: 'rgba(244,247,250,.62)' });
    texto(c, px + pw - 16 * k, y, val, { f: 15 * k, w: 600, col, alin: 'right' });
    if (sub) texto(c, px + 16 * k, y + 15 * k, sub, { f: 10 * k, col: 'rgba(244,247,250,.4)' });
  };
  const mm = o => `${(o.R * IRIS_MM).toFixed(1)}  ·  ${(o.L * IRIS_MM).toFixed(1)} mm`;
  fila(0, 'Blinks', p?.n == null ? (x ? `${Math.max(0, Math.ceil(15 - (p?.seg || 0)))} s…` : '—') : `${Math.round(p.n)} /min`, 'last minute · usual at rest 10–20');
  fila(1, 'Eye opening  R · L', v ? mm(v.A) : '—', 'upper to lower lid');
  fila(2, 'Upper lid to pupil', v ? mm(v.m1) : '—', 'MRD1 proxy');
  fila(3, 'Lower lid to pupil', v ? mm(v.m2) : '—', 'MRD2 proxy');
  fila(4, 'Distance', v ? `${Math.round(v.dist)} cm` : '—', null);
  fila(5, 'Head', !x ? 'no face' : x.quieto ? 'steady' : 'moving', null, !x ? 'rgba(244,247,250,.5)' : x.quieto ? '#8fe6f5' : '#f2b457');
  if (conFatiga) {   // cansancio: en pantallas chicas no cabe junto a la cara
    const fa = fatiga(ahora), espera = fa && !fa.nivel ? `${Math.ceil(30 - fa.seg)} s…` : '—';
    c.strokeStyle = 'rgba(143,230,245,.18)'; c.beginPath(); c.moveTo(px + 16 * k, py + 270 * k); c.lineTo(px + pw - 16 * k, py + 270 * k); c.stroke();
    fila(6.4, 'Eyes closed (PERCLOS)', fa?.nivel ? `${(fa.perclos * 100).toFixed(1)} %` : espera, 'last minute · ≥80 % closed');
    fila(7.4, 'Blink length', fa?.nivel && fa.durMed != null ? `${Math.round(fa.durMed)} ms` : '—', fa?.nivel ? `${fa.largos} closures ≥ 0.5 s` : 'longer when sleepy');
    fila(8.4, 'Yawns', fa?.nivel ? `${fa.bostezos}` : '—', 'last 5 minutes');
    const col = { alerta: '#8fe6f5', algo: '#f2b457', cansado: '#ec6aa8' }[fa?.nivel] || 'rgba(244,247,250,.5)';
    fila(9.4, 'Alertness', fa?.nivel ? NIVEL_FATIGA[fa.nivel] : espera, null, col);
  }
  texto(c, px + 16 * k, py + ph - 12 * k, 'mm assume an 11.7 mm iris · method: N. Richardson', { f: 9.5 * k, col: 'rgba(244,247,250,.38)' });
}
