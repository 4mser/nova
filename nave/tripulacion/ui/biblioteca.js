/* Vista de la biblioteca médica a bordo: a la izquierda las fuentes (o los resultados de una búsqueda) y a la derecha
   el lector con la página real del documento original y el pasaje marcado (lector.mjs). */
'use strict';
let biblio = null, bResultados = null, bConsulta = '', bElegido = null;
const escB = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const B_SUGERENCIAS = ['CPR in microgravity', 'kidney stones in spaceflight', 'bone loss countermeasures', 'radiation exposure limits', 'anaphylaxis treatment', 'sleep on long missions'];
/* color por editor, para reconocer la fuente de un vistazo */
const bColor = e => /NASA|OCHMO|HRP/i.test(e || '') ? 'var(--ac)' : /WHO|OMS/i.test(e || '') ? 'var(--ok)' : /OpenStax|MedlinePlus|NLM/i.test(e || '') ? 'var(--at)' : 'var(--nv)';

async function abrirBiblioteca() {
  try { biblio = await (await fetch(BASE + '/v1/biblioteca')).json(); } catch { biblio = null; }
  pintarLado();
  $('novaDice').textContent = 'Everything I know about medicine comes from these sources, and I always cite them. Click any passage to read the real page.';
}

function pintarLado() {
  const f = biblio && biblio.fuentes || [];
  if (bResultados) {
    $('bCab').innerHTML = `<button class="bvolver" data-bv="1">← All sources</button><span>${bResultados.length} passages for «${escB(bConsulta)}»</span>`;
    $('bRes').innerHTML = bResultados.length ? bResultados.map((x, j) => `
      <button class="bitem${bElegido === j ? ' on' : ''}" data-br="${j}">
        <div class="cab"><i style="background:${bColor(x.editor)}"></i><b>${escB(x.titulo)}</b></div>
        <div class="meta">${escB(x.editor)} · ${escB(x.anio)} · page ${escB(x.pagina)}${x.seccion ? ` · ${escB(x.seccion)}` : ''}<span class="rel"><em style="width:${Math.round(Math.max(.05, Math.min(1, x.puntaje)) * 100)}%"></em></span></div>
        <p>${resaltar(recortar(x.texto, bConsulta), bConsulta)}</p>
      </button>`).join('')
      : '<div class="bvacio">Nothing in the onboard library matches that.</div>';
    return;
  }
  $('bCab').innerHTML = `<span>Onboard sources</span><span>${f.length ? `${f.length} documents · ${Number(biblio.fragmentos).toLocaleString('en-US')} passages` : 'not loaded'}</span>`;
  $('bRes').innerHTML = f.length ? f.map((x, j) => `
      <button class="bf${bElegido === 'f' + j ? ' on' : ''}" data-bf="${j}">
        <i style="background:${bColor(x.editor)}"></i>
        <div><b>${escB(x.titulo)}</b><span>${escB(x.editor)} · ${escB(x.anio)} · ${Number(x.fragmentos).toLocaleString('en-US')} passages</span><em>${escB(x.licencia)}</em></div>
      </button>`).join('') + `<p class="bnota">Open-licensed references only. NOVA cites every passage it uses, and every citation opens here on its real page.</p>`
    : '<p class="bvacio">The library index is not on board yet. It arrives with the nightly update from Earth.</p>';
  if ($('bLector').classList.contains('vacio')) $('lSug').innerHTML = B_SUGERENCIAS.map(s => `<button data-bs="${escB(s)}">${escB(s)}</button>`).join('');
}

/* el pedazo del fragmento donde aparecen las palabras buscadas */
function recortar(t, q) {
  t = String(t || ''); if (t.length < 320) return t;
  const pal = q.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const i = pal.map(w => t.toLowerCase().indexOf(w)).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const ini = Math.max(0, i - 90);
  return (ini ? '…' : '') + t.slice(ini, ini + 300) + '…';
}
function resaltar(t, q) {
  const pal = q.toLowerCase().split(/\W+/).filter(w => w.length > 3).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const e = escB(t);
  return pal.length ? e.replace(new RegExp(`\\b(${pal.join('|')})\\w*`, 'gi'), '<mark>$&</mark>') : e;
}

async function buscarBiblioteca(q) {
  q = q.trim(); if (!q) return;
  bConsulta = q; bElegido = null; $('bIn').value = q;
  $('bCab').innerHTML = `<span>Searching «${escB(q)}»</span>`;
  $('bRes').innerHTML = '<p class="pensando"><i></i><i></i><i></i></p>';
  try {
    bResultados = await (await fetch(`${BASE}/v1/biblioteca/buscar?q=${encodeURIComponent(q)}&k=10`)).json();
    pintarLado();
    if (bResultados.length) abrirResultado(0);
  } catch { bResultados = []; $('bRes').innerHTML = '<div class="bvacio">The library search is not running.</div>'; }
}

function formatoDe(id) { const f = (biblio && biblio.fuentes || []).find(x => x.id === id); return f ? f.formato : 'pdf'; }
function abrirResultado(j) {
  const x = bResultados[j]; if (!x) return;
  bElegido = j; pintarLado();
  window.abrirLibro && window.abrirLibro({ ...x, formato: formatoDe(x.fuente) });
}

/* desde una cita de NOVA: abre la biblioteca en esa página con el pasaje marcado */
window.leerCita = async function (f) {
  cambiarVista('biblioteca');
  if (!biblio) await abrirBiblioteca();
  bResultados = null; bElegido = null; pintarLado();
  window.abrirLibro && window.abrirLibro({ ...f, formato: formatoDe(f.fuente) });
};

$('bForm').addEventListener('submit', e => { e.preventDefault(); buscarBiblioteca($('bIn').value); });
document.addEventListener('click', e => {
  const b = e.target.closest('#biblioteca button'); if (!b) return;
  if (b.dataset.br != null) abrirResultado(+b.dataset.br);
  else if (b.dataset.bf != null) { const x = biblio.fuentes[+b.dataset.bf]; bElegido = 'f' + b.dataset.bf; pintarLado(); window.abrirLibro({ fuente: x.id, pagina: 1, titulo: x.titulo, editor: x.editor, anio: x.anio, licencia: x.licencia, formato: x.formato }); }
  else if (b.dataset.bv) { bResultados = null; bElegido = null; $('bIn').value = ''; pintarLado(); }
  else if (b.dataset.bs) buscarBiblioteca(b.dataset.bs);
});
