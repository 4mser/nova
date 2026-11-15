/* La firma visual de NOVA: cada medida contra su banda habitual (mediana ± 1,5 desviaciones robustas de los
   14 días anteriores), el mismo criterio que usa el motor. Dentro de la banda es turquesa; fuera, ámbar. */
import { Canvas, Circle, DashPathEffect, Path, Rect, Skia } from '@shopify/react-native-skia';
import { C } from './tema';

export function banda(hist: number[]) {
  const s = [...hist].sort((a, b) => a - b), med = s[Math.floor(s.length / 2)];
  const mad = hist.map(v => Math.abs(v - med)).sort((a, b) => a - b)[Math.floor(hist.length / 2)] || med * 0.03;
  const r = 1.5 * 1.4826 * mad;
  return { med, lo: med - r, hi: med + r };
}

/** serie completa: los primeros n−1 valores forman la banda, el último es hoy */
export function fuera(serie: number[]) {
  const b = banda(serie.slice(0, -1)), x = serie[serie.length - 1];
  return x < b.lo || x > b.hi;
}

export function Banda({ serie, w, h }: { serie: number[]; w: number; h: number }) {
  const b = banda(serie.slice(0, -1)), n = serie.length;
  const lo = Math.min(b.lo, ...serie), hi = Math.max(b.hi, ...serie), pad = 4;
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo || 1)) * (h - pad * 2);
  const x = (i: number) => pad + (i / (n - 1)) * (w - pad * 2);
  const lb = Skia.PathBuilder.Make();
  serie.forEach((v, i) => (i ? lb.lineTo(x(i), y(v)) : lb.moveTo(x(i), y(v))));
  const linea = lb.build();
  const med = Skia.PathBuilder.Make().moveTo(pad, y(b.med)).lineTo(w - pad, y(b.med)).build();
  const hoy = serie[n - 1], afuera = hoy < b.lo || hoy > b.hi;
  return (
    <Canvas style={{ width: w, height: h }}>
      <Rect x={pad} y={y(b.hi)} width={w - pad * 2} height={y(b.lo) - y(b.hi)} color={C.sigSuave} />
      <Path path={med} style="stroke" strokeWidth={1} color="rgba(143,230,245,0.3)"><DashPathEffect intervals={[2, 3]} /></Path>
      <Path path={linea} style="stroke" strokeWidth={1.4} strokeJoin="round" strokeCap="round" color={C.sig} />
      <Circle cx={x(n - 1)} cy={y(hoy)} r={3.2} color={afuera ? C.aviso : C.t1} />
    </Canvas>
  );
}
