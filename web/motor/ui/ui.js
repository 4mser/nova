try { if (parent.esVert && parent.esVert()) document.documentElement.classList.add('vert'); } catch (e) {}
/* HALO · dibujo de interfaces en función de t (fotos fijas y video). Sistema v3: trazos limpios, sin resplandor; la luz es de NOVA. */
const $ = id => document.getElementById(id);
const h1 = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const ruta = pts => pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
const suave = pts => { let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`; for (let i = 0; i < pts.length - 1; i++){ const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
  d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`; } return d; };
const latido = u => { const f = ((u % 1) + 1) % 1; return Math.exp(-(((f - .16) / .028) ** 2)) - .2 * Math.exp(-(((f - .21) / .02) ** 2)) + .24 * Math.exp(-(((f - .42) / .06) ** 2)); };
let _gid = 0;

/* traza en vivo: una línea que se desvanece hacia atrás y un punto en la cabeza */
function trazaViva(svg, w, h, t, o = {}){
  const { col = '#46c8e8', ppm = 64, ancho = 2.4, base = .78, amp = .62, f = latido, grosor = 1.8 } = o, id = 'tz' + (_gid++);
  const n = 200, pts = []; for (let i = 0; i <= n; i++){ const u = i / n; pts.push([u * w, h * base - h * amp * f(u * ancho - t * ppm / 60)]); }
  const e = pts[n];
  svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${col}" stop-opacity="0"/><stop offset=".3" stop-color="${col}" stop-opacity=".7"/><stop offset="1" stop-color="${col}"/></linearGradient></defs>
    <path d="${ruta(pts)}" fill="none" stroke="url(#${id})" stroke-width="${grosor}" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${e[0]}" cy="${e[1]}" r="3.2" fill="${col}"/>`;
}
function serie(svg, w, h, vals, o = {}){ const { col = '#46c8e8', area = true, punto = true, marca = null } = o, id = 'sr' + (_gid++);
  const mn = Math.min(...vals), mx = Math.max(...vals), pts = vals.map((v, i) => [i / (vals.length - 1) * w, h - 3 - (v - mn) / ((mx - mn) || 1) * (h - 8)]);
  svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".14"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${marca != null ? `<line x1="${marca * w}" y1="0" x2="${marca * w}" y2="${h}" stroke="rgba(255,255,255,.12)"/>` : ''}
    ${area ? `<path d="${suave(pts)} L${w} ${h} L0 ${h}Z" fill="url(#${id})"/>` : ''}<path d="${suave(pts)}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linecap="round"/>
    ${punto ? `<circle cx="${w}" cy="${pts[pts.length - 1][1]}" r="3.2" fill="${col}"/>` : ''}`; }
function barritas(svg, w, h, vals, o = {}){ const { col = '#46c8e8', resalta = vals.length - 1 } = o, n = vals.length, bw = Math.max(3, w / n * .5);
  svg.innerHTML = vals.map((v, i) => { const x = i * w / n + (w / n - bw) / 2, bh = Math.max(3, v * h); return `<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" rx="${bw / 2}" fill="${i === resalta ? col : 'rgba(255,255,255,.14)'}"/>`; }).join(''); }

function dibujarMovil(t){
  $('novaHoy').innerHTML = mascotaOrbes({ x: 180, y: 118, R: 62, t, expr: 'feliz', orbes: 6, mira: [0, .1], parpadeo: (t % 4.3) < .13 ? 1 : 0 });
  $('tabNova').innerHTML = mascotaOrbes({ x: 20, y: 20, R: 11, t, expr: 'normal', orbes: 0 });
  trazaViva($('trazaHoy'), 150, 30, t, { ancho: 2 });
  barritas($('barHoy'), 150, 30, [.62, .7, .58, .74, .8, .78, .86]);
  $('hrHoy').textContent = 64 + Math.round(Math.sin(t * .7) * 1.4);
  $('novaChat').innerHTML = mascotaOrbes({ x: 30, y: 30, R: 21, t, expr: 'feliz', orbes: 0 });
  barritas($('pvtG'), 310, 44, Array.from({ length: 31 }, (_, i) => .35 + h1(i + 3) * .55), { resalta: 30 });
  $('novaAl').innerHTML = mascotaOrbes({ x: 30, y: 30, R: 21, t, expr: 'sorprendida', orbes: 0, alerta: 1 });
  const hist = Array.from({ length: 60 }, (_, i) => { const u = i / 59; return .06 + .03 * h1(i) + (u > .78 ? Math.pow((u - .78) / .22, 1.7) : 0); });
  serie($('radHist'), 320, 90, hist, { col: '#ec6aa8' });
}

/* ── pantallas nuevas ── */
const iconoNova = (id, t) => { const e = $(id); if (e) e.innerHTML = mascotaOrbes({ x: 20, y: 21, R: 12, t, expr: 'normal', orbes: 0, sinHalo: true, fluido: .6 }); };
function anilloArco(cx, cy, r, v, col, w = 10){ const a1 = -Math.PI / 2 + Math.PI * 2 * Math.min(.999, v), x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="${w}"/><path d="M${cx} ${cy - r} A${r} ${r} 0 ${v > .5 ? 1 : 0} 1 ${x1} ${y1}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`; }
function constelacion(svg, t, k = 1){
  const D = [[3.6, 6.9, 1], [3.9, 7.2, 1], [3.2, 6.1, 2], [4.4, 7.4, 0], [4.1, 7.0, 1], [4.6, 7.6, 0], [4.3, 7.1, 1]], W = 320, H = 210;
  const RAMP = ['#46c8e8', '#8fb8ff', '#a898ff', '#d27fd0', '#ec6aa8'];
  const P = D.map(([m, s, e], i) => [24 + i * (W - 48) / 6, H - 34 - (m - 2.5) / 2.5 * (H - 70), 4 + (s - 6) * 4, RAMP[e]]);
  let h = ''; for (let i = 0; i < 40; i++){ const x = h1(i) * W, y = h1(i + 50) * (H - 30); h += `<circle cx="${x}" cy="${y}" r="${.6 + h1(i + 9) * .8}" fill="#dfe8f2" opacity="${.15 + .3 * Math.sin(t * 1.5 + i) ** 2}"/>`; }
  const vis = P.slice(0, Math.max(1, Math.ceil(k * 7)));
  h += `<path d="${suave(vis.map(p => [p[0], p[1]]))}" fill="none" stroke="rgba(143,230,245,.5)" stroke-width="1.6"/>`;
  vis.forEach((p, i) => { h += `<circle cx="${p[0]}" cy="${p[1]}" r="${p[2] * 2.4}" fill="${p[3]}" opacity=".16"/><circle cx="${p[0]}" cy="${p[1]}" r="${p[2]}" fill="${p[3]}"/>`;
    h += `<text x="${p[0]}" y="${H - 6}" text-anchor="middle" font-family="SG" font-size="11.5" fill="#5b6573">${'MTWTFSS'[i]}</text>`; });
  if (k >= 1){ const u = (t * .18) % 1, j = Math.min(5, Math.floor(u * 6)), f = u * 6 - j, a = P[j], b = P[j + 1]; h += `<circle cx="${a[0] + (b[0] - a[0]) * f}" cy="${a[1] + (b[1] - a[1]) * f}" r="3" fill="#fff"/>`; }
  svg.innerHTML = h;
}
function dibujarMovilA(t, k = 1, k2 = k){
  $('novaHoy').innerHTML = mascotaOrbes({ x: 180, y: 118, R: 62, t, expr: 'feliz', orbes: 6, mira: [0, .1], parpadeo: (t % 4.3) < .13 ? 1 : 0 });
  iconoNova('tabNova', t); iconoNova('tabNovaB', t); iconoNova('tabNovaM', t);
  trazaViva($('trazaHoy'), 150, 30, t, { ancho: 2 }); barritas($('barHoy'), 150, 30, [.62, .7, .58, .74, .8, .78, .86]);
  $('hrHoy').textContent = 64 + Math.round(Math.sin(t * .7) * 1.4);
  trazaViva($('bTraza'), 320, 54, t, { ancho: 3.2 }); $('bHR').textContent = 64 + Math.round(Math.sin(t * .7) * 1.4);
  $('bAnillos').innerHTML = anilloArco(60, 60, 50, 1.03 * Math.min(1, k * 1.2), '#6fd6b0', 11) + anilloArco(60, 60, 34, .85 * Math.min(1, k * 1.2), '#8fe6f5', 11);
  serie($('bHueso'), 150, 30, Array.from({ length: 12 }, (_, i) => 1 - i * .02 + (h1(i) - .5) * .02), { col: '#6fd6b0', area: false });
  barritas($('bMus'), 150, 30, Array.from({ length: 10 }, (_, i) => .8 + (h1(i + 3) - .5) * .12), { col: '#6fd6b0' });
  constelacion($('mConst'), t, k2);
}
function dibujarMovilB(t, k = 1){
  $('novaChat').innerHTML = mascotaOrbes({ x: 30, y: 30, R: 21, t, expr: 'feliz', orbes: 0, sinHalo: true });
  $('sCuenta').innerHTML = anilloArco(46, 46, 40, .72, '#a898ff', 7) + `<text x="46" y="48" text-anchor="middle" font-family="SG" font-weight="300" font-size="26" fill="#f2f5f8">2</text><text x="46" y="64" text-anchor="middle" font-family="SG" font-size="10.5" fill="#9aa4b2">days</text>`;
  // flujo de privacidad: de ti hacia quien corresponde
  const T = [[50, 95], [280, 45], [280, 145]], car = [['Vitals', '#46c8e8', 1, 0], ['Sleep', '#a898ff', 1, 0], ['Mood', '#ec6aa8', 2, 1], ['Journal', '#5b6573', -1, 0]];
  let h = '';
  car.forEach(([n, c, dest], i) => { const y0 = 95 + (i - 1.5) * 10, dst = dest > 0 ? T[dest] : [150, 172];
    const d = `M${T[0][0] + 18} ${y0} C${150} ${y0}, ${170} ${dst[1]}, ${dst[0] - (dest > 0 ? 20 : 0)} ${dst[1]}`;
    h += `<path d="${d}" fill="none" stroke="${c}" stroke-width="${dest > 0 ? 2 : 1.4}" ${dest > 0 ? '' : 'stroke-dasharray="3 5"'} opacity="${dest > 0 ? .8 : .6}"/>`;
    if (dest > 0) for (let j = 0; j < 3; j++){ const u = ((t * .35 + j / 3 + i * .17) % 1), x = (1 - u) ** 3 * (T[0][0] + 18) + 3 * (1 - u) ** 2 * u * 150 + 3 * (1 - u) * u * u * 170 + u ** 3 * (dst[0] - 20), y = (1 - u) ** 3 * y0 + 3 * (1 - u) ** 2 * u * y0 + 3 * (1 - u) * u * u * dst[1] + u ** 3 * dst[1]; h += `<circle cx="${x}" cy="${y}" r="2.6" fill="${c}"/>`; }
    else h += `<g transform="translate(${dst[0] - 7} ${dst[1] - 9})"><rect x="0" y="6" width="14" height="10" rx="2" fill="none" stroke="#5b6573" stroke-width="1.6"/><path d="M3 6V4a4 4 0 0 1 8 0v2" fill="none" stroke="#5b6573" stroke-width="1.6"/></g><text x="${dst[0] + 13}" y="${dst[1] + 4}" font-family="SG" font-size="12" fill="#5b6573">only you</text>`; });
  h += `<circle cx="${T[0][0]}" cy="${T[0][1]}" r="22" fill="#8fe6f5"/><text x="${T[0][0]}" y="${T[0][1] + 5}" text-anchor="middle" font-family="SG" font-weight="600" font-size="14" fill="#05080c">You</text>`;
  [[1, 'Flight surgeon'], [2, 'Psychologist']].forEach(([i, n]) => { const [x, y] = T[i]; h += `<circle cx="${x}" cy="${y}" r="18" fill="#0f151d" stroke="rgba(255,255,255,.2)"/><text x="${x}" y="${y + 34}" text-anchor="middle" font-family="SG" font-size="12" fill="#9aa4b2">${n}</text>`; });
  h += `<text x="280" y="50" text-anchor="middle" font-family="SG" font-size="12" font-weight="600" fill="#c5cfdb">FS</text><text x="280" y="150" text-anchor="middle" font-family="SG" font-size="12" font-weight="600" fill="#c5cfdb">ER</text>`;
  $('pFlujo').innerHTML = h;
}
