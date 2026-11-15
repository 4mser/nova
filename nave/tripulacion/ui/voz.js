/* Voz de NOVA a bordo (Kokoro, /v1/decir). Cola de frases: mientras suena una se pide la siguiente, así empieza a hablar
   casi al instante. El volumen real del audio mueve la boca de NOVA (nivelVoz, 0..1). */
'use strict';
let nivelVoz = 0, vozActiva = true;
/* dentro del AR embebido (iframe de la misma nave) habla la ventana principal: su audio ya quedó desbloqueado con el toque
   que abrió la cámara. WebKit no deja sonar un iframe sin un toque propio, y en una emergencia nadie toca el iframe. */
const vozPadre = (() => { try { return parent !== window && typeof parent.hablar === 'function' && parent.document ? parent : null; } catch { return null; } })();
const vozCola = [];
let vozSonando = false, vozGen = 0, vozCtx = null, vozAnalizador = null, vozFuente = null;

const idiomaDe = t => /[áéíóúñ¿¡]/i.test(t) || /\b(que|el|la|los|las|de|con|ahora|ella|él|está|tiene)\b/i.test(t) && !/\b(the|and|is|she|he|her|his)\b/i.test(t) ? 'es' : 'en';
/* parte un texto en frases cortas (la primera llega antes) */
function frases(t) {
  return t.replace(/\s+/g, ' ').match(/[^.!?¿¡\n]+[.!?]+|[^.!?\n]+$/g)?.map(s => s.trim()).filter(s => /\w/.test(s)) || [];
}

function contexto() {
  if (!vozCtx) {
    vozCtx = new (window.AudioContext || window.webkitAudioContext)();
    vozAnalizador = vozCtx.createAnalyser(); vozAnalizador.fftSize = 512;
    vozAnalizador.connect(vozCtx.destination);
  }
  if (vozCtx.state === 'suspended') vozCtx.resume().catch(() => {});
  return vozCtx;
}

async function pedirAudio(texto, idioma) {
  const r = await fetch(BASE + '/v1/decir', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto, idioma }) });
  if (!r.ok) throw new Error('voz');
  const ctx = contexto();
  return ctx.decodeAudioData(await r.arrayBuffer());
}

async function siguienteVoz(gen) {
  if (gen !== vozGen) return;
  const item = vozCola.shift();
  if (!item) { vozSonando = false; return; }
  vozSonando = true;
  // pedir ya la siguiente para que no haya silencio entre frases
  if (vozCola[0] && !vozCola[0].audio) vozCola[0].audio = pedirAudio(vozCola[0].texto, vozCola[0].idioma).catch(() => null);
  let buf = null;
  try { buf = await (item.audio || pedirAudio(item.texto, item.idioma)); } catch { buf = null; }
  if (gen !== vozGen) return;
  if (!buf) return respaldo(item, gen);
  const ctx = contexto(), src = ctx.createBufferSource();
  if (ctx.state !== 'running') { try { await ctx.resume(); } catch {} }
  if (gen !== vozGen) return;
  src.buffer = buf; src.connect(vozAnalizador); vozFuente = src;
  src.onended = () => { if (vozFuente === src) vozFuente = null; siguienteVoz(gen); };
  src.start();
}

/* respaldo: si la voz de a bordo (Kokoro) no responde, NOVA no se queda muda en una emergencia: dice la frase con la
   voz del sistema, que también funciona sin internet */
let respaldoHabla = false;
function respaldo(item, gen) {
  const ss = window.speechSynthesis;
  if (!ss || typeof SpeechSynthesisUtterance === 'undefined') return siguienteVoz(gen);
  const u = new SpeechSynthesisUtterance(item.texto);
  u.lang = item.idioma === 'es' ? 'es-ES' : 'en-US';
  const voz = ss.getVoices().find(v => v.lang.startsWith(item.idioma === 'es' ? 'es' : 'en') && /Samantha|Ava|Allison|Susan|Zoe|Female|Mónica|Paulina/i.test(v.name));
  if (voz) u.voice = voz;
  let listo = false;
  const fin = () => { if (listo) return; listo = true; respaldoHabla = false; if (gen === vozGen) siguienteVoz(gen); };
  u.onend = fin; u.onerror = fin;
  respaldoHabla = true; ss.speak(u);
  setTimeout(fin, 1500 + item.texto.length * 90);   // por si el sistema nunca avisa el final
}

/* encola un texto; con nuevo=true corta lo que esté diciendo */
function hablar(texto, { nuevo = true, idioma } = {}) {
  if (vozPadre) return vozPadre.hablar(texto, { nuevo, idioma });
  if (!vozActiva || !texto) return;
  if (nuevo) callar();
  const lengua = idioma || idiomaDe(texto);
  for (const f of frases(texto)) vozCola.push({ texto: f, idioma: lengua });
  if (!vozSonando) siguienteVoz(vozGen);
}

function callar() {
  if (vozPadre) return vozPadre.callar();
  vozGen++; vozCola.length = 0; vozSonando = false;
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (vozFuente) { try { vozFuente.onended = null; vozFuente.stop(); } catch {} vozFuente = null; }
}

// hablandoVoz es const en la ventana principal (no queda en window): si el padre no la expone, se mide aquí
const hablandoVoz = () => vozPadre && typeof vozPadre.hablandoVoz === 'function' ? vozPadre.hablandoVoz() : vozSonando || !!vozFuente;

/* nivel de la voz para animar la boca (se llama en cada cuadro) */
const vozDatos = new Uint8Array(256);
function medirVoz() {
  if (vozPadre) return (nivelVoz = vozPadre.medirVoz());
  if (respaldoHabla) { nivelVoz = nivelVoz * .6 + (.35 + .3 * Math.abs(Math.sin(performance.now() / 90))) * .4; return nivelVoz; }
  if (!vozAnalizador || !vozFuente) { nivelVoz *= .8; return nivelVoz; }
  vozAnalizador.getByteTimeDomainData(vozDatos);
  let s = 0; for (const v of vozDatos) { const x = (v - 128) / 128; s += x * x; }
  const rms = Math.sqrt(s / vozDatos.length);
  nivelVoz = nivelVoz * .55 + Math.min(1, rms * 5) * .45;
  return nivelVoz;
}

/* los navegadores exigen un gesto antes de sonar. WebKit (la ventana de escritorio en macOS) no cuenta pointerdown como
   gesto: se escuchan también mousedown, click, touchend y keydown, en cada gesto hasta que el audio quede activo, y se
   toca un buffer en silencio dentro del gesto (así WebKit lo da por desbloqueado) */
function desbloquearVoz() {
  try {
    const ctx = contexto();
    const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
    if (ctx.state === 'running') ['pointerdown', 'mousedown', 'click', 'touchend', 'keydown'].forEach(ev => removeEventListener(ev, desbloquearVoz, true));
  } catch {}
}
['pointerdown', 'mousedown', 'click', 'touchend', 'keydown'].forEach(ev => addEventListener(ev, desbloquearVoz, true));
