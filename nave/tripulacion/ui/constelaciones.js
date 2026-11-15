/* Mind · Constellations: la semana de cada tripulante como en su app NOVA (altura = ánimo, tamaño = sueño,
   color = energía), solo de quienes lo permiten. El permiso es «Compartir mi día» en su teléfono: la app se lo dice a la
   nave en cada envío (campo `mente` de /tripulacion.json). Sin tripulación real se ve la de demostración entera.
   Usa los 14 días que ya arma mente.js (mDias, pedirDias) y dibuja los últimos 7. */
'use strict';
let mTab = 'general';

function permiteMente(c) { return !c.vacio && (!c.real || c.mente === true); }

function constelacionSVG(d, n) {
  // últimos 7 días con ánimo; los días sin check-in quedan como hueco
  const dias = Array.from({ length: 7 }, (_, j) => { const i = 7 + j; return { a: d.animo[i], s: d.sueno_h[i], e: d.energia[i], i }; });
  const W = 600, H = 250, x = j => 40 + j * (W - 80) / 6, y = a => H - 46 - (a - 1) / 4 * (H - 96);
  const RAMPA = ['#6a4fd0', '#8f7fea', '#3f7fd6', '#46c8e8', '#8fe6f5'];
  const h = k => { const v = Math.sin(k * 127.1 + n * 31.7) * 43758.5453; return v - Math.floor(v); };
  let fondo = '';
  for (let k = 0; k < 46; k++) fondo += `<circle cx="${(h(k) * W).toFixed(1)}" cy="${(h(k + 99) * (H - 40)).toFixed(1)}" r="${h(k + 7) < .85 ? .9 : 1.6}" fill="#dfe8f2" opacity="${(.12 + h(k + 3) * .35).toFixed(2)}"/>`;
  const pts = dias.filter(p => p.a != null).map(p => ({ ...p, x: x(p.i - 7), y: y(p.a) }));
  let linea = '';
  pts.forEach((p, k) => { if (!k) { linea = `M${p.x} ${p.y}`; return; } const a = pts[k - 1], cx = (a.x + p.x) / 2; linea += ` C${cx} ${a.y} ${cx} ${p.y} ${p.x} ${p.y}`; });
  const estrellas = pts.map(p => {
    const r = Math.max(4, 4 + ((p.s ?? 7) - 5.5) * 2.4), col = RAMPA[Math.max(0, Math.min(4, Math.round((p.e ?? 3) - 1)))];
    return `<circle cx="${p.x}" cy="${p.y}" r="${(r * 2.6).toFixed(1)}" fill="${col}" opacity=".15"/><circle cx="${p.x}" cy="${p.y}" r="${r.toFixed(1)}" fill="${col}"/>`;
  }).join('');
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const etq = dias.map((p, j) => { const f = new Date(hoy.getTime() - (6 - j) * 864e5); return `<text x="${x(j)}" y="${H - 12}" text-anchor="middle" fill="#6d7786" font-size="13" font-family="SG">${j === 6 ? 'Today' : f.toLocaleDateString('en', { weekday: 'short' })}</text>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="csvg">${fondo}<path d="${linea}" fill="none" stroke="rgba(143,230,245,.5)" stroke-width="1.8"/>${estrellas}${etq}</svg>`;
}

function pintarConstelaciones() {
  const caja = document.getElementById('mConst'); if (!caja || mTab !== 'const') return;
  if (typeof mDias === 'undefined' || !mDias) { caja.innerHTML = '<p class="cvacio">Loading each person\'s week…</p>'; if (typeof pedirDias === 'function') pedirDias().then(pintarConstelaciones); return; }
  const prom = l => { const v = l.filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const si = CREW.map((c, i) => [c, i]).filter(([c]) => permiteMente(c)), no = CREW.filter(c => !c.vacio && !permiteMente(c));
  caja.innerHTML = (si.length ? `<div class="cgrid">${si.map(([c, i]) => {
    const d = mDias[i], sem = k => d[k].slice(7), a = prom(sem('animo')), s = prom(sem('sueno_h')), e = sem('energia').filter(x => x != null).pop();
    const hay = sem('animo').some(x => x != null);
    return `<div class="panel cons"><h3>${c.corto}'s constellation<span>${c.real ? 'shared from their NOVA app' : 'demo crew'}</span></h3>
      ${hay ? constelacionSVG(d, i) : '<p class="cvacio">No check-ins this week yet.</p>'}
      <div class="cres"><div><small>Mood</small><b>${a == null ? '—' : a.toFixed(1)}<span>/5</span></b></div><div><small>Sleep</small><b>${s == null ? '—' : s.toFixed(1)}<span> h</span></b></div><div><small>Energy today</small><b>${e == null ? '—' : Math.round(e)}<span>/5</span></b></div></div></div>`;
  }).join('')}</div>` : '<p class="cvacio">Nobody is sharing their week right now.</p>')
    + (no.length ? `<p class="cpriv">Private: ${no.map(c => c.corto).join(', ')} · shown only when they turn on «Share my day» in their NOVA app</p>` : '')
    + '<p class="cley">Height = mood · size = sleep · color = energy (violet low, cyan high). Each person decides in their app whether the crew sees it.</p>';
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-mtab]'); if (!b) return;
  mTab = b.dataset.mtab;
  document.querySelectorAll('[data-mtab]').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('#mente > .marriba, #mente > .mtres').forEach(x => { x.hidden = mTab !== 'general'; });
  document.getElementById('mConst').hidden = mTab !== 'const';
  pintarConstelaciones();
});
setInterval(() => { if (mTab === 'const' && !document.getElementById('mente').hidden) { if (typeof pedirDias === 'function') pedirDias().then(pintarConstelaciones); else pintarConstelaciones(); } }, 60000);
