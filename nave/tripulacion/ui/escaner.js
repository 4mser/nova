/* NOVA · Body scan (AR), v2.

   Split vision, like a headset tethered to a computer:
   · the phone (or this screen) shows its own camera at full speed, with no network in between;
   · each frame also goes to the ship's computer (/v1/vision/ws → vision/servidor.py), which runs the heavy models on its
     GPU (MediaPipe Pose heavy with 3D landmarks and body mask + both hands) and sends back only the results;
   · the phone draws the hologram on the live picture and hides the round trip: every result carries the time its frame
     was taken, the landmarks are predicted forward to "now" from their motion, and the phone's gyroscope corrects for
     the phone turning in the meantime (the same trick headsets use, timewarp).
   If the ship's vision is not reachable, the phone runs the vision itself (lighter models) and says so.

   Gravity changes the procedure. The phone's accelerometer measures the local g and which way is down; the mission
   says where the ship is (cruise = microgravity, Mars = 0.38 g). CPR coaching follows the DGLRM/ESAM guideline for CPR in
   microgravity (Hinkelbein et al., Scand J Trauma Resusc Emerg Med 2020, CC BY 4.0): Evetts-Russomano at the site,
   reverse bear hug if that fails, handstand once the patient is on the restraint system, defibrillation only on a
   restrained, isolated patient. In microgravity Nova also watches the patient drift.

   The anatomy is the reference atlas fitted to this person (shoulder line, torso axis, turn from the 3D landmarks). It is
   an estimate from proportions, not an image of the inside, and the screen says so. */
import * as THREE from './lib/three.module.min.js';
import { FilesetResolver, PoseLandmarker, HandLandmarker } from './lib/mediapipe/vision_bundle.mjs';
import { AR as AR_PASOS, Procedimiento, corregir, NOMBRE_VITAL } from './procedimientos.js';
import { ojos, cargarOjos, medirOjos, pintarOjos, pintarFijacion, panelOjos, empezarRevision, terminarRevision } from './ojos.mjs?v=4';

const $ = id => document.getElementById(id);
const P = new URLSearchParams(location.search);
const MOVIL = /Android|iPhone|iPad/i.test(navigator.userAgent);
const TOKEN = P.get('token') || '';
const DISP = (() => { try { let d = localStorage.getItem('nova:disp'); if (!d) { d = (MOVIL ? 'movil-' : 'pantalla-') + Math.random().toString(36).slice(2, 8); localStorage.setItem('nova:disp', d); } return d; } catch { return 'visor-' + Math.random().toString(36).slice(2, 8); } })();
const G0 = 9.80665;

/* ── crew, live twin and mission ── */
let CREW = [], estado = null, mision = null, tripI = 0;
const capas = new Set(P.has('limpio') ? [] : ['organos', 'esqueleto']); // the hologram of the body systems; ?limpio starts with nothing on
if (P.has('rcp')) capas.add('rcp');
let visor = false, frente = !MOVIL;
let modoG = P.get('g') || 'auto';               // auto (mission) · tierra · marte · micro
let tecnica = 'er';                              // microgravity CPR technique
const TECNICAS = ['er', 'rbh', 'hs', 'sujeto'];

async function cargarCrew() {
  try { CREW = await (await fetch('tripulacion.json')).json(); } catch { CREW = [{ id: 'T1', corto: 'Crew', nombre: 'Crew member', pronombre: 'they/them' }]; }
  const q = P.get('trip'); if (q) tripI = Math.max(0, CREW.findIndex(c => c.id === q));
  if (CREW[tripI]?.vacio) tripI = Math.max(0, CREW.findIndex(c => !c.vacio)); // con tripulación real, sin asientos vacíos
  $('gTrip').innerHTML = CREW.map((c, i) => `<button class="b${i === tripI ? ' on' : ''}" data-trip="${i}"${c.vacio ? ' hidden' : ''}>${c.corto}</button>`).join('');
}
async function leerEstado() { try { const r = await fetch(BASE + '/v1/estado', { cache: 'no-store' }); if (r.ok) estado = await r.json(); } catch {} }
async function leerMision() { try { const r = await fetch(BASE + '/v1/mision', { cache: 'no-store' }); if (r.ok) mision = await r.json(); } catch {} }
const tr = () => estado && estado.trip && estado.trip[tripI];
const NIVEL_COL = { normal: null, esperado_vuelo: null, vigilar: '#a898ff', atencion: '#f2b457', aviso_tierra: '#ec6aa8' };
const RANGO = { sin_dato: 0, normal: 1, esperado_vuelo: 1, vigilar: 2, atencion: 3, aviso_tierra: 4 };
const peor = (t, ...ks) => ks.reduce((a, k) => (t && RANGO[t.niveles?.[k]] > RANGO[a] ? t.niveles[k] : a), 'sin_dato');
const f1 = (x, d = 0) => x == null || !isFinite(x) || x === 0 ? '—' : x.toFixed(d);

const GRUPOS = {
  corazon:    { n: 'Heart',      col: '#ff5d73', a: .55, dato: t => ({ v: `${f1(t?.pulso)} bpm`, s: `BP ${f1(t?.pa_sis)}/${f1(t?.pa_dia)}`, nivel: peor(t, 'pulso', 'pa_sis', 'pa_dia') }) },
  pulmones:   { n: 'Lungs',      col: '#7fd3ff', a: .26, dato: t => ({ v: `SpO₂ ${f1(t?.spo2)}%`, s: `${f1(t?.fr)} breaths/min`, nivel: peor(t, 'spo2', 'fr') }) },
  higado:     { n: 'Liver',      col: '#e0865c', a: .42, dato: () => ({ v: 'No labs today', s: 'Last panel: day 200', nivel: 'sin_dato' }) },
  estomago:   { n: 'Stomach',    col: '#f2b457', a: .45, dato: () => ({ v: 'Fed', s: 'Last meal logged 2 h ago', nivel: 'sin_dato' }) },
  bazo:       { n: 'Pancreas',   col: '#b79bff', a: .45, dato: t => ({ v: `Glucose ${f1(t?.glucosa)} mg/dL`, s: 'Continuous sensor', nivel: peor(t, 'glucosa') }) },
  intestinos: { n: 'Intestines', col: '#e7a17a', a: .30, dato: () => ({ v: 'Not measured', s: '', nivel: 'sin_dato' }) },
  rinones:    { n: 'Kidneys',    col: '#ec6aa8', a: .5,  dato: () => ({ v: 'Stone risk: usual', s: 'Estimated from bone loss', nivel: 'sin_dato' }) },
  vasos:      { n: 'Great vessels', col: '#ff6a7d', a: .5, dato: t => ({ v: `BP ${f1(t?.pa_sis)}/${f1(t?.pa_dia)}`, s: 'Aorta and vena cava', nivel: peor(t, 'pa_sis', 'pa_dia') }) },
  cerebro:    { n: 'Brain',      col: '#c3b8ff', a: .30, dato: t => ({ v: `Mood ${t?.animo ?? '—'}/5`, s: `Sleep ${f1(t?.sueno_h, 1)} h`, nivel: peor(t, 'animo', 'sueno_h') }) },
  esqueleto:  { n: 'Skeleton',   col: '#cfe6f5', a: .16, dato: () => ({ v: 'Bone loss −2.1%', s: 'Estimated, exercise on plan', nivel: 'sin_dato' }) },
  craneo:     { n: 'Skull',      col: '#cfe6f5', a: .16, dato: () => ({ v: '', s: '', nivel: 'sin_dato' }) },
};
// limb segments: each one hangs from two joints of the picture (MediaPipe) and of the reference skeleton
const SEGMENTOS = {
  brazoI: [11, 13, 'hombro', 'codo', 1], brazoD: [12, 14, 'hombro', 'codo', -1],
  antebrazoI: [13, 15, 'codo', 'muneca', 1], antebrazoD: [14, 16, 'codo', 'muneca', -1],
  musloI: [23, 25, 'cadera', 'rodilla', 1], musloD: [24, 26, 'cadera', 'rodilla', -1],
  piernaI: [25, 27, 'rodilla', 'tobillo', 1], piernaD: [26, 28, 'rodilla', 'tobillo', -1],
};
for (const g of Object.keys(SEGMENTOS)) GRUPOS[g] = { n: 'Skeleton', col: '#cfe6f5', a: .16, dato: () => ({ v: '', s: '', nivel: 'sin_dato' }) };
const ES_HUESO = g => g === 'esqueleto' || g === 'craneo' || g in SEGMENTOS;
const ETIQUETAS = ['corazon', 'pulmones', 'higado', 'bazo', 'rinones'];
/* body systems for the hologram: what lights up, where the panel anchors, what a clinician wants to read there */
const SISTEMAS = {
  cardio: { n: 'Cardiovascular', col: '#ff7a8f', grupos: ['corazon', 'vasos'], ancla: 'corazon', vit: [['pulso', 'Heart rate', 'bpm', 0], ['pa_sis', 'Systolic BP', 'mmHg', 0]] },
  resp:   { n: 'Respiratory',    col: '#7fd8ff', grupos: ['pulmones'], ancla: 'pulmones', vit: [['spo2', 'SpO₂', '%', 0], ['fr', 'Breathing', '/min', 0]] },
  metab:  { n: 'Metabolic',      col: '#ffc27a', grupos: ['higado', 'bazo', 'estomago', 'intestinos'], ancla: 'bazo', vit: [['glucosa', 'Glucose', 'mg/dL', 0]] },
  renal:  { n: 'Renal',          col: '#d99cff', grupos: ['rinones'], ancla: 'rinones', est: ['Stone risk', 'usual', 'estimated from bone loss · no urine test logged'] },
  oseo:   { n: 'Skeletal',       col: '#cfeeff', grupos: ['esqueleto', 'craneo', ...Object.keys({ brazoI: 1, brazoD: 1, antebrazoI: 1, antebrazoD: 1, musloI: 1, musloD: 1, piernaI: 1, piernaD: 1 })], ancla: 'esqueleto', est: ['Bone density', '−2.1%', 'estimated · NASA loss rates, exercise on plan'] },
  neuro:  { n: 'Neurological',   col: '#b9a9ff', grupos: ['cerebro'], ancla: 'cerebro', vit: [['animo', 'Mood', '/5', 0], ['sueno_h', 'Sleep', 'h', 1]] },
  // ojos: no usa el cuerpo; mide la cara con Face Landmarker en este dispositivo (ojos.mjs, método de N. Richardson)
  ojos:   { n: 'Eyes',           col: '#8fe6f5', grupos: [], ancla: 'cerebro', cara: true },
};
let sistema = P.get('sistema') && SISTEMAS[P.get('sistema')] ? P.get('sistema') : 'cardio';
const histSis = {}; let tHist = 0;
async function leerHistoria() {
  const c = CREW[tripI], S = SISTEMAS[sistema]; if (!c || !S.vit) return;
  for (const [k] of S.vit) {
    try { const r = await (await fetch(`${BASE}/v1/historia?trip=${c.id}&k=${k}&seg=600&puntos=60`)).json(); histSis[c.id + k] = r; } catch {}
  }
}
setInterval(() => { if (performance.now() - tHist > 5000) { tHist = performance.now(); leerHistoria(); } }, 1000);

/* ── gravity: measured by the phone, expected by the mission, chosen for the procedure ── */
const grav = { med: null, dir: null, t: 0 }; // g measured (in g) and "down" in the screen (unit 2D, y down)
function gravedadMision() {
  if (!mision) return null;
  return mision.fase === 'mars' ? .38 : 0; // cruise and return: free fall (microgravity)
}
function gravedadActiva() {
  if (modoG === 'tierra') return { g: 1, de: 'Earth' };
  if (modoG === 'marte') return { g: .38, de: 'Mars' };
  if (modoG === 'micro') return { g: 0, de: 'Microgravity' };
  const gm = gravedadMision();
  if (gm != null) return { g: gm, de: gm === 0 ? 'Microgravity · mission' : 'Mars · mission' };
  return { g: grav.med ?? 1, de: 'Measured' };
}
const regimen = g => g < .05 ? 'micro' : g < .6 ? 'marte' : 'tierra';

/* ── phone motion: gravity vector and gyroscope (for timewarp) ── */
let USAR_GIRO = P.get('giro') !== '0'; // ?giro=0 turns the gyroscope correction off (NOVA Station can switch it too)
const giro = { x: 0, y: 0, hist: [], hay: false };   // integrated rotation of the view (rad), screen axes
function anguloPantalla() { return (screen.orientation && screen.orientation.angle) || window.orientation || 0; }
function aPantallaDisp(x, y) { // device axes (x right, y up in portrait) → screen axes for the current orientation
  const a = anguloPantalla() * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: x * c + y * s, y: -x * s + y * c };
}
window.addEventListener('devicemotion', e => {
  const t = performance.now();
  const a = e.accelerationIncludingGravity;
  if (a && a.x != null) {
    const m = Math.hypot(a.x, a.y, a.z) / G0;
    grav.med = grav.med == null ? m : grav.med + (m - grav.med) * .08;
    // the reading points up (reaction to gravity); down in the screen is the opposite, with screen y growing downward
    const s = aPantallaDisp(a.x, a.y), n = Math.hypot(s.x, s.y);
    if (n > 1) grav.dir = { x: -s.x / n, y: s.y / n };
    grav.t = t;
  }
  const r = e.rotationRate;
  if (r && r.alpha != null && e.interval) {
    const dt = Math.min(.1, e.interval > 1 ? e.interval / 1000 : e.interval), k = Math.PI / 180;
    // rotation about the device's x (pitch) and y (yaw) axes, in screen axes
    const s = aPantallaDisp(r.beta * k * dt, r.gamma * k * dt);
    giro.x += s.x; giro.y += s.y; giro.hay = USAR_GIRO;
    giro.hist.push([t, giro.x, giro.y]); if (giro.hist.length > 120) giro.hist.shift();
  }
});
// the gyroscope's axes and signs differ between phones: learn them from how the landmarks actually move
const calGiro = { sxx: 0, sxo: 0, syy: 0, syo: 0, x: 0, y: 0, prev: null };
function aprenderGiro(c, tc) {
  if (!giro.hay) return;
  const { vw, vh } = recorte, f = (vw / 2) / Math.tan(HFOV / 2);
  if (calGiro.prev && tc - calGiro.prev.t < 200) {
    const [ax, ay] = giroEn(calGiro.prev.t), [bx, by] = giroEn(tc);
    const X = f * (by - ay), Y = f * (bx - ax), ox = (c.x - calGiro.prev.c.x) * vw, oy = (c.y - calGiro.prev.c.y) * vh;
    const d = .985;
    calGiro.sxx = calGiro.sxx * d + X * X; calGiro.sxo = calGiro.sxo * d + X * ox;
    calGiro.syy = calGiro.syy * d + Y * Y; calGiro.syo = calGiro.syo * d + Y * oy;
    // a sign only once the phone has really turned, and only if the picture moved with it (slope near ±1)
    const kx = calGiro.sxx > 4000 ? calGiro.sxo / calGiro.sxx : 0, ky = calGiro.syy > 4000 ? calGiro.syo / calGiro.syy : 0;
    calGiro.x = Math.abs(kx) > .45 ? Math.sign(kx) : 0; calGiro.y = Math.abs(ky) > .45 ? Math.sign(ky) : 0;
  }
  calGiro.prev = { c, t: tc };
}
function giroEn(t) { // integrated rotation at time t (ms)
  const h = giro.hist; if (!h.length) return [0, 0];
  for (let i = h.length - 1; i >= 0; i--) if (h[i][0] <= t) return [h[i][1], h[i][2]];
  return [h[0][1], h[0][2]];
}

/* ── camera ── */
const video = document.createElement('video'); video.playsInline = true; video.muted = true;
let flujoCam = null;
async function iniciarCamara() {
  if (flujoCam) flujoCam.getTracks().forEach(t => t.stop());
  if (!navigator.mediaDevices?.getUserMedia) throw new Error(location.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(location.hostname)
    ? 'The camera needs the secure link: open https://' + location.hostname + ':8751/escaner.html' : 'This browser has no camera access');
  flujoCam = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: frente ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } } });
  video.srcObject = flujoCam; await video.play();
}
let HFOV = (+P.get('fov') || (MOVIL ? 67 : 60)) * Math.PI / 180; // the camera's horizontal field of view (NOVA Station can tune it)

/* ── vision: the ship's computer first, this device as fallback ── */
const vis = { ms: 0, rtt: 0, gpu: '', tUlt: 0, vuelo: new Map(), ws: null, listoMac: false, intentos: 0, local: null, tConexion: 0 };
const envMac = document.createElement('canvas'), envMacCtx = envMac.getContext('2d');
let idCuadro = 0;
function urlVision() { return (BASE || location.origin).replace(/^http/, 'ws') + '/v1/vision/ws'; }
function conectarMac() {
  if (P.has('local')) return;
  let ws; try { ws = new WebSocket(urlVision()); } catch { return; }
  ws.binaryType = 'arraybuffer'; vis.ws = ws; vis.vuelo.clear();
  ws.onmessage = e => {
    let r; try { r = JSON.parse(e.data); } catch { return; }
    if (r.tipo === 'hola') { vis.listoMac = true; vis.gpu = r.gpu; vis.intentos = 0; return; }
    if (r.tipo === 'sin_vision') { vis.listoMac = false; return; }
    if (r.tipo !== 'vision') return;
    // the ship only processes the newest frame: an answer for frame N also settles every older frame still in flight
    for (const id of vis.vuelo.keys()) if (id <= r.id) vis.vuelo.delete(id);
    vis.rtt += ((performance.now() - r.tc) - vis.rtt) * .15; vis.ms += (r.ms - vis.ms) * .15;
    recibir(normalizarMac(r), r.tc, 'mac');
  };
  ws.onclose = () => { vis.listoMac = false; vis.ws = null; vis.intentos++; setTimeout(conectarMac, Math.min(5000, 800 * vis.intentos)); };
}
function normalizarMac(r) {
  const poses = (r.poses || []).map(p => {
    const lm = [], mundo = [];
    for (let i = 0; i < 33; i++) {
      lm.push({ x: p.lm[i * 4], y: p.lm[i * 4 + 1], z: p.lm[i * 4 + 2], v: p.lm[i * 4 + 3] });
      if (p.mundo.length) mundo.push({ x: p.mundo[i * 3], y: p.mundo[i * 3 + 1], z: p.mundo[i * 3 + 2] });
    }
    return { lm, mundo };
  });
  const manos = (r.manos || []).map(m => ({ lado: m.lado, lm: Array.from({ length: 21 }, (_, i) => ({ x: m.lm[i * 3], y: m.lm[i * 3 + 1], z: m.lm[i * 3 + 2] })) }));
  let mascara = null;
  if (r.mascara) { mascara = new Image(); mascara.src = 'data:image/png;base64,' + r.mascara; }
  return { poses, manos, mascara };
}
// one frame up to the ship. Two in flight at most: the pipeline stays full without building a queue.
async function enviarMac() {
  const ws = vis.ws; if (!ws || ws.readyState !== 1 || !vis.listoMac) return;
  const ahora = performance.now();
  for (const [id, t0] of vis.vuelo) if (ahora - t0 > 400) vis.vuelo.delete(id); // lost on the way
  if (vis.vuelo.size >= 2) return;
  const vw = video.videoWidth, vh = video.videoHeight; if (!vw) return;
  const k = 512 / Math.max(vw, vh), w = Math.round(vw * k), h = Math.round(vh * k);
  if (envMac.width !== w || envMac.height !== h) { envMac.width = w; envMac.height = h; }
  envMacCtx.drawImage(video, 0, 0, w, h);
  const tc = performance.now(), id = ++idCuadro, cab = new TextEncoder().encode(JSON.stringify({ id, tc, disp: DISP }));
  vis.vuelo.set(id, tc);
  const jpg = await codificar(envMac, .62);
  const buf = new Uint8Array(4 + cab.length + jpg.length);
  new DataView(buf.buffer).setUint32(0, cab.length, true); buf.set(cab, 4); buf.set(jpg, 4 + cab.length);
  try { ws.send(buf); } catch { vis.vuelo.delete(id); }
}
// JPEG: toBlob is asynchronous and fast on phones, but some browsers stall it; measure and fall back to toDataURL
let modoCod = 'blob', msCod = 0;
async function codificar(c, q) {
  const t = performance.now();
  let bytes;
  if (modoCod === 'blob') {
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
    bytes = new Uint8Array(await b.arrayBuffer());
  } else {
    const s = atob(c.toDataURL('image/jpeg', q).split(',')[1]); bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  }
  msCod += ((performance.now() - t) - msCod) * .2;
  if (modoCod === 'blob' && msCod > 60) modoCod = 'url';
  return bytes;
}

/* on-device fallback: same results, lighter models */
const chico = document.createElement('canvas'), cctx = chico.getContext('2d');
let tsLocal = 0, localListo = null;
function cargarLocal() {
  if (vis.local) return vis.local;
  vis.local = (async () => {
    const fs = await FilesetResolver.forVisionTasks('lib/mediapipe/wasm');
    const crear = async (Clase, modelo, extra) => {
      for (const delegate of ['GPU', 'CPU']) {
        try { return await Clase.createFromOptions(fs, { baseOptions: { modelAssetPath: modelo, delegate }, runningMode: 'VIDEO', ...extra }); } catch (e) { if (delegate === 'CPU') throw e; }
      }
    };
    const [pose, manos] = await Promise.all([
      crear(PoseLandmarker, `lib/mediapipe/modelos/pose_landmarker_${MOVIL ? 'lite' : 'full'}.task`, { numPoses: 1, outputSegmentationMasks: true }),
      crear(HandLandmarker, 'lib/mediapipe/modelos/hand_landmarker.task', { numHands: 2 }),
    ]);
    localListo = { pose, manos };
    return localListo;
  })();
  return vis.local;
}
const mascaraLocal = document.createElement('canvas'), mlctx = mascaraLocal.getContext('2d');
function visionLocal(m, ahora) {
  const vw = video.videoWidth, vh = video.videoHeight, kd = 384 / Math.max(vw, vh);
  const cw = Math.round(vw * kd), ch = Math.round(vh * kd);
  if (chico.width !== cw || chico.height !== ch) { chico.width = cw; chico.height = ch; }
  cctx.drawImage(video, 0, 0, cw, ch);
  tsLocal = Math.max(tsLocal + 1, Math.round(ahora));
  let rp, rm; try { rp = m.pose.detectForVideo(chico, tsLocal); rm = m.manos.detectForVideo(chico, tsLocal); } catch { return; }
  const poses = (rp.landmarks || []).map((lm, i) => ({ lm: lm.map(p => ({ x: p.x, y: p.y, z: p.z, v: p.visibility ?? 1 })), mundo: (rp.worldLandmarks?.[i] || []).map(p => ({ x: p.x, y: p.y, z: p.z })) }));
  let mascara = null;
  const mk = rp.segmentationMasks?.[0];
  if (mk) {
    const w = mk.width, h = mk.height, d = mk.getAsFloat32Array();
    if (mascaraLocal.width !== w || mascaraLocal.height !== h) { mascaraLocal.width = w; mascaraLocal.height = h; }
    const img = mlctx.createImageData(w, h); for (let i = 0; i < d.length; i++) { const v = d[i] * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    mlctx.putImageData(img, 0, 0); mascara = mascaraLocal; mk.close?.();
  }
  const manos = (rm.landmarks || []).map((lm, i) => ({ lado: rm.handednesses?.[i]?.[0]?.categoryName || '', lm: lm.map(p => ({ x: p.x, y: p.y, z: p.z })) }));
  recibir({ poses, manos, mascara }, ahora, 'local');
}

/* ── tracking: smooth, keep the motion, predict to the moment of display ── */
class Pista { // one coordinate: One-euro smoothing + its velocity (units per ms)
  constructor() { this.x = null; this.v = 0; this.t = 0; }
  poner(x, t) {
    if (this.x == null || t - this.t > 400) { this.x = x; this.v = 0; this.t = t; return; }
    const dt = Math.max(1, t - this.t), vi = (x - this.x) / dt;
    this.v += (vi - this.v) * Math.min(1, dt / 60);
    const corte = .7 + 2500 * Math.abs(this.v); // Hz: very steady when still, quicker when moving
    const a = 1 / (1 + 1000 / (2 * Math.PI * corte * dt));
    this.x += a * (x - this.x); this.t = t;
  }
}
const PUNTOS = [0, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 19, 20, 23, 24, 25, 26, 27, 28];
const pistas = {};
let tObs = -1e9, fuenteObs = 'nada';
let mundoS = null, mascaraUlt = null, manosUlt = [], tManos = 0;
let pacPrev = null;
function elegirPaciente(poses) {
  // once Nova has locked on someone, it stays with whoever is closest to where they were
  if (pacPrev && poses.length) {
    let mejorP = null, dm = 1e9;
    for (const p of poses) { const lm = p.lm; if (!lm[11] || !lm[12]) continue; const cx = (lm[11].x + lm[12].x) / 2, cy = (lm[11].y + lm[12].y) / 2, d = Math.hypot(cx - pacPrev.x, cy - pacPrev.y); if (d < dm) { dm = d; mejorP = p; } }
    if (mejorP && dm < .18) { const lm = mejorP.lm; pacPrev = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 }; return mejorP; }
  }
  // with two people in view: the one lying down (most horizontal torso), else the larger one
  let mejor = null, nota = -1;
  for (const p of poses) {
    const lm = p.lm; if (!lm[11] || lm[11].v < .3 || lm[12].v < .3) continue;
    const hx = (lm[11].x + lm[12].x) / 2, hy = (lm[11].y + lm[12].y) / 2, cx = (lm[23].x + lm[24].x) / 2, cy = (lm[23].y + lm[24].y) / 2;
    const largo = Math.hypot(hx - cx, hy - cy), horiz = Math.abs(hx - cx) / (largo || 1);
    const n = largo + (poses.length > 1 ? horiz : 0);
    if (n > nota) { nota = n; mejor = p; }
  }
  if (mejor) pacPrev = { x: (mejor.lm[11].x + mejor.lm[12].x) / 2, y: (mejor.lm[11].y + mejor.lm[12].y) / 2 };
  return mejor;
}
function recibir(r, tc, fuente) {
  const p = elegirPaciente(r.poses);
  if (p) {
    for (const i of PUNTOS) {
      const q = p.lm[i]; if (!q) continue;
      const s = pistas[i] ||= { x: new Pista(), y: new Pista(), v: 0 };
      s.x.poner(q.x, tc); s.y.poner(q.y, tc); s.v = q.v;
    }
    if (p.mundo.length) { // the 3D points are noisy frame to frame: an exponential average keeps the body's turn and size calm
      if (!mundoS || mundoS.length !== p.mundo.length) mundoS = p.mundo.map(q => ({ ...q }));
      else p.mundo.forEach((q, i) => { const m = mundoS[i]; m.x += (q.x - m.x) * .3; m.y += (q.y - m.y) * .3; m.z += (q.z - m.z) * .3; });
    }
    if (fuente === 'mac' && p.lm[11] && p.lm[12]) aprenderGiro({ x: (p.lm[11].x + p.lm[12].x) / 2, y: (p.lm[11].y + p.lm[12].y) / 2 }, tc);
    tObs = tc; fuenteObs = fuente;
  }
  if (r.mascara) mascaraUlt = { img: r.mascara, tc };
  manosUlt = r.manos.map(m => ({ ...m, tc })); tManos = performance.now();
  if (fuente === 'mac') vis.tUlt = performance.now();
}
function observar(t) { // landmarks predicted to time t (+ the phone's turn since the frame was taken)
  if (t - tObs > 700) return null;
  const o = {};
  let gx = 0, gy = 0;
  if (giro.hay && fuenteObs === 'mac') { const [ax, ay] = giroEn(tObs), [bx, by] = giroEn(t); gx = bx - ax; gy = by - ay; }
  const { vw, vh } = recorte, f = (vw / 2) / Math.tan(HFOV / 2), calibrado = calGiro.x || calGiro.y;
  const desx = calGiro.x * f * gy / vw, desy = calGiro.y * f * gx / vh;
  for (const i of PUNTOS) {
    const s = pistas[i]; if (!s || s.x.x == null) continue;
    // with a calibrated gyroscope the phone's own turn is applied exactly and only half of the tracked motion is extrapolated
    // short, damped prediction: a steady hologram that lags a little beats one that jumps ahead
    const k = calibrado ? .35 : .6, dtp = Math.max(0, Math.min(60, t - s.x.t)) * k;
    o[i] = { x: s.x.x + s.x.v * dtp + desx, y: s.y.x + s.y.v * dtp + desy, v: s.v };
  }
  o.giro = null; // already applied to the points
  return o;
}

/* ── anatomy ── */
let ren, esc, cam, camP, cuerpo, cabeza, atlas, grupos = {}, centros = {}, listo3d = false;
const uniComun = { t: { value: 0 }, barrido: { value: -1 }, tresD: { value: 0 } };
// visual direction: holo (fine hologram), clinico (shaded anatomy), rx (x-ray)
let ESTILO = ['holo', 'clinico', 'rx'].includes(P.get('estilo')) ? P.get('estilo') : 'holo';
let MODO = { holo: 0, clinico: 1, rx: 2 }[ESTILO];
// the look can change live (from NOVA Station): every part gets a new material in the new style
function cambiarEstilo(e) {
  if (!['holo', 'clinico', 'rx'].includes(e) || e === ESTILO) return;
  ESTILO = e; MODO = { holo: 0, clinico: 1, rx: 2 }[e];
  for (const g in grupos) {
    const viejo = grupos[g].userData.mat, nuevo = material(g);
    grupos[g].userData.mat = nuevo;
    grupos[g].traverse(m => { if (m.isMesh) m.material = nuevo; });
    viejo.dispose();
  }
}
const COL_CLIN = { corazon: '#b8333a', pulmones: '#e3a4a8', higado: '#8c3b2b', estomago: '#d39a7a', bazo: '#a0607a', intestinos: '#d49b84', rinones: '#93463f', vasos: '#c23a2e', cerebro: '#e8c9c6', esqueleto: '#efe6d2' };
const COL_HOLO = { corazon: '#ff8a9a' };
const ALFA = {
  holo: { esqueleto: .06, pulmones: .05, def: .12 },
  clinico: { esqueleto: .28, pulmones: .42, vasos: .9, def: .93 },
  rx: { esqueleto: .16, pulmones: .03, def: .05 },
};
function material(g) {
  const gb = ES_HUESO(g) ? 'esqueleto' : g; // every bone looks like the skeleton
  const col = ESTILO === 'clinico' ? COL_CLIN[gb] : ESTILO === 'holo' ? (COL_HOLO[gb] || '#a6ecff') : '#dfeeff';
  const a = ALFA[ESTILO][gb] ?? ALFA[ESTILO].def;
  const solido = ESTILO === 'clinico' && a > .8;
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: solido, side: THREE.DoubleSide,
    uniforms: { c: { value: new THREE.Color(col) }, a: { value: a }, brillo: { value: 1 }, alerta: { value: new THREE.Color('#000') }, ka: { value: 0 }, t: uniComun.t, barrido: uniComun.barrido, modo: { value: MODO }, hueso: { value: ES_HUESO(g) ? 1 : 0 },
      Bp: { value: huesos.Bp }, Bt: { value: huesos.Bt }, Bh: { value: huesos.Bh }, tresD: uniComun.tresD, cab: { value: g === 'cerebro' || g === 'craneo' ? 1 : 0 },
      Bs: { value: (huesos.seg[g] ||= { M: new THREE.Matrix4(), vis: false }).M }, useSeg: { value: g in SEGMENTOS ? 1 : 0 } },
    vertexShader: `uniform mat4 Bp; uniform mat4 Bt; uniform mat4 Bh; uniform mat4 Bs; uniform float useSeg; uniform float tresD; uniform float cab; varying vec3 vN; varying float vY; varying vec3 vV;
      void main(){
        if (tresD < .5) { vN = normalize(normalMatrix*normal); vY = position.y; vV = vec3(0.,0.,1.); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); return; }
        vec4 mp = modelMatrix * vec4(position, 1.);
        float w = smoothstep(1.0, 1.25, mp.y), wh = smoothstep(1.47, 1.56, mp.y);
        mat4 B = useSeg > .5 ? Bs : cab > .5 ? Bh : (Bp * (1. - w) + Bt * w) * (1. - wh) + Bh * wh;
        vec4 cp = B * mp;
        vN = normalize(mat3(B) * mat3(modelMatrix) * normal); vV = normalize(-cp.xyz); vY = mp.y;
        gl_Position = projectionMatrix * viewMatrix * cp; }`,
    fragmentShader: `uniform vec3 c; uniform float a; uniform float brillo; uniform vec3 alerta; uniform float ka; uniform float t; uniform float barrido; uniform int modo; uniform float hueso; varying vec3 vN; varying float vY; varying vec3 vV;
      void main(){
        vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
        vec3 vv = normalize(vV);
        float r = pow(1. - abs(dot(n, vv)), 2.4);
        float activo = step(0., barrido);
        float vis = mix(1., smoothstep(barrido - .002, barrido + .02, vY), activo);
        float borde = (1. - smoothstep(0., .012, abs(vY - barrido))) * activo;
        vec3 base = mix(c, alerta, ka); vec3 col; float al;
        if (modo == 1) {            // shaded anatomy: soft key light, a little specular, solid where it should be
          vec3 L = normalize(vec3(-.35, .55, .75));
          float d = max(dot(n, L), 0.) * .7 + .3;
          float sp = pow(max(dot(reflect(-L, n), vv), 0.), 28.) * .22;
          col = base * d + sp; al = a;
        } else if (modo == 0) {     // hologram: light at the rims, a thin luminous fill, faint scan lines
          float lin = .9 + .1 * sin(gl_FragCoord.y * 1.1 - t * 3.);
          col = base * (.35 + r * 1.25) + vec3(.08, .16, .2) * r; al = (a * .7 + r * .95) * lin;
        } else {                    // x-ray: bone bright, soft tissue faint
          col = mix(vec3(.86, .93, 1.), base, .15) * (.6 + r * .7); al = a + r * (.35 + hueso * .5);
        }
        al = clamp(al * brillo, 0., .96) * vis + borde * .6;
        gl_FragColor = vec4(mix(col * brillo, vec3(.9, .98, 1.), borde), al); }`
  });
}
async function cargarAnatomia() {
  atlas = await (await fetch('anatomia/escaner/hombre.json?v=2')).json();
  ARTIC = atlas.articulaciones || null;
  const r = await fetch('anatomia/escaner/hombre.bin.gz?v=2');
  const buf = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const mats = {};
  for (const p of atlas.partes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, p.positions, p.vertexCount * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Int16Array(buf, p.normals, p.vertexCount * 3), 3, true));
    geo.setIndex(new THREE.BufferAttribute(p.i16 ? new Uint16Array(buf, p.indices, p.indexCount) : new Uint32Array(buf, p.indices, p.indexCount), 1));
    const g = p.grupo;
    if (!grupos[g]) {
      grupos[g] = new THREE.Group(); grupos[g].matrixAutoUpdate = false; grupos[g].userData.mat = mats[g] = material(g);
      grupos[g].renderOrder = ES_HUESO(g) ? 0 : g === 'pulmones' ? 1 : 2;
      (g === 'cerebro' || g === 'craneo' ? cabeza : cuerpo).add(grupos[g]);
      centros[g] = new THREE.Box3();
    }
    const m = new THREE.Mesh(geo, mats[g]); m.renderOrder = grupos[g].renderOrder; m.frustumCulled = false;
    grupos[g].add(m);
    centros[g].union(new THREE.Box3(new THREE.Vector3(...p.bounds[0]), new THREE.Vector3(...p.bounds[1])));
  }
  for (const g in centros) centros[g] = centros[g].getCenter(new THREE.Vector3());
  centros.pulmones = new THREE.Vector3(-0.075, 1.36, 0.02);
  listo3d = true;
  barrer(performance.now() / 1000);
}
function montar3d() {
  ren = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
  ren.setPixelRatio(1);
  esc = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000); cam.position.z = 1000;
  camP = new THREE.PerspectiveCamera(50, 1, .05, 30); // the phone's own camera, for the 3D fit
  cuerpo = new THREE.Group(); cuerpo.matrixAutoUpdate = false; esc.add(cuerpo);
  cabeza = new THREE.Group(); cabeza.matrixAutoUpdate = false; esc.add(cabeza);
}

/* model reference points (m) */
const REF = { hombros: new THREE.Vector3(0, 1.395, -0.02), anchoHombros: 0.37, largo: 0.50,
  orejas: new THREE.Vector3(0, 1.585, -0.01), anchoOrejas: 0.146, rcp: new THREE.Vector3(0, 1.29, 0.115),
  espalda: new THREE.Vector3(0, 1.25, -0.12), hombroD: new THREE.Vector3(-0.185, 1.40, 0), cadera: new THREE.Vector3(0, 0.95, 0) };

/* the fit: picture points → world (pixels, y up, centered). The turn about the body's long axis comes from the 3D
   landmarks, so the anatomy rotates in depth (heart in front, spine behind) instead of just squeezing. */
let ajuste = null, giroCuerpo = 0, ladoU = null, tAjuste = 0;
function calzar(o, W, H) {
  const { sx, sy, sw, sh, vw, vh } = recorte;
  const px = i => o[i] && o[i].v > .35 ? new THREE.Vector2((o[i].x * vw - sx) / sw * W - W / 2, H / 2 - (o[i].y * vh - sy) / sh * H) : null;
  const hI = px(11), hD = px(12), cI = px(23), cD = px(24), oI = px(7), oD = px(8);
  if (!hI || !hD) return null;
  const mH = hI.clone().add(hD).multiplyScalar(.5);
  let ey;
  if (cI && cD) ey = mH.clone().sub(cI.clone().add(cD).multiplyScalar(.5)).divideScalar(REF.largo);
  else { const ex0 = hI.clone().sub(hD); ey = new THREE.Vector2(-ex0.y, ex0.x); const nar = px(0); if (nar && nar.clone().sub(mH).dot(ey) < 0) ey.negate(); ey.setLength(ex0.length() / REF.anchoHombros * 1.28); }
  if (mundoS && mundoS[11] && mundoS[12]) {
    const d = { x: mundoS[11].x - mundoS[12].x, y: mundoS[11].y - mundoS[12].y, z: mundoS[11].z - mundoS[12].z };
    const yaw = Math.atan2(d.z, Math.hypot(d.x, d.y));
    giroCuerpo += (Math.max(-1.45, Math.min(1.45, yaw)) - giroCuerpo) * .25;
  }
  const c = Math.cos(giroCuerpo), sn = Math.sin(giroCuerpo);
  // the body's side axis in the picture: along the shoulders when they are apart, across the torso when seen from the side
  const hom = hI.clone().sub(hD), perp = new THREE.Vector2(ey.y, -ey.x).normalize();
  let u = hom.length() > ey.length() * REF.anchoHombros * .35 ? hom.clone().normalize() : (ladoU && perp.dot(ladoU) < 0 ? perp.negate() : perp);
  ladoU = u.clone();
  // pixels per meter across the body: from the shoulders when facing the camera, from the torso length when turned
  const sHom = hom.length() / (REF.anchoHombros * Math.max(.35, c)), sTor = ey.length();
  const sx2 = c > .6 ? sHom : c < .35 ? sTor : sHom + (sTor - sHom) * (.6 - c) / .25;
  const ex = u.clone().multiplyScalar(Math.max(sx2, sTor * .55));
  const det = ex.x * ey.y - ex.y * ey.x, s = (ex.length() + ey.length()) / 2, ez = det >= 0 ? s : -s;
  const armar = th => new THREE.Matrix4().set(ex.x, ey.x, 0, 0, ex.y, ey.y, 0, 0, 0, 0, ez, 0, 0, 0, 0, 1).multiply(new THREE.Matrix4().makeRotationY(det >= 0 ? th : -th));
  let M = armar(giroCuerpo);
  // turned sideways, the chest must face where the face does: the nose sits in front of the shoulder line
  const nar = px(0);
  if (Math.abs(sn) > .35 && nar) {
    const v = nar.clone().sub(mH), e = ey.clone().normalize(), fr = v.clone().sub(e.clone().multiplyScalar(v.dot(e)));
    const z = new THREE.Vector3(0, 0, 1).transformDirection(M), z2 = new THREE.Vector2(z.x, z.y);
    if (fr.length() > ey.length() * .03 && z2.length() > .2 && z2.dot(fr) < 0) { giroCuerpo = -giroCuerpo; M = armar(giroCuerpo); }
  }
  const o0 = REF.hombros.clone().applyMatrix4(M);
  // the phone's turn since the frame was taken (timewarp): the picture moved by focal × angle
  const f = (W / 2) / Math.tan(HFOV * sw / vw / 2);
  const dx = o.giro ? f * o.giro.y : 0, dy = o.giro ? -f * o.giro.x : 0;
  M.setPosition(mH.x - o0.x + dx, mH.y - o0.y + dy, 0);
  let C = M.clone();
  if (oI && oD && oI.distanceTo(oD) > ex.length() * .06 && c > .5) {
    const hx = oI.clone().sub(oD).divideScalar(REF.anchoOrejas * Math.max(.35, c));
    const hy = new THREE.Vector2(-hx.y, hx.x); if (hy.dot(ey) < 0) hy.negate();
    const hs = hx.length(), hz = det >= 0 ? hs : -hs;
    C = new THREE.Matrix4().set(hx.x, hy.x, 0, 0, hx.y, hy.y, 0, 0, 0, 0, hz, 0, 0, 0, 0, 1).multiply(new THREE.Matrix4().makeRotationY(det >= 0 ? giroCuerpo : -giroCuerpo));
    const mO = oI.clone().add(oD).multiplyScalar(.5), q = REF.orejas.clone().applyMatrix4(C);
    C.setPosition(mO.x - q.x + dx, mO.y - q.y + dy, 0);
  }
  // the body's position with the phone's whole turn taken out (for drift: only the patient's own motion counts)
  const [gxT, gyT] = giro.hay ? giroEn(performance.now()) : [0, 0];
  return { M, C, escala: s, det, ey, mpp: 1 / Math.max(1, ex.length()), centro: new THREE.Vector2(mH.x - f * gyT, mH.y + f * gxT) };
}
const aPantalla = (v, M, W, H) => { if (typeof M === 'function') return M(v); const p = v.clone().applyMatrix4(M); return { x: p.x + W / 2, y: H / 2 - p.y }; };
function pivote(g, c, sx, sy, sz) {
  g.matrix.makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeScale(sx, sy, sz)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
}
function espejo(aj) {
  if (aj.tresD) { const W = mono.width, m = f => v => { const p = f(v); return { x: W - p.x, y: p.y }; }; return { ...aj, M: m(aj.M), C: m(aj.C), ey: new THREE.Vector2(-aj.ey.x, aj.ey.y) }; }
  const F = new THREE.Matrix4().makeScale(-1, 1, 1);
  return { ...aj, M: F.clone().multiply(aj.M), C: F.clone().multiply(aj.C) };
}

/* ── 3D fit: this person's own skeleton, in meters, in front of the camera ──
   The 3D landmarks give the body's shape and turn (in meters, centred on the hips); a least-squares solve finds where
   that body stands in front of the camera so it projects onto the 2D landmarks; then every joint is put exactly on its
   image point at the depth the 3D landmarks give. Three bones (pelvis, thorax, head) carry the anatomy: each vertex
   blends between them by height, so the chest and the belly bend and twist with the person, like a rigged character. */
function resolver3(A, b) {
  const d = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = d(A); if (Math.abs(D) < 1e-9) return null;
  return [0, 1, 2].map(c => d(A.map((f, i) => f.map((v, j) => j === c ? b[i] : v))) / D);
}
let sonda = null;
const medidas = { hombros: .37, torso: .5, dist: 2, n: 0, nt: 0 };
let arribaSuave = null, tSuave = null; // this person's measured body (m), smoothed
const huesos = { Bp: new THREE.Matrix4(), Bt: new THREE.Matrix4(), Bh: new THREE.Matrix4(), suave: null, seg: {} };
let ARTIC = null; // the reference skeleton's joints (from the anatomy file)
// a rigid bone from two joints: the reference segment A0→B0 is turned, scaled and moved onto the person's A→B; its roll
// follows the torso's front, so the forearm bones do not spin around their own axis
function huesoSegmento(A0, B0, A, B, frente) {
  const u0 = B0.clone().sub(A0), l0 = u0.length(); u0.normalize();
  const u = B.clone().sub(A), l = u.length(); if (l < 1e-4) return null; u.normalize();
  const ref = new THREE.Vector3(0, 0, 1);
  const v0 = ref.clone().sub(u0.clone().multiplyScalar(ref.dot(u0))).normalize(), w0 = new THREE.Vector3().crossVectors(u0, v0);
  const v = frente.clone().sub(u.clone().multiplyScalar(frente.dot(u))); if (v.length() < 1e-3) v.set(0, 0, 1).sub(u.clone().multiplyScalar(u.z)); v.normalize();
  const w = new THREE.Vector3().crossVectors(u, v);
  const R = new THREE.Matrix4().makeBasis(u, v, w).multiply(new THREE.Matrix4().makeBasis(u0, v0, w0).transpose());
  const sc = Math.min(1.45, Math.max(.7, l / l0));
  return new THREE.Matrix4().makeTranslation(A.x, A.y, A.z).multiply(R).multiply(new THREE.Matrix4().makeScale(sc, sc, sc)).multiply(new THREE.Matrix4().makeTranslation(-A0.x, -A0.y, -A0.z));
}
function hueso(origen, X, Y, Z, s, ref) {
  const B = new THREE.Matrix4().makeBasis(X.clone().multiplyScalar(s.x), Y.clone().multiplyScalar(s.y), Z.clone().multiplyScalar(s.z));
  B.setPosition(origen);
  return B.multiply(new THREE.Matrix4().makeTranslation(-ref.x, -ref.y, -ref.z));
}
function suavizarMatriz(dest, nueva, a) { for (let i = 0; i < 16; i++) dest.elements[i] += (nueva.elements[i] - dest.elements[i]) * a; }
function calzar3D(o, W, H) {
  if (!mundoS || mundoS.length < 25) return null;
  const { sx, sy, sw, sh, vw, vh } = recorte, f = (vw / 2) / Math.tan(HFOV / 2), cx = vw / 2, cy = vh / 2;
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  const sumar = (r, v) => { for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) A[i][j] += r[i] * r[j]; b[i] += r[i] * v; } };
  let n = 0;
  // hips count only when really seen inside the picture; off-frame they are guesses that change every frame
  const enCuadro = q => q && q.x > .02 && q.x < .98 && q.y > .02 && q.y < .98;
  const caderasVis = o[23] && o[24] && o[23].v > .75 && o[24].v > .75 && enCuadro(o[23]) && enCuadro(o[24]);
  for (const i of caderasVis ? [0, 7, 8, 11, 12, 13, 14, 23, 24] : [0, 7, 8, 11, 12]) {
    const q = o[i], w = mundoS[i]; if (!q || !w || q.v < .5) continue;
    const u = q.x * vw, v = q.y * vh;
    sumar([f, 0, cx - u], -f * w.x - (cx - u) * w.z); sumar([0, f, cy - v], -f * w.y - (cy - v) * w.z); n++;
  }
  if (n < 4 || !o[11] || !o[12] || o[11].v < .35 || o[12].v < .35) return null;
  const t0 = resolver3(A, b); if (!t0 || t0[2] < .25 || t0[2] > 12) return null;
  // where the body stands (above all its distance) changes slowly: a steady estimate keeps the scale from breathing
  if (!tSuave || Math.abs(t0[2] - tSuave[2]) > .6) tSuave = t0.slice(); else for (let i = 0; i < 3; i++) tSuave[i] += (t0[i] - tSuave[i]) * (i === 2 ? .08 : .25);
  const t = tSuave;
  // camera space (x right, y down, z ahead) → three (x right, y up, z toward the viewer)
  const J = i => { const q = o[i], w = mundoS[i]; if (!q || !w) return null; const Z = Math.max(.2, w.z + t[2]); return new THREE.Vector3((q.x * vw - cx) / f * Z, -(q.y * vh - cy) / f * Z, -Z); };
  const Ls = J(11), Rs = J(12), S = Ls.clone().add(Rs).multiplyScalar(.5);
  // the torso's direction comes from the (smoothed) 3D landmarks, which stay consistent even when the hips are out of
  // view; its length is the one learned for this person. So a close-up anchored on the shoulders does not jump.
  const ws = mundoS, upW = new THREE.Vector3((ws[11].x + ws[12].x - ws[23].x - ws[24].x) / 2, -(ws[11].y + ws[12].y - ws[23].y - ws[24].y) / 2, -(ws[11].z + ws[12].z - ws[23].z - ws[24].z) / 2).normalize();
  if (!arribaSuave) arribaSuave = upW.clone(); else arribaSuave.lerp(upW, caderasVis ? .25 : .12).normalize();
  let Lh = null, Rh = null, Hh;
  if (caderasVis) { Lh = J(23); Rh = J(24); const largoV = S.distanceTo(Lh.clone().add(Rh).multiplyScalar(.5)); medidas.torso += (largoV - medidas.torso) * Math.max(.03, 1 / (++medidas.nt)); }
  // until the hips have been seen, the torso length follows the shoulders' proportion; the bones use the same length
  if (!medidas.nt) medidas.torso = Math.min(.62, Math.max(.4, REF.largo * (medidas.n ? medidas.hombros : Ls.distanceTo(Rs) * 1.18) / REF.anchoHombros));
  const largo = Math.min(1.35, Math.max(.75, medidas.torso / REF.largo)) * REF.largo;
  const arriba = arribaSuave.clone();
  Hh = S.clone().sub(arriba.clone().multiplyScalar(largo));
  const caderas = caderasVis;
  const ejes = (Lx, Rx) => { const X = Lx.clone().sub(Rx); X.sub(arriba.clone().multiplyScalar(X.dot(arriba))).normalize(); const Z = new THREE.Vector3().crossVectors(X, arriba).normalize(); return [X, Z]; };
  const [Xt, Zt] = ejes(Ls, Rs);
  const [Xp, Zp] = caderas ? ejes(Lh, Rh) : [Xt, Zt];
  // this person's size: shoulder width and torso length in meters, against the reference body
  const anchoH = Ls.distanceTo(Rs) * 1.18;
  const nM = ++medidas.n, aM = Math.max(.02, 1 / nM);  // running mean over the first frames, then a slow drift
  medidas.hombros += (anchoH - medidas.hombros) * aM;
  const sxT = Math.min(1.35, Math.max(.85, medidas.hombros / REF.anchoHombros)), syT = Math.min(1.35, Math.max(.75, medidas.torso / REF.largo));
  const sT = { x: sxT, y: syT, z: (sxT + syT) / 2 }, sP = { x: (sxT + syT) / 2, y: syT, z: (sxT + syT) / 2 };
  const Bt = hueso(S, Xt, arriba, Zt, sT, REF.hombros), Bp = hueso(Hh, Xp, arriba, Zp, sP, new THREE.Vector3(0, .895, -.01));
  let Bh = Bt.clone();
  if (o[7] && o[8] && o[7].v > .4 && o[8].v > .4) {
    const Le = J(7), Re = J(8), E = Le.clone().add(Re).multiplyScalar(.5);
    const Xh = Le.clone().sub(Re), up = E.clone().sub(S).normalize(); Xh.sub(up.clone().multiplyScalar(Xh.dot(up))).normalize();
    const Zh = new THREE.Vector3().crossVectors(Xh, up).normalize(), sh2 = Math.min(1.3, Math.max(.8, Le.distanceTo(Re) / REF.anchoOrejas));
    Bh = hueso(E, Xh, up, Zh, { x: sh2, y: sh2, z: sh2 }, REF.orejas);
  }
  // the limbs: one rigid bone per segment, only for joints really seen inside the picture
  if (ARTIC) for (const [g, [ia, ib, ja, jb, sgn]] of Object.entries(SEGMENTOS)) {
    const h = huesos.seg[g] ||= { M: new THREE.Matrix4(), vis: false };
    const ok = o[ia] && o[ib] && o[ia].v > .55 && o[ib].v > .55 && enCuadro(o[ia]) && enCuadro(o[ib]);
    if (!ok) { h.vis = false; h.listo = false; continue; }
    const m0 = j => new THREE.Vector3(ARTIC[j][0] * sgn, ARTIC[j][1], ARTIC[j][2]);
    const M = huesoSegmento(m0(ja), m0(jb), J(ia), J(ib), ia >= 23 ? Zp : Zt);
    if (!M) { h.vis = false; continue; }
    if (!h.listo) { h.M.copy(M); h.listo = true; } else suavizarMatriz(h.M, M, .35);
    h.vis = true;
  }
  // a light smoothing of the bones on top of the landmark filter
  if (!huesos.suave) { huesos.Bp.copy(Bp); huesos.Bt.copy(Bt); huesos.Bh.copy(Bh); huesos.suave = true; }
  else { suavizarMatriz(huesos.Bp, Bp, .35); suavizarMatriz(huesos.Bt, Bt, .35); suavizarMatriz(huesos.Bh, Bh, .3); }
  const piel = (v, B) => v.clone().applyMatrix4(B);
  const mezcla = v => { const w = Math.min(1, Math.max(0, (v.y - 1.0) / .25)), a = piel(v, huesos.Bp), c = piel(v, huesos.Bt); return a.lerp(c, w * w * (3 - 2 * w)); };
  const proyectar = p => { const Z = -p.z, u = f * p.x / Z + cx, v = -f * p.y / Z + cy; return { x: (u - sx) / sw * W, y: (v - sy) / sh * H }; };
  const M = v => proyectar(mezcla(v)), C = v => proyectar(piel(v, huesos.Bh));
  const pS = M(REF.hombros), pH = M(new THREE.Vector3(0, .895, 0));
  sonda = M(new THREE.Vector3(.02, 1.3, .05)); // a fixed point on the chest, to measure how steady the hologram is
  const ppm = f / -S.z * (W / sw);               // pixels per meter at the chest
  const ey = new THREE.Vector2(pS.x - pH.x, -(pS.y - pH.y)).divideScalar(REF.largo);
  medidas.dist += (-S.z - medidas.dist) * .1;
  // for drift, the body's position with the phone's own (calibrated) turn taken out: only the patient's motion counts
  const [gxA, gyA] = giro.hay ? giroEn(performance.now()) : [0, 0], fv = f * (W / sw);
  const centro = new THREE.Vector2(pS.x - W / 2 - calGiro.x * fv * gyA, H / 2 - pS.y + calGiro.y * fv * gxA);
  return { tresD: true, frente: Zt.z, M, C, escala: ppm * sxT, ey, mpp: 1 / ppm, det: 1, centro, f, Z: -S.z };
}

/* ── the scan sweep: when a body is found (or the crew member changes), the hologram is revealed top to bottom ── */
let tBarrido = -1;
function barrer(t) { tBarrido = t; }

/* ── microgravity: is the patient drifting? (body speed, in m/s from the shoulder width) ── */
const deriva = { v: 0, hist: [] };
function medirDeriva(aj, t) {
  if (!aj) { deriva.hist = []; deriva.v = 0; return; }
  // displacement over the last second, so compressions and breathing (back and forth) cancel out
  deriva.hist.push({ t, c: aj.centro.clone().multiplyScalar(aj.mpp) });
  while (deriva.hist.length && t - deriva.hist[0].t > 1.2) deriva.hist.shift();
  const a = deriva.hist[0], b = deriva.hist.at(-1);
  if (b.t - a.t > .8) {
    deriva.v += (b.c.distanceTo(a.c) / (b.t - a.t) - deriva.v) * .1;
    // the drift's direction in the picture (meters/s, y up), for the predicted path
    const vx = (b.c.x - a.c.x) / (b.t - a.t), vy = (b.c.y - a.c.y) / (b.t - a.t);
    deriva.vec = deriva.vec ? { x: deriva.vec.x + (vx - deriva.vec.x) * .1, y: deriva.vec.y + (vy - deriva.vec.y) * .1 } : { x: vx, y: vy };
  }
}

/* ── compressions from the rescuer's hands near the CPR point ── */
const comp = { suave: null, base: null, fase: 0, golpes: [], cuenta: 0, ultima: 0, t: 0, manos: false, buenas: 0, prof: null, inicio: 0, pausa: 0, tCiclo: 0 };
function contar(t, aj, W, H) {
  comp.manos = false;
  if (!aj || !manosUlt.length || performance.now() - tManos > 400) { comp.suave = comp.base = null; return; }
  const { sx, sy, sw, sh, vw, vh } = recorte;
  const pr = aPantalla(REF.rcp, aj.M, W, H), cerca = [];
  for (const m of manosUlt) {
    const c = [0, 5, 9, 17].map(i => m.lm[i]).reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
    const x = (c.x * vw - sx) / sw * W, y = (c.y * vh - sy) / sh * H;
    if (Math.hypot(x - pr.x, y - pr.y) < aj.escala * .25) cerca.push({ x, y });
  }
  if (!cerca.length) { comp.suave = comp.base = null; return; }
  comp.manos = true;
  // the hands' vertical motion in the picture, normalized by the body's size (tuned on a real CPR recording)
  const y = cerca.reduce((s, p) => s + p.y, 0) / cerca.length / aj.escala;
  const dt = comp.t ? Math.min(.2, t - comp.t) : 1 / 30; comp.t = t;
  const a = k => 1 - Math.exp(-dt / k);
  comp.suave = comp.suave == null ? y : comp.suave + (y - comp.suave) * a(.05);
  comp.base = comp.base == null ? y : comp.base + (comp.suave - comp.base) * a(.4);
  const d = comp.suave - comp.base, u = .004;
  // depth (estimated): how far the hands travel each stroke, in meters at the chest (only meaningful seen from the side)
  comp.ymax = Math.max(comp.ymax ?? y, comp.suave); comp.ymin = Math.min(comp.ymin ?? y, comp.suave);
  if (comp.fase <= 0 && d > u) comp.fase = 1;
  else if (comp.fase === 1 && d < -u * .2 && t - comp.ultima > .3) {
    const prof = (comp.ymax - comp.ymin) * aj.escala * aj.mpp * 100; // cm
    comp.prof = comp.prof == null ? prof : comp.prof + (prof - comp.prof) * .3;
    const iv = comp.ultima ? t - comp.ultima : null;
    comp.fase = -1; comp.cuenta++; comp.ultima = t; comp.golpes.push(t); comp.golpes = comp.golpes.filter(g => t - g < 6);
    // a compression is "good" when its rate is in 100-120/min (and its depth in 5-6 cm when depth can be seen)
    const lateral = (aj.frente ?? 1) < .6, rOk = iv && 60 / iv >= 100 && 60 / iv <= 120, pOk = !lateral || (prof >= 4.5 && prof <= 6.5);
    comp.buenas += rOk && pOk ? 1 : 0; comp.ymax = comp.ymin = null;
  }
}
function ritmo(t) {
  const g = comp.golpes.filter(x => t - x < 5);
  if (g.length < 4 || t - g.at(-1) > 1.6) return null;
  const iv = g.slice(1).map((x, i) => x - g[i]).sort((a, b) => a - b);
  return 60 / iv[Math.floor(iv.length / 2)];
}

/* ── CPR coaching by gravity ── */
const FUENTE_GUIA = 'DGLRM/ESAM guideline for CPR in microgravity (Hinkelbein et al., 2020; AWMF 2022)';
function guiaRcp(reg) {
  if (reg === 'tierra') return { titulo: 'CPR · 1 g', tec: 'Standard', pasos: ['Kneel beside, heel of hand on the lower half of the sternum', 'Arms straight, shoulders over hands: your weight does the work', '5–6 cm deep, 100–120 a minute, let the chest come back up'], fuente: 'ERC/AHA basic life support' };
  if (reg === 'marte') return { titulo: 'CPR · Mars 0.38 g', tec: 'Straddle, more push', pasos: ['You weigh 38% here: your weight alone will not reach 5 cm', 'Straddle them, heels under their legs; push with arms and shoulders', 'Depth drops with fatigue: swap rescuers often'], fuente: 'Simulated hypogravity: Sriharan 2021; review Overbeek et al., Life 2022' };
  const T = {
    er: { tec: 'Evetts-Russomano', pasos: ['At the site, no straps needed: start now', 'Left leg over their right shoulder, right leg around the torso', 'Lock your ankles behind their back, then compress'], rec: 'rec. 2' },
    rbh: { tec: 'Reverse bear hug', pasos: ['If Evetts-Russomano is not working', 'From behind: wrap your arms around the chest', 'Pull your fists into the lower sternum, 100–120 a minute'], rec: 'rec. 2' },
    hs: { tec: 'Handstand', pasos: ['Patient strapped on the Crew Medical Restraint System', 'Feet on the opposite wall, arms straight, hands on the sternum', 'Push with your legs: the strongest compressions in microgravity'], rec: 'rec. 3' },
    sujeto: { tec: 'Restrained', pasos: ['Patient and you strapped to the restraint system', 'Waist strap and leg strap; kneel beside or straddle', 'Standard compressions; a compression device could take over'], rec: 'rec. 4–5' },
  }[tecnica];
  return { titulo: 'CPR · microgravity', tec: T.tec, pasos: T.pasos, fuente: `${FUENTE_GUIA}, ${T.rec}` };
}

/* ── output ── */
const pantalla = $('pantalla'), pctx = pantalla.getContext('2d');
const mono = document.createElement('canvas'), mctx = mono.getContext('2d');
const brillo = document.createElement('canvas'), bctx = brillo.getContext('2d');
const tinte = document.createElement('canvas'), tctx = tinte.getContext('2d', { willReadFrequently: true });
let foco = null, fps = 0, tAnt = 0, hayAntes = false;
let recorte = { sx: 0, sy: 0, sw: 1280, sh: 720, vw: 1280, vh: 720 }, kCss = 1, fCss = 1;
function areaVista() {
  if (!visor) return { tw: innerWidth, th: innerHeight };
  const m = Math.min(innerWidth / 2, innerHeight) * .04;
  return { tw: innerWidth / 2 - 2 * m, th: innerHeight - 2 * m };
}
function tamanos() {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720, { tw, th } = areaVista(), asp = tw / th;
  let sw = vw, sh = vh; if (vw / vh > asp) sw = vh * asp; else sh = vw / asp;
  const f = Math.min(1, 1280 / Math.max(sw, sh)), W = Math.round(sw * f), H = Math.round(sh * f);
  recorte = { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh, vw, vh };
  fCss = W / tw; kCss = visor ? fCss * .78 : Math.max(fCss, W / 1000);
  if (mono.width !== W || mono.height !== H) {
    mono.width = W; mono.height = H;
    ren.setSize(W, H, false);
    cam.left = -W / 2; cam.right = W / 2; cam.top = H / 2; cam.bottom = -H / 2; cam.updateProjectionMatrix();
    brillo.width = Math.round(W / 4); brillo.height = Math.round(H / 4);
  }
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (pantalla.width !== w || pantalla.height !== h) { pantalla.width = w; pantalla.height = h; }
  return { W, H };
}

/* the body mask: darker room, a cool tint inside the body and a glowing outline (built once per new mask) */
let mascaraHecha = null;
function pintarMascara(W, H) {
  const m = mascaraUlt; if (!m || !m.img) return;
  const iw = m.img.naturalWidth || m.img.width, ih = m.img.naturalHeight || m.img.height; if (!iw) return;
  if (mascaraHecha !== m) {
    if (tinte.width !== iw || tinte.height !== ih) { tinte.width = iw; tinte.height = ih; }
    tctx.clearRect(0, 0, iw, ih); tctx.drawImage(m.img, 0, 0);
    const d = tctx.getImageData(0, 0, iw, ih), px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i] / 255, borde = a > .25 && a < .75 ? 1 - Math.abs(a - .5) * 4 : 0;
      px[i] = 70 * a + 143 * borde; px[i + 1] = 200 * a + 230 * borde; px[i + 2] = 232 * a + 245 * borde;
      px[i + 3] = 255 * Math.min(1, (1 - a) * .34 + a * .07 + borde * .38);
    }
    tctx.putImageData(d, 0, 0); mascaraHecha = m;
  }
  const { sx, sy, sw, sh, vw, vh } = recorte, kx = iw / vw, ky = ih / vh;
  mctx.save(); mctx.imageSmoothingQuality = 'high';
  mctx.drawImage(tinte, sx * kx, sy * ky, sw * kx, sh * ky, 0, 0, W, H);
  mctx.restore();
}

// every capsule drawn this frame takes its place; the ones that may move step down until they touch nothing
let ocupados = [];
const choca = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function reservar(x, y, w, h) { ocupados.push({ x, y, w, h }); }
function pastilla(c, x, y, txt, { col = '#f2f5f8', fondo = 'rgba(5,8,12,.74)', borde = 'rgba(255,255,255,.16)', f = 15, k = 1, punto = null, alin = 'left', previo = '', evitar = false } = {}) {
  const pad = 13 * k, gap = punto ? 18 * k : 0;
  c.font = `500 ${f * k}px SG`; const wP = previo ? c.measureText(previo + '  ').width : 0;
  c.font = `600 ${f * k}px SG`; const wT = c.measureText(txt).width;
  const w = pad * 2 + gap + wP + wT, h = (f + 16) * k;
  let x0 = alin === 'right' ? x - w : alin === 'center' ? x - w / 2 : x;
  if (c.canvas.width) x0 = Math.max(8 * k, Math.min(c.canvas.width - w - 8 * k, x0)); // always inside the frame
  if (evitar) for (let i = 0; i < 12 && ocupados.some(o => choca({ x: x0, y: y - h / 2, w, h }, o)); i++) y += h + 6 * k;
  reservar(x0, y - h / 2, w, h);
  c.fillStyle = fondo; c.strokeStyle = borde; c.lineWidth = 1.2 * k;
  c.beginPath(); c.roundRect(x0, y - h / 2, w, h, h / 2); c.fill(); c.stroke();
  if (punto) { c.fillStyle = punto; c.beginPath(); c.arc(x0 + pad + 3 * k, y, 3.8 * k, 0, 7); c.fill(); }
  c.textBaseline = 'middle';
  if (previo) { c.font = `500 ${f * k}px SG`; c.fillStyle = '#9aa4b2'; c.fillText(previo, x0 + pad + gap, y + .5 * k); }
  c.font = `600 ${f * k}px SG`; c.fillStyle = col; c.fillText(txt, x0 + pad + gap + wP, y + .5 * k);
  return w;
}
function medir(c, txt, previo, f, k, punto) {
  c.font = `500 ${f * k}px SG`; const wP = previo ? c.measureText(previo + '  ').width : 0;
  c.font = `600 ${f * k}px SG`; return 26 * k + (punto ? 18 * k : 0) + wP + c.measureText(txt).width;
}

function etiquetas(c, aj, W, H, k, L) {
  const datos = tr(), dentro = [];
  for (const g of ETIQUETAS) {
    if (!grupos[g] || !grupos[g].visible || !centros[g]) continue;
    const p = aPantalla(centros[g], g === 'cerebro' ? aj.C : aj.M, W, H);
    if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
    dentro.push({ g, p, d: GRUPOS[g].dato(datos) });
  }
  const mitad = aPantalla(REF.hombros, aj.M, W, H).x, ancho = aj.escala * REF.anchoHombros;
  const conEtiqueta = visor || capas.has('rcp') ? [] : dentro;
  const lados = { izq: conEtiqueta.filter(e => e.p.x < mitad).sort((a, b) => a.p.y - b.p.y), der: conEtiqueta.filter(e => e.p.x >= mitad).sort((a, b) => a.p.y - b.p.y) };
  for (const [lado, l] of Object.entries(lados)) {
    let yMin = -1e9;
    for (const e of l) {
      const w = medir(c, e.d.v, GRUPOS[e.g].n, 15, k, true);
      const xl = lado === 'izq' ? Math.max(14 * k + w, mitad - ancho * 1.1 - 60 * k) : Math.min(W - 14 * k - w, mitad + ancho * 1.1 + 60 * k);
      let y = Math.min(H - 120 * k, Math.max(110 * k, e.p.y, yMin + 40 * k));
      const ladoNova = L && ((L.lado > 0) === (lado === 'der'));
      if (ladoNova && y > L.arriba - 20 * k && y < L.abajo + 20 * k) y = L.abajo + 24 * k;
      yMin = y;
      const col = NIVEL_COL[e.d.nivel] || GRUPOS[e.g].col;
      c.strokeStyle = col; c.globalAlpha = .75; c.lineWidth = 1.5 * k;
      c.beginPath(); c.moveTo(e.p.x, e.p.y); c.lineTo(xl + (lado === 'izq' ? 8 * k : -8 * k), y); c.stroke(); c.globalAlpha = 1;
      c.fillStyle = col; c.beginPath(); c.arc(e.p.x, e.p.y, 4 * k, 0, 7); c.fill();
      pastilla(c, xl, y, e.d.v, { k, f: 15, punto: col, alin: lado === 'izq' ? 'right' : 'left', previo: GRUPOS[e.g].n, borde: NIVEL_COL[e.d.nivel] ? col : 'rgba(255,255,255,.16)' });
    }
  }
  let mejor = null, dmin = Math.min(W, H) * .2;
  for (const e of dentro) { const d = Math.hypot(e.p.x - W / 2, e.p.y - H / 2); if (d < dmin) { dmin = d; mejor = e; } }
  foco = mejor ? mejor.g : null;
}

function flecha(c, a, b, col, k, ancho = 4) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x), L = 14 * k;
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = ancho * k; c.lineCap = 'round';
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x - Math.cos(ang) * L * .6, b.y - Math.sin(ang) * L * .6); c.stroke();
  c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(b.x - Math.cos(ang - .45) * L, b.y - Math.sin(ang - .45) * L); c.lineTo(b.x - Math.cos(ang + .45) * L, b.y - Math.sin(ang + .45) * L); c.closePath(); c.fill();
}

/* CPR overlay: the point, the beat, and in microgravity the forces and where to anchor */
function capaRcp(c, aj, W, H, k, t, reg) {
  const p = aPantalla(REF.rcp, aj.M, W, H), r = aj.escala * .045, golpe = (t * 110 / 60) % 1;
  c.strokeStyle = '#ec6aa8'; c.lineWidth = 4 * k;
  c.fillStyle = 'rgba(236,106,168,.18)'; c.beginPath(); c.arc(p.x, p.y, r, 0, 7); c.fill(); c.stroke();
  c.globalAlpha = .8 * (1 - golpe); c.lineWidth = 2.5 * k; c.beginPath(); c.arc(p.x, p.y, r * (1 + golpe * 1.4), 0, 7); c.stroke(); c.globalAlpha = 1;
  c.fillStyle = '#ec6aa8'; c.beginPath(); c.arc(p.x, p.y, 6 * k, 0, 7); c.fill();
  // the chest's front direction in the picture (seen head-on it has no length: then draw it across the body)
  const fr = aPantalla(REF.rcp.clone().add(new THREE.Vector3(0, 0, .25)), aj.M, W, H);
  let dir = { x: fr.x - p.x, y: fr.y - p.y }, n = Math.hypot(dir.x, dir.y);
  if (n < aj.escala * .04) { const e = aj.ey.clone().normalize(); dir = { x: e.y, y: e.x }; n = 1; }
  dir = { x: dir.x / n, y: dir.y / n };
  const L = aj.escala * .22;
  if (reg === 'micro') {
    // the push into the chest, and the same force pushing the rescuer away (Newton's third law): hence the anchor
    flecha(c, { x: p.x + dir.x * L * 1.1, y: p.y + dir.y * L * 1.1 }, { x: p.x + dir.x * r * 1.2, y: p.y + dir.y * r * 1.2 }, '#ec6aa8', k);
    flecha(c, { x: p.x + dir.x * L * 1.25, y: p.y + dir.y * L * 1.25 }, { x: p.x + dir.x * L * 1.9, y: p.y + dir.y * L * 1.9 }, '#f2b457', k, 3);
    const lx = Math.max(16 * k, Math.min(W - 16 * k, p.x + dir.x * L * 2)), ly = Math.max(185 * k, Math.min(H - 150 * k, p.y + dir.y * L * 2));
    pastilla(c, lx + (dir.x < 0 ? -10 : 10) * k, ly, 'Reaction pushes you away', { evitar: true, k, f: 13, col: '#ffe8c7', borde: 'rgba(242,180,87,.6)', alin: lx > W * .6 ? 'right' : 'left' });
    const anclas = tecnica === 'er' ? [[REF.hombroD, 'Left leg over this shoulder'], [REF.espalda, 'Ankles locked behind the back']]
      : tecnica === 'rbh' ? [[REF.espalda, 'From behind: arms around the chest']] : tecnica === 'sujeto' ? [[REF.cadera, 'Waist and leg straps']] : [];
    for (const [v, txt] of anclas) {
      const a = aPantalla(v, aj.M, W, H);
      c.strokeStyle = '#6fd6b0'; c.lineWidth = 2.5 * k; c.setLineDash([6 * k, 5 * k]); c.beginPath(); c.arc(a.x, a.y, 16 * k, 0, 7); c.stroke(); c.setLineDash([]);
      const izq = a.x > W * .62, ya = Math.max(185 * k, Math.min(H - 170 * k, a.y));
      pastilla(c, a.x + (izq ? -22 : 22) * k, ya, txt, { evitar: true, k, f: 13, punto: '#6fd6b0', col: '#d8fbef', borde: 'rgba(111,214,176,.5)', alin: izq ? 'right' : 'left' });
    }
    if (tecnica === 'hs') {
      const pared = { x: p.x + dir.x * L * 3.2, y: p.y + dir.y * L * 3.2 };
      c.strokeStyle = '#6fd6b0'; c.setLineDash([8 * k, 6 * k]); c.lineWidth = 2 * k; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(pared.x, pared.y); c.stroke(); c.setLineDash([]);
      pastilla(c, pared.x, pared.y + 24 * k, 'Feet on the opposite wall', { evitar: true, k, f: 13, alin: 'center', punto: '#6fd6b0', col: '#d8fbef', borde: 'rgba(111,214,176,.5)' });
    }
  } else {
    // with gravity, your weight pushes down: "down" comes from the phone's sensor when there is one
    const g = grav.dir || { x: -dir.x, y: -dir.y };
    flecha(c, { x: p.x - g.x * L * 1.4, y: p.y - g.y * L * 1.4 }, { x: p.x - g.x * r * 1.3, y: p.y - g.y * r * 1.3 }, '#ec6aa8', k);
  }
  // the live numbers sit on the side of the point away from the body's center, inside the frame
  const rt = ritmo(t), est = estadoRcp(t);
  const cen = aPantalla(REF.cadera, aj.M, W, H), ax = p.x - cen.x, ay = p.y - cen.y, an = Math.hypot(ax, ay) || 1;
  const ex2 = Math.max(150 * k, Math.min(W - 150 * k, p.x + ax / an * (r + 60 * k))), ey2 = Math.max(185 * k, Math.min(H - 150 * k, p.y + ay / an * (r + 60 * k)));
  pastilla(c, ex2, ey2, est, { evitar: true, k, f: 15, alin: 'center', borde: rt && (rt < 100 || rt > 120) ? 'rgba(242,180,87,.7)' : 'rgba(236,106,168,.6)', col: '#ffe0ee' });
}

/* where the patient will be: in free fall a drifting body keeps its velocity (Newton's first law), so the path is a
   straight line until something stops it. Drawn as ghost positions at 1, 2 and 5 s. Physics, not a learned model. */
function trayectoria(c, aj, W, H, k) {
  if (!deriva.vec || deriva.v < .05) return;
  const p0 = aPantalla(new THREE.Vector3(0, 1.15, .05), aj.M, W, H), ppm = 1 / aj.mpp;
  const puntos = [1, 2, 5].map(s => ({ s, x: p0.x + deriva.vec.x * s * ppm * (frente ? -1 : 1), y: p0.y - deriva.vec.y * s * ppm }));
  c.setLineDash([3 * k, 6 * k]); linea(c, [p0, ...puntos], 'rgba(244,184,96,.85)', 1.6 * k); c.setLineDash([]);
  for (const q of puntos) {
    c.strokeStyle = 'rgba(244,184,96,.9)'; c.lineWidth = 1.4 * k; c.beginPath(); c.arc(q.x, q.y, 6 * k, 0, 7); c.stroke();
    textoLibre(c, q.x + 10 * k, q.y - 6 * k, `${q.s} s · ${Math.round(deriva.v * q.s * 100)} cm`, { f: 11.5 * k, col: AMBAR }, k);
  }
}
function estadoRcp(t) {
  const rt = ritmo(t);
  return rt ? `${Math.round(rt)}/min · ${comp.cuenta} compressions` : comp.manos ? 'Hands on the point · start' : 'Push here · 5–6 cm · 100–120/min';
}

/* the rescuer's hands stay in front of the hologram (occlusion), with a faint outline */
function ocluirManos(c, W, H, k) {
  if (!manosUlt.length || performance.now() - tManos > 400) return;
  const { sx, sy, sw, sh, vw, vh } = recorte;
  const ORDEN = [0, 1, 2, 3, 4, 8, 12, 16, 20, 19, 18, 17, 0];
  for (const m of manosUlt) {
    const pts = m.lm.map(p => ({ x: (p.x * vw - sx) / sw * W, y: (p.y * vh - sy) / sh * H }));
    const cx = pts.reduce((s, p) => s + p.x, 0) / 21, cy = pts.reduce((s, p) => s + p.y, 0) / 21;
    const contorno = ORDEN.map(i => ({ x: cx + (pts[i].x - cx) * 1.28, y: cy + (pts[i].y - cy) * 1.28 }));
    c.save();
    if (frente) { c.translate(W, 0); c.scale(-1, 1); }
    c.beginPath(); contorno.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath();
    c.save(); c.clip(); c.drawImage(video, sx, sy, sw, sh, 0, 0, W, H); c.restore();
    c.restore();
  }
}

/* Nova, as a hologram beside the patient: projector disc, light cone, scanlines; a beam to what she is talking about */
const novaLienzo = document.createElement('canvas'); novaLienzo.width = novaLienzo.height = 240;
const nctx = novaLienzo.getContext('2d');
let novaImg = null, tNova = 0, novaHabla = 0, novaTexto = '', tTexto = 0;
function refrescarNova(t) {
  if (typeof mascotaOrbes !== 'function' || t - tNova < 1 / 15) return;
  tNova = t;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width="240" height="200">${mascotaOrbes({ x: 60, y: 50, R: 26, t, expr: novaHabla > .05 ? 'feliz' : 'pensativa', orbes: 4, habla: novaHabla, parpadeo: (t % 3.7) < .13 ? 1 : 0, mira: [-.3, .1] })}</svg>`;
  const img = new Image(); img.onload = () => { novaImg = img; }; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function decir(texto) {
  novaTexto = texto; tTexto = performance.now();
  if (typeof hablar === 'function' && !P.has('mudo')) hablar(texto, { idioma: 'en' });
}
// where Nova floats: beside the head, on the side with more room (labels on that side move below her)
function lugarNova(aj, W, H, k) {
  const hombros = aPantalla(REF.hombros, aj.M, W, H), cab = aPantalla(REF.orejas, aj.C, W, H), ancho = aj.escala * REF.anchoHombros;
  const lado = hombros.x > W / 2 ? -1 : 1;
  const tam = Math.max(90 * k, Math.min(ancho * .8, 150 * k));
  const x = Math.max(tam * .6, Math.min(W - tam * .6, hombros.x + lado * (ancho * .95 + tam * .6)));
  const y = Math.max(tam * .6 + 120 * k, Math.min(H * .5, cab.y));
  return { x, y, tam, lado, arriba: y - tam * .6, abajo: y + tam * .75 };
}
function pintarNova(c, aj, W, H, k, t, objetivo, L) {
  if (!novaImg) return;
  const { x, tam } = L, y = L.y + Math.sin(t * 1.6) * 5 * k;
  const base = y + tam * .62;
  const cono = c.createLinearGradient(0, base, 0, y - tam * .3);
  cono.addColorStop(0, 'rgba(70,200,232,.28)'); cono.addColorStop(1, 'rgba(70,200,232,0)');
  c.fillStyle = cono; c.beginPath(); c.moveTo(x - tam * .18, base); c.lineTo(x - tam * .55, y - tam * .3); c.lineTo(x + tam * .55, y - tam * .3); c.lineTo(x + tam * .18, base); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(143,230,245,.8)'; c.lineWidth = 2 * k; c.beginPath(); c.ellipse(x, base, tam * .26, tam * .06, 0, 0, 7); c.stroke();
  nctx.clearRect(0, 0, 240, 240); nctx.drawImage(novaImg, 0, 20, 240, 200);
  nctx.globalCompositeOperation = 'destination-out'; nctx.fillStyle = 'rgba(0,0,0,.22)';
  for (let yy = (t * 40) % 4; yy < 240; yy += 4) nctx.fillRect(0, yy, 240, 1.4);
  nctx.globalCompositeOperation = 'source-over';
  c.save(); c.globalAlpha = .9 + .06 * Math.sin(t * 23) * Math.sin(t * 7); c.globalCompositeOperation = 'lighter';
  c.drawImage(novaLienzo, x - tam / 2, y - tam / 2, tam, tam); c.restore();
  if (objetivo) {
    const g = c.createLinearGradient(x, y, objetivo.x, objetivo.y);
    g.addColorStop(0, 'rgba(143,230,245,0)'); g.addColorStop(.25, 'rgba(143,230,245,.55)'); g.addColorStop(1, 'rgba(236,106,168,.75)');
    c.strokeStyle = g; c.lineWidth = 2 * k; c.setLineDash([2 * k, 6 * k]); c.lineDashOffset = -t * 30;
    c.beginPath(); c.moveTo(x, y); c.lineTo(objetivo.x, objetivo.y); c.stroke(); c.setLineDash([]);
  }
  if (novaTexto && performance.now() - tTexto < 9000 && !visor && W / k >= 700) {
    c.font = `500 ${14 * k}px SG`;
    const lineas = []; let l = '';
    for (const w of novaTexto.split(' ')) { const p = l ? l + ' ' + w : w; if (c.measureText(p).width > 230 * k && l) { lineas.push(l); l = w; } else l = p; }
    if (l) lineas.push(l);
    const bw = Math.max(...lineas.map(s => c.measureText(s).width)) + 28 * k, bh = lineas.length * 20 * k + 18 * k;
    const bx = Math.max(8 * k, Math.min(W - bw - 8 * k, x - bw / 2)), by = Math.max(90 * k, y - tam * .55 - bh);
    c.fillStyle = 'rgba(5,8,12,.8)'; c.strokeStyle = 'rgba(143,230,245,.45)'; c.lineWidth = 1.2 * k;
    c.beginPath(); c.roundRect(bx, by, bw, bh, 14 * k); c.fill(); c.stroke();
    c.fillStyle = '#e6f6fb'; c.textBaseline = 'top'; lineas.forEach((s, i) => c.fillText(s, bx + 14 * k, by + 9 * k + i * 20 * k));
  }
}

function hud(c, W, H, k, t, hayCuerpo, reg, gA) {
  const cm = CREW[tripI] || {}, d = tr(), barra = $('barra');
  const yPie = H - ((!visor && !barra.hidden ? barra.getBoundingClientRect().height + 14 : 0) + 34) * fCss;
  pastilla(c, 16 * k, 28 * k, 'NOVA · BODY SCAN', { k, f: 13, col: '#8fe6f5' });
  const vivo = Date.now() - ultimoEnvioOk < 2000;
  pastilla(c, W - 16 * k, 28 * k, vivo ? 'LIVE ON STATION' : 'NOT SENDING', { k, f: 13, alin: 'right', punto: vivo ? '#ec6aa8' : '#5b6573', col: vivo ? '#f2f5f8' : '#9aa4b2' });
  const mac = fuenteObs === 'mac' && performance.now() - vis.tUlt < 800;
  const txtVis = mac ? `Ship vision · ${Math.round(vis.rtt)} ms` : localListo ? 'Phone vision' : 'Vision starting';
  const med = grav.med != null ? `phone ${grav.med.toFixed(2)} g` : 'no g sensor';
  const gtxt = reg === 'micro' ? '0 g' : `${gA.g.toFixed(2)} g`;
  const angosto = W / k < 620;
  if (!visor && !angosto) {
    pastilla(c, 16 * k, 66 * k, `${cm.nombre || ''} · ${cm.rol || ''}`, { k, f: 15, punto: NIVEL_COL[d?.nivel] || '#6fd6b0' });
    pastilla(c, W - 16 * k, 66 * k, `${txtVis} · ${Math.round(fps)} fps`, { k, f: 13, alin: 'right', punto: mac ? '#6fd6b0' : '#f2b457', col: '#c8d2dc' });
    pastilla(c, W - 16 * k, 104 * k, `${gtxt} · ${med}`, { k, f: 13, alin: 'right', previo: gA.de, punto: reg === 'micro' ? '#a898ff' : reg === 'marte' ? '#f2b457' : '#6fd6b0' });
  } else {
    pastilla(c, 16 * k, 66 * k, cm.corto || '', { k, f: 14, punto: NIVEL_COL[d?.nivel] || '#6fd6b0' });
    pastilla(c, W - 16 * k, 66 * k, mac ? `Ship ${Math.round(vis.rtt)} ms` : localListo ? 'Phone vision' : '…', { k, f: 13, alin: 'right', punto: mac ? '#6fd6b0' : '#f2b457', col: '#c8d2dc' });
    pastilla(c, W - 16 * k, 104 * k, gtxt, { k, f: 13, alin: 'right', previo: reg === 'micro' ? 'Micro-g' : reg === 'marte' ? 'Mars' : 'Earth', punto: reg === 'micro' ? '#a898ff' : reg === 'marte' ? '#f2b457' : '#6fd6b0' });
  }
  if (reg === 'micro' && deriva.v > .08 && hayCuerpo) pastilla(c, W / 2, 142 * k, `Patient drifting ${Math.round(deriva.v * 100)} cm/s · hold or strap them`, { k, f: 15, alin: 'center', punto: '#f2b457', col: '#ffe8c7', borde: 'rgba(242,180,87,.6)' });

  if (capas.has('rcp') && hayCuerpo && !visor) {
    const gr = guiaRcp(reg), x0 = 16 * k, w = Math.min(W - 32 * k, 400 * k), filas = gr.pasos.length, h = (70 + filas * 22 + 22) * k, y0 = yPie - 30 * k - h;
    c.fillStyle = 'rgba(5,8,12,.82)'; c.strokeStyle = 'rgba(236,106,168,.45)'; c.lineWidth = 1.2 * k;
    c.beginPath(); c.roundRect(x0, y0, w, h, 18 * k); c.fill(); c.stroke();
    c.textBaseline = 'top';
    c.font = `500 ${12 * k}px SG`; c.fillStyle = '#ec6aa8'; c.fillText(gr.titulo.toUpperCase(), x0 + 16 * k, y0 + 14 * k);
    c.font = `600 ${19 * k}px SG`; c.fillStyle = '#f2f5f8'; c.fillText(gr.tec, x0 + 16 * k, y0 + 32 * k);
    c.font = `400 ${13.5 * k}px SG`; c.fillStyle = '#c8d2dc';
    gr.pasos.forEach((s, i) => c.fillText(`${i + 1}  ${s}`, x0 + 16 * k, y0 + (62 + i * 22) * k, w - 32 * k));
    c.font = `400 ${11 * k}px SG`; c.fillStyle = '#6b7583'; c.fillText(gr.fuente, x0 + 16 * k, y0 + h - 22 * k, w - 32 * k);
  }
  if (!hayCuerpo) pastilla(c, W / 2, yPie, 'Show Nova the whole torso, shoulders to hips', { k, f: 18, alin: 'center', col: '#ffe8c7', borde: 'rgba(242,180,87,.5)' });
  else if (foco && !capas.has('rcp')) {
    const e = GRUPOS[foco].dato(d), col = NIVEL_COL[e.nivel] || GRUPOS[foco].col;
    let txt = `${e.v}${e.s ? ' · ' + e.s : ''}`; if (medir(c, txt, GRUPOS[foco].n, 18, k, true) > W * .94) txt = e.v;
    pastilla(c, W / 2, yPie, txt, { k, f: 18, alin: 'center', punto: col, borde: col, previo: GRUPOS[foco].n });
  } else if (!capas.has('rcp')) pastilla(c, W / 2, yPie, 'Estimated positions · reference anatomy fitted to this body', { k, f: 13, alin: 'center', col: '#9aa4b2' });
  c.strokeStyle = 'rgba(242,245,248,.55)'; c.lineWidth = 1.5 * k;
  const r = 10 * k; c.beginPath(); c.moveTo(W / 2 - r, H / 2); c.lineTo(W / 2 - r / 2.5, H / 2); c.moveTo(W / 2 + r / 2.5, H / 2); c.lineTo(W / 2 + r, H / 2);
  c.moveTo(W / 2, H / 2 - r); c.lineTo(W / 2, H / 2 - r / 2.5); c.moveTo(W / 2, H / 2 + r / 2.5); c.lineTo(W / 2, H / 2 + r); c.stroke();
}

/* ── the holographic readout of one body system: rings around its organ, a panel with live values, the last 10
   minutes and Nova's forecast, each value marked as measured or estimated ── */
function anillos(c, p, r, col, k, t) {
  c.save(); c.translate(p.x, p.y);
  c.strokeStyle = col; c.globalAlpha = .9; c.lineWidth = 1.4 * k; c.setLineDash([r * .5, r * .18]); c.lineDashOffset = -t * 18;
  c.beginPath(); c.ellipse(0, 0, r, r * .34, 0, 0, 7); c.stroke();
  c.globalAlpha = .5; c.setLineDash([2 * k, 7 * k]); c.lineDashOffset = t * 26;
  c.beginPath(); c.ellipse(0, 0, r * 1.25, r * .44, 0, 0, 7); c.stroke(); c.setLineDash([]);
  c.globalAlpha = .9; for (let i = 0; i < 4; i++) { const a = t * .6 + i * Math.PI / 2; c.beginPath(); c.arc(Math.cos(a) * r, Math.sin(a) * r * .34, 2 * k, 0, 7); c.fillStyle = col; c.fill(); }
  c.restore();
}
function linea2(c, x0, y0, w, h, v, col, k) { // sparkline with a soft glow
  const vs = v.filter(Number.isFinite); if (vs.length < 2) return;
  const mn = Math.min(...vs), mx = Math.max(...vs), rg = mx - mn || 1;
  c.save(); c.strokeStyle = col; c.lineWidth = 1.6 * k; c.shadowColor = col; c.shadowBlur = 6 * k; c.beginPath();
  v.forEach((y, i) => { if (!Number.isFinite(y)) return; const x = x0 + i / (v.length - 1) * w, yy = y0 + h - (y - mn) / rg * h; i ? c.lineTo(x, yy) : c.moveTo(x, yy); });
  c.stroke(); c.restore();
}
let panelAbajo = false;
function panelSistema(c, aj, W, H, k, t) {
  const S = SISTEMAS[sistema], d = tr(), cm = CREW[tripI] || {};
  const ancla = centros[S.ancla]; if (!ancla) return;
  const p = aPantalla(ancla, S.ancla === 'cerebro' ? aj.C : aj.M, W, H);
  anillos(c, p, Math.max(26 * k, aj.escala * (sistema === 'oseo' ? .2 : sistema === 'metab' ? .13 : .085)), S.col, k, t);
  // the panel sits beside the body, on the side with more room
  const angosto = W / k < 620, barra = $('barra');
  const der = p.x < W * .55, ph = (S.vit ? 70 + S.vit.length * 64 : 120) * k;
  let pw = Math.min(270 * k, W * .42), px, py;
  if (angosto) { // a narrow screen: the panel sits along the bottom, full width, where the vitals strip was
    pw = W - 32 * k; px = 16 * k;
    py = H - ((!visor && !barra.hidden ? barra.getBoundingClientRect().height + 14 : 0) + 16) * fCss - ph;
  } else { px = der ? Math.min(W - pw - 18 * k, p.x + aj.escala * .32) : Math.max(18 * k, p.x - aj.escala * .32 - pw); py = Math.max(150 * k, Math.min(H - ph - 120 * k, p.y - ph * .4)); }
  panelAbajo = angosto;
  const codo = angosto ? { x: Math.max(px + 30 * k, Math.min(px + pw - 30 * k, p.x)), y: py } : { x: der ? px : px + pw, y: py + 26 * k };
  linea(c, [{ x: p.x, y: p.y }, { x: (p.x + codo.x) / 2, y: codo.y }, codo], S.col, 1.2 * k);
  c.fillStyle = S.col; c.beginPath(); c.arc(p.x, p.y, 3 * k, 0, 7); c.fill();
  // panel: translucent, thin edge, corner accents
  c.save(); c.fillStyle = 'rgba(4,14,22,.62)'; c.strokeStyle = 'rgba(143,230,245,.28)'; c.lineWidth = 1 * k;
  c.beginPath(); c.roundRect(px, py, pw, ph, 10 * k); c.fill(); c.stroke();
  c.strokeStyle = S.col; c.lineWidth = 2 * k; const L = 14 * k;
  [[px, py, 1, 1], [px + pw, py, -1, 1], [px, py + ph, 1, -1], [px + pw, py + ph, -1, -1]].forEach(([x, y, sx2, sy2]) => { c.beginPath(); c.moveTo(x, y + sy2 * L); c.lineTo(x, y); c.lineTo(x + sx2 * L, y); c.stroke(); });
  c.restore();
  texto(c, px + 16 * k, py + 26 * k, S.n.toUpperCase(), { f: 11 * k, w: 600, col: S.col, esp: 2 * k });
  texto(c, px + pw - 16 * k, py + 26 * k, cm.corto || '', { f: 11 * k, col: TENUE, alin: 'right' });
  if (S.vit) S.vit.forEach(([kk, n, u, dec], i) => {
    const y = py + (52 + i * 64) * k, val = d?.[kk], nivel = d?.niveles?.[kk], col = NIVEL_COL[nivel] || BLANCO, vivo = d?.edades?.[kk] > 0 && d.edades[kk] <= 30;
    texto(c, px + 16 * k, y + 4 * k, n, { f: 11.5 * k, col: TENUE });
    texto(c, px + 16 * k, y + 32 * k, `${f1(val, dec)}`, { f: 26 * k, w: 500, col });
    c.font = `500 ${26 * k}px SG`; const wv = c.measureText(`${f1(val, dec)}`).width;
    texto(c, px + 20 * k + wv, y + 32 * k, u, { f: 12 * k, col: TENUE });
    const auto = kk === 'animo' || kk === 'sueno_h';
    texto(c, px + pw - 16 * k, y + 4 * k, auto ? 'SELF-REPORTED' : vivo ? 'MEASURED · LIVE' : 'MEASURED', { f: 9.5 * k, w: 600, col: auto ? '#c3b8ff' : vivo ? '#7fe0c0' : TENUE, alin: 'right', esp: 1.2 * k });
    const h = histSis[(cm.id || '') + kk]; if (h && h.v && h.v.length > 3) linea2(c, px + pw * .45, y + 12 * k, pw * .55 - 16 * k, 24 * k, h.v, S.col, k);
  });
  else { const [n, v, nota] = S.est;
    texto(c, px + 16 * k, py + 56 * k, n, { f: 11.5 * k, col: TENUE });
    texto(c, px + 16 * k, py + 88 * k, v, { f: 26 * k, w: 500 });
    texto(c, px + pw - 16 * k, py + 56 * k, 'ESTIMATED', { f: 9.5 * k, w: 600, col: '#c3b8ff', alin: 'right', esp: 1.2 * k });
    texto(c, px + 16 * k, py + 108 * k, nota, { f: 10.5 * k, col: TENUE });
  }
  foco = S.ancla === 'esqueleto' ? null : S.ancla;
}

/* ── the window into the body: torso outline from the fitted skeleton, feathered, cut by the real silhouette ── */
const capaVen = document.createElement('canvas'), vctx = capaVen.getContext('2d');
const capaVenChica = document.createElement('canvas'), vcctx = capaVenChica.getContext('2d');
const capaCav = document.createElement('canvas'), cvctx = capaCav.getContext('2d');
const capaOrg = document.createElement('canvas'), octx = capaOrg.getContext('2d');
const alfaMasc = document.createElement('canvas'), amctx = alfaMasc.getContext('2d', { willReadFrequently: true });
const alfaTmp = document.createElement('canvas'), alfaSuave = document.createElement('canvas');
let mascaraAlfa = null;
function tamCapa(cv, W, H) { if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; } }
function ventana(aj, W, H, k) {
  if (P.has('sinventana')) return null;
  tamCapa(capaVen, W, H);
  vctx.clearRect(0, 0, W, H);
  // the torso's outline on the model (front surface), projected through the fit
  const borde = [[-.19, 1.45], [-.235, 1.36], [-.225, 1.15], [-.2, 1.0], [-.22, .9], [-.15, .8], [.15, .8], [.22, .9], [.2, 1.0], [.225, 1.15], [.235, 1.36], [.19, 1.45], [.08, 1.49], [-.08, 1.49]]
    .map(([x, y]) => aPantalla(new THREE.Vector3(x, y, .06), aj.M, W, H));
  const cTor = aPantalla(new THREE.Vector3(0, 1.15, .06), aj.M, W, H);
  cavCentro = { x: cTor.x, y: cTor.y, r: aj.escala * .32 };
  // the feathered outline is drawn at a quarter of the size (blur is costly on phones) and scaled up
  const q = 4; tamCapa(capaVenChica, Math.ceil(W / q), Math.ceil(H / q));
  vcctx.clearRect(0, 0, capaVenChica.width, capaVenChica.height);
  vcctx.filter = `blur(${Math.max(1.5, aj.escala * .025 / q)}px)`;
  vcctx.fillStyle = '#fff'; vcctx.beginPath(); borde.forEach((p, i) => i ? vcctx.lineTo(p.x / q, p.y / q) : vcctx.moveTo(p.x / q, p.y / q)); vcctx.closePath(); vcctx.fill();
  vcctx.filter = 'none';
  vctx.imageSmoothingQuality = 'high'; vctx.drawImage(capaVenChica, 0, 0, W, H);
  // cut by the real body silhouette, so nothing ever sits outside the person
  const m = mascaraUlt;
  if (m && m.img && (m.img.naturalWidth || m.img.width)) {
    const iw = m.img.naturalWidth || m.img.width, ih = m.img.naturalHeight || m.img.height;
    actualizarMascara();
    const { sx, sy, sw, sh, vw, vh } = recorte, kx = iw / vw, ky = ih / vh;
    vctx.globalCompositeOperation = 'destination-in'; vctx.imageSmoothingQuality = 'high';
    vctx.drawImage(alfaSuave, sx * kx, sy * ky, sw * kx, sh * ky, 0, 0, W, H);
    vctx.globalCompositeOperation = 'source-over';
  }
  return capaVen;
}
function actualizarMascara() {
  const m = mascaraUlt; if (!m || !m.img || !(m.img.naturalWidth || m.img.width)) return;
  const iw = m.img.naturalWidth || m.img.width, ih = m.img.naturalHeight || m.img.height;
    if (mascaraAlfa !== m) {
    tamCapa(alfaMasc, iw, ih); amctx.clearRect(0, 0, iw, ih); amctx.drawImage(m.img, 0, 0);
    const d = amctx.getImageData(0, 0, iw, ih), px = d.data;
    for (let i = 0; i < px.length; i += 4) { px[i + 3] = Math.min(255, px[i] * 1.6); px[i] = px[i + 1] = px[i + 2] = 255; }
    // blend the new silhouette into the running one: its edge no longer flickers between results
    tamCapa(alfaTmp, iw, ih); alfaTmp.getContext('2d').putImageData(d, 0, 0);
    tamCapa(alfaSuave, iw, ih); const sc = alfaSuave.getContext('2d');
    sc.globalAlpha = mascaraAlfa ? .35 : 1; sc.globalCompositeOperation = 'copy'; if (mascaraAlfa) sc.globalCompositeOperation = 'source-over';
    if (!mascaraAlfa) sc.drawImage(alfaTmp, 0, 0); else { sc.globalCompositeOperation = 'destination-out'; sc.globalAlpha = .35; sc.fillRect(0, 0, iw, ih); sc.globalCompositeOperation = 'source-over'; sc.drawImage(alfaTmp, 0, 0); }
    sc.globalAlpha = 1; sc.globalCompositeOperation = 'source-over'; mascaraAlfa = m;
  }
}
let cavCentro = null;
// just the body's silhouette (smoothed), to keep a single organ inside the person
function siluetaSola(W, H) {
  actualizarMascara();
  if (!mascaraAlfa || !alfaSuave.width) return null;
  tamCapa(capaVen, W, H); vctx.clearRect(0, 0, W, H);
  const { sx, sy, sw, sh, vw, vh } = recorte, kx = alfaSuave.width / vw, ky = alfaSuave.height / vh;
  vctx.imageSmoothingQuality = 'high'; vctx.drawImage(alfaSuave, sx * kx, sy * ky, sw * kx, sh * ky, 0, 0, W, H);
  return capaVen;
}
function cavidad(v, W, H) {
  tamCapa(capaCav, W, H);
  cvctx.globalCompositeOperation = 'source-over'; cvctx.clearRect(0, 0, W, H);
  const c0 = cavCentro || { x: W / 2, y: H / 2, r: Math.min(W, H) * .3 };
  const g = cvctx.createRadialGradient(c0.x, c0.y, c0.r * .1, c0.x, c0.y, c0.r * 1.25);
  g.addColorStop(0, 'rgba(26,10,12,.80)'); g.addColorStop(.7, 'rgba(12,5,7,.90)'); g.addColorStop(1, 'rgba(4,2,4,.96)');
  cvctx.fillStyle = g; cvctx.fillRect(0, 0, W, H);
  cvctx.globalCompositeOperation = 'destination-in'; cvctx.drawImage(v, 0, 0); cvctx.globalCompositeOperation = 'source-over';
}
function recortar(src, v, W, H) {
  tamCapa(capaOrg, W, H);
  octx.globalCompositeOperation = 'source-over'; octx.clearRect(0, 0, W, H); octx.drawImage(src, 0, 0, W, H);
  octx.globalCompositeOperation = 'destination-in'; octx.drawImage(v, 0, 0); octx.globalCompositeOperation = 'source-over';
}

/* ── CPR quality, like a real CPR simulator's feedback screen (Laerdal QCPR): the targets the AHA asks for ── */
let tQcpr = 0, ultimoPlan = '', tPlan = -99;
// Mode 2 (deliberate): when to swap rescuers. A fatigue model (compression quality falls with time, faster with less
// gravity to push with) is rolled forward for each option; the cost adds the predicted quality lost and the hands-off
// pause a swap costs. The option with the lowest cost wins, re-planned every second (model-predictive control).
function planCambio(t, rt) {
  if (!comp.inicio || comp.cuenta < 8) return null;
  const reg = regimen(gravedadActiva().g), tc = t - comp.tCiclo;
  const tau = reg === 'micro' ? 140 : reg === 'marte' ? 170 : 240;           // s until quality falls by ~63% (assumed)
  // measured drift: rate slowing below target speeds the predicted fatigue up
  const lento = rt && rt < 100 ? (100 - rt) / 100 : 0, tauEf = tau * (1 - Math.min(.5, lento * 3));
  const perdida = (a, b) => (Math.exp(-a / tauEf) - Math.exp(-b / tauEf)) * tauEf / 60;   // quality-minutes lost
  const H = 180, pausa = 5 / 60 * 1.5;                                        // 3 min horizon; a swap costs ~5 s hands-off
  const opciones = [
    { clave: 'ahora', n: 'Swap now', costo: pausa + perdida(0, H) },
    { clave: '40', n: 'Swap in 40 s', costo: perdida(tc, tc + 40) + pausa + perdida(0, H - 40) },
    { clave: 'ciclo', n: `Swap at 2:00`, costo: perdida(tc, Math.max(tc, 120)) + pausa + perdida(0, H - Math.max(0, 120 - tc)) },
    { clave: 'seguir', n: 'Keep going', costo: perdida(tc, tc + H) },
  ];
  return opciones.sort((a, b) => a.costo - b.costo);
}
function pintarQcpr(t, dt, aj) {
  const el = $('qcpr'), activo = capas.has('rcp') && !!aj;
  if (!activo) { el.hidden = true; comp.inicio = 0; return; }
  if (!comp.inicio) { comp.inicio = t; comp.tCiclo = t; comp.pausa = 0; comp.cuenta = 0; comp.buenas = 0; }
  const sinComprimir = t - (comp.ultima || comp.inicio) > 1.5; if (sinComprimir) comp.pausa += dt;
  if (t - tQcpr < .1) return; tQcpr = t;
  el.hidden = false;
  const rt = ritmo(t), total = t - comp.inicio, ccf = total > 3 ? Math.max(0, 1 - comp.pausa / total) : null;
  const lateral = (aj.frente ?? 1) < .6, prof = lateral ? comp.prof : null, swap = Math.max(0, 120 - (t - comp.tCiclo));
  if (swap <= 0) { comp.tCiclo = t; registrar('paso', 'Two minutes: swap rescuers now'); decir('Two minutes. Swap rescuers now, without stopping.'); }
  const pos = v => Math.max(0, Math.min(100, (v - 60) / (160 - 60) * 100)), posP = v => Math.max(0, Math.min(100, v / 8 * 100));
  const enR = rt && rt >= 100 && rt <= 120, enP = prof != null && prof >= 5 && prof <= 6;
  const score = comp.cuenta >= 5 ? Math.round(comp.buenas / comp.cuenta * 100) : null;
  const plan = planCambio(t, rt);
  el.innerHTML = `<div class="qt">CPR quality</div>
    <div class="qbloque"><div class="qn"><b class="${rt ? (enR ? 'ok' : 'mal') : ''}">${rt ? Math.round(rt) : '—'}</b><span>compressions/min</span></div>
      <div class="qgauge"><i class="qband" style="left:${pos(100)}%;width:${pos(120) - pos(100)}%"></i>${rt ? `<i class="qneedle" style="left:${pos(rt)}%"></i>` : ''}</div>
      <div class="qesc"><span>60</span><span>100</span><span>120</span><span>160</span></div></div>
    <div class="qbloque"><div class="qn"><b class="${prof != null ? (enP ? 'ok' : 'mal') : 'gris'}">${prof != null ? prof.toFixed(1) : '—'}</b><span>cm depth ${prof != null ? 'est.' : '· view from the side'}</span></div>
      <div class="qgauge"><i class="qband" style="left:${posP(5)}%;width:${posP(6) - posP(5)}%"></i>${prof != null ? `<i class="qneedle" style="left:${posP(prof)}%"></i>` : ''}</div>
      <div class="qesc"><span>0</span><span>5</span><span>6</span><span>8 cm</span></div></div>
    <div class="qfila"><div><b>${comp.cuenta}</b><span>compressions</span></div><div><b>${ccf != null ? Math.round(ccf * 100) + '%' : '—'}</b><span>hands-on time</span></div><div><b>${Math.floor(swap / 60)}:${String(Math.floor(swap % 60)).padStart(2, '0')}</b><span>swap in</span></div></div>
    <div class="qscore"><span>Quality</span><b>${score != null ? score + '%' : '—'}</b><em>targets: 100–120/min · 5–6 cm · hands on ≥ 80%</em></div>
    ${plan ? `<div class="qplan"><span>Nova plans · simulated</span>${plan.map((o, i) => `<div class="${i === 0 ? 'mejor' : ''}"><b>${o.n}</b><i style="width:${Math.round(Math.min(1, o.costo / plan.at(-1).costo) * 100)}%"></i><em>${o.costo.toFixed(2)}</em></div>`).join('')}</div>` : ''}`;
  if (plan && plan[0].clave !== ultimoPlan && t - tPlan > 20) { ultimoPlan = plan[0].clave; tPlan = t; registrar('decision', `Plan: ${plan[0].n} (lowest predicted cost ${plan[0].costo.toFixed(2)} of ${plan.length} options)`); }
}

/* ── medical procedures in AR (any protocol, step by step, on this body) ── */
let PROTOCOLOS = [], proc = null, intervenciones = [], ultimoObs = null, sugerido = null;
// the one organ that matters in each procedure: shown small, behind the body, alone
const ORGANO_PROTOCOLO = { paro_cardiaco: ['corazon'], desmayo: ['corazon'], hipoglucemia: ['bazo'], oxigeno_bajo: ['pulmones'], anafilaxia: ['pulmones'], atragantamiento: ['pulmones'] };
async function cargarProtocolos() { try { PROTOCOLOS = (await (await fetch('protocolos.json')).json()).protocolos.filter(p => (p.guia || []).length); } catch {} pintarSugerencia(); }
// the episode's memory, with HoloAssist's labels: step (instruct), confirmar, corregir, seguimiento, decision, fin
function registrar(tipo, texto, grave, extra = {}) {
  const tp = { paso: 'paso', correcto: 'confirmar', correccion: 'corregir' }[tipo] || tipo;
  intervenciones.push({ t: Date.now(), tipo: tp, texto, grave: !!grave, paso: proc?.id || null, ...extra }); if (intervenciones.length > 60) intervenciones.shift();
}
function abrirProtocolo(id, paso) {
  const c = CREW[tripI] || {};
  proc = new Procedimiento(PROTOCOLOS, id, c, decir, registrar);
  if (paso && proc.pasos[paso] && paso !== proc.id) proc.ir(paso);   // el primer paso ya lo dijo el constructor
  const irOriginal = proc.ir.bind(proc);
  proc.ir = id => { irOriginal(id); Object.assign(proc, { confirmado: false, corregido: false, seguido: false, quieto: 0, repetidas: {} }); };
  registrar('inicio', `${proc.p.titulo} · ${c.corto || ''}`, true);
  $('hoja').hidden = true; pintarProc();
}
function cerrarProtocolo() { if (proc) registrar('fin', `${proc.p.titulo} closed`); proc = null; capas.delete('rcp'); pintarProc(); pintarBarra(); }
// the step card: plain words from the protocol and the answers it needs
function pintarProc() {
  const el = $('proc');
  if (!proc) { el.hidden = true; return; }
  const s = proc.paso, ar = proc.ar; if (!s) { el.hidden = true; return; }
  if (ar.modo === 'rcp') { capas.add('rcp'); if (ar.tecnica) tecnica = ar.tecnica; } else capas.delete('rcp');
  const n = proc.historial.length;
  const botones = s.tipo === 'pregunta' ? `<button class="pb pri" data-r="si">Yes</button><button class="pb" data-r="no">No</button>`
    : s.tipo === 'accion' ? `<button class="pb pri" data-r="hecho">Done</button>`
    : s.tipo === 'espera' ? `<button class="pb" data-r="mejor">Better now</button><button class="pb" data-r="peor">Not better</button>`
    : `<button class="pb pri" data-r="cerrar">Finish</button>`;
  el.innerHTML = `<div class="pcab"><span>${proc.p.titulo}</span><b>step ${n}</b><button class="px" data-r="cerrar" title="Close">×</button></div>
    <p class="ptxt${s.grave ? ' grave' : ''}">${proc.texto(s.texto)}</p>
    ${ar.kit ? `<div class="pkit">From the kit: ${ar.kit}</div>` : ''}
    ${s.tipo === 'espera' ? '<div class="ptiempo" id="pTiempo"></div>' : ''}
    ${proc.herida === null && ar.herida ? '<div class="pkit">Tap the wound on the screen</div>' : ''}
    <div class="pacc">${botones}</div>`;
  el.hidden = false;
}
function pintarSugerencia() {
  const el = $('sugiere'); if (!el) return;
  const t = tr(); let id = null;
  if (!proc && t) {
    const n = k => t.niveles?.[k], mal = k => n(k) === 'atencion' || n(k) === 'aviso_tierra';
    if (mal('glucosa') && t.glucosa < 75) id = 'hipoglucemia';
    else if (mal('spo2')) id = 'oxigeno_bajo';
    else if (mal('temp') && t.temp > 38) id = 'fiebre';
    else if ((mal('pa_sis') && t.pa_sis < 95) || (mal('pulso') && t.pulso < 50)) id = 'desmayo';
  }
  const p = id && PROTOCOLOS.find(x => x.id === id);
  sugerido = p ? p.id : null;
  el.hidden = !p; if (p) el.innerHTML = `<i></i>Nova suggests <b>${p.titulo}</b><button data-abrir="${p.id}">Start</button>`;
}
setInterval(pintarSugerencia, 2000);
// a point of the step on the screen: torso points through the fit, limb points from the landmarks
function puntoPaso(d, aj, o, W, H) {
  if (d.torso) return aPantalla(new THREE.Vector3(...d.torso), aj.M, W, H);
  if (d.lm && o) {
    const [a, b, t, lado] = d.lm, pa = lmPx(o, a, .02), pb = lmPx(o, b, .02); if (!pa || !pb) return null; // off-frame joints still give a direction
    let x = pa.x + (pb.x - pa.x) * t, y = pa.y + (pb.y - pa.y) * t;
    if (lado) { // the outer side of the limb: away from the body's midline
      const m = lmPx(o, 23) && lmPx(o, 24) ? { x: (lmPx(o, 11).x + lmPx(o, 12).x) / 2 } : null;
      if (m) x += Math.sign(x - m.x) * aj.escala * .045;
    }
    return { x, y };
  }
  return null;
}
function lmPx(o, i, minV = .3) {
  const q = o && o[i]; if (!q || q.v < minV) return null;
  const { sx, sy, sw, sh, vw, vh } = recorte, W = mono.width, H = mono.height;
  let x = (q.x * vw - sx) / sw * W; const y = (q.y * vh - sy) / sh * H;
  if (frente) x = W - x;
  return { x, y };
}
function manosPx() {
  if (!manosUlt.length || performance.now() - tManos > 400) return [];
  const { sx, sy, sw, sh, vw, vh } = recorte, W = mono.width, H = mono.height;
  return manosUlt.map(m => { const c = [0, 5, 9, 17].map(i => m.lm[i]).reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
    let x = (c.x * vw - sx) / sw * W; if (frente) x = W - x; return { x, y: (c.y * vh - sy) / sh * H }; });
}
// the wound: a tap on the screen, snapped to the nearest limb so it follows the body
const LIMBS = [[11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28]];
function marcarHerida(x, y) {
  if (!proc || !proc.ar.herida || !ultimoObs) return false;
  let mejor = null, dmin = 1e9;
  for (const [a, b] of LIMBS) {
    const pa = lmPx(ultimoObs, a), pb = lmPx(ultimoObs, b); if (!pa || !pb) continue;
    const vx = pb.x - pa.x, vy = pb.y - pa.y, t = Math.max(0, Math.min(1, ((x - pa.x) * vx + (y - pa.y) * vy) / (vx * vx + vy * vy || 1)));
    const d = Math.hypot(pa.x + vx * t - x, pa.y + vy * t - y); if (d < dmin) { dmin = d; mejor = { a, b, t }; }
  }
  if (!mejor || dmin > mono.width * .12) { decir('Tap right on the wound, on the arm or the leg.'); return true; }
  proc.herida = mejor; registrar('herida', `Wound marked on the ${mejor.a % 2 ? 'left' : 'right'} ${mejor.a >= 23 ? 'leg' : 'arm'}`);
  decir('Got it. Press right there.'); pintarProc(); return true;
}
// where the tourniquet goes: above the wound, high on the same limb, never on a joint
function lugarTorniquete(h) {
  if (h.a === 13 || h.a === 14) return { a: h.a === 13 ? 11 : 12, b: h.a, t: .5 };          // forearm wound → mid upper arm
  if (h.a === 25 || h.a === 26) return { a: h.a === 25 ? 23 : 24, b: h.a, t: .45 };          // lower leg → mid thigh
  return { a: h.a, b: h.b, t: Math.max(.18, h.t - .3) };                                      // upper limb: higher up, away from the joint
}
// one utterance at a time: at least 3 s apart, one reference and one direction each; every one is logged
let tHablo = -99;
function intervenir(tipo, frase, nota, t, extra = {}) {
  if (t - tHablo < 3) return false;
  const reps = proc.repetidas || (proc.repetidas = {}); const clave = tipo + ':' + nota;
  if (reps[clave] && t - reps[clave] < 8) return false; // never nag with the same line
  reps[clave] = t; tHablo = t;
  decir(frase);
  registrar(tipo, nota, tipo === 'corregir' && extra.critico, { iniciador: 'nova', frase, ...extra });
  return true;
}
let tCorregir = 0;
function pasoAR(c, aj, o, W, H, k, t, dt) {
  if (!proc) return;
  const ar = proc.ar, d = tr();
  const dibujos = [];
  for (const pt of ar.puntos || []) { const q = puntoPaso(pt, aj, o, W, H); if (q) dibujos.push({ q, n: pt.n, s: pt.s, atras: pt.atras }); }
  if (ar.herida && proc.herida) {
    const h = proc.herida, q = puntoPaso({ lm: [h.a, h.b, h.t] }, aj, o, W, H);
    if (q) dibujos.push({ q, n: ar.torniquete ? 'Wound' : 'Press here', s: ar.torniquete ? '' : 'firm, 2–3 fingers, do not lift', herida: true });
    if (ar.torniquete) { const tq = lugarTorniquete(h), q2 = puntoPaso({ lm: [tq.a, tq.b, tq.t] }, aj, o, W, H); if (q2) dibujos.unshift({ q: q2, n: 'Tourniquet', s: 'above the wound, not on a joint · note the time', banda: true }); }
  }
  if (ar.zona) { const cab = lmPx(o, 0); if (cab) { c.strokeStyle = 'rgba(126,224,188,.8)'; c.setLineDash([5 * k, 6 * k]); c.lineWidth = 1.4 * k; c.beginPath(); c.arc(cab.x, cab.y, aj.escala * .22, 0, 7); c.stroke(); c.setLineDash([]); texto(c, cab.x, cab.y - aj.escala * .24, 'clear this space · nothing in the mouth', { f: 12 * k, col: '#9ff0d0', alin: 'center' }); } }
  // a target out of view, or under the step card, gets an arrow on the edge instead of a ring
  const card = $('proc'), rc = card && !card.hidden ? card.getBoundingClientRect() : null;
  const pr = pantalla.getBoundingClientRect(), s2 = Math.max(pr.width / W, pr.height / H), oy = (pr.height - H * s2) / 2, ox = (pr.width - W * s2) / 2;
  const cardX0 = rc ? (rc.left - pr.left - ox) / s2 - 20 * k : 0, cardX1 = rc ? (rc.right - pr.left - ox) / s2 + 20 * k : 0;
  const barra = $('barra'), rb = barra && !barra.hidden ? barra.getBoundingClientRect() : null;
  const pisoY = rb ? (rb.top - pr.top - oy) / s2 - 16 * k : H - 20 * k;
  for (let i = dibujos.length - 1; i >= 0; i--) {
    const e = dibujos[i], bajoCard = rc && e.q.x > cardX0 && e.q.x < cardX1;
    const limiteY = bajoCard ? (rc.top - pr.top - oy) / s2 - 16 * k : pisoY;
    const fuera = e.q.x < 0 || e.q.x > W || e.q.y < 0 || e.q.y > limiteY;
    if (!fuera) continue;
    dibujos.splice(i, 1);
    const ax = Math.max(40 * k, Math.min(W - 40 * k, e.q.x)), ay = Math.max(150 * k, Math.min(limiteY - 30 * k, e.q.y));
    const ang = Math.atan2(e.q.y - ay, e.q.x - ax);
    flechaFina(c, { x: ax - Math.cos(ang) * 26 * k, y: ay - Math.sin(ang) * 26 * k }, { x: ax, y: ay }, '#7fe0c0', k);
    const dirTxt = e.q.y > limiteY ? 'point the camera lower' : e.q.y < 0 ? 'point higher' : e.q.x < 0 ? 'point left' : 'point right';
    textoLibre(c, ax, ay - 34 * k, `${(e.n || '').toUpperCase()} · ${dirTxt}`, { f: 11 * k, w: 600, col: '#7fe0c0', alin: 'center', esp: 1 * k }, k);
  }
  // targets: a ring, the step's words beside it
  dibujos.forEach((e, i) => {
    const r = Math.max(13 * k, aj.escala * .035), col = e.herida ? '#ff6b6b' : e.banda ? AMBAR : '#7fe0c0', golpe = (t * .8 + i * .3) % 1;
    c.strokeStyle = col; c.lineWidth = 1.6 * k; c.setLineDash(e.atras ? [4 * k, 4 * k] : []);
    if (e.banda) { c.beginPath(); c.ellipse(e.q.x, e.q.y, r * 1.6, r * .55, Math.atan2(aj.ey.x, aj.ey.y), 0, 7); c.stroke(); }
    else { c.beginPath(); c.arc(e.q.x, e.q.y, r, 0, 7); c.stroke(); c.globalAlpha = .6 * (1 - golpe); c.beginPath(); c.arc(e.q.x, e.q.y, r * (1 + golpe * .8), 0, 7); c.stroke(); c.globalAlpha = 1; }
    c.setLineDash([]); c.fillStyle = col; c.beginPath(); c.arc(e.q.x, e.q.y, 2.6 * k, 0, 7); c.fill();
    const der = e.q.x < W * .6, xt = e.q.x + (der ? 1 : -1) * (r + 14 * k);
    linea(c, [{ x: e.q.x + (der ? r : -r), y: e.q.y }, { x: xt - (der ? 4 : -4) * k, y: e.q.y }], col, 1 * k);
    if (e.n) textoLibre(c, xt, e.q.y - 6 * k, e.n.toUpperCase(), { f: 10.5 * k, w: 600, col, alin: der ? 'left' : 'right', esp: 1.4 * k }, k);
    if (e.s) textoLibre(c, xt, e.q.y + 13 * k, e.s, { f: 14 * k, alin: der ? 'left' : 'right' }, k);
  });
  if (ar.flecha && dibujos[0]) { // the direction of the push (e.g. in and up for abdominal thrusts)
    const p0 = (ar.puntos || [])[0]?.torso || [0, 1.12, .12], a = dibujos[0].q;
    const b = aPantalla(new THREE.Vector3(p0[0] + ar.flecha[0], p0[1] + ar.flecha[1], p0[2] + ar.flecha[2]), aj.M, W, H);
    flechaFina(c, a, { x: a.x + (b.x - a.x) * 1.6, y: a.y + (b.y - a.y) * 1.6 }, '#7fe0c0', k);
  }
  // the instructor (HoloAssist, Wang et al. 2023): confirm with one word, correct critical errors within 5 s with one
  // spatial reference, give non-critical errors ~3 s to self-correct, follow up when the rescuer looks stuck, and log
  // every intervention with the paper's taxonomy (instruct · confirm · correct · follow-up · close)
  const obj = dibujos.find(e => e.banda) || dibujos[0], s0 = proc.paso, critico = !!s0?.grave;
  const manos = manosPx();
  if (ar.manos && obj) {
    let dmin = 1e9, cerca = null;
    for (const m of manos) { const dd = Math.hypot(m.x - obj.q.x, m.y - obj.q.y); if (dd < dmin) { dmin = dd; cerca = m; } }
    const rOk = aj.escala * .06;
    if (cerca && dmin < rOk) {
      proc.bien += dt; proc.mal = 0;
      if (proc.bien > 1.2 && !proc.confirmado) { proc.confirmado = true; intervenir('confirmar', 'Good. That is the spot.', `Hands on ${obj.n || 'the target'}`, t, { correccion: proc.corregido ? 'corrected_by_nova' : 'correct' }); }
    } else if (cerca && dmin < aj.escala * .45) {
      proc.mal += dt; proc.bien = 0;
      // critical steps: correct fast (after 0.8 s of persistence, so noise does not trigger it); others: wait 3 s
      if (proc.mal > (critico ? .8 : 3)) {
        const up = aj.ey.clone().normalize(), dir = corregir(obj.q.x - cerca.x, obj.q.y - cerca.y, { x: up.x, y: -up.y });
        const cm = Math.max(2, Math.round(dmin * aj.mpp * 100 / 2) * 2);
        if (dir && intervenir('corregir', `No. ${cm} centimeters ${dir}.`, `Hands ${cm} cm off · ${dir}`, t, { critico })) proc.corregido = true;
      }
      c.strokeStyle = 'rgba(244,184,96,.8)'; c.setLineDash([3 * k, 4 * k]); c.lineWidth = 1.2 * k; c.beginPath(); c.moveTo(cerca.x, cerca.y); c.lineTo(obj.q.x, obj.q.y); c.stroke(); c.setLineDash([]);
    }
  }
  // confusion: hands visible but still, away from the target, or the step taking far longer than expected
  const vel = manos.length && proc.manosPrev ? Math.min(...manos.map(m => Math.min(...proc.manosPrev.map(p => Math.hypot(m.x - p.x, m.y - p.y))))) / Math.max(dt, .016) : null;
  proc.manosPrev = manos;
  if (vel != null && vel < aj.escala * .05 && !proc.confirmado) proc.quieto = (proc.quieto || 0) + dt; else proc.quieto = 0;
  const tPaso = (performance.now() - proc.tPaso) / 1000, esperado = s0?.tipo === 'accion' ? 25 : s0?.tipo === 'pregunta' ? 15 : 9999;
  if (ar.manos && obj && proc.quieto > 4) intervenir('seguimiento', `Now, ${(obj.n || 'the point').toLowerCase()}: ${obj.s || 'put your hands there'}.`, 'Rescuer still, not on the target', t);
  else if (tPaso > esperado * 1.5 && !proc.seguido) { proc.seguido = true; intervenir('seguimiento', s0?.tipo === 'pregunta' ? 'Answer yes or no on the screen when you know.' : 'Take your time. Tap Done when it is finished.', 'Step taking longer than expected', t); }
  // timers decide from the twin when they run out
  const rest = proc.restante();
  if (rest != null) {
    const el = $('pTiempo'); if (el) el.textContent = `${Math.floor(rest / 60)}:${String(Math.floor(rest % 60)).padStart(2, '0')}`;
    if (rest <= 0) { proc.cerrarEspera(null, d); pintarProc(); }
  }
  // the live values this step watches, under the step's targets
  if (ar.vitales && d) {
    const y0 = H * .25; let x0 = W - 20 * k;
    ar.vitales.forEach((kk, i) => { const [n, u, dec] = NOMBRE_VITAL[kk] || [kk, '', 0], col = NIVEL_COL[d.niveles?.[kk]] || BLANCO;
      texto(c, x0, y0 + i * 46 * k, n.toUpperCase(), { f: 10 * k, w: 600, col: 'rgba(244,247,250,.7)', alin: 'right', esp: 1.4 * k });
      texto(c, x0, y0 + i * 46 * k + 24 * k, `${f1(d[kk], dec)} ${u}`, { f: 20 * k, col, alin: 'right' }); });
  }
}

/* ── the clean layer: thin type straight on the picture (with a soft shadow), hairlines, no boxes ── */
const BLANCO = '#f4f7fa', TENUE = 'rgba(244,247,250,.62)', ROSA = '#ff7a9c', AMBAR = '#f4b860';
function texto(c, x, y, s, { f = 15, w = 500, col = BLANCO, alin = 'left', esp = 0, base = 'alphabetic' } = {}) {
  c.font = `${w} ${f}px SG`; c.textAlign = alin; c.textBaseline = base; c.fillStyle = col;
  if ('letterSpacing' in c) c.letterSpacing = esp + 'px';
  c.shadowColor = 'rgba(0,0,0,.85)'; c.shadowBlur = f * .7; c.fillText(s, x, y); c.shadowBlur = f * .25; c.fillText(s, x, y); c.shadowBlur = 0;
  const ancho = c.measureText(s).width; if ('letterSpacing' in c) c.letterSpacing = '0px'; c.textAlign = 'left'; return ancho;
}
function linea(c, pts, col, ancho) {
  c.strokeStyle = col; c.lineWidth = ancho; c.lineCap = 'round'; c.lineJoin = 'round';
  c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 4; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.stroke(); c.shadowBlur = 0;
}
function viñeta(c, W, H) { // dark gradients behind the text rows: legible on any room, no boxes
  let g = c.createLinearGradient(0, 0, 0, H * .22); g.addColorStop(0, 'rgba(0,0,0,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H * .22);
  g = c.createLinearGradient(0, H, 0, H * .66); g.addColorStop(0, 'rgba(0,0,0,.62)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, H * .66, W, H * .34);
}
function rotulos(c, aj, W, H, k) {
  const datos = tr(), dentro = [];
  for (const g of ETIQUETAS) {
    if (!grupos[g] || !grupos[g].visible || !centros[g]) continue;
    const p = aPantalla(centros[g], g === 'cerebro' ? aj.C : aj.M, W, H);
    if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
    dentro.push({ g, p, d: GRUPOS[g].dato(datos) });
  }
  let mejor = null, dmin = Math.min(W, H) * .2;
  for (const e of dentro) { const d = Math.hypot(e.p.x - W / 2, e.p.y - H / 2); if (d < dmin) { dmin = d; mejor = e; } }
  foco = mejor ? mejor.g : null;
  if (visor || capas.has('rcp') || proc) return;
  const mitad = aPantalla(REF.hombros, aj.M, W, H).x, ancho = aj.escala * REF.anchoHombros;
  const angosto = W / k < 620;
  if (angosto) { // a narrow screen has no room beside the body: only the organ in the center gets its label, next to it
    const e = dentro.find(x => x.g === foco); if (!e) return;
    const der = e.p.x < W * .55, xt = der ? Math.min(W - 16 * k - 130 * k, e.p.x + 60 * k) : Math.max(16 * k + 130 * k, e.p.x - 60 * k);
    c.strokeStyle = BLANCO; c.lineWidth = 1.2 * k; c.beginPath(); c.arc(e.p.x, e.p.y, 3.4 * k, 0, 7); c.stroke();
    linea(c, [{ x: e.p.x + (der ? 4 : -4) * k, y: e.p.y }, { x: xt + (der ? -6 : 6) * k, y: e.p.y }], 'rgba(244,247,250,.7)', 1 * k);
    texto(c, xt, e.p.y - 8 * k, GRUPOS[e.g].n.toUpperCase(), { f: 11 * k, w: 600, col: NIVEL_COL[e.d.nivel] || '#bfeefa', alin: der ? 'left' : 'right', esp: 1.6 * k });
    texto(c, xt, e.p.y + 13 * k, e.d.v, { f: 17 * k, alin: der ? 'left' : 'right' });
    return;
  }
  const lados = { izq: dentro.filter(e => e.p.x < mitad).sort((a, b) => a.p.y - b.p.y), der: dentro.filter(e => e.p.x >= mitad).sort((a, b) => a.p.y - b.p.y) };
  for (const [lado, l] of Object.entries(lados)) {
    let yMin = -1e9;
    const sig = lado === 'izq' ? -1 : 1;
    const xc = lado === 'izq' ? Math.max(16 * k, mitad - ancho * .95 - (angosto ? 20 : 70) * k) : Math.min(W - 16 * k, mitad + ancho * .95 + (angosto ? 20 : 70) * k);
    for (const e of l) {
      const y = Math.min(H * .72, Math.max(H * .2, e.p.y, yMin + 46 * k)); yMin = y;
      const alerta = NIVEL_COL[e.d.nivel];
      // dot on the organ, hairline with one elbow, then the text
      c.strokeStyle = BLANCO; c.lineWidth = 1.2 * k; c.beginPath(); c.arc(e.p.x, e.p.y, 3.2 * k, 0, 7); c.stroke();
      const codo = { x: xc - sig * 14 * k, y };
      linea(c, [{ x: e.p.x + sig * 3.2 * k, y: e.p.y }, { x: e.p.x + sig * Math.min(Math.abs(codo.x - e.p.x) * .35, 40 * k), y: e.p.y }, codo, { x: xc - sig * 4 * k, y }], 'rgba(244,247,250,.55)', 1 * k);
      const alin = lado === 'izq' ? 'right' : 'left', enFoco = foco === e.g;
      c.font = `500 ${16 * k}px SG`; const wv = Math.max(c.measureText(e.d.v).width, 70 * k), cxh = lado === 'izq' ? xc - wv / 2 : xc + wv / 2;
      texto(c, xc, y - 7 * k, GRUPOS[e.g].n.toUpperCase(), { f: 10.5 * k, w: 600, col: alerta || (enFoco ? '#bfeefa' : 'rgba(244,247,250,.84)'), alin, esp: 1.6 * k });
      texto(c, xc, y + 12 * k, e.d.v, { f: (enFoco ? 18 : 16) * k, w: 500, col: BLANCO, alin });
    }
  }
}
// thin corner brackets around the torso: what the scanner has locked on
function marco(c, aj, W, H, k, t) {
  const pts = [[-.24, 1.5], [.24, 1.5], [-.24, .86], [.24, .86]].map(([x, y]) => aPantalla(new THREE.Vector3(x, y, 0), aj.M, W, H));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), L = 16 * k;
  c.strokeStyle = 'rgba(244,247,250,.7)'; c.lineWidth = 1.3 * k; c.lineCap = 'square';
  c.beginPath();
  c.moveTo(x0, y0 + L); c.lineTo(x0, y0); c.lineTo(x0 + L, y0);
  c.moveTo(x1 - L, y0); c.lineTo(x1, y0); c.lineTo(x1, y0 + L);
  c.moveTo(x1, y1 - L); c.lineTo(x1, y1); c.lineTo(x1 - L, y1);
  c.moveTo(x0 + L, y1); c.lineTo(x0, y1); c.lineTo(x0, y1 - L);
  c.stroke();
}
function flechaFina(c, a, b, col, k) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x), L = 9 * k;
  linea(c, [a, b], col, 1.4 * k);
  c.fillStyle = col; c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(b.x - Math.cos(ang - .4) * L, b.y - Math.sin(ang - .4) * L); c.lineTo(b.x - Math.cos(ang + .4) * L, b.y - Math.sin(ang + .4) * L); c.closePath(); c.fill();
}
function textoLibre(c, x, y, s, op, k) { // a text that steps down until it touches nothing already placed
  c.font = `${op.w || 500} ${op.f}px SG`; const w = c.measureText(s).width, h = op.f * 1.3;
  const Wc = c.canvas.width, m8 = 10 * k;
  if (op.alin === 'right') x = Math.max(w + m8, Math.min(Wc - m8, x)); else if (op.alin === 'center') x = Math.max(w / 2 + m8, Math.min(Wc - w / 2 - m8, x)); else x = Math.max(m8, Math.min(Wc - w - m8, x));
  const x0 = op.alin === 'right' ? x - w : op.alin === 'center' ? x - w / 2 : x;
  for (let i = 0; i < 10 && ocupados.some(o => choca({ x: x0, y: y - h, w, h }, o)); i++) y += h + 4 * k;
  reservar(x0, y - h, w, h + 4 * k); texto(c, x, y, s, op); return y;
}
function rcpFino(c, aj, W, H, k, t, reg) {
  const p = aPantalla(REF.rcp, aj.M, W, H), r = Math.max(14 * k, aj.escala * .04), golpe = (t * 110 / 60) % 1;
  c.strokeStyle = ROSA; c.lineWidth = 1.6 * k; c.beginPath(); c.arc(p.x, p.y, r, 0, 7); c.stroke();
  c.globalAlpha = .7 * (1 - golpe); c.lineWidth = 1 * k; c.beginPath(); c.arc(p.x, p.y, r * (1 + golpe * .9), 0, 7); c.stroke(); c.globalAlpha = 1;
  c.fillStyle = ROSA; c.beginPath(); c.arc(p.x, p.y, 2.6 * k, 0, 7); c.fill();
  // where the numbers go: to the side of the point away from the body's center
  const cen = aPantalla(REF.cadera, aj.M, W, H);
  const lado = p.x >= cen.x ? 1 : -1, xt = Math.max(16 * k, Math.min(W - 16 * k, p.x + lado * (r + 16 * k)));
  linea(c, [{ x: p.x + lado * r, y: p.y }, { x: xt - lado * 4 * k, y: p.y }], 'rgba(255,122,156,.7)', 1 * k);
  const rt = ritmo(t), alin = lado > 0 ? 'left' : 'right';
  c.font = `500 ${16 * k}px SG`; const wl = c.measureText('100–120/min · 5–6 cm').width;
  reservar(alin === 'left' ? xt : xt - wl, p.y - 22 * k, wl, 40 * k); reservar(p.x - r - 4 * k, p.y - r - 4 * k, 2 * r + 8 * k, 2 * r + 8 * k);
  texto(c, xt, p.y - 7 * k, 'COMPRESS HERE', { f: 10.5 * k, col: ROSA, alin, esp: 1.6 * k });
  texto(c, xt, p.y + 12 * k, rt ? `${Math.round(rt)}/min · ${comp.cuenta}` : '100–120/min · 5–6 cm', { f: 16 * k, alin, col: rt && (rt < 100 || rt > 120) ? AMBAR : BLANCO });
  // the chest's front direction in the picture (head-on: draw it across the body)
  const fr = aPantalla(REF.rcp.clone().add(new THREE.Vector3(0, 0, .25)), aj.M, W, H);
  let dir = { x: fr.x - p.x, y: fr.y - p.y }, n = Math.hypot(dir.x, dir.y);
  if (n < aj.escala * .04) { dir = { x: -lado, y: -.35 }; n = Math.hypot(dir.x, dir.y); }
  dir = { x: dir.x / n, y: dir.y / n };
  const Lf = Math.max(40 * k, aj.escala * .16);
  if (reg === 'micro') {
    flechaFina(c, { x: p.x + dir.x * (r + Lf), y: p.y + dir.y * (r + Lf) }, { x: p.x + dir.x * (r + 3 * k), y: p.y + dir.y * (r + 3 * k) }, ROSA, k);
    const a0 = { x: p.x + dir.x * (r + Lf + 8 * k), y: p.y + dir.y * (r + Lf + 8 * k) }, a1 = { x: a0.x + dir.x * Lf * .7, y: a0.y + dir.y * Lf * .7 };
    flechaFina(c, a0, a1, AMBAR, k);
    textoLibre(c, a1.x + (dir.x >= 0 ? 8 : -8) * k, a1.y + 4 * k, 'reaction · anchor yourself', { f: 12 * k, col: AMBAR, alin: dir.x >= 0 ? 'left' : 'right' }, k);
    const anclas = tecnica === 'er' ? [[REF.hombroD, 'left leg over this shoulder'], [REF.espalda, 'ankles locked behind the back']]
      : tecnica === 'rbh' ? [[REF.espalda, 'from behind, arms around the chest']] : tecnica === 'sujeto' ? [[REF.cadera, 'waist and leg straps']] : [];
    for (const [v, txt] of anclas) {
      if (v === REF.espalda && (aj.frente ?? 0) > .55) continue; // the back is out of sight when they face the camera
      const q = aPantalla(v, aj.M, W, H), izq = q.x > W * .6;
      c.strokeStyle = 'rgba(126,224,188,.9)'; c.lineWidth = 1.2 * k; c.setLineDash([3 * k, 4 * k]); c.beginPath(); c.arc(q.x, q.y, 10 * k, 0, 7); c.stroke(); c.setLineDash([]);
      textoLibre(c, q.x + (izq ? -16 : 16) * k, q.y + 4 * k, txt, { f: 12 * k, col: '#9ff0d0', alin: izq ? 'right' : 'left' }, k);
    }
    if (tecnica === 'hs') {
      const pared = { x: p.x + dir.x * Lf * 3, y: p.y + dir.y * Lf * 3 };
      c.setLineDash([4 * k, 5 * k]); linea(c, [p, pared], 'rgba(126,224,188,.8)', 1 * k); c.setLineDash([]);
      texto(c, pared.x, pared.y - 8 * k, 'feet on the opposite wall', { f: 12 * k, col: '#9ff0d0', alin: 'center' });
    }
  } else if (grav.dir) { // with a real gravity sensor: the push goes with gravity
    const g = grav.dir;
    flechaFina(c, { x: p.x - g.x * (r + Lf), y: p.y - g.y * (r + Lf) }, { x: p.x - g.x * (r + 3 * k), y: p.y - g.y * (r + 3 * k) }, ROSA, k);
  }
}
// Nova: a small orb beside the head, a faint glow and nothing else; when she talks, a caption at the bottom
function novaFina(c, aj, W, H, k, t) {
  if (!novaImg) return;
  const cab = aPantalla(REF.orejas, aj.C, W, H), hom = aPantalla(REF.hombros, aj.M, W, H), ancho = aj.escala * REF.anchoHombros;
  const lado = hom.x > W / 2 ? -1 : 1, tam = Math.max(56 * k, Math.min(ancho * .42, 92 * k));
  const x = Math.max(tam, Math.min(W - tam, hom.x + lado * (ancho * .8 + tam))), y = Math.max(H * .2 + tam * .5, cab.y) + Math.sin(t * 1.4) * 3 * k;
  const g = c.createRadialGradient(x, y, 0, x, y, tam * .9); g.addColorStop(0, 'rgba(110,215,240,.22)'); g.addColorStop(1, 'rgba(110,215,240,0)');
  c.fillStyle = g; c.fillRect(x - tam, y - tam, tam * 2, tam * 2);
  c.save(); c.globalAlpha = .95; c.drawImage(novaImg, x - tam / 2, y - tam * .42, tam, tam * .83); c.restore();
}
function subtitulo(c, W, H, k, yPie) {
  if (!novaTexto || performance.now() - tTexto > 7000 || visor || proc) return yPie;
  c.font = `400 ${15 * k}px SG`;
  const max = Math.min(W - 48 * k, 640 * k), lineas = []; let l = '';
  for (const w of novaTexto.split(' ')) { const p = l ? l + ' ' + w : w; if (c.measureText(p).width > max && l) { lineas.push(l); l = w; } else l = p; }
  if (l) lineas.push(l);
  const y0 = yPie - (lineas.length - 1) * 21 * k;
  lineas.forEach((s, i) => texto(c, W / 2, y0 + i * 21 * k, s, { f: 15 * k, w: 400, alin: 'center', col: 'rgba(244,247,250,.92)' }));
  return y0 - 30 * k;
}
function partir(c, s, ancho, f) { // wrap a sentence to a width, for text drawn into the picture
  c.save(); c.font = `500 ${f}px SG`;
  const out = []; let l = '';
  for (const w of String(s || '').split(/\s+/)) { const p = l ? l + ' ' + w : w; if (l && c.measureText(p).width > ancho) { out.push(l); l = w; } else l = p; }
  if (l) out.push(l); c.restore(); return out.slice(0, 4);
}
function hudFino(c, W, H, k, t, hayCuerpo, reg, gA) {
  const cm = CREW[tripI] || {}, d = tr(), barra = $('barra'), angosto = W / k < 620;
  const m = 20 * k, yPie = H - ((!visor && !barra.hidden ? barra.getBoundingClientRect().height + 14 : 0) + 30) * fCss;
  viñeta(c, W, H);
  if (novaImg) { c.save(); c.globalAlpha = .95; c.drawImage(novaImg, m - 4 * k, m - 6 * k, 34 * k, 28 * k); c.restore(); }
  texto(c, m + 36 * k, m + 10 * k, 'NOVA  ·  BODY SCAN', { f: 10.5 * k, col: '#8fe6f5', esp: 2 * k });
  texto(c, m, m + 34 * k, angosto || visor ? (cm.corto || '') : `${cm.nombre || ''}`, { f: 18 * k, w: 500 });
  if (!angosto && !visor) texto(c, m, m + 54 * k, cm.rol || '', { f: 12.5 * k, col: TENUE });
  if (hayCuerpo && ajuste?.tresD && !visor && sistema !== 'ojos') // the anatomy is fitted to this body: say what was measured
    texto(c, m, m + (angosto ? 56 : 76) * k, `anatomy fitted to this body · torso ${Math.round(medidas.torso * 100)} cm · ${medidas.dist.toFixed(1)} m away`, { f: 11.5 * k, w: 400, col: 'rgba(191,238,250,.8)' });
  const vivo = Date.now() - ultimoEnvioOk < 2000, mac = fuenteObs === 'mac' && performance.now() - vis.tUlt < 800;
  const der = W - m;
  if (vivo) { c.fillStyle = ROSA; c.beginPath(); c.arc(der - c.measureText('LIVE').width - 14 * k, m + 6.5 * k, 3.5 * k, 0, 7); c.fill(); }
  texto(c, der, m + 10 * k, vivo ? 'LIVE' : 'OFFLINE', { f: 10.5 * k, col: vivo ? BLANCO : TENUE, alin: 'right', esp: 2 * k });
  texto(c, der, m + 30 * k, mac ? `ship vision ${Math.round(vis.rtt)} ms` : localListo ? 'phone vision' : 'starting vision', { f: 12.5 * k, col: TENUE, alin: 'right' });
  const gtxt = reg === 'micro' ? 'microgravity' : reg === 'marte' ? 'Mars 0.38 g' : 'Earth 1 g';
  texto(c, der, m + 48 * k, gtxt + (grav.med != null && !angosto ? ` · phone ${grav.med.toFixed(2)} g` : ''), { f: 12.5 * k, col: reg === 'micro' ? '#c9bfff' : TENUE, alin: 'right' });
  // drift matters while treating: shown only during CPR or a procedure, and only with a steady, calibrated phone
  if (reg === 'micro' && deriva.v > .12 && hayCuerpo && (capas.has('rcp') || proc) && (!giro.hay || calGiro.x || calGiro.y)) {
    c.fillStyle = AMBAR; c.beginPath(); c.arc(W / 2 - 6 * k - c.measureText('x').width, m + 74 * k, 3 * k, 0, 7);
    texto(c, W / 2, m + 78 * k, `patient drifting ${Math.round(deriva.v * 100)} cm/s · hold or strap them`, { f: 13.5 * k, col: AMBAR, alin: 'center' });
  }
  let y = yPie;
  if (capas.has('rcp') && hayCuerpo && !visor && !proc) {
    const gr = guiaRcp(reg), filas = gr.pasos.length;
    const top = yPie - (filas * 20 + 46) * k;
    texto(c, m, top, gr.titulo.toUpperCase(), { f: 10.5 * k, col: ROSA, esp: 1.8 * k });
    texto(c, m, top + 26 * k, gr.tec, { f: 22 * k, w: 500 });
    gr.pasos.forEach((s, i) => texto(c, m, top + (50 + i * 20) * k, s, { f: 13.5 * k, w: 400, col: 'rgba(244,247,250,.82)' }));
    texto(c, m, yPie + 4 * k, gr.fuente, { f: 10 * k, w: 400, col: 'rgba(244,247,250,.42)' });
    return;
  }
  y = subtitulo(c, W, H, k, y);
  // in the headset the step card can't be reached or seen with both eyes: the step goes into the picture (both eyes get
  // the same frame) and the answer comes from NOVA Station
  if (visor && proc?.paso) {
    const lineas = partir(c, proc.texto(proc.paso.texto), W * .78, 17 * k), alto = (lineas.length * 22 + 40) * k;
    let yy = y - alto + 18 * k;
    texto(c, W / 2, yy, `${proc.p.titulo.toUpperCase()}  ·  STEP ${proc.historial.length}`, { f: 10.5 * k, col: '#ff9db4', alin: 'center', esp: 1.6 * k });
    lineas.forEach(l => { yy += 22 * k; texto(c, W / 2, yy, l, { f: 17 * k, w: 500, alin: 'center', col: proc.paso.grave ? '#fff' : BLANCO }); });
    const op = botonesProc().map(([, n]) => n).join('  ·  ');
    texto(c, W / 2, yy + 22 * k, proc.herida === null && proc.ar.herida ? 'Mark the wound on NOVA Station' : `${op}  —  answer on NOVA Station`, { f: 11.5 * k, col: TENUE, alin: 'center' });
    y = y - alto - 10 * k;
  }
  if (sistema === 'ojos') {
    if (!ojos.revision) panelOjos(c, { W, H, k, texto, nombre: cm.corto, angosto, yPie: y });
    if (!ojos.cara && !ojos.revision) texto(c, W / 2, y - (angosto ? 330 : 0) * k, ojos.error ? 'The face model could not start on this device' : ojos.modelo ? 'Bring the face close · eyes level with the camera' : 'Loading the face model…', { f: 16 * k, alin: 'center', col: 'rgba(244,247,250,.85)' });
  } else if (!hayCuerpo) texto(c, W / 2, y, 'Show Nova the torso, shoulders to hips', { f: 16 * k, alin: 'center', col: 'rgba(244,247,250,.85)' });
  else if (!visor && !proc && !(panelAbajo && ESTILO === 'holo' && capas.has('organos') && !capas.has('rcp'))) {
    // live vitals, like a monitor: label above, number below, colored only when out of range
    const cols = [['HEART RATE', `${f1(d?.pulso)}`, 'bpm', 'pulso'], ['SpO₂', `${f1(d?.spo2)}`, '%', 'spo2'], ['BLOOD PRESSURE', `${f1(d?.pa_sis)}/${f1(d?.pa_dia)}`, 'mmHg', 'pa_sis'], ['RESP', `${f1(d?.fr)}`, '/min', 'fr'], ['GLUCOSE', `${f1(d?.glucosa)}`, 'mg/dL', 'glucosa'], ['TEMP', `${f1(d?.temp, 1)}`, '°C', 'temp']];
    const lista = angosto ? cols.slice(0, 3) : cols, paso = Math.min(128 * k, (W - 2 * m) / lista.length), x0 = W / 2 - paso * lista.length / 2;
    lista.forEach(([n, v, u, kk], i) => {
      const x = x0 + paso * i + paso / 2, col = NIVEL_COL[d?.niveles?.[kk]] || BLANCO;
      texto(c, x, y - 22 * k, n, { f: 10 * k, w: 600, col: 'rgba(244,247,250,.7)', alin: 'center', esp: 1.4 * k });
      const wn = texto(c, x - 8 * k, y + 4 * k, v, { f: 24 * k, w: 500, col, alin: 'center' });
      texto(c, x - 8 * k + wn / 2 + 4 * k, y + 4 * k, u, { f: 11 * k, w: 500, col: 'rgba(244,247,250,.6)' });
    });
    texto(c, W / 2, y + 26 * k, 'live from the onboard core · organ positions estimated from this body', { f: 10.5 * k, w: 400, col: 'rgba(244,247,250,.5)', alin: 'center' });
  }
  c.fillStyle = 'rgba(244,247,250,.7)'; c.beginPath(); c.arc(W / 2, H / 2, 2 * k, 0, 7); c.fill();
}

function animar(t) {
  const d = tr(), pulso = d?.pulso || 65, fr = d?.fr || 13;
  if (grupos.corazon) { const f = (t * pulso / 60) % 1, s = 1 + .03 * Math.exp(-f * 9) - .008 * Math.exp(-((f - .35) ** 2) * 60); pivote(grupos.corazon, centros.corazon, s, s, s); }
  if (grupos.pulmones) { const b = .5 - .5 * Math.cos(t * fr / 60 * 2 * Math.PI); pivote(grupos.pulmones, centros.pulmones.clone().setX(0), 1 + .01 * b, 1 + .012 * b, 1 + .02 * b); }
  for (const g in grupos) {
    if (g !== 'corazon' && g !== 'pulmones') grupos[g].matrix.identity();
    const u = grupos[g].userData.mat.uniforms, n = GRUPOS[g].dato(d).nivel, col = NIVEL_COL[n];
    u.ka.value = col ? .55 + .25 * Math.sin(t * 4) : 0; if (col) u.alerta.value.set(col);
    u.brillo.value = ESTILO === 'clinico' ? (foco && foco !== g ? .85 : 1) : foco === g ? 1.5 : foco ? .75 : 1;
    if (capas.has('rcp')) u.brillo.value = g === 'corazon' || g === 'esqueleto' ? 1.15 : .5;
    else if (proc) u.brillo.value = .6;
  }
  const relevantes = capas.has('rcp') ? ['corazon'] : proc ? (ORGANO_PROTOCOLO[proc.p.id] || []) : [];
  const S = SISTEMAS[sistema], holoSis = ESTILO === 'holo' && capas.has('organos') && !proc && !capas.has('rcp');
  const verHuesos = capas.has('esqueleto') || capas.has('rcp') || (holoSis && sistema === 'oseo');
  for (const g of Object.keys(grupos)) if (ES_HUESO(g)) grupos[g].visible = verHuesos && (g === 'esqueleto' || (g === 'craneo' ? !capas.has('rcp') : (uniComun.tresD.value > .5 && huesos.seg[g]?.vis && !capas.has('rcp'))));
  for (const g of Object.keys(grupos)) if (!ES_HUESO(g)) grupos[g].visible = (g !== 'cerebro' || (holoSis && sistema === 'neuro')) && (capas.has('organos') || relevantes.includes(g));
  if (ESTILO === 'holo') for (const g of Object.keys(grupos)) {
    // the chosen system in its own color and bright; everything else a faint cyan ghost
    const u = grupos[g].userData.mat.uniforms, en = holoSis ? S.grupos.includes(g) : relevantes.includes(g) || !proc;
    u.c.value.set(en ? (holoSis ? S.col : (GRUPOS[g].col)) : '#8fe6f5');
    if (holoSis) u.brillo.value = en ? 1.6 : (ES_HUESO(g) ? .45 : .38);
  }
  if (!capas.has('organos') && grupos.esqueleto && capas.has('rcp') && !capas.has('esqueleto')) grupos.esqueleto.userData.mat.uniforms.brillo.value = .45;
  uniComun.t.value = t;
  const s = tBarrido < 0 ? 1 : (t - tBarrido) / 1.4;   // sweep from above the head (1.8 m) to below the pelvis in 1.4 s
  uniComun.barrido.value = s >= 1 ? -1 : 1.8 - s * 1.0;
}

function cuadro(ahora) {
  requestAnimationFrame(cuadro);
  if (video.readyState < 2) return;
  const t = ahora / 1000, dt = tAnt ? Math.min(.1, t - tAnt) : 1 / 30; tAnt = t;
  fps += ((1 / Math.max(dt, 1e-3)) - fps) * .05;
  const { W, H } = tamanos(), k = kCss, { sx, sy, sw, sh } = recorte;

  // vision: this frame to the ship; if the ship is not answering, see it here
  const macVivo = vis.listoMac && ahora - vis.tUlt < 2500;
  if (vis.listoMac) enviarMac();
  if (!macVivo && ahora - vis.tConexion > 2500) {
    if (!vis.local) cargarLocal().catch(() => {});
    else if (localListo) visionLocal(localListo, ahora);
  }

  const conOjos = sistema === 'ojos';
  if (conOjos) { if (!ojos.modelo) cargarOjos().catch(() => {}); else medirOjos(video, ahora, HFOV); }
  const o = observar(ahora);
  const nuevo = o ? (P.has('plano') ? null : calzar3D(o, W, H)) || calzar(o, W, H) : null;
  if (nuevo) { ajuste = nuevo; tAjuste = t; } else if (ajuste && t - tAjuste > .7) { ajuste = null; huesos.suave = null; pacPrev = null; }
  if (ajuste && !hayAntes) barrer(t);
  hayAntes = !!ajuste;
  const gA = gravedadActiva(), reg = regimen(gA.g);
  medirDeriva(ajuste, t);
  contar(t, ajuste, W, H);

  const espejar = cx => { if (frente) { cx.translate(W, 0); cx.scale(-1, 1); } };
  ocupados = [];
  // the top rows of the HUD are reserved before anything else is placed
  reservar(0, 0, W, 122 * k);
  mctx.save(); espejar(mctx); mctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H); mctx.restore();
  // a light scrim over the camera: the overlay and its text read on any room, bright or dark
  mctx.fillStyle = ESTILO === 'rx' ? 'rgba(4,10,18,.42)' : ESTILO === 'clinico' ? 'rgba(4,10,18,.12)' : 'rgba(4,10,18,.26)'; mctx.fillRect(0, 0, W, H);
  if (ajuste && listo3d && !conOjos) {
    let camara = cam;
    if (ajuste.tresD) {
      cuerpo.matrix.identity(); cabeza.matrix.identity(); uniComun.tresD.value = 1;
      const { vw, vh } = recorte;
      camP.fov = 2 * Math.atan((vh / 2) / ajuste.f) * 180 / Math.PI; camP.aspect = vw / vh; camP.near = .05; camP.far = 30;
      camP.setViewOffset(vw, vh, sx, sy, sw, sh); camP.updateProjectionMatrix();
      camara = camP;
    } else { cuerpo.matrix.copy(ajuste.M); cabeza.matrix.copy(ajuste.C); uniComun.tresD.value = 0; }
    cuerpo.matrixWorldNeedsUpdate = cabeza.matrixWorldNeedsUpdate = true;
    animar(t);
    ren.render(esc, camara);
    const v = capas.has('organos') && ESTILO !== 'holo' ? ventana(ajuste, W, H, k) : null;
    mctx.save(); espejar(mctx);
    if (v) { // look into the body: the torso goes dark inside the window, the organs sit in it, cut by the silhouette
      cavidad(v, W, H); mctx.drawImage(capaCav, 0, 0);
      recortar(ren.domElement, v, W, H); mctx.drawImage(capaOrg, 0, 0);
    } else {
      const sil = siluetaSola(W, H), fuente = sil ? (recortar(ren.domElement, sil, W, H), capaOrg) : ren.domElement;
      if (ESTILO === 'holo' && sil && capas.has('organos')) { // a cool dark veil inside the person: light needs contrast to read
        tamCapa(capaCav, W, H); cvctx.globalCompositeOperation = 'source-over'; cvctx.clearRect(0, 0, W, H);
        cvctx.fillStyle = 'rgba(2,10,18,.5)'; cvctx.fillRect(0, 0, W, H);
        cvctx.globalCompositeOperation = 'destination-in'; cvctx.drawImage(sil, 0, 0); cvctx.globalCompositeOperation = 'source-over';
        mctx.drawImage(capaCav, 0, 0);
      }
      if (ESTILO === 'holo') { // light: a soft glow under the hologram, added, never painted over the person
        bctx.clearRect(0, 0, brillo.width, brillo.height); bctx.filter = 'blur(5px)'; bctx.drawImage(fuente, 0, 0, brillo.width, brillo.height); bctx.filter = 'none';
        mctx.globalCompositeOperation = 'lighter'; mctx.globalAlpha = .65; mctx.drawImage(brillo, 0, 0, W, H); mctx.globalAlpha = 1;
        mctx.drawImage(fuente, 0, 0, W, H); mctx.globalCompositeOperation = 'source-over';
      } else mctx.drawImage(fuente, 0, 0, W, H);
    }
    mctx.restore();
    ocluirManos(mctx, W, H, k);
    const aj = frente ? espejo(ajuste) : ajuste;
    if (uniComun.barrido.value > 0) {
      const y = uniComun.barrido.value, a = aPantalla(new THREE.Vector3(-.3, y, 0), aj.M, W, H), b = aPantalla(new THREE.Vector3(.3, y, 0), aj.M, W, H);
      const g = mctx.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, 'rgba(200,250,255,0)'); g.addColorStop(.5, 'rgba(220,250,255,.8)'); g.addColorStop(1, 'rgba(200,250,255,0)');
      mctx.strokeStyle = g; mctx.lineWidth = 1.2 * k; mctx.beginPath(); mctx.moveTo(a.x, a.y); mctx.lineTo(b.x, b.y); mctx.stroke();
    }
    if (ESTILO === 'holo' && capas.has('organos') && !proc && !capas.has('rcp')) panelSistema(mctx, aj, W, H, k, t); else rotulos(mctx, aj, W, H, k);
    ultimoObs = o; pasoAR(mctx, aj, o, W, H, k, t, dt);
    pintarQcpr(t, dt, aj);
    if (capas.has('rcp')) rcpFino(mctx, aj, W, H, k, t, reg);
    if (reg === 'micro' && (capas.has('rcp') || proc) && (!giro.hay || calGiro.x || calGiro.y)) trayectoria(mctx, aj, W, H, k);
    refrescarNova(t); novaHabla = typeof vozSonando !== 'undefined' && vozSonando ? .5 + .5 * Math.sin(t * 18) : 0;
    coach(reg, t);
  } else { foco = null; pintarQcpr(t, dt, null); }
  if (conOjos) {
    pintarOjos(mctx, { W, H, k, t, recorte, frente, texto });
    pintarFijacion(mctx, { W, k, t, texto, frente });
    if (ojos.revision && ahora - ojos.revision.t0 >= 20000) terminarRevision(BASE, TOKEN).then(mostrarRevision);
  }
  hudFino(mctx, W, H, k, t, !!ajuste, reg, gA);

  mostrar();
  enviarEstacion(t, reg);
}

/* Nova speaks when something changes: the procedure for this gravity, a drifting patient, a rate out of range */
let ultimoCoach = '', tCoach = -99;
function coach(reg, t) {
  if (!capas.has('rcp') || (proc && proc.ar.modo !== 'rcp')) return;
  const gr = guiaRcp(reg);
  let msg = reg === 'micro' ? (deriva.v > .12 && (!giro.hay || calGiro.x || calGiro.y) ? 'The patient is drifting. Hold them with your legs or strap them before you compress.'
    : `Microgravity. ${gr.tec}. ${gr.pasos[1]}. ${gr.pasos[2]}.`)
    : reg === 'marte' ? 'Mars gravity. Your weight is not enough here. Straddle them and push with your arms and shoulders. Swap often.'
    : 'Center of the chest, lower half of the sternum. Push hard and fast, 100 to 120 a minute.';
  const rt = ritmo(t); if (rt && rt < 95) msg = 'Faster. Aim for 100 to 120 a minute.'; else if (rt && rt > 125) msg = 'A bit slower. 100 to 120 a minute.';
  if (msg !== ultimoCoach && t - tCoach > 4) { ultimoCoach = msg; tCoach = t; decir(msg); }
}

function cubrir(c, src, x, y, w, h) {
  const s = Math.max(w / src.width, h / src.height), sw = w / s, sh = h / s;
  c.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, x, y, w, h);
}
function mostrar() {
  const w = pantalla.width, h = pantalla.height;
  pctx.fillStyle = '#000'; pctx.fillRect(0, 0, w, h);
  if (!visor) { cubrir(pctx, mono, 0, 0, w, h); return; }
  const ojo = w / 2, m = Math.round(Math.min(ojo, h) * .04);
  for (let i = 0; i < 2; i++) {
    pctx.save(); pctx.beginPath(); pctx.roundRect(i * ojo + m, m, ojo - 2 * m, h - 2 * m, Math.min(ojo, h) * .12); pctx.clip();
    cubrir(pctx, mono, i * ojo + m, m, ojo - 2 * m, h - 2 * m); pctx.restore();
  }
  pctx.fillStyle = '#000'; pctx.fillRect(w / 2 - 1, 0, 2, h);
}

/* ── live to NOVA Station ── */
const envio = document.createElement('canvas'), ectx = envio.getContext('2d');
let enviando = false, tEnvio = 0, ultimoEnvioOk = 0;
async function enviarEstacion(t, reg) {
  if (P.has('nosend')) return; // tests never reach the station
  if (enviando || t - tEnvio < .08) return;
  tEnvio = t; enviando = true;
  try {
    const f = Math.min(1, 960 / Math.max(mono.width, mono.height)), ancho = Math.round(mono.width * f), alto = Math.round(mono.height * f);
    if (envio.width !== ancho || envio.height !== alto) { envio.width = ancho; envio.height = alto; }
    ectx.drawImage(mono, 0, 0, ancho, alto);
    const b64 = envio.toDataURL('image/jpeg', .6).split(',')[1];
    const cm = CREW[tripI] || {}, mac = fuenteObs === 'mac' && performance.now() - vis.tUlt < 800, rt = ritmo(t);
    const res = await fetch(BASE + '/v1/escaner/cuadro', { method: 'POST', headers: { 'content-type': 'application/json', ...(TOKEN ? { 'x-nova-token': TOKEN } : {}) },
      body: JSON.stringify({ disp: DISP, trip: cm.id, nombre: cm.nombre, modo: visor ? 'visor' : 'mano', origen: MOVIL ? 'movil' : 'pantalla', foco: capas.has('rcp') ? 'CPR point' : foco ? GRUPOS[foco].n : null,
        cuerpo: !!ajuste, capas: [...capas], fps: Math.round(fps), vision: mac ? { donde: 'ship', ms: Math.round(vis.rtt), gpu: vis.gpu } : { donde: localListo ? 'phone' : 'none' },
        gravedad: { regimen: reg, medida: grav.med, fuente: gravedadActiva().de }, rcp: capas.has('rcp') ? { tecnica: guiaRcp(reg).tec, ritmo: rt ? Math.round(rt) : null, cuenta: comp.cuenta, deriva: Math.round(deriva.v * 100) } : null,
        proc: proc ? { id: proc.p.id, titulo: proc.p.titulo, paso: proc.texto(proc.paso?.texto), tipo: proc.paso?.tipo, restante: proc.restante(),
          botones: botonesProc(), herida: proc.herida === null && !!proc.ar.herida } : null,
        ctl: estadoControl(reg),
        intervenciones: intervenciones.slice(-8),
        ancho, alto, jpg: b64 }) });
    if (res.ok) {
      ultimoEnvioOk = Date.now();
      const r = await res.json().catch(() => null);
      for (const o of r?.ordenes || []) { try { ejecutar(o); } catch (e) { console.warn('[nova] orden', o, e); } }
    }
  } catch {} finally { enviando = false; }
}

/* ── controls ── */
const NOMBRE_G = { auto: 'Gravity: mission', tierra: 'Gravity: Earth', marte: 'Gravity: Mars', micro: 'Gravity: 0 g' };
const NOMBRE_T = { er: 'Evetts-Russomano', rbh: 'Reverse bear hug', hs: 'Handstand', sujeto: 'Restrained' };
const CORTO_G = { auto: 'g: mission', tierra: '1 g', marte: '0.38 g', micro: '0 g' };
const CORTO_T = { er: 'ER', rbh: 'Bear hug', hs: 'Handstand', sujeto: 'Strapped' };
function pintarBarra() {
  const corto = innerWidth < 620;
  $('bGrav').textContent = corto ? CORTO_G[modoG] : NOMBRE_G[modoG];
  const micro = regimen(gravedadActiva().g) === 'micro';
  $('bTec').hidden = !(micro && capas.has('rcp')); $('bTec').textContent = corto ? CORTO_T[tecnica] : NOMBRE_T[tecnica];
  $('bTrip').textContent = (CREW[tripI] || {}).corto || 'Crew';
}
addEventListener('resize', () => pintarBarra());
/* every control lives here once: the phone's own buttons and NOVA Station's orders (the phone may be inside a headset,
   out of reach) both go through ejecutar(), and the phone reports its state back in every frame (estadoControl) */
function sincronizarBotones() {
  document.querySelectorAll('[data-capa]').forEach(x => x.classList.toggle('on', capas.has(x.dataset.capa)));
  document.querySelectorAll('[data-sis]').forEach(x => x.classList.toggle('on', x.dataset.sis === sistema));
  $('bOjo').hidden = sistema !== 'ojos';
  document.querySelectorAll('[data-trip]').forEach((x, i) => x.classList.toggle('on', i === tripI));
  $('bVisor').classList.toggle('on', visor);
}
function botonesProc() {
  const s = proc?.paso; if (!s) return [];
  return s.tipo === 'pregunta' ? [['si', 'Yes'], ['no', 'No']] : s.tipo === 'accion' ? [['hecho', 'Done']]
    : s.tipo === 'espera' ? [['mejor', 'Better now'], ['peor', 'Not better']] : [['cerrar', 'Finish']];
}
function responderProc(r) {
  if (!proc) return;
  if (r === 'cerrar') cerrarProtocolo(); else if (r === 'mejor' || r === 'peor') proc.cerrarEspera(r, tr()); else proc.responder(r);
  if (proc && proc.fin) registrar('fin', proc.texto(proc.paso.texto));
  pintarProc();
}
const reiniciarCoach = () => { ultimoCoach = ''; tCoach = -99; };
function elegirTrip(i) {
  if (!CREW.length) return;
  tripI = ((i % CREW.length) + CREW.length) % CREW.length;
  for (let k = 0; k < CREW.length && CREW[tripI]?.vacio; k++) tripI = (tripI + 1) % CREW.length; // saltar asientos vacíos
  medidas.n = 0; medidas.nt = 0; arribaSuave = null; barrer(performance.now() / 1000);
}
function ejecutar(o) {
  switch (o.tipo) {
    case 'trip': { const i = o.id != null ? CREW.findIndex(x => x.id === o.id) : +o.i; if (i >= 0) elegirTrip(i); break; }
    case 'sistema': if (SISTEMAS[o.v]) { sistema = o.v; capas.add('organos'); tHist = 0; barrer(performance.now() / 1000); } break;
    case 'capa': if (['organos', 'esqueleto', 'rcp'].includes(o.v)) { const on = o.on ?? !capas.has(o.v); on ? capas.add(o.v) : capas.delete(o.v); reiniciarCoach(); } break;
    case 'g': if (['auto', 'tierra', 'marte', 'micro'].includes(o.v)) { modoG = o.v; reiniciarCoach(); } break;
    case 'tecnica': if (TECNICAS.includes(o.v)) { tecnica = o.v; reiniciarCoach(); } break;
    case 'estilo': cambiarEstilo(o.v); break;
    case 'giro': USAR_GIRO = !!o.on; giro.hay = USAR_GIRO && giro.hist.length > 0; break;
    case 'fov': { const v = Math.max(40, Math.min(110, +o.v || 0)); if (v) HFOV = v * Math.PI / 180; break; }
    case 'girar': if (o.frente == null || !!o.frente !== frente) { frente = !frente; for (const k in pistas) delete pistas[k]; iniciarCamara().catch(() => {}); } break;
    case 'visor': entrarVisor(o.on ?? !visor); break;
    case 'abrir': if (PROTOCOLOS.some(p => p.id === o.id)) abrirProtocolo(o.id); break;
    case 'responder': responderProc(o.r); break;
    case 'cerrar': cerrarProtocolo(); break;
    case 'herida': if (proc && isFinite(o.x) && isFinite(o.y)) marcarHerida(o.x * mono.width, o.y * mono.height); break;
    case 'repetir': if (proc?.paso) decir(proc.texto(proc.paso.texto)); break;
  }
  sincronizarBotones(); pintarBarra();
}
function estadoControl(reg) {
  return { trip: (CREW[tripI] || {}).id || null, sistema, capas: [...capas], g: modoG, regimen: reg, tecnica, verTecnica: reg === 'micro' && capas.has('rcp'),
    visor, frente, estilo: ESTILO, giro: USAR_GIRO, hayGiro: giro.hist.length > 0, fov: Math.round(HFOV * 180 / Math.PI), sugerido,
    protocolos: PROTOCOLOS.map(p => ({ id: p.id, titulo: p.titulo })) };
}
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'bEmer') { $('hoja').innerHTML = `<div class="hcab">Medical procedures<button data-r="hoja">×</button></div>` + PROTOCOLOS.map(p => `<button class="hp" data-abrir="${p.id}"><b>${p.titulo}</b><span>${p.cuando || ''}</span></button>`).join(''); $('hoja').hidden = false; }
  if (b.dataset.r === 'hoja') $('hoja').hidden = true;
  if (b.dataset.abrir) return ejecutar({ tipo: 'abrir', id: b.dataset.abrir });
  if (b.dataset.r && proc && b.closest('#proc')) return ejecutar({ tipo: 'responder', r: b.dataset.r });
  if (b.dataset.sis) return ejecutar({ tipo: 'sistema', v: b.dataset.sis });
  if (b.id === 'bTrip') return ejecutar({ tipo: 'trip', i: tripI + 1 });
  if (b.dataset.trip != null) return ejecutar({ tipo: 'trip', i: +b.dataset.trip });
  if (b.dataset.capa) return ejecutar({ tipo: 'capa', v: b.dataset.capa });
  if (b.id === 'bGrav') { const l = ['auto', 'tierra', 'marte', 'micro']; return ejecutar({ tipo: 'g', v: l[(l.indexOf(modoG) + 1) % l.length] }); }
  if (b.id === 'bTec') return ejecutar({ tipo: 'tecnica', v: TECNICAS[(TECNICAS.indexOf(tecnica) + 1) % TECNICAS.length] });
  if (b.id === 'bGirar') return ejecutar({ tipo: 'girar' });
  if (b.id === 'bVisor') return ejecutar({ tipo: 'visor' });
  pintarBarra();
});
pantalla.addEventListener('click', e => {
  const r = pantalla.getBoundingClientRect(), W = mono.width, H = mono.height;
  // screen → picture (the picture covers the screen, cropped to fit)
  const s2 = Math.max(r.width / W, r.height / H), x = (e.clientX - r.left - (r.width - W * s2) / 2) / s2, y = (e.clientY - r.top - (r.height - H * s2) / 2) / s2;
  if (!visor && marcarHerida(x, y)) return;
  if (visor) $('barra').hidden = !$('barra').hidden;
});
async function entrarVisor(on) {
  visor = on; $('bVisor').classList.toggle('on', on);
  document.body.classList.toggle('visor', on);
  if (on) {
    $('barra').hidden = true;
    try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch {}
    try { await screen.orientation.lock('landscape'); } catch {}
  } else {
    $('barra').hidden = false;
    try { screen.orientation.unlock(); } catch {}
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch {}
  }
}
async function despierto() { try { await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') despierto(); });

/* ── start ── */
function orbe(t) {
  if (typeof mascotaOrbes === 'function' && $('nova') && !$('inicio').hidden)
    $('nova').innerHTML = mascotaOrbes({ x: 60, y: 50, R: 26, t, expr: 'pensativa', orbes: 4, habla: 0, parpadeo: (t % 3.7) < .13 ? 1 : 0, mira: [.2, .1] });
  if (!$('inicio').hidden) requestAnimationFrame(x => orbe(x / 1000));
}
async function empezar(conVisor) {
  const est = $('estadoIni'); est.classList.remove('err');
  $('bEmpezar').disabled = $('bEmpezarVisor').disabled = true;
  try {
    try { if (typeof DeviceMotionEvent?.requestPermission === 'function') await DeviceMotionEvent.requestPermission(); } catch {}
    est.textContent = 'Opening the camera…';
    await iniciarCamara();
    if (conVisor) await entrarVisor(true);
    vis.tConexion = performance.now(); conectarMac();
    $('inicio').hidden = true; if (!conVisor) $('barra').hidden = false;
    document.querySelectorAll('[data-capa]').forEach(b => b.classList.toggle('on', capas.has(b.dataset.capa)));
    document.querySelectorAll('[data-sis]').forEach(b => b.classList.toggle('on', b.dataset.sis === sistema));
    $('bOjo').hidden = sistema !== 'ojos';
    pintarBarra(); despierto();
    requestAnimationFrame(cuadro);
    await cargarAnatomia();
  } catch (e) {
    est.classList.add('err'); est.textContent = e.message || String(e);
    $('bEmpezar').disabled = $('bEmpezarVisor').disabled = false;
  }
}
$('bEmpezar').onclick = () => empezar(false);
$('bEmpezarVisor').onclick = () => empezar(true);

montar3d();
await cargarCrew();
leerEstado(); setInterval(leerEstado, 1000);
leerMision(); setInterval(() => { leerMision(); pintarBarra(); }, 30000);
await cargarProtocolos();
if (P.get('protocolo')) { const id = P.get('protocolo'), paso = P.get('paso'); const abrir = () => listo3d ? abrirProtocolo(id, paso) : setTimeout(abrir, 300); setTimeout(abrir, 600); }
await document.fonts.ready.catch(() => {});
requestAnimationFrame(x => orbe(x / 1000));
if (P.has('auto')) empezar(P.has('visor'));
window.__escaner = { get sonda() { return sonda; }, video, capaVen, capaCav, capaOrg, get ajuste() { return ajuste; }, get foco() { return foco; }, get fps() { return fps; },
  get vision() { return { fuente: fuenteObs, rtt: Math.round(vis.rtt), ms: Math.round(vis.ms), listoMac: vis.listoMac, local: !!localListo, cod: modoCod, msCod: Math.round(msCod) }; },
  get gravedad() { return { ...gravedadActiva(), med: grav.med }; }, get deriva() { return deriva.v; }, get comp() { return { cuenta: comp.cuenta, manos: comp.manos }; }, capas, grupos, get listo() { return listo3d; } };

/* ── Eyes: revisión guiada de 20 s y su resultado (ojos.mjs) ── */
$('bOjo').addEventListener('click', () => {
  if (ojos.revision) return;
  const c = CREW[tripI]; if (!c) return;
  $('hoja').hidden = true;
  empezarRevision(c.id, frente ? 'frontal' : 'trasera');
  decir(frente ? 'Look at the red dot and keep your head still for twenty seconds.' : 'Hold the phone steady. Ask them to look at the camera for twenty seconds.');
});
function mostrarRevision(r) {
  if (!r) return;
  const h = $('hoja'), c = CREW[tripI] || {};
  if (r.error) { h.innerHTML = `<div class="ojres"><b>Eye check · ${c.corto || ''}</b><p>${r.error}</p><button class="b" data-cerrar-ojos>Close</button></div>`; h.hidden = false; decir(r.error); return; }
  const mm = v => v == null ? '—' : v.toFixed(1);
  const filas = r.filas.map(f => `<tr class="${f.fuera ? 'fuera' : ''}"><td>${f.n}<small>${f.ojo}</small></td><td>${mm(f.mm)}</td><td>${f.base == null ? '—' : mm(f.base)}</td><td>${f.dif == null ? '—' : (f.dif > 0 ? '+' : '') + mm(f.dif)}</td></tr>`).join('');
  const estado = r.previas < 3 ? `Building ${c.corto || 'their'}'s baseline: ${r.previas + 1} of 3 checks with this camera. Comparisons start at 3; the method recommends 7 days.`
    : r.seguimiento ? 'A change larger than this camera can tell apart from noise. Follow-up suggested: repeat tomorrow and log a near-vision chart. This is not a diagnosis.'
    : 'Within the usual range for this person and this camera.';
  h.innerHTML = `<div class="ojres"><b>Eye check · ${c.corto || ''}</b><span>${r.rec.camara === 'frontal' ? 'front camera' : 'back camera'} · ${Math.round(r.rec.quietud * 100)}% steady · ${r.rec.parpadeos_min ?? '—'} blinks/min · ${Math.round(r.rec.dist_cm)} cm</span>
    <p class="${r.seguimiento ? 'aviso' : ''}">${estado}</p>
    ${r.rec.alerta ? `<p class="${r.rec.alerta === 'alerta' ? '' : 'aviso'}">Alertness: <b>${{ alerta: 'alert', algo: 'some signs of tiredness', cansado: 'tired' }[r.rec.alerta]}</b> · eyes closed ${r.rec.perclos}% of the last minute (PERCLOS)${r.rec.dur_parpadeo_ms ? ` · blinks ${r.rec.dur_parpadeo_ms} ms` : ''}${r.rec.bostezos ? ` · ${r.rec.bostezos} yawns` : ''}. ${r.rec.alerta === 'cansado' ? 'Consider rest before a critical task.' : ''}</p>` : ''}
    <table><tr><th>mm (est.)</th><th>now</th><th>usual</th><th>change</th></tr>${filas}</table>
    <small>mm assume an 11.7 mm iris. A change counts only if it is bigger than the smallest change this method can detect (MDC95, measured by N. Richardson): opening ${(0.155 * 11.7).toFixed(1)} mm, upper lid ${(0.101 * 11.7).toFixed(1)} mm, lower lid ${(0.073 * 11.7).toFixed(1)} mm.${r.guardada ? ' Saved to the ship.' : ' Could not reach the ship: not saved.'}</small>
    <button class="b" data-cerrar-ojos>Close</button></div>`;
  h.hidden = false;
  decir(r.previas < 3 ? 'Eye check saved. I need a few more to learn what is usual for you.' : r.seguimiento ? 'Eye check saved. Something changed more than usual. Repeat it tomorrow.' : 'Eye check saved. Everything within your usual range.');
}
document.addEventListener('click', e => { if (e.target.closest('[data-cerrar-ojos]')) $('hoja').hidden = true; });
