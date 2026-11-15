/* Mind · Constellations: la semana de la tripulación en un solo cielo, para comparar a todos de forma interactiva.
   Solo entra quien lo permite («Compartir mi día» en su app NOVA: campo `mente` de /tripulacion.json); sin tripulación
   real se ve la de demostración. Usa los 14 días que arma mente.js (mDias, pedirDias).
   · Se elige qué comparar (ánimo, energía o sueño) y el rango (7 o 14 días); cada persona se muestra u oculta con su
     botón y se destaca al tocar su línea.
   · El cursor sobre un día muestra los valores de todos ese día. Las líneas iguales se separan apenas para no taparse.
   · Debajo, cada persona: promedio de la semana y cambio frente a la anterior.
   Dos vistas: «Each person» (por defecto, la constelación de cada uno igual a la de su app) y «Together» (todos en un
   cielo). Colores de la app NOVA (ui/Graficos.tsx): estrellas en la rampa celeste → fucsia, línea celeste translúcida,
   estrellas que titilan y un punto que recorre la semana. En «Together» cada persona se distingue por el trazo de su
   línea y su nombre (el color sigue siendo de la rampa, como en la app). */
'use strict';
let mTab = 'general';
const CN = { vista: 'cada', k: 'animo', dias: 14, ocultos: new Set(), foco: null, dia: null, tabla: false };
// la rampa de la app: energía alta → celeste, baja → fucsia (en la app es el estrés: tranquilo celeste, alto fucsia)
const CN_RAMPA = ['#ec6aa8', '#d27fd0', '#a898ff', '#8fb8ff', '#46c8e8'];
const CN_LINEA = 'rgba(143,230,245,.5)';
const CN_TRAZO = ['', '7 5', '2 5', '10 4 2 4'];   // cada persona, su trazo
const cnColE = e => CN_RAMPA[Math.max(0, Math.min(4, Math.round((e ?? 3) - 1)))];
const CN_MET = {
  animo: { n: 'Mood', u: '/5', dom: [1, 5], fmt: v => v.toFixed(0), marcas: [[1, 'low'], [2, ''], [3, 'ok'], [4, ''], [5, 'great']], entero: true },
  energia: { n: 'Energy', u: '/5', dom: [1, 5], fmt: v => v.toFixed(0), marcas: [[1, 'drained'], [2, ''], [3, 'ok'], [4, ''], [5, 'full']], entero: true },
  sueno_h: { n: 'Sleep', u: 'h', dom: null, fmt: v => v.toFixed(1), marcas: null },
};
const cnEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function permiteMente(c) { return !c.vacio && (!c.real || c.mente === true); }
const cnPersonas = () => CREW.map((c, i) => ({ c, i, col: CN_LINEA, trazo: CN_TRAZO[i % CN_TRAZO.length] })).filter(p => permiteMente(p.c));
const cnFecha = j => { const d = new Date(); d.setHours(0, 0, 0, 0); return new Date(d.getTime() - (13 - j) * 864e5); };

function cnDominio(ps) {
  const M = CN_MET[CN.k]; if (M.dom) return M.dom;
  const v = ps.flatMap(p => (mDias[p.i]?.[CN.k] || []).slice(14 - CN.dias)).filter(x => x != null);
  if (!v.length) return [5, 9];
  return [Math.max(0, Math.floor(Math.min(...v) * 2) / 2 - .5), Math.ceil(Math.max(...v) * 2) / 2 + .5];
}

function pintarConstelaciones() {
  const caja = document.getElementById('mConst'); if (!caja || mTab !== 'const') return;
  if (typeof mDias === 'undefined' || !mDias) { caja.innerHTML = '<p class="cvacio">Loading each person\'s week…</p>'; if (typeof pedirDias === 'function') pedirDias().then(pintarConstelaciones); return; }
  const ps = cnPersonas(), priv = CREW.filter(c => !c.vacio && !permiteMente(c));
  if (!ps.length) { caja.innerHTML = '<p class="cvacio">Nobody is sharing their week right now.</p>' + cnPrivados(priv); return; }
  const vistas = `<div class="cnseg">${[['cada', 'Each person'], ['juntos', 'Together']].map(([k, n]) => `<button data-cnv="${k}" class="${k === CN.vista ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  if (CN.vista === 'cada') {
    caja.innerHTML = `<div class="cnfiltros">${vistas}</div><div class="cgrid">${ps.map(p => cnCada(p)).join('')}</div>${cnPrivados(priv)}
      <p class="cley">Height = mood · size = sleep · color = energy (cyan full, pink drained), like each person's NOVA app. Hover a star for that day.</p>`;
    cnEventosCada(); return;
  }
  const M = CN_MET[CN.k];
  caja.innerHTML = `
    <div class="cnfiltros">${vistas}
      <div class="cnseg">${Object.entries(CN_MET).map(([k, m]) => `<button data-cnk="${k}" class="${k === CN.k ? 'on' : ''}">${m.n}</button>`).join('')}</div>
      <div class="cnseg">${[7, 14].map(d => `<button data-cnd="${d}" class="${d === CN.dias ? 'on' : ''}">${d} days</button>`).join('')}</div>
      <div class="cnchips">${ps.map(p => `<button data-cnp="${p.i}" class="${CN.ocultos.has(p.i) ? '' : 'on'}">${cnLlave(p)}${cnEsc(p.c.corto)}</button>`).join('')}</div>
      <button class="cntabla ${CN.tabla ? 'on' : ''}" data-cntabla>Table</button>
    </div>
    <div class="panel cnpanel"><h3>The crew's ${M.n.toLowerCase()} · last ${CN.dias} days<span>${ps.some(p => p.c.real) ? 'shared from each person\'s NOVA app' : 'demo crew'}</span></h3>
      <div class="cnlienzo">${cnSVG(ps)}<div class="cntip" id="cnTip" hidden></div></div>
      ${CN.tabla ? cnTabla(ps) : ''}
      <p class="cley">${CN.k === 'sueno_h' ? 'Hours slept each night.' : `${M.n} from each person's daily check-in, 1 to 5.`} Star size = hours slept · color = energy (cyan full, pink drained) · each person has their own line style. Hover a day to compare everyone; tap a line to follow one person.${M.entero ? ' Equal values are nudged slightly apart so no line hides another.' : ''}</p>
    </div>
    <div class="cnresumen">${ps.map(p => cnTarjeta(p)).join('')}</div>
    ${cnPrivados(priv)}`;
  cnEventos(ps);
}
function cnPrivados(priv) { return priv.length ? `<p class="cpriv">Private: ${priv.map(c => cnEsc(c.corto)).join(', ')} · shown only when they turn on «Share my day» in their NOVA app</p>` : ''; }

// geometría compartida por el dibujo y el cursor
const CNG = { W: 960, H: 340, l: 64, r: 120, t: 24, b: 44 };
function cnEscalas(ps) {
  const [y0, y1] = cnDominio(ps), n = CN.dias, { W, H, l, r, t, b } = CNG;
  const x = j => l + (n === 1 ? 0 : j * (W - l - r) / (n - 1));
  const y = v => H - b - (v - y0) / (y1 - y0) * (H - t - b);
  return { x, y, y0, y1 };
}
function cnSerie(p) {
  const d = mDias[p.i] || {}, off = 14 - CN.dias;
  return Array.from({ length: CN.dias }, (_, j) => ({ j, v: d[CN.k]?.[off + j] ?? null, animo: d.animo?.[off + j], energia: d.energia?.[off + j], sueno: d.sueno_h?.[off + j] }));
}
function cnSVG(ps) {
  const { W, H, l, r, t, b } = CNG, { x, y, y0, y1 } = cnEscalas(ps), M = CN_MET[CN.k];
  const vis = ps.filter(p => !CN.ocultos.has(p.i));
  // cielo: estrellas de fondo, quietas y tenues
  const h = k => { const v = Math.sin(k * 127.1) * 43758.5453; return v - Math.floor(v); };
  let s = `<svg viewBox="0 0 ${W} ${H}" class="cnsvg" tabindex="0" role="img" aria-label="${cnEsc(M.n)} of each crew member, last ${CN.dias} days">`;
  for (let k = 0; k < 70; k++) s += `<circle cx="${(h(k) * W).toFixed(1)}" cy="${(h(k + 99) * (H - b)).toFixed(1)}" r="${h(k + 7) < .9 ? .8 : 1.4}" fill="#dfe8f2" opacity="${(.06 + h(k + 3) * .18).toFixed(2)}"/>`;
  // ejes recesivos
  const marcas = M.marcas || (() => { const o = []; for (let v = Math.ceil(y0); v <= y1; v++) o.push([v, '']); return o; })();
  marcas.forEach(([v, lab]) => { s += `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.07)"/><text x="${l - 12}" y="${y(v) + 4}" text-anchor="end" class="cneje">${M.entero ? v : v + ' h'}${lab ? ` · ${lab}` : ''}</text>`; });
  for (let j = 0; j < CN.dias; j++) {
    const f = cnFecha(14 - CN.dias + j), hoy = j === CN.dias - 1;
    if (CN.dias === 14 && j % 2 && !hoy) continue;
    s += `<text x="${x(j)}" y="${H - 16}" text-anchor="middle" class="cneje">${hoy ? 'Today' : f.toLocaleDateString('en', CN.dias === 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' })}</text>`;
  }
  s += `<rect x="${l - 20}" y="${t}" width="${W - l - r + 40}" height="${H - t - b}" fill="transparent"/>`;   // el cursor responde en todo el cielo
  s += `<line id="cnCruz" x1="0" x2="0" y1="${t}" y2="${H - b}" stroke="rgba(255,255,255,.35)" visibility="hidden" pointer-events="none"/>`;
  // una constelación por persona (líneas iguales apenas separadas en ánimo y energía)
  const etiquetas = [];
  vis.forEach((p, n) => {
    const nud = M.entero ? (n - (vis.length - 1) / 2) * .09 : 0, ser = cnSerie(p).filter(o => o.v != null);
    const dim = CN.foco != null && CN.foco !== p.i, op = dim ? .18 : 1;
    let d = '';
    ser.forEach((o, k) => { const X = x(o.j), Y = y(o.v + nud); if (!k) d = `M${X} ${Y}`; else { const a = ser[k - 1], ax = x(a.j), ay = y(a.v + nud), cx = (ax + X) / 2; d += ` C${cx} ${ay} ${cx} ${Y} ${X} ${Y}`; } });
    s += `<g class="cnserie" data-cns="${p.i}" opacity="${op}">`;
    s += `<path d="${d}" fill="none" stroke="${CN.foco === p.i ? 'rgba(191,238,250,.9)' : CN_LINEA}" stroke-width="${CN.foco === p.i ? 2.6 : 1.8}" stroke-dasharray="${p.trazo}" stroke-linecap="round"/>`;
    s += `<path d="${d}" fill="none" stroke="transparent" stroke-width="18"/>`;   // zona para tocar la línea
    ser.forEach(o => {
      const rr = Math.max(4, Math.min(9, 4 + ((o.sueno ?? 7) - 5.5) * 1.6)), X = x(o.j), Y = y(o.v + nud);
      const ce = cnColE(o.energia);
      s += `<circle cx="${X}" cy="${Y}" r="${(rr * 2.4).toFixed(1)}" fill="${ce}" opacity=".16"/><circle cx="${X}" cy="${Y}" r="${rr.toFixed(1)}" fill="${ce}" stroke="#0a0f15" stroke-width="1.5"/>`;
    });
    s += '</g>';
    const u = ser[ser.length - 1]; if (u) etiquetas.push({ y: y(u.v + nud), n: p.c.corto, trazo: p.trazo, op });
  });
  // nombres al final de cada línea, sin chocar
  etiquetas.sort((a, b) => a.y - b.y); for (let k = 1; k < etiquetas.length; k++) etiquetas[k].y = Math.max(etiquetas[k].y, etiquetas[k - 1].y + 17);
  etiquetas.forEach(e => { s += `<g opacity="${e.op}"><line x1="${W - r + 6}" x2="${W - r + 24}" y1="${e.y}" y2="${e.y}" stroke="rgba(191,238,250,.8)" stroke-width="2" stroke-dasharray="${e.trazo}"/><text x="${W - r + 28}" y="${e.y + 4}" class="cnnom">${cnEsc(e.n)}</text></g>`; });
  return s + '</svg>';
}
const cnLlave = p => `<svg class="cnllave" viewBox="0 0 22 6"><line x1="1" x2="21" y1="3" y2="3" stroke="rgba(191,238,250,.85)" stroke-width="2" stroke-dasharray="${p.trazo}" stroke-linecap="round"/></svg>`;

/* «Each person»: la constelación de su app con su semana (7 días); al pasar sobre una estrella, lo de ese día */
function cnCada(p) {
  const d = mDias[p.i] || {}, W = 600, H = 168, dias = Array.from({ length: 7 }, (_, j) => ({ j, a: d.animo?.[7 + j], s: d.sueno_h?.[7 + j], e: d.energia?.[7 + j] }));
  const x = j => 30 + j * (W - 60) / 6, y = a => H - 32 - (a - 1) / 4 * (H - 56);
  const h = k => { const v = Math.sin(k * 127.1 + p.i * 31.7) * 43758.5453; return v - Math.floor(v); };
  let fondo = '';
  for (let c = 0; c < 3; c++) { fondo += `<g class="cntit cntit${c}">`; for (let k = 0; k < 16; k++) { const q = k * 3 + c; fondo += `<circle cx="${(h(q) * W).toFixed(1)}" cy="${(h(q + 50) * (H - 34)).toFixed(1)}" r="${[.7, .55, .85][c]}" fill="#dfe8f2"/>`; } fondo += '</g>'; }
  const pts = dias.filter(o => o.a != null).map(o => ({ ...o, X: x(o.j), Y: y(o.a) }));
  let ruta = '';
  pts.forEach((o, k) => { if (!k) { ruta = `M${o.X} ${o.Y}`; return; } const a = pts[k - 1], cx = (a.X + o.X) / 2; ruta += ` C${cx} ${a.Y} ${cx} ${o.Y} ${o.X} ${o.Y}`; });
  const estrellas = pts.map(o => {
    const r = Math.max(3, 3.5 + ((o.s ?? 7) - 6) * 2), c = cnColE(o.e), f = cnFecha(7 + o.j);
    return `<g class="cnestrella" data-cnd-dia="${o.j === 6 ? 'Today' : f.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'short' })}" data-cnd-v="${o.a}|${o.s ?? ''}|${o.e ?? ''}" data-cnd-x="${o.X}"><circle cx="${o.X}" cy="${o.Y}" r="${(r * 2.4).toFixed(1)}" fill="${c}" opacity=".16"/><circle cx="${o.X}" cy="${o.Y}" r="${r.toFixed(1)}" fill="${c}"/><circle cx="${o.X}" cy="${o.Y}" r="16" fill="transparent"/></g>`;
  }).join('');
  const viaje = pts.length > 1 ? `<circle r="3" fill="#fff"><animateMotion dur="${(pts.length * .8).toFixed(1)}s" repeatCount="indefinite" path="${ruta}"/></circle>` : '';
 const etq = dias.map(o => `<text x="${x(o.j)}" y="${H - 8}" text-anchor="middle" class="cneje">${o.j === 6 ? 'Today' : cnFecha(7 + o.j).toLocaleDateString('en', { weekday: 'short' })}</text>`).join('');
  const prom = k => { const v = (d[k] || []).slice(7).filter(z => z != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const eHoy = (d.energia || []).slice(7).filter(z => z != null).pop();
  const nota = p.c.real && pts.length && pts.length < 3 ? `<p class="cnpoco">${pts.length} day${pts.length > 1 ? 's' : ''} shared so far · the week fills in as ${cnEsc(p.c.corto)} checks in each day</p>` : '';
  return `<div class="panel cons"><h3>${cnEsc(p.c.corto)}'s constellation<span>${p.c.real ? 'shared from their NOVA app' : 'demo crew'}</span></h3>${nota}
    <div class="cnlienzo"><svg viewBox="0 0 ${W} ${H}" class="csvg">${fondo}${pts.length ? `<path d="${ruta}" fill="none" stroke="${CN_LINEA}" stroke-width="1.6"/>${estrellas}${viaje}` : `<text x="${W / 2}" y="${H / 2 - 4}" text-anchor="middle" class="cnnom">Waiting for ${cnEsc(p.c.corto)}'s first shared check-in</text>`}${etq}</svg><div class="cntip" hidden></div></div>
    <div class="cres"><div><small>Mood</small><b>${prom('animo') == null ? '—' : prom('animo').toFixed(1)}<span>/5</span></b></div><div><small>Sleep</small><b>${prom('sueno_h') == null ? '—' : prom('sueno_h').toFixed(1)}<span> h</span></b></div><div><small>Energy today</small><b>${eHoy == null ? '—' : Math.round(eHoy)}<span>/5</span></b></div></div></div>`;
}
function cnEventosCada() {
  document.querySelectorAll('#mConst .cons').forEach(card => {
    const tip = card.querySelector('.cntip'), svg = card.querySelector('.csvg'); if (!svg) return;
    svg.addEventListener('pointerover', e => {
      const g = e.target.closest('.cnestrella'); if (!g) return;
      const [a, s, en] = g.dataset.cndV.split('|');
      tip.innerHTML = `<b class="cntipf">${g.dataset.cndDia}</b><div class="cntipr"><span></span><strong>${(+a).toFixed(0)}/5</strong><span>mood</span></div>${s ? `<div class="cntipr"><span></span><strong>${(+s).toFixed(1)} h</strong><span>sleep</span></div>` : ''}${en ? `<div class="cntipr"><i style="width:10px;height:10px;border-radius:50%;background:${cnColE(+en)}"></i><strong>${(+en).toFixed(0)}/5</strong><span>energy</span></div>` : ''}`;
      tip.hidden = false;
      const r = svg.getBoundingClientRect(), cx = +g.dataset.cndX / 600 * r.width;
      tip.style.top = '4px';
      tip.style.left = `${cx + 18 + tip.offsetWidth > r.width ? cx - tip.offsetWidth - 18 : cx + 18}px`;
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; });
  });
}

function cnTabla(ps) {
  const M = CN_MET[CN.k];
  return `<div class="cntabw"><table class="cntab"><tr><th></th>${Array.from({ length: CN.dias }, (_, j) => `<th>${j === CN.dias - 1 ? 'Today' : cnFecha(14 - CN.dias + j).toLocaleDateString('en', { day: 'numeric', month: 'short' })}</th>`).join('')}</tr>
    ${ps.map(p => `<tr><td>${cnLlave(p)}${cnEsc(p.c.corto)}</td>${cnSerie(p).map(o => `<td>${o.v == null ? '—' : M.fmt(o.v)}</td>`).join('')}</tr>`).join('')}</table></div>`;
}
function cnTarjeta(p) {
  const d = mDias[p.i] || {}, prom = (k, a, b) => { const v = (d[k] || []).slice(a, b).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const fila = (k, n, u, dec) => {
    const a = prom(k, 7, 14), b = prom(k, 0, 7), dif = a != null && b != null ? a - b : null;
    const fl = dif == null || Math.abs(dif) < (k === 'sueno_h' ? .25 : .2) ? '<span class="cnig">steady</span>' : `<span class="${dif > 0 ? 'cnsube' : 'cnbaja'}">${dif > 0 ? '▲' : '▼'} ${Math.abs(dif).toFixed(1)}</span>`;
    return `<div><small>${n}</small><b>${a == null ? '—' : a.toFixed(dec)}<em>${u}</em></b>${fl}</div>`;
  };
  // si mandó lo mismo todos los días de la semana, su línea es plana por eso: se dice
  const sem = (d.animo || []).slice(7).filter(x => x != null), igual = sem.length >= 4 && sem.every(x => x === sem[0]) && (d.energia || []).slice(7).filter(x => x != null).every((x, _, a) => x === a[0]);
  return `<div class="cncard ${CN.foco === p.i ? 'on' : ''}" data-cnp-foco="${p.i}"><h4>${cnLlave(p)}${cnEsc(p.c.corto)}<span>${igual ? 'same every day' : 'this week vs last'}</span></h4>
    <div class="cnfilas">${fila('animo', 'Mood', '/5', 1)}${fila('energia', 'Energy', '/5', 1)}${fila('sueno_h', 'Sleep', 'h', 1)}</div></div>`;
}

function cnEventos(ps) {
  const svg = document.querySelector('#mConst .cnsvg'), tip = document.getElementById('cnTip'); if (!svg) return;
  const { x } = cnEscalas(ps), M = CN_MET[CN.k];
  const mostrar = j => {
    CN.dia = j; const cruz = svg.querySelector('#cnCruz');
    if (j == null) { cruz.setAttribute('visibility', 'hidden'); tip.hidden = true; return; }
    cruz.setAttribute('x1', x(j)); cruz.setAttribute('x2', x(j)); cruz.setAttribute('visibility', 'visible');
    const f = cnFecha(14 - CN.dias + j), vis = ps.filter(p => !CN.ocultos.has(p.i));
    tip.innerHTML = `<b class="cntipf">${j === CN.dias - 1 ? 'Today' : f.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'short' })}</b>` + vis.map(p => {
      const o = cnSerie(p)[j], v = o.v;
      return `<div class="cntipr ${CN.foco === p.i ? 'on' : ''}">${cnLlave(p)}<strong>${v == null ? '—' : M.fmt(v) + (M.u === 'h' ? ' h' : M.u)}</strong><span>${cnEsc(p.c.corto)}</span><small>${CN.k !== 'animo' && o.animo != null ? `mood ${o.animo.toFixed(0)} · ` : ''}${CN.k !== 'energia' && o.energia != null ? `energy ${o.energia.toFixed(0)} · ` : ''}${CN.k !== 'sueno_h' && o.sueno != null ? `${o.sueno.toFixed(1)} h sleep` : ''}</small></div>`;
    }).join('');
    tip.hidden = false;
    const caja = svg.getBoundingClientRect(), px = x(j) / CNG.W * caja.width;
    tip.style.left = `${Math.min(caja.width - tip.offsetWidth - 8, Math.max(8, px + 16))}px`;
    if (px + 16 + tip.offsetWidth > caja.width) tip.style.left = `${Math.max(8, px - tip.offsetWidth - 16)}px`;
  };
  const diaDe = e => { const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * CNG.W; let best = 0; for (let j = 1; j < CN.dias; j++) if (Math.abs(x(j) - vx) < Math.abs(x(best) - vx)) best = j; return best; };
  svg.addEventListener('pointermove', e => mostrar(diaDe(e)));
  svg.addEventListener('pointerleave', () => mostrar(null));
  svg.addEventListener('focus', () => mostrar(CN.dias - 1));
  svg.addEventListener('blur', () => mostrar(null));
  svg.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); mostrar(Math.max(0, Math.min(CN.dias - 1, (CN.dia ?? CN.dias - 1) + (e.key === 'ArrowRight' ? 1 : -1)))); } });
  // tocar una línea (o una estrella) la destaca; tocar el cielo vacío suelta el foco
  svg.addEventListener('click', e => { const g = e.target.closest('[data-cns]'); CN.foco = g ? (CN.foco === +g.dataset.cns ? null : +g.dataset.cns) : null; CN.dia = null; pintarConstelaciones(); });
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-mtab]');
  if (b) {
    mTab = b.dataset.mtab;
    document.querySelectorAll('[data-mtab]').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('#mente > .marriba, #mente > .mtres').forEach(x => { x.hidden = mTab !== 'general'; });
    document.getElementById('mConst').hidden = mTab !== 'const';
    pintarConstelaciones(); return;
  }
  const v = e.target.closest('[data-cnv]'); if (v) { CN.vista = v.dataset.cnv; CN.dia = null; pintarConstelaciones(); return; }
  const k = e.target.closest('[data-cnk]'); if (k) { CN.k = k.dataset.cnk; pintarConstelaciones(); return; }
  const d = e.target.closest('[data-cnd]'); if (d) { CN.dias = +d.dataset.cnd; pintarConstelaciones(); return; }
  const p = e.target.closest('[data-cnp]'); if (p) { const i = +p.dataset.cnp; CN.ocultos.has(i) ? CN.ocultos.delete(i) : CN.ocultos.add(i); if (CN.foco === i) CN.foco = null; pintarConstelaciones(); return; }
  const f = e.target.closest('[data-cnp-foco]'); if (f) { const i = +f.dataset.cnpFoco; CN.foco = CN.foco === i ? null : i; CN.ocultos.delete(i); pintarConstelaciones(); return; }
  if (e.target.closest('[data-cntabla]')) { CN.tabla = !CN.tabla; pintarConstelaciones(); }
});
setInterval(() => { if (mTab === 'const' && !document.getElementById('mente').hidden && CN.dia == null) { if (typeof pedirDias === 'function') pedirDias().then(pintarConstelaciones); else pintarConstelaciones(); } }, 60000);
