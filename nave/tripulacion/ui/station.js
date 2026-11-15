/* NOVA Station en la tablet común (vertical) · v2.

   Sin tarjeta, «Órbita»: NOVA al centro de la escena, la tripulación orbitándola con sus signos en vivo, la misión
   (Tierra → nave → Marte) arriba, y abajo lo común: emergencia (nunca pide tarjeta), el kit médico 3D, la mente de la
   tripulación (cerebro 3D), la biblioteca y la misión. Tocar a un tripulante abre lo que comparte.

   Con la tarjeta NFC de un astronauta (lector externo → POST /v1/nfc → la nave abre su sesión en este lector),
   «Gemelo»: su cuerpo en 3D (el mismo gemelo de la estación, gemelo3d.mjs) con cada órgano coloreado por sus datos y
   NOVA a su lado. Abajo: check-in, medir, casa, kit y hablar con NOVA, que ya sabe quién le habla. Todo lo que escribe
   va por /v1/sesion/accion: queda a su nombre. La sesión se cierra con «Sign out», con la misma tarjeta o a los 2 min.

   NOVA se arrastra (va poniendo caritas), se levanta manteniéndola apretada, salta con doble toque y vuelve sola a su
   lugar; un toque la pone a escuchar. En la APK el micrófono lo maneja Android (postMessage ↔ window.novaApp). */
import { Procedimiento } from './procedimientos.js';

const $ = id => document.getElementById(id);
const P = new URLSearchParams(location.search);
const LECTOR = (P.get('lector') || 'station').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'station';
const APP = !!window.ReactNativeWebView;
// ?mudo: espejo de la tablet dentro de NOVA PC (vista hardware): misma sesión, sin voz ni micrófono, para no hablar dos veces
const MUDO = P.has('mudo');
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]);
const api = async (ruta, o = {}) => {
  const r = await fetch(BASE + ruta, { cache: 'no-store', ...o, headers: { ...(o.body ? { 'content-type': 'application/json' } : {}), ...(o.headers || {}) } });
  if (!r.ok) throw new Error((await r.text().catch(() => '')) || r.status);
  return (r.headers.get('content-type') || '').includes('json') ? r.json() : r;
};
const postJ = (ruta, cuerpo) => api(ruta, { method: 'POST', body: JSON.stringify(cuerpo) });
const nativo = msg => { try { window.ReactNativeWebView?.postMessage(JSON.stringify(msg)); } catch {} };

const NOMBRE = { pulso: 'Heart rate', spo2: 'Oxygen', pa_sis: 'Blood pressure', temp: 'Temperature', fr: 'Breathing', glucosa: 'Blood sugar', vfc: 'HRV', sueno_h: 'Sleep', animo: 'Mood', energia: 'Energy' };
const UNIDAD = { pulso: 'bpm', spo2: '%', pa_sis: 'mmHg', temp: '°C', fr: '/min', glucosa: 'mg/dL', vfc: 'ms', sueno_h: 'h', animo: '/5', energia: '/5' };
const COL = { normal: '#6fd6b0', esperado_vuelo: '#6fd6b0', vigilar: '#a898ff', atencion: '#f2b457', aviso_tierra: '#ec6aa8', sin_dato: '#6d7786' };
const RANGO = window.RANGO;
const NIVEL_TXT = { normal: 'in range', esperado_vuelo: 'expected in flight', vigilar: 'worth watching', atencion: 'needs attention', aviso_tierra: 'flight surgeon informed' };
const fmt = (k, v) => v == null || !isFinite(v) || (v === 0 && k !== 'pasos') ? '—' : k === 'temp' || k === 'sueno_h' ? v.toFixed(1) : String(Math.round(v));
const REGM = {
  pa: { n: 'Blood pressure', u: 'mmHg', dos: true, r: [[50, 250], [30, 150]], como: '<b>Sit still for 5 minutes</b> with the arm supported at heart level. In microgravity, strap the arm so the cuff stays at heart height.' },
  glucosa: { n: 'Blood sugar', u: 'mg/dL', r: [[20, 600]], como: '<b>Clean the fingertip</b> and use the second drop of blood. Note if you ate in the last 2 hours.' },
  temp: { n: 'Temperature', u: '°C', r: [[30, 43]], dec: true, como: '<b>Under the tongue</b>, mouth closed, for one minute.' },
  spo2: { n: 'Oxygen', u: '%', r: [[50, 100]], como: '<b>Warm, still finger.</b> Wait until the number holds for 10 seconds.' },
  pulso: { n: 'Heart rate', u: 'bpm', r: [[20, 250]], como: '<b>By hand:</b> count the beats at the wrist for 30 seconds and double it.' },
  fr: { n: 'Breathing', u: '/min', r: [[4, 60]], como: '<b>Count breaths for 30 seconds</b> without telling the person, then double it.' },
};
window.REG = REGM; // el gemelo muestra «Log …» para estas mediciones

let crew = [], estado = null, misionE = null, sesion = null, PROTOCOLOS = [], KIT = null, casa = null;

/* ── avisos ── */
let tAviso = 0;
function avisar(txt, tipo = '') { const a = $('aviso'); a.textContent = txt; a.className = 'aviso ' + tipo; a.hidden = false; clearTimeout(tAviso); tAviso = setTimeout(() => { a.hidden = true; }, 3200); }

/* ── datos de la nave ── */
async function cargarBase() {
  try { crew = await (await fetch('tripulacion.json', { cache: 'no-store' })).json(); } catch { crew = []; }
  // el gemelo usa «ella» (her/his) para elegir la anatomía de referencia
  window.CREW = crew.map(c => ({ ...c, ella: /^she/.test(c.pronombre || '') ? 'her' : /^he\//.test(c.pronombre || '') ? 'his' : 'their' }));
  try { PROTOCOLOS = (await (await fetch('protocolos.json')).json()).protocolos || []; } catch {}
}
async function leerMision() { try { misionE = window.mision = await api('/v1/mision'); pintarCab(); pintarArco(); } catch {} }
async function leerEstado() { try { ponerEstado(await api('/v1/estado')); } catch {} }
async function leerKit() { try { KIT = await api('/v1/kit'); pintarDock(); } catch {} }
function ponerEstado(d) { estado = window.ultimo = d; pintarComun(); if (sesion && window.pintarGemelo) window.pintarGemelo(); }
function conectar() {
  const es = new EventSource(BASE + '/v1/flujo');
  es.onmessage = e => {
    let d; try { d = JSON.parse(e.data); } catch { return; }
    if (d.tipo === 'sesion') { if (d.lector === LECTOR) { if (d.vinculada) tarjetaVinculada(); else leerSesion(); } return; }
    if (d.tipo === 'tripulacion') { cargarBase().then(() => { pintarComun(); if (sesion && window.pintarGemelo) window.pintarGemelo(); }); return; }
    if (d.trip && Array.isArray(d.trip)) ponerEstado(d);
    if (d.tipo === 'kit') leerKit();
    if (d.tipo === 'pantalla' && MUDO && d.lector === LECTOR) espejo(d.foto);
    if (d.tipo === 'onda' && d.lector === LECTOR) ecgRecibir(d);
    if (d.tipo === 'radiacion') { radStation(!!d.spe); leerRadStation(); }
  };
  es.onerror = () => { es.close(); setTimeout(conectar, 2000); };
}
const tr = id => { const i = crew.findIndex(c => c.id === id); return estado?.trip?.[i] || null; };

/* ── cabecera ── */
function pintarCab() {
  if (!misionE) return;
  $('mision').textContent = `Day ${misionE.dia} · ${misionE.fase === 'cruise' ? 'cruise to Mars' : misionE.fase} · Earth ${(misionE.luz_seg / 60).toFixed(1)} light-min`;
  $('dMision').textContent = misionE.fase === 'cruise' ? `Mars in ${Math.round(misionE.llegada_en_dias)} d` : `day ${misionE.dia}`;
}
setInterval(() => { $('reloj').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }, 1000);
(function marca(ms) { $('marca').innerHTML = mascotaOrbes({ x: 26, y: 27, R: 15, t: ms / 1000, expr: 'normal', orbes: 0, sinHalo: true, fluido: .6 }); requestAnimationFrame(marca); })(0);

/* ── ÓRBITA ── */
function pintarArco() {
  if (!misionE) return;
  const f = Math.min(1, misionE.dia / (misionE.dia + (misionE.llegada_en_dias || 0)));
  const q = t => [(1 - t) ** 2 * 70 + 2 * (1 - t) * t * 400 + t * t * 730, (1 - t) ** 2 * 78 + 2 * (1 - t) * t * -8 + t * t * 78];
  const [sx, sy] = q(f);
  const hecho = Array.from({ length: 30 }, (_, k) => q(f * k / 29)).map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
  $('arco').innerHTML = `<defs><radialGradient id="aT"><stop offset="0" stop-color="#46c8e8" stop-opacity=".5"/><stop offset="1" stop-color="#46c8e8" stop-opacity="0"/></radialGradient><radialGradient id="aM"><stop offset="0" stop-color="#f2b457" stop-opacity=".5"/><stop offset="1" stop-color="#f2b457" stop-opacity="0"/></radialGradient></defs>
    <path d="M70 78 Q400 -8 730 78" fill="none" stroke="rgba(143,230,245,.22)" stroke-width="1.4" stroke-dasharray="3 7"/>
    <polyline points="${hecho}" fill="none" stroke="rgba(143,230,245,.7)" stroke-width="1.6"/>
    <circle cx="70" cy="78" r="26" fill="url(#aT)"/><circle cx="70" cy="78" r="9" fill="#46c8e8"/>
    <circle cx="730" cy="78" r="24" fill="url(#aM)"/><circle cx="730" cy="78" r="7.5" fill="#f2b457"/>
    <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="9" fill="none" stroke="rgba(255,255,255,.35)"/><circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="4.5" fill="#fff"/>
    <text x="30" y="110" fill="#6d7786" font-family="SG" font-size="11" letter-spacing="2">EARTH · ${(misionE.luz_seg / 60).toFixed(1)} LIGHT-MIN</text>
    <text x="770" y="110" fill="#6d7786" font-family="SG" font-size="11" letter-spacing="2" text-anchor="end">MARS · ${Math.round(misionE.llegada_en_dias)} DAYS</text>
    <text x="${sx.toFixed(1)}" y="${(sy - 16).toFixed(1)}" fill="#bfeffa" font-family="SG" font-size="11" letter-spacing="2" text-anchor="middle">NOVA · DAY ${misionE.dia}</text>`;
}
// con tripulación real, los asientos vacíos no se muestran; la órbita se reacomoda según cuántos son
const visibles = () => crew.map((c, i) => [c, i]).filter(([c]) => !c.vacio);
const LUGARES = { 1: ['tc'], 2: ['ml', 'mr'], 3: ['tl', 'tr', 'bc'], 4: ['tl', 'tr', 'bl', 'br'] };
function nivelMax(t) { return Object.entries(t?.niveles || {}).filter(([k]) => NOMBRE[k]).reduce((a, [, n]) => RANGO[n] > RANGO[a] ? n : a, 'normal'); }
function porQue(t) { return Object.entries(t?.niveles || {}).filter(([k, n]) => NOMBRE[k] && RANGO[n] >= 3).map(([k]) => `${NOMBRE[k].toLowerCase()} ${fmt(k, t[k])}${UNIDAD[k] === '/5' ? '/5' : ''}`); }
function pintarComun() {
  if (!estado || !crew.length) return;
  const vis = visibles(), lugar = LUGARES[vis.length] || LUGARES[4];
  $('sats').innerHTML = vis.map(([c, i], j) => {
    const t = estado.trip[i] || {}, n = nivelMax(t), col = COL[n], pq = porQue(t);
    return `<button class="sat vidrio ${lugar[j]}" data-tri="${i}" style="${RANGO[n] >= 2 ? `border-color:${col}` : ''}">
      <div class="n"><i style="background:${col}"></i>${esc(c.corto)}<span>${esc((c.rol || '').split(' ')[0])}</span></div>
      <div class="v">${fmt('pulso', t.pulso)}<small>bpm</small></div>
      <div class="s">SpO₂ ${fmt('spo2', t.spo2)} % · ${fmt('pa_sis', t.pa_sis)}/${fmt('pa_dia', t.pa_dia)} · ${fmt('temp', t.temp)} °C</div>
      ${pq.length ? `<div class="a" style="color:${col}">${esc(pq.slice(0, 2).join(' · '))}</div>` : ''}</button>`;
  }).join('');
  // lo que NOVA dice de la tripulación
  const mal = visibles().map(([c, i]) => [c, estado.trip[i]]).filter(([, t]) => RANGO[nivelMax(t)] >= 3), n = visibles().length;
  const cb = estado.cabina || {};
  if (!decirHasta || performance.now() > decirHasta)
    $('dice').innerHTML = mal.length ? `${mal.length === n ? 'Everyone needs a look.' : `${n - mal.length} of you ${n - mal.length === 1 ? 'is' : 'are'} stable.`}<br><em>${mal.map(([c, t]) => `${esc(c.corto)}: ${esc(porQue(t).join(', '))}`).join(' · ')}</em>`
      : `${n === 1 ? 'You are' : n === 2 ? 'Both of you are' : `All ${n} of you are`} stable.<br><span class="ok">Cabin air good · CO₂ ${Math.round(cb.co2 || 0).toLocaleString('en-US')} ppm</span>`;
  const bajos = visibles().map(([c, i]) => [c, estado.trip[i]]).filter(([, t]) => (t?.animo && t.animo <= 2) || (t?.energia && t.energia <= 2));
  $('dMente').textContent = bajos.length ? `${bajos.map(([c]) => c.corto).join(', ')} low` : 'all rested';
  lazos();
}
function lazos() {
  const e = $('escena').getBoundingClientRect(); if (!e.width) return;
  const cx = e.width / 2, cy = e.height / 2;
  $('lazos').innerHTML = `<circle cx="${cx}" cy="${cy}" r="${Math.min(cx, cy) * .92}" fill="none" stroke="rgba(143,230,245,.11)"/><circle cx="${cx}" cy="${cy}" r="${Math.min(cx, cy) * .62}" fill="none" stroke="rgba(143,230,245,.07)" stroke-dasharray="2 7"/>`
    + [...document.querySelectorAll('.sat')].map(s => { const r = s.getBoundingClientRect(), x = r.left - e.left + r.width / 2, y = r.top - e.top + r.height / 2; const c = s.style.borderColor;
      return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${c || 'rgba(143,230,245,.18)'}" stroke-opacity="${c ? .55 : 1}" ${c ? 'stroke-dasharray="4 6"' : ''}/>`; }).join('');
}
addEventListener('resize', () => { lazos(); nova.alInicio(); });
function pintarDock() {
  if (KIT?.resumen) { const r = KIT.resumen; $('dKit').textContent = `${r.items} items${r.bajos + r.agotados ? ` · ${r.bajos + r.agotados} low` : ''}`; }
}
$('sats').onclick = e => { const b = e.target.closest('[data-tri]'); if (b) abrirHoja('tri', +b.dataset.tri); };
document.querySelectorAll('[data-hoja]').forEach(b => b.onclick = () => b.dataset.hoja === 'hablar' ? abrirCharla() : abrirHoja(b.dataset.hoja));
$('chipHablar').onclick = () => { abrirCharla(); escuchar(); };

/* ── sesión: la tarjeta de un astronauta ── */
let sesionTrip = null;
async function leerSesion() {
  let s; try { s = await api(`/v1/sesion?lector=${LECTOR}`); } catch { return; }
  sesion = s.trip ? s : null;
  $('nueva').hidden = !s.pendiente;
  if (s.pendiente) $('elige').innerHTML = visibles().map(([c]) => c).map(c => `<button data-asignar="${c.id}">${esc(c.corto || c.nombre)}<span>${esc(c.rol || '')}</span></button>`).join('');
  const trip = sesion?.trip || null;
  if (trip !== sesionTrip) { sesionTrip = trip; trip ? entrar() : salir(); }
  if (sesion) { const f = Math.max(0, Math.min(1, (sesion.quedan_s ?? 120) / 120)); $('anillo').style.strokeDashoffset = String(97.4 * (1 - f)); }
}
function entrar() {
  const p = sesion.persona || {}, i = crew.findIndex(c => c.id === sesion.trip);
  document.body.classList.replace('comun', 'personal');
  $('comun').hidden = true; $('personal').hidden = false; $('quien').hidden = false; $('reloj').hidden = true;
  $('quienNombre').textContent = p.corto || p.nombre || sesion.trip; $('quienRol').textContent = p.rol || '';
  $('hola').textContent = `Hi ${p.corto || ''}`;
  cerrarHoja(); cerrarCharla(); charla.length = 0; casa = null;
  nova.alInicio(); nova.expr('feliz', 2500);
  decirNova(`Hi ${p.corto || ''}. This is your body today.`);
  nativo({ tipo: 'vibrar' });
  if (window.abrirGemelo && i >= 0) window.abrirGemelo(i);
  cargarCasa(); misTarjetas();
}
function salir() {
  document.body.classList.replace('personal', 'comun');
  window.cambiarVista('comun');
  $('comun').hidden = false; $('personal').hidden = true; $('quien').hidden = true; $('reloj').hidden = false;
  cerrarHoja(); cerrarCharla(); charla.length = 0; casa = null;
  nova.alInicio(); pintarComun();
}
let tSeguir = 0;
document.addEventListener('pointerdown', () => {
  if (!sesion || performance.now() - tSeguir < 20000) return;
  tSeguir = performance.now(); accion('seguir').then(leerSesion).catch(() => {});
}, true);
async function accion(a, datos = {}) { if (!sesion) throw new Error('Tap your card first'); return postJ('/v1/sesion/accion', { token: sesion.token, accion: a, datos }); }
$('salir').onclick = async () => { try { await postJ('/v1/sesion/cerrar', { token: sesion?.token }); } catch {} leerSesion(); };
$('nuevaX').onclick = () => { $('nueva').hidden = true; };
$('elige').onclick = async e => {
  const b = e.target.closest('[data-asignar]'); if (!b) return;
  try { await postJ('/v1/sesion/asignar', { lector: LECTOR, trip: b.dataset.asignar }); avisar('Card linked', 'bien'); } catch (err) { avisar(String(err.message || err), 'mal'); }
  leerSesion();
};
// lector que escribe como teclado (USB/Bluetooth): ráfaga hex + Enter
let bufNfc = '', tNfc = 0;
document.addEventListener('keydown', e => {
  if (e.target.closest?.('input,textarea')) return;
  const ahora = performance.now(); if (ahora - tNfc > 120) bufNfc = ''; tNfc = ahora;
  if (e.key === 'Enter') { if (bufNfc.length >= 8) leerTarjeta(bufNfc); bufNfc = ''; return; }
  if (/^[0-9a-fA-F:]$/.test(e.key)) bufNfc += e.key;
});
async function leerTarjeta(uid) { try { await postJ('/v1/nfc', { uid, lector: LECTOR }); } catch { avisar('The card reader could not reach the ship', 'mal'); } leerSesion(); }
if (P.has('demo')) {
  $('demo').hidden = false;
  $('demo').innerHTML = 'Demo cards' + ['04A1B2C3', '04D4E5F6', '04112233', '04445566', '04DEADBE'].map((u, i) => `<button data-uid="${u}">${i < 4 ? i + 1 : 'new'}</button>`).join('');
  $('demo').onclick = e => { const b = e.target.closest('[data-uid]'); if (b) leerTarjeta(b.dataset.uid); };
}

/* ── hojas ── */
let hojaTipo = null, hojaArg = null;
// el rack y el cerebro 3D viven en contenedores que se mueven a la hoja (se montan una sola vez)
const cajaKit = Object.assign(document.createElement('div'), { className: 'kit3d' });
const cajaCerebro = Object.assign(document.createElement('div'), { className: 'cerebro' });
cajaCerebro.innerHTML = '<div data-cerebro3d></div><div class="est" id="mEst"></div>';
function abrirHoja(tipo, arg) {
  hojaTipo = tipo; hojaArg = arg ?? null; $('hoja').hidden = false; cerrarCharla();
  const poner = (kick, tit, html) => { $('hojaKick').textContent = kick; $('hojaTit').textContent = tit; $('hojaCuerpo').innerHTML = html; $('hojaCuerpo').scrollTop = 0; };
  if (tipo === 'kit') { window.cambiarVista('kit'); poner('Medical rack · live inventory', 'Medical kit', ''); hojaKit(); }
  else if (tipo === 'mente') { poner('Conceptual model · live signals', 'Crew mind', ''); hojaMente(arg); }
  else if (tipo === 'biblio') { poner('41 open sources · onboard', 'Medical library', `<input class="buscar" id="bq" placeholder="Search in English or Spanish"><div id="bres" style="display:flex;flex-direction:column;gap:10px"><p>Try “bone loss in microgravity”, “anaphylaxis” or “sleep”.</p></div>`);
    $('bq').onkeydown = e => { if (e.key === 'Enter') buscar($('bq').value); }; }
  else if (tipo === 'mision') { poner('Ship position · real light delay', 'Mission', ''); hojaMision(); }
  else if (tipo === 'tri') { const c = crew[arg]; poner(`${c.rol} · shared with the crew`, c.nombre, ''); hojaTri(arg); }
  else if (tipo === 'check') { poner('Your day · shared only if you send it', 'Check-in', ''); pintarCheck(); }
  else if (tipo === 'medir') { if (arg && REGM[arg]) { medS = arg; medV = ['', '']; medI = 0; } const n = nombreSesion(); poner(n ? `Saved to ${n}'s record` : 'Tap your card first', n ? `${n} · log a measurement` : 'Log a measurement', ''); pintarMedir(); }
  else if (tipo === 'casa') { poner('Messages arrive with the real light delay', 'Home', ''); pintarCasa(); }
  else if (tipo === 'ecg') { poner('AD8232 heart board · live', 'ECG', ''); hojaEcg(); }
}
function cerrarHoja() {
  const eraKit = hojaTipo === 'kit';
  $('hoja').hidden = true; hojaTipo = null; hojaArg = null;
  // el rack 3D solo corre con la vista «kit»; al cerrarlo vuelve a correr el gemelo (o nada, en la órbita)
  if (eraKit) {
    if (sesion) { const i = crew.findIndex(c => c.id === sesion.trip); if (i >= 0 && window.abrirGemelo) window.abrirGemelo(i); }
    else window.cambiarVista('comun');
  }
}
$('hojaX').onclick = cerrarHoja;
window.stationMedir = s => abrirHoja(s === 'pulso' ? 'ecg' : 'medir', s);   // el pulso: primero la placa del corazón
const nombreSesion = () => sesion ? (sesion.persona?.corto || sesion.persona?.nombre || sesion.trip) : '';

/* kit: el rack 3D de la nave + la lista; con tarjeta, retirar queda a tu nombre */
let kPack = null, kItem = null, filtroKit = '';
async function hojaKit() {
  if (!KIT) await leerKit();
  const c = $('hojaCuerpo'); c.appendChild(cajaKit);
  const r = KIT?.resumen || {};
  c.insertAdjacentHTML('beforeend', `<div class="kres"><div><b>${r.items ?? '—'}</b><span>items</span></div><div><b style="color:${(r.bajos || 0) + (r.agotados || 0) ? 'var(--at)' : 'inherit'}">${(r.bajos || 0) + (r.agotados || 0)}</b><span>low or out</span></div><div><b>${r.vencidos ?? 0}</b><span>expired</span></div><div><b>${r.vencen_antes_del_regreso ?? 0}</b><span>expire before Earth</span></div></div>
    <input class="buscar" id="kq" placeholder="Search the rack" value="${esc(filtroKit)}"><div id="klista" style="display:flex;flex-direction:column;gap:10px"></div>`);
  $('kq').oninput = e => { filtroKit = e.target.value; listaKit(); };
  pintarRack(); listaKit();
}
function pintarRack() {
  if (!window.kit3d || !KIT) return;
  window.kit3d.pintar(cajaKit, KIT, { pack: kPack, item: kItem, escenario: '' }, {
    onCajon: id => { kPack = kPack === id ? null : id; kItem = null; pintarRack(); listaKit(); },
    onItem: id => { kItem = id; listaKit(); },
  });
}
function listaKit() {
  const f = filtroKit.toLowerCase();
  const items = (KIT?.items || []).filter(it => (!kPack || it.pack === kPack) && (!f || `${it.n} ${it.uso}`.toLowerCase().includes(f)));
  const el = $('klista'); if (!el) return;
  el.innerHTML = items.map(it => `<div class="item" style="${it.id === kItem ? 'border-color:var(--ac2)' : ''}">${it.foto?.archivo ? `<img src="${esc(it.foto.archivo)}" alt="">` : ''}<div><b>${esc(it.n)}</b><span>${esc(it.uso || '')}</span></div>
    <span class="q ${it.cantidad <= (it.minimo || 0) ? 'bajo' : ''}">${it.cantidad}</span>${sesion ? `<button data-tomar="${esc(it.id)}" ${it.cantidad > 0 ? '' : 'disabled'}>Take 1</button>` : ''}</div>`).join('') || '<p>Nothing matches.</p>';
}

/* mente: el cerebro 3D de la estación (conceptual) con el estado de cada tripulante */
let mT = 0, cerebroPedido = false;
function estadoMente(t) {
  if (!t) return { k: 'basal', n: 'Waiting for the core', por: [] };
  const por = [];
  if (t.animo && t.animo <= 2) por.push(`mood ${t.animo}/5`);
  if (t.energia && t.energia <= 2) por.push(`energy ${t.energia}/5`);
  if (t.sueno_h && t.sueno_h < 6) por.push(`slept ${t.sueno_h.toFixed(1)} h`);
  if (t.spo2 && t.spo2 < 92) return { k: 'activacion', n: 'Short of oxygen', por: [`oxygen ${Math.round(t.spo2)} %`] };
  if (t.temp && t.temp >= 38) return { k: 'estres', n: 'Fever', por: [`temperature ${t.temp.toFixed(1)} °C`] };
  if (por.length >= 2 || (t.animo && t.animo <= 2)) return { k: 'estres', n: 'Stressed', por };
  if (por.length) return { k: 'fatiga', n: 'Tired', por };
  return { k: 'calma', n: 'Calm', por: ['mood, energy and sleep in their usual range'] };
}
function hojaMente(i) {
  if (i != null) mT = i;
  const c = $('hojaCuerpo');
  if (crew[mT]?.vacio) mT = visibles()[0]?.[1] ?? 0;
  c.innerHTML = `<div class="chipsel" id="mQ">${visibles().map(([p, j]) => `<button data-mt="${j}" class="${j === mT ? 'on' : ''}">${esc(p.corto)}</button>`).join('')}</div>`;
  c.appendChild(cajaCerebro);
  if (!cerebroPedido) { cerebroPedido = true; import('./cerebro.mjs?v=2').catch(() => { $('mEst').textContent = 'The 3D brain needs WebGL.'; }); }
  const filas = visibles().map(([p, j]) => { const t = estado?.trip?.[j] || {}; const e = estadoMente(t);
    return `<span>${esc(p.corto)}</span><span><b>${fmt('animo', t.animo)}</b><small>/5</small></span><span><b>${fmt('energia', t.energia)}</b><small>/5</small></span><span><b>${fmt('sueno_h', t.sueno_h)}</b><small> h</small> <small style="color:${e.k === 'estres' ? 'var(--at)' : e.k === 'fatiga' ? 'var(--nv)' : 'var(--ok)'}">· ${e.n}</small></span>`; }).join('');
  c.insertAdjacentHTML('beforeend', `<div class="filas4"><span class="h">Crew</span><span class="h">Mood</span><span class="h">Energy</span><span class="h">Sleep</span>${filas}</div>
    <p style="font-size:14px;color:var(--t3)">A conceptual picture driven by each person's shared check-in and live signals. It is not an EEG or a medical image.</p>`);
  ponerCerebro();
}
let tCerebro = 0;
function ponerCerebro() {
  const e = estadoMente(estado?.trip?.[mT]);
  const el = $('mEst'); if (el) el.innerHTML = `${esc(crew[mT]?.corto || '')} · ${e.n}<span>${esc(e.por.join(' · '))}</span>`;
  const cb = window.__cerebro3d;
  if (cb?.cambiarEstado) { cb.cambiarEstado(e.k); cb.enfocar?.({ estres: ['temporal', 'tronco'], fatiga: ['frontal'], activacion: ['frontal', 'temporal', 'tronco'] }[e.k] || []); }
  else if (tCerebro++ < 20) setTimeout(ponerCerebro, 500);
}

/* biblioteca: búsqueda local en las fuentes de a bordo */
async function buscar(q) {
  q = q.trim(); if (!q) return;
  $('bres').innerHTML = '<p>Searching the onboard library…</p>';
  try {
    const r = await api(`/v1/biblioteca/buscar?q=${encodeURIComponent(q)}`);
    $('bres').innerHTML = (r || []).slice(0, 8).map(x => `<div class="res"><span class="de">${esc(x.editor || x.fuente)}${x.anio ? ` · ${x.anio}` : ''}${x.pagina ? ` · p. ${x.pagina}` : ''}</span><p>${esc((x.texto || '').slice(0, 320))}…</p><small>${esc(x.seccion || '')} · ${esc(x.licencia || '')}</small></div>`).join('') || '<p>Nothing found.</p>';
  } catch { $('bres').innerHTML = '<p>The library search is not running.</p>'; }
}

/* misión: el sistema solar interior con la nave, y el retraso de la luz */
function hojaMision() {
  const m = misionE; if (!m) return;
  const S = 150, cx = 360, cy = 300, p = ([x, y]) => [cx + x * S, cy - y * S];
  const [tx, ty] = p(m.tierra_ua), [mx, my] = p(m.marte_ua), [nx, ny] = p(m.nave_ua);
  $('hojaCuerpo').innerHTML = `<div class="orb caja" style="padding:10px"><svg viewBox="0 0 720 600">
      <circle cx="${cx}" cy="${cy}" r="${S}" fill="none" stroke="rgba(70,200,232,.25)"/><circle cx="${cx}" cy="${cy}" r="${S * 1.524}" fill="none" stroke="rgba(242,180,87,.22)"/>
      <circle cx="${cx}" cy="${cy}" r="30" fill="rgba(242,212,138,.12)"/><circle cx="${cx}" cy="${cy}" r="14" fill="#f2d48a"/>
      <line x1="${tx}" y1="${ty}" x2="${nx}" y2="${ny}" stroke="rgba(143,230,245,.6)" stroke-dasharray="4 6"/>
      <circle cx="${tx}" cy="${ty}" r="9" fill="#46c8e8"/><text x="${tx + 14}" y="${ty + 5}" fill="#bfeffa" font-family="SG" font-size="16">Earth</text>
      <circle cx="${mx}" cy="${my}" r="8" fill="#f2b457"/><text x="${mx + 14}" y="${my + 5}" fill="#f6d7a1" font-family="SG" font-size="16">Mars</text>
      <circle cx="${nx}" cy="${ny}" r="14" fill="none" stroke="rgba(255,255,255,.4)"/><circle cx="${nx}" cy="${ny}" r="6" fill="#fff"/><text x="${nx + 16}" y="${ny - 10}" fill="#fff" font-family="SG" font-size="16">NOVA ship</text>
      <text x="${(tx + nx) / 2}" y="${(ty + ny) / 2 - 10}" fill="#8fe6f5" font-family="SG" font-size="15" text-anchor="middle">${(m.luz_seg / 60).toFixed(1)} light-min</text></svg></div>
    <div class="signos">
      <div class="signo"><em>Mission day</em><b>${m.dia}<small>of ${m.total_dias}</small></b><span>${m.fase === 'cruise' ? 'cruise to Mars' : esc(m.fase)}</span></div>
      <div class="signo"><em>Mars arrival</em><b>${Math.round(m.llegada_en_dias)}<small>days</small></b><span>transfer of ${m.transferencia_dias} days</span></div>
      <div class="signo"><em>Earth, one way</em><b>${(m.luz_seg / 60).toFixed(1)}<small>min</small></b><span>a question and its answer: ${(m.luz_seg / 30).toFixed(0)} min</span></div>
      <div class="signo"><em>Distance to Earth</em><b>${(m.distancia_km / 1e6).toFixed(0)}<small>million km</small></b><span>${m.conjuncion ? 'solar conjunction · link down' : `Sun–Earth angle ${m.elongacion_grados.toFixed(0)}°`}</span></div>
    </div>`;
}

/* un tripulante, lo que comparte con todos */
const series = {};
async function serie(trip, k) {
  const c = `${trip}/${k}`, s = series[c];
  if (s && performance.now() - s.t < 30000) return s.d;
  try { const d = await api(`/v1/historia?trip=${trip}&k=${k}&seg=21600&puntos=60`); series[c] = { t: performance.now(), d }; return d; } catch { return null; }
}
function linea(d, col) {
  const v = (d?.v || []).filter(x => x != null && isFinite(x)); if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
  return `<svg viewBox="0 0 300 44" preserveAspectRatio="none"><polyline points="${v.map((x, i) => `${(i / (v.length - 1) * 300).toFixed(1)},${(40 - (x - lo) / r * 34).toFixed(1)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}
function hojaTri(i) {
  const c = crew[i], t = estado?.trip?.[i] || {};
  const ks = ['pulso', 'spo2', 'pa_sis', 'temp', 'fr', 'glucosa'];
  $('hojaCuerpo').innerHTML = `<div class="signos">${ks.map(k => { const n = t.niveles?.[k] || 'sin_dato';
    return `<div class="signo" style="${RANGO[n] >= 3 ? `border-color:${COL[n]}` : ''}"><em>${NOMBRE[k]}</em><b>${k === 'pa_sis' ? `${fmt(k, t.pa_sis)}/${fmt(k, t.pa_dia)}` : fmt(k, t[k])}<small>${UNIDAD[k]}</small></b><div id="sp-${k}"></div><span>${NIVEL_TXT[n] || 'no data yet'} · last 6 h</span></div>`; }).join('')}</div>
    <div class="signos">${['sueno_h', 'animo', 'energia'].map(k => `<div class="signo"><em>${NOMBRE[k]}</em><b>${fmt(k, t[k])}<small>${UNIDAD[k]}</small></b><span>${t.edades?.[k] ? 'shared check-in' : 'not shared today'}</span></div>`).join('')}
      <button class="signo" data-mente="${i}" style="text-align:left;justify-content:center"><em>Mind</em><b style="font-size:22px">See ${esc(c.corto)}'s brain →</b></button></div>
    <p style="font-size:14px;color:var(--t3)">Only what the crew shares with everyone. Private data opens with ${esc(c.corto)}'s card.</p>`;
  for (const k of ks) serie(c.id, k).then(d => { const el = $('sp-' + k); if (el) el.innerHTML = linea(d, COL[t.niveles?.[k]] || '#46c8e8'); });
}

/* check-in */
const check = { sueno_h: 7, animo: 0, energia: 0 };
function pintarCheck() {
  const e5 = k => `<div class="escala">${[1, 2, 3, 4, 5].map(v => `<button data-k="${k}" data-v="${v}" class="${check[k] === v ? 'on' : ''}">${v}</button>`).join('')}</div>`;
  $('hojaCuerpo').innerHTML = `<p>Your check-in goes to the ship with your name. The crew sees mood and energy only because you share them here.</p>
    <div class="caja"><span class="lbl">Sleep last night</span><div class="paso"><button data-sueno="-0.5">−</button><b>${check.sueno_h.toFixed(1)} h</b><button data-sueno="0.5">+</button></div></div>
    <div class="caja"><span class="lbl">Mood · 1 low, 5 great</span>${e5('animo')}</div>
    <div class="caja"><span class="lbl">Energy · 1 drained, 5 full</span>${e5('energia')}</div>
    <div class="fila"><button class="pri" id="mandarCheck" ${check.animo && check.energia ? '' : 'disabled'}>Share my day</button></div>`;
}
/* medir */
let medS = 'pa', medV = ['', ''], medI = 0;
function pintarMedir() {
  const d = REGM[medS], val = i => `<span class="${medI === i ? 'cur' : ''}">${medV[i] || '–'}</span>`;
  const vivo = performance.now() - ecg.t < 3000 && ecg.contacto && ecg.bpm;
  const sensor = medS !== 'pulso' ? '' : `<div class="caja ecgaviso"><div><b>${vivo ? `The heart board is reading you: ${Math.round(ecg.bpm)} bpm` : 'The heart board measures this for you'}</b>
      <span>${vivo ? 'Open the live ECG and it is saved to your record while you watch it. No need to type it.' : 'Put on the electrodes and open the live ECG: NOVA reads your pulse and its variability, saved with your name.'}</span></div>
      <button class="pri" data-abrir-ecg>Open live ECG</button></div>`;
  $('hojaCuerpo').innerHTML = `<div class="chipsel">${Object.entries(REGM).map(([k, r]) => `<button data-s="${k}" class="${k === medS ? 'on' : ''}">${r.n}</button>`).join('')}</div>
    ${sensor}<div class="caja"><div class="valor">${val(0)}${d.dos ? ` / ${val(1)}` : ''}<small>${d.u}</small></div><p class="como">${d.como}</p>
      <div class="teclado">${['1', '2', '3', '4', '5', '6', '7', '8', '9', d.dec ? '.' : '', '0', '⌫'].map(k => `<button data-t="${k}" ${k ? '' : 'disabled style="visibility:hidden"'}>${k}</button>`).join('')}</div></div>
    <div class="fila"><button class="pri" id="guardarMed">Save</button></div>`;
}
/* casa */
async function cargarCasa() {
  if (!sesion) return;
  try { casa = await api(`/v1/casa?trip=${sesion.trip}`); } catch { casa = null; }
  const n = casa?.mensajes?.length || 0; $('casaN').hidden = !n; $('casaN').textContent = n;
  if (hojaTipo === 'casa') pintarCasa();
}
let respA = '';
function pintarCasa() {
  if (!casa) { $('hojaCuerpo').innerHTML = '<p>Loading your messages…</p>'; cargarCasa(); return; }
  const hora = ms => new Date(ms).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  $('hojaCuerpo').innerHTML = `<p>${casa.en_camino ? `${casa.en_camino} message${casa.en_camino > 1 ? 's' : ''} on the way from Earth.` : 'Messages from your family arrive here with the real light delay.'}</p>`
    + ((casa.mensajes || []).map(m => `<div class="msg"><div class="de"><b>${esc(m.de)}</b><span>${esc(m.relacion || '')} · ${hora(m.llega)}</span></div>${m.texto ? `<p>${esc(m.texto)}</p>` : ''}${m.archivo ? `<img src="${BASE}/v1/casa/archivo/${encodeURIComponent(m.id)}" alt="">` : ''}<button class="sec" data-responder="${esc(m.id)}" data-de="${esc(m.de)}">Reply</button></div>`).join('') || '<div class="caja"><p>No messages yet.</p></div>')
    + ((casa.respuestas || []).slice(0, 3).map(r => `<div class="msg" style="opacity:.75"><div class="de"><b>You</b><span>${r.estado === 'enviado' ? 'sent to Earth' : 'waiting for the next contact'}</span></div><p>${esc(r.texto)}</p></div>`).join(''))
    + `<div class="caja" id="respCaja" hidden><span class="lbl" id="respA">Reply</span><textarea id="respTxt" maxlength="1000" placeholder="Write your message"></textarea><div class="fila"><button class="pri" id="respMandar">Send home</button><button class="sec" id="respX">Cancel</button></div></div>`;
}

/* un solo manejador para todo lo que se toca dentro de las hojas */
$('hoja').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.mt != null) { hojaMente(+b.dataset.mt); return; }
  if (b.dataset.mente != null) { abrirHoja('mente', +b.dataset.mente); return; }
  if (b.dataset.tomar) {
    try { const r = await accion('kit', { id: b.dataset.tomar, cantidad: 1 }); avisar(`Logged with your name · ${r.cantidad} left`, 'bien'); await leerKit(); pintarRack(); listaKit(); } catch (err) { avisar(String(err.message || err), 'mal'); }
    return;
  }
  // check-in
  if (b.dataset.sueno) { check.sueno_h = Math.max(0, Math.min(16, check.sueno_h + +b.dataset.sueno)); pintarCheck(); }
  if (b.dataset.k) { check[b.dataset.k] = +b.dataset.v; pintarCheck(); }
  if (b.id === 'mandarCheck') { try { await accion('checkin', check); avisar('Check-in shared', 'bien'); nova.expr('feliz', 1800); check.animo = check.energia = 0; cerrarHoja(); } catch (err) { avisar(String(err.message || err), 'mal'); } }
  // medir
  if (b.dataset.s) { medS = b.dataset.s; medV = ['', '']; medI = 0; pintarMedir(); }
  if (b.dataset.t) {
    const k = b.dataset.t, d = REGM[medS];
    if (k === '⌫') { if (!medV[medI] && medI > 0) medI--; else medV[medI] = medV[medI].slice(0, -1); }
    else if (medV[medI].length < 5) { medV[medI] += k; if (d.dos && medI === 0 && medV[0].length === 3) medI = 1; }
    pintarMedir();
  }
  if (b.id === 'guardarMed') {
    const d = REGM[medS], vals = medV.slice(0, d.dos ? 2 : 1).map(parseFloat);
    if (vals.some((v, i) => !isFinite(v) || v < d.r[i][0] || v > d.r[i][1])) { avisar('That value is out of range', 'mal'); return; }
    const envios = medS === 'pa' ? [['pa_sis', vals[0]], ['pa_dia', vals[1]]] : [[medS, vals[0]]];
    try { for (const [sensor, valor] of envios) await accion('medir', { sensor, valor }); avisar(`${d.n} saved`, 'bien'); medV = ['', '']; medI = 0; cerrarHoja(); } catch (err) { avisar(String(err.message || err), 'mal'); }
  }
  // casa
  if (b.dataset.responder) { respA = b.dataset.responder; $('respCaja').hidden = false; $('respA').textContent = `Reply to ${b.dataset.de}`; $('respTxt').focus(); $('respCaja').scrollIntoView({ behavior: 'smooth' }); }
  if (b.id === 'respX') $('respCaja').hidden = true;
  if (b.id === 'respMandar') {
    const texto = $('respTxt').value.trim(); if (!texto) return;
    try { await accion('casa', { a: respA, texto }); avisar('Queued for the next contact with Earth', 'bien'); casa = null; } catch (err) { avisar(String(err.message || err), 'mal'); }
    pintarCasa();
  }
});

/* ── emergencia: sin tarjeta, con la guía fija de la nave ── */
let proc = null, procQuien = null;
function abrirEmergencia() {
  proc = null; procQuien = null; $('guia').hidden = false;
  $('guiaCaja').innerHTML = `<div class="gcab">Emergency<b><button class="sec" data-g="cerrar" style="height:52px">Close</button></b></div><div class="gtxt">Who needs help?</div>
    <div class="elige">${visibles().map(([c]) => c).map(c => `<button data-quien="${c.id}">${esc(c.corto)}<span>${esc(c.rol || '')}</span></button>`).join('')}</div>`;
}
function pintarGuia() {
  const s = proc?.paso; if (!s) return;
  const bot = s.tipo === 'pregunta' ? `<button class="pri" data-r="si">Yes</button><button data-r="no">No</button>` : s.tipo === 'accion' ? `<button class="pri" data-r="hecho">Done</button>`
    : s.tipo === 'espera' ? `<button data-r="mejor">Better now</button><button data-r="peor">Not better</button>` : `<button class="pri" data-g="cerrar">Finish</button>`;
  $('guiaCaja').innerHTML = `<div class="gcab">${esc(proc.p.titulo)} · ${esc(procQuien.corto)}<b>step ${proc.historial.length}</b></div><div class="gtxt">${esc(proc.texto(s.texto))}</div>${s.tipo === 'espera' ? '<div class="gtiempo" id="gTiempo"></div>' : ''}<div class="gacc">${bot}</div><button class="sec" data-g="repetir">Say it again</button>`;
}
setInterval(() => { const el = $('gTiempo'); if (el && proc) { const r = proc.restante() || 0; el.textContent = `${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}`; } }, 250);
$('btnEmer').onclick = abrirEmergencia;
$('guia').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.g === 'cerrar') { if (proc) postJ('/v1/bitacora', { tipo: 'emergencias', datos: { protocolo: proc.p.id, trip: procQuien?.id, fin: true, desde: 'station', lector: LECTOR } }).catch(() => {}); proc = null; $('guia').hidden = true; try { callar(); } catch {} return; }
  if (b.dataset.g === 'repetir' && proc) { decirNova(proc.texto(proc.paso.texto)); return; }
  if (b.dataset.quien) { procQuien = crew.find(c => c.id === b.dataset.quien);
    $('guiaCaja').innerHTML = `<div class="gcab">Emergency · ${esc(procQuien.corto)}<b><button class="sec" data-g="cerrar" style="height:52px">Close</button></b></div><div class="gtxt">What is happening?</div>
      <div class="glista">${PROTOCOLOS.filter(p => (p.guia || []).length).map(p => `<button data-proto="${p.id}"><b>${esc(p.titulo)}</b><span>${esc(p.cuando || '')}</span></button>`).join('')}</div>`; return; }
  if (b.dataset.proto) {
    proc = new Procedimiento(PROTOCOLOS, b.dataset.proto, procQuien, t => decirNova(t), (tipo, texto) => postJ('/v1/bitacora', { tipo: 'emergencias', datos: { protocolo: b.dataset.proto, trip: procQuien.id, tipo, texto, desde: 'station', lector: LECTOR } }).catch(() => {}));
    pintarGuia(); return;
  }
  if (b.dataset.r && proc) { const r = b.dataset.r; if (r === 'mejor' || r === 'peor') proc.cerrarEspera(r, tr(procQuien.id)); else proc.responder(r); pintarGuia(); }
});

/* ── hablar con NOVA ── */
const charla = [];
let decirHasta = 0;
function pintarCharla() {
  $('charla').innerHTML = charla.map(m => m.yo ? `<div class="yo">${esc(m.texto)}</div>` : `<div class="ella">${m.texto ? esc(m.texto) : '<span class="pensando">Thinking…</span>'}${m.fuentes ? `<small>${esc(m.fuentes)}</small>` : ''}</div>`).join('');
  $('charla').scrollTop = 1e6;
}
function abrirCharla() {
  cerrarHoja(); $('charlaCaja').hidden = false;
  $('charlaTit').textContent = sesion ? `For ${sesion.persona?.corto || sesion.trip}` : 'For the crew';
  if (!charla.length) { charla.push({ texto: sesion ? `What can I do for you, ${sesion.persona?.corto || ''}?` : 'Ask me about the crew, the ship or the medical library.' }); pintarCharla(); }
  try { desbloquearVoz(); } catch {}
}
function cerrarCharla() { $('charlaCaja').hidden = true; pararMic(); }
$('charlaX').onclick = cerrarCharla;
$('preg').onsubmit = e => { e.preventDefault(); const q = $('pregIn').value.trim(); if (q) { $('pregIn').value = ''; preguntar(q); } };
window.stationPreguntar = q => preguntar(q);
async function preguntar(q) {
  abrirCharla();
  const previos = charla.filter(m => m.texto).slice(-6).map(m => ({ rol: m.yo ? 'yo' : 'nova', texto: m.texto }));
  charla.push({ yo: true, texto: q }); const r = { texto: '' }; charla.push(r); pintarCharla();
  nova.pensar(true);
  let porDecir = '';
  try {
    const resp = await fetch(BASE + '/v1/preguntar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pregunta: q, previos, quien: sesion?.trip }) });
    const lector = resp.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await lector.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const bloques = buf.split('\n\n'); buf = bloques.pop();
      for (const bloque of bloques) {
        const l = bloque.split('\n').find(x => x.startsWith('data:')); if (!l) continue;
        let d; try { d = JSON.parse(l.slice(5)); } catch { continue; }
        if (d.t) { r.texto += d.t; porDecir += d.t; const fr = porDecir.match(/^[\s\S]*?[.!?](\s|$)/); if (fr) { decirNova(fr[0].trim(), false); porDecir = porDecir.slice(fr[0].length); } pintarCharla(); }
        if (Array.isArray(d.fuentes) && d.fuentes.length) r.fuentes = 'Sources: ' + d.fuentes.map(c => c.titulo || c.editor || c.fuente).filter(Boolean).slice(0, 3).join(' · ');
      }
    }
    if (porDecir.trim()) decirNova(porDecir.trim(), false);
  } catch { r.texto = 'The onboard model is not answering right now.'; }
  nova.pensar(false); pintarCharla();
}
function decirNova(texto, nuevo = true) {
  if (!texto) return;
  if (!MUDO) { try { hablar(texto, { nuevo }); } catch {} }
  if (!document.body.classList.contains('personal')) { $('dice').innerHTML = esc(texto); decirHasta = performance.now() + Math.max(5000, texto.length * 80); }
}

/* micrófono: en la APK lo maneja Android; en un navegador seguro, la página (WAV a /v1/oir) */
let micOn = false, micStream = null, micCtx = null, micBuf = [], micHz = 16000, tVoz = 0, hayVoz = false;
async function escuchar() {
  if (MUDO) return;
  abrirCharla();
  if (micOn) { pararMic(true); return; }
  try { callar(); } catch {}
  micOn = true; $('mic').classList.add('on'); nova.oir(true);
  if (APP) { nativo({ tipo: 'escuchar' }); return; }
  if (!navigator.mediaDevices?.getUserMedia) { micOn = false; $('mic').classList.remove('on'); nova.oir(false); avisar('No microphone on this screen: type your question', 'mal'); return; }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    micCtx = new AudioContext(); micHz = micCtx.sampleRate;
    const src = micCtx.createMediaStreamSource(micStream), pr = micCtx.createScriptProcessor(4096, 1, 1);
    micBuf = []; hayVoz = false; tVoz = performance.now();
    pr.onaudioprocess = e => {
      const x = e.inputBuffer.getChannelData(0); micBuf.push(new Float32Array(x));
      let s = 0; for (const v of x) s += v * v; const rms = Math.sqrt(s / x.length);
      nova.nivelMic = Math.min(1, rms * 8);
      if (rms > .02) { hayVoz = true; tVoz = performance.now(); }
      if ((hayVoz && performance.now() - tVoz > 1200) || micBuf.length * 4096 / micHz > 20) pararMic(true);
    };
    src.connect(pr); pr.connect(micCtx.destination);
  } catch { pararMic(); avisar('Microphone not allowed', 'mal'); }
}
function pararMic(enviar = false) {
  if (!micOn) return;
  micOn = false; $('mic').classList.remove('on'); nova.oir(false); nova.nivelMic = 0;
  if (APP) { nativo({ tipo: 'parar' }); return; }
  try { micStream?.getTracks().forEach(t => t.stop()); micCtx?.close(); } catch {}
  if (enviar && hayVoz && micBuf.length) mandarAudio(aWav(micBuf, micHz));
}
function aWav(bloques, hz) {
  const n = bloques.reduce((a, b) => a + b.length, 0), f = 16000 / hz, m = Math.floor(n * f), d = new DataView(new ArrayBuffer(44 + m * 2));
  const todo = new Float32Array(n); let o = 0; for (const b of bloques) { todo.set(b, o); o += b.length; }
  const w = (p, s) => [...s].forEach((c, i) => d.setUint8(p + i, c.charCodeAt(0)));
  w(0, 'RIFF'); d.setUint32(4, 36 + m * 2, true); w(8, 'WAVE'); w(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, 16000, true); d.setUint32(28, 32000, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, m * 2, true);
  for (let i = 0; i < m; i++) d.setInt16(44 + i * 2, Math.max(-1, Math.min(1, todo[Math.floor(i / f)])) * 32767, true);
  return d.buffer;
}
async function mandarAudio(wav) {
  nova.pensar(true);
  try { const r = await fetch(BASE + '/v1/oir', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav }); const j = await r.json(); if (j.texto?.trim()) preguntar(j.texto.trim()); else nova.pensar(false); }
  catch { nova.pensar(false); avisar('I could not hear that', 'mal'); }
}
$('mic').onclick = escuchar;
window.novaApp = msg => {
  if (['qr', 'qrCerrado', 'qrAbierto', 'error'].includes(msg?.tipo)) clearTimeout(tQrNativo);
  if (msg?.tipo === 'qr') { entrarConQR(msg.texto); return; }
  if (msg?.tipo === 'qrCerrado') { $('escanerQR').hidden = true; return; }
  if (msg?.tipo === 'oido') { micOn = false; $('mic').classList.remove('on'); nova.oir(false); if (msg.texto?.trim()) preguntar(msg.texto.trim()); }
  if (msg?.tipo === 'nivel') nova.nivelMic = msg.v || 0;
  if (msg?.tipo === 'error') { micOn = false; $('mic').classList.remove('on'); nova.oir(false); avisar(msg.texto || 'Microphone error', 'mal'); }
};

/* ── NOVA: al centro de la órbita o al lado de tu cuerpo; se arrastra, se levanta, salta y vuelve a su lugar ── */
const CARAS = ['feliz', 'sorprendida', 'pensativa', 'triste', 'dormida', 'normal'];
let radNova = 0, radSpe = false;   // radSpe: hay tormenta solar (lo marca radStation)   // tormenta solar: NOVA pasa a ámbar e inquieta, de a poco
const nova = (() => {
  const el = $('nova'), svg = $('novaSvg'), toque = $('novaToque'), R = 100;
  svg.setAttribute('viewBox', `${-R * 2.4} ${-R * 2.4} ${R * 4.8} ${R * 4.8}`);
  let x = innerWidth / 2, y = innerHeight / 2, vx = 0, vy = 0, escala = 1, escObj = 1, arrastre = null, levantada = 0, salto = 0;
  let exprTmp = null, tExpr = 0, piensa = false, oye = false, mira = [0, .25], tMira = 0;
  const api = { nivelMic: 0 };
  const casa = () => {
    if (document.body.classList.contains('personal')) return { x: 84, y: 76 + 70, s: .3 };
    const e = $('escena').getBoundingClientRect();
    return { x: e.left + e.width / 2, y: e.top + e.height / 2, s: Math.max(.5, Math.min(1, Math.min(e.width - 300, e.height) / 470)) };
  };
  api.alInicio = () => { escObj = casa().s; };
  api.expr = (e, ms = 1500) => { exprTmp = e; tExpr = performance.now() + ms; };
  api.pensar = v => { piensa = v; }; api.oir = v => { oye = v; };
  addEventListener('pointerdown', e => { if (arrastre) return; const dx = e.clientX - x, dy = e.clientY - y, d = Math.hypot(dx, dy) || 1; mira = [dx / d * .8, dy / d * .6]; tMira = performance.now() + 1800; });
  let tToque = 0, tLevantar = 0, tTap = 0;
  toque.addEventListener('pointerdown', e => {
    toque.setPointerCapture(e.pointerId);
    arrastre = { x0: e.clientX, y0: e.clientY, ox: x, oy: y, mov: false, t: performance.now(), hist: [[performance.now(), e.clientX, e.clientY]], rec: 0, cara: -1 };
    clearTimeout(tLevantar);
    tLevantar = setTimeout(() => { if (arrastre && !arrastre.mov) { levantada = 1; nativo({ tipo: 'vibrar', ms: 20 }); api.expr('sorprendida', 900); } }, 420);
  });
  toque.addEventListener('pointermove', e => {
    if (!arrastre) return;
    const dx = e.clientX - arrastre.x0, dy = e.clientY - arrastre.y0;
    if (!arrastre.mov && Math.hypot(dx, dy) > 10) { arrastre.mov = true; levantada = 1; clearTimeout(tLevantar); }
    if (!arrastre.mov) return;
    const nx = arrastre.ox + dx, ny = arrastre.oy + dy; arrastre.rec += Math.hypot(nx - x, ny - y); x = nx; y = ny;
    const c = Math.floor(arrastre.rec / 70) % CARAS.length; if (c !== arrastre.cara) { arrastre.cara = c; exprTmp = CARAS[c]; tExpr = performance.now() + 600; }
    arrastre.hist.push([performance.now(), e.clientX, e.clientY]); if (arrastre.hist.length > 6) arrastre.hist.shift();
  });
  const soltar = () => {
    if (!arrastre) return;
    clearTimeout(tLevantar);
    const a = arrastre; arrastre = null; levantada = 0;
    if (a.mov) { const h = a.hist, p = h[0], q = h[h.length - 1], dt = Math.max(16, q[0] - p[0]); vx = (q[1] - p[1]) / dt * 16; vy = (q[2] - p[2]) / dt * 16; api.expr('feliz', 900); return; }
    const ahora = performance.now(); if (ahora - a.t > 420) return;
    if (ahora - tToque < 320) { salto = 1; api.expr('feliz', 1200); tToque = 0; clearTimeout(tTap); return; }
    tToque = ahora; tTap = setTimeout(() => { escuchar(); }, 320);
  };
  toque.addEventListener('pointerup', soltar); toque.addEventListener('pointercancel', soltar);
  function cuadro(ms) {
    requestAnimationFrame(cuadro);
    const t = ms / 1000, c = casa();
    escObj = c.s;
    if (!arrastre) { vx += (c.x - x) * .045; vy += (c.y - y) * .045; vx *= .8; vy *= .8; x += vx; y += vy; } // un resorte la devuelve a su lugar
    escala += ((levantada ? escObj * 1.12 : escObj) - escala) * .15;
    salto *= .93;
    const sy = salto > .02 ? Math.sin((1 - salto) * Math.PI * 3) * salto * 60 * escala : 0;
    el.style.transform = `translate(${x}px,${y - sy}px) scale(${escala})`;
    const ahora = performance.now();
    const alerta = estado?.trip?.some(tt => tt.nivel === 'aviso_tierra') ? 1 : 0;
    const hablaV = typeof hablandoVoz === 'function' && hablandoVoz() ? Math.min(1, nivelVoz * 1.6) : 0;
    radNova += ((radSpe ? 1 : 0) - radNova) * .03;
    const inquieta = radNova > .5;
    const expr = ahora < tExpr && exprTmp ? exprTmp : inquieta ? 'inquieta' : piensa ? 'pensativa' : oye ? 'sorprendida' : hablaV > .05 ? 'feliz' : 'normal';
    // inquieta: de vez en cuando mira hacia el Sol (a la izquierda) y vuelve
    const m = ahora < tMira ? mira : inquieta && (t % 4.6) < .8 ? [-.9, -.15] : [Math.sin(t * .4) * .25, .15];
    const velP = arrastre ? [Math.max(-1, Math.min(1, (arrastre.hist.at(-1)[1] - arrastre.hist[0][1]) / 120)), Math.max(-1, Math.min(1, (arrastre.hist.at(-1)[2] - arrastre.hist[0][2]) / 120))] : [vx / 30, vy / 30];
    svg.innerHTML = mascotaOrbes({ x: 0, y: 0, R, t, expr, orbes: 6, mira: m, parpadeo: (t % 3.7) < .13 ? 1 : 0, habla: Math.max(hablaV, oye ? api.nivelMic * .6 : 0), vel: velP, estira: salto * Math.sin(t * 20) * .6, alerta, radiacion: radNova });
  }
  requestAnimationFrame(cuadro);
  return api;
})();

/* ── QR personal: la app del teléfono muestra un código de un solo uso que cambia cada 30 s ── */
async function entrarConQR(texto) {
  $('escanerQR').hidden = true; pararQRWeb();
  const codigo = String(texto || '').trim();
  if (!codigo.startsWith('nova-qr:')) { avisar('That is not a NOVA crew QR', 'mal'); return; }
  try { await postJ('/v1/qr/entrar', { codigo, lector: LECTOR }); nativo({ tipo: 'vibrar' }); } catch (err) { avisar(String(err.message || err), 'mal'); }
  leerSesion();
}
let qrStream = null, qrBucle = 0, tQrNativo = 0;
function pararQRWeb() { cancelAnimationFrame(qrBucle); try { qrStream?.getTracks().forEach(t => t.stop()); } catch {} qrStream = null; }
async function escanearQR() {
  // en la APK escanea Android con la cámara de la tablet; en un navegador seguro, la página con BarcodeDetector
  if (APP) {
    // si la app de la tablet es anterior a 0.2.0 no tiene cámara: no responde y hay que avisar (la 0.2.0 tapa este aviso con su cámara)
    nativo({ tipo: 'escanearQR' }); clearTimeout(tQrNativo);
    tQrNativo = setTimeout(() => avisar('This tablet needs NOVA Station 0.2.0 or newer to scan QR codes', 'mal'), 2500);
    return;
  }
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) { avisar('QR scanning works in the NOVA Station app on the tablet', 'mal'); return; }
  try {
    const det = new BarcodeDetector({ formats: ['qr_code'] }), v = $('qrVideo');
    qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    v.srcObject = qrStream; await v.play(); $('escanerQR').hidden = false;
    const mirar = async () => { try { const r = await det.detect(v); if (r[0]?.rawValue) { entrarConQR(r[0].rawValue); return; } } catch {} qrBucle = requestAnimationFrame(mirar); };
    mirar();
  } catch { pararQRWeb(); avisar('Camera not available', 'mal'); }
}
$('chipQR').onclick = escanearQR;
$('chipNFC').onclick = () => avisar('Hold your crew card to the reader on the station', 'bien');
$('qrCancelar').onclick = () => { $('escanerQR').hidden = true; pararQRWeb(); };

/* ── tu tarjeta: «Link a card» deja la próxima tarjeta que pase por el lector a tu nombre ── */
async function misTarjetas() {
  try { const r = await accion('tarjetas'); $('tarjetaTxt').textContent = r.tarjetas ? `${r.tarjetas} card${r.tarjetas > 1 ? 's' : ''} linked · or use your QR` : 'No card yet · you can use your QR'; $('vincular').textContent = r.tarjetas ? 'Link another' : 'Link a card'; } catch {}
}
let tVinculo = 0, relojVinculo = 0;
$('vincular').onclick = async () => {
  try { await accion('vincular'); } catch (err) { avisar(String(err.message || err), 'mal'); return; }
  $('vinculo').hidden = false; tVinculo = performance.now();
  clearInterval(relojVinculo);
  relojVinculo = setInterval(() => { const q = Math.max(0, 45 - Math.floor((performance.now() - tVinculo) / 1000)); $('vCuenta').textContent = q; if (!q) { clearInterval(relojVinculo); $('vinculo').hidden = true; avisar('No card was read. Try again.', 'mal'); } }, 250);
};
$('vCancelar').onclick = () => { clearInterval(relojVinculo); $('vinculo').hidden = true; accion('no_vincular').catch(() => {}); };
function tarjetaVinculada() {
  clearInterval(relojVinculo); $('vinculo').hidden = true;
  avisar('Card linked · it opens your space from now on', 'bien'); nova.expr('feliz', 1800); nativo({ tipo: 'vibrar' });
  misTarjetas();
}

/* ── arranque ── */
await cargarBase();
leerMision(); setInterval(leerMision, 30000);
leerEstado(); setInterval(leerEstado, 5000);
leerKit();
conectar();
leerSesion(); setInterval(leerSesion, 3000);
setInterval(() => { if (sesion) cargarCasa(); }, 60000);
setTimeout(lazos, 300);
nativo({ tipo: 'lista', lector: LECTOR });
window.__station = { get sesion() { return sesion; }, nova, abrirHoja };

/* ── espejo en vivo: la tablet de verdad cuenta qué muestra y la copia del PC (station.html?mudo) muestra lo mismo ──
   La sesión (quién entró con su tarjeta) ya es de la nave; esto agrega lo que se abre encima: la hoja (kit, check-in,
   medir, biblioteca, misión, un tripulante, casa), la charla con NOVA y la guía de emergencia. */
const HTML_HOJA = new Set(['check', 'medir', 'biblio']);   // hojas que cambian al tocarlas: viaja su contenido
function fotoPantalla() {
  const charlaAbierta = !$('charlaCaja').hidden, guiaAbierta = !$('guia').hidden;
  return {
    hoja: hojaTipo, arg: hojaArg, scroll: hojaTipo ? Math.round($('hojaCuerpo').scrollTop) : 0,
    html: hojaTipo && HTML_HOJA.has(hojaTipo) ? $('hojaCuerpo').innerHTML.slice(0, 40000) : null,
    charla: charlaAbierta ? { tit: $('charlaTit').textContent, m: charla.slice(-10).map(m => ({ yo: !!m.yo, texto: m.texto || '', fuentes: m.fuentes || '' })) } : null,
    guia: guiaAbierta ? $('guiaCaja').innerHTML.slice(0, 20000) : null,
  };
}
if (!MUDO) {
  let ultimaFoto = '', enviando = false;
  setInterval(async () => {
    if (enviando) return;
    const f = JSON.stringify(fotoPantalla()); if (f === ultimaFoto) return;
    enviando = true;
    try { await postJ('/v1/station/pantalla', { lector: LECTOR, foto: JSON.parse(f) }); ultimaFoto = f; } catch {}
    enviando = false;
  }, 350);
}
function espejo(f) {
  if (!f) return;
  if (f.hoja !== hojaTipo || JSON.stringify(f.arg ?? null) !== JSON.stringify(hojaArg)) { if (f.hoja) abrirHoja(f.hoja, f.arg ?? undefined); else if (hojaTipo) cerrarHoja(); }
  if (f.hoja && f.html != null && $('hojaCuerpo').innerHTML !== f.html) $('hojaCuerpo').innerHTML = f.html;
  if (f.hoja) $('hojaCuerpo').scrollTop = f.scroll || 0;
  if (f.charla) {
    $('charlaCaja').hidden = false; $('charlaTit').textContent = f.charla.tit || '';
    charla.length = 0; f.charla.m.forEach(m => charla.push(m)); pintarCharla();
  } else if (!$('charlaCaja').hidden) $('charlaCaja').hidden = true;
  if (f.guia) { $('guia').hidden = false; if ($('guiaCaja').innerHTML !== f.guia) $('guiaCaja').innerHTML = f.guia; }
  else if (!$('guia').hidden) $('guia').hidden = true;
}
if (MUDO) api(`/v1/station/pantalla?lector=${LECTOR}`).then(r => setTimeout(() => espejo(r.foto), 1500)).catch(() => {});

/* ── electrocardiograma de la estación (AD8232 de Luis, por su puente: POST /v1/estacion/onda) ──
   Solo existe dentro del espacio de una persona (con su tarjeta o QR): el botón ECG del dock marca «live» cuando hay
   señal y la medición empieza al entrar a la hoja. El puente guarda el pulso a nombre de esa persona cada 2 s solo
   mientras esta hoja está abierta (lo sabe por /v1/station/pantalla). */
const ecg = { buf: [], fs: 250, t: 0, bpm: null, rmssd: null, calidad: null, contacto: true, trip: null, lo: 0, hi: 1023, corre: false, desde: 0 };
function ecgRecibir(d) {
  const ahora = performance.now();
  if (ahora - ecg.t > 3000 || (d.trip || null) !== ecg.trip) { ecg.buf.length = 0; ecg.bpm = ecg.rmssd = ecg.calidad = null; }
  ecg.fs = d.fs || 250; ecg.t = ahora; ecg.contacto = d.contacto !== false; ecg.trip = d.trip || null;
  if (d.bpm) ecg.bpm = d.bpm; if (d.rmssd) ecg.rmssd = d.rmssd; if (d.calidad != null) ecg.calidad = d.calidad;
  // electrodo suelto (o el AD8232 pegado a 0 o al tope de 10 bits mientras se suelta): línea plana, no el ruido
  for (const v of d.muestras) ecg.buf.push(ecg.contacto && v > 4 && v < 1019 ? v : null);
  const max = Math.round(ecg.fs * 8); if (ecg.buf.length > max) ecg.buf.splice(0, ecg.buf.length - max);
  // nada se abre solo: el dock marca «live» y la medición empieza al entrar a la hoja ECG
  $('ecgN').hidden = !(sesion && ecg.contacto);
  if (sesion && hojaTipo === 'ecg') pintarEcgDatos();
}
function hojaEcg() {
  const p = sesion?.persona || {}, nombre = p.corto || p.nombre || sesion?.trip || '';
  $('hojaTit').textContent = nombre ? `${nombre}'s ECG` : 'ECG';
  ecg.desde = performance.now();   // la medición empieza al entrar
  $('hojaCuerpo').innerHTML = `<div class="ecgh"><div class="ecgest" id="ecgEst"><i></i><span id="ecgEstTxt"></span></div><canvas id="ecgLienzo"></canvas></div>
    <div class="signos cuatro">
      <div class="signo"><em>Pulse</em><b id="ecgBpm">—<small>bpm</small></b><span>from the time between beats</span></div>
      <div class="signo"><em>Variability (RMSSD)</em><b id="ecgVfc">—<small>ms</small></b><span>beat to beat · stress and recovery</span></div>
      <div class="signo"><em>Signal</em><b id="ecgCal">—</b><span id="ecgCalTxt">waiting</span></div>
      <div class="signo"><em>Recording</em><b id="ecgTiempo">0:00</b><span>saved to ${esc(nombre)}'s record while this is open</span></div>
    </div>
    <p class="ecgguia">Sit still and breathe normally. Electrodes: right arm (RA), left arm (LA) and right leg or lower ribs (RL).
      <button class="sec ecgmano" data-medir-mano>No electrodes? Enter it by hand</button></p>`;
  pintarEcgDatos();
  if (!ecg.corre) { ecg.corre = true; requestAnimationFrame(ecgDibujar); }
}
function pintarEcgDatos() {
  const est = $('ecgEst'); if (!est) return;
  const hay = performance.now() - ecg.t < 3000;
  est.className = 'ecgest' + (!hay ? ' espera' : !ecg.contacto ? ' suelto' : '');
  $('ecgEstTxt').textContent = !hay ? 'Put on the electrodes · waiting for the heart board' : !ecg.contacto ? 'Check the electrodes · one is not touching the skin' : 'Live from the heart board';
  const vivo = hay && ecg.contacto;
  $('ecgBpm').innerHTML = `${vivo && ecg.bpm ? Math.round(ecg.bpm) : '—'}<small>bpm</small>`;
  $('ecgVfc').innerHTML = `${vivo && ecg.rmssd ? Math.round(ecg.rmssd) : '—'}<small>ms</small>`;
  const q = vivo ? ecg.calidad : null;
  $('ecgCal').textContent = q == null ? '—' : q >= .8 ? 'Good' : q >= .5 ? 'Fair' : 'Noisy';
  $('ecgCalTxt').textContent = q == null ? (hay ? 'finding the beats' : 'waiting') : q >= .5 ? 'regular beats' : 'stay still, it is not saving';
  const s = hay && ecg.contacto ? Math.floor((performance.now() - ecg.desde) / 1000) : 0;
  if (!(hay && ecg.contacto)) ecg.desde = performance.now();   // cuenta solo con los electrodos puestos
  $('ecgTiempo').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function ecgDibujar() {
  const cv = $('ecgLienzo');
  if (hojaTipo !== 'ecg' || !cv) { ecg.corre = false; return; }
  requestAnimationFrame(ecgDibujar);
  if (performance.now() - ecg.t > 3000 && ecg.buf.length) { ecg.buf.length = 0; pintarEcgDatos(); }
  const r = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * r)) { cv.width = Math.round(w * r); cv.height = Math.round(h * r); }
  const x = cv.getContext('2d'); x.setTransform(r, 0, 0, r, 0, 0); x.clearRect(0, 0, w, h);
  // papel de ECG: una línea cada 0,2 s y otra fuerte cada segundo
  for (let i = 1; i < 40; i++) { const gx = i * w / 40; x.strokeStyle = i % 5 ? 'rgba(236,106,168,.08)' : 'rgba(236,106,168,.2)'; x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, h); x.stroke(); }
  for (let i = 1; i < 8; i++) { const gy = i * h / 8; x.strokeStyle = 'rgba(236,106,168,.08)'; x.beginPath(); x.moveTo(0, gy); x.lineTo(w, gy); x.stroke(); }
  const b = ecg.buf; if (b.length < 2) return;
  let lo = Infinity, hi = -Infinity; for (const v of b) { if (v == null) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (lo === Infinity) { lo = ecg.lo; hi = ecg.hi; }
  ecg.lo += (lo - ecg.lo) * .1; ecg.hi += (hi - ecg.hi) * .1; const rango = Math.max(40, ecg.hi - ecg.lo);
  const n = Math.round(ecg.fs * 8), x0 = w * (1 - b.length / n);
  x.strokeStyle = ecg.contacto ? '#ec6aa8' : '#f2b457'; x.lineWidth = 2.2; x.lineJoin = 'round'; x.shadowColor = x.strokeStyle; x.shadowBlur = 8;
  x.beginPath();
  b.forEach((v, i) => { const px = x0 + i * w / n, py = v == null ? h / 2 : h - 12 - (v - ecg.lo) / rango * (h - 24); i ? x.lineTo(px, py) : x.moveTo(px, py); });
  x.stroke(); x.shadowBlur = 0;
}
setInterval(() => { $('ecgN').hidden = !(sesion && ecg.contacto && performance.now() - ecg.t < 3000); if (hojaTipo === 'ecg') pintarEcgDatos(); }, 1000);

document.addEventListener('click', e => {
  if (e.target.closest('[data-abrir-ecg]')) abrirHoja('ecg');
  else if (e.target.closest('[data-medir-mano]')) abrirHoja('medir', 'pulso');
});

/* ── tormenta solar: la nave avisa por el flujo; la tablet abre la guía del refugio para toda la tripulación ── */
function radStation(spe) {
  if (spe && !radSpe) {
    if (!MUDO) { proc = new Procedimiento(PROTOCOLOS, 'tormenta_solar', { id: 'TODOS', corto: 'whole crew', nombre: 'The crew', rol: '' }, t => decirNova(t), (tipo, texto) => postJ('/v1/bitacora', { tipo: 'emergencias', datos: { protocolo: 'tormenta_solar', trip: 'TODOS', tipo, texto, desde: 'station', lector: LECTOR } }).catch(() => {}));
      procQuien = { id: 'TODOS', corto: 'whole crew' }; $('guia').hidden = false; pintarGuia(); }
    nativo({ tipo: 'vibrar' });
  } else if (!spe && radSpe) avisar('Solar event over · you can leave the shelter', 'bien');
  radSpe = spe;
}
// la pastilla de radiación de la cabecera: tasa y dosis de la misión; en una tormenta, ámbar y vuelve a abrir la guía
async function leerRadStation() {
  let r; try { r = await api('/v1/radiacion'); } catch { return; }
  if (!r) return;
  if (r.spe?.activa !== radSpe) radStation(!!r.spe?.activa);
  const c = $('radChip'); c.hidden = false; c.classList.toggle('spe', !!r.spe?.activa);
  c.innerHTML = r.spe?.activa ? `<i></i><b>Solar storm</b> · stay in the shelter · ${Math.round(r.tasa_usv_h).toLocaleString('en')} µSv/h`
    : `<i></i>Radiation <b>${Math.round(r.tasa_usv_h)} µSv/h</b> · mission ${Math.round(r.mision.msv)}/600 mSv`;
}
$('radChip').onclick = () => { if (radSpe) { radSpe = false; radStation(true); } };
leerRadStation(); setInterval(leerRadStation, 10000);
