/* micrófono → PCM s16le en bloques de 2048 muestras (el AudioContext ya corre a 16 kHz) */
class Pcm extends AudioWorkletProcessor {
  constructor() { super(); this.b = new Int16Array(2048); this.n = 0; }
  process(inputs) {
    const f = inputs[0][0];
    if (f) for (let i = 0; i < f.length; i++) {
      this.b[this.n++] = Math.max(-1, Math.min(1, f[i])) * 32767;
      if (this.n === this.b.length) { this.port.postMessage(this.b.buffer.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('pcm', Pcm);
