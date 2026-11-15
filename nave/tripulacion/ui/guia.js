/* Modo emergencia: guía paso a paso de un protocolo aprobado (ui/protocolos.json → guia), para una tripulación sin médico.
   Un paso a la vez, en grande y en voz alta; las esperas tienen cronómetro y la rama siguiente la decide la medición real.
   Cada paso queda en la bitácora de a bordo (/v1/bitacora) para el informe al cirujano de vuelo. */
'use strict';
let PROTOCOLOS = [], guia = null, episodios = {};

fetch('protocolos.json').then(r => r.json()).then(d => { PROTOCOLOS = d.protocolos || []; }).catch(() => {});

const pron = c => (c.pronombre || '').startsWith('she') ? { el: 'she', su: 'her', lo: 'her' } : (c.pronombre || '').startsWith('he') ? { el: 'he', su: 'his', lo: 'him' } : { el: 'they', su: 'their', lo: 'them' };
function rellenar(t, c) {
  const p = pron(c);
  return t.replace(/\{Nombre\}/g, c.corto).replace(/\{nombre\}/g, c.corto).replace(/\{su\}/g, p.su).replace(/\{el\}/g, p.el).replace(/\{lo\}/g, p.lo)
    .replace(/(^|[.?!]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
}
const hhmmss = t => new Date(t).toTimeString().slice(0, 8);
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function decir(t) { hablar(t, { nuevo: true, idioma: 'en' }); }

function bitacora(evento, extra = {}) {
  if (!guia) return;
  const e = { t: Date.now(), evento, ...extra };
  guia.log.push(e);
  fetch(BASE + '/v1/bitacora', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tipo: 'emergencias', datos: { sesion: guia.sesion, trip: CREW[guia.i].id, protocolo: guia.p.id, ...e } }) }).catch(() => {});
}

/* metrónomo para las compresiones (WebAudio): un clic corto en cada golpe */
let metro = null;
function metronomo(bpm) {
  if (metro && metro.bpm === bpm) return;
  pararMetronomo();
  if (!bpm) return;
  const ctx = contexto(), periodo = 60 / bpm;
  let proximo = ctx.currentTime + .1;
  const id = setInterval(() => {
    while (proximo < ctx.currentTime + .25) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 1150; g.gain.setValueAtTime(.0001, proximo);
      g.gain.exponentialRampToValueAtTime(.35, proximo + .004); g.gain.exponentialRampToValueAtTime(.0001, proximo + .06);
      o.connect(g); g.connect(ctx.destination); o.start(proximo); o.stop(proximo + .07);
      proximo += periodo;
    }
  }, 60);
  metro = { bpm, id, inicio: performance.now() };
}
function pararMetronomo() { if (metro) clearInterval(metro.id); metro = null; }

function abrirGuia(i, protocolo, auto = false) {
  const p = PROTOCOLOS.find(x => x.id === protocolo && x.guia);
  if (!p) return false;
  guia = { i, p, paso: p.guia[0].id, inicio: Date.now(), log: [], sesion: `${CREW[i].id}-${protocolo}-${Date.now()}`, esperaDesde: 0, medidoDesde: 0 };
  $('emergencia').classList.add('on');
  bitacora('start', { auto, texto: auto ? `Nova opened the ${p.titulo.toLowerCase()} guide automatically` : `Guide started: ${p.titulo}` });
  irA(p.guia[0].id);
  return true;
}

function cerrarGuia() {
  if (guia) bitacora('close', { texto: 'Guide closed' });
  guia = null; $('emergencia').classList.remove('on');
  callar(); pararMetronomo();
}

function pasoActual() { return guia && guia.p.guia.find(s => s.id === guia.paso); }

function irA(id, porque) {
  guia.paso = id;
  const s = pasoActual(), c = CREW[guia.i];
  if (s.tipo === 'espera') { guia.esperaDesde = Date.now(); guia.medidoDesde = Date.now(); }
  metronomo(s.metronomo || 0);
  const texto = rellenar(s.texto, c);
  bitacora('step', { paso: id, texto: (porque ? porque + ' → ' : '') + texto, grave: !!s.grave });
  decir(texto);
  pintarGuia();
}

/* ¿se recuperó? con los valores en vivo (deben ser posteriores al inicio de la espera) */
function evaluar(s) {
  const tr = ultimo.trip[guia.i];
  const ok = Object.entries(s.recupera || {}).every(([k, [mn, mx]]) => {
    const v = tr[k]; if (!(tr.edades[k] > 0)) return false;
    return (mn == null || v >= mn) && (mx == null || v < mx);
  });
  const resumen = Object.keys(s.recupera || {}).map(k => k === 'pa_sis' ? `blood pressure ${fmt('pa_sis', tr.pa_sis)}/${fmt('pa_dia', tr.pa_dia)} mmHg` : `${NOMBRE[k]} ${fmt(k, tr[k])} ${UNIDAD[k]}`).join(', ');
  return { ok, resumen };
}

function responder(r) {
  const s = pasoActual(); if (!s) return;
  if (s.tipo === 'pregunta') { bitacora('answer', { paso: s.id, texto: `Answer: ${r ? 'yes' : 'no'}` }); irA(r ? s.si : s.no); }
  else if (s.tipo === 'accion') { bitacora('done', { paso: s.id, texto: 'Done' }); irA(s.sig); }
  else if (s.tipo === 'espera') {
    const e = evaluar(s);
    irA(e.ok ? s.si_recupera : s.no_recupera, `Measured: ${e.resumen}`);
  } else if (s.tipo === 'fin') cerrarGuia();
}

/* una medición nueva de lo que la espera pide (manual, de la estación o del teléfono) */
function medicionNueva(s) {
  if (!s.medir) return false;
  const tr = ultimo.trip[guia.i], k = s.medir === 'pa' ? 'pa_sis' : s.medir;
  const edad = tr.edades[k];
  return edad > 0 && Date.now() - edad * 1000 > guia.medidoDesde - 1000;
}

function pintarGuia() {
  if (!guia || !ultimo) return;
  const s = pasoActual(), c = CREW[guia.i], tr = ultimo.trip[guia.i];
  $('emQuien').innerHTML = `<div class="av" style="background:${c.col}">${c.ini}</div><div><b>${c.nombre}</b><span>${c.rol}</span></div>`;
  $('emProto').textContent = guia.p.titulo;
  $('emTiempo').textContent = mmss((Date.now() - guia.inicio) / 1000);
  // signos en vivo
  const ks = [...new Set(['pulso', 'spo2', 'pa_sis', 'fr', ...(s.mira || [])])].filter(k => k !== 'pa_dia');
  $('emSignos').innerHTML = ks.map(k => {
    const tiene = tr.edades[k] > 0, n = tr.niveles[k] || 'sin_dato';
    const val = !tiene ? '—' : k === 'pa_sis' ? `${fmt('pa_sis', tr.pa_sis)}/${fmt('pa_dia', tr.pa_dia)}` : fmt(k, tr[k]);
    return `<div class="${(s.mira || []).includes(k) || (k === 'pa_sis' && (s.mira || []).includes('pa_dia')) ? 'foco' : ''}"><span>${k === 'pa_sis' ? 'Blood pressure' : NOMBRE[k][0].toUpperCase() + NOMBRE[k].slice(1)}</span><b class="lv-${tiene ? n : ''}">${val}<small>${k === 'pa_sis' ? 'mmHg' : UNIDAD[k]}</small></b><em>${tiene ? (tr.edades[k] <= 3 ? 'live' : hace(tr.edades[k])) : 'no reading'}</em></div>`;
  }).join('');
  if (s.mira_cabina) $('emSignos').innerHTML += `<div class="foco"><span>Cabin O₂ · CO₂</span><b>${ultimo.cabina.o2.toFixed(1)}<small>%</small> · ${fmt('co2_cabina', ultimo.cabina.co2)}<small>ppm</small></b><em>live</em></div>`;
  // paso
  const n = guia.log.filter(e => e.evento === 'step').length;
  $('emPasoN').textContent = s.tipo === 'fin' ? (s.grave ? 'Act now' : 'Done') : `Step ${n}`;
  $('emPaso').className = 'paso-txt' + (s.grave ? ' grave' : '');
  $('emPaso').textContent = rellenar(s.texto, c);
  let b = '';
  if (s.tipo === 'pregunta') b = `<button class="si" data-g="1">Yes</button><button class="no" data-g="0">No</button>`;
  else if (s.tipo === 'accion') b = `<button class="si" data-g="1">Done</button>`;
  if (s.tipo !== 'fin') b += `<button class="no cam" data-cam="1">Guide me with the camera</button>`;
  else if (s.tipo === 'espera') {
    const quedan = Math.max(0, s.seg - (Date.now() - guia.esperaDesde) / 1000), nueva = medicionNueva(s);
    b = `<div class="reloj-em"><svg viewBox="0 0 120 120">${anilloArco(60, 60, 52, 1 - quedan / s.seg, quedan > 0 ? '#8fe6f5' : '#6fd6b0', 7)}</svg><b>${quedan > 0 ? mmss(quedan) : 'Now'}</b></div>`;
    if (s.medir) b += `<button class="si" data-reg="${guia.i}" data-s="${s.medir}">Log ${NOMBRE[s.medir === 'pa' ? 'pa_sis' : s.medir]}</button>`;
    b += `<button class="${nueva || !s.medir ? 'si' : 'no'}" data-g="1" ${!nueva && s.medir && quedan > 0 ? '' : ''}>${nueva ? 'Use the new reading' : !s.medir ? (quedan > 0 ? 'Skip wait' : 'Continue') : 'Use the live reading'}</button>`;
  } else b = `<button class="si" data-g="1">Close guide</button>`;
  if ($('emBotones').dataset.html !== b.replace(/<b>[^<]*<\/b>|<svg[\s\S]*?<\/svg>/g, '')) { $('emBotones').innerHTML = b; $('emBotones').dataset.html = b.replace(/<b>[^<]*<\/b>|<svg[\s\S]*?<\/svg>/g, ''); }
  else { const r = $('emBotones').querySelector('.reloj-em'); if (r) { const t = document.createElement('div'); t.innerHTML = b; r.replaceWith(t.querySelector('.reloj-em')); } }
  // bitácora
  // fuente del protocolo, con páginas
  const fu = guia.p.fuente ? `Source: ${guia.p.fuente}` + (guia.p.fuentes && guia.p.fuentes.length ? ` · pages ${[...new Set(guia.p.fuentes.map(f => f.pagina))].join(', ')}` : '') : 'Approved onboard protocol';
  $('emFuente').textContent = `${fu} · v${guia.p.version || '0.2'} · demo, pending flight surgeon review${guia.p.nota ? ' · ' + guia.p.nota : ''} · Nova guides, the crew decides`;
  $('emMetro').hidden = !metro; if (metro) $('emMetro').innerHTML = `<i style="animation-duration:${60 / metro.bpm}s"></i>${metro.bpm} / min · push on the beat`;
  $('emLog').innerHTML = guia.log.filter(e => e.texto).slice().reverse().map(e => `<div class="${e.grave ? 'grave' : ''}"><time>${hhmmss(e.t)}</time><span>${escaparG(e.texto)}</span></div>`).join('');
  $('emVoz').textContent = vozActiva ? 'Voice on' : 'Voice off';
}
const escaparG = t => String(t).replace(/[&<>]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x]));

/* elegir a mano: quién y qué */
function abrirElegir() {
  $('emElegir').innerHTML = `<h2>Emergency guide</h2><div class="sub">Pick who needs help and what is happening. Nova walks you through the approved steps.</div>
    <div class="paso">Who</div><div class="quien">${CREW.map((c, j) => `<button data-eq="${j}" class="${j === 0 ? 'on' : ''}"><div class="av" style="background:${c.col}">${c.ini}</div><b>${c.corto}</b></button>`).join('')}</div>
    <div class="paso">What is happening</div><div class="chips">${PROTOCOLOS.filter(p => p.guia).map(p => `<button data-ep="${p.id}">${p.titulo}</button>`).join('')}</div>
    <div class="acc"><button id="emCancelar">Cancel</button></div>`;
  $('emElegir').dataset.i = 0;
  $('veloEm').classList.add('on');
}

/* se abre sola ante un patrón de desmayo nuevo (una vez por episodio) */
function vigilarEmergencia(m) {
  if (!PROTOCOLOS.length) return; // todavía cargando los protocolos
  m.trip.forEach((tr, i) => {
    const bajo = k => (tr.niveles[k] === 'atencion' || tr.niveles[k] === 'aviso_tierra') && tr[k] < MEDIO[k];
    const desmayo = bajo('pulso') && (bajo('pa_sis') || bajo('pa_dia')) && (tr.niveles.pulso === 'aviso_tierra' || tr.niveles.pa_sis === 'aviso_tierra');
    const clave = CREW[i].id;
    if (desmayo && !episodios[clave] && !guia && abrirGuia(i, 'desmayo', true)) episodios[clave] = Date.now();
    if (!desmayo && episodios[clave] && Date.now() - episodios[clave] > 120000) delete episodios[clave];
  });
  if (guia) pintarGuia();
}

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.g != null && guia) responder(b.dataset.g === '1');
  else if (b.id === 'emCerrar') cerrarGuia();
  else if (b.id === 'emVoz') { vozActiva = !vozActiva; if (!vozActiva) callar(); else decir(rellenar(pasoActual().texto, CREW[guia.i])); pintarGuia(); pintarVozBtn(); }
  else if (b.id === 'btnEmergencia') abrirElegir();
  else if (b.dataset.eq) { $('emElegir').dataset.i = b.dataset.eq; document.querySelectorAll('[data-eq]').forEach(x => x.classList.toggle('on', x === b)); }
  else if (b.dataset.ep) { $('veloEm').classList.remove('on'); abrirGuia(+$('emElegir').dataset.i, b.dataset.ep); }
  else if (b.id === 'emCancelar') $('veloEm').classList.remove('on');
  else if (b.dataset.guia) abrirGuia(+b.dataset.gi, b.dataset.guia);
  else if (b.dataset.cam && guia) abrirGuiaCamara();
});

/* guía con cámara (guia-ar.html): Nova ve el pecho y las manos y marca dónde empujar; sus pasos van a la bitácora */
function abrirGuiaCamara() {
  const c = CREW[guia.i];
  pararMetronomo(); callar();
  // the body scan opens on this protocol and step, on this crew member: the AR shows where, Nova checks and corrects
  $('guiaAR').innerHTML = `<iframe src="escaner.html?auto&embed=1&trip=${c.id}&protocolo=${guia.p.id}&paso=${guia.paso}" allow="camera; autoplay; fullscreen"></iframe><button class="guia-ar-cerrar" id="cerrarAR">Back to the guide</button>`;
  $('cerrarAR').onclick = cerrarGuiaCamara;
  $('guiaAR').classList.add('on');
  bitacora('camera', { texto: 'Camera guide opened on this step: Nova shows where on the body and checks the hands' });
}
function cerrarGuiaCamara() {
  $('guiaAR').classList.remove('on'); $('guiaAR').innerHTML = '';
  const s = pasoActual(); if (s) metronomo(s.metronomo || 0);
}
addEventListener('message', e => {
  const m = e.data; if (!m || m.tipo !== 'guia-ar' || !guia) return;
  if (m.evento === 'close') { bitacora('camera', { texto: m.texto }); cerrarGuiaCamara(); }
  else if (m.evento === 'start') bitacora('camera', { texto: m.texto, grave: true });
});
setInterval(() => { if (guia) pintarGuia(); }, 1000);
