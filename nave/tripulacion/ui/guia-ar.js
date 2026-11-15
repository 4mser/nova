/* Camera guide for CPR (AR on the screen). MediaPipe finds the patient's torso and the rescuer's hands on board, Nova draws
   the target on the lower half of the sternum, says which way to move the hands, counts compressions from the hands'
   motion and coaches the rate (100-120/min) and the 2-minute rescuer swap. Depth is not measurable from one camera.

   Three pieces, so smart glasses can replace any of them later:
   · fuente  → where frames come from (this screen's camera today; glasses' camera stream later)
   · vision  → what Nova sees (pose + hands → patient, target, hands, compressions)
   · salidas → where the guide is shown (overlay on this screen + voice today; the glasses' display later) */
import { FilesetResolver, PoseLandmarker, HandLandmarker } from './lib/mediapipe/vision_bundle.mjs';

const $ = id => document.getElementById(id);
const P = new URLSearchParams(location.search);
const NOMBRE = P.get('nombre') || 'the patient';
const EMBEBIDA = P.has('embed');
let practica = P.has('practica');
if (practica) { $('marco').classList.add('espejo'); $('bPractica').textContent = 'Patient view'; }
if (P.get('nombre')) $('quien').textContent = `Patient: ${NOMBRE}`;

/* ── fuente: this screen's camera ── */
const fuenteCamara = {
  nombre: 'screen',
  async iniciar(video) {
    const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' }, audio: false });
    video.srcObject = s; await video.play();
    return { ancho: video.videoWidth, alto: video.videoHeight };
  }
};

/* ── vision ── */
let pose = null, manos = null;
async function cargarModelos() {
  const fs = await FilesetResolver.forVisionTasks('lib/mediapipe/wasm');
  const crear = async (Clase, modelo, extra) => {
    for (const delegate of ['GPU', 'CPU']) {
      try { return await Clase.createFromOptions(fs, { baseOptions: { modelAssetPath: modelo, delegate }, runningMode: 'VIDEO', ...extra }); } catch (e) { if (delegate === 'CPU') throw e; }
    }
  };
  [pose, manos] = await Promise.all([
    crear(PoseLandmarker, 'lib/mediapipe/modelos/pose_landmarker_full.task', { numPoses: 2, minPoseDetectionConfidence: .5, minTrackingConfidence: .5 }),
    crear(HandLandmarker, 'lib/mediapipe/modelos/hand_landmarker.task', { numHands: 2, minHandDetectionConfidence: .5, minTrackingConfidence: .5 })
  ]);
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const mid = (a, b) => mul(add(a, b), .5);
const len = a => Math.hypot(a.x, a.y);
const dot = (a, b) => a.x * b.x + a.y * b.y;

/* the patient: with two people in view, the one lying down (most horizontal torso); landmarks in pixels */
function paciente(poses, W, H) {
  const torsos = poses.map(lm => {
    const px = i => ({ x: lm[i].x * W, y: lm[i].y * H, v: lm[i].visibility ?? 1 });
    const hi = px(11), hd = px(12), ci = px(23), cd = px(24), nariz = px(0);
    if (hi.v < .5 || hd.v < .5) return null;
    const hombros = mid(hi, hd), ancho = len(sub(hi, hd));
    let cabeza; // unit vector from chest toward the head
    if (ci.v > .3 && cd.v > .3) { const v = sub(hombros, mid(ci, cd)); cabeza = mul(v, 1 / len(v)); }
    else if (nariz.v > .5) { const v = sub(nariz, hombros); cabeza = mul(v, 1 / len(v)); }
    else return null;
    // the patient lies down; an upright torso is the rescuer (unless practicing on yourself)
    if (!practica && Math.abs(cabeza.x) < .6) return null;
    const caderas = ci.v > .3 && cd.v > .3 ? mid(ci, cd) : sub(hombros, mul(cabeza, ancho * 1.4));
    const largo = len(sub(hombros, caderas));
    // lower half of the sternum: about a third of the way from the shoulders to the hips
    const blanco = sub(hombros, mul(cabeza, largo * .32));
    // seen from the side the shoulders overlap: the torso's length is the steadier scale
    const escala = Math.max(ancho, largo * .62);
    return { hombros, caderas, ancho: escala, anchoHombros: ancho, largo, cabeza, blanco, horizontal: Math.abs(cabeza.x), puntos: [hi, hd, ci, cd] };
  }).filter(Boolean);
  if (!torsos.length) return null;
  return torsos.sort((a, b) => b.horizontal - a.horizontal || b.ancho - a.ancho)[0];
}

/* palm centers near the target (the patient's own hands are usually far from the chest) */
function manosCerca(res, pac, W, H) {
  if (!res?.landmarks?.length || !pac) return [];
  return res.landmarks.map(lm => {
    const c = [0, 5, 9, 17].map(i => ({ x: lm[i].x * W, y: lm[i].y * H })).reduce(add, { x: 0, y: 0 });
    return { c: mul(c, 1 / 4), lm };
  }).filter(m => len(sub(m.c, pac.blanco)) < pac.ancho * 1.6);
}

/* compressions from the hands' motion along the screen's vertical, normalized by shoulder width */
const comp = { t: 0, suave: null, base: null, fase: 0, golpes: [], cuenta: 0, ultima: 0 };
function contarCompresion(t, manosC, pac) {
  if (!manosC.length || !pac) { comp.suave = comp.base = null; comp.fase = 0; return false; }
  const y = manosC.reduce((s, m) => s + m.c.y, 0) / manosC.length / pac.ancho;
  const dt = comp.t ? Math.min(.2, t - comp.t) : 1 / 30; comp.t = t;
  const a = k => 1 - Math.exp(-dt / k);                                  // time-based smoothing: same at any frame rate
  comp.suave = comp.suave == null ? y : comp.suave + (y - comp.suave) * a(.05);
  comp.base = comp.base == null ? y : comp.base + (comp.suave - comp.base) * a(.4);
  const d = comp.suave - comp.base, umbral = .005;  // tuned on a real CPR recording: 8 of 11 compressions, no false ones
  if (comp.fase <= 0 && d > umbral) comp.fase = 1;                      // pushing down (hands lower on screen)
  else if (comp.fase === 1 && d < -umbral * .2 && t - comp.ultima > .3) { // chest coming back up: one compression
    comp.fase = -1; comp.cuenta++; comp.ultima = t; comp.golpes.push(t);
    comp.golpes = comp.golpes.filter(g => t - g < 6);
    return true;
  }
  return false;
}
function ritmo(t) {
  const g = comp.golpes.filter(x => t - x < 5);
  if (g.length < 4 || t - g.at(-1) > 1.6) return null;
  const iv = g.slice(1).map((x, i) => x - g[i]).sort((a, b) => a - b);
  return 60 / iv[Math.floor(iv.length / 2)];
}

/* ── salidas: overlay on this screen + Nova's voice ── */
const lienzo = $('lienzo'), ctx = lienzo.getContext('2d');
const COL = { ac: '#8fe6f5', ok: '#6fd6b0', at: '#f2b457', al: '#ec6aa8', t2: '#9aa4b2' };
function dibujar(e, t) {
  const { W, H, pac, manosC, sobre } = e;
  ctx.clearRect(0, 0, W, H);
  if (!pac) return;
  const k = W / 1280;
  // torso the camera is tracking
  ctx.strokeStyle = 'rgba(143,230,245,.35)'; ctx.lineWidth = 3 * k; ctx.setLineDash([]);
  const [hi, hd, ci, cd] = pac.puntos;
  ctx.beginPath(); ctx.moveTo(hi.x, hi.y); ctx.lineTo(hd.x, hd.y);
  if (ci.v > .3 && cd.v > .3) { ctx.lineTo(cd.x, cd.y); ctx.lineTo(ci.x, ci.y); ctx.closePath(); }
  ctx.stroke();
  // the target: where both hands go
  const r = pac.ancho * .2, col = sobre ? COL.ok : COL.ac;
  const golpe = metro.on ? ((t - metro.t0) * metro.bpm / 60) % 1 : 1;
  ctx.fillStyle = sobre ? 'rgba(111,214,176,.2)' : 'rgba(143,230,245,.14)';
  ctx.beginPath(); ctx.arc(pac.blanco.x, pac.blanco.y, r, 0, 7); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 5 * k; ctx.beginPath(); ctx.arc(pac.blanco.x, pac.blanco.y, r, 0, 7); ctx.stroke();
  if (metro.on && golpe < .6) { // the beat, as a ring leaving the target
    ctx.globalAlpha = .7 * (1 - golpe / .6); ctx.lineWidth = 3 * k;
    ctx.beginPath(); ctx.arc(pac.blanco.x, pac.blanco.y, r * (1 + golpe * 1.2), 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(pac.blanco.x, pac.blanco.y, 7 * k, 0, 7); ctx.fill();
  // hands and the way to the target
  for (const m of manosC) {
    ctx.fillStyle = sobre ? COL.ok : COL.at;
    for (const p of m.lm) { ctx.beginPath(); ctx.arc(p.x * W, p.y * H, 3.2 * k, 0, 7); ctx.fill(); }
  }
  if (manosC.length && !sobre) {
    const c = mul(manosC.reduce((s, m) => add(s, m.c), { x: 0, y: 0 }), 1 / manosC.length);
    const v = sub(pac.blanco, c), d = len(v);
    if (d > r * 1.2) {
      const u = mul(v, 1 / d), a = add(c, mul(u, 26 * k)), b = sub(pac.blanco, mul(u, r + 10 * k));
      ctx.strokeStyle = COL.at; ctx.lineWidth = 6 * k; ctx.setLineDash([14 * k, 12 * k]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      const n = { x: -u.y, y: u.x }, s = 18 * k;
      ctx.fillStyle = COL.at; ctx.beginPath(); ctx.moveTo(b.x + u.x * s, b.y + u.y * s);
      ctx.lineTo(b.x - u.x * s * .4 + n.x * s * .8, b.y - u.y * s * .4 + n.y * s * .8); ctx.lineTo(b.x - u.x * s * .4 - n.x * s * .8, b.y - u.y * s * .4 - n.y * s * .8); ctx.fill();
    }
  }
}

/* voice: one short prompt at a time, never more often than every few seconds */
let ultimaVoz = 0, ultimoDicho = '';
function decir(texto, t, cada = 5) {
  if (texto === ultimoDicho && t - ultimaVoz < cada * 2.5) return;
  if (t - ultimaVoz < cada) return;
  ultimaVoz = t; ultimoDicho = texto;
  if (typeof hablar === 'function') hablar(texto, { nuevo: true, idioma: 'en' });
  avisarApp('step', texto);
}
function avisarApp(evento, texto) { if (EMBEBIDA && parent !== window) parent.postMessage({ tipo: 'guia-ar', evento, texto }, '*'); }

/* metronome: short click on each beat (WebAudio clock) */
const metro = { on: true, bpm: 110, t0: performance.now() / 1000, prox: 0, id: 0, ctx: null };
function iniciarMetronomo() {
  clearInterval(metro.id);
  if (!metro.on) return;
  metro.ctx = typeof contexto === 'function' ? contexto() : (metro.ctx || new AudioContext());
  const c = metro.ctx; metro.prox = c.currentTime + .1; metro.t0 = performance.now() / 1000 + .1;
  metro.id = setInterval(() => {
    while (metro.prox < c.currentTime + .25) {
      const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 1150;
      g.gain.setValueAtTime(.0001, metro.prox); g.gain.exponentialRampToValueAtTime(.3, metro.prox + .004); g.gain.exponentialRampToValueAtTime(.0001, metro.prox + .06);
      o.connect(g); g.connect(c.destination); o.start(metro.prox); o.stop(metro.prox + .07);
      metro.prox += 60 / metro.bpm;
    }
  }, 60);
}

/* ── panel ── */
function fila(id, clase, valor) { $(id).className = 'fila ' + clase; }
function pintarPanel(e, t) {
  $('pilPac').className = 'pil ' + (e.pac ? 'ok' : 'at'); $('vPac').textContent = e.pac ? 'yes' : 'looking';
  fila('fPac', e.pac ? 'ok' : 'at');
  const estado = !e.pac ? 'at' : !e.manosC.length ? '' : e.sobre ? 'ok' : 'at';
  $('pilManos').className = 'pil ' + estado; fila('fManos', estado);
  $('vManos').textContent = !e.manosC.length ? 'not seen' : e.sobre ? 'on target' : 'move';
  const pausa = e.pausa;
  $('vPausa').textContent = `${Math.floor(pausa)} s`; fila('fPausa', pausa > 10 ? 'al' : pausa > 3 ? 'at' : 'ok');
  $('vRitmo').textContent = e.rpm ? Math.round(e.rpm) : '—';
  $('vRitmo').style.color = !e.rpm ? 'var(--t2)' : e.rpm < 100 || e.rpm > 120 ? 'var(--at)' : 'var(--ok)';
  $('aguja').style.left = e.rpm ? `calc(${Math.max(0, Math.min(100, (e.rpm - 50) / 100 * 100))}% - 2px)` : '-10px';
  $('vCuenta').textContent = comp.cuenta;
  const ciclo = sesion.cicloDesde ? t - sesion.cicloDesde : 0;
  $('vCiclo').textContent = `${Math.floor(ciclo / 60)}:${String(Math.floor(ciclo % 60)).padStart(2, '0')}`;
  const av = $('aviso'); av.hidden = !e.aviso; av.textContent = e.aviso || ''; av.className = 'aviso ' + (e.avisoTipo || '');
  $('paso').textContent = e.paso;
}

/* ── loop ── */
const sesion = { cicloDesde: 0, ultimaCompresion: 0, empezo: false, sobreDesde: 0, dijoSobre: false };
let video, W = 1280, H = 720, ultimoTs = -1;
function cuadro() {
  requestAnimationFrame(cuadro);
  const ahora = performance.now(), t = ahora / 1000;
  pintarNova(t);
  if (!pose || video.readyState < 2) return;
  const ts = Math.round(ahora); if (ts <= ultimoTs) return; ultimoTs = ts;
  const rp = pose.detectForVideo(video, ts), rm = manos.detectForVideo(video, ts);
  // the rescuer covers the patient while pushing: keep the last chest Nova saw (a patient on the floor or the CMRS barely moves)
  let pac = paciente(rp.landmarks || [], W, H);
  if (pac) { pacVisto = pac; pacVistoT = t; }
  else if (pacVisto && t - pacVistoT < 20) pac = { ...pacVisto, retenido: true };
  if (pac && suaveBlanco) { suaveBlanco = add(mul(suaveBlanco, .7), mul(pac.blanco, .3)); pac.blanco = suaveBlanco; } else suaveBlanco = pac ? pac.blanco : null;
  const manosC = manosCerca(rm, pac, W, H);
  let sobre = false, dir = '';
  if (pac && manosC.length) {
    const c = mul(manosC.reduce((s, m) => add(s, m.c), { x: 0, y: 0 }), 1 / manosC.length);
    const v = sub(c, pac.blanco);
    // along the body (head ↔ feet) the camera is precise; across it, a side view mixes in height above the chest
    const largo = dot(v, pac.cabeza) / pac.ancho, lado = Math.abs(dot(v, { x: -pac.cabeza.y, y: pac.cabeza.x })) / pac.ancho;
    const bienLargo = Math.abs(largo) <= .24, bienLado = lado <= .42;
    sobre = bienLargo && bienLado && (manosC.length < 2 || len(sub(manosC[0].c, manosC[1].c)) < pac.ancho * .45);
    dir = sobre ? 'together' : !bienLargo ? (largo > 0 ? 'lower' : 'higher') : !bienLado ? 'middle' : 'stack';
  }
  const empujo = sobre && contarCompresion(t, manosC, pac);
  if (!sobre) contarCompresion(t, [], null);
  if (empujo) { sesion.ultimaCompresion = t; if (!sesion.empezo) { sesion.empezo = true; sesion.cicloDesde = t; avisarApp('start', 'Compressions started with the camera guide'); } }
  const rpm = ritmo(t);
  const pausa = sesion.empezo ? t - sesion.ultimaCompresion : 0;

  // what Nova says and shows, most important first
  let aviso = '', avisoTipo = '', paso = '';
  if (!pac) { paso = `Show Nova ${NOMBRE === 'the patient' ? "the patient's" : NOMBRE + "'s"} chest and shoulders.`; aviso = 'Show me the chest'; avisoTipo = 'at'; decir("I can't see the chest. Point the camera at the patient's chest and shoulders.", t, 8); }
  else if (!manosC.length) { paso = 'Put both hands on the center of the chest, on the circle.'; aviso = sesion.empezo ? 'Hands back on the chest' : 'Hands on the circle'; avisoTipo = 'at'; decir(sesion.empezo ? "Hands back on the chest. Don't stop." : 'Put both hands on the center of the chest, on the circle.', t, 5); }
  else if (!sobre) {
    const txt = dir === 'lower' ? 'Move your hands lower on the chest.' : dir === 'higher' ? 'Move your hands up the chest, toward the head.' : dir === 'middle' ? 'Bring your hands onto the center of the chest.' : 'Stack one hand on top of the other.';
    paso = txt; aviso = txt.replace(/\.$/, ''); avisoTipo = 'at'; decir(txt, t, 4);
  } else {
    if (!sesion.sobreDesde) sesion.sobreDesde = t;
    if (!sesion.dijoSobre) { sesion.dijoSobre = true; decir('Good. Hands on the center of the chest. Push hard and fast with the beat.', t, 0); }
    paso = 'Push hard and fast with the beat: 5 to 6 cm, letting the chest come back up.';
    const ciclo = sesion.cicloDesde ? t - sesion.cicloDesde : 0;
    if (ciclo >= 120) { aviso = 'Two minutes: swap rescuers'; avisoTipo = 'at'; paso = 'Two minutes. Swap rescuers now, with as little pause as possible.'; decir('Two minutes. Swap rescuers now.', t, 6); if (ciclo > 135) sesion.cicloDesde = t; }
    else if (sesion.empezo && pausa > 3) { aviso = 'Keep pushing'; avisoTipo = 'at'; decir("Keep pushing. Don't stop.", t, 4); }
    else if (rpm && rpm < 100) { aviso = 'Faster'; avisoTipo = 'at'; decir('Faster. Follow the beat.', t, 5); }
    else if (rpm && rpm > 120) { aviso = 'A bit slower'; avisoTipo = 'at'; decir('A bit slower. Follow the beat.', t, 5); }
    else if (rpm) { aviso = 'Good rate'; avisoTipo = 'ok'; decir('Good rate. Keep going.', t, 15); }
    else { aviso = 'Push with the beat'; avisoTipo = 'ok'; }
  }
  if (!sobre) sesion.sobreDesde = 0;
  const e = { W, H, pac, manosC, sobre, rpm, pausa, aviso, avisoTipo, paso };
  dibujar(e, t); pintarPanel(e, t);
  fpsN++; window.__guiaAR = { fps: fpsV, pac: !!pac, retenido: !!(pac && pac.retenido), manos: manosC.length, sobre, rpm, cuenta: comp.cuenta, aviso };
}
let fpsN = 0, fpsV = 0; setInterval(() => { fpsV = fpsN; fpsN = 0; }, 1000);
let suaveBlanco = null, pacVisto = null, pacVistoT = 0;

function pintarNova(t) {
  if (typeof mascotaOrbes !== 'function') return;
  const habla = typeof medirVoz === 'function' ? medirVoz() : 0;
  $('nova').innerHTML = mascotaOrbes({ x: 60, y: 50, R: 26, t, expr: habla > .05 ? 'feliz' : 'pensativa', orbes: 4, habla, parpadeo: (t % 3.7) < .13 ? 1 : 0, mira: [.4, .1] });
}

function ajustarMarco() {
  const caja = $('marco').parentElement.getBoundingClientRect(), m = 56;
  const k = Math.min((caja.width - m) / W, (caja.height - m) / H);
  $('marco').style.width = `${W * k}px`; $('marco').style.height = `${H * k}px`;
}

async function iniciar() {
  video = $('video');
  try {
    ({ ancho: W, alto: H } = await fuenteCamara.iniciar(video));
    lienzo.width = W; lienzo.height = H; ajustarMarco(); addEventListener('resize', ajustarMarco);
    $('pilCam').innerHTML = '<i></i><b>Camera</b> loading vision';
    await cargarModelos();
    $('pilCam').className = 'pil ok'; $('pilCam').innerHTML = '<i></i><b>Camera</b> on board';
    $('vacio').hidden = true;
  } catch (err) {
    $('vacio').innerHTML = `<div><b>No camera</b>${err && err.name === 'NotAllowedError' ? 'Allow camera access for NOVA and open the guide again.' : 'Nova could not start the camera or the vision models.'}</div>`;
    $('pilCam').className = 'pil at'; $('pilCam').innerHTML = '<i></i><b>Camera</b> off';
    return;
  }
  iniciarMetronomo();
  requestAnimationFrame(cuadro);
}

$('bPractica').addEventListener('click', () => { const on = $('marco').classList.toggle('espejo'); practica = on; $('bPractica').textContent = on ? 'Patient view' : 'Practice on me'; });
$('bMetro').addEventListener('click', () => { metro.on = !metro.on; $('bMetro').textContent = metro.on ? 'Beat on' : 'Beat off'; $('bMetro').classList.toggle('pri', metro.on); iniciarMetronomo(); });
$('bCerrar').addEventListener('click', () => { clearInterval(metro.id); if (typeof callar === 'function') callar(); if (EMBEBIDA) avisarApp('close', `Camera guide closed after ${comp.cuenta} compressions`); else history.back(); });
addEventListener('keydown', e => { if (e.key === 'p') $('bPractica').click(); if (e.key === 'm') $('bMetro').click(); if (e.key === 'Escape') $('bCerrar').click(); });
iniciar();
