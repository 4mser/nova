/* Vista Vitals: la historia real de un astronauta, guardada a bordo, con los umbrales vigentes del núcleo.
   Todo sale de /v1/historia (segundo a segundo hasta 6 h, por minuto hasta 30 días) y del último estado. */
'use strict';

const PANELES = [
  { k: 'pulso', n: 'Heart rate', u: 'bpm', s: ['pulso'], am: 'grav' },
  { k: 'spo2', n: 'Oxygen', u: '%', s: ['spo2'], am: 'amb' },
  { k: 'pa', n: 'Blood pressure', u: 'mmHg', s: ['pa_sis', 'pa_dia'], am: 'grav' },
  { k: 'temp', n: 'Temperature', u: '°C', s: ['temp'], dec: 1, am: 'amb' },
  { k: 'fr', n: 'Breathing', u: '/min', s: ['fr'], am: 'amb' },
  { k: 'glucosa', n: 'Blood sugar', u: 'mg/dL', s: ['glucosa'], am: 'dist' },
  { k: 'vfc', n: 'Heart rate variability', u: 'ms', s: ['vfc'], am: 'iso' },
  { k: 'sueno_h', n: 'Sleep', u: 'h', s: ['sueno_h'], dec: 1, am: 'iso', fuente: 'from the Nova app' },
  { k: 'animo', n: 'Mood and energy', u: '/5', s: ['animo', 'energia'], am: 'iso', fuente: 'Nova app check-in, shared with consent' },
];
/* Las cinco amenazas del vuelo espacial (NASA Human Research Program, nasa.gov/hrp/hazards): cada indicador se lee
   por la amenaza que lo mueve. La radiación no tiene sensor en el cuerpo: se estima la dosis de la misión con las
   tasas medidas por MSL RAD (crucero ~1,84 mSv/día, Zeitlin 2013; superficie de Marte ~0,64 mSv/día, Hassler 2014). */
const AMENAZAS = [
  { k: 'rad', n: 'Space radiation', por: 'Dose adds up for life.' },
  { k: 'iso', n: 'Isolation and confinement', s: ['sueno_h', 'animo', 'energia', 'vfc'], ver: ['sueno_h', 'animo', 'vfc'], por: 'Sleep and mood drift first.' },
  { k: 'dist', n: 'Distance from Earth', s: ['glucosa'], por: 'No resupply, no evacuation.' },
  { k: 'grav', n: 'Gravity fields', s: ['pulso', 'pa_sis', 'pa_dia'], por: 'Fluids shift, the heart adapts.' },
  { k: 'amb', n: 'Hostile closed environment', s: ['spo2', 'fr', 'temp'], ver: ['spo2'], por: 'Cabin air reaches the body.' },
];
const AM_N = { rad: 'Radiation', iso: 'Isolation', dist: 'Distance', grav: 'Gravity', amb: 'Environment' };
function dosisMision() {
  if (!mision) return null;
  const d = mision.dia_exacto, tr = mision.transferencia_dias, tot = mision.total_dias, sup = Math.max(0, tot - 2 * tr);
  const crucero = Math.min(d, tr) + Math.max(0, d - tr - sup), marte = Math.min(Math.max(0, d - tr), sup);
  return { msv: crucero * 1.84 + marte * .64, dia: d < tr || d > tr + sup ? 1.84 : .64 };
}

const RANGOS = [[600, '10 min'], [3600, '1 h'], [21600, '6 h'], [86400, '24 h'], [604800, '7 days']];
/* cuánto tiene que moverse un valor dentro de la ventana para que NOVA lo cuente */
const CAMBIO = { pulso: 12, spo2: 3, pa_sis: 15, pa_dia: 10, temp: .6, fr: 5, glucosa: 20, vfc: 15, sueno_h: 1.5, animo: 2, energia: 2 };

let vT = 0, vSeg = 600, vDatos = {}, vPedido = 0;

function armarVitals() {
  $('vquien').innerHTML = CREW.map((c, j) => `<button data-vt="${j}"><div class="av" style="background:${c.col}">${c.ini}</div>${c.corto}<i id="vq${j}"></i></button>`).join('');
  $('vrango').innerHTML = RANGOS.map(([s, n]) => `<button data-vs="${s}">${n}</button>`).join('');
  $('vgrid').innerHTML = PANELES.map(p => `
    <div class="vp" id="vp_${p.k}">
      <div class="cab"><h3>${p.n}<em class="vam">${AM_N[p.am]}</em></h3><span id="vpe_${p.k}"></span></div>
      <div class="fila"><div class="big" id="vpv_${p.k}">—</div><div class="stats" id="vps_${p.k}"></div></div>
      <svg id="vpg_${p.k}" viewBox="0 0 400 150" preserveAspectRatio="none"></svg>
      ${p.fuente ? `<div class="src">${p.fuente}</div>` : ''}
    </div>`).join('');
  $('vamen').innerHTML = AMENAZAS.map(a => `<div class="va" id="va_${a.k}"><b><i></i>${a.n}</b><span class="vav" id="vav_${a.k}">—</span><span class="vap">${a.por}</span></div>`).join('');
  marcarVitals();
}

function marcarVitals() {
  document.querySelectorAll('#vquien button').forEach((b, j) => b.classList.toggle('on', j === vT));
  document.querySelectorAll('#vrango button').forEach(b => b.classList.toggle('on', +b.dataset.vs === vSeg));
}

function abrirVitals(i = vT) { vT = i; marcarVitals(); cambiarVista('vitals'); pedirVitals(); }

async function pedirVitals() {
  const n = ++vPedido, trip = CREW[vT].id, seg = vSeg;
  const claves = PANELES.flatMap(p => p.s);
  const res = await Promise.all(claves.map(k => fetch(`${BASE}/v1/historia?trip=${trip}&k=${k}&seg=${seg}&puntos=160`).then(r => r.json()).catch(() => null)));
  if (n !== vPedido) return; // llegó otra petición más nueva
  vDatos = { trip, seg, ahora: Date.now() / 1000 };
  claves.forEach((k, j) => { vDatos[k] = res[j] || { t: [], v: [], lo: [], hi: [] }; });
  pintarVitals();
}

function lineasUmbral(k) {
  const u = ultimo && ultimo.umbrales && ultimo.umbrales[k];
  if (!u) return [];
  const [aA, aT, bA, bT] = u, l = [], f = v => (k === 'temp' ? v.toFixed(1) : Math.round(v));
  if (aT > 0) l.push({ v: aT, col: COL.aviso_tierra, txt: `tell Earth ≥ ${f(aT)}` });
  if (aA > 0) l.push({ v: aA, col: COL.atencion, txt: `attention ≥ ${f(aA)}` });
  if (bA > 0) l.push({ v: bA, col: COL.atencion, txt: `attention ≤ ${f(bA)}` });
  if (bT > 0) l.push({ v: bT, col: COL.aviso_tierra, txt: `tell Earth ≤ ${f(bT)}` });
  return l;
}

/* Nova's world model of each vital (in the spirit of V-JEPA 2 / LeCun: predict, then act on the prediction):
   a local linear trend fitted to the recent window, projected 15 minutes ahead with an uncertainty that grows with the
   horizon; the chance of crossing the attention threshold; and "surprise" when the latest value falls outside what Nova
   expected. Simple, explainable statistics on this astronaut's own data, not a learned model, and not validated. */
function pronosticar(d, ahora, horizonte, umbr) {
  if (!d || d.t.length < 8) return null;
  const desde = ahora - Math.min(1800, (d.t.at(-1) - d.t[0]) || 1800);
  const idx = d.t.map((t, i) => i).filter(i => d.t[i] >= desde && Number.isFinite(d.v[i]));
  if (idx.length < 8) return null;
  // weighted least squares: recent points count more
  let sw = 0, st = 0, sv = 0, stt = 0, stv = 0;
  for (const i of idx) { const w = Math.exp((d.t[i] - ahora) / 900), x = d.t[i] - ahora, y = d.v[i]; sw += w; st += w * x; sv += w * y; stt += w * x * x; stv += w * x * y; }
  const den = sw * stt - st * st; if (Math.abs(den) < 1e-9) return null;
  const b = (sw * stv - st * sv) / den, a = (sv - b * st) / sw;
  let r2 = 0; for (const i of idx) { const e = d.v[i] - (a + b * (d.t[i] - ahora)); r2 += e * e; }
  const sd = Math.sqrt(r2 / Math.max(1, idx.length - 2)) || 1e-3, sdB = sd / Math.sqrt(Math.max(1e-6, stt / sw - (st / sw) ** 2)) / Math.sqrt(idx.length);
  const t = [], v = [], lo = [], hi = [];
  for (let h = 0; h <= horizonte; h += horizonte / 12) { const m = a + b * h, s2 = Math.sqrt(sd * sd + (h * sdB) ** 2); t.push(ahora + h); v.push(m); lo.push(m - 2 * s2); hi.push(m + 2 * s2); }
  const fin = v.at(-1), sFin = (hi.at(-1) - lo.at(-1)) / 4;
  // the chance of being past the attention threshold at the horizon (normal approximation)
  const Phi = z => .5 * (1 + Math.tanh(z * .7978845608 * (1 + .044715 * z * z)));
  let prob = null, lado = '';
  if (umbr) { const [aA, , bA] = umbr; if (aA > 0 && b > 0) { prob = 1 - Phi((aA - fin) / sFin); lado = `≥ ${aA}`; } else if (bA > 0 && b < 0) { prob = Phi((bA - fin) / sFin); lado = `≤ ${bA}`; } }
  // surprise: the newest reading against what the trend expected for it
  const ult = idx.at(-1), z = (d.v[ult] - (a + b * (d.t[ult] - ahora))) / sd;
  return { t, v, lo, hi, fin, sFin, prob, lado, pendiente: b * 60, sorpresa: Math.abs(z) > 3 ? z : 0 };
}

function pintarVitals() {
  if (!ultimo || !vDatos.trip) return;
  const tr = ultimo.trip[vT], ahora = vDatos.ahora, t0 = ahora - vDatos.seg;
  CREW.forEach((c, j) => { const e = $('vq' + j); if (e) e.style.background = COL[ultimo.trip[j].nivel === 'normal' ? 'normal' : ultimo.trip[j].nivel] === COL.normal ? 'var(--ok)' : COL[ultimo.trip[j].nivel]; });
  pintarAmenazas(tr);
  for (const p of PANELES) {
    const k0 = p.s[0], tiene = tr.edades[k0] > 0;
    const nivel = p.s.map(k => tr.niveles[k] || 'sin_dato').reduce((a, b) => (RANGO[b] > RANGO[a] ? b : a), 'sin_dato');
    $('vp_' + p.k).className = 'vp' + (tiene ? ' lv-' + nivel : '');
    const f = (k, v) => (p.dec ? v.toFixed(p.dec) : Math.round(v).toLocaleString('en-US'));
    const v = $('vpv_' + p.k);
    v.className = 'big' + (tiene ? ' lv-' + nivel : '');
    v.innerHTML = !tiene ? '—' : p.k === 'pa' ? `${f(0, tr.pa_sis)}/${f(0, tr.pa_dia)}<span class="u">${p.u}</span>`
      : p.k === 'animo' ? `${Math.round(tr.animo)}<span class="u">/5</span> · ${Math.round(tr.energia)}<span class="u">/5</span>`
      : `${f(0, tr[k0])}<span class="u">${p.u}</span>`;
    $('vpe_' + p.k).textContent = !tiene ? 'no readings' : tr.edades[k0] <= 3 ? 'live' : `measured ${hace(tr.edades[k0])}`;
    // estadísticas de la ventana
    const d = vDatos[k0];
    if (d && d.v.length) {
      const media = d.v.reduce((a, b) => a + b, 0) / d.v.length, mn = Math.min(...d.lo), mx = Math.max(...d.hi);
      $('vps_' + p.k).innerHTML = `avg <b>${f(0, media)}</b> · range <b>${f(0, mn)}–${f(0, mx)}</b>`;
    } else $('vps_' + p.k).textContent = '';
    const colores = [COL[tr.niveles[k0]] && tr.niveles[k0] !== 'normal' ? COL[tr.niveles[k0]] : '#8fe6f5', '#a898ff'];
    // the forecast cone, a quarter of the window ahead (at most 15 min)
    const horiz = Math.min(900, vDatos.seg / 4), pr = tiene && tr.edades[k0] <= 30 && !['animo', 'sueno'].includes(p.k) ? pronosticar(vDatos[k0], ahora, horiz, ultimo.umbrales && ultimo.umbrales[k0]) : null;
    if (pr) {
      const fmin = Math.round(horiz / 60), alerta = pr.prob != null && pr.prob > .3;
      $('vps_' + p.k).innerHTML += `<span class="vpred${alerta ? ' al' : ''}"> · in ${fmin} min <b>${f(0, pr.fin)} ±${f(0, 2 * pr.sFin)}</b>${pr.prob != null && pr.prob > .05 ? ` · P(${pr.lado}) <b>${Math.round(pr.prob * 100)}%</b>` : ''}${pr.sorpresa ? ' · <b>unexpected change</b>' : ''}</span>`;
    }
    grafico($('vpg_' + p.k), 400, 150, {
      t0, t1: ahora + (pr ? horiz : 0), ahora, dec: p.dec || 0,
      series: [...p.s.map((k, j) => ({ ...(vDatos[k] || { t: [], v: [] }), col: colores[j], sinArea: j > 0 })),
        ...(pr ? [{ t: pr.t, v: pr.v, lo: pr.lo, hi: pr.hi, col: pr.prob > .3 ? '#f2b457' : '#c3b8ff', sinArea: true }] : [])],
      umbrales: p.s.flatMap(lineasUmbral),
    });
  }
  pintarNovaVitals();
}

/* NOVA sobre esta persona: qué cambió en la ventana elegida, con cifras */
function hallazgos() {
  const tr = ultimo.trip[vT], c = CREW[vT], out = [];
  const ventana = RANGOS.find(r => r[0] === vDatos.seg)[1];
  for (const k of Object.keys(CAMBIO)) {
    const d = vDatos[k];
    if (!d || d.v.length < 2) continue;
    const ini = d.v[0], fin = d.v[d.v.length - 1], dif = fin - ini;
    if (Math.abs(dif) >= CAMBIO[k]) {
      const dec = k === 'temp' || k === 'sueno_h' ? 1 : 0, f = v => v.toFixed(dec);
      const mins = Math.max(1, Math.round((d.t[d.t.length - 1] - d.t[0]) / 60));
      out.push({ n: tr.niveles[k] || 'normal', txt: `<b>${NOMBRE[k][0].toUpperCase() + NOMBRE[k].slice(1)}</b> ${dif > 0 ? 'rose' : 'fell'} from ${f(ini)} to ${f(fin)} ${UNIDAD[k]} in ${mins < 120 ? mins + ' min' : Math.round(mins / 60) + ' h'}` });
    }
  }
  if (!out.length) {
    const partes = ['pulso', 'spo2', 'pa_sis'].filter(k => vDatos[k] && vDatos[k].v.length).map(k => {
      const d = vDatos[k]; return `${NOMBRE[k]} ${Math.round(Math.min(...d.lo))}–${Math.round(Math.max(...d.hi))} ${UNIDAD[k]}`;
    });
    if (partes.length) out.push({ n: 'normal', txt: `<b>Steady</b> over the last ${ventana}: ${partes.join(', ')}` });
  }
  return { out, ventana, c };
}

function pintarNovaVitals() {
  if (!ultimo || vDatos.trip !== CREW[vT].id || vDatos.seg !== vSeg) {
    $('novaDice').textContent = `Reading ${CREW[vT].corto}'s history from the onboard record.`;
    return;
  }
  const { out, ventana, c } = hallazgos();
  $('novaDice').textContent = `Here's what I see in ${c.corto}'s data, last ${ventana}.`;
  $('ultimas').innerHTML = out.length ? out.map(h => `<div><i style="background:${h.n === 'normal' ? 'var(--ok)' : COL[h.n]}"></i><span>${h.txt}</span></div>`).join('')
    : `<div><i style="background:var(--t3)"></i><span>Not enough readings in this window yet</span></div>`;
}

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.vt) { vT = +b.dataset.vt; marcarVitals(); pedirVitals(); refrescarNova(); }
  else if (b.dataset.vs) { vSeg = +b.dataset.vs; marcarVitals(); pedirVitals(); }
});
setInterval(() => { if (vista === 'vitals') pedirVitals(); }, 5000);

/* franja de las cinco amenazas: el peor estado de lo que vigila cada una, para el tripulante elegido */
function pintarAmenazas(tr) {
  const f = k => k === 'temp' ? (+tr[k]).toFixed(1) : k === 'sueno_h' ? (+tr[k]).toFixed(1) : Math.round(tr[k]);
  const corto = { pulso: 'HR', spo2: 'SpO₂', pa_sis: 'BP', temp: 'Temp', fr: 'Breath', glucosa: 'Sugar', vfc: 'HRV', sueno_h: 'Sleep', animo: 'Mood', energia: 'Energy' };
  for (const a of AMENAZAS) {
    const el = $('va_' + a.k), v = $('vav_' + a.k); if (!el) continue;
    let nivel = 'normal', txt = '';
    if (a.k === 'rad') {
      const d = dosisMision();
      if (d) { const p = d.msv / 600; nivel = p >= .9 ? 'aviso_tierra' : p >= .75 ? 'atencion' : 'normal'; txt = `<b>${Math.round(d.msv)} mSv</b> · ${Math.round(p * 100)}% of the 600 limit`; }
    } else {
      const ks = a.s.filter(k => tr.edades && tr.edades[k] > 0);
      nivel = ks.map(k => tr.niveles[k] || 'normal').reduce((x, y) => (RANGO[y] > RANGO[x] ? y : x), 'normal');
      txt = ks.filter(k => k !== 'pa_dia' && (a.ver || a.s).includes(k)).map(k => k === 'pa_sis' ? `BP <b>${Math.round(tr.pa_sis)}/${Math.round(tr.pa_dia)}</b>` : `${corto[k]} <b>${f(k)}</b>`).join(' · ');
      if (a.k === 'dist' && mision) txt = `<b>${(mision.luz_seg / 60).toFixed(1)} light-min</b>` + (txt ? ' · ' + txt : '');
      if (a.k === 'amb' && ultimo.cabina) txt = `CO₂ <b>${Math.round(ultimo.cabina.co2).toLocaleString('en-US')} ppm</b>` + (txt ? ' · ' + txt : '');
      if (a.k === 'amb' && ultimo.cabina && RANGO[ultimo.cabina.nivel_co2] > RANGO[nivel]) nivel = ultimo.cabina.nivel_co2;
    }
    el.className = 'va lv-' + nivel; v.innerHTML = txt || '—';
  }
}
