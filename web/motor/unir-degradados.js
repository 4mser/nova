/* Un solo degradado por frase: cada palabra animada muestra SU tramo del degradado de toda la línea
   (antes cada palabra reiniciaba el degradado y se veía cortado). Se mide cuando la frase ya es visible
   (oculta mide 0) y se agrupa por contenedor y por línea; se recalcula en cada cuadro. */
window.unirDegradados = function(){
  if (document.fonts.status !== 'loaded') return;   // con la fuente de reemplazo las medidas salen corridas
  const grupos = new Map();
  document.querySelectorAll('.w.gw, .w.g').forEach(w => {
    if (!w.offsetWidth) return;
    const cont = w.closest('.kw, .tit, p') || w.parentNode;
    const k = Math.round(w.offsetTop / 10);
    if (!grupos.has(cont)) grupos.set(cont, new Map());
    const g = grupos.get(cont); if (!g.has(k)) g.set(k, []); g.get(k).push(w);
  });
  grupos.forEach(g => g.forEach(ws => {
    const L = Math.min(...ws.map(w => w.offsetLeft)), R = Math.max(...ws.map(w => w.offsetLeft + w.offsetWidth)), W = Math.max(1, R - L);
    ws.forEach(w => { w.style.backgroundSize = W + 'px 100%'; w.style.backgroundPosition = -(w.offsetLeft - L) + 'px 0'; w.style.backgroundRepeat = 'no-repeat'; });
  }));
};
{ const __render = render; render = function(t){ __render(t); window.unirDegradados(); }; }
