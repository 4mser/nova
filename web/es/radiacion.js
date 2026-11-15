/* Radiación interactiva: una misión ilustrativa a Marte (180 días de crucero de ida, 500 en la superficie, 180 de vuelta)
   con las tasas medidas por MSL RAD: 1,84 mSv/día en crucero (Zeitlin et al. 2013) y 0,64 mSv/día en la superficie (Hassler et al. 2014).
   Se arrastra el día de misión; una tormenta solar suma dosis, y con el aviso de NOVA el crew va al refugio y recibe mucho menos. */
(() => {
const sec = document.getElementById('radiacion'); if (!sec) return;
const cv = document.getElementById('rdCv'), c = cv.getContext('2d'), rango = document.getElementById('rdDia'), bPlay = document.getElementById('rdPlay'), bTorm = document.getElementById('rdTorm');
const $ = id => document.getElementById(id), cl = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), lerp = (a, b, x) => a + (b - a) * x;
const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FASES = [{ n: 'Crucero a Marte', d0: 0, d1: 180, r: 1.84 }, { n: 'En la superficie de Marte', d0: 180, d1: 680, r: .64 }, { n: 'Crucero de regreso', d0: 680, d1: 860, r: 1.84 }];
const FIN = 860, LIM = 600, YMAX = 1100, TORM_SIN = 80, TORM_CON = 12;   // tormenta ilustrativa: sin refugio vs con el aviso de NOVA
const tormentas = [];   // { dia, sin, con, t }
let dia = 40, jugando = !reducido, W = 0, H = 0, DPR = 1, vivo = false, tp = 0, ultTorm = -9;

const fase = d => FASES.find(f => d >= f.d0 && d < f.d1) || FASES[2];
const base = d => { let s = 0; for (const f of FASES) s += Math.max(0, Math.min(d, f.d1) - f.d0) * f.r; return s; };
const extra = d => tormentas.reduce((s, x) => s + (d >= x.dia ? x.con * cl((d - x.dia) / 3) : 0), 0);
const dosis = d => base(d) + extra(d);
const cruce = () => { for (let d = 0; d <= FIN; d += .5) if (dosis(d) >= LIM) return d; return null; };

function medir(){ DPR = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * DPR; cv.height = H * DPR; }
addEventListener('resize', medir);

/* partículas de radiación cósmica que cruzan la escena */
const RAYOS = Array.from({ length: 70 }, (_, i) => ({ x: Math.random(), y: Math.random(), v: .12 + Math.random() * .25, l: .02 + Math.random() * .05, a: .15 + Math.random() * .35 }));
let chispas = [];

function dibujar(now, dt){
  c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, W, H);
  const mov = W < 700, hE = mov ? H * .5 : H * .56, top = 0;   // escena arriba, gráfico abajo
  // ── escena ──
  const sol = [W * .04, hE * .14], tierra = [W * (mov ? .14 : .16), hE * .7], marte = [W * (mov ? .86 : .84), hE * .7], cima = [W * .5, hE * .16];
  const bz = u => [(1 - u) ** 2 * tierra[0] + 2 * (1 - u) * u * cima[0] + u * u * marte[0], (1 - u) ** 2 * tierra[1] + 2 * (1 - u) * u * cima[1] + u * u * marte[1]];
  let g = c.createRadialGradient(sol[0], sol[1], 0, sol[0], sol[1], hE * .9); g.addColorStop(0, 'rgba(255,214,140,.55)'); g.addColorStop(.25, 'rgba(242,180,87,.16)'); g.addColorStop(1, 'rgba(242,180,87,0)');
  c.fillStyle = g; c.fillRect(0, top, W, hE);
  // rayos cósmicos
  c.lineCap = 'round';
  for (const r of RAYOS){ if (!reducido){ r.x += r.v * dt * .35; r.y += r.v * dt * .12; if (r.x > 1.05){ r.x = -.05; r.y = Math.random() * .9; } if (r.y > 1) r.y -= 1; }
    const x = r.x * W, y = top + r.y * hE; c.strokeStyle = `rgba(143,230,245,${r.a * .5})`; c.lineWidth = 1; c.beginPath(); c.moveTo(x - r.l * W, y - r.l * W * .34); c.lineTo(x, y); c.stroke(); }
  // trayectoria
  c.setLineDash([3, 8]); c.strokeStyle = 'rgba(150,185,215,.28)'; c.lineWidth = 1.4; c.beginPath(); for (let i = 0; i <= 60; i++){ const p = bz(i / 60); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); } c.stroke(); c.setLineDash([]);
  const planeta = (p, r, a, b, nom) => { const gg = c.createRadialGradient(p[0] - r * .3, p[1] - r * .3, 0, p[0], p[1], r); gg.addColorStop(0, a); gg.addColorStop(1, b); c.fillStyle = gg; c.beginPath(); c.arc(p[0], p[1], r, 0, 7); c.fill();
    c.font = '500 11px PM'; c.fillStyle = '#8c99a9'; c.textAlign = 'center'; c.fillText(nom, p[0], p[1] + r + 18); };
  planeta(tierra, mov ? 13 : 18, '#8fe6f5', '#0a4458', 'TIERRA'); planeta(marte, mov ? 10 : 14, '#ffd59a', '#7a3a1a', 'MARTE');
  // nave
  const f = fase(dia); let pos;
  if (dia < 180) pos = bz(dia / 180); else if (dia < 680){ const a = (dia - 180) * .08; pos = [marte[0] + Math.cos(a) * 26, marte[1] + Math.sin(a) * 12]; } else pos = bz(1 - (dia - 680) / 180);
  // tormenta en curso
  const tt = now - ultTorm, torm = tt < 3.2;
  if (torm){ const k = tt / 3.2; for (let i = 0; i < 4; i++) chispas.push({ x: sol[0], y: sol[1], vx: (pos[0] - sol[0]) * (.6 + Math.random() * .5), vy: (pos[1] - sol[1]) * (.6 + Math.random() * .5) + (Math.random() - .5) * 120, t: 0 }); }
  chispas = chispas.filter(p => (p.t += dt) < 1.2); for (const p of chispas){ const x = p.x + p.vx * p.t, y = p.y + p.vy * p.t; c.fillStyle = `rgba(236,106,168,${(1 - p.t / 1.2) * .9})`; c.beginPath(); c.arc(x, y, 1.8, 0, 7); c.fill(); }
  if (torm){ const k = Math.sin(Math.min(1, tt / .3) * Math.PI / 2) * (1 - Math.max(0, tt - 2.4) / .8); c.strokeStyle = `rgba(143,230,245,${.8 * k})`; c.lineWidth = 3; c.beginPath(); c.arc(pos[0], pos[1], 22, -Math.PI * .95, -Math.PI * .05 + Math.PI * .4); c.stroke(); }
  g = c.createRadialGradient(pos[0], pos[1], 0, pos[0], pos[1], 26); g.addColorStop(0, 'rgba(143,230,245,.7)'); g.addColorStop(1, 'rgba(143,230,245,0)'); c.fillStyle = g; c.beginPath(); c.arc(pos[0], pos[1], 26, 0, 7); c.fill();
  c.fillStyle = '#fff'; c.beginPath(); c.arc(pos[0], pos[1], 4.5, 0, 7); c.fill();

  // ── gráfico de dosis acumulada ──
  const gx0 = mov ? 16 : 70, gx1 = W - (mov ? 16 : 40), gy0 = hE + (mov ? 54 : 46), gy1 = H - (mov ? 30 : 34);
  const X = d => gx0 + (gx1 - gx0) * d / FIN, Y = v => gy1 - (gy1 - gy0) * v / YMAX;
  FASES.forEach((fz, i) => { c.fillStyle = i === 1 ? 'rgba(242,180,87,.035)' : 'rgba(70,200,232,.035)'; c.fillRect(X(fz.d0), gy0, X(fz.d1) - X(fz.d0), gy1 - gy0);
    c.font = '500 10.5px PM'; c.fillStyle = fz === f ? '#e8eef5' : '#5d6a7a'; c.textAlign = 'center'; c.fillText(mov ? ['Ida', 'Marte', 'Regreso'][i] : fz.n.toUpperCase(), (X(fz.d0) + X(fz.d1)) / 2, gy1 + 18); });
  c.strokeStyle = 'rgba(150,185,215,.14)'; c.lineWidth = 1; [0, 300, 600, 900].forEach(v => { c.beginPath(); c.moveTo(gx0, Y(v)); c.lineTo(gx1, Y(v)); c.stroke(); if (!mov){ c.font = '500 10.5px PM'; c.fillStyle = '#5d6a7a'; c.textAlign = 'right'; c.fillText(v, gx0 - 10, Y(v) + 4); } });
  // límite
  c.setLineDash([6, 6]); c.strokeStyle = '#f2b457'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(gx0, Y(LIM)); c.lineTo(gx1, Y(LIM)); c.stroke(); c.setLineDash([]);
  c.font = '500 11px PM'; c.fillStyle = '#f2b457'; c.textAlign = 'left'; c.fillText('LÍMITE DE CARRERA NASA · 600 mSv', gx0 + 8, Y(LIM) - 8);
  // curva completa (tenue) y recorrida (brillante)
  const curva = (d1, est, ancho) => { c.strokeStyle = est; c.lineWidth = ancho; c.beginPath(); for (let d = 0; d <= d1; d += 4){ const x = X(d), y = Y(dosis(d)); d ? c.lineTo(x, y) : c.moveTo(x, y); } c.lineTo(X(d1), Y(dosis(d1))); c.stroke(); };
  curva(FIN, 'rgba(150,185,215,.22)', 1.4);
  const sobre = dosis(dia) > LIM; c.save(); c.shadowColor = sobre ? '#f2b457' : '#46c8e8'; c.shadowBlur = 12; curva(dia, sobre ? '#f2b457' : '#8fe6f5', 2.6); c.restore();
  // tormentas en el gráfico
  tormentas.forEach(x => { const px = X(x.dia); c.strokeStyle = 'rgba(236,106,168,.6)'; c.lineWidth = 1; c.beginPath(); c.moveTo(px, gy0); c.lineTo(px, gy1); c.stroke(); c.fillStyle = '#ec6aa8'; c.beginPath(); c.arc(px, gy0 + 4, 3.5, 0, 7); c.fill(); });
  // cursor
  const cx0 = X(dia), cy0 = Y(dosis(dia)); c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(cx0, gy0); c.lineTo(cx0, gy1); c.stroke();
  c.fillStyle = '#fff'; c.beginPath(); c.arc(cx0, cy0, 5, 0, 7); c.fill(); c.strokeStyle = sobre ? '#f2b457' : '#8fe6f5'; c.lineWidth = 2; c.beginPath(); c.arc(cx0, cy0, 9, 0, 7); c.stroke();
  medidas.X = X; medidas.gx0 = gx0; medidas.gx1 = gx1; medidas.gy0 = gy0;
}
const medidas = {};

/* lecturas y mensaje de NOVA */
function lecturas(now){
  const f = fase(dia), d = dosis(dia), x = cruce();
  $('rdDiaN').textContent = Math.round(dia); $('rdFase').textContent = f.n; $('rdTasa').textContent = f.r.toFixed(2).replace('.', ',');
  $('rdTot').textContent = Math.round(d); $('rdPct').textContent = Math.round(d / LIM * 100) + ' %'; $('rdBar').style.width = Math.min(100, d / LIM * 100) + '%';
  sec.classList.toggle('sobre', d > LIM);
  let msg;
  if (now - ultTorm < 4.5){ const T = tormentas[tormentas.length - 1]; msg = `Tormenta solar. Todos al refugio. Así cada uno se ahorró unos <b>${T.sin - T.con} mSv</b>.`; }
  else if (d > LIM) msg = `Superamos el límite de carrera el día <b>${Math.round(x)}</b>. Reduzco las caminatas espaciales y sumo tiempo en el refugio.`;
  else if (x) msg = `A este ritmo, la tripulación llega al límite el día <b>${Math.round(x)}</b>. Ya estoy planificando para evitarlo.`;
  else msg = 'La dosis está dentro del presupuesto durante toda la misión.';
  if ($('rdMsg').dataset.m !== msg){ $('rdMsg').dataset.m = msg; $('rdMsg').innerHTML = msg; }
}

/* controles */
rango.addEventListener('input', () => { dia = +rango.value; jugando = false; bPlay.classList.remove('on'); });
bPlay.addEventListener('click', () => { jugando = !jugando; if (jugando && dia >= FIN - 1) dia = 0; bPlay.classList.toggle('on', jugando); });
bTorm.addEventListener('click', () => { if (dia >= FIN - 3) dia = 60; tormentas.push({ dia, sin: TORM_SIN, con: TORM_CON }); ultTorm = performance.now() / 1000; });
// arrastrar sobre el gráfico también mueve el día
let arr = false; const aDia = e => { const r = cv.getBoundingClientRect(), x = e.clientX - r.left; if (!medidas.X) return; dia = cl((x - medidas.gx0) / (medidas.gx1 - medidas.gx0)) * FIN; jugando = false; bPlay.classList.remove('on'); };
cv.addEventListener('pointerdown', e => { const r = cv.getBoundingClientRect(); if (e.clientY - r.top < (medidas.gy0 || 0) - 30) return; arr = true; cv.setPointerCapture(e.pointerId); aDia(e); });
cv.addEventListener('pointermove', e => { if (arr) aDia(e); }); cv.addEventListener('pointerup', () => arr = false);

new IntersectionObserver(es => es.forEach(e => { vivo = e.isIntersecting; if (vivo && !W) medir(); }), { rootMargin: '100px' }).observe(sec);
bPlay.classList.toggle('on', jugando);
function bucle(ms){ requestAnimationFrame(bucle); if (!vivo) return; const now = ms / 1000, dt = Math.min(.05, tp ? now - tp : 0); tp = now;
  if (jugando){ dia += dt * 38; if (dia >= FIN){ dia = FIN; jugando = false; bPlay.classList.remove('on'); } }
  rango.value = dia; if (!W) medir(); dibujar(now, dt); lecturas(now); }
requestAnimationFrame(bucle);
})();
