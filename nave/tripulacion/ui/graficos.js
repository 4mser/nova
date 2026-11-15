/* Gráficos HALO v3 (los mismos trazos de la app y el video): limpios, sin resplandor; la luz es de NOVA. */
const ruta = pts => pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
const suave = pts => {
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
};
/* forma de un latido (onda tipo pletismografía/ECG estilizada) */
const latido = u => { const f = ((u % 1) + 1) % 1; return Math.exp(-(((f - .16) / .028) ** 2)) - .2 * Math.exp(-(((f - .21) / .02) ** 2)) + .24 * Math.exp(-(((f - .42) / .06) ** 2)); };
let _gid = 0;

/* Ritmo en vivo: se dibuja a la frecuencia medida por el sensor (fase acumulada para que no salte al cambiar) */
function trazaViva(svg, w, h, fase, o = {}) {
  const { col = '#46c8e8', ancho = 2.6, base = .8, amp = .64, grosor = 1.8 } = o;
  const id = svg._gid || (svg._gid = 'tz' + (_gid++));
  const n = 220, pts = [];
  for (let i = 0; i <= n; i++) { const u = i / n; pts.push([u * w, h * base - h * amp * latido(u * ancho - fase)]); }
  const e = pts[n];
  svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${col}" stop-opacity="0"/><stop offset=".3" stop-color="${col}" stop-opacity=".7"/><stop offset="1" stop-color="${col}"/></linearGradient></defs>
    <path d="${ruta(pts)}" fill="none" stroke="url(#${id})" stroke-width="${grosor}" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${e[0]}" cy="${e[1]}" r="3.2" fill="${col}"/>`;
}

/* Serie temporal con área suave; banda opcional [min,max] del rango esperado */
function serie(svg, w, h, vals, o = {}) {
  const { col = '#46c8e8', banda = null, mn: mn0, mx: mx0 } = o;
  if (!vals.length) { svg.innerHTML = ''; return; }
  const id = svg._gid || (svg._gid = 'sr' + (_gid++));
  let mn = mn0 ?? Math.min(...vals), mx = mx0 ?? Math.max(...vals);
  if (mx - mn < 6) { const c = (mx + mn) / 2; mn = c - 3; mx = c + 3; }
  const Y = v => h - 3 - (v - mn) / (mx - mn) * (h - 8);
  const pts = vals.map((v, i) => [vals.length === 1 ? w : i / (vals.length - 1) * w, Y(v)]);
  const bd = banda ? `<rect x="0" y="${Math.min(Y(banda[1]), h)}" width="${w}" height="${Math.max(0, Y(banda[0]) - Y(banda[1]))}" fill="rgba(255,255,255,.035)"/>` : '';
  svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".16"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>${bd}
    ${pts.length > 1 ? `<path d="${suave(pts)} L${w} ${h} L0 ${h}Z" fill="url(#${id})"/><path d="${suave(pts)}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linecap="round"/>` : ''}
    <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="3.2" fill="${col}"/>`;
}

/* Anillo con arco de progreso */
function anilloArco(cx, cy, r, v, col, w = 10) {
  v = Math.max(0, Math.min(.999, v));
  const a1 = -Math.PI / 2 + Math.PI * 2 * v, x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="${w}"/>` +
    (v > 0.001 ? `<path d="M${cx} ${cy - r} A${r} ${r} 0 ${v > .5 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>` : '');
}

/* Gráfico de historia con ejes: series [{t, v, lo, hi, col}], umbrales [{v, col, txt}], ventana [t0, t1] en segundos */
function grafico(svg, W, H, o) {
  const { t0, t1, series = [], umbrales = [], unidad = '', dec = 0, vacio = 'No readings in this window yet', ahora: tAhora = t1 } = o;
  const izq = 44, der = 10, arr = 12, aba = 26, w = W - izq - der, h = H - arr - aba;
  const vals = series.flatMap(s => [...s.v, ...(s.lo || []), ...(s.hi || [])]).filter(Number.isFinite);
  if (!vals.length) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="SG" font-size="14" fill="#5b6573">${vacio}</text>`;
    return;
  }
  let mn = Math.min(...vals), mx = Math.max(...vals);
  // los umbrales cercanos entran al rango para ver cuánto margen queda
  const margen = Math.max(mx - mn, Math.abs(mx) * .08, 1);
  for (const u of umbrales) if (u.v > mn - margen * 1.2 && u.v < mx + margen * 1.2) { mn = Math.min(mn, u.v); mx = Math.max(mx, u.v); }
  const pad = (mx - mn) * .14 || 1; mn -= pad; mx += pad;
  const X = t => izq + (t - t0) / (t1 - t0) * w, Y = v => arr + h - (v - mn) / (mx - mn) * h;
  const decEje = Math.max(dec, (mx - mn) / 3 < 1 ? 1 : 0, (mx - mn) / 3 < .1 ? 2 : 0);
  const f = v => decEje ? v.toFixed(decEje) : Math.round(v).toLocaleString('en-US');
  let g = '';
  // grilla y eje Y
  for (let i = 0; i <= 3; i++) { const v = mn + (mx - mn) * i / 3, y = Y(v); g += `<line x1="${izq}" x2="${W - der}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.05)"/><text x="${izq - 8}" y="${y + 4}" text-anchor="end" font-family="SG" font-size="11.5" fill="#5b6573">${f(v)}</text>`; }
  // eje X: inicio, mitad, ahora
  const etq = s => { const d = (tAhora - s); if (d < -30) return `+${Math.round(-d / 60)} min`; return d < 60 ? 'now' : d < 3600 ? `−${Math.round(d / 60)} min` : d < 172800 ? `−${Math.round(d / 3600)} h` : `−${Math.round(d / 86400)} d`; };
  [[t0, 'start'], [(t0 + t1) / 2, 'middle'], [t1, 'end']].forEach(([t, a]) => { g += `<text x="${X(t)}" y="${H - 6}" text-anchor="${a}" font-family="SG" font-size="11.5" fill="#5b6573">${etq(t)}</text>`; });
  // umbrales
  const usados = [];
  for (const u of [...umbrales].sort((a, b) => b.v - a.v)) {
    if (u.v < mn || u.v > mx) continue;
    const y = Y(u.v), libre = usados.every(yy => Math.abs(yy - y) > 14);
    g += `<line x1="${izq}" x2="${W - der}" y1="${y}" y2="${y}" stroke="${u.col}" stroke-opacity=".55" stroke-dasharray="4 5"/>`;
    if (libre) { usados.push(y); g += `<text x="${W - der}" y="${y - 5}" text-anchor="end" font-family="SG" font-size="11" fill="${u.col}" fill-opacity=".85">${u.txt}</text>`; }
  }
  // series: banda mín–máx y media
  for (const s of series) {
    if (!s.t.length) continue;
    const id = 'g' + (_gid++);
    if (s.lo && s.hi && s.t.length > 1) {
      const sup = s.t.map((t, i) => [X(t), Y(s.hi[i])]), inf = s.t.map((t, i) => [X(t), Y(s.lo[i])]).reverse();
      g += `<path d="${ruta(sup)} L${inf.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L')}Z" fill="${s.col}" fill-opacity=".1"/>`;
    }
    const pts = s.t.map((t, i) => [X(t), Y(s.v[i])]);
    if (pts.length > 1) {
      g += `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.col}" stop-opacity=".14"/><stop offset="1" stop-color="${s.col}" stop-opacity="0"/></linearGradient></defs>`;
      if (!s.sinArea) g += `<path d="${ruta(pts)} L${pts[pts.length - 1][0]} ${arr + h} L${pts[0][0]} ${arr + h}Z" fill="url(#${id})"/>`;
      g += `<path d="${ruta(pts)}" fill="none" stroke="${s.col}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    const e = pts[pts.length - 1];
    g += `<circle cx="${e[0]}" cy="${e[1]}" r="3.4" fill="${s.col}"/>`;
  }
  svg.innerHTML = g;
}
