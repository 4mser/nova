/* Voz del modo Claude.
   · oír: 100 % local. whisper.cpp (servidor en 127.0.0.1, el modelo queda cargado en memoria) transcribe el WAV de la
     página: lo que dices nunca sale del Mac
   · hablar: la voz de NOVA (Aoede) por el puente (/decir), por decisión de Nico: solo viaja la frase corta que se dice
     en voz alta, nunca lo que dijiste ni la respuesta completa. Si el puente no responde, la voz de macOS (`say`).
     En los dos casos es un WAV que la página reproduce, así NOVA mueve la boca con la amplitud real */
const { spawn, execFile } = require('node:child_process');
const { existsSync } = require('node:fs');
const { readFile, unlink } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const PUERTO = 8178;
const BIN = ['/opt/homebrew/bin/whisper-server', '/usr/local/bin/whisper-server'].find(existsSync);

function crearEscucha(dirDatos, { voz = 'Paulina', velocidad = 195, puente = null } = {}) {
  const MODELO = join(dirDatos, 'whisper', 'ggml-large-v3-turbo-q5_0.bin');
  let servidor = null, listo = null;
  const cache = new Map(); // frase → WAV (las repetidas suenan al tiro)

  function arrancar() {
    if (listo) return listo;
    if (!BIN) return Promise.reject(new Error('Falta whisper.cpp: brew install whisper-cpp'));
    if (!existsSync(MODELO)) return Promise.reject(new Error(`Falta el modelo de Whisper en ${MODELO}`));
    servidor = spawn(BIN, ['-m', MODELO, '--host', '127.0.0.1', '--port', String(PUERTO), '-l', 'es', '-nt'], { stdio: 'ignore' });
    servidor.on('exit', () => { servidor = null; listo = null; });
    listo = (async () => {
      for (let i = 0; i < 60; i++) {
        try { const r = await fetch(`http://127.0.0.1:${PUERTO}/`, { signal: AbortSignal.timeout(500) }); if (r.ok || r.status < 500) { calentar(); return; } } catch {}
        await new Promise(r => setTimeout(r, 250));
      }
      throw new Error('Whisper no arrancó');
    })();
    listo.catch(() => { listo = null; });
    return listo;
  }

  /** la primera inferencia carga los kernels de Metal y tarda más: se hace con 1 s de silencio apenas arranca */
  function calentar() {
    const n = 16000, wav = Buffer.alloc(44 + n * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
    const f = new FormData();
    f.append('file', new Blob([wav], { type: 'audio/wav' }), 'calentar.wav');
    f.append('response_format', 'json');
    fetch(`http://127.0.0.1:${PUERTO}/inference`, { method: 'POST', body: f, signal: AbortSignal.timeout(30e3) }).catch(() => {});
  }

  /** WAV (PCM 16 kHz mono) → texto */
  async function transcribir(wav, pista) {
    await arrancar();
    const f = new FormData();
    f.append('file', new Blob([wav], { type: 'audio/wav' }), 'voz.wav');
    f.append('response_format', 'json');
    f.append('language', 'es');
    f.append('temperature', '0');
    if (pista) f.append('prompt', pista);
    const r = await fetch(`http://127.0.0.1:${PUERTO}/inference`, { method: 'POST', body: f, signal: AbortSignal.timeout(30e3) });
    if (!r.ok) throw new Error(`Whisper respondió ${r.status}`);
    const j = await r.json();
    // Whisper inventa estas frases con silencio o ruido
    const t = String(j.text ?? '').replace(/\s+/g, ' ').trim();
    return /^(\[.*\]|\(.*\)|gracias( por ver(lo)?)?\.?|subtítulos.*|amara\.org.*)$/i.test(t) ? '' : t;
  }

  /** texto → WAV con la voz de NOVA (puente) o, si falla, la del Mac */
  async function decir(texto) {
    if (cache.has(texto)) return cache.get(texto);
    if (puente?.url && puente.token) {
      try {
        const r = await fetch(`${puente.url}/decir?i=es&k=${encodeURIComponent(puente.token)}&t=${encodeURIComponent(texto.slice(0, 400))}`, { signal: AbortSignal.timeout(12e3) });
        if (r.ok && /audio|wav|octet/.test(r.headers.get('content-type') ?? '')) {
          const wav = Buffer.from(await r.arrayBuffer());
          cache.set(texto, wav); if (cache.size > 60) cache.delete(cache.keys().next().value);
          return wav;
        }
      } catch {}
    }
    return decirMac(texto);
  }

  /** el PCM y su frecuencia dentro de un WAV */
  function pcmDe(wav) {
    const i = wav.indexOf('data', 12);
    return { pcm: i < 0 ? wav.subarray(44) : wav.subarray(i + 8), hz: wav.readUInt32LE(24) };
  }
  /** WAV con PCM 16 bits mono */
  function wavDe(pcm, hz) {
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(hz, 24); h.writeUInt32LE(hz * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([h, pcm]);
  }

  /** como decir(), pero por partes: alTrozo(pcm, hz) recibe la voz mientras el puente la genera (suena al primer trozo,
      ~1,5 s, en vez de esperar la frase completa). Con un puente sin flujo o sin puente, entrega la frase completa.
      Devuelve true si hubo voz */
  async function decirFlujo(texto, alTrozo) {
    if (cache.has(texto)) { const { pcm, hz } = pcmDe(cache.get(texto)); alTrozo(pcm, hz); return true; }
    if (puente?.url && puente.token) {
      try {
        const r = await fetch(`${puente.url}/decir?flujo=1&i=es&k=${encodeURIComponent(puente.token)}&t=${encodeURIComponent(texto.slice(0, 400))}`, { signal: AbortSignal.timeout(25e3) });
        const tipo = r.headers.get('content-type') ?? '';
        if (r.ok && /wav/.test(tipo)) { // puente anterior: la frase completa
          const wav = Buffer.from(await r.arrayBuffer()), { pcm, hz } = pcmDe(wav);
          cache.set(texto, wav); alTrozo(pcm, hz); return true;
        }
        if (r.ok && r.body) {
          const hz = Number(r.headers.get('x-hz')) || 24000, partes = [];
          let resto = null;
          for await (const c of r.body) {
            let b = resto ? Buffer.concat([resto, Buffer.from(c)]) : Buffer.from(c);
            resto = b.length % 2 ? b.subarray(b.length - 1) : null; // muestras de 2 bytes enteras
            if (resto) b = b.subarray(0, b.length - 1);
            if (b.length) { partes.push(b); alTrozo(b, hz); }
          }
          if (partes.length) {
            cache.set(texto, wavDe(Buffer.concat(partes), hz)); if (cache.size > 60) cache.delete(cache.keys().next().value);
            return true;
          }
        }
      } catch {}
    }
    const wav = await decirMac(texto).catch(() => null);
    if (!wav) return false;
    const { pcm, hz } = pcmDe(wav); alTrozo(pcm, hz);
    return true;
  }

  /** texto → WAV con la voz del Mac */
  function decirMac(texto) {
    const ruta = join(tmpdir(), `nova-voz-${Date.now()}.wav`);
    return new Promise((ok, mal) => execFile('say', ['-v', voz, '-r', String(velocidad), '-o', ruta, '--file-format=WAVE', '--data-format=LEI16@22050', texto], { timeout: 30e3 }, async e => {
      if (e) return mal(e);
      try { ok(await readFile(ruta)); } catch (x) { mal(x); } finally { unlink(ruta).catch(() => {}); }
    }));
  }

  /** deja listas las frases fijas (la tarjeta de permiso, el «¿algo más?») */
  const precargar = frases => Promise.allSettled(frases.map(decir));

  return { arrancar, transcribir, decir, decirFlujo, precargar, cerrar: () => servidor?.kill() };
}

module.exports = { crearEscucha };
