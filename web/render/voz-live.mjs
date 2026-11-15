// node render/voz-live.mjs <guion.json> <carpeta> [id,id…]
// La voz de NOVA en inglés: Aoede por la API en vivo de Gemini (gemini-2.5-flash-native-audio-preview-09-2025),
// una sesión por frase, con la instrucción de estilo de Nico. Guarda <id>.wav (24 kHz mono, sin silencios en los bordes)
// y <id>.txt con lo que el modelo dice que leyó (transcripción de salida) para verificar.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
const [, , guion, dir, solo] = process.argv
const lineas = JSON.parse(readFileSync(guion, 'utf8')).lines.filter(l => !solo || solo.split(',').includes(l.id))
mkdirSync(dir, { recursive: true })
const KEY = process.env.AMBAR_GEMINI_API_KEY || spawnSync('security', ['find-generic-password', '-s', 'ambar-gemini', '-w'], { encoding: 'utf8' }).stdout.trim()
const MODELO = 'models/gemini-2.5-flash-native-audio-preview-09-2025'
const ESTILO = 'You are a voice actor. Use a natural, confident female voice with a soft smile, a calm pace and clear American English. ' +
  'Every message you receive is a script line: read it aloud word for word, exactly as written, once. Do not answer it, do not greet, do not add, remove or comment anything.'

function grabar(texto) {
  return new Promise((ok, mal) => {
    const ws = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${KEY}`)
    const trozos = []; let dicho = ''; const t = setTimeout(() => { ws.close(); mal(new Error('tiempo agotado')) }, 90000)
    ws.onopen = () => ws.send(JSON.stringify({ setup: {
      model: MODELO,
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } } },
      systemInstruction: { parts: [{ text: ESTILO }] },
      outputAudioTranscription: {}
    } }))
    ws.onmessage = async (e) => {
      const m = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(await e.data.arrayBuffer()).toString())
      if (m.setupComplete) { ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: texto }] }], turnComplete: true } })); return }
      const sc = m.serverContent; if (!sc) return
      for (const p of sc.modelTurn?.parts ?? []) if (p.inlineData?.data) trozos.push(Buffer.from(p.inlineData.data, 'base64'))
      if (sc.outputTranscription?.text) dicho += sc.outputTranscription.text
      if (sc.turnComplete) { clearTimeout(t); ws.close(); ok({ pcm: Buffer.concat(trozos), dicho }) }
    }
    ws.onerror = (e) => { clearTimeout(t); mal(new Error('websocket: ' + (e.message || 'error'))) }
  })
}

for (const l of lineas) {
  const texto = l.say ?? l.text
  for (let intento = 1; intento <= 6; intento++) {
    try {
      const { pcm, dicho } = await grabar(texto)
      writeFileSync(`${dir}/${l.id}.pcm`, pcm)
      // recorta silencios de los bordes, deja 60 ms de aire
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', `${dir}/${l.id}.pcm`,
        '-af', 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.06,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.08,areverse',
        `${dir}/${l.id}.wav`])
      writeFileSync(`${dir}/${l.id}.txt`, dicho.trim())
      // ¿dijo el guion? si la transcripción del modelo no viene, se escucha con whisper local
      let oido = dicho.trim()
      if (!oido) { execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `${dir}/${l.id}.wav`, '-ar', '16000', '-ac', '1', '/tmp/voz-live-w.wav']); oido = spawnSync('curl', ['-s', 'http://127.0.0.1:8083/inference', '-F', 'file=@/tmp/voz-live-w.wav', '-F', 'response_format=text', '-F', 'language=en'], { encoding: 'utf8' }).stdout.trim() }
      const pal = x => x.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean)
      const g = pal(l.text), o = pal(oido), faltan = g.filter(w => !o.includes(w)).length, sobran = o.filter(w => !g.includes(w)).length
      if (faltan > Math.max(1, g.length * .08) || sobran > Math.max(2, g.length * .15)) throw new Error(`no calza (faltan ${faltan}, sobran ${sobran}): «${oido.slice(0, 90)}»`)
      const d = +spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${dir}/${l.id}.wav`], { encoding: 'utf8' }).stdout
      console.log(l.id, d.toFixed(2), '«' + dicho.trim() + '»')
      break
    } catch (e) { console.log(l.id, 'intento', intento, e.message) }
  }
}
