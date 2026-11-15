/* NOVA · pantalla de la tripulación.
   Datos en vivo del núcleo de vuelo (F Prime) a través del enlace local de la nave (SSE en :8750).
   Las tarjetas de NOVA salen de reglas fijas y revisables (no de un modelo): qué cambió, por qué importa y qué hacer. */
'use strict';
const $ = id => document.getElementById(id);
const BASE = location.port === '8750' ? '' : 'http://127.0.0.1:8750';

const CREW = [
  { id: 'T1', nombre: 'Mara Reyes', corto: 'Mara', rol: 'Commander', ini: 'MR', col: '#8fe6f5', ella: 'her' },
  { id: 'T2', nombre: 'David Okafor', corto: 'David', rol: 'Pilot', ini: 'DO', col: '#8fe6f5', ella: 'his' },
  { id: 'T3', nombre: 'Ingrid Lindqvist', corto: 'Ingrid', rol: 'Flight engineer', ini: 'IL', col: '#8fe6f5', ella: 'her' },
  { id: 'T4', nombre: 'Kenji Tanaka', corto: 'Kenji', rol: 'Mission specialist', ini: 'KT', col: '#c3b8ff', ella: 'his' },
];
const COL = { normal: '#8fe6f5', esperado_vuelo: '#8fe6f5', atencion: '#f2b457', aviso_tierra: '#ec6aa8', sin_dato: '#5b6573' };
const RANGO = { sin_dato: 0, normal: 1, esperado_vuelo: 2, atencion: 3, aviso_tierra: 4 };
const peor = (...n) => n.reduce((a, b) => (RANGO[b] > RANGO[a] ? b : a), 'sin_dato');
/* referencia para decir si un valor fuera de rango está alto o bajo */
const MEDIO = { pulso: 70, spo2: 100, pa_sis: 115, pa_dia: 75, temp: 37, fr: 15, glucosa: 100, sueno_h: 99, animo: 99, energia: 99 };
const NOMBRE = { sueno_h: 'sleep', animo: 'mood', energia: 'energy', pasos: 'steps', pulso: 'heart rate', spo2: 'oxygen', pa_sis: 'blood pressure', pa_dia: 'blood pressure', temp: 'temperature', fr: 'breathing rate', glucosa: 'blood sugar', vfc: 'heart rate variability', co2_cabina: 'cabin CO₂', o2_cabina: 'cabin oxygen', temp_cabina: 'cabin temperature' };
const UNIDAD = { sueno_h: 'h', animo: '/5', energia: '/5', pasos: '', pulso: 'bpm', spo2: '%', pa_sis: 'mmHg', pa_dia: 'mmHg', temp: '°C', fr: '/min', glucosa: 'mg/dL', vfc: 'ms', co2_cabina: 'ppm', o2_cabina: '%', temp_cabina: '°C' };
const VITALES = ['pulso', 'spo2', 'pa_sis', 'pa_dia', 'temp', 'fr', 'glucosa'];
const DIARIOS = ['sueno_h', 'animo', 'energia'];
const fmt = (k, v) => k === 'temp' ? v.toFixed(1) : k === 'co2_cabina' ? Math.round(v).toLocaleString('en-US') : String(Math.round(v));
const hora = t => new Date(t * 1000).toTimeString().slice(0, 8);
const hace = s => s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;

/* ── estado de la pantalla ── */
let vista = 'crew', mision = null;
let ultimo = null, recibido = 0, fase = [0, 0, 0, 0], histFc = [[], [], [], []], alertas = [], reconocidas = {}, sel = -1;

/* ── armar la grilla ── */
const FILAS = [
  { k: 'spo2', n: 'Oxygen' },
  { k: 'pa', n: 'Blood pressure' },
  { k: 'temp', n: 'Temperature' },
  { k: 'fr', n: 'Breathing' },
  { k: 'glucosa', n: 'Blood sugar' },
  { k: 'vfc', n: 'Heart rate variability' },
];
function armar() {
  $('crew').innerHTML = CREW.map((c, i) => `
    <div class="tri" id="tri${i}" data-i="${i}">
      <div class="persona"><div class="av" style="background:${c.col}">${c.ini}</div><div><b>${c.nombre}</b><span>${c.rol}</span></div><span class="tag">${c.id}</span></div>
      <div class="anillo"><svg id="ani${i}" viewBox="0 0 196 196"></svg><div class="c"><b id="fc${i}">—</b><span id="fcl${i}">heart · bpm</span></div></div>
      <div class="ritmo"><div class="f"><span>Heart rhythm</span><em id="rit${i}">waiting</em></div><svg id="tz${i}" viewBox="0 0 320 40" preserveAspectRatio="none"></svg></div>
      ${FILAS.map(f => `<div class="fil sin" id="f${f.k}${i}"><span class="n">${f.n}<small id="e${f.k}${i}"></small></span><b id="v${f.k}${i}">—</b></div>`).join('')}
      <div class="hist"><div class="f">Heart, last 2 min<span id="hr${i}"></span></div><svg id="hs${i}" viewBox="0 0 320 46" preserveAspectRatio="none"></svg></div>
      <div class="movil" id="mv${i}"><div class="f"><span>From ${c.corto}'s Nova app</span><em id="mve${i}">not linked</em></div>
        <div class="mvg"><div><small>Sleep</small><b id="mvs${i}">—</b></div><div><small>Mood</small><b id="mva${i}">—</b></div><div><small>Energy</small><b id="mvn${i}">—</b></div><div><small>Steps</small><b id="mvp${i}">—</b></div></div></div>
      <div class="est sin" id="est${i}"><i></i><span>Waiting for sensors</span></div>
    </div>`).join('');
  CREW.forEach((c, i) => $('tri' + i).addEventListener('click', () => abrirVitals(i)));
}

/* ── pintar un tripulante ── */
function problemas(tr) {
  const p = [];
  for (const k of [...VITALES, ...DIARIOS]) {
    const n = tr.niveles[k];
    if (n === 'atencion' || n === 'aviso_tierra') p.push({ k, n, v: tr[k], alto: tr[k] > MEDIO[k] });
  }
  // la presión cuenta una sola vez
  const sis = p.find(x => x.k === 'pa_sis'), dia = p.find(x => x.k === 'pa_dia');
  if (sis && dia) p.splice(p.indexOf(dia), 1);
  return p.sort((a, b) => RANGO[b.n] - RANGO[a.n]);
}
const etiqueta = x => {
  const t = { pulso: ['Slow heart rate', 'Fast heart rate'], spo2: ['Low oxygen', 'Low oxygen'], pa_sis: ['Low blood pressure', 'High blood pressure'], pa_dia: ['Low blood pressure', 'High blood pressure'],
    temp: ['Low temperature', 'Fever'], fr: ['Slow breathing', 'Fast breathing'], glucosa: ['Low blood sugar', 'High blood sugar'],
    sueno_h: ['Short sleep', 'Short sleep'], animo: ['Low mood', 'Low mood'], energia: ['Low energy', 'Low energy'] }[x.k];
  return t ? t[x.alto ? 1 : 0] : NOMBRE[x.k];
};

function pintarTripulante(i, tr) {
  const tiene = k => tr.edades[k] > 0;
  const nivel = tr.nivel;
  const el = $('tri' + i);
  el.classList.toggle('lv-atencion', nivel === 'atencion');
  el.classList.toggle('lv-aviso_tierra', nivel === 'aviso_tierra');

  // pulso y anillo
  const conDato = VITALES.filter(tiene);
  const enRango = conDato.filter(k => RANGO[tr.niveles[k]] <= RANGO.esperado_vuelo).length;
  $('ani' + i).innerHTML = anilloArco(98, 98, 90, conDato.length ? enRango / conDato.length : 0, COL[nivel === 'normal' ? 'normal' : nivel], 8);
  const fcEl = $('fc' + i);
  fcEl.textContent = tiene('pulso') ? fmt('pulso', tr.pulso) : '—';
  fcEl.className = tiene('pulso') ? 'lv-' + tr.niveles.pulso : '';
  $('fcl' + i).textContent = conDato.length ? `bpm · ${enRango} of ${conDato.length} in range` : 'heart · bpm';
  $('rit' + i).textContent = tiene('pulso') ? (tr.edades.pulso <= 3 ? 'live' : hace(tr.edades.pulso)) : 'waiting';

  // filas
  for (const f of FILAS) {
    const fila = $('f' + f.k + i), v = $('v' + f.k + i), e = $('e' + f.k + i);
    let n, html, edad;
    if (f.k === 'pa') {
      n = peor(tr.niveles.pa_sis, tr.niveles.pa_dia); edad = tr.edades.pa_sis;
      html = tiene('pa_sis') ? `${fmt('pa_sis', tr.pa_sis)}/${fmt('pa_dia', tr.pa_dia)}<span class="u">mmHg</span>` : '—';
    } else {
      n = tr.niveles[f.k]; edad = tr.edades[f.k];
      html = tiene(f.k) ? `${fmt(f.k, tr[f.k])}<span class="u">${UNIDAD[f.k]}</span>` : '—';
    }
    v.innerHTML = html;
    fila.className = 'fil ' + (edad > 0 ? 'lv-' + n : 'sin');
    e.textContent = edad > 30 && ['pa', 'glucosa', 'temp', 'vfc'].includes(f.k) ? hace(edad) : '';
  }

  // historia del pulso
  if (tiene('pulso')) { histFc[i].push(tr.pulso); if (histFc[i].length > 120) histFc[i].shift(); }
  const h = histFc[i];
  serie($('hs' + i), 320, 46, h, { col: COL[tr.niveles.pulso] || COL.normal });
  $('hr' + i).textContent = h.length > 2 ? `${Math.round(Math.min(...h))}–${Math.round(Math.max(...h))} bpm` : '';

  // datos de la app NOVA del teléfono
  const DIA = ['sueno_h', 'animo', 'energia', 'pasos'], ANIMO = ['', 'Low', 'Down', 'Okay', 'Good', 'Great'];
  const enlazado = DIA.some(tiene);
  $('mve' + i).textContent = enlazado ? 'linked' : 'not linked';
  $('mv' + i).classList.toggle('on', enlazado);
  const pon = (id, k, txt) => { const e = $(id); e.innerHTML = tiene(k) ? txt : '—'; e.className = tiene(k) ? 'lv-' + tr.niveles[k] : ''; };
  pon('mvs' + i, 'sueno_h', `${Math.floor(tr.sueno_h)}h ${String(Math.round((tr.sueno_h % 1) * 60)).padStart(2, '0')}m`);
  pon('mva' + i, 'animo', ANIMO[Math.round(tr.animo)] || '—');
  pon('mvn' + i, 'energia', `${Math.round(tr.energia)}<span class="u">/5</span>`);
  pon('mvp' + i, 'pasos', Math.round(tr.pasos).toLocaleString('en-US'));

  // estado
  const est = $('est' + i), p = problemas(tr);
  est.className = 'est ' + (conDato.length ? 'lv-' + nivel : 'sin');
  est.lastElementChild.textContent = !conDato.length ? 'Waiting for sensors'
    : nivel === 'aviso_tierra' ? `${etiqueta(p[0])} · tell flight surgeon`
    : nivel === 'atencion' ? `${etiqueta(p[0])} · keep an eye`
    : 'All in range';
}

/* ── NOVA: tarjetas de atención a partir del estado (reglas fijas) ── */
const PROTO = 'Onboard protocol v0.1 · demo, pending flight surgeon review';
const luzTxt = () => !mision ? 'Goes to the flight surgeon in tonight\'s report'
  : mision.conjuncion ? 'Solar conjunction: no Earth link. Nova keeps the record for later'
  : `Goes to the flight surgeon in tonight's report · ${(mision.luz_seg / 60).toFixed(1)} min one way`;
function tarjetas(m) {
  const out = [];
  m.trip.forEach((tr, i) => {
    const c = CREW[i], p = problemas(tr);
    if (!p.length) return;
    const n = tr.nivel, tipo = n === 'aviso_tierra' ? 'al' : 'at';
    const bajo = k => p.some(x => x.k === k && !x.alto), alto = k => p.some(x => x.k === k && x.alto);
    const cerrar = `<button data-ack="${c.id}">Acknowledge</button>`;
    if (bajo('pulso') && (bajo('pa_sis') || bajo('pa_dia'))) {
      out.push({ n, clave: c.id + ':desmayo', html: `<div class="ins ${tipo}"><div class="q"><i style="background:${COL[n]}"></i>${c.corto} may be fainting</div>
        <p>${c.ella === 'her' ? 'Her' : 'His'} heart rate fell to <b>${fmt('pulso', tr.pulso)} bpm</b> and blood pressure to <b>${fmt('pa_sis', tr.pa_sis)}/${fmt('pa_dia', tr.pa_dia)}</b>. Go to ${c.corto} now.</p>
        <div class="pasos"><div><span>1</span>Call ${c.ella} name and tap ${c.ella} shoulder. Does ${c.ella === 'her' ? 'she' : 'he'} respond?</div><div><span>2</span>Check ${c.ella === 'her' ? 'she' : 'he'} is breathing. Oxygen reads ${fmt('spo2', tr.spo2)}%.</div><div><span>3</span>Keep ${c.ella === 'her' ? 'her' : 'him'} secured and still. Loosen anything tight.</div><div><span>4</span>Measure blood pressure again in 2 minutes.</div></div>
        <div class="conf"><span>${luzTxt()}</span></div><div class="conf" style="margin-top:0;border:0;padding-top:4px"><span>${PROTO}</span></div>
        <div class="acc"><button class="pri" data-guia="desmayo" data-gi="${i}">Start guide</button><button data-reg="${i}" data-s="pa">Log blood pressure</button>${cerrar}</div></div>` });
      return;
    }
    const x = p[0];
    let titulo = `${c.corto}: ${etiqueta(x).toLowerCase()}`, texto = '', pasos = [], reg = x.k === 'pa_dia' ? 'pa' : x.k === 'pa_sis' ? 'pa' : x.k, fuente = PROTO, guiaId = null;
    if (x.k === 'glucosa' && !x.alto) {
      titulo = `${c.corto}'s blood sugar is low`;
      texto = `<b>${fmt('glucosa', tr.glucosa)} mg/dL</b>, and ${c.ella} heart rate is up to ${fmt('pulso', tr.pulso)} bpm. Treat it now, before it gets worse.`;
      pasos = ['Give 15 g of fast sugar: a juice pouch or glucose gel.', 'Measure again in 15 minutes.', 'If it is still under 70 mg/dL, repeat.'];
      fuente = '15-15 rule for low blood sugar (ADA) · ' + PROTO; guiaId = 'hipoglucemia';
    } else if (x.k === 'temp' && x.alto) {
      titulo = `${c.corto} has a fever`;
      texto = `<b>${fmt('temp', tr.temp)} °C</b>. A fever in a closed cabin also matters for the rest of the crew.`;
      pasos = ['Rest, fluids, and keep the others at a distance for now.', 'Measure again in 30 minutes.', 'Tell the flight surgeon if it reaches 39.5 °C.']; guiaId = 'fiebre';
    } else if (x.k === 'spo2') {
      titulo = `${c.corto}'s oxygen is low`;
      texto = `<b>${fmt('spo2', tr.spo2)}%</b> with breathing at ${fmt('fr', tr.fr)}/min. Cabin oxygen is ${m.cabina.o2 ? m.cabina.o2.toFixed(1) + '%' : 'not reporting'}.`;
      pasos = ['Check the finger sensor is on properly and the hand is still.', 'Have ' + c.corto + ' sit still and breathe slowly for one minute.', 'If it stays under 90%, start oxygen per the medical checklist.']; guiaId = 'oxigeno_bajo';
    } else if (x.k === 'sueno_h' || x.k === 'animo' || x.k === 'energia') {
      const corto = tr.sueno_h > 0 && tr.niveles.sueno_h !== 'normal';
      titulo = x.k === 'sueno_h' ? `${c.corto} slept ${tr.sueno_h.toFixed(1)} h` : `${c.corto} is running low`;
      texto = x.k === 'sueno_h' ? `Short nights add up: reaction time and mood follow. ${c.corto} shared this from the Nova app.`
        : `${c.corto}'s check-in says ${x.k === 'animo' ? 'mood' : 'energy'} is ${Math.round(tr[x.k])} of 5${corto ? `, after ${tr.sueno_h.toFixed(1)} h of sleep` : ''}. Shared by ${c.ella === 'her' ? 'her' : 'him'} from the Nova app.`;
      pasos = [x.k === 'sueno_h' ? 'Protect tonight: dim, warm light in the quarters from 21:30.' : 'Check in with ' + c.corto + ' in person, privately.', 'Move demanding tasks (spacewalk prep, piloting) to later if possible.'];
      fuente = 'Same rules as the Nova app check-in · shared with consent';
      reg = null;
    } else {
      texto = `${NOMBRE[x.k][0].toUpperCase() + NOMBRE[x.k].slice(1)} is <b>${fmt(x.k, tr[x.k])} ${UNIDAD[x.k]}</b>, outside the limits set for this mission.`;
      pasos = ['Measure again to confirm.', x.n === 'aviso_tierra' ? 'If it is confirmed, tell the flight surgeon.' : 'Keep an eye on it for the next hour.'];
    }
    out.push({ n, clave: c.id + ':' + x.k, html: `<div class="ins ${tipo}"><div class="q"><i style="background:${COL[n]}"></i>${titulo}</div><p>${texto}</p>
      <div class="pasos">${pasos.map((s, j) => `<div><span>${j + 1}</span>${s}</div>`).join('')}</div>
      <div class="conf"><span>${fuente}</span></div>
      <div class="acc">${guiaId ? `<button class="pri" data-guia="${guiaId}" data-gi="${i}">Start guide</button>` : ''}${reg ? `<button class="${guiaId ? '' : 'pri'}" data-reg="${i}" data-s="${reg}">Log ${NOMBRE[reg === 'pa' ? 'pa_sis' : reg]}</button>` : ''}${guiaId ? '' : cerrar}</div></div>` });
  });
  if (m.cabina.nivel_co2 === 'atencion' || m.cabina.nivel_co2 === 'aviso_tierra') {
    const n = m.cabina.nivel_co2;
    out.push({ n, clave: 'CABINA:co2', html: `<div class="ins ${n === 'aviso_tierra' ? 'al' : 'at'}"><div class="q"><i style="background:${COL[n]}"></i>Cabin CO₂ is rising</div>
      <p><b>${fmt('co2_cabina', m.cabina.co2)} ppm</b>, above the limit set for this mission. It can cause headaches and slower thinking for everyone.</p>
      <div class="pasos"><div><span>1</span>Check the CO₂ scrubber status.</div><div><span>2</span>Ask the crew about headaches or trouble focusing.</div></div>
      <div class="conf"><span>Cabin limits · NASA-STD-3001 (values pending review)</span></div><div class="acc"><button data-ack="CABINA">Acknowledge</button></div></div>` });
  }
  return out.sort((a, b) => RANGO[b.n] - RANGO[a.n]);
}

let firmaTarjetas = '';
function pintarNova(m) {
  const ahora = Date.now() / 1000;
  const deVista = t => vista !== 'vitals' || t.clave.startsWith(CREW[vT].id + ':');
  const vis = tarjetas(m).filter(deVista).filter(t => !CREW.some(c => c.vacio && t.clave.startsWith(c.id + ':'))).filter(t => !(reconocidas[t.clave] && reconocidas[t.clave].n === t.n && ahora - reconocidas[t.clave].t < 120));
  const firma = vis.map(t => t.clave + t.n).join('|') + '|' + vis.map(t => t.html.length).join(',');
  if (firma !== firmaTarjetas) {   // solo se redibuja si cambió algo, así no parpadea
    firmaTarjetas = firma;
    $('atencion').innerHTML = vis.map(t => t.html).join('');
  } else {
    // actualizar cifras sin animar de nuevo
    const tmp = document.createElement('div'); tmp.innerHTML = vis.map(t => t.html).join('');
    $('atencion').querySelectorAll('.ins').forEach((e, j) => { const n = tmp.children[j]; if (n && e.innerHTML !== n.innerHTML) e.innerHTML = n.innerHTML; });
  }
  $('secAtencion').hidden = !vis.length;
  $('nAtencion').textContent = vis.length > 1 ? `${vis.length}` : '';
  const enUso = m.trip.filter((t, i) => !CREW[i]?.vacio); // con tripulación real, solo los asientos ocupados
  const peorNivel = peor(...enUso.map(t => t.nivel), m.cabina.nivel_co2 || 'sin_dato');
  const conDatos = enUso.filter(t => VITALES.some(k => t.edades[k] > 0)).length;
  const senales = enUso.reduce((a, t) => a + VITALES.filter(k => t.edades[k] > 0).length, 0) + (m.cabina.co2 > 0 ? 3 : 0);
  const urgente = m.trip.findIndex(t => t.nivel === 'aviso_tierra');
  if (vista === 'crew') $('novaDice').textContent = !conDatos ? "Connecting to the crew's sensors."
    : urgente >= 0 ? `${CREW[urgente].corto} needs help now. Here's what to do.`
    : peorNivel === 'atencion' ? `Watching ${conDatos} crew members and ${senales} signals. Something needs a look.`
    : `Watching ${conDatos} crew members and ${senales} signals. Everyone is in range.`;
  estadoNova = urgente >= 0 ? 'urgente' : peorNivel === 'atencion' ? 'atento' : 'bien';
  $('badgeCrew').hidden = estadoNova === 'bien';
}

function pintarUltimas() {
  if (vista !== 'crew') return;
  // ni asientos vacíos ni alertas de antes de que la persona real ocupara su asiento (eran de la tripulación de demostración)
  const deEsta = a => { const c = a.trip && CREW[a.trip - 1]; if (!c) return true; if (c.vacio) return false; const t = a.t < 1e12 ? a.t * 1000 : a.t; return !(c.real && c.desde && t < c.desde); };
  const l = alertas.filter(deEsta).slice(-7).reverse();
  $('ultimas').innerHTML = l.length ? l.map(a => {
    const c = a.trip ? CREW[a.trip - 1].corto : 'Cabin', u = UNIDAD[a.sensor] || '';
    const txt = a.nivel === 'normal' ? `${NOMBRE[a.sensor]} back in range` : `${NOMBRE[a.sensor]} ${fmt(a.sensor, a.valor)} ${u}${a.nivel === 'aviso_tierra' ? ' · tell flight surgeon' : ''}`;
    return `<div><i style="background:${a.nivel === 'normal' ? 'var(--ok)' : COL[a.nivel]}"></i><span><b>${c}</b> ${txt}</span><time>${hora(a.t)}</time></div>`;
  }).join('') : `<div><i style="background:var(--ok)"></i><span><b>No alerts</b> since the onboard core started</span></div>`;
}

/* ── vistas ── */
function cambiarVista(v) {
  vista = v;
  $('crew').hidden = v !== 'crew';
  $('vitals').hidden = v !== 'vitals';
  $('biblioteca').hidden = v !== 'biblioteca';
  $('sistemas').hidden = v !== 'sistemas';
  $('gem').hidden = v !== 'gemelo';
  $('mente').hidden = v !== 'mente';
  $('kit').hidden = v !== 'kit';
  $('scan').hidden = v !== 'escaner';
  $('hardware').hidden = v !== 'hardware';
  $('panorama').hidden = v !== 'panorama';
  $('radiacion').hidden = v !== 'radiacion';
  if (v === 'radiacion' && window.abrirRadiacion) window.abrirRadiacion();
  if (v === 'panorama' && window.abrirPanorama) window.abrirPanorama();
  if (v === 'hardware' && window.abrirHardware) window.abrirHardware();
  if (v === 'sistemas') abrirSistemas();
  if (v === 'biblioteca') abrirBiblioteca();
  document.querySelectorAll('.ico[data-vista]').forEach(b => b.classList.toggle('on', b.dataset.vista === v));
  $('titulo').textContent = { crew: 'Crew', vitals: 'Vitals', biblioteca: 'Medical library', sistemas: 'Onboard systems', gemelo: 'Body twin', mente: 'Mind', kit: 'Medical kit', escaner: 'Live body scan', hardware: 'NOVA Station hardware', panorama: 'Mission', radiacion: 'Radiation' }[v];
  document.querySelector('#ultimas').previousElementSibling.firstElementChild.textContent = ({ crew: 'Latest', gemelo: 'Watch closely', mente: 'Patterns I noticed', kit: 'Low or expiring', escaner: 'Latest' })[v] || 'What changed';
  firmaTarjetas = '';
  refrescarNova();
}
function refrescarNova() {
  if (!ultimo) return;
  pintarNova(ultimo);
  if (vista === 'crew') pintarUltimas(); else if (vista === 'gemelo') novaGemelo(); else if (vista === 'mente') novaMente(); else if (vista === 'kit') novaKit(); else pintarNovaVitals();
}

/* ── misión: día, distancia y retraso de la luz calculados a bordo (transferencia de Hohmann real) ── */
async function pedirMision() {
  try { mision = await (await fetch(BASE + '/v1/mision')).json(); } catch { return; }
  const fase = { cruise: 'cruise to Mars', mars: 'on Mars', return: 'return to Earth' }[mision.fase] || mision.fase;
  $('mision').textContent = `Day ${mision.dia} · ${fase}` + (mision.fase === 'cruise' ? ` · Mars in ${mision.llegada_en_dias} d` : '');
  const min = mision.luz_seg / 60;
  if (mision.conjuncion) {
    $('pilLuz').className = 'pil al'; $('txtLuzL').textContent = 'Solar conjunction'; $('txtLuz').textContent = ''; $('txtLuzR').textContent = 'no Earth link';
  } else {
    $('pilLuz').className = 'pil'; $('txtLuzL').textContent = 'Earth'; $('txtLuz').textContent = `${min.toFixed(1)} light-min`;
    $('txtLuzR').textContent = `· ${Math.round(mision.distancia_km / 1e6)}M km`;
  }
}

/* ── barra de estado ── */
function pintarBarra(m) {
  const co2 = m.cabina.co2, nc = m.cabina.nivel_co2;
  $('txtCo2').textContent = co2 > 0 ? `${fmt('co2_cabina', co2)} ppm` : '—';
  $('pilCabina').className = 'pil ' + (nc === 'aviso_tierra' ? 'al' : nc === 'atencion' ? 'at' : co2 > 0 ? '' : 'off');
  const viva = m.trip.some(t => t.edades.pulso > 0 && t.edades.pulso <= 4);
  $('txtEstacion').textContent = viva ? 'live' : 'no data';
  $('pilEstacion').className = 'pil ' + (viva ? '' : 'off');
}

/* ── flujo en vivo ── */
function conectar() {
  const es = new EventSource(BASE + '/v1/flujo');
  es.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.tipo === 'tripulacion') { cargarTripulacion(); return; }
    if (m.tipo === 'estado') {
      ultimo = m; recibido = Date.now();
      m.trip.forEach((tr, i) => pintarTripulante(i, tr));
      pintarNova(m); pintarBarra(m);
      if (typeof vigilarEmergencia === 'function') vigilarEmergencia(m);
      if (vista === 'vitals') pintarVitals();
      if (vista === 'gemelo') pintarGemelo();
      if (vista === 'mente') pintarMente();
    } else if (m.tipo === 'kit') {
      if (vista === 'kit') pedirKit().then(() => { pintarKit(); novaKit(); });
    } else if (m.tipo === 'sistema' || m.tipo === 'subida') {
      if (vista === 'sistemas' && typeof abrirSistemas === 'function') abrirSistemas();
    } else if (m.tipo === 'alerta') {
      alertas.push(m); if (alertas.length > 60) alertas.shift();
      pintarUltimas();
    }
  };
}

/* ── animación: NOVA y ritmos ── */
let estadoNova = 'inicio', tAnt = performance.now(), radNova = 0;   // radNova: tormenta solar → NOVA ámbar e inquieta, de a poco
function cuadro(ahora) {
  const dt = Math.min(.1, (ahora - tAnt) / 1000); tAnt = ahora;
  const t = ahora / 1000;
  radNova += ((window.RAD?.d?.spe?.activa ? 1 : 0) - radNova) * Math.min(1, dt * 1.6);
  const inquieta = radNova > .5, miraRad = inquieta && (t % 4.6) < .8 ? [-.9, -.15] : null;   // de vez en cuando mira hacia el Sol
  const expr = inquieta ? 'inquieta' : estadoNova === 'urgente' ? 'sorprendida' : estadoNova === 'atento' ? 'pensativa' : 'normal';
  const nv = medirVoz(), habla = hablandoVoz() ? Math.min(1, nv * 1.6) : 0;
  if (typeof enVoz !== 'undefined' && enVoz) {
    // modo voz: NOVA al centro con su órbita; escucha mirando hacia ti, piensa, o habla con la luz de su voz
    const piensa = faseVoz === 'pensando' || faseVoz === 'transcribiendo';
    $('novaP').innerHTML = orbitaVoz(150, 110, t) + mascotaOrbes({ x: 150, y: 110, R: 62, t, expr: inquieta ? 'inquieta' : piensa ? 'pensativa' : habla ? 'feliz' : 'normal', orbes: 5, mira: miraRad || (habla ? [-.3, .1] : [0, .3]), parpadeo: (t % 3.7) < .13 ? 1 : 0, habla: luzVoz(), radiacion: radNova });
  } else
  $('novaP').innerHTML = mascotaOrbes({ x: 150, y: 110, R: 62, t, expr: habla && !inquieta ? 'feliz' : expr, orbes: 6, mira: miraRad || [-.5, .1], parpadeo: (t % 3.7) < .13 ? 1 : 0, alerta: estadoNova === 'urgente' && !inquieta ? 1 : 0, habla, radiacion: radNova });
  $('marca').innerHTML = `<svg viewBox="0 0 52 52">${mascotaOrbes({ x: 26, y: 27, R: 15, t, expr: inquieta ? 'inquieta' : 'normal', orbes: 0, sinHalo: true, fluido: .6, alerta: estadoNova === 'urgente' && !inquieta ? 1 : 0, radiacion: radNova })}</svg>`;
  const vivo = recibido && Date.now() - recibido < 3500;
  $('vivo').className = 'vivo' + (vivo ? '' : ' off');
  $('vivo').lastElementChild.textContent = vivo ? 'Live from the onboard core' : ultimo ? 'No signal from the core' : 'Waiting for the core';
  if (ultimo) ultimo.trip.forEach((tr, i) => {
    if (tr.edades.pulso > 0 && tr.edades.pulso <= 6) {
      fase[i] += dt * tr.pulso / 60;
      trazaViva($('tz' + i), 320, 40, fase[i], { col: COL[tr.niveles.pulso] || COL.normal, ancho: 2.6 });
    } else if ($('tz' + i).innerHTML) $('tz' + i).innerHTML = '';
  });
  $('hora').textContent = new Date().toTimeString().slice(0, 5);
  // modo emergencia: ritmo grande de la persona y NOVA hablando mientras lee el paso
  if (typeof guia !== 'undefined' && guia && ultimo) {
    const tr = ultimo.trip[guia.i];
    if (tr.edades.pulso > 0 && tr.edades.pulso <= 6) trazaViva($('emTraza'), 420, 70, fase[guia.i], { col: COL[tr.niveles.pulso] || COL.normal, ancho: 3.2, grosor: 2.2 });
    const lee = hablandoVoz();
    $('emNova').innerHTML = mascotaOrbes({ x: 60, y: 52, R: 30, t, expr: lee ? 'feliz' : 'pensativa', orbes: 4, alerta: pasoActual() && pasoActual().grave ? 1 : 0, habla: lee ? Math.min(1, nivelVoz * 1.6) : 0, parpadeo: (t % 3.7) < .13 ? 1 : 0 });
  }
  requestAnimationFrame(cuadro);
}

/* ── registrar una medición (teclado / clics) ── */
const REG = {
  pa: { n: 'Blood pressure', u: 'mmHg', dos: true, r: [[50, 250], [30, 150]], como: '<b>Sit still for 5 minutes</b> with the arm supported at heart level. In microgravity, strap the arm to the restraint so the cuff stays at heart height.' },
  glucosa: { n: 'Blood sugar', u: 'mg/dL', r: [[20, 600]], como: '<b>Clean the fingertip</b> and use the second drop of blood. Note if you ate in the last 2 hours.' },
  temp: { n: 'Temperature', u: '°C', r: [[30, 43]], dec: true, como: '<b>Under the tongue</b>, mouth closed, for one minute. Wait 15 minutes after eating or drinking.' },
  spo2: { n: 'Oxygen', u: '%', r: [[50, 100]], como: '<b>Warm, still finger.</b> Wait until the number holds steady for 10 seconds.' },
  pulso: { n: 'Heart rate', u: 'bpm', r: [[20, 250]], como: '<b>Count the beats</b> at the wrist for 30 seconds and double it, or read it from the chest strap.' },
  fr: { n: 'Breathing', u: '/min', r: [[4, 60]], como: '<b>Count breaths for 30 seconds</b> without telling the person, then double it.' },
};
let regT = 0, regS = 'pa';
function abrirRegistro(i = 0, s = 'pa') {
  regT = i; regS = REG[s] ? s : 'pa';
  $('quien').innerHTML = CREW.map((c, j) => `<button data-q="${j}" class="${j === regT ? 'on' : ''}"><div class="av" style="background:${c.col}">${c.ini}</div><b>${c.corto}</b></button>`).join('');
  $('chips').innerHTML = Object.entries(REG).map(([k, d]) => `<button data-c="${k}" class="${k === regS ? 'on' : ''}">${d.n}</button>`).join('');
  pintarValor();
  $('msgReg').classList.remove('on');
  $('velo').classList.add('on');
  setTimeout(() => { const e = $('valor').querySelector('input'); if (e) e.focus(); }, 60);
}
function pintarValor() {
  const d = REG[regS];
  $('valor').innerHTML = d.dos
    ? `<input id="in0" inputmode="numeric" placeholder="120"><span class="sep">/</span><input id="in1" inputmode="numeric" placeholder="80"><span class="un">${d.u}</span>`
    : `<input id="in0" inputmode="decimal" placeholder="${d.dec ? '36.8' : '—'}"><span class="un">${d.u}</span>`;
  $('como').innerHTML = d.como;
}
async function guardar() {
  const d = REG[regS], vals = [$('in0'), $('in1')].filter(Boolean).map(e => parseFloat(e.value.replace(',', '.')));
  const malo = vals.some((v, j) => !(v >= d.r[j][0] && v <= d.r[j][1]));
  if (malo || !vals.length) { $('valor').querySelectorAll('input').forEach(e => e.style.borderColor = 'var(--al)'); return; }
  const trip = CREW[regT].id, envios = regS === 'pa' ? [['pa_sis', vals[0]], ['pa_dia', vals[1]]] : [[regS, vals[0]]];
  try {
    for (const [sensor, valor] of envios) await fetch(BASE + '/v1/ingreso', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trip, sensor, valor }) });
    $('msgReg').classList.add('on');
    setTimeout(() => $('velo').classList.remove('on'), 900);
  } catch { $('msgReg').textContent = 'The onboard link is not answering.'; $('msgReg').classList.add('on'); }
}

/* ── eventos ── */
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.reg) abrirRegistro(+b.dataset.reg, b.dataset.s);
  else if (b.dataset.ack) { for (const t of tarjetas(ultimo)) if (t.clave.startsWith(b.dataset.ack)) reconocidas[t.clave] = { n: t.n, t: Date.now() / 1000 }; firmaTarjetas = ''; pintarNova(ultimo); }
  else if (b.dataset.q) { regT = +b.dataset.q; document.querySelectorAll('#quien button').forEach((x, j) => x.classList.toggle('on', j === regT)); }
  else if (b.dataset.c) { regS = b.dataset.c; document.querySelectorAll('#chips button').forEach(x => x.classList.toggle('on', x.dataset.c === regS)); pintarValor(); }
  else if (b.dataset.vista) { if (b.dataset.vista === 'vitals') abrirVitals(vT); else if (b.dataset.vista === 'gemelo') abrirGemelo(); else if (b.dataset.vista === 'mente') abrirMente(); else if (b.dataset.vista === 'kit') abrirKit(); else cambiarVista(b.dataset.vista); }
  else if (b.dataset.e) fetch(BASE + '/v1/escenario', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ escenario: b.dataset.e, trip: b.dataset.t }) });
});
$('btnReg').addEventListener('click', () => abrirRegistro(vista === 'vitals' ? vT : 0, 'pa'));
$('btnCancelar').addEventListener('click', () => $('velo').classList.remove('on'));
$('btnGuardar').addEventListener('click', guardar);
$('velo').addEventListener('click', e => { if (e.target === $('velo')) $('velo').classList.remove('on'); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') $('velo').classList.remove('on');
  else if (e.key === 'Enter' && $('velo').classList.contains('on')) guardar();
  else if ((e.key === 'd' || e.key === 'D') && !$('velo').classList.contains('on') && document.activeElement.tagName !== 'INPUT') $('demo').classList.toggle('on');
});

/* ── escala: ver escala.js (la escena llena la ventana a cualquier proporción) ── */
function ajustar() { window.ajustarEscena && window.ajustarEscena(); }

// la tripulación vive en la nave: quien vincula su teléfono a un asiento aparece con su nombre (y se actualiza sola)
// con tripulación real, los asientos vacíos se esconden en todas las vistas (tarjetas, pestañas, gemelo, Mind, kit,
// registro); los índices no cambian, así cada asiento sigue amarrado a sus datos
function ocultarVacios() {
  const v = CREW.map((c, i) => c.vacio ? i : -1).filter(i => i >= 0), n = CREW.length - v.length;
  let css = '';
  for (const i of v) {
    css += `#tri${i},[data-q="${i}"],[data-vt="${i}"],[data-mt="${i}"],[data-gt="${i}"],[data-ktrip="${CREW[i].id}"],#vq${i},#mSueno>:nth-child(${i + 1}),#mEnergia>:nth-child(${i + 1}),#mAhora>:nth-child(${i + 1}),#mMapa>:nth-child(${3 * i + 1}),#mMapa>:nth-child(${3 * i + 2}),#mMapa>:nth-child(${3 * i + 3}){display:none!important}`;
  }
  if (v.length) css += `.crew{grid-template-columns:repeat(${n},minmax(0,1fr))!important}`;
  let e = document.getElementById('estiloVacios'); if (!e) { e = document.createElement('style'); e.id = 'estiloVacios'; document.head.appendChild(e); }
  e.textContent = css;
}
function cargarTripulacion() { fetch(BASE + '/tripulacion.json', { cache: 'no-store' }).then(r => r.json()).then(l => { l.forEach((p, i) => { if (CREW[i]) { delete CREW[i].vacio; delete CREW[i].real; Object.assign(CREW[i], p, { ella: (p.pronombre || '').startsWith('she') ? 'her' : (p.pronombre || '').startsWith('he') ? 'his' : 'their' }); } }); ocultarVacios(); armar(); armarVitals(); pintarUltimas(); if (ultimo) { pintarNova(ultimo); }
    const real = CREW.some(c => c.real); if ($('pieDemo')) $('pieDemo').textContent = real ? `Crew linked from their NOVA app · what their phones do not measure is simulated (PhysioNet BIDMC, ODC-By) · press D for demo scenarios` : 'Fictional crew · heart, oxygen and breathing variability from PhysioNet BIDMC (ODC-By) · press D for demo scenarios'; if (ultimo) { ultimo.trip.forEach((tr, i) => pintarTripulante(i, tr)); } if (typeof pintarGemelo === 'function') pintarGemelo(); }).catch(() => {}); }
cargarTripulacion();
armar(); armarVitals(); ajustar(); pintarUltimas(); conectar(); pedirMision(); setInterval(pedirMision, 30000); requestAnimationFrame(cuadro);
