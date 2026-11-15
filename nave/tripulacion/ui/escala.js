/* Escala de la escena: la ventana se llena siempre, sin franjas negras.
   El diseño se piensa para una pantalla de referencia de 1800×1000. La escena toma el tamaño de la ventana dividido por
   un factor z (acotado), así la letra crece o se achica con la ventana y la grilla se reparte el espacio que sobra.
   Las reglas de tamaño viven en estilo.css con @container escena (miden la escena, no la ventana). */
(function () {
  const Z_MIN = 0.68, Z_MAX = 1.35;
  function ajustarEscena() {
    const e = document.getElementById('escena'); if (!e) return;
    const z = Math.max(Z_MIN, Math.min(Z_MAX, Math.min(innerWidth / 1800, innerHeight / 1000)));
    e.style.width = innerWidth / z + 'px';
    e.style.height = innerHeight / z + 'px';
    e.style.transform = `scale(${z})`;
  }
  addEventListener('resize', ajustarEscena);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ajustarEscena); else ajustarEscena();
  window.ajustarEscena = ajustarEscena;
})();
