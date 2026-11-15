/* Vista Medical kit: el inventario en vivo del botiquín.
   · Arriba, el rack médico en 3D (kit3d.mjs): seis cajones (packs al estilo del botiquín de la Estación Espacial) que
     se deslizan al tocarlos y sueltan sus insumos como tarjetas con su foto real (Wikimedia Commons, licencia libre).
   · Modo escenario: se elige una emergencia y se encienden solo los cajones e insumos de ese protocolo, con un hilo de
     luz de cada tarjeta a su cajón, y el panel dice qué sacar y de dónde.
   · Abajo, la autonomía: hasta qué día de la misión alcanza cada insumo (vence o se acaba al ritmo de uso), frente a
     la llegada a Marte, la salida y el regreso a la Tierra.
   Cada insumo: cantidad, ubicación, vencimiento, protocolos, y botones para registrar un uso o corregir lo contado.
   Todo pasa por /v1/kit y NOVA lo lee. */
'use strict';

let KIT = null, kPack = null, kItem = null, kEsc = '', kPedido = 0, kTrip = '';
const LETRA = ['A', 'B', 'C', 'D', 'E', 'F'];
const K_EST = { ok: 'var(--ok)', bajo: 'var(--at)', agotado: 'var(--al)' };

async function pedirKit() {
  const n = ++kPedido;
  try { const d = await (await fetch(BASE + '/v1/kit')).json(); if (n === kPedido) KIT = d; } catch { }
}
const kItems = p => KIT.items.filter(i => i.pack === p);
const kPl = (it, n = it.cantidad) => `${it.unidad}${n === 1 ? '' : 's'}`;
function kVence(it) {
  if (it.vence_dia == null) return { txt: 'No expiry', cls: '' };
  const d = it.vence_en_dias;
  if (it.vence_cuando === 'vencido') return { txt: 'Expired', cls: 'al' };
  if (it.vence_cuando === 'antes_de_marte') return { txt: `Expires day ${it.vence_dia} · before Mars`, cls: 'al' };
  if (it.vence_cuando === 'antes_del_regreso') return { txt: `Expires day ${it.vence_dia} · before Earth`, cls: d < 120 ? 'at' : 'nv' };
  return { txt: `Lasts the mission (day ${it.vence_dia})`, cls: '' };
}
const kFecha = dia => { if (!mision) return ''; const t = Date.now() + (dia - (mision.dia_exacto || mision.dia)) * 864e5; return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
const kProt = id => (typeof PROTOCOLOS !== 'undefined' && PROTOCOLOS.find(q => q.id === id)) || null;
const kTitulo = id => { const p = kProt(id); return p ? p.titulo.replace(/ in microgravity| \(.*\)/i, '') : id; };

/* ── autonomía: hasta qué día alcanza cada insumo ── */
function kFases() {
  const r = KIT.resumen, total = r.total || 1018, ida = (mision && mision.transferencia_dias) || r.llegada_marte || 259;
  return { total, llegada: ida, salida: total - ida, hoy: r.dia };
}
function kAlcance(it) {
  const { total, hoy } = kFases();
  const usados = Math.max(0, it.inicial - it.cantidad), ritmo = hoy > 5 && usados > 0 ? usados / hoy : 0;  // por día
  const seAcaba = it.cantidad <= 0 ? hoy : ritmo ? hoy + it.cantidad / ritmo : Infinity;
  const vence = it.vence_dia != null ? it.vence_dia : Infinity;
  const fin = Math.min(seAcaba, vence);
  return { fin, porque: fin === Infinity ? 'lasts' : seAcaba <= vence ? 'runs out' : 'expires', ritmo, alcanza: fin >= total };
}
function pintarAutonomia() {
  const { total, llegada, salida, hoy } = kFases(), X = d => `${Math.max(0, Math.min(100, d / total * 100)).toFixed(2)}%`;
  let lista;
  if (kEsc) lista = KIT.items.filter(x => (x.protocolos || []).includes(kEsc));
  else if (kPack) lista = kItems(kPack);
  else lista = KIT.items.filter(x => !kAlcance(x).alcanza || x.estado !== 'ok');
  lista = lista.map(it => ({ it, a: kAlcance(it) })).sort((p, q) => p.a.fin - q.a.fin).slice(0, kEsc || kPack ? 12 : 6);
  const titulo = kEsc ? `${kTitulo(kEsc)}: will it last?` : kPack ? `Drawer ${LETRA[KIT.packs.findIndex(p => p.id === kPack)]}: will it last?` : 'Will it last until Earth?';
  const faltan = KIT.items.filter(x => !kAlcance(x).alcanza).length;
  $('kAuto').innerHTML = `<div class="kacab"><b>${titulo}</b><span>${faltan ? `${faltan} of ${KIT.items.length} supplies end before the return · ` : 'Everything lasts the mission · '}by expiry and by the crew's real rate of use</span></div>
    <div class="kaeje"><span class="kanom"></span><span class="karegla">
      <i class="kfase" style="left:0;width:${X(llegada)}">Cruise to Mars</i><i class="kfase m" style="left:${X(llegada)};width:calc(${X(salida)} - ${X(llegada)})">On Mars</i><i class="kfase" style="left:${X(salida)};width:calc(100% - ${X(salida)})">Return</i>
      <em class="khoy" style="left:${X(hoy)}">Today · day ${hoy}</em></span></div>
    <div class="kafilas">${lista.length ? lista.map(({ it, a }) => {
      const fin = Math.min(a.fin, total), cls = a.alcanza ? 'ok' : fin < llegada ? 'al' : 'at';
      const rot = a.alcanza ? (a.fin === Infinity ? 'lasts the mission' : `${a.porque} day ${Math.round(a.fin)}`) : `${a.porque} day ${Math.round(a.fin)}${fin < llegada ? ' · before Mars' : fin < salida ? ' · on Mars' : ' · before Earth'}`;
      return `<button class="kafila${kItem === it.id ? ' on' : ''}" data-kver="${it.id}"><span class="kanom">${it.n}</span><span class="karegla">
        <i class="kalin" style="left:${X(llegada)}"></i><i class="kalin" style="left:${X(salida)}"></i><i class="kalin hoy" style="left:${X(hoy)}"></i>
        <i class="kabar ${cls}" style="left:${X(hoy)};width:calc(${X(fin)} - ${X(hoy)})"></i>
        <em class="${cls}${fin / total > .72 ? ' izq' : ''}" style="left:${X(fin)}">${rot}${a.ritmo ? ` · ${(a.ritmo * 30).toFixed(1)}/month` : ''}</em></span></button>`;
    }).join('') : '<p class="kavacio">Nothing ends before the return.</p>'}</div>`;
}

/* ── escena 3D + panel ── */
function pintarKit() {
  if (!KIT) return;
  const r = KIT.resumen;
  $('kResumen').innerHTML = `<span class="pil">Items <b>${r.items}</b></span><span class="pil ${r.bajos + r.agotados ? 'at' : ''}">Low or out <b>${r.bajos + r.agotados}</b></span><span class="pil ${r.vencidos ? 'al' : ''}">Expired <b>${r.vencidos}</b></span><span class="pil">Expire before Earth <b>${r.vencen_antes_del_regreso}</b></span>`;
  const usados = [...new Set(KIT.items.flatMap(x => x.protocolos || []))].filter(kProt);
  $('kEsc').innerHTML = `<span>Emergency</span><button class="${kEsc ? '' : 'on'}" data-kesc="">All supplies</button>` + usados.map(id => `<button class="${kEsc === id ? 'on' : ''}" data-kesc="${id}">${kTitulo(id)}</button>`).join('');
  const pi = KIT.packs.findIndex(p => p.id === kPack);
  $('kSello').innerHTML = `<b>NOVA · MEDICAL RACK</b><span>${kEsc ? `SCENARIO · ${kTitulo(kEsc).toUpperCase()}` : kPack ? `DRAWER ${LETRA[pi]} · PULLED OUT` : 'SIX DRAWERS · A–F'}</span><span>DAY ${r.dia} · LIVE INVENTORY</span>`;
  if (window.kit3d) kit3d.pintar($('kEscena'), KIT, { pack: kPack, item: kItem, escenario: kEsc }, {
    onCajon: id => { kEsc = ''; kPack = kPack === id ? null : id; kItem = null; pintarKit(); },
    onItem: id => { kItem = id; pintarKit(); },
  });
  pintarPanelKit(); pintarAutonomia();
}

function pintarPanelKit() {
  const P = $('kPanel');
  if (kItem) {
    const it = KIT.items.find(x => x.id === kItem), pi = KIT.packs.findIndex(p => p.id === it.pack), p = KIT.packs[pi], k = kItems(it.pack).indexOf(it), v = kVence(it), a = kAlcance(it);
    const prot = (it.protocolos || []).map(id => `<button class="kchip" data-kesc="${id}">${kTitulo(id)}</button>`).join('');
    P.innerHTML = `<button class="gpvolver" data-ki="">← ${kEsc ? kTitulo(kEsc) : p.n}</button>
      <div class="kdfoto">${it.foto ? `<img src="${it.foto.archivo}" alt="">` : '<span>Photo pending</span>'}<i class="knumc" style="background:${p.color}">${LETRA[pi]}${k + 1}</i></div>
      <h3>${it.n}</h3>
      <div class="kdq"><b style="color:${K_EST[it.estado]}">${it.cantidad}</b><span>${kPl(it)} left · minimum ${it.minimo}${it.estado === 'bajo' ? ' · <em class="at">low</em>' : it.estado === 'agotado' ? ' · <em class="al">none left</em>' : ''}</span></div>
      <dl><dt>Where</dt><dd>${p.donde} · slot ${LETRA[pi]}${k + 1}</dd>
      <dt>Expires</dt><dd class="${v.cls}">${it.vence_dia != null ? `${kFecha(it.vence_dia)} · ${v.txt}` : v.txt}</dd>
      <dt>Lasts</dt><dd class="${a.alcanza ? '' : 'at'}">${a.fin === Infinity ? 'The whole mission' : `Until day ${Math.round(a.fin)} (${a.porque})${a.alcanza ? '' : ' · not enough for the return'}`}</dd>
      <dt>Use</dt><dd>${it.uso}</dd>${prot ? `<dt>Protocols</dt><dd>${prot}</dd>` : ''}</dl>
      <div class="kacc"><div class="kquien">${CREW.map(c => `<button data-ktrip="${c.id}" class="${kTrip === c.id ? 'on' : ''}">${c.corto}</button>`).join('')}</div>
        <button class="gpbtn pri" data-kuso="${it.id}">Log one used</button><button class="gpbtn" data-kcont="${it.id}">Correct count</button></div>
      <div class="kcont" id="kCont" hidden><input type="number" min="0" id="kContIn" value="${it.cantidad}"><button class="gpbtn" data-kfij="${it.id}">Save count</button></div>
      ${it.foto ? `<p class="kcred">Photo: <a href="${it.foto.fuente}" target="_blank" rel="noopener">${it.foto.autor.replace(/</g, '')}</a> · ${it.foto.licencia} · Wikimedia Commons</p>` : ''}`;
    return;
  }
  const filaItem = it => { const pi = KIT.packs.findIndex(p => p.id === it.pack), p = KIT.packs[pi]; return `<li data-ki="${it.id}"><div class="kmini">${it.foto ? `<img src="${it.foto.archivo}" alt="" loading="lazy">` : ''}</div><span>${it.n}<small>${it.cantidad} ${kPl(it)} · ${kEsc ? `drawer ${LETRA[pi]} · ${p.n.toLowerCase()}` : kVence(it).txt}</small></span><i style="background:${K_EST[it.estado]}"></i></li>`; };
  if (kEsc) {
    const pr = kProt(kEsc), its = KIT.items.filter(x => (x.protocolos || []).includes(kEsc)), cajs = [...new Set(its.map(x => LETRA[KIT.packs.findIndex(p => p.id === x.pack)]))].sort();
    const faltan = its.filter(x => x.estado !== 'ok' || x.vence_cuando === 'vencido');
    P.innerHTML = `<button class="gpvolver" data-kesc="">← All supplies</button>
      <div class="gpt"><i style="background:var(--al)"></i><b>${pr ? pr.titulo : kEsc}</b></div>
      <p class="kdesc">Grab ${its.length} item${its.length === 1 ? '' : 's'} from drawer${cajs.length === 1 ? '' : 's'} ${cajs.length > 1 ? cajs.slice(0, -1).join(', ') + ' and ' + cajs.at(-1) : cajs[0]}.${faltan.length ? ` <em class="at">${faltan.map(x => x.n).join(', ')}: check before you need ${faltan.length === 1 ? 'it' : 'them'}.</em>` : ' Everything is in stock.'}</p>
      <ol class="kley kfotos">${its.map(filaItem).join('')}</ol>
      ${pr && pr.guia ? `<button class="gpbtn pri kguia" data-guia="${pr.id}" data-gi="0">Open the step-by-step guide</button>` : ''}`;
    return;
  }
  if (kPack) {
    const pi = KIT.packs.findIndex(p => p.id === kPack), p = KIT.packs[pi];
    P.innerHTML = `<button class="gpvolver" data-kp="">← Whole rack</button>
      <div class="gpt"><i style="background:${p.color}"></i><b>${LETRA[pi]} · ${p.n}</b></div><p class="kdesc">${p.nota}</p>
      <ol class="kley kfotos">${kItems(kPack).map(filaItem).join('')}</ol>`;
    return;
  }
  P.innerHTML = `<div class="gpcab"><b>Medical kit</b><span>Live inventory · click a drawer or pick an emergency</span></div>
    <ol class="kley">${KIT.packs.map((p, i) => { const its = kItems(p.id), mal = its.filter(x => x.estado !== 'ok').length; return `<li data-kp="${p.id}"><b style="color:${p.color}">${LETRA[i]}</b><span>${p.n}<small>${p.donde} · ${its.length} items${mal ? ` · ${mal} low` : ''}</small></span><i style="background:${p.color}"></i></li>`; }).join('')}</ol>
    <p class="kcred">Kit modeled on the ISS Crew Health Care System packs (NASA). Photos: Wikimedia Commons, open licenses, credited on each item.</p>`;
}

function novaKit() {
  if (!KIT) { $('novaDice').textContent = 'Reading the medical kit.'; return; }
  const r = KIT.resumen, vencen = KIT.items.filter(i => i.vence_cuando === 'antes_del_regreso' || i.vence_cuando === 'antes_de_marte').sort((a, b) => a.vence_dia - b.vence_dia);
  $('novaDice').textContent = `${r.vencen_antes_del_regreso} supplies expire before we are back on Earth${vencen[0] ? `; ${vencen[0].n.toLowerCase()} first, on day ${vencen[0].vence_dia}` : ''}. Pick an emergency and I light up what to grab.`;
  const fila = (col, b, txt) => `<div><i style="background:${col}"></i><span><b>${b}</b> ${txt}</span></div>`;
  const bajos = KIT.items.filter(i => i.estado !== 'ok');
  $('ultimas').innerHTML = [...bajos.map(i => fila(K_EST[i.estado], i.n, `${i.cantidad} left, minimum ${i.minimo}`)), ...vencen.slice(0, 3).map(i => fila('var(--nv)', i.n, `expires day ${i.vence_dia} (${kFecha(i.vence_dia)})`))].slice(0, 5).join('');
}

async function abrirKit() {
  cambiarVista('kit');
  await pedirKit(); pintarKit(); novaKit();
}

document.addEventListener('click', async e => {
  const t = e.target.closest('#kit [data-kp],#kit [data-ki],#kit [data-kuso],#kit [data-kcont],#kit [data-kfij],#kit [data-ktrip],#kit [data-kver],#kit [data-kesc]'); if (!t || !KIT) return;
  if (t.dataset.kesc != null) { kEsc = t.dataset.kesc; kPack = null; kItem = null; pintarKit(); }
  else if (t.dataset.kp != null) { kPack = t.dataset.kp || null; kEsc = ''; kItem = null; pintarKit(); }
  else if (t.dataset.kver) { const it = KIT.items.find(x => x.id === t.dataset.kver); if (!kEsc) kPack = it.pack; kItem = it.id; pintarKit(); }
  else if (t.dataset.ki != null) { kItem = t.dataset.ki || null; pintarKit(); }
  else if (t.dataset.ktrip) { kTrip = kTrip === t.dataset.ktrip ? '' : t.dataset.ktrip; pintarPanelKit(); }
  else if (t.dataset.kcont) { $('kCont').hidden = !$('kCont').hidden; }
  else if (t.dataset.kuso || t.dataset.kfij) {
    const ruta = t.dataset.kuso ? '/v1/kit/uso' : '/v1/kit/ajuste', id = t.dataset.kuso || t.dataset.kfij;
    const cuerpo = t.dataset.kuso ? { id, cantidad: 1, trip: kTrip } : { id, cantidad: +$('kContIn').value };
    await fetch(BASE + ruta, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
    await pedirKit(); pintarKit(); novaKit();
  }
});

/* Ask the rack (ConceptGraphs, Gu et al. 2023): the rack is an object graph the brain can query in plain words.
   The answer opens the drawer, picks the item and Nova says where it is. */
$('kBusca')?.addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('kBuscaIn').value.trim(); if (!q) return;
  const r = $('kResp'); r.hidden = false; r.innerHTML = '<span class="kpens">Nova is looking through the rack…</span>';
  try {
    const d = await (await fetch(BASE + '/v1/kit/buscar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q }) })).json();
    const objs = d.objetos || [];
    r.innerHTML = `<b>${d.query_achievable === false || !objs.length ? 'Not in the rack' : objs.map(o => `${o.n} · ${o.cajon}`).join('  →  ')}</b><p>${d.explanation || ''}</p><em>${d.cerebro === 'claude' ? 'demo brain · Claude' : 'onboard model'} · rack read as an object graph</em>`;
    if (objs[0]) { kEsc = ''; kPack = objs[0].pack; kItem = objs[0].id; pintarKit(); }
    if (typeof hablar === 'function' && d.explanation) hablar(d.explanation, { idioma: 'en' });
  } catch { r.innerHTML = '<span class="kpens">The rack search is not available.</span>'; }
});
