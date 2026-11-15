/* Vista Mind: cómo está la cabeza de la tripulación.
   · Cerebro 3D (OpenPsico, three.js local): su estado lo eligen reglas fijas a partir de los signos en vivo del
     tripulante (pulso, respiración y variabilidad frente a su propio promedio de 24 h, oxígeno, azúcar, presión) y de
     su check-in del día. Es un modelo CONCEPTUAL para explicar, no un EEG.
   · Ánimo, sueño y energía de 14 días: de la historia de a bordo (/v1/historia), check-ins que cada persona comparte. */
'use strict';

const ESTADO_N = { basal: 'Resting', foco: 'Focused', estres: 'Stressed', fatiga: 'Fatigued', calma: 'Calm', activacion: 'Highly aroused' };
const ESTADO_FOCO = { estres: ['temporal', 'tronco'], fatiga: ['frontal'], activacion: ['frontal', 'temporal', 'tronco'], calma: [], basal: [], foco: ['frontal'] };
let mT = 3, mBase = {}, mBaseT = 0, mDias = null, mDiasT = 0, mEstado = '', cerebroPedido = false;

/* promedio de 24 h de cada tripulante: su propio «normal» */
async function pedirBases() {
  if (Date.now() - mBaseT < 300000) return; mBaseT = Date.now();
  const r = await Promise.all(CREW.map(c => fetch(`${BASE}/v1/resumen?trip=${c.id}&seg=86400`).then(x => x.json()).catch(() => ({}))));
  r.forEach((v, i) => { mBase[i] = v || {}; });
}

/* 14 días de check-ins: un valor por día para cada persona */
async function pedirDias() {
  if (mDias && Date.now() - mDiasT < 120000) return; mDiasT = Date.now();
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const t0 = hoy.getTime() / 1000 - 13 * 86400;
  const serie = (trip, k) => fetch(`${BASE}/v1/historia?trip=${trip}&k=${k}&seg=${15 * 86400}&puntos=400`).then(x => x.json()).catch(() => ({ t: [], v: [] }));
  const res = await Promise.all(CREW.flatMap(c => ['animo', 'sueno_h', 'energia'].map(k => serie(c.id, k))));
  mDias = CREW.map((c, i) => {
    const o = {};
    ['animo', 'sueno_h', 'energia'].forEach((k, j) => {
      const s = res[i * 3 + j], d = Array(14).fill(null);
      (s.t || []).forEach((t, n) => { const di = Math.floor((t - t0) / 86400); if (di >= 0 && di < 14) d[di] = s.v[n]; });
      o[k] = d;
    });
    return o;
  });
}

/* estado del cerebro con reglas fijas y sus razones en palabras simples */
function estadoMente(i) {
  const tr = ultimo && ultimo.trip[i]; if (!tr) return { k: 'basal', por: ['Waiting for the onboard core'] };
  const b = mBase[i] || {}, m = k => b[k] && b[k].n > 20 ? b[k].media : null, vivo = k => tr.edades[k] > 0 && tr.edades[k] <= 30;
  const hr0 = m('pulso'), fr0 = m('fr'), v0 = m('vfc'), s0 = m('pa_sis'), por = [];
  const dHr = vivo('pulso') && hr0 ? tr.pulso - hr0 : 0, dFr = vivo('fr') && fr0 ? tr.fr - fr0 : 0, dV = vivo('vfc') && v0 ? tr.vfc - v0 : 0;
  const dS = tr.edades.pa_sis > 0 && tr.edades.pa_sis <= 60 && s0 ? tr.pa_sis - s0 : 0;
  const sg = x => (x > 0 ? '+' : '−') + Math.abs(Math.round(x));
  if (dHr < -12 && dS < -25) return { k: 'fatiga', nombre: 'Low blood flow', por: [`Heart ${sg(dHr)} bpm and blood pressure ${sg(dS)} mmHg vs ${CREW[i].ella} usual`, 'Less blood is reaching the brain'] };
  if (vivo('spo2') && tr.spo2 < 92) return { k: 'activacion', nombre: 'Short of oxygen', por: [`Oxygen ${Math.round(tr.spo2)}%`, 'The brain is short of oxygen and the body is compensating'] };
  if (tr.edades.glucosa > 0 && tr.glucosa < 70) return { k: 'activacion', nombre: 'Low fuel', por: [`Blood sugar ${Math.round(tr.glucosa)} mg/dL`, "The brain's fuel is running low"] };
  if (tr.edades.temp > 0 && tr.temp >= 38) return { k: 'estres', nombre: 'Fever', por: [`Temperature ${tr.temp.toFixed(1)} °C`, 'Fever puts the whole body on alert'] };
  const z = Math.max(-3, Math.min(3, dHr / 8)) + Math.max(-3, Math.min(3, dFr / 3)) - Math.max(-3, Math.min(3, dV / 12));
  if (Math.abs(dHr) >= 4) por.push(`Heart ${sg(dHr)} bpm vs ${CREW[i].ella} 24 h average`);
  if (dV <= -5) por.push(`Heart rate variability ${sg(dV)} ms (lower means more strain)`);
  if (Math.abs(dFr) >= 2) por.push(`Breathing ${sg(dFr)} /min`);
  if (z > 2.2) return { k: 'activacion', por };
  if (z > 1.1) return { k: 'estres', por };
  const hoy = tr.edades.animo > 0 ? tr : null;
  if (hoy && tr.animo <= 2) return { k: 'estres', por: [...por, `Mood ${Math.round(tr.animo)}/5 in today's check-in`, ...(tr.edades.sueno_h > 0 && tr.sueno_h < 6.5 ? [`Slept ${tr.sueno_h.toFixed(1)} h`] : [])] };
  if (tr.edades.sueno_h > 0 && tr.sueno_h < 6) return { k: 'fatiga', por: [...por, `Slept ${tr.sueno_h.toFixed(1)} h last night`] };
  if (z < -.8) return { k: 'calma', por };
  return { k: 'basal', por: por.length ? por : ['Heart, breathing and variability close to the usual'] };
}

function colAnimo(v) {
  if (v == null) return 'rgba(255,255,255,.04)';
  const R = ['#6a4fd0', '#8f7fea', '#3f7fd6', '#46c8e8', '#8fe6f5'];
  return R[Math.max(0, Math.min(4, Math.round(v) - 1))];
}

function armarMente() {
  $('mQuien').innerHTML = CREW.map((c, j) => `<button data-mt="${j}">${c.corto}</button>`).join('');
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const d0 = mision ? mision.dia - 13 : null;
  $('mDias').innerHTML = Array.from({ length: 14 }, (_, j) => `<span>${j === 13 ? 'Today' : j % 2 ? '' : (d0 != null ? d0 + j : '')}</span>`).join('');
}

function pintarMente() {
  if (!$('mQuien').firstChild) armarMente();
  document.querySelectorAll('#mQuien button').forEach((b, j) => b.classList.toggle('on', j === mT));
  const e = estadoMente(mT), c = CREW[mT];
  $('mEstado').textContent = e.nombre || ESTADO_N[e.k];
  $('mEstado').className = e.k === 'activacion' || e.k === 'estres' ? 'at' : e.k === 'fatiga' ? 'nv' : '';
  $('mPor').innerHTML = e.por.map(p => `<li>${p}</li>`).join('');
  $('mTit').firstChild.textContent = `${c.corto}'s brain, right now`;
  const cb = window.__cerebro3d;
  if (cb && e.k !== mEstado) { cb.cambiarEstado(e.k); cb.enfocar(ESTADO_FOCO[e.k] || []); mEstado = e.k; }
  if (!mDias) return;
  // mapa de ánimo
  $('mMapa').innerHTML = CREW.map((p, i) => {
    const a = mDias[i].animo, vals = a.filter(v => v != null), prom = vals.length ? vals.reduce((x, y) => x + y) / vals.length : null;
    const ult = a.slice(-3).filter(v => v != null), baja = ult.length && prom && ult.reduce((x, y) => x + y) / ult.length <= prom - .7;
    return `<div class="nm${i === mT ? ' on' : ''}" data-mt="${i}">${p.corto}<span>${p.rol}</span></div><div class="celdas">${a.map((v, j) => `<i style="background:${colAnimo(v)};opacity:${v == null ? 1 : .55 + .45 * (j / 13)}" title="${v == null ? 'no check-in' : 'mood ' + v + '/5'}"></i>`).join('')}</div><div class="pr" style="${baja ? 'color:var(--nv)' : ''}">${prom == null ? '—' : prom.toFixed(1)}<span class="u">/5</span></div>`;
  }).join('');
  // sueño y energía, 14 días
  const linea = (d, lo, hi, col) => { const pts = d.map((v, j) => v == null ? null : [j / 13 * 200, 32 - (v - lo) / (hi - lo) * 30]).filter(Boolean);
    return pts.length ? `<path d="M${pts.map(p => p[0].toFixed(1) + ' ' + Math.max(1, Math.min(33, p[1])).toFixed(1)).join(' L')}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${pts[pts.length - 1][0]}" cy="${Math.max(1, Math.min(33, pts[pts.length - 1][1])).toFixed(1)}" r="3" fill="${col}"/>` : ''; };
  const ultimoDe = d => { for (let j = d.length - 1; j >= 0; j--) if (d[j] != null) return d[j]; return null; };
  $('mSueno').innerHTML = CREW.map((p, i) => { const d = mDias[i].sueno_h, u = ultimoDe(d), x = u != null && u < 6;
    return `<div class="fila4${x ? ' x' : ''}"><span>${p.corto}</span><svg viewBox="0 0 200 34" preserveAspectRatio="none"><line x1="0" x2="200" y1="${32 - (7 - 4) / 5 * 30}" y2="${32 - (7 - 4) / 5 * 30}" stroke="rgba(255,255,255,.12)" stroke-dasharray="3 5"/>${linea(d, 4, 9, x ? '#a898ff' : '#46c8e8')}</svg><b>${u == null ? '—' : u.toFixed(1)}<span class="u">h</span></b></div>`; }).join('');
  $('mEnergia').innerHTML = CREW.map((p, i) => { const u = ultimoDe(mDias[i].energia);
    return `<div class="fila4${u != null && u <= 2 ? ' x' : ''}"><span>${p.corto}</span><div class="seg">${[1, 2, 3, 4, 5].map(j => `<i style="background:${u != null && j <= u ? ['#5b5bd6', '#4a8fe0', '#46c8e8', '#7fe3c4', '#8fe6f5'][j - 1] : 'rgba(255,255,255,.07)'}"></i>`).join('')}</div><b>${u == null ? '—' : Math.round(u)}<span class="u">/5</span></b></div>`; }).join('');
  // estado en vivo de los cuatro
  $('mAhora').innerHTML = CREW.map((p, i) => { const s = estadoMente(i); const col = s.k === 'activacion' || s.k === 'estres' ? 'var(--at)' : s.k === 'fatiga' ? 'var(--nv)' : 'var(--ok)';
    return `<div class="fila4"><span>${p.corto}</span><div class="ahora"><i style="background:${col}"></i>${s.nombre || ESTADO_N[s.k]}</div><b></b></div>`; }).join('');
}

/* panel de NOVA en esta vista: lo que notó en los check-ins */
function novaMente() {
  $('novaDice').textContent = textoMente();
  if (!mDias) { $('ultimas').innerHTML = ''; return; }
  const fila = (col, b, txt) => `<div><i style="background:${col}"></i><span><b>${b}</b> ${txt}</span></div>`;
  const l = [];
  CREW.forEach((c, i) => {
    const a = mDias[i].animo.filter(v => v != null), s = mDias[i].sueno_h.filter(v => v != null);
    if (a.length < 6) return;
    const prom = a.slice(0, -3).reduce((x, y) => x + y, 0) / (a.length - 3), ult = a.slice(-3).reduce((x, y) => x + y) / 3;
    const sp = s.length > 6 ? s.slice(-4).reduce((x, y) => x + y) / 4 : 9;
    if (ult <= prom - .7) l.push(fila('var(--nv)', `${c.corto}'s mood`, sp < 6.3 ? `follows ${c.ella} sleep, one day later` : 'lower than usual for three days'));
    else if (ult <= prom - .4) l.push(fila('var(--at)', `${c.corto}'s mood`, 'slipping slowly this week'));
  });
  if (!l.length) l.push(fila('var(--ok)', 'Crew mood', 'steady over the last two weeks'));
  l.push(fila('var(--t3)', 'Privacy', 'check-ins are shared by choice; private sessions never show here'));
  $('ultimas').innerHTML = l.join('');
}

function textoMente() {
  if (!mDias) return 'Reading the crew check-ins.';
  for (let i = 0; i < CREW.length; i++) {
    const a = mDias[i].animo.filter(v => v != null); if (a.length < 6) continue;
    const prom = a.slice(0, -3).reduce((x, y) => x + y, 0) / (a.length - 3), ult = a.slice(-3).reduce((x, y) => x + y) / 3;
    const s = mDias[i].sueno_h.filter(v => v != null), sp = s.length > 6 ? s.slice(-4).reduce((x, y) => x + y) / 4 : null;
    if (ult <= prom - .7) return `${CREW[i].corto}'s mood has dropped over the last three days${sp && sp < 6.3 ? `, a day after ${CREW[i].ella} sleep did` : ''}. I only share what ${CREW[i].corto} allows. A quiet check-in could help.`;
  }
  return 'Moods look steady this week. I read them gently and only share what each person allows.';
}

async function abrirMente(i = mT) {
  mT = i; cambiarVista('mente');
  if (!cerebroPedido) { cerebroPedido = true; import('./cerebro.mjs?v=2').catch(() => { $('mCer').textContent = 'The 3D brain needs WebGL.'; }); }
  await Promise.all([pedirBases(), pedirDias()]);
  pintarMente(); novaMente();
}

addEventListener('cerebro-ready', () => { mEstado = ''; pintarMente(); });
document.addEventListener('click', e => {
  const b = e.target.closest('[data-mt]'); if (!b) return;
  mT = +b.dataset.mt; pintarMente();
});
setInterval(async () => { if (vista !== 'mente') return; await Promise.all([pedirBases(), pedirDias()]); pintarMente(); novaMente(); }, 60000);
