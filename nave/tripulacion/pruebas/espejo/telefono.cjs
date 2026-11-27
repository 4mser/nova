// Simula un teléfono para Mirror me sin cámara: proyecta una pose de prueba en una cámara de 1280×720 (66°) y la manda a
// la nave como lo hace camara.js ([x, y, z, visibilidad, u, v] por punto; el primero lleva además el ancho y alto del video).
// Abre el gemelo en un Chrome sin ventana, prende Mirror me y guarda capturas: cuerpo entero a 3,2 m y de cerca (hombros).
//
//   node tripulacion/pruebas/espejo/telefono.cjs            (NOVA corriendo en 127.0.0.1:8750)
//   PLAYWRIGHT=/ruta/a/playwright-core CHROME=/ruta/a/chrome node ...
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright-core');
const PS = require('./poses.cjs');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const NAVE = process.env.NAVE || 'http://127.0.0.1:8750';
function telefono(w, D, yc, vw = 1280, vh = 720) {
  const f = (vw / 2) / Math.tan(33 * Math.PI / 180);
  return w.map((p, i) => {
    const z = D + p[2], u = .5 + p[0] * f / z / vw, v = .5 + (p[1] - yc) * f / z / vh, den = u > .01 && u < .99 && v > .01 && v < .99;
    const q = [p[0], p[1], p[2], den ? p[3] : 0, +u.toFixed(4), +v.toFixed(4)]; if (i === 0) q.push(vw, vh); return q;
  });
}
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(NAVE, { waitUntil: 'networkidle' });
  await p.evaluate(() => window.abrirGemelo(0));
  await p.waitForTimeout(20000);
  await p.click('#gEspejo');
  const [x, y, w, h] = await p.evaluate(() => { const c = document.querySelector('#gem canvas').getBoundingClientRect(); return [c.x, c.y, c.width, c.height]; });
  for (const [nom, D, yc] of [['entero', 3.2, .1], ['hombros', .9, -.38]]) {
    const W = telefono(PS.frente, D, yc);
    await p.evaluate(W => { clearInterval(window.__iv); window.__iv = setInterval(() => fetch('/v1/espejo/vista', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cam: 'prueba', nombre: 'Prueba', w: W }) }), 50); }, W);
    await p.waitForTimeout(6000);
    await p.screenshot({ path: `espejo_${nom}.png`, clip: { x, y, width: w, height: h } });
    console.log(`espejo_${nom}.png · puntos dentro del cuadro: ${W.filter(q => q[3] > 0).length}/33`);
  }
  await p.evaluate(() => { clearInterval(window.__iv); return fetch('/v1/espejo/vista', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cam: 'prueba', w: [] }) }); });
  if (errs.length) console.log('errores de la página:\n' + errs.join('\n'));
  await b.close();
})();
