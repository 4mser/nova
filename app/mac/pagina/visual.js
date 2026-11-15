/* Lo que NOVA o Claude MUESTRAN: un bloque de datos → un elemento listo para el panel o el lienzo grande.
   Tipos: grafico · metricas · tarjetas · imagenes · tabla · lista · codigo · texto.
   Gráficos en SVG hecho a mano con las reglas de la guía de visualización: marcas finas, extremos redondeados
   anclados a la base, un solo eje, paleta categórica validada para el fondo oscuro en orden fijo, leyenda con 2+
   series y etiqueta directa hasta 4, rejilla tenue, tooltip al pasar el cursor y vista de tabla. */

/* paleta categórica (modo oscuro), validada contra el fondo del widget: orden fijo, nunca cíclica */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const SVG = 'http://www.w3.org/2000/svg';

const el = (tag, clase, texto) => { const e = document.createElement(tag); if (clase) e.className = clase; if (texto != null) e.textContent = texto; return e; };
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const num = v => (typeof v === 'number' ? v : Number(String(v).replace(/[^\d.,-]/g, '').replace(',', '.')));
const fmt = (v, unidad = '') => {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v), s = a >= 1e6 ? `${(v / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 })} M` : a >= 1e4 ? `${(v / 1e3).toLocaleString('es-CL', { maximumFractionDigits: 1 })} k` : v.toLocaleString('es-CL', { maximumFractionDigits: 2 });
  return unidad ? `${s} ${unidad}` : s;
};
/** escala "bonita" de 0 al máximo: 4-5 marcas redondas */
function escala(max, min = 0) {
  const rango = Math.max(1e-9, max - min), paso0 = rango / 4, mag = 10 ** Math.floor(Math.log10(paso0));
  const paso = [1, 2, 2.5, 5, 10].map(m => m * mag).find(p => p >= paso0);
  const lo = Math.floor(min / paso) * paso, hi = Math.ceil(max / paso) * paso, marcas = [];
  for (let v = lo; v <= hi + paso / 2; v += paso) marcas.push(+v.toFixed(10));
  return { lo, hi, marcas };
}

/* ═════ gráfico ═════ */
function grafico(b, { grande }) {
  const forma = ['barras', 'barras_h', 'lineas', 'area'].includes(b.forma) ? b.forma : 'barras';
  const etiquetas = (b.etiquetas ?? []).map(String);
  const series = (b.series ?? []).slice(0, 8).map((s, i) => ({ nombre: String(s.nombre ?? `Serie ${i + 1}`), valores: (s.valores ?? []).map(num), color: SERIES[i] }));
  const n = Math.max(etiquetas.length, ...series.map(s => s.valores.length), 0);
  const caja = el('figure', 'viz');
  if (!n || !series.length) { caja.append(el('p', 'viz-vacio', 'Sin datos para graficar')); return caja; }

  // leyenda con 2+ series (identidad nunca solo por color: también nombre)
  if (series.length > 1) {
    const ley = el('div', 'viz-leyenda');
    for (const s of series) { const i = el('span'); const m = el('i'); m.style.background = s.color; i.append(m, s.nombre); ley.append(i); }
    caja.append(ley);
  }

  const W = grande ? 860 : 420, H = grande ? 380 : 190, hor = forma === 'barras_h';
  const izq = hor ? Math.min(150, 12 + Math.max(...etiquetas.map(e => e.length)) * 6.4) : 40, der = forma === 'lineas' && series.length > 1 && series.length <= 4 ? 84 : 14, arriba = 10, abajo = hor ? 18 : 24;
  const valores = series.flatMap(s => s.valores).filter(Number.isFinite);
  const apilado = !!b.apilado && (forma === 'barras' || forma === 'barras_h');
  const maxV = apilado ? Math.max(...Array.from({ length: n }, (_, i) => series.reduce((a, s) => a + (Math.max(0, s.valores[i]) || 0), 0))) : Math.max(0, ...valores);
  const minV = Math.min(0, ...valores);
  const { lo, hi, marcas } = escala(maxV, minV);
  const lienzo = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz-svg', role: 'img', 'aria-label': b.titulo ?? 'Gráfico' });
  const pw = W - izq - der, ph = H - arriba - abajo;
  const v2p = v => (hor ? izq + ((v - lo) / (hi - lo)) * pw : arriba + ph - ((v - lo) / (hi - lo)) * ph);

  // rejilla y eje de valores (tenues)
  for (const m of marcas) {
    const p = v2p(m);
    lienzo.append(hor ? svg('line', { x1: p, x2: p, y1: arriba, y2: arriba + ph, class: m === 0 ? 'viz-base' : 'viz-rejilla' }) : svg('line', { x1: izq, x2: izq + pw, y1: p, y2: p, class: m === 0 ? 'viz-base' : 'viz-rejilla' }));
    const t = svg('text', hor ? { x: p, y: H - 4, 'text-anchor': 'middle', class: 'viz-eje' } : { x: izq - 6, y: p + 3.5, 'text-anchor': 'end', class: 'viz-eje' });
    t.textContent = fmt(m); lienzo.append(t);
  }
  // etiquetas de categoría (se saltan si no caben)
  const lineal = forma === 'lineas' || forma === 'area';
  const banda = (hor ? ph : pw) / n, paso = lineal ? pw / Math.max(1, n - 1) : banda, cada = Math.max(1, Math.ceil((hor ? 14 : 46) / paso));
  // en líneas la etiqueta va bajo su punto; en barras, al centro de su banda
  const posEtiqueta = i => (hor ? arriba + banda * (i + 0.5) : lineal ? izq + (n === 1 ? pw / 2 : (pw * i) / (n - 1)) : izq + banda * (i + 0.5));
  etiquetas.forEach((e, i) => {
    if (i % cada && i !== n - 1) return;
    if (i === n - 1 && i % cada && (i % cada) < cada / 2) return;
    const c = posEtiqueta(i);
    const t = svg('text', hor ? { x: izq - 6, y: c + 3.5, 'text-anchor': 'end', class: 'viz-eje' } : { x: c, y: H - 7, 'text-anchor': 'middle', class: 'viz-eje' });
    t.textContent = e.length > 14 && !hor ? `${e.slice(0, 13)}…` : e; lienzo.append(t);
  });

  const tip = el('div', 'viz-tip oculto');
  const mostrarTip = (ev, i, solo) => {
    tip.replaceChildren(el('b', '', etiquetas[i] ?? `#${i + 1}`));
    for (const s of solo ? [solo] : series) { const r = el('span'); const m = el('i'); m.style.background = s.color; r.append(m, `${s.nombre}: `, el('strong', '', fmt(s.valores[i], b.unidad))); tip.append(r); }
    const caj = caja.getBoundingClientRect();
    tip.style.left = `${Math.min(caj.width - 150, Math.max(0, ev.clientX - caj.left + 12))}px`;
    tip.style.top = `${Math.max(0, ev.clientY - caj.top - 10)}px`;
    tip.classList.remove('oculto');
  };
  const quitarTip = () => tip.classList.add('oculto');

  if (forma === 'barras' || forma === 'barras_h') {
    const grupos = apilado ? 1 : series.length, hueco = 2, ancho = Math.max(2, Math.min(28, (banda * 0.72 - hueco * (grupos - 1)) / grupos));
    for (let i = 0; i < n; i++) {
      let acum = 0;
      series.forEach((s, k) => {
        const v = s.valores[i]; if (!Number.isFinite(v)) return;
        const desde = apilado ? acum : 0, hasta = apilado ? acum + v : v; acum = hasta;
        const a = v2p(Math.min(desde, hasta)), z = v2p(Math.max(desde, hasta)), largo = Math.abs(z - a);
        const off = (hor ? arriba : izq) + banda * i + (banda - (apilado ? ancho : grupos * ancho + hueco * (grupos - 1))) / 2 + (apilado ? 0 : k * (ancho + hueco));
        // extremo redondeado en la punta, recto en la base
        const r = Math.min(4, ancho / 2, largo), path = hor
          ? `M${a},${off} h${Math.max(0, largo - r)} q${r},0 ${r},${r} v${ancho - 2 * r} q0,${r} ${-r},${r} h${-Math.max(0, largo - r)} z`
          : `M${off},${z + largo} v${-Math.max(0, largo - r)} q0,${-r} ${r},${-r} h${ancho - 2 * r} q${r},0 ${r},${r} v${Math.max(0, largo - r)} z`;
        const p = svg('path', { d: path, fill: s.color, class: 'viz-marca' });
        if (apilado && k) p.setAttribute('stroke', 'var(--viz-fondo)'), p.setAttribute('stroke-width', '2');
        // zona de cursor más grande que la barra
        const zona = svg('rect', hor ? { x: izq, y: off - 2, width: pw, height: ancho + 4, fill: 'transparent' } : { x: off - 2, y: arriba, width: ancho + 4, height: ph, fill: 'transparent' });
        zona.addEventListener('mousemove', ev => mostrarTip(ev, i, apilado ? null : s)); zona.addEventListener('mouseleave', quitarTip);
        lienzo.append(p, zona);
      });
    }
  } else {
    const x = i => izq + (n === 1 ? pw / 2 : (pw * i) / (n - 1));
    for (const s of series) {
      const pts = s.valores.map((v, i) => (Number.isFinite(v) ? [x(i), v2p(v)] : null)).filter(Boolean);
      if (!pts.length) continue;
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');
      if (forma === 'area') lienzo.append(svg('path', { d: `${d}L${pts.at(-1)[0]},${v2p(Math.max(lo, 0))}L${pts[0][0]},${v2p(Math.max(lo, 0))}Z`, fill: s.color, opacity: series.length > 1 ? 0.18 : 0.22 }));
      lienzo.append(svg('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      if (pts.length <= 24) for (const [px, py] of pts) lienzo.append(svg('circle', { cx: px, cy: py, r: 3, fill: s.color, stroke: 'var(--viz-fondo)', 'stroke-width': 2 }));
      // etiqueta directa al final (hasta 4 series)
      if (series.length > 1 && series.length <= 4) { const t = svg('text', { x: pts.at(-1)[0] + 6, y: pts.at(-1)[1] + 3.5, class: 'viz-directa' }); t.textContent = s.nombre.length > 12 ? `${s.nombre.slice(0, 11)}…` : s.nombre; lienzo.append(t); }
    }
    // cursor: línea vertical + tooltip con todas las series
    const guia = svg('line', { y1: arriba, y2: arriba + ph, class: 'viz-guia', opacity: 0 });
    const zona = svg('rect', { x: izq, y: arriba, width: pw, height: ph, fill: 'transparent' });
    zona.addEventListener('mousemove', ev => {
      const r = lienzo.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W, i = Math.max(0, Math.min(n - 1, Math.round(((px - izq) / pw) * (n - 1))));
      guia.setAttribute('x1', x(i)); guia.setAttribute('x2', x(i)); guia.setAttribute('opacity', 1); mostrarTip(ev, i);
    });
    zona.addEventListener('mouseleave', () => { guia.setAttribute('opacity', 0); quitarTip(); });
    lienzo.append(guia, zona);
  }
  caja.append(lienzo, tip);

  // vista de tabla (accesible y para copiar)
  const ver = el('button', 'viz-vertabla', 'Ver tabla');
  ver.type = 'button';
  ver.addEventListener('click', () => {
    const t = tabla({ columnas: ['', ...series.map(s => s.nombre)], filas: Array.from({ length: n }, (_, i) => [etiquetas[i] ?? `#${i + 1}`, ...series.map(s => fmt(s.valores[i], b.unidad))]) });
    caja.replaceChildren(...[...caja.children].filter(c => c.classList.contains('viz-leyenda')), t);
  });
  caja.append(ver);
  return caja;
}

/* ═════ métricas (número héroe) ═════ */
function metricas(b) {
  const g = el('div', 'viz-metricas');
  for (const m of (b.items ?? []).slice(0, 8)) {
    const t = el('div', 'viz-metrica');
    t.append(el('span', 'viz-metrica-et', m.etiqueta ?? ''), el('strong', 'viz-metrica-v', typeof m.valor === 'number' ? fmt(m.valor, m.unidad) : `${m.valor ?? '—'}${m.unidad ? ` ${m.unidad}` : ''}`));
    if (m.cambio != null && m.cambio !== '') {
      const c = num(m.cambio), sube = c > 0, baja = c < 0;
      const d = el('span', `viz-cambio ${m.bueno === false ? (sube ? 'mal' : 'bien') : sube ? 'bien' : baja ? 'mal' : ''}`, `${sube ? '▲' : baja ? '▼' : '•'} ${typeof m.cambio === 'number' ? fmt(Math.abs(m.cambio)) : String(m.cambio).replace(/^[+-]/, '')}${m.cambio_texto ? ` ${m.cambio_texto}` : ''}`);
      t.append(d);
    }
    g.append(t);
  }
  return g;
}

/* ═════ tarjetas (resultados de búsqueda, enlaces) ═════ */
function tarjetas(b, { abrir }) {
  const l = el('div', 'viz-tarjetas');
  for (const it of (b.items ?? []).slice(0, 12)) {
    const c = el(it.url ? 'button' : 'div', 'viz-tarjeta');
    if (it.url) { c.type = 'button'; c.title = it.url; c.addEventListener('click', () => abrir?.(it.url)); }
    if (it.imagen) { const im = el('img', 'viz-tarjeta-img'); im.src = it.imagen; im.alt = ''; im.loading = 'lazy'; im.onerror = () => im.remove(); c.append(im); }
    const cuerpo = el('div', 'viz-tarjeta-cuerpo');
    let dominio = it.fuente ?? '';
    try { if (!dominio && it.url) dominio = new URL(it.url).hostname.replace(/^www\./, ''); } catch {}
    if (dominio) cuerpo.append(el('span', 'viz-tarjeta-fuente', dominio));
    cuerpo.append(el('strong', 'viz-tarjeta-titulo', it.titulo ?? it.url ?? ''));
    if (it.resumen) cuerpo.append(el('span', 'viz-tarjeta-resumen', it.resumen));
    c.append(cuerpo); l.append(c);
  }
  return l;
}

/* ═════ imágenes ═════ */
function imagenes(b, { ampliarImagen }) {
  const items = (b.items ?? []).filter(i => i?.src).slice(0, 12);
  const g = el('div', `viz-imagenes n${Math.min(items.length, 3)}`);
  for (const it of items) {
    const f = el('figure', 'viz-imagen');
    const im = el('img'); im.src = it.src; im.alt = it.titulo ?? ''; im.loading = 'lazy';
    im.onerror = () => f.replaceChildren(el('span', 'viz-vacio', 'No se pudo cargar'));
    im.addEventListener('click', () => ampliarImagen?.(it));
    f.append(im);
    if (it.titulo) f.append(el('figcaption', '', it.titulo));
    g.append(f);
  }
  return g;
}

/* ═════ tabla ═════ */
function tabla(b) {
  const cont = el('div', 'viz-tabla'), t = el('table'), cab = el('tr');
  const cols = (b.columnas ?? []).map(String), filas = (b.filas ?? []).slice(0, 200);
  const numerica = cols.map((_, j) => filas.length > 0 && filas.every(f => f[j] == null || f[j] === '' || Number.isFinite(num(f[j]))));
  cols.forEach((c, j) => { const th = el('th', numerica[j] ? 'num' : '', c); cab.append(th); });
  const thead = el('thead'); thead.append(cab); t.append(thead);
  const tb = el('tbody');
  for (const f of filas) { const tr = el('tr'); cols.forEach((_, j) => tr.append(el('td', numerica[j] ? 'num' : '', f[j] == null ? '' : String(f[j])))); tb.append(tr); }
  t.append(tb); cont.append(t);
  return cont;
}

/* ═════ lista ═════ */
function lista(b) {
  const u = el('ul', 'viz-lista');
  for (const it of (b.items ?? []).slice(0, 40)) {
    const x = typeof it === 'string' ? { texto: it } : it;
    const li = el('li', x.hecho ? 'hecho' : '');
    li.append(el('i', '', x.hecho ? '✓' : ''), el('span', '', x.texto ?? ''));
    if (x.detalle) li.append(el('small', '', x.detalle));
    u.append(li);
  }
  return u;
}

/* ═════ código ═════ */
function codigo(b) {
  const c = el('div', 'viz-codigo');
  if (b.archivo || b.lenguaje) c.append(el('span', 'viz-codigo-cab', b.archivo ?? b.lenguaje));
  const pre = el('pre'); pre.textContent = b.codigo ?? ''; c.append(pre);
  return c;
}

/**
 * Un bloque → elemento. `op`: { grande, abrir(url), ampliar(bloque), ampliarImagen(item), md(texto) }
 */
export function renderizar(b, op = {}) {
  const caja = el('section', `bloque bloque-${b.tipo}`);
  if (b.titulo || (!op.grande && op.ampliar && b.tipo !== 'texto')) {
    const cab = el('header', 'bloque-cab');
    const tit = el('div');
    if (b.titulo) tit.append(el('strong', 'bloque-titulo', b.titulo));
    if (b.subtitulo) tit.append(el('span', 'bloque-sub', b.subtitulo));
    cab.append(tit);
    if (!op.grande && op.ampliar && b.tipo !== 'texto') {
      const am = el('button', 'bloque-ampliar', '⤢');
      am.type = 'button'; am.title = 'Ampliar'; am.setAttribute('aria-label', 'Ampliar');
      am.addEventListener('click', () => op.ampliar(b));
      cab.append(am);
    }
    caja.append(cab);
  }
  const cuerpo = (() => {
    switch (b.tipo) {
      case 'grafico': return grafico(b, op);
      case 'metricas': return metricas(b, op);
      case 'tarjetas': return tarjetas(b, op);
      case 'imagenes': return imagenes(b, op);
      case 'tabla': return tabla(b, op);
      case 'lista': return lista(b, op);
      case 'codigo': return codigo(b, op);
      default: { const d = el('div', 'ella'); d.innerHTML = op.md ? op.md(String(b.markdown ?? b.texto ?? '')) : ''; if (!op.md) d.textContent = String(b.markdown ?? ''); return d; }
    }
  })();
  if (b.fuente) { const f = el('p', 'bloque-fuente', `Fuente: ${b.fuente}`); caja.append(cuerpo, f); } else caja.append(cuerpo);
  return caja;
}
