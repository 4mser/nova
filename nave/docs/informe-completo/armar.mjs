// Arma doc.html: cabeza + partes/*.html (en orden de nombre) + cola. Reemplaza <si n="rust"></si> por el logo de
// Simple Icons (CC0, color con currentColor) y <lu n="heart-pulse"></lu> por el ícono de Lucide (ISC), ambos en línea
// para que el PDF los guarde como vectores. Uso: node armar.mjs  ·  solo unas páginas: node armar.mjs 13 20 prueba-13-20.html
import fs from 'node:fs';
const D = new URL('.', import.meta.url).pathname;
const leer = f => fs.readFileSync(D + f, 'utf8');
const [desde, hasta, salida = 'doc.html'] = process.argv.slice(2);
const partes = fs.readdirSync(D + 'partes').filter(f => f.endsWith('.html')).sort()
  .filter(f => !desde || (parseInt(f) >= +desde && parseInt(f) <= +hasta));
let html = leer('cabeza.html') + partes.map(f => `\n<!-- ═══ ${f} ═══ -->\n` + leer('partes/' + f)).join('\n') + leer('cola.html');
const faltan = new Set();
html = html.replace(/<si n="([a-z0-9]+)"([^>]*)><\/si>/g, (_, n, a) => {
  const f = D + `img/logos/si-${n}.svg`; if (!fs.existsSync(f)) { faltan.add('si:' + n); return ''; }
  return `<span class="ic"${a}>${fs.readFileSync(f, 'utf8').replace('<svg ', '<svg fill="currentColor" ')}</span>`;
});
html = html.replace(/<lu n="([a-z0-9-]+)"([^>]*)><\/lu>/g, (_, n, a) => {
  const f = D + `img/iconos/lucide/${n}.svg`; if (!fs.existsSync(f)) { faltan.add('lu:' + n); return ''; }
  return `<span class="ic"${a}>${fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '')}</span>`;
});
// ₂ no existe en las fuentes: subíndice real fuera de los SVG
html = html.replace(/(<svg[\s\S]*?<\/svg>)|₂/g, (m, svg) => svg ? svg.replace(/₂/g, '<tspan dy="2" font-size="70%">2</tspan><tspan dy="-2"></tspan>') : '<sub class="sb">2</sub>');
fs.writeFileSync(D + salida, html);
const paginas = (html.match(/<section class="page/g) || []).length;
console.log(`${salida}: ${partes.length} partes, ${paginas} páginas${faltan.size ? ' · FALTAN: ' + [...faltan].join(', ') : ''}`);
