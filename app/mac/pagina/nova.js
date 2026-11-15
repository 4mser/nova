/* NOVA en canvas 2D: port de src/nova/forma.ts (geometría) y src/nova/NovaOrb.tsx (dibujo).
   Gel turquesa con orbes que lo orbitan en 3D y se funden con el cuerpo (metaball: desenfoque + umbral de alfa
   con el filtro SVG #goo); ojos que parpadean y cambian de forma escondidos en el parpadeo. */

export const PAL = { centro: '#02121a', hondo: '#0a4458', medio: '#1d9cc0', borde: '#5ad8f2', ojo: '#a6f2fc', halo: '#46c8e8', claro: '#c4f6fd', alerta: '#e2589b' };
export const EXPRS = ['normal', 'feliz', 'pensativa', 'sorprendida', 'dormida', 'triste'];

/* siluetas: base + lóbulos [ángulo°, largo, ancho] — mezclar formas = sumar lóbulos ponderados */
const FORMAS = {
  normal: { base: 0.72, lob: [[-48, 0.5, 0.3], [192, 0.36, 0.4], [36, 0.32, 0.45], [118, 0.2, 0.5], [-128, 0.14, 0.45]] },
  feliz: { base: 0.72, lob: [[-40, 0.46, 0.28], [-140, 0.42, 0.28], [20, 0.26, 0.45], [162, 0.26, 0.45], [92, 0.12, 0.6]] },
  pensativa: { base: 0.74, lob: [[-122, 0.5, 0.28], [14, 0.28, 0.45], [172, 0.24, 0.45], [80, 0.18, 0.5], [-38, 0.14, 0.4]] },
  sorprendida: { base: 0.7, lob: [[-90, 0.36, 0.38], [-4, 0.34, 0.32], [184, 0.34, 0.32], [58, 0.14, 0.5], [122, 0.14, 0.5]] },
  dormida: { base: 0.66, lob: [[0, 0.42, 0.5], [180, 0.42, 0.5], [-90, 0.06, 0.5], [60, 0.1, 0.5], [120, 0.1, 0.5]] },
  triste: { base: 0.72, lob: [[112, 0.34, 0.34], [68, 0.34, 0.34], [180, 0.2, 0.42], [0, 0.2, 0.42], [-90, 0.08, 0.5]] },
};
/* órbitas de los orbes: radio(×R), inclinación, giro del plano, velocidad, fase, tamaño(×R) */
const ORBITAS = [
  [1.55, 1.25, 0.25, 0.55, 0.0, 0.14], [1.78, 1.1, 1.25, -0.42, 2.1, 0.1], [1.62, 1.35, -0.7, 0.7, 4.0, 0.095],
  [1.95, 1.18, 2.2, 0.33, 1.2, 0.08], [1.7, 1.3, -1.6, -0.6, 5.1, 0.11], [2.1, 1.22, 0.75, 0.26, 3.3, 0.065],
];
const POLVO = Array.from({ length: 56 }, (_, i) => {
  const h = k => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
  return [1.25 + h(1) * 0.75, (0.15 + h(2) * 0.45) * (h(3) < 0.5 ? 1 : -1), h(4) * 6.283];
});

function siluetaPts(cx, cy, R, pesos, t, habla) {
  let W = 0;
  for (const w of pesos) W += w;
  let base = 0;
  const L = [];
  for (let k = 0; k < EXPRS.length; k++) {
    const w = pesos[k];
    if (w <= 0.0005) continue;
    const F = FORMAS[EXPRS[k]];
    base += F.base * w;
    for (let i = 0; i < 5; i++) {
      const lb = F.lob[i];
      const a = (lb[0] * Math.PI) / 180 + Math.sin(t * 0.6 + i * 1.9) * 0.08 + 0.2 * Math.sin(t * 0.43 + i * 2.3) + 0.08 * Math.sin(t * 1.1 + i);
      const l = ((lb[1] * w) / W) * (1 + 0.08 * Math.sin(t * 0.9 + i * 1.7)) * (1 + 0.16 * Math.sin(t * 0.71 + i * 1.7));
      L.push(a, l, lb[2] * (1 + 0.12 * Math.sin(t * 0.5 + i)));
    }
  }
  base = (base / W) * (1 + 0.025 * Math.sin(t * 1.3) + habla * 0.015);
  L.push(t * 0.37 + 1, 0.1 * (0.6 + 0.4 * Math.sin(t * 0.9)), 0.32, -t * 0.29 + 3.5, 0.08 * (0.6 + 0.4 * Math.sin(t * 0.7 + 2)), 0.3);
  if (habla > 0.01) {
    for (let j = 0; j < 3; j++) L.push(t * (0.9 + j * 0.35) + j * 2.1, habla * 0.05, 0.22);
    L.push(Math.PI / 2 + 0.15 * Math.sin(t * 0.8), habla * 0.1, 0.42);
  }
  const P = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    let r = base;
    for (let k = 0; k < L.length; k += 3) {
      const d = Math.atan2(Math.sin(a - L[k]), Math.cos(a - L[k]));
      r += L[k + 1] * Math.exp((-d * d) / (2 * L[k + 2] * L[k + 2]));
    }
    const yy = Math.sin(a) * r * R;
    P.push(cx + Math.cos(a) * r * R, cy + (yy > 0 ? yy * 0.86 : yy));
  }
  return P;
}

/** curva cerrada suave (Catmull-Rom → Bézier) */
function cerrada(P) {
  const p = new Path2D(), n = P.length / 2;
  p.moveTo(P[0], P[1]);
  for (let i = 0; i < n; i++) {
    const i0 = ((i - 1 + n) % n) * 2, i1 = i * 2, i2 = ((i + 1) % n) * 2, i3 = ((i + 2) % n) * 2;
    p.bezierCurveTo(P[i1] + (P[i2] - P[i0]) / 6, P[i1 + 1] + (P[i2 + 1] - P[i0 + 1]) / 6, P[i2] - (P[i3] - P[i1]) / 6, P[i2 + 1] - (P[i3 + 1] - P[i1 + 1]) / 6, P[i2], P[i2 + 1]);
  }
  p.closePath();
  return p;
}

/** orbes: [x, y, profundidad −1..1, radio] × 6 */
function orbes(cx, cy, R, t, apertura, yaw = 0, pitch = 0) {
  const out = [];
  for (const [r, inc, giro, v, f, s] of ORBITAS) {
    const a = t * v + f, rr = r * R * apertura;
    let px = Math.cos(a) * rr, py = 0, pz = Math.sin(a) * rr;
    const ci = Math.cos(inc), si = Math.sin(inc);
    const py2 = py * ci - pz * si, pz2 = py * si + pz * ci;
    py = py2; pz = pz2;
    const cg = Math.cos(giro), sg = Math.sin(giro);
    let px2 = px * cg - py * sg, py3 = px * sg + py * cg;
    const cy_ = Math.cos(yaw), sy_ = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x3 = px2 * cy_ + pz * sy_, z3 = -px2 * sy_ + pz * cy_;
    const y4 = py3 * cp - z3 * sp, z4 = py3 * sp + z3 * cp;
    px2 = x3; py3 = y4; pz = z4;
    const prof = pz / (r * R);
    out.push([cx + px2, cy + py3 * 0.9, prof, s * R * (1 + 0.22 * prof)]);
  }
  return out;
}

/** ojos según la expresión: píldoras rellenas o arcos de trazo, proyectados sobre la esfera con yaw/pitch */
function ojos(cx, cy, R, expr, mira, parpadeo, yaw = 0, pitch = 0) {
  const cpz = Math.cos(pitch);
  const ex = cx + mira[0] * R * 0.1, ey = cy - R * 0.08 - Math.sin(pitch) * R * 0.42 + mira[1] * R * 0.07, w = R * 0.105, hgt = R * 0.3 * (1 - parpadeo * 0.9) * Math.max(0.15, cpz);
  const pos = [-1, 1].map(s => { const a = yaw + s * 0.36; return { s, c: Math.cos(a), x: ex + Math.sin(a) * R * 0.47 }; }).filter(o => o.c > 0.08 && cpz > 0.1);
  const p = new Path2D(), e = EXPRS[expr];
  if (e === 'feliz' || e === 'dormida') {
    for (const o of pos) {
      const ww = w * o.c;
      if (e === 'feliz') { p.moveTo(o.x - ww * 1.1, ey + R * 0.03); p.quadraticCurveTo(o.x, ey - R * 0.12 * cpz, o.x + ww * 1.1, ey + R * 0.03); }
      else { p.moveTo(o.x - ww, ey); p.quadraticCurveTo(o.x, ey + R * 0.07 * cpz, o.x + ww, ey); }
    }
    return { path: p, trazo: true, ancho: e === 'feliz' ? w * 0.8 : w * 0.6 };
  }
  const k = e === 'sorprendida' ? 1.15 : 1;
  for (const o of pos) {
    const alto = e === 'pensativa' && o.s < 0 ? hgt * 0.85 : hgt * k, ww = w * o.c;
    p.roundRect(o.x - ww / 2, ey - alto / 2, ww, alto, Math.min(ww, alto) / 2);
  }
  return { path: p, trazo: false, ancho: 0 };
}

const gradiente = (ctx, x, y, r, colores, pos) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); colores.forEach((c, i) => g.addColorStop(pos[i], c)); return g; };
const GEL = [PAL.centro, PAL.hondo, PAL.medio, PAL.borde, PAL.claro], POS_GEL = [0, 0.25, 0.43, 0.56, 1];

/** NOVA viva en un <canvas>: expresión, mirada, voz (habla 0..1) y giro 3D [yaw, pitch] */
export class Nova {
  constructor(canvas, { cuerpo = 0.17 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.capa = document.createElement('canvas');
    this.cctx = this.capa.getContext('2d');
    this.fCuerpo = cuerpo;
    this.t = 0; this.pesos = EXPRS.map((_, i) => (i === 0 ? 1 : 0.001)); this.objetivo = 0;
    this.miraObj = null; this.miraAct = [0, 0]; this.hab = 0; this.habla = 0;
    this.giro = [0, 0]; this.giroObj = [0, 0]; this.brillo = 0; this.luz = 0;
    // escuchando: anillo (0..1, se enciende suave) y nivel del micrófono (0..1) que lo hace latir
    this.escucha = 0; this.anillo = 0; this.mic = 0; this.micS = 0;
    this.ojoVer = 0; this.parp = 0; this.prox = 2.5; this.cambio = -1;
    this.medir();
    addEventListener('resize', () => this.medir());
    let antes = performance.now();
    const cuadro = ahora => { const dt = Math.min(0.05, (ahora - antes) / 1000); antes = ahora; this.avanzar(dt); this.dibujar(); requestAnimationFrame(cuadro); };
    requestAnimationFrame(cuadro);
  }

  medir() {
    const dpr = devicePixelRatio || 1, S = this.canvas.clientWidth;
    this.dpr = dpr; this.S = S; this.R = S * this.fCuerpo;
    for (const c of [this.canvas, this.capa]) { c.width = Math.round(S * dpr); c.height = Math.round(S * dpr); }
    // el desenfoque del metaball va en píxeles reales del lienzo
    document.getElementById('goo-blur')?.setAttribute('stdDeviation', String(this.R * 0.075 * dpr));
  }

  expresion(e) { const i = EXPRS.indexOf(e); if (i >= 0) this.objetivo = i; }
  mirar(m) { this.miraObj = m; }
  girar(yaw, pitch) { this.giroObj = [yaw, pitch]; }

  avanzar(dt) {
    const tt = (this.t += dt);
    const meta = this.habla;
    this.hab += (meta - this.hab) * (1 - Math.exp(-dt * (meta > this.hab ? 28 : 12)));
    const k = 1 - Math.exp(-dt * 5);
    let dom = 0;
    for (let i = 0; i < this.pesos.length; i++) { this.pesos[i] = Math.max(0.001, this.pesos[i] + ((i === this.objetivo ? 1 : 0) - this.pesos[i]) * k); if (this.pesos[i] > this.pesos[dom]) dom = i; }
    const mo = this.miraObj ?? [Math.sin(tt * 0.7) * 0.55, Math.cos(tt * 0.5) * 0.3];
    const km = 1 - Math.exp(-dt * 6);
    this.miraAct = [this.miraAct[0] + (mo[0] - this.miraAct[0]) * km, this.miraAct[1] + (mo[1] - this.miraAct[1]) * km];
    // brillo: el cursor encima o escuchando (0..1), se enciende suave
    this.luz += (this.brillo - this.luz) * (1 - Math.exp(-dt * 6));
    this.anillo += (this.escucha - this.anillo) * (1 - Math.exp(-dt * 7));
    this.micS += (this.mic - this.micS) * (1 - Math.exp(-dt * (this.mic > this.micS ? 25 : 8)));
    const kg = 1 - Math.exp(-dt * 4);
    this.giro = [this.giro[0] + (this.giroObj[0] - this.giro[0]) * kg, this.giro[1] + (this.giroObj[1] - this.giro[1]) * kg];
    let pp = 0;
    if (tt > this.prox + 0.18) this.prox = tt + 2.4 + (((Math.sin(tt * 12.9898) * 43758.5453) % 1) + 1) % 1 * 2.6;
    if (tt > this.prox) pp = Math.sin(((tt - this.prox) / 0.18) * Math.PI);
    if (dom !== this.ojoVer && this.cambio < 0) this.cambio = tt;
    if (this.cambio >= 0) {
      const q = (tt - this.cambio) / 0.2;
      if (q >= 0.5) this.ojoVer = dom;
      if (q >= 1) this.cambio = -1; else pp = Math.max(pp, Math.sin(q * Math.PI));
    }
    this.parp = Math.max(0, pp);
  }

  dibujar() {
    const { ctx, cctx, S, R, t, dpr } = this, C = S / 2, hab = Math.max(this.hab, this.luz * 0.45);
    const cy = C + Math.sin(t * 1.2) * S * 0.012 + Math.sin(t * 1.6) * R * 0.03;
    const [yaw, pitch] = this.giro;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // halo y la luz que emite al hablar
    ctx.fillStyle = gradiente(ctx, C, C, R * 2.6, ['rgba(70,200,232,0.42)', 'rgba(70,200,232,0.1)', 'rgba(70,200,232,0)'], [0, 0.55, 1]);
    ctx.beginPath(); ctx.arc(C, cy, R * 2.6, 0, Math.PI * 2); ctx.fill();
    if (hab > 0.01) {
      ctx.globalAlpha = hab * 0.75;
      ctx.fillStyle = gradiente(ctx, C, C, R * 2.4, ['rgba(196,246,253,0.9)', 'rgba(90,216,242,0.35)', 'rgba(70,200,232,0)'], [0, 0.45, 1]);
      ctx.beginPath(); ctx.arc(C, cy, R * (1.5 + hab * 0.9), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // escuchando: un anillo que late con tu voz y ondas que salen de NOVA
    if (this.anillo > 0.01) {
      const a = this.anillo, base = R * 1.42, r = base + this.micS * R * 0.32 + Math.sin(t * 3.2) * R * 0.025;
      ctx.save();
      ctx.strokeStyle = PAL.borde; ctx.lineWidth = 2.2; ctx.globalAlpha = a * (0.55 + this.micS * 0.45);
      ctx.shadowColor = PAL.borde; ctx.shadowBlur = 10 + this.micS * 14;
      ctx.beginPath(); ctx.arc(C, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      for (let k = 0; k < 2; k++) {
        const f = ((t * 0.7 + k * 0.5) % 1), rr = base + f * R * 0.75;
        ctx.globalAlpha = a * (1 - f) * 0.35; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(C, cy, rr, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    // polvo
    ctx.fillStyle = PAL.claro; ctx.globalAlpha = 0.45;
    const rp = Math.max(1, R * 0.018) / 2;
    for (const [r, v, f] of POLVO) {
      const a = t * v + f;
      ctx.beginPath(); ctx.arc(C + Math.cos(a) * r * R, cy + Math.sin(a) * r * R * 0.32 + Math.sin(t * 0.8 + f) * R * 0.05, rp, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    const orb = orbes(C, cy, R, t, 1 + hab * 0.08, yaw, pitch);
    // orbes de atrás: tenues y desenfocados
    ctx.filter = 'blur(3px)'; ctx.fillStyle = PAL.medio;
    for (const [x, y, prof, r] of orb) if (prof < -0.15) { ctx.globalAlpha = Math.min(1, 0.35 + 0.4 * ((prof + 1) / 0.85)); ctx.beginPath(); ctx.arc(x, y, r * 0.9, 0, Math.PI * 2); ctx.fill(); }
    ctx.filter = 'none'; ctx.globalAlpha = 1;

    // cuerpo + orbes de adelante en una capa, fundidos con el filtro #goo
    const cuerpo = cerrada(siluetaPts(C, cy, R, this.pesos, t, hab));
    const cg = [C + this.miraAct[0] * R * 0.06, cy + R * 0.08 + this.miraAct[1] * R * 0.05];
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.clearRect(0, 0, this.capa.width, this.capa.height);
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.fillStyle = gradiente(cctx, cg[0], cg[1], R * 1.9, GEL, POS_GEL);
    cctx.fill(cuerpo);
    for (const [x, y, prof, r] of orb) if (prof >= -0.15) { cctx.beginPath(); cctx.arc(x, y, r, 0, Math.PI * 2); cctx.fill(); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'url(#goo)';
    ctx.drawImage(this.capa, 0, 0);
    ctx.filter = 'none';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // borde interior luminoso
    ctx.save(); ctx.clip(cuerpo);
    ctx.filter = `blur(${R * 0.06}px)`; ctx.globalAlpha = 0.3; ctx.strokeStyle = PAL.claro; ctx.lineWidth = R * 0.16;
    ctx.stroke(cuerpo);
    ctx.restore();

    // reflejos fijos arriba
    ctx.save(); ctx.translate(C - R * 0.34, cy - R * 0.52); ctx.rotate(-0.49);
    ctx.filter = `blur(${R * 0.06}px)`; ctx.globalAlpha = 0.3; ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.ellipse(0, 0, R * 0.36, R * 0.15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.translate(C - R * 0.4, cy - R * 0.56); ctx.rotate(-0.52);
    ctx.globalAlpha = 0.8; ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.ellipse(0, 0, R * 0.14, R * 0.045, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // ojos: brillo + núcleo blanco
    const o = ojos(C, cy, R, this.ojoVer, [this.miraAct[0] * 1.6, this.miraAct[1] * 1.4], this.parp, yaw, pitch);
    const pintar = (color, alfa, blur) => {
      ctx.save(); ctx.globalAlpha = alfa; ctx.filter = blur ? `blur(${blur}px)` : 'none';
      if (o.trazo) { ctx.strokeStyle = color; ctx.lineWidth = o.ancho || 1; ctx.lineCap = 'round'; ctx.stroke(o.path); }
      else { ctx.fillStyle = color; ctx.fill(o.path); }
      ctx.restore();
    };
    pintar(PAL.ojo, 0.95, R * 0.07);
    pintar('white', 1, 0);
  }
}
