/* NOVA · página. El héroe y el cierre dibujan a NOVA en vivo; la historia corre el MISMO código del video
   (motor/motor.html, render(t)) y el scroll elige la frase: dentro de cada frase el video avanza solo y se detiene al final. */
(() => {
const cl = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), pr = (t, a, d) => cl((t - a) / d), lerp = (a, b, x) => a + (b - a) * x;
const eIO = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2, eOut = x => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
const eSpr = x => x >= 1 ? 1 : 1 - Math.exp(-7 * x) * (1 + 7 * x);
const $ = id => document.getElementById(id), movil = () => matchMedia('(max-width:920px)').matches;
const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
const cur = { x: innerWidth / 2, y: innerHeight / 2, mov: false };
addEventListener('pointermove', e => { cur.x = e.clientX; cur.y = e.clientY; cur.mov = true; }, { passive: true });

/* ── NOVA con transiciones suaves: los pesos de cada forma se acercan con el tiempo real y
      los ojos cambian de forma escondidos dentro de un parpadeo ── */
const EXPR = ['normal', 'feliz', 'sorprendida', 'dormida', 'pensativa'];
class Nova {
  constructor(e = 'normal'){ this.p = {}; EXPR.forEach(k => this.p[k] = k === e ? 1 : 1e-3); this.ver = e; this.obj = e; this.tc = -1; this.parp = 2.5; this.tp = 0; this.mira = [0, 0]; }
  dibujar({ x, y, R, t, expr = 'normal', mira = [0, 0], orbes = 6, apertura = 1, habla = 0, sinHalo = false, rapidez = 5 }){
    const dt = Math.min(.05, Math.max(0, t - this.tp)); this.tp = t; const k = 1 - Math.exp(-dt * rapidez);
    EXPR.forEach(e => { this.p[e] += ((e === expr ? 1 : 0) - this.p[e]) * k; this.p[e] = Math.max(1e-3, this.p[e]); });
    this.mira = this.mira.map((v, i) => v + (mira[i] - v) * (1 - Math.exp(-dt * 6)));
    const domina = EXPR.reduce((a, b) => this.p[a] > this.p[b] ? a : b);
    if (domina !== this.obj){ this.obj = domina; if (this.tc < 0) this.tc = t; }
    let parp = 0;
    if (t > this.parp + .18) this.parp = t + 2.4 + Math.random() * 2.6;
    if (t > this.parp) parp = Math.sin(pr(t, this.parp, .18) * Math.PI);
    if (this.tc >= 0){ const q = (t - this.tc) / .2; if (q >= .5) this.ver = this.obj; if (q >= 1) this.tc = -1; else parp = Math.max(parp, Math.sin(q * Math.PI)); }
    return mascotaOrbes({ x, y, R, t, expr: this.ver, pesos: this.p, mira: this.mira, parpadeo: parp, orbes, apertura, habla, sinHalo });
  }
}
const visible = el => { const r = el.getBoundingClientRect(); return r.bottom > -60 && r.top < innerHeight + 60; };
const relCursor = (el, kx = 2.2, ky = 2) => { const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  return [cl((cur.x - cx) / (innerWidth * .5), -1, 1) * kx, cl((cur.y - cy) / (innerHeight * .5), -1, 1) * ky]; };
const dentroDe = el => { const r = el.getBoundingClientRect(); return cur.x > r.left && cur.x < r.right && cur.y > r.top && cur.y < r.bottom; };

/* ── nav ── */
const nav = $('nav');
const alScroll = () => { nav.classList.toggle('solido', scrollY > 30); document.documentElement.style.setProperty('--hs', cl(scrollY / innerHeight).toFixed(3)); };
addEventListener('scroll', alScroll, { passive: true }); alScroll();

/* ── la historia: el video real (vertical en el teléfono, 1440p en pantallas grandes) en el héroe ── */
const H = { sec: $('historia'), esc: $('hEscena'), marco: $('hMarco'), v: $('hVid'), vis: true, full: false, src: '' };
const VID = { movil: 'video/nova-movil.mp4', pc: 'video/nova-pc.mp4' };
function fuente(t = 0){ const quiere = movil() && !H.full ? VID.movil : VID.pc; if (H.src === quiere) return;
  const seguir = !H.v.paused || H.src === ''; H.src = quiere; H.v.poster = quiere.replace('.mp4', '.jpg'); H.v.src = quiere + '?v=1791180000';
  H.v.addEventListener('loadedmetadata', function f(){ H.v.removeEventListener('loadedmetadata', f); if (t > 0) H.v.currentTime = t; if (seguir) H.v.play().catch(() => {}); }); }
fuente();
function medir(){ H.marco.style.width = H.marco.style.height = H.marco.style.transform = '';
  if (H.full && movil()){ const W = innerWidth, Hh = innerHeight, gira = Hh > W, vw = gira ? Hh : W, vh = gira ? W : Hh, f = Math.min(vw / 16, vh / 9);
    H.marco.style.width = 16 * f + 'px'; H.marco.style.height = 9 * f + 'px'; H.marco.style.transform = `translate(-50%,-50%) rotate(${gira ? 90 : 0}deg)`; } }
let tamPrev = ''; addEventListener('resize', () => { const k = innerWidth + 'x' + innerHeight; if (k !== tamPrev){ tamPrev = k; medir(); fuente(H.v.currentTime); } });
function modoFull(on){ const t = H.v.currentTime; H.full = on; H.esc.classList.toggle('full', on); $('hFull').classList.toggle('dentro', on); document.documentElement.style.overflow = on ? 'hidden' : ''; medir(); fuente(t); }
$('hFull').addEventListener('click', async e => { e.stopPropagation();
  if (movil()){ const on = !H.full; modoFull(on);
    const de = document.documentElement, rq = de.requestFullscreen || de.webkitRequestFullscreen, sal = document.exitFullscreen || document.webkitExitFullscreen;
    try { if (on && rq) await rq.call(de, { navigationUI: 'hide' }); else if (!on && (document.fullscreenElement || document.webkitFullscreenElement) && sal) await sal.call(document); } catch (er) {}
    if (on && !rq && H.v.webkitEnterFullscreen) try { H.v.webkitEnterFullscreen(); } catch (er) {}
    return; }
  if (document.fullscreenElement){ document.exitFullscreen().catch(() => {}); return; }
  try { await H.esc.requestFullscreen(); } catch (er) {} });
const alSalirFS = () => { const en = !!(document.fullscreenElement || document.webkitFullscreenElement); if (!movil()) $('hFull').classList.toggle('dentro', en); else if (!en && H.full) modoFull(false); };
document.addEventListener('fullscreenchange', alSalirFS); document.addEventListener('webkitfullscreenchange', alSalirFS);
addEventListener('keydown', e => { if (e.key === 'Escape' && H.full) modoFull(false); });
function reproducir(on){ if (on) H.v.play().catch(() => {}); else H.v.pause(); }
H.v.addEventListener('play', () => { $('hPlay').classList.remove('pausa'); $('hPlay').setAttribute('aria-label', 'Pause'); });
H.v.addEventListener('pause', () => { $('hPlay').classList.add('pausa'); $('hPlay').setAttribute('aria-label', 'Play'); });
$('hPlay').addEventListener('click', e => { e.stopPropagation(); reproducir(H.v.paused); });
H.marco.addEventListener('click', e => { if (e.target === H.v) reproducir(H.v.paused); });
$('hProgW').addEventListener('click', e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); if (H.v.duration) H.v.currentTime = (e.clientX - r.left) / r.width * H.v.duration; });
const hSon = $('hSon');
hSon.addEventListener('click', e => { e.stopPropagation(); avisoVisto = true; $('hAviso').classList.remove('on'); H.v.muted = !H.v.muted; hSon.setAttribute('aria-pressed', !H.v.muted); if (!H.v.muted) H.v.play().catch(() => {}); });
// fuera de pantalla se pausa; al volver, sigue
let pausaPorScroll = false;
new IntersectionObserver(es => es.forEach(e => { H.vis = e.intersectionRatio >= .35; if (!H.vis && !H.v.paused && !H.full){ H.v.pause(); pausaPorScroll = true; } else if (H.vis && pausaPorScroll){ pausaPorScroll = false; H.v.play().catch(() => {}); } }), { threshold: [0, .35, .7] }).observe(H.sec);
// aviso de sonido: una vez
let avisoVisto = false; try { avisoVisto = !!localStorage.getItem('nova.aviso'); } catch (e) {}
const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function historia(now){
  if (!avisoVisto && H.v.currentTime > 2){ if (!H.tAv) H.tAv = now; const k = now - H.tAv; $('hAviso').classList.toggle('on', k < 8 && H.v.muted); if (k > 8){ avisoVisto = true; try { localStorage.setItem('nova.aviso', '1'); } catch (e) {} } }
  if (!H.vis && !H.full) return;
  const d = H.v.duration || 1, t = H.v.currentTime; $('hProg').style.width = (t / d * 100).toFixed(2) + '%';
  const paso = `${mmss(t)} / ${mmss(d)}`; if ($('hPaso').textContent !== paso) $('hPaso').textContent = paso;
}

/* ── NOVA flotante + chat ── */
const fab = $('fab'), fabSvg = $('fabNova'), globo = $('fabGlobo'), chat = $('chat'), velo = $('velo'), novaF = new Nova('feliz'), novaC = new Nova('feliz'), novaNav = new Nova('normal');
let abierto = false, globoVisto = false, tFabOn = -1;
const RESP = [
  ['What are you?', "I'm Nova, a health copilot for astronauts. I'm designed to watch heart, sleep, stress, bone, muscle and radiation for every crew member, and tell them what changed and why."],
  ['Do you need Earth?', "I'm designed to think on board, offline. Once a night I'd send Mission Control a report of about 6 KB, smaller than a photo."],
  ['Who sees the data?', 'The astronaut would decide. Vital signs go to the flight surgeon, feelings only to their psychologist, and their journal stays theirs.'],
  ['Is this real?', "I'm a concept for the NASA Space Apps Challenge 2026. The team builds my first working prototype during the 48-hour hackathon. The crew and numbers here are demo data."],
  
];
const msgs = $('chatMsgs'), chips = $('chatChips');
function decir(txt, quien){ const m = document.createElement('div'); m.className = 'm ' + quien; m.textContent = txt; msgs.appendChild(m); msgs.scrollTop = msgs.scrollHeight; return m; }
function responder(i){ const [q, a] = RESP[i]; decir(q, 'u'); chips.innerHTML = '';
  const e = document.createElement('div'); e.className = 'm n esc'; e.innerHTML = '<i></i><i></i><i></i>'; setTimeout(() => { msgs.appendChild(e); msgs.scrollTop = msgs.scrollHeight; }, 300);
  setTimeout(() => { e.remove(); decir(a, 'n'); ponerChips(i); }, 1300); }
function ponerChips(menos = -1){ chips.innerHTML = ''; RESP.forEach(([q], i) => { if (i === menos) return; const b = document.createElement('button'); b.textContent = q; b.addEventListener('click', () => responder(i)); chips.appendChild(b); }); }
function abrir(){ abierto = true; globoVisto = true; chat.classList.add('on'); if (movil()) document.documentElement.style.overflow = 'hidden'; velo.classList.add('on'); chat.setAttribute('aria-hidden', 'false');
  if (!msgs.children.length){ decir("Hi, I'm Nova, a concept for watching over the crew on the way to Mars. What would you like to know?", 'n'); ponerChips(); } }
function cerrar(){ abierto = false; chat.classList.remove('on', 'grande'); document.documentElement.style.overflow = ''; velo.classList.remove('on'); chat.setAttribute('aria-hidden', 'true'); }
fab.addEventListener('click', abrir); $('chatX').addEventListener('click', cerrar); velo.addEventListener('click', cerrar);
// en el teléfono la hoja se arrastra: hacia arriba se agranda, hacia abajo se achica o se cierra
{ let y0 = null, dy = 0;
  const ini = e => { if (!movil() || e.target.closest('#chatX')) return; y0 = e.clientY; dy = 0; chat.classList.add('arr'); e.currentTarget.setPointerCapture(e.pointerId); };
  const mov = e => { if (y0 === null) return; dy = e.clientY - y0; chat.style.transform = `translateY(${Math.max(chat.classList.contains('grande') ? 0 : -60, dy)}px)`; };
  const fin = () => { if (y0 === null) return; y0 = null; chat.classList.remove('arr'); chat.style.transform = '';
    if (dy > 110 && !chat.classList.contains('grande')) cerrar(); else if (dy > 70) chat.classList.remove('grande'); else if (dy < -40) chat.classList.add('grande'); };
  ['chatAsa'].map($).concat([chat.querySelector('.c-cab')]).forEach(el => { el.addEventListener('pointerdown', ini); el.addEventListener('pointermove', mov); el.addEventListener('pointerup', fin); el.addEventListener('pointercancel', fin); }); }
addEventListener('keydown', e => { if (e.key === 'Escape' && abierto) cerrar(); });
function flotante(now){
  const enHist = H.sec.getBoundingClientRect().top < innerHeight * .6 && H.sec.getBoundingClientRect().bottom > innerHeight * .4;
  const on = scrollY > innerHeight * .8 && !enHist && !visible($('finNova')) && !abierto;
  if (on && !fab.classList.contains('on')) tFabOn = now; fab.classList.toggle('on', on);
  const g = on && !globoVisto && now - tFabOn > 1 && now - tFabOn < 6; if (!g && globo.classList.contains('on')) globoVisto = true; globo.classList.toggle('on', g);
  if (on || fab.style.opacity !== '0') fabSvg.innerHTML = novaF.dibujar({ x: 60, y: 60 + Math.sin(now * 1.3) * 4, R: 40, t: now, expr: dentroDe(fab) ? 'feliz' : 'normal', mira: relCursor(fab, 1.6, 1.4), orbes: 4, sinHalo: false });
  if (abierto) $('chatNova').innerHTML = novaC.dibujar({ x: 30, y: 31, R: 17, t: now, expr: 'feliz', orbes: 3, sinHalo: true });
}

/* ── NOVA en la tarjeta de radiación ── */
const rdNova = $('rdNova'), novaR = new Nova('normal');
function radNova(now){ if (!rdNova || !visible(rdNova)) return; const sobre = $('radiacion').classList.contains('sobre');
  rdNova.innerHTML = novaR.dibujar({ x: 30, y: 31, R: 18, t: now, expr: sobre ? 'pensativa' : 'normal', orbes: 3, sinHalo: true }); }

/* ── cierre ── */
const fin = $('finNova'), novaFin = new Nova('normal'); let sorpF = -9;
fin.addEventListener('click', () => { sorpF = performance.now() / 1000; setTimeout(abrir, 280); });
function cierre(now){ if (!visible(fin)) return;
  fin.innerHTML = novaFin.dibujar({ x: 200, y: 200 + Math.sin(now * 1.2) * 7, R: 98, t: now, expr: now - sorpF < .9 ? 'sorprendida' : dentroDe(fin) ? 'feliz' : 'normal', mira: relCursor(fin), orbes: 6 }); }

/* ── señales en vivo de los 6 modelos (pequeñas, solo con la sección a la vista) ── */
const SIG = [...document.querySelectorAll('canvas.sig')]; let sigVis = false;
new IntersectionObserver(es => es.forEach(e => sigVis = e.isIntersecting), { rootMargin: '60px' }).observe($('modelos'));
const hipno = Array.from({ length: 40 }, (_, i) => [0, 2, 3, 3, 2, 1, 2, 3, 2, 1, 0, 1, 2, 2, 1, 0][Math.floor(i / 2.6) % 16]);
const golpes = [];
function senales(now){
  if (!sigVis) return;
  SIG.forEach(cv => { const d = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight; if (cv.width !== w * d){ cv.width = w * d; cv.height = h * d; }
    const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, h); const k = cv.dataset.k, amb = k === 'rad';
    c.strokeStyle = amb ? '#f2b457' : '#8fe6f5'; c.fillStyle = c.strokeStyle; c.lineWidth = 1.6; c.lineCap = 'round'; c.lineJoin = 'round';
    c.shadowColor = amb ? 'rgba(242,180,87,.6)' : 'rgba(70,200,232,.6)'; c.shadowBlur = 6; c.beginPath();
    if (k === 'sleep'){ const off = (now * 3) % 1; for (let i = 0; i < 40; i++){ const x = (i - off) / 39 * w, y = 6 + hipno[(i + Math.floor(now * 3)) % 40] * (h - 12) / 3; i ? (c.lineTo(x, c._y ?? y), c.lineTo(x, y)) : c.moveTo(x, y); c._y = y; } c._y = undefined; c.stroke(); }
    else if (k === 'stress'){ for (let i = 0; i < 18; i++){ const v = .45 + .35 * Math.sin(i * 1.7 + now * 1.3) * Math.sin(i * .6 + now * .4) + .1 * Math.sin(now * 4 + i); const x = 4 + i * (w - 8) / 17; c.moveTo(x, h - 3); c.lineTo(x, h - 3 - v * (h - 8)); } c.stroke(); }
    else if (k === 'fatigue'){ for (let i = 0; i <= 60; i++){ const x = i / 60 * w, y = h / 2 - Math.sin(i / 60 * Math.PI * 2 - 1.2) * (h / 2 - 6) * .8; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); const u = (now * .08) % 1, x = u * w, y = h / 2 - Math.sin(u * Math.PI * 2 - 1.2) * (h / 2 - 6) * .8; c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill(); }
    else if (k === 'voice'){ for (let i = 0; i < 26; i++){ const a = Math.abs(Math.sin(now * 5 + i * .9) * Math.sin(now * 1.7 + i * .3)) * (h / 2 - 4) + 1.5, x = 3 + i * (w - 6) / 25; c.moveTo(x, h / 2 - a); c.lineTo(x, h / 2 + a); } c.stroke(); }
    else if (k === 'rad'){ if (Math.random() < .08) golpes.push([Math.random() * w, Math.random() * h, now]); c.beginPath(); c.moveTo(0, h - 2); c.lineTo(w, h - 2); c.globalAlpha = .3; c.stroke(); c.globalAlpha = 1;
      for (let i = golpes.length - 1; i >= 0; i--){ const [x, y, t0] = golpes[i], a = 1 - (now - t0) / 1.4; if (a <= 0){ golpes.splice(i, 1); continue; } c.globalAlpha = a; c.beginPath(); c.arc(x, y, 1.5 + (1 - a) * 5, 0, 7); c.stroke(); } c.globalAlpha = 1; }
    else if (k === 'bone'){ for (let i = 0; i <= 50; i++){ const x = i / 50 * w, y = 8 + i / 50 * (h - 20) * .55 + Math.sin(i * .9) * 1.2 - (i > 30 ? (i - 30) / 20 * 6 : 0); i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
  });
}

/* ── cifras que cuentan al aparecer ── */
const cnt = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; cnt.unobserve(e.target); const el = e.target, n = +el.dataset.n, t0 = performance.now();
  if (reducido) return; (function paso(ms){ const u = Math.min(1, (ms - t0) / 1600), v = 1 - Math.pow(1 - u, 3); el.textContent = Math.round(n * v).toLocaleString('en-US'); if (u < 1) requestAnimationFrame(paso); })(t0); }), { threshold: .6 });
document.querySelectorAll('.cnt').forEach(el => { if (!reducido) el.textContent = '0'; cnt.observe(el); });

/* ── ruta: avanza con el scroll, paso a paso ── */
const ruta = document.querySelector('.ruta'), rPasos = ruta ? [...ruta.querySelectorAll('.r-paso')] : [];
function rutaScroll(){ if (!ruta) return; const r = ruta.getBoundingClientRect(), p = cl((innerHeight * .78 - r.top) / (r.height + innerHeight * .25));
  ruta.style.setProperty('--rp', p.toFixed(3)); rPasos.forEach((el, i) => el.classList.toggle('hecho', p >= i / (rPasos.length - 1) - .02)); }
addEventListener('scroll', rutaScroll, { passive: true }); addEventListener('resize', rutaScroll); rutaScroll();

/* ── parallax suave de la banda ── */
const banda = document.querySelector('.banda');
if (banda && !reducido){ const bp = () => { const r = banda.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return; banda.style.setProperty('--bp', ((innerHeight / 2 - (r.top + r.height / 2)) / innerHeight).toFixed(3)); };
  addEventListener('scroll', bp, { passive: true }); bp(); }

/* ── aparición de bloques ── */
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -12% 0px' });
document.querySelectorAll('.rev').forEach(el => io.observe(el));

/* ── un solo bucle ── */
function bucle(ms){
  const now = ms / 1000;
  $('navNova').innerHTML = novaNav.dibujar({ x: 30, y: 31, R: 15, t: now, expr: 'normal', orbes: 3, sinHalo: true, mira: [Math.sin(now * .5) * .6, 0] });
  historia(now); flotante(now); cierre(now); radNova(now); senales(now);
  requestAnimationFrame(bucle);
}
requestAnimationFrame(bucle);

/* ── videos de NOVA: tarjetas con vista previa al pasar el mouse y reproductor (solo si la página tiene la galería) ── */
if ($('gal')) { const VID = [['teaser', 'Hi. I\'m Nova.', 'TEASER', '0:17'], ['entrena', 'Nova trains for Mars', 'TRAINING', '0:57'], ['aura-nova', 'Nova meets Aura', 'FRIENDS', '0:39'], ['familia', 'One last photo before launch', 'FAMILY', '0:39'], ['historia', 'The full story', 'PRESENTATION', '4:09']];
  const src = id => id === 'historia' ? 'video/nova-pc.mp4' : `video/gal/${id}.mp4`;
  const gal = $('gal'); gal.innerHTML = VID.map(([id, t, k, d]) => `<button class="vc" data-id="${id}" data-t="${t}"><span class="po"><img src="video/gal/${id}.jpg" alt="" loading="lazy"><span class="pl"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg></span><span class="du">${d}</span><span class="bar"><i></i></span></span><small>${k}</small><b>${t}</b></button>`).join('');
  const md = $('vmod'), mv = $('vmv');
  const abrir = c => { mv.src = src(c.dataset.id); $('vtit').textContent = c.dataset.t; md.querySelector('.vmod-in').classList.toggle('ancho', c.dataset.id === 'historia');
    md.classList.add('on'); md.setAttribute('aria-hidden', 'false'); document.documentElement.style.overflow = 'hidden'; mv.currentTime = 0; mv.play().catch(() => {}); };
  const cerrar = () => { mv.pause(); mv.removeAttribute('src'); mv.load(); md.classList.remove('on'); md.setAttribute('aria-hidden', 'true'); document.documentElement.style.overflow = ''; };
  gal.addEventListener('click', e => { const c = e.target.closest('.vc'); if (c) abrir(c); });
  $('vcer').onclick = cerrar; md.onclick = e => { if (e.target === md) cerrar(); }; addEventListener('keydown', e => { if (e.key === 'Escape' && md.classList.contains('on')) cerrar(); });
  if (matchMedia('(hover:hover) and (pointer:fine)').matches && !reducido){
    const PREV = 4, DESDE = .5;
    gal.querySelectorAll('.vc').forEach(c => { let v = null, raf = 0, tm = 0;
      const parar = () => { clearTimeout(tm); cancelAnimationFrame(raf); if (v){ v.classList.remove('on'); setTimeout(() => { if (!v.classList.contains('on')) v.pause(); }, 450); } c.querySelector('.bar i').style.transform = 'scaleX(0)'; };
      c.addEventListener('pointerenter', () => { tm = setTimeout(() => {
        if (!v){ v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'none'; v.src = src(c.dataset.id) + '#t=' + DESDE; c.querySelector('.po').insertBefore(v, c.querySelector('.pl')); }
        try { v.currentTime = DESDE; } catch (e) {}
        v.play().then(() => { v.classList.add('on'); const b = c.querySelector('.bar i'); (function paso(){ const k = Math.min(1, (v.currentTime - DESDE) / PREV); b.style.transform = `scaleX(${k})`; if (k >= 1) return parar(); raf = requestAnimationFrame(paso); })(); }).catch(() => {});
      }, 200); });
      c.addEventListener('pointerleave', parar); }); } }
})();
