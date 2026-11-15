/* Equipo B&N en vivo: la misma composición de la imagen del equipo (malla de espacio-tiempo hundida por cada atractor,
   atractores renderizados por densidad dentro de anillos), pero calculada en el navegador e interactiva:
   giran en 3D, se arrastran, una partícula recorre cada trayectoria, el pozo se hunde al pasar el cursor
   y un clic lanza dos partículas casi idénticas que se separan (dependencia sensible a las condiciones iniciales). */
(() => {
const sec = document.getElementById('equipo'); if (!sec) return;
const malla = document.getElementById('eqMalla'), mx = malla.getContext('2d'), mbs = [...sec.querySelectorAll('.mb')];
const DPR = Math.min(2, devicePixelRatio || 1), reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
// en el teléfono los atractores giran solos con menos puntos y sin interacción (el dedo hace scroll, no los toma)
const QUIETO = matchMedia('(max-width:920px)').matches || reducido, GIRA = QUIETO && !reducido;

const SIS = [
  { nom: 'thomas', dt: .03, f: (x, y, z) => [Math.sin(y) - .18 * x, Math.sin(z) - .18 * y, Math.sin(x) - .18 * z], sem: [.12, .16, -.09], ejes: [0, 1], yaw: .6, tilt: .4, gan: 1.4, N: 170000, v: .14,
    pal: ['#020a10', '#0b4a5a', '#1fb3b0', '#8ff5e4', '#ffffff'], rgb: '127,230,216' },
  { nom: 'lorenz', dt: .0025, f: (x, y, z) => [10 * (y - x), x * (28 - z) - y, x * y - 8 * z / 3], sem: [.1, 0, 0], ejes: [0, 2], yaw: .5, tilt: .12, gan: .45, gam: .9, N: 130000, v: .1, paso: 6,
    pal: ['#02060f', '#0f2f78', '#2f78ff', '#9fd0ff', '#ffffff'], rgb: '142,197,255' },
  { nom: 'sprott', dt: .008, f: (x, y, z) => [y + z, -x + .5 * y, x * x - z], sem: [.034, .177, .087], ejes: [0, 1], yaw: .5, tilt: .35, sc: .92, N: 170000, v: .12, paso: 3,
    pal: ['#0a0602', '#5a3a12', '#d9963a', '#ffd9a0', '#ffffff'], rgb: '246,194,122' },
  { nom: 'rossler', dt: .006, f: (x, y, z) => [-y - z, x + .2 * y, .2 + z * (x - 5.7)], sem: [1, 1, 0], ejes: [0, 1], yaw: .25, tilt: -1.05, sc: .84, N: 170000, v: .08, paso: 4,
    pal: ['#05030f', '#2c1a78', '#7a5cff', '#d2c4ff', '#ffffff'], rgb: '195,178,255' },
];
function rk4(f, h, p){ const a = f(p[0], p[1], p[2]), b = f(p[0] + a[0] * h / 2, p[1] + a[1] * h / 2, p[2] + a[2] * h / 2),
  c = f(p[0] + b[0] * h / 2, p[1] + b[1] * h / 2, p[2] + b[2] * h / 2), d = f(p[0] + c[0] * h, p[1] + c[1] * h, p[2] + c[2] * h);
  p[0] += h * (a[0] + 2 * b[0] + 2 * c[0] + d[0]) / 6; p[1] += h * (a[1] + 2 * b[1] + 2 * c[1] + d[1]) / 6; p[2] += h * (a[2] + 2 * b[2] + 2 * c[2] + d[2]) / 6; }
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

/* ── cada atractor: trayectoria precalculada en 3D, centrada por su caja ── */
function preparar(S, el){
  const p = S.sem.slice(); for (let i = 0; i < 20000; i++) rk4(S.f, S.dt, p);
  if (QUIETO) S.N = Math.round(S.N * .4);
  const A = S.ejes[0], B = S.ejes[1], C = 3 - A - B, N = S.N, P = new Float32Array(N * 3);
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < N; i++){ rk4(S.f, S.dt, p); const v = [p[A], p[B], p[C]]; for (let k = 0; k < 3; k++){ P[i * 3 + k] = v[k]; lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); } }
  const o = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2); let r = 0;
  for (let i = 0; i < N; i++){ for (let k = 0; k < 3; k++) P[i * 3 + k] -= o[k]; r = Math.max(r, Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])); }
  const LUT = new Uint8ClampedArray(256 * 4); for (let i = 0; i < 256; i++){ const t = i / 255, q = t * (S.pal.length - 1), j = Math.min(S.pal.length - 2, Math.floor(q)), f = q - j, a = hex(S.pal[j]), b = hex(S.pal[j + 1]);
    for (let k = 0; k < 3; k++) LUT[i * 4 + k] = a[k] + (b[k] - a[k]) * f; LUT[i * 4 + 3] = Math.min(255, t * 330); }
  const cv = el.querySelector('canvas.at'), brillo = el.querySelector('canvas.br');
  Object.assign(S, { P, r, o, A, B, C, LUT, cv, brillo, ctx: cv.getContext('2d'), bctx: brillo.getContext('2d'), yawV: S.yaw, tiltV: S.tilt, drag: null, ref: 0,
    est: p.slice(), cola: [], par: null, el, hover: 0, listo: true });
  // la partícula vive en las coordenadas originales; para dibujarla se le resta el mismo centro
  S.vivo = () => [S.est[A] - o[0], S.est[B] - o[1], S.est[C] - o[2]];
}

/* ── marcas de cada anillo (como en la imagen: 120 marcas, una larga de color cada 10) ── */
mbs.forEach(el => { const col = getComputedStyle(el).getPropertyValue('--c').trim(); let g = '<circle cx="100" cy="100" r="92" fill="none" stroke="rgba(255,255,255,.12)" stroke-width=".6"/>';
  for (let i = 0; i < 120; i++){ const a = i / 120 * Math.PI * 2, l = i % 10 === 0 ? 5.5 : 2.2, r0 = 92;
    g += `<line x1="${(100 + Math.cos(a) * r0).toFixed(2)}" y1="${(100 + Math.sin(a) * r0).toFixed(2)}" x2="${(100 + Math.cos(a) * (r0 + l)).toFixed(2)}" y2="${(100 + Math.sin(a) * (r0 + l)).toFixed(2)}" stroke="${i % 10 === 0 ? col : 'rgba(255,255,255,.18)'}" stroke-width="${i % 10 === 0 ? .9 : .55}"/>`; }
  el.querySelector('.tics').innerHTML = g; });

/* ── interacción: arrastrar para girar, clic para el efecto mariposa ── */
mbs.forEach((el, i) => {
  if (QUIETO) return;
  const S = SIS[i], z = el.querySelector('.anillo');
  el.addEventListener('pointerenter', () => el.classList.add('on')); el.addEventListener('pointerleave', () => el.classList.remove('on'));
  z.addEventListener('pointerdown', e => { S.drag = { x: e.clientX, y: e.clientY, yaw: S.yawV, tilt: S.tiltV, mov: 0 }; z.setPointerCapture(e.pointerId); });
  z.addEventListener('pointermove', e => { if (!S.drag) return; const dx = e.clientX - S.drag.x, dy = e.clientY - S.drag.y; S.drag.mov = Math.max(S.drag.mov, Math.hypot(dx, dy));
    S.yawV = S.drag.yaw + dx * .012; S.tiltV = S.drag.tilt + dy * .012; });
  const suelta = () => { if (S.drag && S.drag.mov < 6 && S.listo){ const a = S.est.slice(), b = S.est.slice(); b[0] += 1e-3; S.par = { a, b, ca: [], cb: [], t: 0 }; } S.drag = null; };
  z.addEventListener('pointerup', suelta); z.addEventListener('pointercancel', () => S.drag = null);
});

/* ── tamaños ── */
let W = 0, H = 0, centros = [];
function medir(){
  const r = sec.getBoundingClientRect(); W = sec.clientWidth; H = sec.clientHeight;
  malla.width = W * DPR; malla.height = H * DPR; malla.style.width = W + 'px'; malla.style.height = H + 'px';
  centros = mbs.map(el => { const a = el.querySelector('.anillo').getBoundingClientRect(); return [a.left - r.left + a.width / 2, a.top - r.top + a.height / 2, a.width / 2]; });
  mbs.forEach((el, i) => { const a = el.querySelector('.anillo'), d = Math.round(a.clientWidth * Math.min(DPR, 1.5)), S = SIS[i];
    for (const c of a.querySelectorAll('canvas')){ c.width = c.height = d; }
    S.SZ = d; S.D = new Float32Array(d * d); S.img = S.ctx ? S.ctx.createImageData(d, d) : null; S.ref = 0; });
  pozos.forEach((_, i) => pozos[i] = pozos[i] || 1); mallaSucia = true;
}

/* ── malla de espacio-tiempo: lámina hundida por un pozo h = −A/√(d² + s²) bajo cada atractor ── */
const pozos = [1, 1, 1, 1]; let mallaSucia = true;
const estrellas = []; { let sd = 7; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  for (let i = 0; i < 520; i++) estrellas.push([rnd(), rnd() * .8, rnd() < .95 ? rnd() * .6 + .2 : rnd() + .5, rnd() * .35 + .05]); }
function dibujarMalla(){
  const c = mx; c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, W, H);
  estrellas.forEach(([x, y, r, a]) => { c.fillStyle = `rgba(215,228,255,${a})`; c.beginPath(); c.arc(x * W, y * H, r, 0, 7); c.fill(); });
  const ys = centros.map(c2 => c2[1]), s = Math.max(W, 980) / 1800, PH = 50 * Math.PI / 180, cph = Math.cos(PH), sph = Math.sin(PH), CH = 20, FO = 1100 * s,
    CY0 = W > 920 || !ys.length ? H * .5 : (Math.min(...ys) + Math.max(...ys)) / 2;
  const proy = (x, y, z) => { const ry = y - CH, zc = -ry * sph + z * cph, yc = ry * cph + z * sph; return zc > .3 ? [W / 2 + FO * x / zc, CY0 - FO * yc / zc] : null; };
  const alPlano = (sx, sy) => { const a = (sx - W / 2) / FO, b = (CY0 - sy) / FO, dy = b * cph - sph, dz = b * sph + cph, t = -CH / dy; return [a * t, dz * t]; };
  const M = centros.map(([x, y, r], i) => { const [px, pz] = alPlano(x, y + r * .18); return [px, pz, SIS[i].rgb, pozos[i]]; });
  const S2 = 10, A = 26;
  const alto = (x, z) => { let h = 0; for (const [px, pz, , k] of M) h -= A * k / Math.sqrt((x - px) ** 2 + (z - pz) ** 2 + S2); return h; };
  // rango del plano: se muestrea toda la pantalla y solo cuentan los puntos que caen delante de la cámara
  let X0 = -60, X1 = 60, Z0 = 1e9, Z1 = -1e9;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 12; j++){ const sx = -200 + (W + 400) * i / 8, sy = -100 + (H + 200) * j / 12, b = (CY0 - sy) / FO;
    if (b * cph - sph >= -.02) continue; const [x, z] = alPlano(sx, sy); if (z <= 0) continue; X0 = Math.min(X0, x); X1 = Math.max(X1, x); Z0 = Math.min(Z0, z); Z1 = Math.max(Z1, z); }
  if (Z1 < Z0) return; Z0 = Math.max(.5, Z0 - 2); Z1 += 2; X0 = Math.max(X0, -160); X1 = Math.min(X1, 160);
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineWidth = .8;
  const seg = (x0, z0, x1, z1) => { const p = proy(x0, alto(x0, z0), z0), q = proy(x1, alto(x1, z1), z1); if (!p || !q) return;
    let best = M[0], dmin = 1e9; for (const m of M){ const d = Math.hypot((x0 + x1) / 2 - m[0], (z0 + z1) / 2 - m[1]); if (d < dmin){ dmin = d; best = m; } }
    const t = Math.exp(-dmin * dmin / 70), a = .055 + .42 * t * (.7 + .3 * best[3]);
    c.strokeStyle = t > .06 ? `rgba(${best[2]},${a.toFixed(3)})` : `rgba(205,216,232,${a.toFixed(3)})`; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke(); };
  const fino = .25;
  for (let x = Math.floor(X0); x <= X1; x += 1) for (let z = Z0; z < Z1; z += fino) seg(x, z, x, z + fino);
  for (let z = Math.floor(Z0); z <= Z1; z += 1) for (let x = X0; x < X1; x += fino) seg(x, z, x + fino, z);
  c.restore();
  // se apaga arriba (mandan los atractores) y detrás de los textos
  c.save(); c.globalCompositeOperation = 'destination-out';
  const borra = (cx, cy, rx, ry) => { c.save(); c.translate(cx, cy); c.scale(rx, ry); const g = c.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(.6, 'rgba(0,0,0,.85)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, 1, 0, 7); c.fill(); c.restore(); };
  const sr = sec.getBoundingClientRect();
  mbs.forEach(el => { const t = el.querySelector('.txt').getBoundingClientRect(); borra(t.left - sr.left + t.width / 2, t.top - sr.top + t.height / 2, t.width * .62, t.height * .9); });
  const pie = sec.querySelector('.eq-pie'); if (pie){ const t = pie.getBoundingClientRect(); borra(t.left - sr.left + t.width / 2, t.top - sr.top + t.height / 2, t.width * .62, t.height * 1.2); }
  const tope = centros.length ? Math.min(...centros.map(c2 => c2[1])) : H * .5, vt = c.createLinearGradient(0, 0, 0, tope + 10);
  vt.addColorStop(0, 'rgba(0,0,0,1)'); vt.addColorStop(.35, 'rgba(0,0,0,.9)'); vt.addColorStop(.75, 'rgba(0,0,0,.45)'); vt.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = vt; c.fillRect(0, 0, W, tope + 10); c.restore();
}

/* ── un cuadro de un atractor: densidad de la nube girada + partícula viva ── */
function cuadro(S, dt){
  if (!S.listo || !S.SZ) return;
  if (!S.drag && !reducido) S.yawV += S.v * dt;
  const SZ = S.SZ, D = S.D, P = S.P, N = S.N; D.fill(0);
  const cY = Math.cos(S.yawV), sY = Math.sin(S.yawV), cT = Math.cos(S.tiltV), sT = Math.sin(S.tiltV), k = (SZ / 2 - SZ * .05) / S.r * (S.sc || 1) * 1.08, h = SZ / 2;
  const proy = (a, b, c) => { const a1 = a * cY + c * sY, c1 = c * cY - a * sY, b1 = b * cT - c1 * sT, d = b * sT + c1 * cT; return [h + a1 * k, h - b1 * k, d]; };
  for (let i = 0; i < N; i++){ const a = P[i * 3], b = P[i * 3 + 1], c = P[i * 3 + 2], a1 = a * cY + c * sY, c1 = c * cY - a * sY, b1 = b * cT - c1 * sT, d = b * sT + c1 * cT;
    const fx = h + a1 * k, fy = h - b1 * k, x0 = fx | 0, y0 = fy | 0; if (x0 < 0 || y0 < 0 || x0 >= SZ - 1 || y0 >= SZ - 1) continue;
    const dx = fx - x0, dy = fy - y0, w = .55 + .45 * (.5 + d / (2 * S.r)), j = y0 * SZ + x0;
    D[j] += (1 - dx) * (1 - dy) * w; D[j + 1] += dx * (1 - dy) * w; D[j + SZ] += (1 - dx) * dy * w; D[j + SZ + 1] += dx * dy * w; }
  if (!S.ref){ const v = []; for (let i = 0; i < D.length; i += 3) if (D[i] > 0) v.push(D[i]); v.sort((a, b) => a - b); S.ref = v[Math.floor(v.length * .997)] || 1; }
  const K = 40, GAN = (S.gan || 1) * (1 + .25 * S.hover), lk = Math.log(1 + K), gam = S.gam || .85, img = S.img, L = S.LUT, px = img.data;
  for (let i = 0; i < D.length; i++){ const q = i * 4; if (!D[i]){ px[q + 3] = 0; continue; }
    const t = Math.pow(Math.log(1 + K * GAN * D[i] / S.ref) / lk, gam), n = Math.min(255, t * 255 | 0) * 4;
    px[q] = L[n]; px[q + 1] = L[n + 1]; px[q + 2] = L[n + 2]; px[q + 3] = L[n + 3]; }
  S.ctx.putImageData(img, 0, 0);
  if (QUIETO){ S.bctx.clearRect(0, 0, SZ, SZ); S.bctx.drawImage(S.cv, 0, 0); return; }
  // partícula viva con estela
  const pasos = S.paso || 2; for (let j = 0; j < pasos; j++) rk4(S.f, S.dt, S.est);
  const v = S.vivo(); S.cola.push(proy(v[0], v[1], v[2])); if (S.cola.length > 70) S.cola.shift();
  const c = S.ctx; c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
  const estela = (cola, rgb, ancho) => { for (let j = 1; j < cola.length; j++){ const u = j / cola.length; c.strokeStyle = `rgba(${rgb},${(u * .9).toFixed(3)})`; c.lineWidth = ancho * (.3 + u); c.beginPath(); c.moveTo(cola[j - 1][0], cola[j - 1][1]); c.lineTo(cola[j][0], cola[j][1]); c.stroke(); }
    const e = cola[cola.length - 1]; if (e){ const g = c.createRadialGradient(e[0], e[1], 0, e[0], e[1], SZ * .03); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, `rgba(${rgb},0)`); c.fillStyle = g; c.beginPath(); c.arc(e[0], e[1], SZ * .03, 0, 7); c.fill(); } };
  if (!S.par) estela(S.cola, '255,255,255', SZ * .006);
  // efecto mariposa: dos partículas separadas por 0,001 que terminan en lados distintos
  if (S.par){ const Q = S.par; Q.t += dt; const en = q => proy(q[S.A] - S.o[0], q[S.B] - S.o[1], q[S.C] - S.o[2]);
    for (let j = 0; j < pasos * 3; j++){ rk4(S.f, S.dt, Q.a); rk4(S.f, S.dt, Q.b); Q.ca.push(en(Q.a)); Q.cb.push(en(Q.b)); }
    while (Q.ca.length > 330){ Q.ca.shift(); Q.cb.shift(); }
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = Math.min(1, (12 - Q.t) / 1.5); estela(Q.ca, '255,70,160', SZ * .011); estela(Q.cb, '90,255,190', SZ * .011); c.globalAlpha = 1;
    S.el.querySelector('.delta').textContent = 'Δ = ' + Math.hypot(Q.a[0] - Q.b[0], Q.a[1] - Q.b[1], Q.a[2] - Q.b[2]).toExponential(1);
    if (Q.t > 12){ S.par = null; S.el.querySelector('.delta').textContent = ''; } }
  c.restore();
  S.bctx.clearRect(0, 0, SZ, SZ); S.bctx.drawImage(S.cv, 0, 0);
}

/* ── arranque perezoso y bucle (solo con la sección a la vista) ── */
let vivo = false, armado = false, tp = 0, cola = 0;
function armar(){ if (armado) return; armado = true; medir();
  SIS.forEach((S, i) => setTimeout(() => { preparar(S, mbs[i]); S.img = S.ctx.createImageData(S.SZ, S.SZ); if (QUIETO) cuadro(S, 0); mbs[i].classList.add('listo'); }, 60 + i * 140)); }
new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) armar(); }), { rootMargin: '700px' }).observe(sec);
new IntersectionObserver(es => es.forEach(e => vivo = e.isIntersecting), { rootMargin: '80px' }).observe(sec);
let rz = 0, anchoPrev = innerWidth; addEventListener('resize', () => { if (QUIETO && innerWidth === anchoPrev) return; anchoPrev = innerWidth; clearTimeout(rz); rz = setTimeout(() => { if (armado){ medir(); if (QUIETO) SIS.forEach(S => { if (S.listo){ S.img = S.ctx.createImageData(S.SZ, S.SZ); cuadro(S, 0); } }); } }, 150); });
function bucle(ms){
  requestAnimationFrame(bucle);
  if (!vivo || !armado) return;
  const now = ms / 1000, dt = Math.min(.05, tp ? now - tp : 0); tp = now;
  // los pozos se hunden con el cursor (la malla se redibuja solo mientras cambian)
  mbs.forEach((el, i) => { const obj = el.classList.contains('on') ? 1.9 : 1, S = SIS[i]; S.hover += ((el.classList.contains('on') ? 1 : 0) - S.hover) * (1 - Math.exp(-dt * 6));
    if (Math.abs(pozos[i] - obj) > .004){ pozos[i] += (obj - pozos[i]) * (1 - Math.exp(-dt * 7)); mallaSucia = true; } });
  if (mallaSucia){ mallaSucia = false; dibujarMalla(); }
  if (QUIETO){ if (!GIRA) return; cola = (cola + 1) % 4; const S = SIS[cola], r = S.el.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) cuadro(S, dt * 4); return; }
  cola = (cola + 1) % 2; SIS.forEach((S, i) => { if (i % 2 === cola || S.drag || S.par || S.hover > .05) cuadro(S, dt * 2); });
}
requestAnimationFrame(bucle);
})();
