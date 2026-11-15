/* NOVA Station · Live body scan: what a phone (in the hand or in a headset) or this screen's camera is scanning,
   live from the ship's link, with the crew member's twin beside it and a code to join from a phone. */
import qrcode from './lib/qrcode.mjs';

const $ = id => document.getElementById(id);
const URL_BASE = typeof BASE !== 'undefined' ? BASE : '';
let ultimoCuadro = null, tCuadro = 0, cuadros = [], urlQr = '', dispSeguido = null;

/* live frames: the link keeps only the newest one, so a slow screen jumps ahead instead of lagging */
function conectar() {
  const es = new EventSource(URL_BASE + '/v1/escaner/flujo');
  es.onmessage = e => {
    let c; try { c = JSON.parse(e.data); } catch { return; }
    if (!c.jpg) return;
    // the link replays its last frame to a new screen: a frame older than 3 s is a viewer that already left
    if (c.recibido && Date.now() - c.recibido > 3000) return;
    // follow one viewer: the station stays on the device it is showing until that one stops sending for 3 s
    const ahora = performance.now();
    if (dispSeguido && c.disp !== dispSeguido && ahora - tCuadro < 3000) return;
    dispSeguido = c.disp;
    ultimoCuadro = c; tCuadro = ahora;
    cuadros.push(tCuadro); cuadros = cuadros.filter(t => tCuadro - t < 2000);
    if (!$('scan').hidden) $('sImg').src = 'data:image/jpeg;base64,' + c.jpg;
  };
  es.onerror = () => { es.close(); setTimeout(conectar, 2000); };
}

const CREWL = () => (typeof CREW !== 'undefined' ? CREW : []);
const fmt1 = (x, d = 0) => (x == null || !isFinite(x) || x === 0 ? '—' : x.toFixed(d));
const COLN = { vigilar: 'var(--nv)', atencion: 'var(--at)', aviso_tierra: 'var(--al)' };

function pintar() {
  const vivo = ultimoCuadro && performance.now() - tCuadro < 3000;
  $('badgeScan').hidden = !vivo || !$('scan').hidden;
  if ($('scan').hidden) return;
  $('sVacio').hidden = !!vivo; $('sEtiq').hidden = !vivo; $('sImg').style.opacity = vivo ? 1 : .25;
  if (!ultimoCuadro) return;
  const c = ultimoCuadro, desde = { movil: 'Phone', pantalla: 'Screen' }[c.origen] || 'Viewer', modo = c.modo === 'visor' ? 'in headset' : 'in hand';
  $('sDisp').textContent = `${desde} ${modo}`;
  const v = c.vision || {};
  $('sRed').textContent = `${cuadros.length / 2 | 0} fps here · ${c.fps || '—'} fps on device · ${v.donde === 'ship' ? `vision on this computer (${v.gpu || 'GPU'}) ${v.ms} ms` : v.donde === 'phone' ? 'vision on the phone' : 'vision starting'}`;
  $('sQuienTxt').innerHTML = vivo ? `<b>${c.nombre || 'Unknown'}</b><br>${desde} ${modo} · ${c.cuerpo ? 'body found' : 'looking for the body'}<br>Layers: ${(c.capas || []).map(x => ({ organos: 'organs', esqueleto: 'skeleton', rcp: 'CPR point' })[x] || x).join(', ')}` : 'Nobody right now';
  $('sFoco').textContent = vivo ? (c.foco || (c.cuerpo ? 'Whole body' : 'Looking for the body')) : '—';
  // the procedure on the phone and what Nova did: confirmed, corrected, decided (an instructor's timeline)
  const pr = vivo && c.proc;
  $('sProcCaja').hidden = !pr;
  if (pr) {
    const mmss = x => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
    $('sProc').innerHTML = `<b>${pr.titulo}</b><p>${pr.paso || ''}</p>${pr.restante != null ? `<em>${mmss(pr.restante)} left</em>` : ''}`;
    const ICON = { paso: 'var(--ac2)', confirmar: 'var(--ok)', corregir: 'var(--at)', seguimiento: 'var(--ac)', decision: 'var(--nv)', herida: 'var(--al)', inicio: 'var(--al)', fin: 'var(--t3)' };
    const NOM = { paso: 'Instructed', confirmar: 'Confirmed', corregir: 'Corrected', seguimiento: 'Followed up', decision: 'Decided', herida: 'Marked', inicio: 'Started', fin: 'Closed' };
    $('sTl').innerHTML = (c.intervenciones || []).slice().reverse().map(x => `<div><i style="background:${ICON[x.tipo] || 'var(--t3)'}"></i><span><b>${NOM[x.tipo] || x.tipo}</b> ${x.texto}</span><time>${new Date(x.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div>`).join('');
  }
  const g = c.gravedad || {}, r = c.rcp;
  const reg = { micro: 'Microgravity', marte: 'Mars 0.38 g', tierra: 'Earth 1 g' }[g.regimen] || '—';
  $('sGrav').innerHTML = vivo ? `<div><i style="background:${g.regimen === 'micro' ? 'var(--nv)' : g.regimen === 'marte' ? 'var(--at)' : 'var(--ok)'}"></i>Procedure gravity<b>${reg}</b></div>`
    + `<div><i style="background:var(--t3)"></i>Phone measures<b>${g.medida != null ? g.medida.toFixed(2) + ' g' : 'no sensor'}</b></div>`
    + (r ? `<div><i style="background:var(--al)"></i>CPR technique<b>${r.tecnica}</b></div><div><i style="background:${r.ritmo && (r.ritmo < 100 || r.ritmo > 120) ? 'var(--at)' : 'var(--ok)'}"></i>Rate · count<b>${r.ritmo ? r.ritmo + '/min' : '—'} · ${r.cuenta}</b></div>`
      + (g.regimen === 'micro' ? `<div><i style="background:${r.deriva > 8 ? 'var(--at)' : 'var(--ok)'}"></i>Patient drift<b>${r.deriva} cm/s</b></div>` : '') : '') : '';
  // the scanned person's twin, from the same live state the rest of the station uses
  const i = CREWL().findIndex(x => x.id === c.trip), t = typeof ultimo !== 'undefined' && ultimo && ultimo.trip ? ultimo.trip[i] : null;
  const fila = (n, v, k) => `<div><i style="background:${COLN[t?.niveles?.[k]] || 'var(--ok)'}"></i>${n}<b>${v}</b></div>`;
  $('sVit').innerHTML = t ? fila('Heart rate', `${fmt1(t.pulso)} bpm`, 'pulso') + fila('SpO₂', `${fmt1(t.spo2)} %`, 'spo2') + fila('Blood pressure', `${fmt1(t.pa_sis)}/${fmt1(t.pa_dia)}`, 'pa_sis')
    + fila('Breathing', `${fmt1(t.fr)} /min`, 'fr') + fila('Glucose', `${fmt1(t.glucosa)} mg/dL`, 'glucosa') + fila('Temperature', `${fmt1(t.temp, 1)} °C`, 'temp') : '';
}

/* control of the viewer from here: the phone sits inside the headset and nobody can touch it, so everything it can
   change is a button here too. Each order goes to the ship, rides back on the reply to the phone's next frame
   (~0.1 s) and the panel redraws from the state the phone reports, so what is lit here is what the headset shows. */
const esc = x => String(x ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]);
let ultimoCtl = '', tOrden = 0, errOrden = '';
async function ordenar(orden) {
  if (!ultimoCuadro?.disp) return;
  tOrden = performance.now(); errOrden = '';
  try {
    const r = await fetch(URL_BASE + '/v1/escaner/orden', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ disp: ultimoCuadro.disp, orden }) });
    if (!r.ok) errOrden = r.status === 404 ? 'viewer not sending' : 'not delivered';
  } catch { errOrden = 'link down'; }
  pintarControl(true);
}
const SIS = [['cardio', 'Cardio'], ['resp', 'Resp'], ['metab', 'Metabolic'], ['renal', 'Renal'], ['oseo', 'Skeletal'], ['neuro', 'Neuro'], ['ojos', 'Eyes']];
const GRAV = [['auto', 'Mission'], ['tierra', 'Earth 1 g'], ['marte', 'Mars 0.38 g'], ['micro', '0 g']];
const TEC = [['er', 'Evetts-Russomano'], ['rbh', 'Reverse bear hug'], ['hs', 'Handstand'], ['sujeto', 'Restrained']];
const EST = [['holo', 'Hologram'], ['clinico', 'Clinical'], ['rx', 'X-ray']];
const seg = (l, act, attr) => `<div class="cseg">${l.map(([v, n, cls = '']) => `<button class="${cls}${act(v) ? ' on' : ''}" ${attr}="${esc(v)}">${esc(n)}</button>`).join('')}</div>`;
const fila = (n, h) => `<div class="cfila"><label>${n}</label>${h}</div>`;
function htmlControl(c) {
  const k = c.ctl, pr = c.proc;
  let h = fila('Crew member', seg(CREWL().map(x => [x.id, x.corto || x.nombre]), v => v === k.trip, 'data-c-trip'));
  h += fila('View', seg([['mano', 'In hand'], ['visor', 'Headset (side by side)']], v => (v === 'visor') === k.visor, 'data-c-visor')
    + seg([['flip', k.frente ? 'Front camera · flip' : 'Back camera · flip']], () => false, 'data-c-girar'));
  h += fila('Layers', seg([['organos', 'Organs'], ['esqueleto', 'Skeleton'], ['rcp', 'CPR point', 'rcp']], v => k.capas.includes(v), 'data-c-capa'));
  h += fila('Body system', seg(SIS, v => v === k.sistema, 'data-c-sis'));
  h += fila('Look', seg(EST, v => v === k.estilo, 'data-c-estilo'));
  h += fila('Procedure gravity', seg(GRAV, v => v === k.g, 'data-c-g'));
  if (k.verTecnica) h += fila('Microgravity CPR technique', seg(TEC, v => v === k.tecnica, 'data-c-tec'));
  h += fila('Tracking', `<div class="cfov">${seg([['on', 'Gyro on'], ['off', 'Gyro off']], v => (v === 'on') === k.giro, 'data-c-giro')}</div>`
    + `<div class="cfov"><span class="cseg"><button data-c-fov="-2">−</button></span><b>${k.fov}°</b><span class="cseg"><button data-c-fov="2">+</button></span><span style="font:400 12px SG;color:var(--t3)">camera field of view: tune until the anatomy sits on the body</span></div>`);
  if (pr) {
    h += fila(`Procedure · ${esc(pr.titulo)}`, `<div class="cpaso">${esc(pr.paso)}</div>`
      + (pr.herida ? '<div class="cpista">Waiting for the wound: click it on the picture</div>' : '')
      + seg([...(pr.botones || []).map(([v, n], i) => [v, n, i === 0 ? 'pri' : '']), ['_repetir', 'Say it again'], ['_cerrar', 'Close procedure']], () => false, 'data-c-r'));
  } else {
    const ops = (k.protocolos || []).map(p => `<option value="${esc(p.id)}">${esc(p.titulo)}</option>`).join('');
    const sug = k.sugerido && (k.protocolos || []).find(p => p.id === k.sugerido);
    h += fila('Procedure', (sug ? seg([[sug.id, `Nova suggests: ${sug.titulo} · start`, 'pri']], () => false, 'data-c-abrir') : '')
      + `<div class="csel"><select id="cProt">${ops}</select><span class="cseg"><button data-c-abrir-sel>Start</button></span></div>`);
  }
  return h;
}
function pintarControl(forzar) {
  const c = ultimoCuadro, vivo = c && performance.now() - tCuadro < 3000 && c.ctl;
  $('sCtl').hidden = !vivo;
  $('sEscena').classList.toggle('herida', !!(vivo && c.proc?.herida));
  if (!vivo) { ultimoCtl = ''; return; }
  const est = $('sCtlEstado');
  est.textContent = errOrden ? errOrden : performance.now() - tOrden < 1500 ? 'sending…' : `${c.disp}`;
  est.classList.toggle('mal', !!errOrden);
  if (document.activeElement?.id === 'cProt' && !forzar) return; // never pull the list from under the mouse
  const h = htmlControl(c);
  if (h === ultimoCtl) return;
  const sel = $('cProt')?.value;
  ultimoCtl = h; $('sCtlCuerpo').innerHTML = h;
  if (sel && $('cProt')) $('cProt').value = sel;
}
$('sCtlCuerpo').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset, k = ultimoCuadro?.ctl; if (!k) return;
  b.classList.add('ida');
  if (d.cTrip) ordenar({ tipo: 'trip', id: d.cTrip });
  else if (d.cVisor) ordenar({ tipo: 'visor', on: d.cVisor === 'visor' });
  else if (d.cGirar != null) ordenar({ tipo: 'girar' });
  else if (d.cCapa) ordenar({ tipo: 'capa', v: d.cCapa, on: !k.capas.includes(d.cCapa) });
  else if (d.cSis) ordenar({ tipo: 'sistema', v: d.cSis });
  else if (d.cEstilo) ordenar({ tipo: 'estilo', v: d.cEstilo });
  else if (d.cG) ordenar({ tipo: 'g', v: d.cG });
  else if (d.cTec) ordenar({ tipo: 'tecnica', v: d.cTec });
  else if (d.cGiro) ordenar({ tipo: 'giro', on: d.cGiro === 'on' });
  else if (d.cFov) ordenar({ tipo: 'fov', v: k.fov + +d.cFov });
  else if (d.cR) ordenar(d.cR === '_repetir' ? { tipo: 'repetir' } : d.cR === '_cerrar' ? { tipo: 'cerrar' } : { tipo: 'responder', r: d.cR });
  else if (d.cAbrir) ordenar({ tipo: 'abrir', id: d.cAbrir });
  else if (d.cAbrirSel != null && $('cProt')?.value) ordenar({ tipo: 'abrir', id: $('cProt').value });
});
// marking the wound: the picture here is the phone's whole frame, so a click maps straight to the phone's picture
$('sImg').addEventListener('click', e => {
  if (!ultimoCuadro?.proc?.herida) return;
  const r = $('sImg').getBoundingClientRect();
  ordenar({ tipo: 'herida', x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
});

/* the link a phone opens: the ship's own address on the secure port (the camera needs a secure page) */
async function enlaceTelefono() {
  try {
    const v = await (await fetch(URL_BASE + '/v1/escaner/visores')).json();
    const ip = (v.ips || [])[0]; if (!ip) return;
    const u = `https://${ip}:${v.https}/escaner.html`;
    if (u === urlQr) return; urlQr = u;
    const q = qrcode(0, 'M'); q.addData(u); q.make();
    $('sQr').innerHTML = q.createImgTag(4, 0);
    $('sUrl').textContent = u;
  } catch {}
}

/* scan with this screen's camera, without leaving the station */
function escanearAqui() {
  const c = $('escanerLocal'), i = CREWL().findIndex(x => x.id === ultimoCuadro?.trip);
  const trip = (CREWL()[Math.max(0, i)] || {}).id || 'T1';
  c.innerHTML = `<iframe src="escaner.html?auto&trip=${trip}" allow="camera; fullscreen; screen-wake-lock"></iframe><button class="cerrar" id="sCerrar">Close scan</button>`;
  c.classList.add('on');
  $('sCerrar').onclick = () => { c.classList.remove('on'); c.innerHTML = ''; };
}

$('sAqui').onclick = escanearAqui;
document.addEventListener('click', e => { if (e.target.closest('[data-vista="escaner"]')) { enlaceTelefono(); setTimeout(() => ultimoCuadro && ($('sImg').src = 'data:image/jpeg;base64,' + ultimoCuadro.jpg), 0); } });
conectar();
enlaceTelefono(); setInterval(enlaceTelefono, 15000);
setInterval(() => { pintar(); pintarControl(); }, 250);
