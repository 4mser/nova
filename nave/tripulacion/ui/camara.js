/* Cámara extra del gemelo: MediaPipe Pose corre en este teléfono y manda a la nave solo los 33 puntos de mundo (metros,
   centrados en la cadera) con su visibilidad, hasta 20 veces por segundo. Si un envío sigue en camino se salta el
   cuadro, así la red nunca se atrasa. */
import { FilesetResolver, PoseLandmarker } from './lib/mediapipe/vision_bundle.mjs';

const P = new URLSearchParams(location.search);
const TOKEN = P.get('token') || '';
const $ = id => document.getElementById(id);
let CAM = ''; try { CAM = localStorage.getItem('novaCam') || ''; } catch {}
if (!CAM) { CAM = 'tel-' + Math.random().toString(36).slice(2, 8); try { localStorage.setItem('novaCam', CAM); } catch {} }
const NOMBRE = P.get('nombre') || (/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'Camera') + ' ' + CAM.slice(-3);

let pose = null, frente = false, corriendo = false, enCamino = false, ultEnvio = 0, tUlt = -1, enviados = 0, tCuenta = performance.now(), fps = 0, persona = false;
const v = $('v'), cv = $('c'), cx = cv.getContext('2d');
const HUESOS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];

// cada intento tiene plazo: en algunos teléfonos el modo GPU de MediaPipe se queda colgado sin error
const conPlazo = (pr, ms) => Promise.race([pr, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
async function cargarModelo(aviso) {
  aviso('Loading the body model…');
  const fs = await conPlazo(FilesetResolver.forVisionTasks('lib/mediapipe/wasm'), 30000);
  const movil = /Android|iPhone|iPad/.test(navigator.userAgent);
  const intentos = movil ? [['lite', 'GPU', 15000], ['full', 'CPU', 40000], ['lite', 'CPU', 30000]] : [['full', 'GPU', 15000], ['lite', 'CPU', 30000]];
  for (const [modelo, delegate, ms] of intentos) {
    aviso(`Loading the body model (${modelo}, ${delegate === 'GPU' ? 'graphics chip' : 'processor'})…`);
    try {
      return await conPlazo(PoseLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: `lib/mediapipe/modelos/pose_landmarker_${modelo}.task`, delegate },
        runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: .5, minTrackingConfidence: .5 }), ms);
    } catch (e) { console.warn('[camara]', modelo, delegate, e); }
  }
  throw new Error('the body model did not load on this phone');
}
async function abrirCamara() {
  if (v.srcObject) v.srcObject.getTracks().forEach(t => t.stop());
  v.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: frente ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  v.style.transform = cv.style.transform = frente ? 'scaleX(-1)' : '';
  await v.play();
}
function estado(t, s) { $('estado').innerHTML = `<b>${t}</b>${s}`; }

function enviar(w) {
  const ahora = performance.now();
  if (enCamino || ahora - ultEnvio < 50) return;
  enCamino = true; ultEnvio = ahora;
  fetch('/v1/espejo/vista', { method: 'POST', headers: { 'content-type': 'application/json', ...(TOKEN ? { 'x-nova-token': TOKEN } : {}) },
    body: JSON.stringify({ cam: CAM, nombre: NOMBRE, w }) })
    .then(r => { if (r.ok) enviados++; else estado('The ship refused the camera', r.status === 401 ? 'Open the link with the ship token.' : `Error ${r.status}`); })
    .catch(() => estado('No link to the ship', 'Check that the phone is on the same network.'))
    .finally(() => { enCamino = false; });
}

function dibujar(n) {
  const W = cv.width = innerWidth * devicePixelRatio, H = cv.height = innerHeight * devicePixelRatio;
  cx.clearRect(0, 0, W, H); if (!n) return;
  // el video va con object-fit: cover; los puntos se llevan a la misma escala
  const vw = v.videoWidth, vh = v.videoHeight, k = Math.max(W / vw, H / vh), ox = (W - vw * k) / 2, oy = (H - vh * k) / 2;
  const pt = i => [ox + n[i].x * vw * k, oy + n[i].y * vh * k];
  cx.lineWidth = 3 * devicePixelRatio; cx.strokeStyle = 'rgba(143,230,245,.85)'; cx.fillStyle = '#8fe6f5';
  for (const [a, b] of HUESOS) { if ((n[a].visibility ?? 1) < .5 || (n[b].visibility ?? 1) < .5) continue; const [x1, y1] = pt(a), [x2, y2] = pt(b); cx.beginPath(); cx.moveTo(x1, y1); cx.lineTo(x2, y2); cx.stroke(); }
  for (let i = 11; i < 33; i++) { if ((n[i].visibility ?? 1) < .5) continue; const [x, y] = pt(i); cx.beginPath(); cx.arc(x, y, 4 * devicePixelRatio, 0, 7); cx.fill(); }
}

function cuadro() {
  if (!corriendo) return;
  if (v.readyState >= 2 && v.currentTime !== tUlt) {
    tUlt = v.currentTime;
    const r = pose.detectForVideo(v, performance.now());
    const w = r.worldLandmarks && r.worldLandmarks[0], n = r.landmarks && r.landmarks[0];
    persona = !!w;
    dibujar(n);
    // la visibilidad viene en los puntos de imagen; en el teléfono la vista no se refleja (la nave hace el espejo)
    const dentro = q => q.x > .01 && q.x < .99 && q.y > .01 && q.y < .99;   // lo que queda fuera del cuadro es inventado
    // cada punto: [x, y, z del mundo, visibilidad, u, v de la imagen (0–1, sin reflejar)]; el primero lleva además el ancho
    // y el alto del video, para que la nave encuadre el gemelo igual que esta cámara
    enviar(w ? w.map((p, i) => {
      const q = [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4), dentro(n[i]) ? +(n[i].visibility ?? 1).toFixed(2) : 0, +n[i].x.toFixed(4), +n[i].y.toFixed(4)];
      if (i === 0) q.push(v.videoWidth, v.videoHeight);
      return q;
    }) : []);
  }
  const t = performance.now();
  if (t - tCuenta > 1000) {
    fps = Math.round(enviados * 1000 / (t - tCuenta)); enviados = 0; tCuenta = t;
    estado(persona ? `${NOMBRE} · sending to NOVA` : 'Looking for a person…', `${fps} updates/s · only body points leave this phone`);
  }
  requestAnimationFrame(cuadro);
}

$('empezar').onclick = async () => {
  const b = $('empezar'), txt = $('inicio').querySelector('p');
  b.disabled = true; b.textContent = 'Opening camera…';
  try {
    // la cámara primero, dentro del toque (iOS la pide con un gesto); el modelo después
    await abrirCamara();
    $('inicio').hidden = true; $('barra').hidden = false;
    pose = pose || await cargarModelo(t => estado(t, 'This happens once; then it runs on the phone.'));
    corriendo = true;
    try { await navigator.wakeLock?.request('screen'); } catch {}
    requestAnimationFrame(cuadro);
  } catch (e) {
    $('barra').hidden = true; $('inicio').hidden = false;
    b.disabled = false; b.textContent = 'Try again';
    txt.textContent = 'Could not start: ' + (e.message || e) + '. On a phone this page needs the secure link (https) and camera permission.';
  }
};
$('voltear').onclick = async () => { frente = !frente; try { await abrirCamara(); } catch {} };
$('parar').onclick = () => {
  corriendo = false; if (v.srcObject) v.srcObject.getTracks().forEach(t => t.stop());
  fetch('/v1/espejo/vista', { method: 'POST', headers: { 'content-type': 'application/json', ...(TOKEN ? { 'x-nova-token': TOKEN } : {}) }, body: JSON.stringify({ cam: CAM, nombre: NOMBRE, w: [] }) }).catch(() => {});
  $('barra').hidden = true; $('inicio').hidden = false; $('empezar').disabled = false; $('empezar').textContent = 'Start camera';
};
