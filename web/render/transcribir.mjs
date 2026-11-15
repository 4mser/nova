// Transcribes each cut line literally with Gemini to check the cuts and the reading
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const key = execFileSync('security', ['find-generic-password', '-s', 'ambar-gemini', '-w']).toString().trim()
const cfg = JSON.parse(readFileSync('ambar.json', 'utf8'))
const M = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3-flash-preview']; let q = 1
for (const l of cfg.lines.filter(l => !process.argv[2] || process.argv[2].split(',').includes(l.id))) {
  const mp3 = execFileSync('ffmpeg', ['-v', 'error', '-i', `es/${l.id}.wav`, '-ac', '1', '-b:a', '64k', '-f', 'mp3', 'pipe:1'], { maxBuffer: 1e8 })
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + M[q++ % M.length] + ':generateContent', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: 'audio/mp3', data: mp3.toString('base64') } }, { text: 'Transcribe this Spanish audio LITERALLY. Keep every repetition, stutter or extra word. Reply with the transcript only.' }] }] }) })
  const j = await r.json(), t = j.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim() ?? JSON.stringify(j).slice(0, 120)
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zñ0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const ok = norm(t) === norm(l.say ?? l.text)
  await new Promise(r => setTimeout(r, 4000))
  console.log(ok ? 'ok' : '!!', l.id, ok ? '' : `\n   esperado: ${l.say ?? l.text}\n   oído:     ${t}`)
}
