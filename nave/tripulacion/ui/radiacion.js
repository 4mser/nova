/* Radiación en el PC: lee /v1/radiacion (la tasa del detector de Luis, o simulada con MSL RAD mientras no esté) y, si
   hay una tormenta solar de partículas, avisa en todas las vistas: letrero arriba, NOVA lo dice en voz alta y se abre
   la guía «tormenta_solar» (al refugio). Al terminar, dice la dosis del evento. Mission usa window.RAD para su cifra. */
'use strict';
const RAD = window.RAD = { d: null, antes: null, finHasta: 0 };

async function leerRad() {
  let d; try { d = await (await fetch(BASE + '/v1/radiacion', { cache: 'no-store' })).json(); } catch { return; }
  RAD.d = d;
  const spe = !!d.spe?.activa;
  if (RAD.antes !== null && spe && !RAD.antes) inicioSpe();
  if (RAD.antes === true && !spe) finSpe();
  RAD.antes = spe;
  pintarRad();
}
function inicioSpe() {
  if (typeof hablar === 'function') { try { hablar('Solar particle event. Everyone to the storm shelter now.'); } catch {} }
  if (typeof abrirGuia === 'function' && !(typeof guia !== 'undefined' && guia)) abrirGuia(0, 'tormenta_solar', true);
}
function finSpe() {
  RAD.finHasta = Date.now() + 25000;
  if (typeof hablar === 'function') { try { hablar('The solar particle event is over. You can leave the shelter. Log the event dose for Earth.'); } catch {} }
}
function pintarRad() {
  let b = document.getElementById('radBanner');
  if (!b) { b = document.createElement('div'); b.id = 'radBanner'; b.className = 'radbanner'; document.body.appendChild(b); }
  const d = RAD.d, spe = d?.spe;
  if (spe?.activa) {
    const min = Math.max(0, Math.round((Date.now() - spe.desde) / 60000));
    b.className = 'radbanner on';
    b.innerHTML = `<i></i><div><b>Solar particle event · everyone to the storm shelter</b><span>${Math.round(d.tasa_usv_h).toLocaleString('en')} µSv/h now · peak ${Math.round(spe.pico_usv_h).toLocaleString('en')} · event dose ${spe.dosis_msv.toFixed(2)} mSv of the 250 mSv limit · ${min} min${spe.demo ? ' · demo scenario' : d.simulada ? ' · simulated' : ' · onboard detector'}</span></div><button data-rad-guia>Open guide</button>`;
  } else if (Date.now() < RAD.finHasta) {
    b.className = 'radbanner on fin';
    b.innerHTML = `<i></i><div><b>Solar event over · the crew can leave the shelter</b><span>peak ${Math.round(spe.pico_usv_h).toLocaleString('en')} µSv/h · event dose ${spe.dosis_msv.toFixed(2)} mSv · log it for Earth</span></div>`;
  } else b.className = 'radbanner';
}
document.addEventListener('click', e => {
  if (e.target.closest('[data-rad-guia]') && typeof abrirGuia === 'function') abrirGuia(0, 'tormenta_solar');
  const r = e.target.closest('[data-rad]');
  if (r) fetch(BASE + '/v1/radiacion/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spe: r.dataset.rad === 'spe' }) }).then(leerRad).catch(() => {});
});
setInterval(leerRad, 2000); leerRad();
