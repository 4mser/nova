/* Vista «Radiation»: la amenaza que no se siente.
   · El escudo: corte de la nave con su casco (20 g/cm², recomendación de la NASA para misiones de más de 6 meses) y el
     refugio de las cabinas (+10 cm de agua). Los rayos cósmicos galácticos (núcleos pesados) atraviesan; los protones
     solares se frenan en el casco y en una tormenta llegan en masa. Ilustrativo: las partículas no están a escala.
   · Cifras: tasa ahora, dosis de la misión frente al límite de carrera, tormenta y detector.
   · Dosis de toda la misión con las tasas de MSL RAD: día a día, el límite de 600 mSv y el día en que se cruza.
   · Tasa de las últimas 24 h con el umbral de alerta (500 µSv/h).
   · El detector de Luis por canal (diseño conceptual; hoy no está a bordo) y la bitácora de tormentas.
   Fuentes: OCHMO Technical Brief Radiation Protection (NASA-STD-3001) p. 1, 4, 10; Zeitlin et al., Science 2013
   (MSL RAD en crucero); Hassler et al., Science 2014 (superficie de Marte). */
'use strict';
const RV = { hover: null, hoverDosis: null, eventos: [], tEv: 0, part: [], t0: performance.now(), corre: false };
const RV_CRUCERO = 1.84, RV_MARTE = 0.64, RV_LIMITE = 600, RV_EVENTO = 250, RV_UMBRAL = 500;

function rvDosisDia(d, tr, sup) { const cr = Math.min(d, tr) + Math.max(0, d - tr - sup), ma = Math.max(0, Math.min(d - tr, sup)); return cr * RV_CRUCERO + ma * RV_MARTE; }
function rvGeo() { const tr = mision?.transferencia_dias ?? 259, tot = mision?.total_dias ?? 1018; return { tr, tot, sup: tot - 2 * tr, hoy: mision?.dia_exacto ?? 0 }; }
function rvCruce() { // el día en que la dosis acumulada llega al límite
  const { tr, sup, tot } = rvGeo(); for (let d = 0; d <= tot; d += .5) if (rvDosisDia(d, tr, sup) >= RV_LIMITE) return d; return null;
}

function abrirRadiacion() {
  const caja = $('radiacion'); if (!caja) return;
  if (!caja.dataset.listo) {
    caja.dataset.listo = 1;
    caja.innerHTML = `<div class="rvtop"><div class="panel rvescudo"><canvas id="rvCv"></canvas>
        <div class="rvleyenda"><span><i style="background:#a898ff"></i>cosmic rays (heavy nuclei)</span><span><i style="background:#f2b457"></i>solar protons</span><span class="rvilus">illustrative · not to scale</span></div>
        <div class="rvcapas"><button data-rvcapa="casco" class="on">Hull 20 g/cm²</button><button data-rvcapa="refugio" class="on">Storm shelter +10 cm water</button></div></div>
        <div class="rvkpis" id="rvKpi"></div></div>
      <div class="rvmedio"><div class="panel rvcurva"><h3>Dose over the whole mission<span>MSL RAD rates · hover the curve</span></h3><div class="rvgraf" id="rvDosis"></div></div>
        <div class="panel rvtasa"><h3>Dose rate · 24 h<span id="rvTasaFu"></span></h3><div class="rvgraf" id="rvTasa"></div></div></div>
      <div class="rvbajo"><div class="panel rvdet"><h3>Luis's onboard detector<span>conceptual design · not on board yet</span></h3><div id="rvDet"></div></div>
        <div class="panel rvlog"><h3>Solar storms<span>logged on board</span></h3><div id="rvLog"></div></div></div>`;
    const cv = $('rvCv');
    cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); RV.hover = [e.clientX - r.left, e.clientY - r.top]; });
    cv.addEventListener('pointerleave', () => { RV.hover = null; });
    $('rvDosis').addEventListener('pointermove', e => { const r = $('rvDosis').getBoundingClientRect(); RV.hoverDosis = (e.clientX - r.left) / r.width; rvCurva(); });
    $('rvDosis').addEventListener('pointerleave', () => { RV.hoverDosis = null; rvCurva(); });
  }
  if (!RV.corre) { RV.corre = true; requestAnimationFrame(rvCuadro); }
  rvPintar();
}
const RV_CAPAS = { casco: true, refugio: true };

function rvPintar() {
  if ($('radiacion')?.hidden !== false) return;
  rvKpis(); rvCurva(); rvTasa(); rvDetector(); rvLog();
}

function rvKpis() {
  const r = window.RAD?.d; if (!r) return;
  const spe = r.spe?.activa, cruce = rvCruce(), { tr, sup, tot } = rvGeo(), fin = rvDosisDia(tot, tr, sup);
  $('rvKpi').innerHTML = `
    <div class="panel rvk ${spe ? 'alerta' : ''}"><small>Dose rate now${r.simulada ? ' · simulated' : ' · onboard detector'}</small><b>${Math.round(r.tasa_usv_h).toLocaleString('en')}<em>µSv/h</em></b><span>${spe ? 'solar particle event · crew in the storm shelter' : `≈ ${(r.tasa_usv_h * 24 / 1000).toFixed(2)} mSv a day · about ${Math.round(r.tasa_usv_h * 24 / 100)} chest X-rays (0.1 mSv each)`}</span></div>
    <div class="panel rvk"><small>Mission dose so far</small><b>${Math.round(r.mision.msv)}<em>mSv</em></b><div class="rvbar"><i style="width:${Math.min(100, r.mision.fraccion * 100).toFixed(1)}%"></i></div><span>${Math.round(r.mision.fraccion * 100)}% of NASA's 600 mSv career limit</span></div>
    <div class="panel rvk ${cruce ? 'aviso' : ''}"><small>At this pace</small><b>${Math.round(fin).toLocaleString('en')}<em>mSv by the end</em></b><span>${cruce ? `crosses the 600 mSv limit on day ${Math.round(cruce)}${cruce > tr ? ', already on Mars' : ''}` : 'stays under the career limit'}</span></div>
    <div class="panel rvk ${spe ? 'alerta' : ''}"><small>Solar storm</small><b>${spe ? 'ACTIVE' : 'Quiet'}</b><span>${spe ? `${r.spe.dosis_msv.toFixed(2)} of 250 mSv per event · <button data-rad-guia>Open guide</button>` : `alert at ≥ ${RV_UMBRAL} µSv/h · <button data-rad="spe">Run a demo storm</button>`}</span></div>`;
}

/* la curva de la misión: dosis acumulada día a día, límite y hoy; el cursor lee cualquier día */
function rvCurva() {
  const caja = $('rvDosis'); if (!caja) return;
  const { tr, sup, tot, hoy } = rvGeo(), W = 600, H = 190, l = 46, r = 14, t = 12, b = 26, max = Math.max(1300, rvDosisDia(tot, tr, sup) * 1.05);
  const x = d => l + d / tot * (W - l - r), y = v => H - b - v / max * (H - t - b);
  const pts = []; for (let d = 0; d <= tot; d += 6) pts.push([d, rvDosisDia(d, tr, sup)]); pts.push([tot, rvDosisDia(tot, tr, sup)]);
  const ruta = arr => arr.map(([d, v], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const hecho = pts.filter(([d]) => d <= hoy).concat([[hoy, rvDosisDia(hoy, tr, sup)]]), falta = [[hoy, rvDosisDia(hoy, tr, sup)], ...pts.filter(([d]) => d > hoy)];
  const cruce = rvCruce();
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  [0, 300, 600, 900, 1200].filter(v => v <= max).forEach(v => { s += `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.06)"/><text x="${l - 8}" y="${y(v) + 4}" text-anchor="end" class="rveje">${v}</text>`; });
  s += `<rect x="${x(tr)}" y="${t}" width="${x(tr + sup) - x(tr)}" height="${H - t - b}" fill="rgba(242,180,87,.06)"/><text x="${(x(tr) + x(tr + sup)) / 2}" y="${t + 12}" text-anchor="middle" class="rveje">on Mars · 0.64 mSv/day</text>`;
  s += `<text x="${(x(0) + x(tr)) / 2}" y="${t + 12}" text-anchor="middle" class="rveje">cruise · 1.84 mSv/day</text>`;
  s += `<line x1="${l}" x2="${W - r}" y1="${y(RV_LIMITE)}" y2="${y(RV_LIMITE)}" stroke="#ec6aa8" stroke-dasharray="5 5"/><text x="${W - r}" y="${y(RV_LIMITE) - 6}" text-anchor="end" class="rvlim">NASA career limit · 600 mSv</text>`;
  s += `<path d="${ruta(falta)}" fill="none" stroke="rgba(191,238,250,.4)" stroke-width="2" stroke-dasharray="4 5"/><path d="${ruta(hecho)}" fill="none" stroke="#8fe6f5" stroke-width="2.4"/>`;
  if (cruce) s += `<circle cx="${x(cruce)}" cy="${y(RV_LIMITE)}" r="5" fill="#ec6aa8"/><text x="${x(cruce) + 8}" y="${y(RV_LIMITE) + 16}" class="rvlim">day ${Math.round(cruce)}</text>`;
  s += `<circle cx="${x(hoy)}" cy="${y(rvDosisDia(hoy, tr, sup))}" r="5" fill="#fff"/><text x="${x(hoy) - 8}" y="${y(rvDosisDia(hoy, tr, sup)) - 10}" text-anchor="end" class="rvhoy">today · ${Math.round(rvDosisDia(hoy, tr, sup))} mSv</text>`;
  [0, 250, 500, 750, 1000].filter(d => d <= tot).forEach(d => { s += `<text x="${x(d)}" y="${H - 8}" text-anchor="middle" class="rveje">day ${d}</text>`; });
  if (RV.hoverDosis != null) {
    const d = Math.max(0, Math.min(tot, (RV.hoverDosis * W - l) / (W - l - r) * tot)), v = rvDosisDia(d, tr, sup), X = x(d);
    s += `<line x1="${X}" x2="${X}" y1="${t}" y2="${H - b}" stroke="rgba(255,255,255,.35)"/><circle cx="${X}" cy="${y(v)}" r="4" fill="#bfeefa"/>`;
    const izq = X > W * .6, tx = izq ? X - 10 : X + 10;
    s += `<g class="rvtipsvg"><rect x="${izq ? tx - 170 : tx}" y="${t + 20}" width="170" height="46" rx="8"/><text x="${(izq ? tx - 170 : tx) + 10}" y="${t + 39}" class="rvtipv">${Math.round(v)} mSv</text><text x="${(izq ? tx - 170 : tx) + 10}" y="${t + 56}" class="rveje">day ${Math.round(d)} · ${d < tr ? 'cruise' : d < tr + sup ? 'on Mars' : 'return'} · ${Math.round(v / RV_LIMITE * 100)}% of limit</text></g>`;
  }
  caja.innerHTML = s + '</svg>';
}

/* la tasa de las últimas 24 h, con el umbral de la alerta */
function rvTasa() {
  const caja = $('rvTasa'), r = window.RAD?.d; if (!caja || !r) return;
  $('rvTasaFu').textContent = r.simulada ? 'simulated from MSL RAD until the detector is on board' : 'onboard detector';
  const s0 = r.serie || [], W = 420, H = 190, l = 46, rr = 10, t = 12, b = 26;
  if (s0.length < 2) { caja.innerHTML = '<p class="cvacio">Collecting the first readings…</p>'; return; }
  const vmax = Math.max(RV_UMBRAL * 1.15, ...s0.map(p => p[1]) ), t0 = s0[0][0], t1 = s0[s0.length - 1][0] || t0 + 1;
  const lg = v => Math.log10(Math.max(10, v)), x = tt => l + (tt - t0) / Math.max(1, t1 - t0) * (W - l - rr), y = v => H - b - (lg(v) - 1) / (lg(vmax) - 1) * (H - t - b);
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  [10, 100, 1000, 10000].filter(v => v <= vmax).forEach(v => { s += `<line x1="${l}" x2="${W - rr}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.06)"/><text x="${l - 8}" y="${y(v) + 4}" text-anchor="end" class="rveje">${v.toLocaleString('en')}</text>`; });
  s += `<line x1="${l}" x2="${W - rr}" y1="${y(RV_UMBRAL)}" y2="${y(RV_UMBRAL)}" stroke="#f2b457" stroke-dasharray="5 5"/><text x="${W - rr}" y="${y(RV_UMBRAL) - 6}" text-anchor="end" class="rvlim" style="fill:#f2b457">solar storm alert · 500 µSv/h</text>`;
  s += `<path d="${s0.map(([tt, v], i) => `${i ? 'L' : 'M'}${x(tt).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${r.spe?.activa ? '#f2b457' : '#a898ff'}" stroke-width="2"/>`;
  const horas = (t1 - t0) / 3600;
  s += `<text x="${l}" y="${H - 8}" class="rveje">${horas >= 1 ? `${Math.round(horas)} h ago` : `${Math.round(horas * 60)} min ago`}</text><text x="${W - rr}" y="${H - 8}" text-anchor="end" class="rveje">now · µSv/h (log scale)</text>`;
  caja.innerHTML = s + '</svg>';
}

/* el instrumento de Luis, canal por canal (propuesta en equipo/luis-gonzalez/radiacion) */
const RV_CANALES = [
  ['Neutrons', 'single Bonner sphere, ⁶LiF/ZnS:Ag at 6 depths', 'neutrones_usv_h', 'µSv/h'],
  ['Protons', 'ΔE-E telescope (silicon + plastic)', 'protones_cm2_s', 'p/cm²/s'],
  ['Heavy ions · LET', 'silicon LET spectrometer (or Timepix)', 'let_kev_um', 'keV/µm'],
  ['Solar alert', 'fast FPGA coincidence channel', 'alerta_spe', ''],
  ['Betas · gammas', 'EJ-200 plastic + CsI(Tl), SiPM read-out', null, ''],
];
function rvDetector() {
  const caja = $('rvDet'), r = window.RAD?.d; if (!caja || !r) return;
  const det = r.detector;
  caja.innerHTML = `<div class="rvcanales">${RV_CANALES.map(([n, como, k, u]) => {
    const v = det && k ? det[k] : null, txt = v == null ? (det ? 'no reading' : 'awaiting hardware') : typeof v === 'boolean' ? (v ? 'ALERT' : 'quiet') : `${v} ${u}`;
    return `<div class="rvcanal"><i class="${det ? 'vivo' : ''}"></i><div><b>${n}</b><span>${como}</span></div><em>${txt}</em></div>`;
  }).join('')}</div><p class="panley">~15-25 kg · 10-25 W · sends <code>POST /v1/radiacion</code> (station contract) · until then NOVA simulates the rate from MSL RAD and says so</p>`;
}

async function rvLog() {
  const caja = $('rvLog'); if (!caja) return;
  if (Date.now() - RV.tEv > 10000) { RV.tEv = Date.now(); try { RV.eventos = await (await fetch(BASE + '/v1/bitacora?tipo=radiacion&dias=30&n=40', { cache: 'no-store' })).json(); } catch {} }
  const ev = (RV.eventos || []).slice().reverse(), r = window.RAD?.d;
  const filas = ev.filter(e => e.evento === 'spe_fin').slice(0, 5).map(e => `<div class="rvev"><b>${new Date(e.t * 1000).toLocaleString('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</b><span>peak ${Math.round(e.pico_usv_h).toLocaleString('en')} µSv/h · ${e.dosis_evento_msv.toFixed(2)} mSv</span></div>`).join('');
  caja.innerHTML = (r?.spe?.activa ? `<div class="rvev on"><b>Now</b><span>${Math.round(r.tasa_usv_h).toLocaleString('en')} µSv/h · crew in the shelter</span></div>` : '')
    + (filas || '<p class="cvacio" style="padding:14px 0">No solar storms logged on this mission yet.</p>')
    + '<p class="panley">Limits: 600 mSv career · 250 mSv per solar event (NASA-STD-3001). Storm shelter: crew quarters with +10 cm water (OCHMO p. 10).</p>';
}

/* el escudo, animado */
function rvCuadro(ahora) {
  const sec = $('radiacion'); if (!sec || sec.hidden) { RV.corre = false; return; }
  requestAnimationFrame(rvCuadro);
  const cv = $('rvCv'); if (!cv) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  const t = (ahora - RV.t0) / 1000, spe = !!window.RAD?.d?.spe?.activa, cx = w * .56, cy = h * .53, R = Math.min(w * .3, h * .38), Rr = R * .48;
  // el Sol a la izquierda
  const sg = c.createRadialGradient(0, cy, 0, 0, cy, h * .5); sg.addColorStop(0, spe ? 'rgba(255,190,90,.55)' : 'rgba(242,212,138,.28)'); sg.addColorStop(1, 'rgba(242,180,87,0)');
  c.fillStyle = sg; c.fillRect(0, 0, w * .5, h);
  // partículas nuevas
  const nuevas = (spe ? 7 : 1.2) + .8;
  for (let k = 0; k < nuevas; k++) {
    if (Math.random() < (spe ? .9 : .35)) RV.part.push({ x: -10, y: cy + (Math.random() - .5) * h * 1.1, vx: 5 + Math.random() * 3, vy: (Math.random() - .5) * 1.2, tipo: 'p', vida: 1 });
    if (Math.random() < .12) { const a = Math.random() * Math.PI * 2, d = Math.hypot(w, h); RV.part.push({ x: cx + Math.cos(a) * d * .6, y: cy + Math.sin(a) * d * .6, vx: -Math.cos(a) * 9, vy: -Math.sin(a) * 9 + (Math.random() - .5), tipo: 'g', vida: 1 }); }
  }
  if (RV.part.length > 700) RV.part.splice(0, RV.part.length - 700);
  // capas: casco y refugio
  if (RV_CAPAS.casco) { c.lineWidth = R * .12; c.strokeStyle = 'rgba(143,230,245,.14)'; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.stroke(); c.lineWidth = 1.2; c.strokeStyle = 'rgba(143,230,245,.55)'; c.beginPath(); c.arc(cx, cy, R + R * .06, 0, 7); c.stroke(); c.beginPath(); c.arc(cx, cy, R - R * .06, 0, 7); c.stroke(); }
  else { c.setLineDash([3, 6]); c.strokeStyle = 'rgba(143,230,245,.3)'; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.stroke(); c.setLineDash([]); }
  if (RV_CAPAS.refugio) { c.lineWidth = Rr * .22; c.strokeStyle = 'rgba(70,150,232,.22)'; c.beginPath(); c.arc(cx, cy, Rr, 0, 7); c.stroke(); c.lineWidth = 1.2; c.strokeStyle = 'rgba(120,180,255,.6)'; c.beginPath(); c.arc(cx, cy, Rr + Rr * .11, 0, 7); c.stroke(); c.beginPath(); c.arc(cx, cy, Rr - Rr * .11, 0, 7); c.stroke(); }
  // la tripulación: en el refugio si hay tormenta; si no, repartida por la nave
  const gente = (typeof CREW !== 'undefined' ? CREW : []).filter(p => !p.vacio).slice(0, 4);
  gente.forEach((p, i) => {
    const a = i / Math.max(1, gente.length) * Math.PI * 2 + .6, rd = spe ? Rr * .45 : R * .7, X = cx + Math.cos(a + (spe ? 0 : t * .05)) * rd, Y = cy + Math.sin(a + (spe ? 0 : t * .05)) * rd;
    c.fillStyle = 'rgba(191,238,250,.16)'; c.beginPath(); c.arc(X, Y, 15, 0, 7); c.fill();
    c.fillStyle = '#e8eef5'; c.font = '600 11px SG'; c.textAlign = 'center'; c.fillText(p.ini || (p.corto || '?').slice(0, 2), X, Y + 4);
  });
  // mover y dibujar partículas; el casco frena casi todos los protones, el refugio casi todos los que pasan
  for (const p of RV.part) {
    const d0 = Math.hypot(p.x - cx, p.y - cy); p.x += p.vx; p.y += p.vy; const d1 = Math.hypot(p.x - cx, p.y - cy);
    if (p.tipo === 'p') {
      if (RV_CAPAS.casco && d0 > R && d1 <= R && Math.random() < .93) { p.vida = 0; p.choque = 1; }
      else if (RV_CAPAS.refugio && d0 > Rr && d1 <= Rr && Math.random() < .85) { p.vida = 0; p.choque = 1; }
    }
    if (p.choque) { p.choque -= .12; c.fillStyle = `rgba(255,214,140,${Math.max(0, p.choque)})`; c.beginPath(); c.arc(p.x, p.y, 3, 0, 7); c.fill(); continue; }
    if (p.vida <= 0) continue;
    c.strokeStyle = p.tipo === 'g' ? 'rgba(190,170,255,.85)' : 'rgba(242,180,87,.8)'; c.lineWidth = p.tipo === 'g' ? 1.6 : 1.1;
    c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * (p.tipo === 'g' ? 3 : 1.6), p.y - p.vy * 2); c.stroke();
  }
  RV.part = RV.part.filter(p => (p.vida > 0 || (p.choque || 0) > 0) && p.x > -40 && p.x < w + 40 && p.y > -40 && p.y < h + 40);
  // rótulos
  c.textAlign = 'left'; c.font = '500 12px SG';
  if (RV_CAPAS.casco) { c.fillStyle = 'rgba(191,238,250,.85)'; c.fillText('Hull · 20 g/cm²', cx + R * .72, cy - R * .78); }
  if (RV_CAPAS.refugio) { c.fillStyle = 'rgba(160,200,255,.9)'; c.fillText('Storm shelter · crew quarters +10 cm water', cx - Rr * .9, cy + Rr + 22); }
  c.fillStyle = spe ? '#f2b457' : 'rgba(242,212,138,.7)'; c.font = '600 12px SG'; c.fillText(spe ? 'SOLAR PARTICLE EVENT' : 'Sun', 14, 30);
  c.fillStyle = 'rgba(190,170,255,.8)'; c.font = '400 11.5px SG'; c.fillText('Cosmic rays come from every direction and cross any shield', 14, h - 14);
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-rvcapa]'); if (!b) return;
  RV_CAPAS[b.dataset.rvcapa] = !RV_CAPAS[b.dataset.rvcapa]; b.classList.toggle('on', RV_CAPAS[b.dataset.rvcapa]);
});
window.abrirRadiacion = abrirRadiacion;
setInterval(() => { if (typeof vista !== 'undefined' && vista === 'radiacion') rvPintar(); }, 2000);
