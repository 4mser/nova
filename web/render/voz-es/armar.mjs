// Builds the Spanish envelope (motor-es/voz/env-es.json), the subtitles array and the narration track placed at V
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { envelope } from '/Users/nicolasmoreno/ambar-studio/src/lib/audio.js'
const V = [1.4, 9.6, 18.72, 30.44, 39.19, 46.27, 52.02, 61.82, 71.83, 84.57, 90.44, 102.55, 110.57, 120.03, 136.72, 148.29, 156.12, 166.28, 174.98, 184.5, 200.98, 219.18, 230.14, 243.26]
const cfg = JSON.parse(readFileSync('render/voz-es/ambar.json', 'utf8')), out = {}
for (const l of cfg.lines) {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', `render/voz-es/es/${l.id}.wav`, '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1e9 }), mono = new Float32Array(b.buffer, b.byteOffset, b.length / 4)
  const env = envelope(mono, 48000, { fps: 30 }).map(v => Math.round(Math.min(1, v) * 1000) / 1000)
  out[l.id] = { d: Math.round(mono.length / 48000 * 100) / 100, i0: 0, env }
}
writeFileSync('motor-es/voz/env-es.json', JSON.stringify(out))
writeFileSync('render/voz-es/frases.json', JSON.stringify(cfg.lines.map(l => l.text)))
const inputs = cfg.lines.flatMap(l => ['-i', `render/voz-es/es/${l.id}.wav`])
const f = cfg.lines.map((l, i) => `[${i}:a]adelay=${Math.round(V[i] * 1000)}:all=1[a${i}]`).join(';') + ';' + cfg.lines.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${cfg.lines.length}:normalize=0,apad=whole_dur=249.2,atrim=0:249.2[o]`
execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', f, '-map', '[o]', '-ar', '48000', '-ac', '2', 'render/voz-es/narracion-es.wav'])
console.log('ok', Object.values(out).map(x => x.d).join(' '))
