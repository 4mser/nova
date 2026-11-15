/* Consola de Tierra para el cirujano de vuelo (prototipo servido por el enlace; en una misión real corre en Tierra y
   habla con la nave por la red de espacio profundo). Lee lo que baja de la nave y sube comandos reales de F Prime
   (parámetros del monitor de salud) que viajan con el retraso de la luz, más los mensajes de las familias. */
'use strict';
const $ = id => document.getElementById(id);
const esc = t => String(t ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const NIVEL = { normal: ['In range', 'ok'], esperado_vuelo: ['Expected in flight', 'ok'], atencion: ['Attention', 'at'], aviso_tierra: ['Needs you', 'al'], sin_dato: ['No data', ''] };
const SENS = { pulso: ['Heart rate', 'bpm', 0], spo2: ['Oxygen', '%', 0], pa_sis: ['Systolic BP', 'mmHg', 0], pa_dia: ['Diastolic BP', 'mmHg', 0], temp: ['Temperature', '°C', 1], fr: ['Breathing', '/min', 0], glucosa: ['Blood sugar', 'mg/dL', 0], vfc: ['HRV', 'ms', 0], sueno_h: ['Sleep', 'h', 1], animo: ['Mood', '/5', 1], energia: ['Energy', '/5', 1], co2_cabina: ['Cabin CO₂', 'ppm', 0] };
const PROTO = { paro_cardiaco: 'Cardiac arrest', desmayo: 'Fainting', hipoglucemia: 'Low blood sugar', fiebre: 'Fever', oxigeno_bajo: 'Low oxygen', anafilaxia: 'Anaphylaxis', atragantamiento: 'Choking', hemorragia: 'Severe bleeding', convulsion: 'Seizure', descompresion: 'Decompression sickness' };
/* parámetros del monitor de salud (nombres reales de F Prime) por indicador: [etiqueta, índice en umbrales [aA,aT,bA,bT], parámetro] */
const PARAMS = {
  pulso: [['Attention, high', 0, 'PULSO_ALTO_ATENCION'], ['Tell Earth, high', 1, 'PULSO_ALTO_TIERRA'], ['Attention, low', 2, 'PULSO_BAJO_ATENCION'], ['Tell Earth, low', 3, 'PULSO_BAJO_TIERRA']],
  spo2: [['Attention, low', 2, 'SPO2_ATENCION'], ['Tell Earth, low', 3, 'SPO2_TIERRA']],
  pa_sis: [['Attention, high', 0, 'PA_SIS_ALTA_ATENCION'], ['Tell Earth, high', 1, 'PA_SIS_ALTA_TIERRA'], ['Attention, low', 2, 'PA_SIS_BAJA_ATENCION'], ['Tell Earth, low', 3, 'PA_SIS_BAJA_TIERRA']],
  pa_dia: [['Attention, high', 0, 'PA_DIA_ALTA_ATENCION'], ['Tell Earth, high', 1, 'PA_DIA_ALTA_TIERRA']],
  temp: [['Attention, high', 0, 'TEMP_ALTA_ATENCION'], ['Tell Earth, high', 1, 'TEMP_ALTA_TIERRA'], ['Attention, low', 2, 'TEMP_BAJA_ATENCION'], ['Tell Earth, low', 3, 'TEMP_BAJA_TIERRA']],
  fr: [['Attention, high', 0, 'FR_ALTA_ATENCION'], ['Tell Earth, high', 1, 'FR_ALTA_TIERRA'], ['Attention, low', 2, 'FR_BAJA_ATENCION'], ['Tell Earth, low', 3, 'FR_BAJA_TIERRA']],
  glucosa: [['Attention, high', 0, 'GLUCOSA_ALTA_ATENCION'], ['Tell Earth, high', 1, 'GLUCOSA_ALTA_TIERRA'], ['Attention, low', 2, 'GLUCOSA_BAJA_ATENCION'], ['Tell Earth, low', 3, 'GLUCOSA_BAJA_TIERRA']],
  sueno_h: [['Attention, low', 2, 'SUENO_ATENCION'], ['Tell Earth, low', 3, 'SUENO_TIERRA']],
  co2_cabina: [['Attention', 0, 'CO2_ATENCION'], ['Tell Earth', 1, 'CO2_TIERRA']],
};

let estado = null, mision = null, crew = [], sist = null, informe = null, tab = 'informe', ind = 'pulso', para = 0, foto = null, bitac = {};

const hora = t => new Date(t > 1e11 ? t : t * 1000).toTimeString().slice(0, 5);
const hace = t => { const s = Math.max(0, (Date.now() - (t > 1e11 ? t : t * 1000)) / 1000); return s < 60 ? `${Math.round(s)} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
const nombre = i => (crew[i] || {}).corto || `T${i + 1}`;
const j = async r => { const x = await fetch(r); return x.ok ? x.json() : null; };

async function refrescar() {
  // la Tierra ve la nave con el retraso de la luz: el estado que la nave mandó hace ~9,5 min
  let baja;
  [baja, mision, sist] = await Promise.all([j('/v1/tierra/estado'), j('/v1/mision'), j('/v1/sistemas')]).catch(() => [null, mision, sist]);
  if (baja && baja.estado) { estado = baja.estado; estado.parcial = baja.parcial; estado.enviado = baja.enviado; }
  if (!crew.length) crew = (await j('/tripulacion.json').catch(() => null)) || [];
  pintarCabecera(); pintarCrew(); pintarSubida();
  if (!$('tLimites').dataset.listo) pintarLimites();
}
async function refrescarInforme() {
  informe = await j('/v1/tierra/informe').catch(() => null);
  for (const t of ['emergencias', 'privados', 'preguntas']) bitac[t] = informe ? informe[t] : [];
  pintarAlertas();
  // el formulario de «Teach NOVA» no se redibuja mientras se escribe: solo su lista de paquetes
  if (tab === 'aprender' && $('tAprForm')) pintarPaquetes(); else pintarCuerpo();
}

function pintarCabecera() {
  if (mision) {
    $('tDia').innerHTML = `Mission day <b>${mision.dia}</b>`;
    $('tLuz').className = 'pil' + (mision.conjuncion ? ' al' : '');
    $('tLuz').innerHTML = mision.conjuncion ? '<i class="p"></i>Solar conjunction · <b>no link</b>' : `<i class="p"></i>Ship <b>${(mision.luz_seg / 60).toFixed(1)} light-min</b> · ${Math.round(mision.distancia_km / 1e6)}M km`;
  }
  const bajo = estado ? estado.t : 0;
  $('tBajada').className = 'pil' + (!bajo ? ' off' : '');
  $('tBajada').innerHTML = `<i class="p"></i>Downlink <b>${bajo ? hace(estado.enviado || bajo) : '—'}</b>${estado && estado.parcial ? ' · first signal since link start' : ' · light delay'}`;
}

function pintarCrew() {
  if (!estado) { $('tCrew').innerHTML = '<p class="tnota">Nothing has come down from the ship yet.</p>'; return; }
  $('tCrewSub').textContent = `as received ${hace(estado.t)}`;
  $('tCrew').innerHTML = estado.trip.map((tr, i) => {
    const p = crew[i] || {}, [txt, cls] = NIVEL[tr.nivel] || NIVEL.sin_dato;
    const v = k => tr.edades[k] > 0 ? (+tr[k]).toFixed(SENS[k][2]) : '—';
    return `<div class="tc"><div class="av" style="background:${p.col || '#8fe6f5'}">${p.ini || 'T' + (i + 1)}</div>
      <div><b>${esc(p.nombre || 'T' + (i + 1))}</b><span>${esc(p.rol || '')}</span></div><em class="${cls}"><i></i>${txt}</em>
      <div class="v">Heart <b>${v('pulso')}</b> · SpO₂ <b>${v('spo2')}%</b> · BP <b>${tr.edades.pa_sis > 0 ? `${Math.round(tr.pa_sis)}/${Math.round(tr.pa_dia)}` : '—'}</b> · Temp <b>${v('temp')}</b>${tr.edades.sueno_h > 0 ? ` · Sleep <b>${v('sueno_h')} h</b>` : ''}</div></div>`;
  }).join('');
}

function pintarAlertas() {
  const a = (informe && informe.alertas || []).filter(x => x.nivel !== 'normal').slice().reverse();
  $('tNAl').textContent = a.length ? `${a.length}` : '';
  $('tAlertas').innerHTML = a.length ? a.slice(0, 60).map(x => `<div><i style="background:var(--${x.nivel === 'aviso_tierra' ? 'al' : 'at'})"></i><span><b>${x.trip ? esc(nombre(x.trip - 1)) : 'Cabin'}</b> ${esc((SENS[x.sensor] || [x.sensor])[0].toLowerCase())} ${(+x.valor).toFixed(1)}${x.nivel === 'aviso_tierra' ? ' · flagged for you' : ''}</span><time>${hora(x.t)}</time></div>`).join('')
    : '<div><i style="background:var(--ok)"></i><span><b>No alerts</b> in the last 24 hours</span></div>';
}

/* ---------------- centro: informe y bitácoras ---------------- */
function pintarCuerpo() {
  document.querySelectorAll('#tTabs button').forEach(b => b.classList.toggle('on', b.dataset.tt === tab));
  const c = $('tCuerpo');
  if (!informe) { c.innerHTML = '<p class="tnota">The report is not available yet.</p>'; return; }
  if (tab === 'informe') {
    const r = informe, al = r.alertas.filter(x => x.nivel !== 'normal'), tierra = al.filter(x => x.nivel === 'aviso_tierra');
    const em = r.emergencias, pre = r.preguntas, priv = r.privados;
    const resumen = `In the last 24 hours the onboard core raised <b>${al.length} alerts</b> (${tierra.length} flagged for you), the crew opened <b>${em.length} emergency guide${em.length === 1 ? '' : 's'}</b> and asked NOVA <b>${pre.length} question${pre.length === 1 ? '' : 's'}</b>. ${priv.length ? `<b>${priv.length} private summar${priv.length === 1 ? 'y was' : 'ies were'}</b> shared with you.` : 'No private summaries were shared.'}`;
    const filas = r.tripulacion.map((t, i) => {
      const s = t.series, f = (k, d = 0) => s[k] ? `${(+s[k].media).toFixed(d)} <small>(${(+s[k].min).toFixed(d)}–${(+s[k].max).toFixed(d)})</small>` : '<small>—</small>';
      const [txt, cls] = NIVEL[t.nivel_ahora] || NIVEL.sin_dato;
      return `<tr><td><b>${esc(t.nombre)}</b><br><small class="${cls}">${txt}</small></td><td>${f('pulso')}</td><td>${f('spo2')}</td><td>${s.pa_sis ? `${Math.round(s.pa_sis.media)}/${s.pa_dia ? Math.round(s.pa_dia.media) : '—'}` : '<small>—</small>'}</td><td>${f('temp', 1)}</td><td>${f('glucosa')}</td><td>${f('sueno_h', 1)}</td></tr>`;
    }).join('');
    const sub = (r.subida || []), entregados = sub.filter(x => x.estado === 'entregado').length;
    c.innerHTML = `
      <div class="rsec"><h4>Summary<span>generated ${hora(r.generado)} · mission day ${r.mision.dia}${r.luz_seg ? ` · reached Earth ${r.luz_seg < 90 ? r.luz_seg + " s" : Math.round(r.luz_seg / 60) + " min"} later` : ''}</span></h4><p class="rtxt">${resumen}</p></div>
      <div class="rsec"><h4>Crew, last 24 hours<span>mean (min–max) from the onboard record</span></h4>
        <table class="rtab"><tr><th>Crew member</th><th>Heart bpm</th><th>SpO₂ %</th><th>BP mmHg</th><th>Temp °C</th><th>Sugar mg/dL</th><th>Sleep h</th></tr>${filas}</table></div>
      <div class="rsec"><h4>Emergency guides<span>${em.length}</span></h4>${em.length ? em.map(e => `<div class="em ${e.grave ? 'grave' : ''}"><b>${esc(PROTO[e.protocolo] || e.protocolo)} · ${esc(nombre(+String(e.trip).slice(1) - 1))}</b><span>${hora(e.inicio)}–${hora(e.fin)} · ${e.pasos} steps logged${e.desde === 'telefono' ? ' · from a phone' : ''} · last: ${esc(e.ultimo)}</span></div>`).join('') : '<p class="rtxt">None.</p>'}</div>
      <div class="rsec"><h4>From home<span>family relay</span></h4><p class="rtxt">${r.casa.map((x, i) => `${esc(nombre(i))}: <b>${x.llegados}</b> delivered${x.en_camino ? `, ${x.en_camino} on the way` : ''}${x.respuestas ? `, ${x.respuestas} replies` : ''}`).join(' · ')}</p></div>
      <div class="rsec"><h4>Commands sent to the ship<span>${entregados} delivered</span></h4><p class="rtxt">${sub.length ? sub.slice(0, 6).map(x => `${esc(x.nombre.split('.').pop())}${x.argumentos.length ? ' = ' + esc(x.argumentos.join(', ')) : ''} <small>(${esc(x.estado)})</small>`).join(' · ') : 'None in this period.'}</p></div>`;
  } else if (tab === 'emergencias') {
    const lista = informe.emergencias;
    c.innerHTML = lista.length ? lista.map(e => `<div class="em ${e.grave ? 'grave' : ''}"><b>${esc(PROTO[e.protocolo] || e.protocolo)} · ${esc(nombre(+String(e.trip).slice(1) - 1))}</b><span>${hora(e.inicio)}–${hora(e.fin)} · ${e.pasos} steps${e.desde === 'telefono' ? ' · guided from a phone' : ' · guided from the crew display'}</span></div>`).join('') + `<p class="tnota">Each guide’s full step-by-step log is in the onboard record (emergencias-*.ndjson).</p>`
      : '<p class="rtxt">No emergency guides in the last 24 hours.</p>';
  } else if (tab === 'privados') {
    const lista = informe.privados;
    c.innerHTML = lista.length ? lista.map(p => `<div class="em"><b>${esc(nombre(+String(p.trip).slice(1) - 1))} · ${esc(p.tipo === 'ciclo' ? 'Cycle summary' : p.tipo)}</b><span>${esc(Object.entries(p.resumen || {}).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') || '—' : v ?? '—'}`).join(' · '))}</span></div>`).join('') + '<p class="tnota">Shared by each crew member with consent. Only you see this; it never reaches the crew display.</p>'
      : '<p class="rtxt">Nobody shared a private summary in the last 24 hours.</p>';
  } else if (tab === 'aprender') {
    pintarAprender();
  } else {
    const lista = informe.preguntas;
    c.innerHTML = lista.length ? lista.map(q => `<div class="paso ${q.protocolo ? 'grave' : ''}"><time>${hora(q.t)}</time><span>${esc(q.pregunta)}${q.protocolo ? ` <small>→ ${esc(PROTO[q.protocolo] || q.protocolo)} protocol</small>` : ''}${q.fuentes && q.fuentes.length ? `<br><small>${esc(q.fuentes.join(' · '))}</small>` : ''}</span></div>`).join('')
      : '<p class="rtxt">No questions to NOVA in the last 24 hours.</p>';
  }
}

/* ---------------- enseñar a NOVA: lo que bajó, lo que el cirujano valida y sube firmado ---------------- */
function pintarAprender() {
  const a = informe.aprendizaje || { sin_cobertura: [], poco_utiles: [], alertas_breves: 0, preguntas: 0 };
  const pend = [...a.sin_cobertura.map(x => ({ q: x.pregunta, por: 'The onboard library did not cover it' })), ...a.poco_utiles.map(x => ({ q: x.pregunta, por: 'The crew marked the answer as not useful', r: x.respuesta }))];
  const luz = mision ? (mision.luz_seg / 60).toFixed(1) : '—';
  $('tCuerpo').innerHTML = `
    <div class="rsec"><h4>What NOVA needs to learn<span>downlinked tonight · ${a.preguntas} questions asked</span></h4>
      ${pend.length ? pend.slice(0, 8).map((x, i) => `<div class="apr"><b>${esc(x.q)}</b><small>${esc(x.por)}${x.r ? ` · NOVA said: “${esc(x.r.slice(0, 160))}${x.r.length > 160 ? '…' : ''}”` : ''}</small>
        <textarea class="tin" data-apq="${esc(x.q)}" rows="2" placeholder="Write the validated answer NOVA should give"></textarea></div>`).join('')
        : '<p class="rtxt">Nothing pending: every question was covered and no answer was marked as not useful.</p>'}
      ${a.alertas_breves ? `<p class="rtxt"><b>${a.alertas_breves}</b> alert${a.alertas_breves > 1 ? 's' : ''} returned to normal within a minute. A loose sensor or a limit set too tight: review the limits on the right.</p>` : ''}</div>
    <div class="rsec" id="tAprForm"><h4>Guidance for NOVA<span>it reads this before every answer</span></h4>
      <div class="tabsx tapr-q">${['All crew', ...[0, 1, 2, 3].map(nombre)].map((n, i) => `<button data-aprt="${i ? 'T' + i : ''}" class="${i ? '' : 'on'}">${esc(n)}</button>`).join('')}</div>
      <textarea class="tin" id="tAprNota" rows="3" placeholder="e.g. Kenji: before any spacewalk prep, ask how he slept and suggest a short walk on the treadmill first."></textarea>
      <input class="tin" id="tAprMotivo" placeholder="Why (goes in the record)">
      <div class="tapr-acc"><button class="tbtn" id="tAprEnviar">Sign and send to the ship · arrives in ${luz} min</button><button class="tlink" id="tAprAlterar">Security test: send a tampered package</button></div>
      <p class="tnota" id="tAprNotaRes">Signed on Earth with the mission key (ed25519). The ship checks the signature with Earth's public key before applying anything; emergency protocols never change this way.</p></div>
    <div class="rsec"><h4>Updates for NOVA<span>on the way and applied</span></h4><div id="tPaq"></div></div>
    <div class="rsec"><h4>Earth NOVA<span>next stage</span></h4><p class="rtxt">A much larger model on Earth will review every downlink from all crews, draft these answers and personal limits, and leave them here for the flight surgeon to approve. Nothing reaches the ship without a human signature.</p></div>`;
  pintarPaquetes();
}
let aprTrip = '';
function pintarPaquetes() {
  const l = (informe.aprende && informe.aprende.paquetes) || [], c = $('tPaq'); if (!c) return;
  c.innerHTML = l.length ? l.slice(0, 8).map(p => {
    const falta = Math.max(0, (p.llega - Date.now()) / 1000);
    const est = p.estado === 'en_vuelo' ? `<b style="color:var(--nv)">${Math.floor(falta / 60)}:${String(Math.floor(falta % 60)).padStart(2, '0')}</b>` : p.estado === 'aplicado' ? '<b class="ok">applied</b>' : '<b class="al">rejected · bad signature</b>';
    return `<div class="sub"><div><b>${esc(p.id)}</b> <span>${p.respuestas} answer${p.respuestas === 1 ? '' : 's'} · ${p.notas} note${p.notas === 1 ? '' : 's'}</span><em>${esc(p.motivo || '')}</em></div>${est}</div>`;
  }).join('') : '<p class="tnota">Nothing sent yet.</p>';
}
async function enviarAprende(alterar = false) {
  const respuestas = [...document.querySelectorAll('[data-apq]')].filter(t => t.value.trim()).map(t => ({ pregunta: t.dataset.apq, respuesta: t.value.trim() }));
  const nota = $('tAprNota').value.trim(), notas = nota ? [{ trip: aprTrip, texto: nota }] : [];
  if (!respuestas.length && !notas.length) { $('tAprNotaRes').textContent = 'Write a validated answer or a guidance note first.'; return; }
  const r = await fetch('/v1/tierra/actualizar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notas, respuestas, motivo: $('tAprMotivo').value.trim() || 'Flight surgeon review', alterar }) });
  if (!r.ok) { $('tAprNotaRes').textContent = 'The link did not accept the package.'; return; }
  const d = await r.json();
  $('tAprNotaRes').textContent = alterar ? `${d.id} left Earth and was altered on the way. Watch the ship reject it when it arrives.` : `${d.id} signed and on its way. It arrives in ${((d.llega - d.enviado) / 60000).toFixed(1)} min.`;
  if (!alterar) { document.querySelectorAll('[data-apq]').forEach(t => t.value = ''); $('tAprNota').value = ''; $('tAprMotivo').value = ''; }
  informe = await j('/v1/tierra/informe').catch(() => informe); pintarPaquetes();
}

/* ---------------- subida: límites ---------------- */
function pintarLimites() {
  const U = estado && estado.umbrales;
  if (!U) return;
  $('tLimites').dataset.listo = '1';
  $('tIndicadores').innerHTML = Object.keys(PARAMS).map(k => `<button data-ind="${k}" class="${k === ind ? 'on' : ''}">${SENS[k][0]}</button>`).join('');
  $('tLimites').innerHTML = PARAMS[ind].map(([lbl, idx, p]) => {
    const v = U[ind][idx];
    return `<div class="tlim"><span>${lbl} <b>${SENS[ind][1]}</b></span><input class="tin" data-p="${p}" data-orig="${v > 0 ? v : ''}" value="${v > 0 ? v : ''}" inputmode="decimal"></div>`;
  }).join('');
  const luz = mision ? (mision.luz_seg / 60).toFixed(1) : '—';
  $('tEnviarLim').textContent = `Send to the ship · arrives in ${luz} min`;
}
async function enviarLimites() {
  const cambios = [...document.querySelectorAll('#tLimites input')].filter(i => i.value.trim() !== i.dataset.orig && i.value.trim() !== '' && !isNaN(+i.value));
  if (!cambios.length) { $('tNotaLim').textContent = 'Change a value first.'; return; }
  const motivo = $('tMotivo').value.trim() || 'Flight surgeon update';
  $('tEnviarLim').disabled = true;
  try {
    for (const i of cambios) {
      // en F Prime: fijar el parámetro, guardarlo en la base de parámetros y escribirla en disco
      for (const nombre of [`Nova.monitorSalud.${i.dataset.p}_PRM_SET`, `Nova.monitorSalud.${i.dataset.p}_PRM_SAVE`]) {
        await fetch('/v1/sistemas/comando', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nombre, argumentos: nombre.endsWith('SET') ? [i.value.trim()] : [], motivo }) });
      }
    }
    await fetch('/v1/sistemas/comando', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nombre: 'FileHandling.prmDb.PRM_SAVE_FILE', argumentos: [], motivo: 'Keep the new limits after a restart' }) });
    $('tNotaLim').textContent = `${cambios.length} limit${cambios.length > 1 ? 's' : ''} on the way. The ship applies ${cambios.length > 1 ? 'them' : 'it'} when the signal arrives.`;
    $('tMotivo').value = '';
  } catch { $('tNotaLim').textContent = 'The deep-space link did not accept the commands.'; }
  $('tEnviarLim').disabled = false;
  delete $('tLimites').dataset.listo;
  refrescar();
}

function pintarSubida() {
  const s = sist && sist.subida || [];
  $('tSubida').innerHTML = s.length ? s.slice(0, 10).map(c => {
    const falta = Math.max(0, (c.llega - Date.now()) / 1000);
    const est = c.estado === 'en_vuelo' ? `<b style="color:var(--nv)">${Math.floor(falta / 60)}:${String(Math.floor(falta % 60)).padStart(2, '0')}</b>` : c.estado === 'entregado' ? '<b class="ok">delivered</b>' : `<b class="al">${esc(c.estado)}</b>`;
    return `<div class="sub"><div><b>${esc(c.nombre.split('.').pop())}</b> ${c.argumentos.length ? `<span>= ${esc(c.argumentos.join(', '))}</span>` : ''}<em>${esc(c.motivo)}</em></div>${est}</div>`;
  }).join('') : '<p class="tnota">Nothing sent yet.</p>';
}

/* ---------------- subida: casa ---------------- */
function pintarPara() { $('tPara').innerHTML = [0, 1, 2, 3].map(i => `<button data-para="${i}" class="${i === para ? 'on' : ''}">${esc(nombre(i))}</button>`).join(''); }
async function enviarCasa() {
  const texto = $('tTexto').value.trim(), de = $('tDe').value.trim();
  if (!de || (!texto && !foto)) { $('tNotaCasa').textContent = 'Add who it is from and a message or a photo.'; return; }
  $('tEnviarCasa').disabled = true;
  try {
    const r = await fetch('/v1/casa/subida', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trip: `T${para + 1}`, de, relacion: $('tRel').value.trim(), texto, enviado: Date.now(), ...(foto ? { archivo_b64: foto, mime: 'image/jpeg' } : {}) }) });
    const d = await r.json();
    $('tNotaCasa').textContent = `On its way to ${nombre(para)}. It arrives in ${(d.mensaje.luz_ms / 60000).toFixed(1)} min.`;
    $('tTexto').value = ''; foto = null; $('tFotoTxt').textContent = 'Add a photo';
  } catch { $('tNotaCasa').textContent = 'The relay could not send it.'; }
  $('tEnviarCasa').disabled = false;
}
/* la foto se reduce a 1280 px en JPEG antes de subir (el enlace es escaso) */
$('tFoto').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    foto = c.toDataURL('image/jpeg', 0.8).split(',')[1];
    $('tFotoTxt').textContent = `${f.name.slice(0, 22)} · ${Math.round(foto.length * 0.75 / 1024)} KB`;
  };
  img.src = URL.createObjectURL(f);
});

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.tt) { tab = b.dataset.tt; pintarCuerpo(); }
  else if (b.dataset.ind) { ind = b.dataset.ind; delete $('tLimites').dataset.listo; pintarLimites(); }
  else if (b.dataset.para) { para = +b.dataset.para; pintarPara(); }
  else if (b.id === 'tEnviarLim') enviarLimites();
  else if (b.id === 'tEnviarCasa') enviarCasa();
  else if (b.dataset.aprt != null) { aprTrip = b.dataset.aprt; document.querySelectorAll('[data-aprt]').forEach(x => x.classList.toggle('on', x === b)); }
  else if (b.id === 'tAprEnviar') enviarAprende(false);
  else if (b.id === 'tAprAlterar') enviarAprende(true);
});

(function cuadro(t) { $('marca').innerHTML = mascotaOrbes({ x: 26, y: 27, R: 15, t: t / 1000, expr: 'normal', orbes: 0, sinHalo: true, fluido: .6 }); requestAnimationFrame(cuadro); })(0);
refrescar().then(() => { pintarPara(); refrescarInforme(); });
setInterval(refrescar, 3000); setInterval(refrescarInforme, 15000); setInterval(() => { pintarSubida(); if (tab === 'aprender' && informe) pintarPaquetes(); }, 1000);
