/* Vista «Mission»: cómo va la misión y la tripulación, en una pantalla.
   · Arriba, el sistema solar con la nave en su transferencia de Hohmann real (el mismo modelo que mision.rs: elementos
     orbitales de la Tierra y Marte, J2000) y la señal de luz viajando con su retraso. La línea de tiempo recorre los
     1018 días: se arrastra para ver cualquier día o se reproduce la misión entera.
   · Cifras: día, llegada, luz, tripulación, cuánto de lo medido es real.
   · Disposición de la tripulación: lo que llega de cada app y de la estación (corazón, sueño, pasos, variabilidad,
     ánimo y energía si se comparten, alerta del Eye check) con su origen y su edad, sin inventar lo que falta.
   · Cabina: CO₂ de las últimas 24 h. */
'use strict';

/* ── el modelo orbital de la nave (port de mision.rs) ── */
const PAN = { dia: null, juega: false, tJuego: 0, fuentes: {}, diarios: {}, co2: null, tPed: 0, hover: null, t0: performance.now() };
const UA_KM = 149597870.7, SEG_LUZ_UA = 499.004784, J2000 = 10957.5;
const EL = {
  tierra: { a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], l: [100.46457166, 35999.37244981], w: [102.93768193, 0.32327364] },
  marte: { a: [1.52371034, 0.00001847], e: [0.09339410, 0.00007882], l: [-4.55343205, 19140.30268499], w: [-23.94362959, 0.44441088] },
};
function kep(m, e) { let E = m + e * Math.sin(m); for (let i = 0; i < 30; i++) { const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-12) break; } return E; }
function posPlaneta(p, unix) {
  const T = (unix / 86400 - J2000) / 36525, a = p.a[0] + p.a[1] * T, e = p.e[0] + p.e[1] * T;
  const L = (p.l[0] + p.l[1] * T) * Math.PI / 180, w = (p.w[0] + p.w[1] * T) * Math.PI / 180;
  const M = ((L - w) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI), E = kep(M, e);
  const x = a * (Math.cos(E) - e), y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  return [x * Math.cos(w) - y * Math.sin(w), x * Math.sin(w) + y * Math.cos(w)];
}
function lanzamiento() { return mision ? Date.now() / 1000 - mision.dia_exacto * 86400 : 1775606400; }
function estadoDia(dia) {
  const L = lanzamiento(), t = L + dia * 86400, t0 = posPlaneta(EL.tierra, L), r1 = Math.hypot(...t0), th0 = Math.atan2(t0[1], t0[0]), r2 = EL.marte.a[0];
  const at = (r1 + r2) / 2, et = (r2 - r1) / (r2 + r1), per = Math.pow(at, 1.5) * 365.256363, tr = per / 2;
  const estadia = mision ? mision.total_dias - 2 * Math.round(tr) : 500;
  let fase, nave;
  if (dia < tr) { const E = kep(2 * Math.PI * dia / per, et), r = at * (1 - et * Math.cos(E)), nu = 2 * Math.atan(Math.sqrt((1 + et) / (1 - et)) * Math.tan(E / 2)); fase = 'cruise'; nave = [r * Math.cos(th0 + nu), r * Math.sin(th0 + nu)]; }
  else { fase = dia < tr + estadia ? 'mars' : 'return'; nave = posPlaneta(EL.marte, t); }
  const tierra = posPlaneta(EL.tierra, t), marte = posPlaneta(EL.marte, t), dx = nave[0] - tierra[0], dy = nave[1] - tierra[1], dist = Math.hypot(dx, dy);
  const cos = (dx * -tierra[0] + dy * -tierra[1]) / (dist * Math.hypot(...tierra)), elong = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
  return { dia, fase, tr, estadia, total: 2 * tr + estadia, tierra, marte, nave, dist, luz: dist * SEG_LUZ_UA, elong, conj: elong < 2, th0, at, et, per };
}

/* ── datos ── */
async function panPedir() {
  if (Date.now() - PAN.tPed < 20000) return; PAN.tPed = Date.now();
  const j = u => fetch(BASE + u, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const [f, co2] = await Promise.all([j('/v1/fuentes'), j('/v1/historia?trip=CABINA&k=co2_cabina&seg=86400&puntos=160')]);
  PAN.fuentes = f || {}; PAN.co2 = co2;
  const reales = CREW.map((c, i) => [c, i]).filter(([c]) => c.real);
  const ds = await Promise.all(reales.map(([c]) => j(`/v1/diario?trip=${c.id}`)));
  reales.forEach(([c], k) => { PAN.diarios[c.id] = ds[k]?.dias || []; });
  pintarPanorama();
}

/* ── pintar ── */
const panEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAN_COL = { normal: '#6fd6b0', esperado_vuelo: '#6fd6b0', vigilar: '#a898ff', atencion: '#f2b457', aviso_tierra: '#ec6aa8', sin_dato: '#4a5260' };
const PAN_NIV = { normal: 'normal', esperado_vuelo: 'expected in flight', vigilar: 'watch', atencion: 'attention', aviso_tierra: 'tell Earth', sin_dato: 'no data' };
/* lo personal de una persona real: su diario de hoy (o de ayer, para el sueño) */
function panDiario(c, k) {
  const ds = PAN.diarios[c.id] || [], f = n => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  for (const n of k === 'sueno_h' ? [0, 1] : [0]) { const d = ds.find(x => x.fecha === f(n)); if (d?.[k] != null) return { v: d[k], cuando: n ? 'yesterday' : 'today' }; }
  return null;
}
function panEdad(s) { if (!s) return 'no reading'; return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; }
const PAN_PERSONAL = ['sueno_h', 'animo', 'energia'];
function panFuente(trip, k) {
  const f = PAN.fuentes?.[trip]?.[k], real = CREW.find(c => c.id === trip)?.real;
  if (!f) return !real ? { t: 'demo data', real: false } : PAN_PERSONAL.includes(k) ? { t: 'not shared yet', real: false } : { t: 'simulated', real: false };
  const n = { 'nova-movil': 'their phone', 'estacion-luis': 'NOVA Station', simulador: 'simulated' }[f.fuente] || f.fuente;
  return { t: n + (f.vigente ? '' : ' (stale)'), real: f.fuente !== 'simulador' && f.vigente };
}

function pintarPanorama() {
  const caja = $('panorama'); if (!caja || caja.hidden) return;
  if (!caja.dataset.listo) {
    caja.dataset.listo = 1;
    caja.innerHTML = `<div class="panel panhero"><canvas id="panCv"></canvas><div class="pantip" id="panTip" hidden></div>
        <div class="panleyenda"><span><i style="background:#46c8e8"></i>Earth</span><span><i style="background:#f2b457"></i>Mars</span><span><i style="background:#fff"></i>NOVA</span><span><i class="lin"></i>light signal</span></div>
        <div class="pankpis" id="panKpi"></div>
        <div class="pantl" id="panTL"><div class="panlcab"><span id="panDiaTxt"></span><button id="panHoy">Today</button><button id="panPlay">▶ Play mission</button></div>
          <div class="panfases" id="panFases"></div><input type="range" id="panDia" min="0" max="1018" step="1"></div></div>
      <div class="panbajo"><div class="panel panmatriz"><h3>Crew readiness<span>apps · NOVA Station · onboard core · hover a cell, click a row</span></h3><div id="panMatriz"></div></div>
        <div class="panel panapps"><h3>From their apps<span>last night and today</span></h3><div id="panApps"></div></div></div>`;
    $('panDia').addEventListener('input', e => { PAN.dia = +e.target.value; PAN.juega = false; $('panPlay').textContent = '▶ Play mission'; panLinea(); });
    $('panHoy').onclick = () => { PAN.dia = null; PAN.juega = false; $('panPlay').textContent = '▶ Play mission'; panLinea(); };
    $('panPlay').onclick = () => { PAN.juega = !PAN.juega; if (PAN.juega && (PAN.dia == null || PAN.dia >= estadoDia(0).total - 1)) PAN.dia = 0; $('panPlay').textContent = PAN.juega ? '❚❚ Pause' : '▶ Play mission'; };
    const cv = $('panCv');
    cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); PAN.hover = [e.clientX - r.left, e.clientY - r.top]; });
    cv.addEventListener('pointerleave', () => { PAN.hover = null; $('panTip').hidden = true; });
    $('panMatriz').addEventListener('pointerover', e => { const c = e.target.closest('[data-pt]'); const tip = $('panTip2'); if (!c || !tip) return; tip.innerHTML = c.dataset.pt; tip.hidden = false; const r = c.getBoundingClientRect(), m = $('panMatriz').getBoundingClientRect(); tip.style.left = `${Math.min(m.width - 240, r.left - m.left)}px`; tip.style.top = `${r.bottom - m.top + 6}px`; });
    $('panMatriz').addEventListener('pointerleave', () => { const t = $('panTip2'); if (t) t.hidden = true; });
    $('panMatriz').addEventListener('click', e => { const f = e.target.closest('[data-pi]'); if (f && typeof abrirVitals === 'function') abrirVitals(+f.dataset.pi); });
  }
  if (!PAN.corre) { PAN.corre = true; requestAnimationFrame(panCuadro); }
  panLinea(); panKpis(); panMatriz(); panApps(); panCabina();
}

function panLinea() {
  const hoy = mision?.dia_exacto ?? 0, d = PAN.dia ?? hoy, e = estadoDia(d), tot = e.total;
  $('panDia').max = Math.round(tot); $('panDia').value = Math.round(d);
  const fases = [['Cruise to Mars', 0, e.tr, '#46c8e8'], ['On Mars', e.tr, e.tr + e.estadia, '#f2b457'], ['Return to Earth', e.tr + e.estadia, tot, '#a898ff']];
  $('panFases').innerHTML = fases.map(([n, a, b, c]) => `<div style="flex:${b - a};--c:${c}"><span>${n}</span><small>${Math.round(b - a)} days</small></div>`).join('')
    + `<i class="panhoy" style="left:${hoy / tot * 100}%"><em>today · day ${Math.floor(hoy)}</em></i>${PAN.dia != null ? `<i class="panver" style="left:${d / tot * 100}%"></i>` : ''}`;
  const f = new Date((lanzamiento() + d * 86400) * 1000);
  $('panDiaTxt').innerHTML = `${PAN.dia == null ? 'Today' : 'Viewing'} · day <b>${Math.floor(d)}</b> of ${Math.round(tot)} · ${f.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })} · light <b>${(e.luz / 60).toFixed(1)} min</b>${e.conj ? ' · <b class="panconj">solar conjunction, no Earth link</b>' : ''}`;
}

function panKpis() {
  if (!mision) return;
  const tr = ultimo?.trip || [], vis = CREW.map((c, i) => [c, i]).filter(([c]) => !c.vacio);
  const cuenta = n => vis.filter(([, i]) => (tr[i]?.nivel || 'normal') === n).length;
  const ok = cuenta('normal') + cuenta('esperado_vuelo'), at = vis.length - ok;
  let real = 0, total = 0;
  vis.forEach(([c]) => { if (!c.real) return; for (const k of ['pulso', 'spo2', 'sueno_h', 'pasos', 'vfc', 'animo']) { total++; if (panFuente(c.id, k).real) real++; } });
  const pct = total ? Math.round(real / total * 100) : null, avance = mision.dia_exacto / mision.total_dias;
  const anillo = `<svg viewBox="0 0 64 64" class="panring"><circle cx="32" cy="32" r="27" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="6"/><circle cx="32" cy="32" r="27" fill="none" stroke="#8fe6f5" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(avance * 169.6).toFixed(1)} 170" transform="rotate(-90 32 32)"/></svg>`;
  $('panKpi').innerHTML = `
    <div class="panel pankpi conanillo ancho">${anillo}<div><small>Mission day</small><b>${mision.dia}<em>/ ${mision.total_dias}</em></b><span>${Math.round(avance * 100)}% done</span></div></div>
    <div class="panel pankpi"><small>${mision.fase === 'cruise' ? 'Mars arrival' : mision.fase === 'mars' ? 'On Mars' : 'Earth arrival'}</small><b>${mision.fase === 'cruise' ? mision.llegada_en_dias : '—'}<em>${mision.fase === 'cruise' ? 'days' : ''}</em></b><span>${mision.fase === 'cruise' ? `transfer of ${mision.transferencia_dias} days` : ''}</span></div>
    <div class="panel pankpi"><small>Light to Earth</small><b>${(mision.luz_seg / 60).toFixed(1)}<em>min</em></b><span>reply in ${(mision.luz_seg / 30).toFixed(0)} min · ${(mision.distancia_km / 1e6).toFixed(0)} M km</span></div>
    <div class="panel pankpi"><small>Crew</small><b>${ok}<em>of ${vis.length} steady</em></b><span>${at ? `<i class="pandot" style="background:#f2b457"></i>${at} need${at > 1 ? '' : 's'} attention` : 'nobody needs attention'}</span></div>
    <div class="panel pankpi"><small>Real data</small><b>${pct == null ? '—' : pct}<em>${pct == null ? '' : '%'}</em></b><span>${pct == null ? 'demo crew' : 'measured by the crew, not simulated'}</span></div>
    <div class="panel pankpi" id="panCab"></div>
    <div class="panel pankpi rad" id="panRad"></div>`;
  panRad();
}

/* la matriz: una fila por persona, una columna por dato; cada celda dice de dónde viene y cuándo */
const PAN_COLS = [['nivel', 'Overall'], ['pulso', 'Heart'], ['sueno_h', 'Sleep'], ['pasos', 'Steps'], ['vfc', 'HRV'], ['animo', 'Mood'], ['energia', 'Energy'], ['alerta', 'Alertness']];
function panMatriz() {
  const tr = ultimo?.trip || [], vis = CREW.map((c, i) => [c, i]).filter(([c]) => !c.vacio);
  const fila = ([c, i]) => {
    const t = tr[i] || {}, celdas = PAN_COLS.map(([k, n]) => {
      let v = '—', niv = 'sin_dato', fu = panFuente(c.id, k), extra = '';
      if (k === 'nivel') { niv = t.nivel || 'sin_dato'; v = PAN_NIV[niv]; fu = { t: 'onboard core rules', real: true }; }
      else if (k === 'alerta') { const o = window.ojosUltimas?.[c.id]; if (o?.alerta) { v = { alerta: 'alert', algo: 'some signs', cansado: 'tired' }[o.alerta]; niv = o.alerta === 'alerta' ? 'normal' : o.alerta === 'algo' ? 'vigilar' : 'atencion'; extra = `PERCLOS ${o.perclos}%`; fu = { t: `Eye check ${panEdad(Math.round((Date.now() - o.t) / 1000))}`, real: true }; } else fu = { t: 'no eye check yet', real: false }; }
      else if ((k === 'animo' || k === 'energia') && c.real && c.mente !== true) { v = 'private'; fu = { t: 'not shared («Share my day» is off)', real: false }; }
      else if (c.real && PAN_PERSONAL.includes(k)) {
        const dd = panDiario(c, k);
        if (dd) { v = k === 'sueno_h' ? `${dd.v.toFixed(1)} h` : `${Math.round(dd.v)}/5`; niv = t.niveles?.[k] && t.niveles[k] !== 'sin_dato' ? t.niveles[k] : 'normal'; extra = dd.cuando; fu = { t: 'their phone · shared diary', real: true }; }
        else fu = { t: c.mente === true ? 'nothing shared yet today' : 'not shared («Share my day» is off)', real: false };
      }
      else if (t.edades?.[k] > 0 && t[k] != null) {
        v = k === 'pasos' ? Math.round(t[k]).toLocaleString('en') : k === 'sueno_h' ? `${t[k].toFixed(1)} h` : k === 'pulso' ? `${Math.round(t[k])} bpm` : k === 'vfc' ? `${Math.round(t[k])} ms` : `${Math.round(t[k])}/5`;
        niv = t.niveles?.[k] || 'normal'; extra = panEdad(t.edades[k]);
      }
      const tip = `<b>${panEsc(c.corto)} · ${n}</b><span>${panEsc(v)}${extra ? ` · ${panEsc(extra)}` : ''}</span><small>${fu.real ? '● ' : '○ '}${panEsc(fu.t)}</small>`;
      return `<td data-pt="${panEsc(tip)}"><i style="background:${PAN_COL[niv]}"></i>${panEsc(v)}${fu.t === 'simulated' || fu.t === 'demo data' ? '<sup>sim</sup>' : ''}</td>`;
    }).join('');
    return `<tr data-pi="${i}"><th>${panEsc(c.corto)}<small>${panEsc(c.rol || '')}</small></th>${celdas}</tr>`;
  };
  $('panMatriz').innerHTML = `<div class="panmw"><table class="panm"><tr><th></th>${PAN_COLS.map(([, n]) => `<th>${n}</th>`).join('')}</tr>${vis.map(fila).join('')}</table></div><div class="pantip2" id="panTip2" hidden></div>
    <p class="panley"><i style="background:#6fd6b0"></i>normal <i style="background:#a898ff"></i>watch <i style="background:#f2b457"></i>attention <i style="background:#ec6aa8"></i>tell Earth <i style="background:#4a5260"></i>no data · <sup>sim</sup> simulated · click a row for that person's vitals</p>`;
}

/* lo que mandan las apps: sueño de anoche y pasos de hoy, por persona (barras), y cuántos comparten su día */
function panApps() {
  const tr = ultimo?.trip || [], vis = CREW.map((c, i) => [c, i]).filter(([c]) => !c.vacio);
  const barras = (k, max, fmt, meta) => vis.map(([c, i]) => {
    const v = c.real && PAN_PERSONAL.includes(k) ? (panDiario(c, k)?.v ?? null) : tr[i]?.edades?.[k] > 0 ? tr[i][k] : null, w = v == null ? 0 : Math.min(100, v / max * 100);
    return `<div class="panbar"><span>${panEsc(c.corto)}</span><div><i style="width:${w}%"></i>${meta ? `<u style="left:${meta / max * 100}%"></u>` : ''}</div><b>${v == null ? '—' : fmt(v)}</b></div>`;
  }).join('');
  const comp = vis.filter(([c]) => c.real && c.mente === true).length, reales = vis.filter(([c]) => c.real).length;
  $('panApps').innerHTML = `<h4>Sleep last night<small>goal 7 h</small></h4>${barras('sueno_h', 10, v => v.toFixed(1) + ' h', 7)}
    <h4>Steps today<small>from their phones</small></h4>${barras('pasos', 12000, v => Math.round(v).toLocaleString('en'))}
    <p class="panley">${reales ? `${comp} of ${reales} share their day (mood and energy) · the rest stays on their phone` : 'demo crew'}</p>`;
}

function panRad() {
  const caja = $('panRad'), r = window.RAD?.d; if (!caja || !r) return;
  const spe = r.spe?.activa, f = Math.min(1, r.mision.fraccion);
  caja.classList.toggle('spe', !!spe);
  caja.innerHTML = spe ? `<small>Radiation · SOLAR STORM</small><b>${Math.round(r.tasa_usv_h).toLocaleString('en')}<em>µSv/h</em></b><span>crew in the storm shelter · event ${r.spe.dosis_msv.toFixed(2)} mSv</span>`
    : `<small>Radiation${r.simulada ? ' · sim' : ''}</small><b>${Math.round(r.tasa_usv_h)}<em>µSv/h</em></b><div class="radbar"><i style="width:${(f * 100).toFixed(1)}%"></i></div><span>≈ ${Math.round(r.mision.msv)} of 600 mSv career limit</span>`;
}
setInterval(() => { if (typeof vista !== 'undefined' && vista === 'panorama') panRad(); }, 2000);

function panCabina() {
  const cab = ultimo?.cabina, caja = $('panCab'); if (!cab || !caja) return;
  const v = (PAN.co2?.v || []).filter(x => x != null);
  let svg = '';
  if (v.length > 2) {
    const W = 200, H = 26, lo = Math.min(...v), hi = Math.max(...v, lo + 200), x = i => i / (v.length - 1) * W, y = c => H - 2 - (c - lo) / (hi - lo) * (H - 4);
    svg = `<svg viewBox="0 0 ${W} ${H}" class="panco2" preserveAspectRatio="none"><path d="${v.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(c).toFixed(1)}`).join(' ')}" fill="none" stroke="#8fe6f5" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
  }
  caja.innerHTML = `<small>Cabin CO₂ · 24 h</small><b>${Math.round(cab.co2).toLocaleString('en')}<em>ppm</em></b>${svg}<span>O₂ ${cab.o2.toFixed(1)}% · ${cab.temp.toFixed(1)} °C · limit 5,000</span>`;
}

/* ── el sistema solar, animado ── */
function panCuadro(ahora) {
  const caja = $('panorama'); if (!caja || caja.hidden) { PAN.corre = false; return; }
  requestAnimationFrame(panCuadro);
  const cv = $('panCv'); if (!cv) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  if (PAN.juega) { PAN.dia = (PAN.dia ?? 0) + 2.2; if (PAN.dia >= estadoDia(0).total) { PAN.dia = null; PAN.juega = false; $('panPlay').textContent = '▶ Play mission'; } if (Math.floor(ahora / 120) !== PAN.tJuego) { PAN.tJuego = Math.floor(ahora / 120); panLinea(); } }
  const d = PAN.dia ?? mision?.dia_exacto ?? 0, e = estadoDia(d), t = (ahora - PAN.t0) / 1000;
  const kw = ($('panKpi')?.offsetWidth || 0) + 28, th = ($('panTL')?.offsetHeight || 0) + 16, lw = w - kw, lh = h - th;
  const S = Math.min(lw, lh) / 2 / 1.72, cx = lw / 2 + 8, cy = lh / 2 + 4, P = ([x, y]) => [cx + x * S, cy - y * S];
  // estrellas del fondo
  for (let k = 0; k < 90; k++) { const a = Math.sin(k * 91.7) * 43758.5, b = Math.sin(k * 47.3) * 12345.6; c.fillStyle = `rgba(223,232,242,${.08 + (k % 5) * .04 + .05 * Math.sin(t * 1.3 + k)})`; c.fillRect((a - Math.floor(a)) * w, (b - Math.floor(b)) * h, 1.2, 1.2); }
  // órbitas
  const orbita = (p, col) => { c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); for (let k = 0; k <= 120; k++) { const q = P(posPlaneta(p, lanzamiento() + k * (p === EL.tierra ? 365.25 : 687) / 120 * 86400)); k ? c.lineTo(...q) : c.moveTo(...q); } c.stroke(); };
  orbita(EL.tierra, 'rgba(70,200,232,.22)'); orbita(EL.marte, 'rgba(242,180,87,.22)');
  // la transferencia: hecha (sólida) y por hacer (punteada)
  c.lineWidth = 1.6; c.setLineDash([]);
  const arco = (a, b, punteada) => { c.strokeStyle = punteada ? 'rgba(255,255,255,.22)' : 'rgba(191,238,250,.75)'; c.setLineDash(punteada ? [4, 6] : []); c.beginPath(); for (let k = 0; k <= 60; k++) { const dd = a + (b - a) * k / 60, E = kep(2 * Math.PI * dd / e.per, e.et), r = e.at * (1 - e.et * Math.cos(E)), nu = 2 * Math.atan(Math.sqrt((1 + e.et) / (1 - e.et)) * Math.tan(E / 2)), q = P([r * Math.cos(e.th0 + nu), r * Math.sin(e.th0 + nu)]); k ? c.lineTo(...q) : c.moveTo(...q); } c.stroke(); c.setLineDash([]); };
  const hecho = Math.min(d, e.tr); if (hecho > 0) arco(0, hecho, false); if (hecho < e.tr) arco(hecho, e.tr, true);
  // el Sol
  const sol = c.createRadialGradient(cx, cy, 0, cx, cy, 26); sol.addColorStop(0, 'rgba(255,230,160,1)'); sol.addColorStop(.35, 'rgba(242,212,138,.6)'); sol.addColorStop(1, 'rgba(242,180,87,0)');
  c.fillStyle = sol; c.beginPath(); c.arc(cx, cy, 26, 0, 7); c.fill();
  const pT = P(e.tierra), pM = P(e.marte), pN = P(e.nave);
  // la señal de luz: va y vuelve entre la Tierra y la nave (el tiempo real comprimido: un viaje = 2,5 s)
  if (!e.conj) {
    c.strokeStyle = 'rgba(143,230,245,.18)'; c.setLineDash([2, 5]); c.beginPath(); c.moveTo(...pT); c.lineTo(...pN); c.stroke(); c.setLineDash([]);
    const u = (t / 2.5) % 2, f = u < 1 ? u : 2 - u, q = [pT[0] + (pN[0] - pT[0]) * f, pT[1] + (pN[1] - pT[1]) * f];
    const g = c.createRadialGradient(q[0], q[1], 0, q[0], q[1], 10); g.addColorStop(0, 'rgba(191,238,250,.95)'); g.addColorStop(1, 'rgba(143,230,245,0)');
    c.fillStyle = g; c.beginPath(); c.arc(q[0], q[1], 10, 0, 7); c.fill();
    c.fillStyle = '#bfeefa'; c.font = '500 12px SG'; c.textAlign = 'center'; c.fillText(`${(e.luz / 60).toFixed(1)} light-min`, (pT[0] + pN[0]) / 2, (pT[1] + pN[1]) / 2 - 8);
  }
  const cuerpo = (q, r, col, nombre, sub) => {
    const g = c.createRadialGradient(q[0], q[1], 0, q[0], q[1], r * 3.2); g.addColorStop(0, col + 'aa'); g.addColorStop(1, col + '00');
    c.fillStyle = g; c.beginPath(); c.arc(q[0], q[1], r * 3.2, 0, 7); c.fill();
    c.fillStyle = col; c.beginPath(); c.arc(q[0], q[1], r, 0, 7); c.fill();
    // la etiqueta va a la derecha si cabe antes de las cifras; si no, a la izquierda del cuerpo
    c.font = '400 11.5px SG'; const ancho = Math.max(c.measureText(sub || '').width, 60), izq = q[0] + r + 8 + ancho > lw - 4;
    const tx = izq ? q[0] - r - 8 : q[0] + r + 8; c.textAlign = izq ? 'right' : 'left';
    c.fillStyle = '#e8eef5'; c.font = '600 13px SG'; c.fillText(nombre, tx, q[1] + 4);
    if (sub) { c.fillStyle = '#8b95a3'; c.font = '400 11.5px SG'; c.fillText(sub, tx, q[1] + 19); }
  };
  const juntos = Math.hypot(pN[0] - pM[0], pN[1] - pM[1]) < 26;   // en Marte: un solo nombre
  cuerpo(pT, 6, '#46c8e8', 'Earth', null); cuerpo(pM, 5, '#f2b457', juntos ? '' : 'Mars', null);
  // la nave: pulsa, con su estela
  const pul = 1 + .25 * Math.sin(t * 3);
  c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 1; c.beginPath(); c.arc(pN[0], pN[1], 11 * pul, 0, 7); c.stroke();
  cuerpo(pN, 4, '#ffffff', juntos ? 'NOVA · Mars' : 'NOVA', e.fase === 'cruise' ? `day ${Math.floor(d)} · ${(e.dist * UA_KM / 1e6).toFixed(0)} M km from Earth` : e.fase === 'mars' ? 'on Mars' : 'returning');
  if (e.conj) { c.fillStyle = '#f2b457'; c.font = '600 13px SG'; c.textAlign = 'center'; c.fillText('Solar conjunction · the Sun blocks the link to Earth', cx, lh - 8); }
  // tormenta solar: ondas de partículas que salen del Sol y la nave en ámbar (solo hoy, no al recorrer otros días)
  if (window.RAD?.d?.spe?.activa && PAN.dia == null) {
    const R = Math.hypot(pN[0] - cx, pN[1] - cy) * 1.25;
    for (let k = 0; k < 3; k++) { const u = ((t * .35) + k / 3) % 1; c.strokeStyle = `rgba(242,180,87,${(1 - u) * .55})`; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, 20 + u * R, 0, 7); c.stroke(); }
    c.strokeStyle = 'rgba(242,180,87,.9)'; c.lineWidth = 2; c.beginPath(); c.arc(pN[0], pN[1], 16 + 3 * Math.sin(t * 6), 0, 7); c.stroke();
    c.fillStyle = '#f2b457'; c.font = '600 13px SG'; c.textAlign = 'center'; c.fillText('Solar particle event · crew in the storm shelter', cx, 28);
  }
  // cursor: qué es cada cosa
  if (PAN.hover) {
    const [hx, hy] = PAN.hover, cerca = [[pT, `<b>Earth</b><span>${(Math.hypot(...e.tierra)).toFixed(2)} AU from the Sun</span>`], [pM, `<b>Mars</b><span>${(Math.hypot(...e.marte)).toFixed(2)} AU from the Sun</span>`], [pN, `<b>NOVA · day ${Math.floor(d)}</b><span>${(e.dist * UA_KM / 1e6).toFixed(1)} million km from Earth</span><span>light one way ${(e.luz / 60).toFixed(1)} min · Sun–Earth angle ${e.elong.toFixed(0)}°</span>`], [[cx, cy], '<b>Sun</b>']].find(([q]) => Math.hypot(q[0] - hx, q[1] - hy) < 22);
    const tip = $('panTip'); if (cerca) { tip.innerHTML = cerca[1]; tip.hidden = false; tip.style.left = `${Math.min(w - 230, hx + 14)}px`; tip.style.top = `${hy + 14}px`; } else tip.hidden = true;
  }
}

window.abrirPanorama = () => { pintarPanorama(); panPedir(); };
setInterval(() => { if (typeof vista !== 'undefined' && vista === 'panorama') { panPedir(); pintarPanorama(); } }, 5000);
