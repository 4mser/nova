/* Lector de la biblioteca a bordo: abre la página real del documento original (PDF guardado en la nave, sin internet)
   y marca encima el pasaje que encontró la búsqueda o que citó NOVA. pdf.js (Apache-2.0) en lib/pdfjs. */
import * as pdfjs from './lib/pdfjs/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./lib/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const $l = id => document.getElementById(id);
const docs = new Map();             // fuente → promesa del documento
let actual = null;                  // {fuente, doc, pagina, n, texto, paginaPasaje, titulo, sub}
let zoom = 1, turno = 0;

function cargarDoc(fuente) {
  if (!docs.has(fuente)) {
    const t = pdfjs.getDocument({ url: `${BASE}/v1/biblioteca/pdf/${encodeURIComponent(fuente)}.pdf`, standardFontDataUrl: new URL('./lib/pdfjs/standard_fonts/', import.meta.url).href, wasmUrl: new URL('./lib/pdfjs/wasm/', import.meta.url).href, isEvalSupported: false, disableAutoFetch: true });
    docs.set(fuente, t.promise.catch(e => { docs.delete(fuente); throw e; }));
  }
  return docs.get(fuente);
}

/* texto plano comparable: minúsculas, solo letras y números */
const plano = t => t.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

/* dónde está el pasaje en la página: varias anclas del fragmento buscadas en el texto de pdf.js */
function ubicar(items, texto) {
  let N = '', dueño = [];
  items.forEach((it, i) => { const p = plano(it.str); N += p; for (let k = 0; k < p.length; k++) dueño.push(i); });
  const F = plano(texto); if (!F || !N) return null;
  const inicios = [];
  for (const f of [.12, .3, .5, .7, .88]) {
    const o = Math.floor(F.length * f), a = F.slice(o, o + 28); if (a.length < 18) continue;
    const j = N.indexOf(a); if (j >= 0) inicios.push(j - o);
  }
  if (!inicios.length) return null;
  inicios.sort((a, b) => a - b);
  const s = Math.max(0, inicios[Math.floor(inicios.length / 2)]), e = Math.min(N.length - 1, s + F.length);
  return new Set(dueño.slice(s, e + 1));
}

async function pintar() {
  if (!actual || !actual.doc) return;
  const yo = ++turno, { doc, pagina } = actual;
  const pag = await doc.getPage(pagina); if (yo !== turno) return;
  const hoja = $l('lHoja'), ancho = hoja.clientWidth - 48;
  const base = pag.getViewport({ scale: 1 }), escala = Math.max(.3, ancho / base.width) * zoom;
  const vp = pag.getViewport({ scale: escala });
  const nitidez = Math.min(3, (window.devicePixelRatio || 1) * 1.6);
  const cv = document.createElement('canvas');
  cv.width = Math.floor(vp.width * nitidez); cv.height = Math.floor(vp.height * nitidez);
  cv.style.width = vp.width + 'px'; cv.style.height = vp.height + 'px';
  await pag.render({ canvasContext: cv.getContext('2d'), viewport: vp, transform: nitidez !== 1 ? [nitidez, 0, 0, nitidez, 0, 0] : null }).promise;
  if (yo !== turno) return;
  const caja = $l('lPag'); caja.style.width = vp.width + 'px'; caja.style.height = vp.height + 'px';
  caja.querySelector('canvas')?.remove(); caja.prepend(cv);
  // el pasaje, marcado encima de la página real
  const marcas = $l('lMarcas'); marcas.innerHTML = '';
  let primera = null;
  if (actual.texto && pagina === actual.paginaPasaje) {
    const tc = await pag.getTextContent(); if (yo !== turno) return;
    const sel = ubicar(tc.items, actual.texto);
    if (sel) {
      // un rectángulo por línea: se juntan los trozos de la misma altura
      const lineas = [];
      for (const i of sel) {
        const it = tc.items[i]; if (!it.str.trim()) continue;
        const m = pdfjs.Util.transform(vp.transform, it.transform), h = Math.hypot(m[2], m[3]), x = m[4], y = m[5] - h, w = it.width * escala;
        const l = lineas.find(l => Math.abs(l.y - y) < h * .5);
        if (l) { l.x0 = Math.min(l.x0, x); l.x1 = Math.max(l.x1, x + w); l.h = Math.max(l.h, h); } else lineas.push({ x0: x, x1: x + w, y, h });
      }
      for (const l of lineas) {
        const d = document.createElement('i');
        d.style.cssText = `left:${l.x0 - 3}px;top:${l.y - 2}px;width:${l.x1 - l.x0 + 6}px;height:${l.h + 5}px`;
        marcas.appendChild(d); if (!primera || l.y < primera.y) primera = l;
      }
    }
    $l('lAviso').textContent = sel ? 'Passage highlighted on the original page' : 'The passage is on this page';
    $l('lAviso').hidden = false;
  } else $l('lAviso').hidden = true;
  if (primera) hoja.scrollTo({ top: Math.max(0, primera.y - 120), behavior: 'smooth' });
  else if (actual.arriba) hoja.scrollTo({ top: 0 });
  actual.arriba = false;
  $l('lNum').value = pagina; $l('lDe').textContent = `of ${actual.n}`;
  $l('lZoom').textContent = Math.round(zoom * 100) + '%';
  $l('lAnt').disabled = pagina <= 1; $l('lSig').disabled = pagina >= actual.n;
  $l('lVolver').hidden = !actual.texto || pagina === actual.paginaPasaje;
  miniaturas();
}

/* tira de páginas vecinas para ver figuras y tablas cercanas */
let firmaMini = '';
async function miniaturas() {
  const { doc, pagina, n, fuente, paginaPasaje } = actual;
  const desde = Math.max(1, Math.min(pagina - 3, n - 6)), hasta = Math.min(n, desde + 6);
  const firma = `${fuente}:${desde}:${hasta}`;
  const tira = $l('lMini');
  if (firma !== firmaMini) {
    firmaMini = firma; tira.innerHTML = '';
    for (let p = desde; p <= hasta; p++) {
      const b = document.createElement('button'); b.dataset.lp = p; b.innerHTML = `<span>${p}</span>`; tira.appendChild(b);
      doc.getPage(p).then(pg => {
        const vp = pg.getViewport({ scale: 1 }), s = 120 / vp.height, v2 = pg.getViewport({ scale: s * 2 });
        const cv = document.createElement('canvas'); cv.width = v2.width; cv.height = v2.height;
        return pg.render({ canvasContext: cv.getContext('2d'), viewport: v2 }).promise.then(() => { if (firmaMini === firma) b.prepend(cv); });
      }).catch(() => {});
    }
  }
  tira.querySelectorAll('button').forEach(b => { b.classList.toggle('on', +b.dataset.lp === pagina); b.classList.toggle('pasaje', !!actual.texto && +b.dataset.lp === paginaPasaje); });
}

function cabecera(o) {
  $l('lTit').textContent = o.titulo || '';
  $l('lSub').textContent = [o.editor, o.anio, o.licencia].filter(Boolean).join(' · ');
}

/* {fuente, pagina, texto?, titulo, editor, anio, licencia, formato} */
window.abrirLibro = async function (o) {
  $l('bLector').classList.remove('vacio');
  cabecera(o);
  zoom = 1; firmaMini = '';
  if (o.formato && o.formato !== 'pdf') {
    // MedlinePlus llega como XML: no hay página que mostrar, se muestra el texto del tema
    actual = null; turno++;
    $l('lPag').hidden = true; $l('lPie').hidden = true; $l('lTexto').hidden = false;
    $l('lTexto').innerHTML = `<b>${escB(o.seccion || o.titulo)}</b><p>${escB(o.texto || 'Pick a topic from the search to read it here.')}</p><em>Text source: no page layout to show for this one.</em>`;
    $l('lAviso').hidden = true;
    return;
  }
  $l('lPag').hidden = false; $l('lPie').hidden = false; $l('lTexto').hidden = true;
  $l('lCarga').hidden = false;
  try {
    const doc = await cargarDoc(o.fuente);
    actual = { fuente: o.fuente, doc, n: doc.numPages, pagina: Math.min(doc.numPages, Math.max(1, +o.pagina || 1)), paginaPasaje: +o.pagina || 0, texto: o.texto || '', arriba: true };
    $l('lCarga').hidden = true;
    await pintar();
  } catch {
    $l('lCarga').hidden = true;
    $l('lTexto').hidden = false; $l('lPag').hidden = true; $l('lPie').hidden = true;
    $l('lTexto').innerHTML = `<b>The original document is not on board</b><p>${escB(o.texto || '')}</p><em>It arrives with the next library update from Earth.</em>`;
  }
};

const ir = p => { if (!actual) return; actual.pagina = Math.min(actual.n, Math.max(1, p)); actual.arriba = true; pintar(); };
document.addEventListener('click', e => {
  const b = e.target.closest('#bLector button'); if (!b || b.disabled) return;
  if (b.id === 'lAnt') ir(actual.pagina - 1);
  else if (b.id === 'lSig') ir(actual.pagina + 1);
  else if (b.id === 'lMas') { zoom = Math.min(3, zoom + .25); pintar(); }
  else if (b.id === 'lMenos') { zoom = Math.max(.5, zoom - .25); pintar(); }
  else if (b.id === 'lAjustar') { zoom = 1; pintar(); }
  else if (b.id === 'lVolver') ir(actual.paginaPasaje);
  else if (b.dataset.lp) ir(+b.dataset.lp);
});
$l('lNum').addEventListener('change', e => ir(+e.target.value || 1));
document.addEventListener('keydown', e => {
  if (vista !== 'biblioteca' || !actual || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
  if (e.key === 'ArrowRight') ir(actual.pagina + 1); else if (e.key === 'ArrowLeft') ir(actual.pagina - 1);
});
let tRes = 0;
addEventListener('resize', () => { clearTimeout(tRes); tRes = setTimeout(() => { if (vista === 'biblioteca' && actual) pintar(); }, 200); });
