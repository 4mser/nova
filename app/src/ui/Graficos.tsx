/* Gráficos de los mockups del video (ui.js de bn-video/spaceapps): traza viva, barritas, serie, anillos,
   constelación y flujo de privacidad. Todo en Skia; lo animado vive en worklets que no llaman funciones de afuera. */
import { Ionicons } from '@expo/vector-icons';
import { Canvas, Circle, DashPathEffect, Group, LinearGradient, Path, Points, Skia, vec } from '@shopify/react-native-skia';
import { View } from 'react-native';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { usePausa } from './activa';
import { C, Txt } from './tema';
import { useIdioma } from '../i18n';

const h1 = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function useReloj() {
  const t = useSharedValue(0);
  usePausa(useFrameCallback(f => { 'worklet'; t.value += Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000); }, false));
  return t;
}

/** latido que corre hacia la izquierda, con el trazo desvaneciéndose atrás y un punto en la punta */
export function TrazaViva({ w, h, bpm = 64, latidos = 2, col = C.sig, grosor = 1.8 }: { w: number; h: number; bpm?: number; latidos?: number; col?: string; grosor?: number }) {
  const t = useReloj();
  const forma = (fase: number) => {
    'worklet';
    const p = fase - Math.floor(fase);
    const g = (c: number, s: number, a: number) => a * Math.exp(-((p - c) ** 2) / (2 * s * s));
    return g(0.18, 0.025, 0.1) - g(0.37, 0.008, 0.15) + g(0.4, 0.012, 1) - g(0.43, 0.01, 0.25) + g(0.68, 0.045, 0.22);
  };
  const curva = useDerivedValue(() => {
    const q = Skia.PathBuilder.Make();
    for (let i = 0; i <= 160; i++) {
      const u = i / 160, y = h * 0.78 - h * 0.62 * forma(u * latidos - (t.value * bpm) / 60);
      if (i) q.lineTo(u * w, y); else q.moveTo(u * w, y);
    }
    return q.build();
  });
  const punta = useDerivedValue(() => vec(w, h * 0.78 - h * 0.62 * forma(latidos - (t.value * bpm) / 60)));
  return (
    <Canvas style={{ width: w, height: h }}>
      <Path path={curva} style="stroke" strokeWidth={grosor} strokeJoin="round" strokeCap="round">
        <LinearGradient start={vec(0, 0)} end={vec(w, 0)} colors={[col + '00', col + 'b3', col]} positions={[0, 0.3, 1]} />
      </Path>
      <Circle c={punta} r={3.2} color={col} />
    </Canvas>
  );
}

/** barritas redondeadas; la resaltada va en color, las demás en gris */
export function Barritas({ w, h, vals, col = C.sig, resalta }: { w: number; h: number; vals: number[]; col?: string; resalta?: number }) {
  const n = vals.length, bw = Math.min(12, Math.max(3, (w / n) * 0.5)), r = resalta ?? n - 1;
  return (
    <View style={{ width: w, height: h, flexDirection: 'row', alignItems: 'flex-end' }}>
      {vals.map((v, i) => (
        <View key={i} style={{ width: w / n, alignItems: 'center' }}>
          <View style={{ width: bw, height: Math.max(3, v * h), borderRadius: bw / 2, backgroundColor: i === r ? col : 'rgba(255,255,255,0.14)' }} />
        </View>
      ))}
    </View>
  );
}

/** serie suave con área tenue debajo y punto final */
export function Serie({ w, h, vals, col = C.sig, area = true }: { w: number; h: number; vals: number[]; col?: string; area?: boolean }) {
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, h - 3 - ((v - mn) / (mx - mn || 1)) * (h - 8)] as const);
  const lb = Skia.PathBuilder.Make();
  pts.forEach(([x, y], i) => {
    if (!i) { lb.moveTo(x, y); return; }
    const [px, py] = pts[i - 1], cx = (px + x) / 2;
    lb.cubicTo(cx, py, cx, y, x, y);
  });
  const linea = lb.build();
  const relleno = Skia.PathBuilder.MakeFromPath(linea).lineTo(w, h).lineTo(0, h).close().build();
  const [ux, uy] = pts[pts.length - 1];
  return (
    <Canvas style={{ width: w, height: h }}>
      {area && <Path path={relleno}><LinearGradient start={vec(0, 0)} end={vec(0, h)} colors={[col + '24', col + '00']} /></Path>}
      <Path path={linea} style="stroke" strokeWidth={1.8} strokeCap="round" color={col} />
      <Circle cx={ux} cy={uy} r={3.2} color={col} />
    </Canvas>
  );
}

/** anillos de progreso concéntricos, desde arriba en sentido horario */
export function Anillos({ size, anillos }: { size: number; anillos: { v: number; col: string; r: number; w: number }[] }) {
  const c = size / 2, k = size / 120;
  return (
    <Canvas style={{ width: size, height: size }}>
      {anillos.map(({ v, col, r, w }, i) => {
        const rr = r * k, caja = { x: c - rr, y: c - rr, width: rr * 2, height: rr * 2 };
        const fondo = Skia.Path.Circle(c, c, rr);
        const arco = Skia.PathBuilder.Make().addArc(caja, -90, 360 * Math.min(0.999, v)).build();
        return (
          <Group key={i}>
            <Path path={fondo} style="stroke" strokeWidth={w * k} color="rgba(255,255,255,0.07)" />
            <Path path={arco} style="stroke" strokeWidth={w * k} strokeCap="round" color={col} />
          </Group>
        );
      })}
    </Canvas>
  );
}

/** anillo de cuenta regresiva con número al centro */
export function Cuenta({ size, v, n, u, col = C.lila }: { size: number; v: number; n: string; u: string; col?: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute' }}><Anillos size={size} anillos={[{ v, col, r: 52, w: 9 }]} /></View>
      <Txt f="l" size={size * 0.28} lh={size * 0.3}>{n}</Txt>
      <Txt size={11} color={C.t2}>{u}</Txt>
    </View>
  );
}

const RAMPA = ['#46c8e8', '#8fb8ff', '#a898ff', '#d27fd0', '#ec6aa8'];

/** constelación de la semana: altura = ánimo, tamaño = sueño, color = estrés; estrellas que titilan y un punto que recorre los días */
export function Constelacion({ w, h, dias }: { w: number; h: number; dias: { dia: string; animo: number; sueno: number; estres: number }[] }) {
  const t = useReloj(), { t: tx } = useIdioma(); // el texto se resuelve aquí, fuera de los worklets
  const P = dias.map((d, i) => {
    const e = Math.max(0, Math.min(4, Math.round((d.estres - 0.3) / 0.1)));
    return { x: 24 + (i * (w - 48)) / (dias.length - 1), y: h - 34 - ((d.animo - 2.5) / 2.5) * (h - 70), r: Math.max(3, 4 + (d.sueno - 6) * 2.6), col: RAMPA[e] };
  });
  const lb = Skia.PathBuilder.Make();
  P.forEach((p, i) => {
    if (!i) { lb.moveTo(p.x, p.y); return; }
    const a = P[i - 1], cx = (a.x + p.x) / 2;
    lb.cubicTo(cx, a.y, cx, p.y, p.x, p.y);
  });
  const linea = lb.build();
  const capas = [0, 1, 2].map(k => Array.from({ length: 14 }, (_, i) => vec(h1(i * 3 + k) * w, h1(i * 3 + k + 50) * (h - 30))));
  const o0 = useDerivedValue(() => 0.2 + 0.25 * Math.sin(t.value * 1.5) ** 2);
  const o1 = useDerivedValue(() => 0.2 + 0.25 * Math.sin(t.value * 1.5 + 2) ** 2);
  const o2 = useDerivedValue(() => 0.2 + 0.25 * Math.sin(t.value * 1.5 + 4) ** 2);
  const xs = P.map(p => p.x), ys = P.map(p => p.y), n = P.length - 1;
  const viajero = useDerivedValue(() => {
    const u = (t.value * 0.18) % 1, j = Math.min(n - 1, Math.floor(u * n)), f = u * n - j;
    return vec(xs[j] + (xs[j + 1] - xs[j]) * f, ys[j] + (ys[j + 1] - ys[j]) * f);
  });
  return (
    <View style={{ width: w, height: h }}>
      <Canvas style={{ position: 'absolute', width: w, height: h }}>
        <Points points={capas[0]} mode="points" color="#dfe8f2" strokeWidth={1.4} strokeCap="round" opacity={o0} />
        <Points points={capas[1]} mode="points" color="#dfe8f2" strokeWidth={1.1} strokeCap="round" opacity={o1} />
        <Points points={capas[2]} mode="points" color="#dfe8f2" strokeWidth={1.7} strokeCap="round" opacity={o2} />
        <Path path={linea} style="stroke" strokeWidth={1.6} color="rgba(143,230,245,0.5)" />
        {P.map((p, i) => (
          <Group key={i}>
            <Circle cx={p.x} cy={p.y} r={p.r * 2.4} color={p.col} opacity={0.16} />
            <Circle cx={p.x} cy={p.y} r={p.r} color={p.col} />
          </Group>
        ))}
        <Circle c={viajero} r={3} color="#fff" />
      </Canvas>
      {P.map((p, i) => <Txt key={i} size={11.5} color={C.t3} style={{ position: 'absolute', top: h - 18, left: p.x - 10, width: 20, textAlign: 'center' }}>{tx(dias[i].dia)[0]}</Txt>)}
    </View>
  );
}

/** a quién va cada dato: de ti hacia el médico de vuelo o la psicóloga. Lo que apagas baja, punteado, a un nodo
    con candado («only you»), que solo aparece si algo queda privado. */
export type Comparte = { vitales: boolean; sueno: boolean; animo: boolean; diario: boolean };

export function Flujo({ w, h, activos }: { w: number; h: number; activos: Comparte }) {
  const t = useReloj(), { t: tx } = useIdioma(); // el texto se resuelve aquí, fuera de los worklets
  const k = w / 330, R = 22;
  const yo = [46 * k, h * 0.4], fs = [w - 50 * k, h * 0.18], er = [w - 50 * k, h * 0.62], candado = [w * 0.38, h * 0.88];
  const datos = [
    { col: C.sig, a: fs, on: activos.vitales },
    { col: C.lila, a: fs, on: activos.sueno },
    { col: C.alerta, a: er, on: activos.animo },
    { col: '#c5cfdb', a: er, on: activos.diario },
  ];
  const privados = datos.filter(d => !d.on).length;
  let j = 0;
  const cables = datos.map((d, i) => {
    if (d.on) {
      // sale por la derecha de «You» y llega horizontal al nodo de destino
      const x0 = yo[0] + R - 2, y0 = yo[1] + (i - 1.5) * 8, x1 = d.a[0] - 19, y1 = d.a[1];
      const bz = [x0, y0, w * 0.45, y0, w * 0.55, y1, x1, y1];
      return { ...d, bz, p: Skia.PathBuilder.Make().moveTo(x0, y0).cubicTo(bz[2], bz[3], bz[4], bz[5], x1, y1).build() };
    }
    // baja desde «You» y gira suave hacia el candado, lejos de la psicóloga
    const o = (j++ - (privados - 1) / 2) * 7;
    const x0 = yo[0] + o, y0 = yo[1] + R - 2, x1 = candado[0] - 16, y1 = candado[1] + o * 0.5;
    const bz = [x0, y0, x0, y1, x0 + (x1 - x0) * 0.3, y1, x1, y1];
    return { ...d, bz, p: Skia.PathBuilder.Make().moveTo(x0, y0).cubicTo(bz[2], bz[3], bz[4], bz[5], x1, y1).build() };
  });
  const bez = cables.map(c => c.bz), ons = cables.map(c => c.on);
  const particulas = useDerivedValue(() => {
    const out = [];
    for (let i = 0; i < bez.length; i++) {
      if (!ons[i]) continue;
      const [ax, ay, bx, by, cx, cy, dx, dy] = bez[i];
      for (let n = 0; n < 3; n++) {
        const u = (t.value * 0.35 + n / 3 + i * 0.17) % 1, v = 1 - u;
        out.push(vec(v * v * v * ax + 3 * v * v * u * bx + 3 * v * u * u * cx + u * u * u * dx, v * v * v * ay + 3 * v * v * u * by + 3 * v * u * u * cy + u * u * u * dy));
      }
    }
    return out;
  });
  return (
    <View style={{ width: w, height: h }}>
      <Canvas style={{ position: 'absolute', width: w, height: h }}>
        {cables.map((c, i) => (c.on
          ? <Path key={i} path={c.p} style="stroke" strokeWidth={2} color={c.col} opacity={0.8} />
          : <Path key={i} path={c.p} style="stroke" strokeWidth={1.4} color={C.t3} opacity={0.7}><DashPathEffect intervals={[3, 5]} /></Path>
        ))}
        <Points points={particulas} mode="points" color="#fff" strokeWidth={4} strokeCap="round" />
        <Circle cx={yo[0]} cy={yo[1]} r={R} color={C.nova} />
        {[fs, er].map((n, i) => (
          <Group key={i}>
            <Circle cx={n[0]} cy={n[1]} r={18} color={C.s2} />
            <Circle cx={n[0]} cy={n[1]} r={18} color="rgba(255,255,255,0.2)" style="stroke" strokeWidth={1} />
          </Group>
        ))}
        {privados > 0 && (
          <Group>
            <Circle cx={candado[0]} cy={candado[1]} r={14} color={C.s2} />
            <Circle cx={candado[0]} cy={candado[1]} r={14} color="rgba(255,255,255,0.16)" style="stroke" strokeWidth={1} />
          </Group>
        )}
      </Canvas>
      <Txt f="s" size={14} color={C.bg} style={{ position: 'absolute', left: yo[0] - R, top: yo[1] - 10, width: R * 2, textAlign: 'center' }}>{tx('You')}</Txt>
      {([[fs, 'FS', 'Flight surgeon'], [er, 'ER', 'Psychologist']] as const).map(([n, ini, nom]) => (
        <View key={ini} style={{ position: 'absolute', left: n[0] - 50, top: n[1] - 9, width: 100, alignItems: 'center' }}>
          <Txt f="s" size={12} color="#c5cfdb">{tx(ini)}</Txt>
          <Txt size={12} color={C.t2} style={{ marginTop: 16 }}>{tx(nom)}</Txt>
        </View>
      ))}
      {privados > 0 && (
        <>
          <View style={{ position: 'absolute', left: candado[0] - 7, top: candado[1] - 7 }}>
            <Ionicons name="lock-closed" size={13} color={C.t2} />
          </View>
          <Txt size={12} color={C.t2} style={{ position: 'absolute', left: candado[0] + 22, top: candado[1] - 8 }}>{tx('Only you')}</Txt>
        </>
      )}
    </View>
  );
}
