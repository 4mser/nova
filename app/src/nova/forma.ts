/* NOVA · geometría de la mascota (port del motor de los videos y la web).
   Todo son worklets: se calcula en el hilo de UI cada cuadro, sin pasar por React. */
import { Skia, type SkPath } from '@shopify/react-native-skia';

export type Expr = 'normal' | 'feliz' | 'pensativa' | 'sorprendida' | 'dormida' | 'triste';
export const EXPRS: Expr[] = ['normal', 'feliz', 'pensativa', 'sorprendida', 'dormida', 'triste'];

/* siluetas: base + lóbulos [ángulo°, largo, ancho] — mezclar formas = sumar lóbulos ponderados (sin saltos) */
const FORMAS: Record<Expr, { base: number; lob: number[][] }> = {
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

/** contorno del cuerpo: puntos de una curva cerrada (pesos = mezcla de expresiones, habla = 0..1) */
export function siluetaPts(cx: number, cy: number, R: number, pesos: number[], t: number, habla: number): number[] {
  'worklet';
  let W = 0;
  for (let k = 0; k < pesos.length; k++) W += pesos[k];
  let base = 0;
  const L: number[] = []; // [a, l, s] planos
  for (let k = 0; k < EXPRS.length; k++) {
    const w = pesos[k];
    if (w <= 0.0005) continue;
    const F = FORMAS[EXPRS[k]];
    base += F.base * w;
    for (let i = 0; i < 5; i++) {
      const lb = F.lob[i];
      // forma viva: ángulos, largos y anchos derivan lento
      const a = (lb[0] * Math.PI) / 180 + Math.sin(t * 0.6 + i * 1.9) * 0.08 + 0.2 * Math.sin(t * 0.43 + i * 2.3) + 0.08 * Math.sin(t * 1.1 + i);
      const l = ((lb[1] * w) / W) * (1 + 0.08 * Math.sin(t * 0.9 + i * 1.7)) * (1 + 0.16 * Math.sin(t * 0.71 + i * 1.7));
      L.push(a, l, lb[2] * (1 + 0.12 * Math.sin(t * 0.5 + i)));
    }
  }
  base = (base / W) * (1 + 0.025 * Math.sin(t * 1.3) + habla * 0.015);
  // dos bultos que viajan por el borde
  L.push(t * 0.37 + 1, 0.1 * (0.6 + 0.4 * Math.sin(t * 0.9)), 0.32, -t * 0.29 + 3.5, 0.08 * (0.6 + 0.4 * Math.sin(t * 0.7 + 2)), 0.3);
  if (habla > 0.01) {
    for (let j = 0; j < 3; j++) L.push(t * (0.9 + j * 0.35) + j * 2.1, habla * 0.05, 0.22);
    L.push(Math.PI / 2 + 0.15 * Math.sin(t * 0.8), habla * 0.1, 0.42);
  }
  const P: number[] = [];
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
export function cerrada(P: number[]): SkPath {
  'worklet';
  const p = Skia.PathBuilder.Make();
  const n = P.length / 2;
  p.moveTo(P[0], P[1]);
  for (let i = 0; i < n; i++) {
    const i0 = ((i - 1 + n) % n) * 2, i1 = i * 2, i2 = ((i + 1) % n) * 2, i3 = ((i + 2) % n) * 2;
    p.cubicTo(
      P[i1] + (P[i2] - P[i0]) / 6, P[i1 + 1] + (P[i2 + 1] - P[i0 + 1]) / 6,
      P[i2] - (P[i3] - P[i1]) / 6, P[i2 + 1] - (P[i3 + 1] - P[i1 + 1]) / 6,
      P[i2], P[i2 + 1],
    );
  }
  p.close();
  return p.build();
}

/** orbes: [x, y, profundidad −1..1, radio] × 6 */
export function orbes(cx: number, cy: number, R: number, t: number, apertura: number, yaw = 0, pitch = 0): number[] {
  'worklet';
  const out: number[] = [];
  for (let k = 0; k < 6; k++) {
    const [r, inc, giro, v, f, s] = ORBITAS[k];
    const a = t * v + f, rr = r * R * apertura;
    let px = Math.cos(a) * rr, py = 0, pz = Math.sin(a) * rr;
    const ci = Math.cos(inc), si = Math.sin(inc);
    const py2 = py * ci - pz * si, pz2 = py * si + pz * ci;
    py = py2; pz = pz2;
    const cg = Math.cos(giro), sg = Math.sin(giro);
    let px2 = px * cg - py * sg, py3 = px * sg + py * cg;
    // giro 3D del cuerpo completo: yaw alrededor del eje vertical, pitch alrededor del horizontal
    const cy_ = Math.cos(yaw), sy_ = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x3 = px2 * cy_ + pz * sy_, z3 = -px2 * sy_ + pz * cy_;
    const y4 = py3 * cp - z3 * sp, z4 = py3 * sp + z3 * cp;
    px2 = x3; py3 = y4; pz = z4;
    const prof = pz / (r * R);
    out.push(cx + px2, cy + py3 * 0.9, prof, s * R * (1 + 0.22 * prof));
  }
  return out;
}

/** ojos según la expresión dominante: path relleno (píldoras) o trazo (arcos).
    Con yaw/pitch los ojos se proyectan sobre la esfera: se corren al costado, se angostan y desaparecen por detrás. */
export function ojos(cx: number, cy: number, R: number, expr: number, mira: number[], parpadeo: number, yaw = 0, pitch = 0): { path: SkPath; trazo: boolean; ancho: number } {
  'worklet';
  const cpz = Math.cos(pitch);
  const ex = cx + mira[0] * R * 0.1, ey = cy - R * 0.08 - Math.sin(pitch) * R * 0.42 + mira[1] * R * 0.07, w0 = R * 0.105, hgt = R * 0.3 * (1 - parpadeo * 0.9) * Math.max(0.15, cpz);
  // cada ojo vive en un ángulo de la esfera: ±0,36 rad del frente
  const pos = [-1, 1].map(s => { const a = yaw + s * 0.36; return { s, c: Math.cos(a), x: ex + Math.sin(a) * R * 0.47 }; }).filter(o => o.c > 0.08 && cpz > 0.1);
  const w = w0;
  const p = Skia.PathBuilder.Make();
  const e = EXPRS[expr];
  if (e === 'feliz' || e === 'dormida') {
    for (const o of pos) {
      const x = o.x, ww = w * o.c;
      if (e === 'feliz') { p.moveTo(x - ww * 1.1, ey + R * 0.03); p.quadTo(x, ey - R * 0.12 * cpz, x + ww * 1.1, ey + R * 0.03); }
      else { p.moveTo(x - ww, ey); p.quadTo(x, ey + R * 0.07 * cpz, x + ww, ey); }
    }
    return { path: p.build(), trazo: true, ancho: e === 'feliz' ? w * 0.8 : w * 0.6 };
  }
  const k = e === 'sorprendida' ? 1.15 : 1;
  for (const o of pos) {
    const alto = e === 'pensativa' && o.s < 0 ? hgt * 0.85 : hgt * k;
    const ww = w * o.c;
    p.addRRect(Skia.RRectXY(Skia.XYWHRect(o.x - ww / 2, ey - alto / 2, ww, alto), ww / 2, Math.min(ww, alto) / 2));
  }
  return { path: p.build(), trazo: false, ancho: 0 };
}
