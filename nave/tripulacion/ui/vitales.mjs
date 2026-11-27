/* NOVA 2 · Vitals by camera.

   Heart rate from the skin's color (remote photoplethysmography): each heartbeat pushes blood into the skin and changes
   its color a tiny amount, invisible to the eye but measurable in the average of thousands of pixels. Nova finds the
   face with MediaPipe Face Landmarker (478 points), averages the forehead and both cheeks every frame, and runs the POS
   method (Wang, den Brinker, Stuijk, de Haan · IEEE TBME 2017): the RGB means are projected onto the plane orthogonal
   to the skin tone, which cancels most motion and lighting changes. The pulse is the strongest frequency between 42 and
   180 per minute over the last 10 s; its share of the signal's power is the confidence.

   Breathing from the chest: the shoulders rise and fall with each breath. Their height (normalized by shoulder width,
   so distance does not matter) over the last 30 s, strongest frequency between 6 and 40 per minute.

   Both need a still subject and decent light, and say so. They are estimates for triage, not a medical monitor. */
import { FilesetResolver, FaceLandmarker } from './lib/mediapipe/vision_bundle.mjs';

export const vit = { modelo: null, cargando: null, error: null, cara: null, tCara: 0, muestras: [], pos: [], bpm: null, conf: 0, hist: [], resp: null, confResp: 0, pecho: [], tCalc: 0, onda: [], ondaResp: [], desde: 0, tVideo: -1, tPecho: 0, excluir: null, tFace: 0 };

export function cargarVitales() {
  if (vit.cargando) return vit.cargando;
  vit.cargando = (async () => {
    try {
      const fs = await FilesetResolver.forVisionTasks('lib/mediapipe/wasm');
      for (const delegate of ['GPU', 'CPU']) {
        try { vit.modelo = await FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: 'lib/mediapipe/modelos/face_landmarker.task', delegate }, runningMode: 'VIDEO', numFaces: 1 }); break; }
        catch (e) { if (delegate === 'CPU') throw e; }
      }
    } catch (e) { vit.error = String(e); }
  })();
  return vit.cargando;
}

// skin patches: forehead and both cheeks (landmark indices of the canonical face mesh)
const FRENTE = [67, 109, 10, 338, 297, 299, 9, 69], MEJ_I = [116, 117, 118, 101, 36, 205, 187, 123], MEJ_D = [345, 346, 347, 330, 266, 425, 411, 352];
const chico = document.createElement('canvas'), cctx = chico.getContext('2d', { willReadFrequently: true });
let tsF = 0;

function dentro(px, py, pol) { let a = false; for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) { const [xi, yi] = pol[i], [xj, yj] = pol[j]; if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) a = !a; } return a; }

/** one camera frame: find the face, sample the skin, update pulse and breathing. hombros = {y, ancho} normalized, or null */
export function medirVitales(video, ahora, hombros, excluirHz = null) {
  vit.excluir = excluirHz;
  if (!vit.modelo || !video.videoWidth) return;
  // one sample per new camera frame (the display may run faster than the camera), at most ~30 per second
  if (video.currentTime === vit.tVideo || ahora - vit.tFace < 28) return;
  vit.tVideo = video.currentTime; vit.tFace = ahora;
  const vw = video.videoWidth, vh = video.videoHeight, k = 480 / Math.max(vw, vh), w = Math.round(vw * k), h = Math.round(vh * k);
  if (chico.width !== w || chico.height !== h) { chico.width = w; chico.height = h; }
  cctx.drawImage(video, 0, 0, w, h);
  tsF = Math.max(tsF + 1, Math.round(ahora));
  let r; try { r = vit.modelo.detectForVideo(chico, tsF); } catch { return; }
  const lm = r.faceLandmarks?.[0];
  if (lm) { vit.cara = lm; vit.tCara = ahora; }
  else if (ahora - vit.tCara > 500) { vit.cara = null; vit.muestras = []; vit.pos = []; vit.desde = 0; }
  if (vit.cara && ahora - vit.tCara < 200) {
    // mean RGB of the skin patches, in their bounding box only
    let R = 0, G = 0, B = 0, n = 0;
    for (const idx of [FRENTE, MEJ_I, MEJ_D]) {
      const pol = idx.map(i => [vit.cara[i].x * w, vit.cara[i].y * h]);
      const x0 = Math.max(0, Math.floor(Math.min(...pol.map(p => p[0])))), x1 = Math.min(w, Math.ceil(Math.max(...pol.map(p => p[0]))));
      const y0 = Math.max(0, Math.floor(Math.min(...pol.map(p => p[1])))), y1 = Math.min(h, Math.ceil(Math.max(...pol.map(p => p[1]))));
      if (x1 - x0 < 3 || y1 - y0 < 3) continue;
      const d = cctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      for (let y = 0; y < y1 - y0; y += 1) for (let x = 0; x < x1 - x0; x += 1) {
        if (!dentro(x0 + x + .5, y0 + y + .5, pol)) continue;
        const i = (y * (x1 - x0) + x) * 4; R += d[i]; G += d[i + 1]; B += d[i + 2]; n++;
      }
    }
    if (n > 50) {
      if (!vit.desde) vit.desde = ahora;
      vit.muestras.push([ahora / 1000, R / n, G / n, B / n]);
      while (vit.muestras.length && ahora / 1000 - vit.muestras[0][0] > 12) vit.muestras.shift();
    }
  }
  if (hombros) { vit.tPecho = ahora; vit.pecho.push([ahora / 1000, hombros.y / Math.max(.02, hombros.ancho)]); while (vit.pecho.length && ahora / 1000 - vit.pecho[0][0] > 32) vit.pecho.shift(); }
  else if (ahora - vit.tPecho > 1200) vit.pecho = []; // a short dropout keeps the history
  if (ahora - vit.tCalc > 400) { vit.tCalc = ahora; calcular(ahora / 1000); }
}

// resample (t, v) onto a uniform grid at fs Hz
function uniforme(serie, fs) {
  const t0 = serie[0][0], t1 = serie.at(-1)[0], n = Math.floor((t1 - t0) * fs), out = new Float64Array(n); let j = 0;
  for (let i = 0; i < n; i++) { const t = t0 + i / fs; while (j < serie.length - 2 && serie[j + 1][0] < t) j++; const [ta, va] = serie[j], [tb, vb] = serie[j + 1]; out[i] = va + (vb - va) * (tb > ta ? (t - ta) / (tb - ta) : 0); }
  return out;
}
function quitarTendencia(x, ventana) { // subtract a moving average: removes slow drift (lighting, posture)
  const n = x.length, y = new Float64Array(n), h = Math.max(1, Math.round(ventana / 2)), acc = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) acc[i + 1] = acc[i] + x[i];
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - h), b = Math.min(n, i + h + 1); y[i] = x[i] - (acc[b] - acc[a]) / (b - a); } // centered
  return y;
}
function espectro(x, fs, f0, f1, paso) { // power by frequency (Hann window, direct DFT over the band only)
  const n = x.length, out = [];
  for (let f = f0; f <= f1; f += paso) { let re = 0, im = 0; const w = 2 * Math.PI * f / fs; for (let i = 0; i < n; i++) { const h = .5 - .5 * Math.cos(2 * Math.PI * i / (n - 1)); re += x[i] * h * Math.cos(w * i); im -= x[i] * h * Math.sin(w * i); } out.push([f, re * re + im * im]); }
  return out;
}
function pico(esp, ancho, excluir = null) {
  // during CPR the compressions shake everything at their own rate: that frequency (and its double) is not a pulse
  if (excluir) esp = esp.map(([f, w]) => [f, Math.abs(f - excluir) < .15 || Math.abs(f - 2 * excluir) < .15 ? 0 : w]);
  let m = 0; esp.forEach((p, i) => { if (p[1] > esp[m][1]) m = i; });
  if (m < 3 || m > esp.length - 4) return { f: esp[m][0], conf: 0 }; // a peak at the band's edge is leftover drift, not a rhythm
  const tot = esp.reduce((s, p) => s + p[1], 0) || 1, f = esp[m][0];
  const cerca = esp.filter(p => Math.abs(p[0] - f) <= ancho || Math.abs(p[0] - 2 * f) <= ancho).reduce((s, p) => s + p[1], 0);
  // parabolic interpolation around the peak for a finer frequency
  let fr = f; if (m > 0 && m < esp.length - 1) { const a = esp[m - 1][1], b = esp[m][1], c = esp[m + 1][1], d = (a - c) / (2 * (a - 2 * b + c) || 1); fr = f + d * (esp[1][0] - esp[0][0]); }
  return { f: fr, conf: cerca / tot };
}

function calcular(t) {
  // pulse: POS on 1.6 s windows, overlap-added
  const M = vit.muestras;
  if (M.length > 60 && M.at(-1)[0] - M[0][0] > 6) {
    const fs = 30, n = (M.at(-1)[0] - M[0][0]) * fs | 0;
    const C = [1, 2, 3].map(c => uniforme(M.map(m => [m[0], m[c]]), fs));
    const L = Math.round(1.6 * fs), H = new Float64Array(n);
    for (let s = 0; s + L <= n; s++) {
      const mu = [0, 1, 2].map(c => { let a = 0; for (let i = s; i < s + L; i++) a += C[c][i]; return a / L || 1; });
      const s1 = new Float64Array(L), s2 = new Float64Array(L);
      for (let i = 0; i < L; i++) { const r = C[0][s + i] / mu[0], g = C[1][s + i] / mu[1], b = C[2][s + i] / mu[2]; s1[i] = g - b; s2[i] = g + b - 2 * r; }
      const sd = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) || 1e-9; };
      const al = sd(s1) / sd(s2); let mh = 0; const hh = new Float64Array(L);
      for (let i = 0; i < L; i++) { hh[i] = s1[i] + al * s2[i]; mh += hh[i]; } mh /= L;
      for (let i = 0; i < L; i++) H[s + i] += hh[i] - mh;
    }
    const x = quitarTendencia(H, fs * 1.2);
    // gentle smoothing (removes frame noise above ~4 Hz)
    const y = new Float64Array(x.length); for (let i = 0; i < x.length; i++) { let a = 0, c = 0; for (let j = -2; j <= 2; j++) if (x[i + j] != null) { a += x[i + j]; c++; } y[i] = a / c; }
    const p = pico(espectro(y, fs, .7, 3.0, .01), .08, vit.excluir);
    vit.conf = p.conf;
    if (p.conf > .3) { vit.hist.push(p.f * 60); if (vit.hist.length > 7) vit.hist.shift(); const s = [...vit.hist].sort((a, b) => a - b); vit.bpm = s[s.length >> 1]; }
    // the last 6 s of the pulse wave, normalized, for the display
    const u = y.slice(-fs * 6), mx = Math.max(...u.map(Math.abs)) || 1; vit.onda = Array.from(u, v => v / mx);
  } else { vit.conf = 0; if (M.length < 10) { vit.bpm = null; vit.hist = []; vit.onda = []; } }
  // breathing: shoulder height over the last 30 s
  const Pe = vit.pecho;
  if (Pe.length > 60 && Pe.at(-1)[0] - Pe[0][0] > 12) {
    const fs = 10, x0 = uniforme(Pe, fs), x = quitarTendencia(x0, fs * 12);
    const p = pico(espectro(x, fs, .1, .67, .005), .02);
    vit.confResp = p.conf; if (p.conf > .25) vit.resp = vit.resp == null ? p.f * 60 : vit.resp + (p.f * 60 - vit.resp) * .3;
    const u = x.slice(-fs * 15), mx = Math.max(...u.map(Math.abs)) || 1; vit.ondaResp = Array.from(u, v => v / mx);
  } else { vit.confResp = 0; if (Pe.length < 10) { vit.resp = null; vit.ondaResp = []; } }
}

/** what the station and the panel show */
export function lecturaVitales(ahora) {
  const cara = !!vit.cara && ahora - vit.tCara < 500, seg = vit.desde ? (ahora - vit.desde) / 1000 : 0;
  return { error: vit.error, filtrado: !!vit.excluir, cara, progreso: Math.min(1, seg / 8), pulso: cara && vit.conf > .3 ? vit.bpm : null, conf: vit.conf, resp: vit.confResp > .25 ? vit.resp : null, confResp: vit.confResp, onda: vit.onda, ondaResp: vit.ondaResp };
}

/** the face mesh and the skin patches, on the picture */
export function pintarMalla(c, { W, H, k, recorte, frente, t }) {
  const lm = vit.cara; if (!lm || performance.now() - vit.tCara > 300) return;
  const { sx, sy, sw, sh, vw, vh } = recorte;
  const P = q => { let x = (q.x * vw - sx) / sw * W; const y = (q.y * vh - sy) / sh * H; if (frente) x = W - x; return [x, y]; };
  c.save();
  c.fillStyle = 'rgba(160,255,232,.62)'; c.beginPath();
  for (let i = 0; i < lm.length; i++) { const [x, y] = P(lm[i]), r = (i > 467 ? 1.6 : 1.05) * k; c.moveTo(x + r, y); c.arc(x, y, r, 0, 7); }
  c.fill();
  // the skin patches the pulse is read from, outlined in gold
  c.strokeStyle = 'rgba(242,180,87,.85)'; c.lineWidth = 1.4 * k; c.setLineDash([3 * k, 4 * k]);
  for (const idx of [FRENTE, MEJ_I, MEJ_D]) { c.beginPath(); idx.forEach((i, j) => { const [x, y] = P(lm[i]); j ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); c.stroke(); }
  c.setLineDash([]); c.restore();
}

/** the readout: pulse and breathing with their live waves, a confidence bar and an honest note */
export function pintarVitales(c, { x, y, w, k, texto, ahora }) {
  const L = lecturaVitales(ahora), h = 196 * k;
  c.save();
  c.fillStyle = 'rgba(5,9,14,.62)'; c.strokeStyle = 'rgba(143,230,245,.28)'; c.lineWidth = 1; c.beginPath(); c.roundRect(x, y, w, h, 16 * k); c.fill(); c.stroke();
  texto(c, x + 16 * k, y + 24 * k, 'VITALS BY CAMERA', { f: 10.5 * k, w: 600, col: '#8fe6f5', esp: 1.6 * k });
  texto(c, x + w - 16 * k, y + 24 * k, 'rPPG · POS', { f: 10 * k, w: 500, col: 'rgba(244,247,250,.45)', alin: 'right', esp: 1 * k });
  const fila = (yy, nombre, valor, unidad, onda, conf, col, nota) => {
    texto(c, x + 16 * k, yy, nombre, { f: 10 * k, w: 600, col: 'rgba(244,247,250,.6)', esp: 1.2 * k });
    const wv = texto(c, x + 16 * k, yy + 34 * k, valor, { f: 32 * k, w: 600, col: valor === '—' ? 'rgba(244,247,250,.35)' : col });
    texto(c, x + 22 * k + wv, yy + 34 * k, unidad, { f: 12 * k, w: 500, col: 'rgba(244,247,250,.55)' });
    // wave
    const ox = x + 130 * k, ow = w - 146 * k, oy = yy + 20 * k, oh = 26 * k;
    if (onda && onda.length > 4) { c.strokeStyle = col; c.lineWidth = 1.8 * k; c.shadowColor = col; c.shadowBlur = 8 * k; c.beginPath(); onda.forEach((v, i) => { const px = ox + i / (onda.length - 1) * ow, py = oy - v * oh / 2; i ? c.lineTo(px, py) : c.moveTo(px, py); }); c.stroke(); c.shadowBlur = 0; }
    // confidence
    c.fillStyle = 'rgba(255,255,255,.08)'; c.fillRect(ox, yy + 42 * k, ow, 3 * k); c.fillStyle = col; c.fillRect(ox, yy + 42 * k, ow * Math.min(1, conf / .7), 3 * k);
    texto(c, ox + ow, yy + 56 * k, nota, { f: 9.5 * k, w: 500, col: 'rgba(244,247,250,.45)', alin: 'right' });
  };
  const espera = L.error ? 'face model unavailable' : !L.cara ? 'face the camera' : L.progreso < 1 ? `hold still · ${Math.ceil(8 * (1 - L.progreso))} s` : `confidence ${Math.round(L.conf * 100)}%`;
  fila(y + 50 * k, 'HEART RATE', L.pulso ? String(Math.round(L.pulso)) : '—', 'bpm', L.onda, L.conf, '#ff7a9c', L.filtrado && L.pulso ? espera + ' · CPR motion removed' : espera);
  fila(y + 120 * k, 'BREATHING', L.resp ? String(Math.round(L.resp)) : '—', '/min', L.ondaResp, L.confResp, '#8fe6f5', L.resp ? 'chest motion' : 'shoulders in view · 12 s');
  c.restore();
  return h;
}
