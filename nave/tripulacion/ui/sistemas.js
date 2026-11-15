/* Vista «Systems»: el núcleo de vuelo (F Prime) visto con la interfaz de NOVA, a través de su sistema de tierra.
   Estado del núcleo, eventos traducidos a lenguaje claro, telemetría que importa, umbrales vigentes y lo que sube
   desde la Tierra con su retraso de la luz. Datos de /v1/sistemas y en vivo por el flujo (tipo «sistema» y «subida»). */
'use strict';
let sis = null, filtroSis = 'todo';

const SENSOR_TXT = { PULSO: 'heart rate', SPO2: 'oxygen', PA_SIS: 'systolic BP', PA_DIA: 'diastolic BP', TEMP: 'temperature', FR: 'breathing', GLUCOSA: 'blood sugar', VFC: 'HRV', CO2_CABINA: 'cabin CO₂', O2_CABINA: 'cabin O₂', TEMP_CABINA: 'cabin temperature', SUENO_H: 'sleep', ANIMO: 'mood', ENERGIA: 'energy', PASOS: 'steps', FC_REPOSO: 'resting HR', LUZ: 'light', RUIDO: 'noise' };
const quienT = n => (+n ? (CREW[+n - 1] || {}).corto || `T${n}` : 'Cabin');

/* un evento del núcleo en palabras de la tripulación */
function eventoClaro(e) {
  const m = e.texto.match(/^T(\d+)(?: \(0 = cabina\))?: (\w+) = ([\d.\-]+)/);
  const s = m ? `${quienT(m[1])} · ${SENSOR_TXT[m[2]] || m[2].toLowerCase()} ${m[3]}` : '';
  const grupo = e.componente.startsWith('Nova.monitorSalud') || e.componente.startsWith('Nova.pantalla') ? 'salud'
    : e.componente.startsWith('Nova.estacion') ? 'estacion' : e.componente.includes('cmdDisp') || e.componente.includes('prmDb') || e.componente.includes('cmdSeq') ? 'comandos' : 'sistema';
  const T = {
    ALERTA_TIERRA: [`${s}: flagged for the flight surgeon`, 'al'], ALERTA_ATENCION: [`${s}: needs the crew’s attention`, 'at'],
    VUELVE_NORMAL: [`${s}: back in range`, 'ok'], SIGNO_DESCARTADO: [`${s}: impossible value, discarded as a sensor error`, 'at'],
    SIN_DATOS: [`${m ? `${quienT(m[1])} · ${SENSOR_TXT[m[2]] || m[2]}` : ''}: no readings for a while`, 'at'],
    CONECTADA: ['Medical station connected', 'ok'], PERDIDA: ['Medical station stopped sending (no heartbeat)', 'al'],
    MENSAJE_INVALIDO: [`Station message rejected: ${e.texto.split(': ').slice(1).join(': ')}`, 'at'],
    ESCUCHANDO: ['Waiting for the medical station', ''], LISTA: ['Crew display link ready', ''],
    INGRESO: [e.texto.replace(/^T(\d+) ingresó a mano (\w+) = ([\d.]+)/, (_, n, k, v) => `${quienT(n)} logged ${SENSOR_TXT[k] || k} ${v} by hand`), ''],
    OpCodeDispatched: ['Command received', ''], OpCodeCompleted: ['Command executed', 'ok'], OpCodeError: [`Command failed: ${e.texto}`, 'al'],
    NoOpReceived: ['Connection test from Earth (no-op) received', 'ok'],
  }[e.nombre];
  if (T && /^PRM|Prm/.test(e.nombre) === false) return { txt: T[0], tono: T[1], grupo };
  if (/^Prm|PrmIdUpdated|PrmIdAdded|PrmFileSaveComplete/.test(e.nombre)) return { txt: `Parameter ${e.nombre.includes('Save') ? 'saved to storage' : 'updated'}: ${e.texto}`, tono: 'ok', grupo: 'comandos' };
  const tono = /WARNING_HI|FATAL/.test(e.severidad) ? 'al' : /WARNING_LO/.test(e.severidad) ? 'at' : '';
  return { txt: e.texto, tono, grupo };
}

const canal = n => sis && sis.canales.find(c => c.nombre === n);
const val = (n, f = x => x) => { const c = canal(n); return c ? f(c.valor) : '—'; };

async function abrirSistemas() {
  try { sis = await (await fetch(BASE + '/v1/sistemas')).json(); } catch { sis = null; }
  pintarSistemas();
}

function pintarSistemas() {
  const s = sis;
  if (!s) { $('sisTarjetas').innerHTML = `<div class="panel"><p class="bvacio">The onboard core’s ground link is not answering.</p></div>`; return; }
  const n = s.nucleo, en = n.en_linea, ahora = Date.now();
  const mem = canal('Nova.systemResources.MEMORY_USED'), tot = canal('Nova.systemResources.MEMORY_TOTAL');
  const memTxt = mem && tot && tot.valor ? `${Math.round(100 * mem.valor / tot.valor)}%` : '—';
  const cpu = val('Nova.systemResources.CPU', v => `${(+v).toFixed(0)}%`);
  const slips = ['Nova.rateGroup_1Hz.RgCycleSlips', 'Nova.rateGroup_0_5Hz.RgCycleSlips', 'Nova.rateGroup_0_25Hz.RgCycleSlips'].reduce((a, k) => a + (+val(k, Number) || 0), 0);
  const maxT = val('Nova.rateGroup_1Hz.RgMaxTime', v => `${(v / 1000).toFixed(1)} ms`);
  const enVuelo = s.subida.filter(x => x.estado === 'en_vuelo');
  const tarjeta = (titulo, grande, sub, tono = '') => `<div class="sc ${tono}"><span>${titulo}</span><b>${grande}</b><em>${sub}</em></div>`;
  $('sisTarjetas').innerHTML =
    tarjeta('Onboard core', en ? 'Online' : 'No signal', `F Prime flight software · ${n.eventos_conocidos} events · ${n.comandos_conocidos} commands`, en ? 'ok' : 'al') +
    tarjeta('Real-time health', slips ? `${slips} slips` : 'On time', `1 Hz cycle worst case ${maxT} · CPU ${cpu} · memory ${memTxt}`, slips ? 'at' : '') +
    tarjeta('Medical station', val('Nova.estacion.Conectada', v => (v === true || v === 'True' || v === 1 ? 'Connected' : 'Not connected')), `${val('Nova.estacion.MensajesRecibidos')} messages · ${val('Nova.estacion.MensajesInvalidos')} rejected`) +
    tarjeta('Commands', `${val('CdhCore.cmdDisp.CommandsDispatched')}`, `dispatched · ${val('CdhCore.cmdDisp.CommandErrors')} errors · ${enVuelo.length} on the way from Earth`, +val('CdhCore.cmdDisp.CommandErrors', Number) ? 'at' : '');

  // eventos
  const lista = s.eventos.map(e => ({ e, ...eventoClaro(e) })).filter(x => filtroSis === 'todo' || x.grupo === filtroSis);
  $('sisEventos').innerHTML = lista.length ? lista.slice(0, 60).map(({ e, txt, tono }) => `
    <div class="ev ${tono}"><i></i><time>${new Date(e.t).toTimeString().slice(0, 8)}</time><div><b>${escB(txt)}</b><span>${escB(e.componente)} · ${escB(e.nombre)}</span></div></div>`).join('')
    : '<p class="bvacio">No events in this group yet.</p>';
  document.querySelectorAll('#sisFiltros button').forEach(b => b.classList.toggle('on', b.dataset.sf === filtroSis));

  // umbrales vigentes (los mismos que usa la clasificación)
  const U = ultimo && ultimo.umbrales || {};
  const filas = [['pulso', 'Heart rate', 'bpm'], ['spo2', 'Oxygen', '%'], ['pa_sis', 'Systolic BP', 'mmHg'], ['pa_dia', 'Diastolic BP', 'mmHg'], ['temp', 'Temperature', '°C'], ['fr', 'Breathing', '/min'], ['glucosa', 'Blood sugar', 'mg/dL'], ['sueno_h', 'Sleep', 'h'], ['co2_cabina', 'Cabin CO₂', 'ppm']];
  const f = v => (v > 0 ? (Number.isInteger(v) ? v : v.toFixed(1)) : '—');
  $('sisUmbrales').innerHTML = `<div class="uf cab"><span></span><span>Attention</span><span>Tell Earth</span></div>` + filas.map(([k, n, u]) => {
    const x = U[k] || [-1, -1, -1, -1];
    const at = [x[0] > 0 ? `≥ ${f(x[0])}` : '', x[2] > 0 ? `≤ ${f(x[2])}` : ''].filter(Boolean).join(' · ') || '—';
    const ti = [x[1] > 0 ? `≥ ${f(x[1])}` : '', x[3] > 0 ? `≤ ${f(x[3])}` : ''].filter(Boolean).join(' · ') || '—';
    return `<div class="uf"><span>${n} <small>${u}</small></span><span class="at">${at}</span><span class="al">${ti}</span></div>`;
  }).join('');

  // subida desde la Tierra
  $('sisSubida').innerHTML = s.subida.length ? s.subida.slice(0, 8).map(c => {
    const falta = Math.max(0, (c.llega - ahora) / 1000);
    const est = c.estado === 'en_vuelo' ? `<b class="vuelo">arrives in ${Math.floor(falta / 60)}:${String(Math.floor(falta % 60)).padStart(2, '0')}</b>` : c.estado === 'entregado' ? '<b class="ok">delivered</b>' : `<b class="al">${escB(c.estado)}</b>`;
    return `<div class="sub"><div><b>${escB(c.nombre.split('.').slice(-1)[0].replace(/_PRM_(SET|SAVE)$/, ' · $1'))}</b> ${c.argumentos.length ? `<span>= ${escB(c.argumentos.join(', '))}</span>` : ''}<em>${escB(c.motivo || c.nombre)}</em></div>${est}</div>`;
  }).join('') : '<p class="bvacio">Nothing has come up from Earth yet. The flight surgeon’s console sends commands here with the real light delay.</p>';

  // paquetes para NOVA (firmados en Tierra): se agregan a la lista de lo que sube
  fetch(BASE + '/v1/aprende').then(r => r.json()).then(a => {
    const l = (a && a.paquetes) || []; if (!l.length) return;
    const html = l.slice(0, 4).map(p => { const falta = Math.max(0, (p.llega - Date.now()) / 1000);
      const est = p.estado === 'en_vuelo' ? `<b class="vuelo">arrives in ${Math.floor(falta / 60)}:${String(Math.floor(falta % 60)).padStart(2, '0')}</b>` : p.estado === 'aplicado' ? '<b class="ok">signature OK · applied</b>' : '<b class="al">bad signature · rejected</b>';
      return `<div class="sub"><div><b>NOVA update ${escB(p.id)}</b> <span>${p.respuestas} validated answer${p.respuestas === 1 ? '' : 's'} · ${p.notas} note${p.notas === 1 ? '' : 's'}</span><em>${escB(p.motivo || 'Flight surgeon review')}</em></div>${est}</div>`; }).join('');
    const c = $('sisSubida'); if (c.querySelector('.bvacio')) c.innerHTML = html; else c.insertAdjacentHTML('afterbegin', html);
  }).catch(() => {});
  $('novaDice').textContent = en ? `The onboard core is online. ${enVuelo.length ? `${enVuelo.length} command${enVuelo.length > 1 ? 's are' : ' is'} on the way from Earth.` : 'Nothing on the way from Earth.'}` : 'I can’t hear the onboard core right now.';
}

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.sf) { filtroSis = b.dataset.sf; pintarSistemas(); }
});
setInterval(() => { if (vista === 'sistemas') abrirSistemas(); }, 2000);
