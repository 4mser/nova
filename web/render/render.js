// [DESDE=s HASTA=s] node render/render.js <url> <ancho> <alto> <dpr> <salida.mp4> [t …] — renderiza render(t) a 30 fps con el audio del video final
const { spawn } = require('child_process'), puppeteer = require('/Users/nicolasmoreno/ambar-studio/node_modules/puppeteer');
const [url, W, H, DPR, OUT, ...TS] = process.argv.slice(2), FPS = 30, AUD = process.env.AUD || process.env.HOME + '/Downloads/BN_SpaceApps_2026/NOVA_presentacion_v9.mp4';
(async () => {
  const br = await puppeteer.launch({ headless: 'new', protocolTimeout: 900000 }), pg = await br.newPage();
  pg.on('pageerror', e => console.log('ERR', e.message));
  await pg.setViewport({ width: +W, height: +H, deviceScaleFactor: +DPR });
  await pg.goto(url, { waitUntil: 'networkidle0', timeout: 180000 }); await pg.waitForFunction(() => window.__listo, { timeout: 120000 });
  if (TS.length){ for (const t of TS){ await pg.evaluate(async t => { render(t); if (window.__esperar) await window.__esperar(); }, +t); await new Promise(r => setTimeout(r, 150)); await pg.screenshot({ path: OUT.replace('.mp4', `-${t}.png`) }); } return br.close(); }
  const D0 = +(process.env.DESDE || 0), N = Math.round((process.env.HASTA ? +process.env.HASTA : await pg.evaluate(() => DUR)) * FPS), crf = +W * +DPR > 3000 ? '19' : '18';
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-ss', String(D0), '-i', AUD, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-shortest', OUT], { stdio: ['pipe', 'ignore', 'inherit'] });
  const t0 = Date.now();
  for (let f = Math.round(D0 * FPS); f < N; f++){ await pg.evaluate(async t => { render(t); if (window.__esperar) await window.__esperar(); }, f / FPS); const b = await pg.screenshot({ type: 'jpeg', quality: 94 });
    if (!ff.stdin.write(b)) await new Promise(r => ff.stdin.once('drain', r)); if (f % 300 === 0) console.log(f, '/', N, Math.round((Date.now() - t0) / 1000) + 's'); }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await br.close(); console.log('✓', OUT);
})();
