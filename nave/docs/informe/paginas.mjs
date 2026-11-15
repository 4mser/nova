// Captura cada página del informe como PNG para revisarla a ojo.
import puppeteer from '/Users/nicolasmoreno/ambar-studio/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
const [,, salida, desde = '1', hasta = '99'] = process.argv;
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--allow-file-access-from-files'] });
const p = await b.newPage(); await p.setViewport({ width: 900, height: 1200, deviceScaleFactor: 1.4 });
await p.goto('file://' + process.cwd() + '/informe.html', { waitUntil: 'networkidle0' });
await p.waitForSelector('body[data-listo]', { timeout: 30000 });
console.log(await p.title());
const pags = await p.$$('.pag');
for (let i = +desde - 1; i < Math.min(pags.length, +hasta); i++) await pags[i].screenshot({ path: `${salida}/p${String(i + 1).padStart(2, '0')}.png` });
console.log(pags.length, 'páginas');
await b.close();
