// Capturas reales de la app móvil en modo misión (vista web de Expo en local, enlazada a la nave local :8750).
// Nada sale a servidores externos: solo Metro local y la nave local. Datos de sesión y ciclo de ejemplo solo en este navegador.
import puppeteer from '/Users/nicolasmoreno/ambar-studio/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
const [,, salida, ruta = '/', pasos = '', scroll = '0'] = process.argv;
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
const p = await b.newPage(); await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 3 });
const errores = []; p.on('pageerror', e => errores.push(String(e.message || e).slice(0, 200)));
await p.setRequestInterception(true);
p.on('request', r => { const u = r.url(); (u.startsWith('http://localhost:19006') || u.startsWith('http://127.0.0.1:8750') || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort(); });
await p.goto('http://localhost:19006/', { waitUntil: 'domcontentloaded' });
await p.evaluate(() => {
  const yo = { usuario: { id: 'prueba-local', nombre: 'Kenji', foto: null }, crews: [] };
  localStorage.setItem('nova.sesion.token', 'token-de-prueba-local');
  localStorage.setItem('nova.sesion.yo', JSON.stringify(yo));
  localStorage.setItem('nova.bienvenida.v1.prueba-local', '1');
  localStorage.setItem('nova.permisos.vistos.v1', '1');
  localStorage.setItem('nova.recorrido.v1', JSON.stringify({ hecho: true }));
  localStorage.setItem('nova.funciones.v1', JSON.stringify({ mision: true, compartirDia: true, compartirSalud: false, vozHoy: false }));
  localStorage.setItem('nova.nave.v1', JSON.stringify({ url: 'http://127.0.0.1:8750', asiento: 'T4' }));
  localStorage.setItem('nova.idioma.v1', 'en');
  const dias = {}, hoy = Date.now(); const f = n => new Date(hoy - n * 864e5).toISOString().slice(0, 10);
  for (let n = 29; n >= 0; n--) dias[f(n)] = { fecha: f(n), sangrado: [21, 20, 9, 2].includes(n) ? (n === 20 ? 2 : 1) : 0, sintomas: n === 9 ? ['Cramps'] : [], pildora: n !== 14 && n !== 3 };
  dias[f(0)].sintomas = ['Fatigue'];
  localStorage.setItem('nova.ciclo.v1', JSON.stringify({ config: { activo: true, modo: 'suprimir', metodo: 'pildora_continua', horaPildora: '21:00', avisoPildora: true, pildoras: 240, toallas: 30, finMision: '2027-09-30', compartir: 'nada' }, dias }));
  localStorage.setItem('nova.salud.seg', 'ciclo');
});
await p.goto('http://localhost:19006' + ruta, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 8000));
const clic = async txt => { const h = await p.$$('div,span'); for (const e of h.reverse()) { const t = await e.evaluate(x => x.innerText); if (t && t.trim() === txt) { await e.click(); return true; } } return false; };
for (const x of pasos.split('|').filter(Boolean)) { console.log('clic', x, await clic(x)); await new Promise(r => setTimeout(r, 1200)); }
if (+scroll) { await p.mouse.move(196, 450); for (let i = 0; i < +scroll / 100; i++) { await p.mouse.wheel({ deltaY: 100 }); await new Promise(r => setTimeout(r, 40)); } await new Promise(r => setTimeout(r, 1500)); }
await p.screenshot({ path: salida });
console.log(salida, p.url(), errores.length ? 'ERRORES: ' + errores.slice(0, 3).join(' | ') : 'sin errores');
await b.close();
