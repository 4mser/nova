/* Grabar una frase para el modo Claude (todo local): micrófono → PCM 16 kHz → WAV cuando terminas de hablar.
   Detección de voz por energía: empieza a contar cuando hablas y corta tras ~0,9 s de silencio (o 40 s de frase).
   Si en `esperaMax` no dijiste nada, devuelve null. `nivel` (0..1) es el volumen en vivo para la onda y NOVA. */

const UMBRAL = 0.03, SILENCIO_FIN = 0.9, FRASE_MAX = 40;

/* micrófono para ti y no para la pieza: además de eco, ruido y ganancia, pide el aislamiento de voz del sistema
   (si Chromium no lo soporta, lo ignora). Los umbrales de volumen hacen el resto: la tele o una voz lejana
   llegan bastante más bajo que tú hablándole al Mac */
export const MIC = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceIsolation: true, channelCount: 1 } };

function wav(muestras, hz) {
  const b = new ArrayBuffer(44 + muestras.length * 2), v = new DataView(b);
  const txt = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  txt(0, 'RIFF'); v.setUint32(4, 36 + muestras.length * 2, true); txt(8, 'WAVE'); txt(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, hz, true);
  v.setUint32(28, hz * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, muestras.length * 2, true);
  new Int16Array(b, 44).set(muestras);
  return b;
}

export class Grabadora {
  /* `gen` cuenta las órdenes de parar: si llega una mientras el micrófono todavía se abre (los await de abajo), esa
     grabación se descarta apenas termina de abrir. `bloqueada`: micrófono apagado, no se abre nada. */
  constructor() { this.nivel = 0; this.activa = null; this.gen = 0; this.bloqueada = false; }

  /** graba una frase; `alEmpezar` avisa cuando detecta voz.
      · `umbral()`: volumen mínimo para considerar que empezaste a hablar (más alto mientras NOVA habla, para que su
        propia voz por los parlantes no la dispare)
      · `inicioMin`: cuántos bloques seguidos (~128 ms c/u) sobre el umbral hacen falta para empezar
      · `pausa()`: mientras devuelva true, el plazo `esperaMax` no corre (NOVA todavía está hablando) */
  async frase({ esperaMax = 8, fraseMax = FRASE_MAX, alEmpezar, umbral = () => UMBRAL, inicioMin = () => 2, pausa = () => false } = {}) {
    this.parar();
    const mio = ++this.gen;
    if (this.bloqueada) return null;
    const medio = await navigator.mediaDevices.getUserMedia(MIC);
    const vigente = () => mio === this.gen && !this.bloqueada;
    if (!vigente()) { medio.getTracks().forEach(t => t.stop()); return null; }
    const ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule('pcm.js');
    if (!vigente()) { medio.getTracks().forEach(t => t.stop()); ctx.close(); return null; }
    const fuente = ctx.createMediaStreamSource(medio), nodo = new AudioWorkletNode(ctx, 'pcm');
    fuente.connect(nodo);
    return new Promise(listo => {
      const trozos = [], previo = [];
      let hablando = false, silencio = 0, total = 0, espera = 0, seguidos = 0;
      const terminar = ok => {
        nodo.port.onmessage = null; nodo.disconnect(); fuente.disconnect(); medio.getTracks().forEach(t => t.stop()); ctx.close();
        this.nivel = 0; this.activa = null;
        if (!ok || !trozos.length) return listo(null);
        const n = trozos.reduce((a, t) => a + t.length, 0), todo = new Int16Array(n);
        let o = 0; for (const t of trozos) { todo.set(t, o); o += t.length; }
        listo(wav(todo, 16000));
      };
      this.activa = { terminar: () => terminar(hablando), cancelar: () => terminar(false) };
      nodo.port.onmessage = e => {
        const t = new Int16Array(e.data), dur = t.length / 16000;
        let s = 0; for (let i = 0; i < t.length; i += 2) { const x = t[i] / 32768; s += x * x; }
        const rms = Math.sqrt(s / (t.length / 2));
        this.nivel = Math.min(1, rms * 9);
        if (!hablando) {
          // guarda un poco de antes para no cortar la primera sílaba
          previo.push(t); if (previo.length > 3) previo.shift();
          if (!pausa()) espera += dur;
          seguidos = rms > umbral() ? seguidos + 1 : 0;
          if (seguidos >= inicioMin()) { hablando = true; trozos.push(...previo); alEmpezar?.(); }
          else if (espera > esperaMax) terminar(false);
          return;
        }
        trozos.push(t); total += dur;
        silencio = rms > umbral() * 0.7 ? 0 : silencio + dur;
        if (silencio > SILENCIO_FIN || total > fraseMax) terminar(true);
      };
    });
  }

  /** cortar ya: con lo grabado (terminar) o sin nada (cancelar) */
  terminar() { this.activa?.terminar(); }
  parar() { this.gen++; this.activa?.cancelar(); }
}

/** reproduce un WAV (la voz del Mac) y expone su amplitud para que NOVA hable */
export class Altavoz {
  constructor() { this.ctx = null; this.fuente = null; }
  /** alTerminar(callado): callado = true si se cortó antes de terminar */
  async decir(buf, alTerminar) {
    this.callar();
    this.alTerminar = alTerminar;
    this.ctx ??= new AudioContext();
    const audio = await this.ctx.decodeAudioData(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
    const f = (this.fuente = this.ctx.createBufferSource()), an = (this.an = this.ctx.createAnalyser());
    an.fftSize = 512; this.m = new Float32Array(512);
    f.buffer = audio; f.connect(an); an.connect(this.ctx.destination);
    f.onended = () => { if (this.fuente === f) { this.fuente = null; const cb = this.alTerminar; this.alTerminar = null; cb?.(false); } };
    f.start();
  }
  /** voz que llega por partes (PCM 16 bits): suena con el primer trozo y encadena los siguientes sin huecos.
      Devuelve { trozo(pcm, hz), fin() }; alTerminar(callado) cuando terminó de sonar todo (o la callaron) */
  flujo(alTerminar) {
    this.callar();
    this.alTerminar = alTerminar;
    this.ctx ??= new AudioContext();
    const an = (this.an = this.ctx.createAnalyser());
    an.fftSize = 512; this.m = new Float32Array(512); an.connect(this.ctx.destination);
    const f = (this.fuente = { fuentes: new Set(), siguiente: 0, cerrado: false, stop: () => { for (const x of f.fuentes) { try { x.stop(); } catch {} } } });
    const revisar = () => {
      if (this.fuente !== f || !f.cerrado || f.fuentes.size) return;
      this.fuente = null; const cb = this.alTerminar; this.alTerminar = null; cb?.(false);
    };
    return {
      trozo: (pcm, hz) => {
        if (this.fuente !== f) return;
        const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength), n = pcm.byteLength >> 1;
        const buf = this.ctx.createBuffer(1, n, hz), d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = v.getInt16(i * 2, true) / 32768;
        const x = this.ctx.createBufferSource();
        x.buffer = buf; x.connect(an);
        // el primero parte con 0,3 s de colchón: Gemini genera más o menos al ritmo en que suena
        const ahora = this.ctx.currentTime, ini = Math.max(ahora + (f.fuentes.size ? 0.03 : 0.3), f.siguiente);
        x.start(ini); f.siguiente = ini + buf.duration;
        f.fuentes.add(x); x.onended = () => { f.fuentes.delete(x); revisar(); };
      },
      fin: () => { f.cerrado = true; revisar(); },
    };
  }
  callar() { const f = this.fuente, cb = this.alTerminar; this.fuente = null; this.alTerminar = null; try { f?.stop(); } catch {} cb?.(true); }
  hablando() { return !!this.fuente; }
  nivel() {
    if (!this.fuente) return 0;
    this.an.getFloatTimeDomainData(this.m);
    let s = 0; for (const x of this.m) s += x * x;
    return Math.min(1, Math.sqrt(s / this.m.length) * 5);
  }
}
