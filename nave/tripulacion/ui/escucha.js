/* Hablarle a NOVA por voz, a bordo y sin internet.
   · el micrófono se mide en cada bloque; cuando hay voz se graba (con 0,3 s de antes) y al callar ~0,9 s se corta
   · el audio va a /v1/oir (whisper.cpp large-v3-turbo en la nave) y el texto entra a Ask Nova como una pregunta escrita
   · medio dúplex: mientras NOVA piensa o habla no se escucha, para que no se oiga a sí misma; al terminar vuelve a escuchar
   · nivelMic (0..1) mueve los anillos y la luz de NOVA, como en la app del teléfono */
'use strict';
let enVoz = false, faseVoz = 'apagado', nivelMic = 0, oidoTexto = '';
let micStream = null, micCtx = null, micNodo = null, micFuente = null;
const PRE = 0.3, SILENCIO = 0.9, MIN_VOZ = 0.35, MAX_VOZ = 20;
let bloques = [], previos = [], enVozDesde = 0, ultimaVoz = 0, piso = 0.01, hayVoz = false, tVoz = 0;

function pintarVozUI() {
  const nv = document.querySelector('.nova');
  nv.classList.toggle('envoz', enVoz);
  $('panelVoz').hidden = !enVoz;
  const tit = { escuchando: 'Listening', oyendo: 'Listening', transcribiendo: 'Thinking', pensando: 'Thinking', hablando: 'Speaking', apagado: '' }[faseVoz];
  $('pvTitulo').textContent = tit;
  $('pvTitulo').className = faseVoz === 'hablando' ? 'nv' : '';
  $('pvSub').textContent = faseVoz === 'hablando' ? 'Click Nova to interrupt' : faseVoz === 'transcribiendo' ? 'Understanding what you said…' : faseVoz === 'pensando' ? 'Checking the crew data…' : 'Speak in English or Spanish';
  $('micBtn').classList.toggle('on', enVoz);
}

async function abrirVoz() {
  if (enVoz) return cerrarVoz();
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch {
    $('novaDice').textContent = "I can't reach the microphone. You can still type.";
    return;
  }
  micCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (micCtx.state === 'suspended') await micCtx.resume().catch(() => {});
  micFuente = micCtx.createMediaStreamSource(micStream);
  micNodo = micCtx.createScriptProcessor(2048, 1, 1);
  micNodo.onaudioprocess = e => procesar(e.inputBuffer.getChannelData(0));
  micFuente.connect(micNodo); micNodo.connect(micCtx.destination);
  callar();
  enVoz = true; escuchar(); pintarVozUI();
}

function cerrarVoz() {
  enVoz = false; faseVoz = 'apagado'; nivelMic = 0; bloques = []; previos = []; hayVoz = false;
  try { micNodo && micNodo.disconnect(); micFuente && micFuente.disconnect(); } catch {}
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (micCtx) micCtx.close().catch(() => {});
  micStream = micCtx = micNodo = micFuente = null;
  pintarVozUI();
}

function escuchar() { faseVoz = 'escuchando'; bloques = []; previos = []; hayVoz = false; pintarVozUI(); }

function procesar(x) {
  if (!enVoz) return;
  let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  const rms = Math.sqrt(s / x.length), dur = x.length / micCtx.sampleRate, ahora = micCtx.currentTime;
  const oye = faseVoz === 'escuchando' || faseVoz === 'oyendo';
  nivelMic = oye ? nivelMic * .6 + Math.min(1, rms * 9) * .4 : nivelMic * .85;
  if (!oye) return;
  // piso de ruido que se adapta despacio cuando no hay voz
  if (!hayVoz) piso = piso * .97 + Math.min(rms, .05) * .03;
  const umbral = Math.max(.012, piso * 3.2);
  const copia = new Float32Array(x);
  if (rms > umbral) {
    if (!hayVoz) { tVoz += dur; if (tVoz >= .12) { hayVoz = true; enVozDesde = ahora; bloques = previos.slice(); faseVoz = 'oyendo'; pintarVozUI(); } }
    ultimaVoz = ahora;
  } else if (!hayVoz) tVoz = 0;
  if (hayVoz) {
    bloques.push(copia);
    const largo = ahora - enVozDesde;
    if (ahora - ultimaVoz > SILENCIO || largo > MAX_VOZ) {
      const util = largo - (ahora - ultimaVoz);
      hayVoz = false; tVoz = 0;
      if (util < MIN_VOZ) { escuchar(); return; }
      enviarVoz(bloques, micCtx.sampleRate);
      bloques = [];
    }
  } else {
    previos.push(copia);
    while (previos.length * x.length / micCtx.sampleRate > PRE) previos.shift();
  }
}

/* PCM a 16 kHz mono en WAV de 16 bit */
function aWav(bl, hz) {
  const n = bl.reduce((a, b) => a + b.length, 0), todo = new Float32Array(n);
  let o = 0; for (const b of bl) { todo.set(b, o); o += b.length; }
  const r = hz / 16000, m = Math.floor(n / r), pcm = new Int16Array(m);
  for (let i = 0; i < m; i++) {
    // promedio simple de las muestras que caen en cada salida (filtro antialias básico)
    const a = Math.floor(i * r), b = Math.min(n, Math.floor((i + 1) * r)); let s = 0;
    for (let j = a; j < b; j++) s += todo[j];
    const v = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    pcm[i] = v < 0 ? v * 32768 : v * 32767;
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2), d = new DataView(buf);
  const str = (p, t) => { for (let i = 0; i < t.length; i++) d.setUint8(p + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); d.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, 16000, true);
  d.setUint32(28, 32000, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); str(36, 'data'); d.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return buf;
}

async function enviarVoz(bl, hz) {
  faseVoz = 'transcribiendo'; pintarVozUI();
  let texto = '';
  try {
    const r = await fetch(BASE + '/v1/oir', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: aWav(bl, hz) });
    if (r.ok) texto = ((await r.json()).texto || '').trim();
    else $('novaDice').textContent = 'The onboard hearing is not running. You can still type.';
  } catch { $('novaDice').textContent = 'The onboard link is not answering.'; }
  if (!enVoz) return;
  if (!texto || !/\p{L}{2}/u.test(texto)) { escuchar(); return; }
  faseVoz = 'pensando'; pintarVozUI();
  await preguntarNova(texto, { porVoz: true });
  // NOVA responde en voz alta; cuando termina de hablar, vuelve a escuchar
  if (!enVoz) return;
  faseVoz = 'hablando'; pintarVozUI();
  const esperar = () => {
    if (!enVoz) return;
    if (hablandoVoz()) return setTimeout(esperar, 150);
    setTimeout(() => { if (enVoz && !hablandoVoz()) escuchar(); }, 350);
  };
  esperar();
}

/* la animación pregunta en cada cuadro qué hacer con NOVA */
function luzVoz() { return enVoz ? Math.max(hablandoVoz() ? nivelVoz * 1.6 : 0, (faseVoz === 'escuchando' || faseVoz === 'oyendo') ? nivelMic * .45 : 0) : 0; }

/* anillo orbital y ondas alrededor de NOVA (mismo lenguaje que la app del teléfono), centrados en (cx, cy) */
function orbitaVoz(cx, cy, t) {
  if (!enVoz) return '';
  const rM = 104, rA = 96, rB = 90; let h = '';
  // escala fina de marcas
  let d = '';
  for (let i = 0; i < 80; i++) {
    const a = i / 80 * Math.PI * 2, r0 = i % 6 === 0 ? rM - 7 : rM - 4;
    d += `M${(cx + Math.cos(a) * r0).toFixed(1)} ${(cy + Math.sin(a) * r0).toFixed(1)}L${(cx + Math.cos(a) * rM).toFixed(1)} ${(cy + Math.sin(a) * rM).toFixed(1)}`;
  }
  h += `<path d="${d}" stroke="rgba(150,185,215,.22)" stroke-width="1" fill="none"/>`;
  h += `<circle cx="${cx}" cy="${cy}" r="${rA}" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>`;
  // barrido que gira: más rápido mientras habla o piensa
  const vel = faseVoz === 'hablando' ? 1 : faseVoz === 'pensando' || faseVoz === 'transcribiendo' ? 1.8 : .45;
  tVozGiro += (t - (tVozAnt || t)) * vel; tVozAnt = t;
  const cab = tVozGiro, N = 36;
  for (let k = 0; k < N; k++) {
    const a0 = cab - (k + 1) * .05, a1 = cab - k * .05;
    h += `<path d="M${(cx + Math.cos(a0) * rB).toFixed(1)} ${(cy + Math.sin(a0) * rB).toFixed(1)}A${rB} ${rB} 0 0 1 ${(cx + Math.cos(a1) * rB).toFixed(1)} ${(cy + Math.sin(a1) * rB).toFixed(1)}" stroke="rgba(143,230,245,${(.9 * (1 - k / N) ** 1.6).toFixed(3)})" stroke-width="1.2" fill="none"/>`;
  }
  // ondas de escucha: salen de NOVA con tu voz
  if (faseVoz === 'escuchando' || faseVoz === 'oyendo') for (let k = 0; k < 3; k++) {
    const f = (((t * 1000 - k * 500) / 1500) % 1 + 1) % 1, r = 104 * (.6 + f * (.4 + nivelMic * .35));
    h += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" stroke="#8fe6f5" stroke-width="1.5" fill="none" opacity="${((1 - f) * (.2 + nivelMic * .7)).toFixed(3)}"/>`;
  }
  return h;
}
let tVozGiro = 0, tVozAnt = 0;

document.addEventListener('click', e => {
  const b = e.target.closest('button,#novaP'); if (!b) return;
  if (b.id === 'micBtn') abrirVoz();
  else if (b.id === 'pvFin') cerrarVoz();
  else if (b.id === 'novaP' && enVoz && hablandoVoz()) { callar(); setTimeout(() => enVoz && escuchar(), 250); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && enVoz) cerrarVoz(); });
// NOVA empieza a hablar mientras el modelo todavía escribe: el panel pasa a «Speaking» apenas suena
setInterval(() => { if (enVoz && faseVoz === 'pensando' && hablandoVoz()) { faseVoz = 'hablando'; pintarVozUI(); } }, 120);
