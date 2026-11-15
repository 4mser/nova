/* La ventana grande: un bloque visual del panel, ampliado (gráfico más alto, tablas y código completos) */
import { renderizar } from './visual.js';

const mac = window.mac;
const destino = document.getElementById('lienzo');
mac.alLienzo(bloque => {
  if (bloque?.tipo === 'imagenes' && bloque.items?.length === 1) document.title = bloque.items[0].titulo ?? 'NOVA · Imagen';
  else document.title = bloque?.titulo ? `NOVA · ${bloque.titulo}` : 'NOVA · Lienzo';
  destino.replaceChildren(renderizar(bloque ?? {}, { grande: true, abrir: url => mac.abrirUrl(url), ampliarImagen: it => mac.abrirUrl(/^https?:/.test(it.src) ? it.src : '') }));
});
