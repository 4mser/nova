// node render/armar2.mjs en|es → envolvente para la boca de NOVA, pista de narración y mezcla final con la música alargada
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { envelope } from '/Users/nicolasmoreno/ambar-studio/src/lib/audio.js'
const lang = process.argv[2], src = lang === 'en' ? (process.env.VOZ || 'render/v3/voz') : 'render/voz-es-v2', motor = lang === 'en' ? 'motor' : 'motor-es'
const s = readFileSync('motor/halo3.js', 'utf8'), V = JSON.parse(s.match(/const V = (\[.*?\]);/s)[1]), DUR = +s.match(/const DUR = ([\d.]+);/)[1]
const ids = V.map((_, i) => String(i + 1).padStart(2, '0')), out = {}
for (const id of ids) {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', `${src}/${id}.wav`, '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1e9 }), mono = new Float32Array(b.buffer, b.byteOffset, b.length / 4)
  out[id] = { d: Math.round(mono.length / 48000 * 100) / 100, i0: 0, env: envelope(mono, 48000, { fps: 30 }).map(v => Math.round(Math.min(1, v) * 1000) / 1000) }
}
writeFileSync(`${motor}/voz/env-${lang}.json`, JSON.stringify(out))
// las frases no se pisan
ids.forEach((id, i) => { if (i < ids.length - 1 && V[i] + out[id].d > V[i + 1] - .3) console.log('! se pisa', id, (V[i] + out[id].d).toFixed(2), V[i + 1]) })
const inputs = ids.flatMap(id => ['-i', `${src}/${id}.wav`])
const f = ids.map((_, i) => `[${i}:a]aresample=48000,adelay=${Math.round(V[i] * 1000)}:all=1[a${i}]`).join(';') + ';' + ids.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${ids.length}:normalize=0,apad=whole_dur=${DUR},atrim=0:${DUR}[o]`
execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', f, '-map', '[o]', '-ar', '48000', '-ac', '2', `render/narracion-${lang}.wav`])
// música: se repite un tramo de 52,475 s (la pista se parece a sí misma con ese desfase) empalmado en el inicio de las escenas nuevas
const CUT = +(process.env.CUT || 185.0), LAG = +(process.env.LAG || 24.0), X = 1.0
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', 'musica/nova-musica.mp3', '-filter_complex',
  `[0:a]atrim=0:${CUT + X / 2},asetpts=PTS-STARTPTS[p1];[0:a]atrim=${CUT - LAG - X / 2},asetpts=PTS-STARTPTS[p2];[p1][p2]acrossfade=d=${X}:c1=tri:c2=tri,atrim=0:${DUR},apad=whole_dur=${DUR},afade=t=out:st=${DUR - 1.4}:d=1.4[m]`,
  '-map', '[m]', '-ar', '48000', '-ac', '2', 'render/musica-larga.wav'])
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `render/narracion-${lang}.wav`, '-i', 'render/musica-larga.wav', '-filter_complex',
  `[0:a]asplit=2[v][sc];[1:a]volume=0.67[m];[m][sc]sidechaincompress=threshold=0.02:ratio=5:attack=35:release=400:makeup=1[md];[v][md]amix=inputs=2:normalize=0,atrim=0:${DUR}[o]`,
  '-map', '[o]', '-ar', '48000', '-ac', '2', `render/mezcla-pre-${lang}.wav`])
const I = +spawnSync('ffmpeg', ['-hide_banner', '-i', `render/mezcla-pre-${lang}.wav`, '-af', 'ebur128', '-f', 'null', '-']).stderr.toString().match(/I:\s+(-?[\d.]+) LUFS/g).pop().match(/-?[\d.]+/)[0]
const G = -15 - I
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `render/mezcla-pre-${lang}.wav`, '-af', `volume=${G}dB,alimiter=limit=0.95:attack=5:release=50`, '-ar', '48000', `render/mezcla-${lang}.wav`])
console.log(lang, 'ok · pre', I, 'LUFS · ganancia', G.toFixed(2), 'dB · dur', DUR)
