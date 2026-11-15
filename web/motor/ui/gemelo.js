/* Gemelo digital: malla humana real (MakeHuman, CC0) muestreada en puntos con normales; holograma con borde luminoso.
   Esqueleto y órganos se ubican con las articulaciones reales de la malla. */
let GEM_HC = [.025, 1.25, .05];
const GEM = (() => {
  const x = new XMLHttpRequest(); x.open('GET', 'cuerpo.json', false); x.send(); const D = JSON.parse(x.responseText), J = D.J;
  let sd = 7; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  const P = [];
  D.piel.forEach(p => P.push([p[0], p[1], p[2], 0, p[3], p[4], p[5]]));
  const add = (x, y, z, tag) => P.push([x, y, z, tag, 0, 0, 1]);
  const esfera = (c, r, n, tag, f) => { for (let i = 0; i < n; i++){ const u = rnd() * 2 - 1, th = rnd() * 6.283, s = Math.sqrt(1 - u * u); let q = [s * Math.cos(th), u, s * Math.sin(th)]; const k = f ? f(q) : 1; add(c[0] + r[0] * q[0] * k, c[1] + r[1] * q[1] * k, c[2] + r[2] * q[2] * k, tag); } };
  const hueso = (a, b, r, n, tag, cabezas = 0) => { for (let i = 0; i < n; i++){ const u = rnd(), th = rnd() * 6.283, ensanche = 1 + 1.4 * (Math.exp(-((u / .08) ** 2)) + Math.exp(-(((1 - u) / .08) ** 2))); const rr = r * ensanche;
    add(a[0] + (b[0] - a[0]) * u + Math.cos(th) * rr, a[1] + (b[1] - a[1]) * u + Math.sin(th) * rr * .3, a[2] + (b[2] - a[2]) * u + Math.sin(th) * rr, tag); }
    if (cabezas) esfera(a, [cabezas, cabezas, cabezas], 160, tag); };
  const S2 = J['spine-2'], NK = J['neck'], PV = J['pelvis'];
  // contorno real de la piel a una altura dada (solo el tronco o la cabeza, sin brazos)
  const corte = (y, dy = .012, xmax = .16) => { let z0 = 1, z1 = -1, x1 = 0; for (const p of D.piel){ if (Math.abs(p[1] - y) < dy && Math.abs(p[0]) < xmax){ z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); x1 = Math.max(x1, Math.abs(p[0])); } } return { z0, z1, zc: (z0 + z1) / 2, hz: (z1 - z0) / 2, hx: x1 }; };
  // columna en S: siempre 2,5 cm por dentro de la espalda
  for (let i = 0; i < 30; i++){ const y = PV[1] + .03 + (NK[1] + .05 - PV[1]) * i / 29, C = corte(y, .012, .06), z = C.z0 + .028;
    for (let k = 0; k < 22; k++){ const th = k / 22 * 6.283; add(.012 * Math.cos(th), y + (rnd() - .5) * .007, z + .01 * Math.sin(th), 1); } }
  // costillas: siguen el contorno del pecho, por dentro de la piel
  for (let i = 0; i < 10; i++){ const y0 = NK[1] - .07 - i * .027, C = corte(y0 - .02, .015, .17), rx = C.hx * .8, rz = C.hz * .78;
    [-1, 1].forEach(sg => { for (let k = 0; k < 80; k++){ const u = k / 79, th = -Math.PI / 2 + u * Math.PI * .9; add(sg * rx * Math.cos(th), y0 - .045 * u * u, C.zc + rz * Math.sin(th), 1); } }); }
  { const C = corte(NK[1] - .17, .02, .1); for (let k = 0; k < 60; k++) add(0, NK[1] - .08 - k / 60 * .18, C.z1 - .018, 1); }
  // pelvis
  { const C = corte(PV[1] + .04, .02, .16); [-1, 1].forEach(sg => { for (let i = 0; i < 520; i++){ const u = rnd(), v = rnd(), ang = -.2 + u * 1.9, rr = (.6 + .3 * v);
      add(sg * (.03 + C.hx * .62 * rr * Math.sin(ang)), PV[1] + .02 + .07 * Math.cos(ang * .8) * v, C.zc + C.hz * .55 * rr * Math.cos(ang), 2); } });
    for (let i = 0; i < 160; i++) add((rnd() - .5) * .05, PV[1] - .01 + rnd() * .08, C.z0 + .03 + rnd() * .015, 1); }
  // piernas y brazos
  const L = s => J[s.replace('?', 'l')], R = s => J[s.replace('?', 'r')];
  [L, R].forEach(S => { const cad = [S('?-upper-leg')[0] * .78, S('?-upper-leg')[1] + .01, S('?-upper-leg')[2]];
    hueso(cad, S('?-knee'), .011, 520, 2, .022); hueso(S('?-knee'), S('?-ankle'), .01, 380, 1);
    hueso(S('?-shoulder'), S('?-elbow'), .009, 220, 1, .015); hueso(S('?-elbow'), S('?-hand'), .007, 200, 1);
    const k = S('?-knee'), an = S('?-ankle'); for (let i = 0; i < 700; i++){ const u = rnd(), th = rnd() * 6.283, perfil = Math.sin(Math.min(1, u / .75) * Math.PI) ** .7, yy = k[1] + (an[1] - k[1]) * (.08 + u * .55);
      add(k[0] + (an[0] - k[0]) * (.08 + u * .55) + Math.cos(th) * .03 * perfil, yy, k[2] - .028 + Math.sin(th) * .022 * perfil, 5); } });
  // cerebro: llena el interior del cráneo sobre los ojos (medido)
  { const yb = J['l-eye'][1] + .055, C = corte(yb, .015, .1), Ct = corte(yb + .04, .015, .1), rz = Math.min(C.hz, Ct.hz) * .8, rx = C.hx * .42, ry = .045;
    [-1, 1].forEach(sg => esfera([sg * rx * 1.02, yb, C.zc - .004], [rx, ry, rz], 1500, 6, q => 1 + .06 * Math.sin(q[1] * 22 + q[2] * 17) * Math.sin(q[0] * 19 + q[2] * 11))); }
  // ojos
  [J['l-eye'], J['r-eye']].forEach(e => esfera([e[0], e[1], e[2] - .015], [.011, .011, .011], 120, 4));
  // corazón: entre esternón y columna, un poco a la izquierda y adelante
  { const yh = S2[1] + .11, C = corte(yh, .015, .12), HC = [.025, yh, C.zc + C.hz * .2], ax = [.55, -.75, .35], al = Math.hypot(...ax); ax.forEach((v, i) => ax[i] = v / al);
    const esc = Math.min(1, C.hz / .075);
    for (let i = 0; i < 1600; i++){ const u = rnd(), th = rnd() * 6.283, ancho = .04 * esc * Math.pow(Math.sin(Math.PI * (.12 + .88 * u)), .8) * (u < .4 ? 1 + .25 * Math.abs(Math.sin(th)) : 1);
      const px = Math.cos(th) * ancho, pz = Math.sin(th) * ancho, eje = (u - .35) * .1 * esc;
      add(HC[0] + ax[0] * eje + px * .9, HC[1] + ax[1] * eje + pz * .3, HC[2] + ax[2] * eje * .5 + pz * .7, 3); }
    GEM_HC = HC; }
  // pulmones
  { const yl = S2[1] + .14, C = corte(yl, .02, .16); [-1, 1].forEach(sg => esfera([sg * C.hx * .45, yl, C.zc], [C.hx * .38, .09, C.hz * .72], 1300, 7, q => 1 - (sg * q[0] < -.3 ? .35 : 0))); }
  return { P, J };
})();
const ANCLAS = [[0, GEM.J['l-eye'][1] + .06, 0], [GEM_HC[0], GEM_HC[1], GEM_HC[2]], [GEM.J['l-upper-leg'][0] * .8, GEM.J['pelvis'][1], .03], [GEM.J['l-eye'][0], GEM.J['l-eye'][1], .13], [0, GEM.J['spine-2'][1], -.07], [-.2, .3, -.04]];
function dibujarConsolaGemelo(t, k = 1){
  riel('body', { body: 'nv' });
  const cv = $('cvg'), W = 1296, H = 928; if (cv.width !== W){ cv.width = W; cv.height = H; }
  const c0 = cv.getContext('2d'); c0.clearRect(0, 0, W, H);
  if (!window._off){ window._off = document.createElement('canvas'); window._off.width = W; window._off.height = H; }
  const c = window._off.getContext('2d'); c.clearRect(0, 0, W, H); c.globalCompositeOperation = 'lighter';
  const ang = -.5 + t * .3, ca = Math.cos(ang), sa = Math.sin(ang), CAM = 3.2, ESC = 600, CX = W / 2, CY = H * .47, Y0 = .86;
  const proj = (x, y, z) => { const xr = x * ca + z * sa, zr = -x * sa + z * ca, d = CAM - zr; return [CX + xr * ESC / d * 2, CY - (y - Y0) * ESC / d * 2, zr]; };
  const lat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 64 / 60)), 8);
  const aparece = y => Math.min(1, Math.max(0, (k * 2.2 - (1.8 - y)) * 2));
  // línea de escaneo que recorre el cuerpo al aparecer
  const COL = { 1: [225, 236, 248, .22], 2: [242, 180, 87, .55], 3: [236, 106, 168, .5], 4: [196, 186, 255, .45], 5: [111, 214, 176, .36], 6: [190, 205, 255, .13], 7: [143, 230, 245, .08] };
  // rendimiento: color fijo por tipo y transparencia con globalAlpha (no se arma un string por punto);
  // en el teléfono se dibuja 1 de cada 3 puntos
  const paso = parent.esVert && parent.esVert() ? 3 : 1, P = GEM.P, est = {}; for (const k2 in COL) est[k2] = `rgb(${COL[k2][0]},${COL[k2][1]},${COL[k2][2]})`;
  let tagAct = -1;
  for (let ip = 0; ip < P.length; ip += paso){ const [x, y, z, tag, nx, ny, nz] = P[ip]; const a0 = aparece(y); if (a0 <= 0) continue;
    let [sx, sy, zr] = proj(x, y, z);
    if (tag === 0){ const nzr = -nx * sa + nz * ca, borde = Math.pow(1 - Math.min(1, Math.abs(nzr)), 2.4), al = (.02 + .36 * borde) * (zr > -.02 ? 1 : .5);
      if (tagAct !== 0){ c.fillStyle = 'rgb(143,230,245)'; tagAct = 0; } c.globalAlpha = Math.min(1, al * a0 * (paso > 1 ? 1.6 : 1)); const q = paso > 1 ? 1.5 : 1.1; c.fillRect(sx - q / 2, sy - q / 2, q, q); continue; }
    const C = COL[tag]; let al = C[3] * (zr > -.05 ? 1 : .6), r = 1.2;
    if (tag === 3){ const k = 1 + lat * .1; const [hx, hy] = proj(GEM_HC[0], GEM_HC[1], GEM_HC[2]); sx = hx + (sx - hx) * k; sy = hy + (sy - hy) * k; al *= .7 + .4 * lat; r = 1.35; }
    if (tag === 2) al *= .75 + .25 * Math.sin(t * 2.2);
    if (tag === 7) al *= .8 + .2 * Math.sin(t * 1.2);
    if (tagAct !== tag){ c.fillStyle = est[tag]; tagAct = tag; } c.globalAlpha = Math.min(1, al * a0 * (paso > 1 ? 1.5 : 1)); if (paso > 1) r *= 1.3; c.fillRect(sx - r / 2, sy - r / 2, r, r); }
  c.globalAlpha = 1;
  for (let i = 0; i < 110; i++){ const s = h1(i), u = (t * (.12 + s * .1) + s) % 1, y = .25 + u * 1.38, lado = h1(i + 3) < .5 ? -1 : 1;
    const xx = y < .9 ? lado * (.1 + (.9 - y) * .1) + (h1(i + 40) - .5) * .05 : (h1(i + 40) - .5) * .2, zz = (h1(i + 9) - .5) * .08;
    if (aparece(y) <= 0) continue; const [sx, sy] = proj(xx, y, zz); c.fillStyle = `rgba(143,230,245,${.5 * Math.sin(u * Math.PI)})`; c.beginPath(); c.arc(sx, sy, 1.8, 0, 7); c.fill(); }
  c.globalCompositeOperation = 'source-over';
  if (!window._mini){ window._mini = document.createElement('canvas'); window._mini.width = W / 4; window._mini.height = H / 4; }
  const mn = window._mini.getContext('2d'); mn.clearRect(0, 0, W / 4, H / 4); mn.drawImage(window._off, 0, 0, W / 4, H / 4);
  c0.globalCompositeOperation = 'lighter'; c0.imageSmoothingEnabled = true; c0.imageSmoothingQuality = 'high'; c0.globalAlpha = .9; c0.drawImage(window._mini, 0, 0, W, H);
  c0.filter = 'none'; c0.globalAlpha = 1; c0.drawImage(window._off, 0, 0); c0.globalCompositeOperation = 'source-over';
  const yb = proj(0, 0, 0)[1] + 8;
  c0.strokeStyle = 'rgba(143,230,245,.28)'; c0.lineWidth = 1.2; c0.beginPath(); c0.ellipse(CX, yb, 170, 28, 0, 0, 7); c0.stroke();
  c0.strokeStyle = 'rgba(143,230,245,.1)'; c0.beginPath(); c0.ellipse(CX, yb, 230, 38, 0, 0, 7); c0.stroke();
  if (k < 1){ const ys = proj(0, 1.8 - (k * 2.2 - .5) * .9 * 2.2 / 2.2 * 1, 0)[1]; }
  const gr = $('gem').getBoundingClientRect(), fx = W / gr.width, fy = H / gr.height;
  let h = '';
  ANCLAS.forEach(([x, y, z], i) => { const card = $('c' + i), r = card.getBoundingClientRect(), izq = i < 3;
    const ex = ((izq ? r.right : r.left) - gr.left) * fx, ey = (r.top + 28 - gr.top) * fy, [sx, sy, zr] = proj(x, y, z), vis = aparece(y) * Math.min(1, Math.max(0, (k - .5) * 3 - i * .15));
    card.style.opacity = vis; if (vis <= 0) return;
    const mx = ex + (izq ? 36 : -36);
    h += `<path d="M${ex} ${ey} L${mx} ${ey} L${sx} ${sy}" fill="none" stroke="rgba(255,255,255,${.35 * vis})" stroke-width="1"/><circle cx="${sx}" cy="${sy}" r="4" fill="#fff" opacity="${vis * (zr > -.05 ? 1 : .45)}"/><circle cx="${sx}" cy="${sy}" r="${10 + 3 * Math.sin(t * 3 + i)}" fill="none" stroke="#fff" opacity="${.3 * vis}"/>`; });
  $('lin').innerHTML = h;
  novaPanel(t, { expr: 'normal', mira: [-.6, .1] }); if ($('met')) $('met').textContent = 'Mission time 214d ' + reloj(t);
}
