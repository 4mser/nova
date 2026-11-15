// Picks the 23 pauses of the Spanish take that best split it into the 24 script lines (DP over pause candidates)
import { readFileSync, writeFileSync } from 'node:fs'
const cfg = JSON.parse(readFileSync('ambar.json', 'utf8')), L = cfg.lines.map(l => (l.say ?? l.text))
const sil = readFileSync('sil.txt', 'utf8').trim().split('\n').map(r => r.split('\t').map(Number))
const speech = sil.reduce((a, [s, e]) => a - (e - s), +process.argv[2])
const chars = L.map(t => t.length), tot = chars.reduce((a, b) => a + b), exp = chars.map(c => c / tot * speech)
const C = sil.map(([s, e]) => ({ s, e, d: e - s, m: (s + e) / 2 })), n = L.length, K = C.length
// cost of a segment from boundary a to b holding line i: squared relative error of its voiced duration
const voiced = (a, b) => { let v = b - a; for (const c of C) if (c.s >= a && c.e <= b) v -= c.d; return v }
const start0 = C[0].s < 0.05 ? C[0].e : 0, END = C[K - 1].e > +process.argv[2] - 0.05 ? C[K - 1].s : +process.argv[2]
const cand = C.filter(c => c.s > start0 + 0.5 && c.e < END - 0.5)
const B = [{ at: start0, e: start0 }, ...cand.map(c => ({ at: c.s, e: c.e, d: c.d })), { at: END, e: END }]
const INF = 1e18, dp = Array.from({ length: n + 1 }, () => new Array(B.length).fill(INF)), bk = dp.map(r => r.map(() => -1))
dp[0][0] = 0
for (let i = 1; i <= n; i++) for (let j = 1; j < B.length; j++) for (let k = 0; k < j; k++) {
  if (dp[i - 1][k] >= INF) continue
  const v = voiced(B[k].e, B[j].at), r = (v - exp[i - 1]) / exp[i - 1], pen = j === B.length - 1 ? 0 : 0.6 / (B[j].d + 0.05)
  const c = dp[i - 1][k] + r * r * 4 + pen * 0.08
  if (c < dp[i][j]) { dp[i][j] = c; bk[i][j] = k }
}
let j = B.length - 1, seg = []
for (let i = n; i > 0; i--) { const k = bk[i][j]; seg.unshift([B[k].e, B[j].at]); j = k }
seg.forEach(([a, b], i) => console.log(cfg.lines[i].id, a.toFixed(2), b.toFixed(2), (b - a).toFixed(2), 'exp', exp[i].toFixed(2)))
writeFileSync('cortes.json', JSON.stringify(seg))
