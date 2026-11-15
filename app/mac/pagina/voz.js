/* Conversación en tiempo real con NOVA a través del puente (servidor/voz.mjs ⇄ Gemini Live), como en src/voz/vivo.ts:
   · el micrófono va en PCM 16 kHz mientras la conversación está abierta; NOVA detecta cuándo terminaste
   · su voz llega en trozos PCM 24 kHz que se encadenan sin huecos en un AudioContext
   · `nivel()` es la amplitud real de lo que está sonando: mueve el cuerpo y la luz de NOVA
   · mientras NOVA habla no se manda el micrófono (medio dúplex), para que no se escuche a sí misma por los parlantes
   · al abrir, el puente, el micrófono y el contexto arrancan a la vez; lo que digas antes de que el puente esté listo
     se guarda y se manda apenas lo esté, así puedes hablar de inmediato */

import { MIC } from './grabar.js';

const HZ_SALIDA = 24000;
const PREVIO_MAX = 16000 * 2 * 8; // hasta 8 s de micrófono mientras conecta
// interrumpir hablando encima: tu voz tiene que superar esto (nivel 0..1) durante 3 bloques seguidos (~380 ms) mientras
// NOVA habla; su propia voz por los parlantes, ya sin eco, queda bastante por debajo
const INTERRUMPIR = 0.35, INTERRUMPIR_BLOQUES = 3;
// compuerta de ruido: lo que no llega a tu volumen se manda como silencio, así la tele o una voz lejana no le
// hablan a Gemini. Abre con 2 bloques seguidos (~256 ms) sobre COMPUERTA (rms), se queda abierta ~640 ms después
// de bajar (pausas entre palabras) y al abrir manda también los bloques recientes para no cortar la primera sílaba
const COMPUERTA = 0.03, COMPUERTA_ABRE = 2, COMPUERTA_COLA = 5, COMPUERTA_PREVIO = 3;

const aBase64 = buf => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const deBase64 = s => { const b = atob(s), out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; };

export class Conversacion {
  /** contexto: { nombre, datos } o una promesa de eso
      eventos: { estado(e), oye(trozo), dice(trozo), finTurno(), herramienta(nombre, args) → respuesta, error(msg) } */
  constructor({ url, contexto, eventos }) {
    this.url = url; this.contexto = contexto; this.ev = eventos;
    this.ws = null; this.mic = null; this.salida = null; this.analizador = null;
    this.fuentes = new Set(); this.siguiente = 0; this.cerrada = false; this.previo = []; this.previoBytes = 0;
  }

  async abrir() {
    this.ev.estado('conectando');
    this.salida = new AudioContext({ sampleRate: HZ_SALIDA });
    this.analizador = this.salida.createAnalyser();
    this.analizador.fftSize = 512;
    this.analizador.connect(this.salida.destination);
    this.muestras = new Float32Array(this.analizador.fftSize);
    const ws = (this.ws = new WebSocket(this.url));
    ws.onopen = async () => {
      const c = await Promise.resolve(this.contexto).catch(() => ({}));
      if (this.cerrada || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ tipo: 'inicio', modo: 'chat', idioma: 'es', perfil: 'diario', asistente: true, dispositivo: 'mac', saludar: false, contexto: { nombre: c?.nombre ?? 'Nico', sol: 0, datos: c?.datos ?? '' } }));
    };
    ws.onmessage = e => this.recibir(JSON.parse(e.data));
    ws.onerror = () => { if (!this.cerrada) this.ev.error('No pude conectar con el puente de voz'); };
    ws.onclose = ev => { if (!this.cerrada) { if (ev.code === 4401) this.ev.error('El puente rechazó la clave (VOZ_TOKEN)'); this.cerrar(); } };
    await this.abrirMic();
    // ya se puede hablar: lo dicho se guarda hasta que el puente esté listo
    if (!this.cerrada) this.ev.estado('escuchando');
  }

  async abrirMic() {
    const medio = await navigator.mediaDevices.getUserMedia(MIC);
    // si se cerró mientras el micrófono se abría, no queda nada escuchando
    if (this.cerrada) { medio.getTracks().forEach(t => t.stop()); return; }
    const ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule('pcm.js');
    if (this.cerrada) { medio.getTracks().forEach(t => t.stop()); ctx.close(); return; }
    const fuente = ctx.createMediaStreamSource(medio), nodo = new AudioWorkletNode(ctx, 'pcm');
    nodo.port.onmessage = e => {
      const t = new Int16Array(e.data); let s = 0;
      for (let i = 0; i < t.length; i += 4) { const x = t[i] / 32768; s += x * x; }
      const rms = Math.sqrt(s / (t.length / 4));
      this.nivelMic = Math.min(1, rms * 9);
      if (this.listo && this.hablando()) {
        // mientras NOVA habla no se manda el micrófono; si hablas encima, se calla y lo que dijiste sigue al puente
        this.reciente = [...(this.reciente ?? []), e.data].slice(-INTERRUMPIR_BLOQUES - 1);
        this.fuerte = this.nivelMic > INTERRUMPIR ? (this.fuerte ?? 0) + 1 : 0;
        if (this.fuerte >= INTERRUMPIR_BLOQUES) {
          this.fuerte = 0; this.callar(); this.ev.interrumpe?.();
          // si el puente aún generaba esa respuesta, el resto se descarta; si ya la había terminado, lo próximo es nuevo
          this.ignorar = this.generando;
          if (this.ws?.readyState === WebSocket.OPEN) for (const a of this.reciente) this.ws.send(JSON.stringify({ tipo: 'audio', data: aBase64(a), rate: 16000 }));
          this.reciente = [];
        }
      } else for (const a of this.compuerta(e.data, rms)) {
        if (this.listo && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ tipo: 'audio', data: aBase64(a), rate: 16000 }));
        else if (!this.listo) {
          this.previo.push(a); this.previoBytes += a.byteLength;
          while (this.previoBytes > PREVIO_MAX) this.previoBytes -= this.previo.shift().byteLength;
        }
      }
    };
    fuente.connect(nodo);
    this.mic = { parar: () => { nodo.port.onmessage = null; nodo.disconnect(); fuente.disconnect(); medio.getTracks().forEach(t => t.stop()); ctx.close(); } };
  }

  /** compuerta de ruido: devuelve los bloques a mandar (tu voz tal cual, o silencio del mismo largo) */
  compuerta(bloque, rms) {
    const g = (this.g ??= { seguidos: 0, cola: 0, recientes: [] });
    g.seguidos = rms > COMPUERTA ? g.seguidos + 1 : 0;
    if (g.cola > 0) { g.cola = g.seguidos ? COMPUERTA_COLA : g.cola - 1; return [bloque]; }
    if (g.seguidos >= COMPUERTA_ABRE) { g.cola = COMPUERTA_COLA; const r = [...g.recientes, bloque]; g.recientes = []; return r; }
    g.recientes = [...g.recientes, bloque].slice(-COMPUERTA_PREVIO);
    return [new ArrayBuffer(bloque.byteLength)];
  }

  async recibir(m) {
    if (m.tipo === 'listo') {
      this.listo = true; this.ev.estado('escuchando');
      for (const a of this.previo) this.ws.send(JSON.stringify({ tipo: 'audio', data: aBase64(a), rate: 16000 }));
      this.previo = []; this.previoBytes = 0;
      for (const q of this.porMandar ?? []) this.texto(q); this.porMandar = [];
    }
    else if (m.tipo === 'audio') { this.generando = true; if (!this.ignorar) this.sonar(deBase64(m.data)); }
    else if (m.tipo === 'oye') this.ev.oye(m.texto);
    else if (m.tipo === 'dice') { if (!this.ignorar) this.ev.dice(m.texto); }
    else if (m.tipo === 'fin_turno') { this.generando = false; this.ignorar = false; this.ev.finTurno(); }
    // el puente oyó que hablaste encima: lo que llegue desde ahora es la respuesta nueva
    else if (m.tipo === 'interrumpido') { this.callar(); this.ignorar = false; }
    else if (m.tipo === 'herramienta') {
      const r = await Promise.resolve(this.ev.herramienta(m.nombre, m.args ?? {})).catch(e => ({ ok: false, motivo: String(e?.message ?? e) }));
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ tipo: 'herramienta', id: m.id, nombre: m.nombre, respuesta: r ?? { ok: true } }));
    } else if (m.tipo === 'error') { this.ev.error(m.mensaje || 'Error del puente'); this.cerrar(); }
  }

  /** encadena un trozo de voz justo después del anterior */
  sonar(pcm) {
    const n = Math.floor(pcm.length / 2), v = new DataView(pcm.buffer, pcm.byteOffset, n * 2), buf = this.salida.createBuffer(1, n, HZ_SALIDA), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = v.getInt16(i * 2, true) / 32768;
    const f = this.salida.createBufferSource();
    f.buffer = buf; f.connect(this.analizador);
    const ahora = this.salida.currentTime, ini = Math.max(ahora + 0.03, this.siguiente);
    f.start(ini); this.siguiente = ini + buf.duration;
    this.fuentes.add(f); f.onended = () => this.fuentes.delete(f);
  }
  /** un clic mientras habla: se calla ya y descarta el resto de esta respuesta (la conversación sigue abierta) */
  silenciar() { this.callar(); this.ignorar = true; }
  callar() { for (const f of this.fuentes) { try { f.stop(); } catch {} } this.fuentes.clear(); this.siguiente = 0; }
  /** ¿queda voz de NOVA por sonar? (con un margen para que el eco de la pieza se apague) */
  hablando() { return !!this.salida && this.salida.currentTime < this.siguiente + 0.25; }

  /** amplitud 0..1 de lo que suena ahora */
  nivel() {
    if (!this.analizador || !this.hablando()) return 0;
    this.analizador.getFloatTimeDomainData(this.muestras);
    let s = 0; for (const x of this.muestras) s += x * x;
    return Math.min(1, Math.sqrt(s / this.muestras.length) * 5);
  }

  texto(t) {
    if (this.listo && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ tipo: 'texto', texto: t }));
    else (this.porMandar ??= []).push(t);
  }

  /** un cuadro (JPEG en base64) para que NOVA vea algo: la pantalla del Mac */
  imagen(b64) { if (this.listo && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ tipo: 'imagen', data: b64 })); }

  cerrar() {
    if (this.cerrada) return;
    this.cerrada = true;
    this.callar();
    this.mic?.parar();
    try { this.ws?.close(); } catch {}
    this.salida?.close().catch(() => {});
    this.ev.estado('cerrada');
  }
}
