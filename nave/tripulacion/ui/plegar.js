/* Panel de NOVA plegable: libera el ancho para el resto del software. Plegado queda una columna angosta con NOVA
   chiquita (sigue respirando y avisa con un punto si alguien necesita atención); al tocarla vuelve a abrirse.
   Se abre solo cuando NOVA tiene que hablar: modo voz, una pregunta o una emergencia. Se recuerda en este equipo. */
'use strict';
let novaPlegada = false;
try { novaPlegada = localStorage.getItem('nova-plegada') === '1'; } catch { }
function plegarNova(v) {
  novaPlegada = v;
  document.querySelector('.app').classList.toggle('plegada', v);
  $('novaPlegar').title = v ? 'Show Nova' : 'Hide Nova (more room)';
  try { localStorage.setItem('nova-plegada', v ? '1' : '0'); } catch { }
  // las vistas con lienzo (gemelo, kit) se reacomodan al nuevo ancho
  setTimeout(() => dispatchEvent(new Event('resize')), 480);
}
plegarNova(novaPlegada);
document.addEventListener('click', e => {
  if (e.target.closest('#novaPlegar')) { plegarNova(!novaPlegada); return; }
  if (novaPlegada && e.target.closest('.nova')) plegarNova(false);
});
// cuando NOVA tiene que hablar, se abre sola
const _preguntar = window.preguntarNova;
if (_preguntar) window.preguntarNova = function (...a) { if (novaPlegada) plegarNova(false); return _preguntar.apply(this, a); };
document.addEventListener('click', e => { if (novaPlegada && e.target.closest('#micBtn,#btnEmergencia')) plegarNova(false); }, true);
// punto de aviso en la columna plegada
setInterval(() => { const n = document.querySelector('.nova'); if (n) n.dataset.aviso = typeof estadoNova !== 'undefined' && estadoNova !== 'bien' ? estadoNova : ''; }, 1000);
