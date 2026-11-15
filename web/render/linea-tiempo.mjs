// node render/linea-tiempo.mjs <carpeta de voz> → escribe S, V y DUR en motor/halo3.js a partir de lo que dura cada frase.
// Cada escena empieza 0,6 s antes de su primera frase; las frases de una misma escena van separadas por 1 s;
// la escena termina 1,1 s después de su última frase, o cuando cumple su largo mínimo (lo que piden sus animaciones).
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const dir = process.argv[2]
const dur = i => +spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${dir}/${String(i + 1).padStart(2, '0')}.wav`], { encoding: 'utf8' }).stdout
const ESC = [
  ['intro', [0], { lead: 1.4, min: 9.0 }], ['dist', [1], { min: 9.12 }], ['cuerpo', [2], { min: 11.72 }], ['nova', [3], { min: 8.75 }],
  ['reveal', [4], { min: 7.6 }], ['phones', [5, 6, 7]], ['checkin', [8], { min: 12 }], ['privacy', [9], { min: 7 }],
  ['crewS', [10], { min: 8 }], ['vitalsS', [11], { min: 6.6 }], ['gemeloS', [12]], ['ejercicio', [28], { min: 9 }], ['mujeres', [29], { min: 11 }], ['menteS', [13], { min: 7.2 }],
  ['emerg', [14], { min: 9.8 }], ['escaner', [15, 16]], ['rcpg', [17], { min: 8.5 }], ['kit', [18], { lead: 5.0, min: 17 }], ['bib', [30], { min: 6.5 }], ['pron', [19], { min: 6.6 }],
  ['abordo', [20], { min: 9.1 }], ['ciclo', [21, 22, 23], { min: 28 }], ['modelos', [24], { min: 9.6 }], ['ciencia', [25], { min: 10.7 }],
  ['ruta', [26], { min: 11.97 }], ['cierre', [27], { min: 6.54 }]
]
const S = {}, V = []; let t = 0
for (const [n, lineas, o = {}] of ESC) {
  S[n] = +t.toFixed(2); let x = t + (o.lead ?? .6)
  for (const i of lineas) { V[i] = +x.toFixed(2); x += dur(i) + 1.0 }
  t = Math.max(x - 1.0 + 1.1, S[n] + (o.min ?? 0))
}
const DUR = process.env.DUR_OBJ ? +process.env.DUR_OBJ : +t.toFixed(3)
const js = readFileSync('motor/halo3.js', 'utf8')
  .replace(/const S = \{.*?\};/s, 'const S = ' + JSON.stringify(S).replace(/"/g, '').replace(/,/g, ', ').replace(/:/g, ': ') + ';')
  .replace(/const V = \[.*?\];/s, 'const V = ' + JSON.stringify(V).replace(/,/g, ', ') + ';')
  .replace(/const DUR = [\d.]+;/, `const DUR = ${DUR};`)
writeFileSync('motor/halo3.js', js)
console.log('DUR', DUR, '·', (DUR / 60 | 0) + ':' + String(Math.round(DUR % 60)).padStart(2, '0')); console.log(S)
