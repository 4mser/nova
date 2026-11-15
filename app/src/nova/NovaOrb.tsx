/* NOVA en Skia: gel turquesa con orbes que lo orbitan y se funden con el cuerpo. Corre a 60 fps en el hilo de UI.
   Los cambios de expresión se mezclan suave (pesos que se acercan con el tiempo) y la forma de los ojos
   cambia escondida dentro de un parpadeo, igual que en la web. */
import { Blur, BlurMask, Canvas, Circle, ColorMatrix, Group, Oval, Paint, Path, Points, RadialGradient, Skia, vec } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { useDerivedValue, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { usePausa } from '../ui/activa';
import { useLigero } from '../engine/rendimiento';
import { cerrada, EXPRS, ojos, orbes, siluetaPts, type Expr } from './forma';

export const PAL = { centro: '#02121a', hondo: '#0a4458', medio: '#1d9cc0', borde: '#5ad8f2', ojo: '#a6f2fc', halo: '#46c8e8', claro: '#c4f6fd', alerta: '#e2589b' };

type Props = {
  /** false = quieta (además de cuando su pantalla no se ve) */
  activo?: boolean;
  size: number;
  expr?: Expr;
  /** mirada objetivo [-1..1, -1..1]; si falta, NOVA mira alrededor sola */
  mira?: [number, number];
  /** mirada viva desde un gesto (valor compartido); tiene prioridad sobre `mira` */
  miraViva?: SharedValue<number[] | null>;
  /** giro 3D [yaw, pitch] en radianes, desde un gesto */
  giro?: { readonly value: number[] };
  /** 0..1, amplitud de voz mientras habla */
  habla?: number;
  /** amplitud de voz en vivo (0..1) desde la reproducción; mueve el cuerpo y enciende la luz sin re-render */
  hablaViva?: { readonly value: number };
  orbes?: number;
  halo?: boolean;
  /** congela a NOVA en un instante exacto (segundos y parpadeo 0..1): para generar los cuadros del widget animado */
  instante?: { t: number; parpadeo?: number };
  /** radio del cuerpo como fracción del lienzo (por defecto 0.17 con halo, 0.27 sin él) */
  cuerpo?: number;
  /** un cuadro de un ciclo que cierra solo (para los widgets): u en [0,1). La forma mezcla el inicio y el final del
      tramo `periodo` (segundos de forma) con un peso suave, así u=1 empalma con u=0; encima respira (se estira al inhalar) */
  bucle?: { u: number; periodo: number; t0?: number; parpadeo?: number };
};

const POLVO = Array.from({ length: 56 }, (_, i) => {
  const h = (k: number) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
  return [1.25 + h(1) * 0.75, (0.15 + h(2) * 0.45) * (h(3) < 0.5 ? 1 : -1), h(4) * 6.283];
});

export function NovaOrb({ size, expr = 'normal', mira, miraViva, giro, hablaViva, habla = 0, orbes: nOrbes = 6, halo = true, activo = true, instante, cuerpo: fCuerpo, bucle }: Props) {
  const S = size, C = S / 2, R = S * (fCuerpo ?? (halo ? 0.17 : 0.27));
  // con `instante`, NOVA nace congelada en ese momento (mirada y parpadeo incluidos)
  const tFijo = instante?.t ?? (bucle ? (bucle.t0 ?? 0) + bucle.u * bucle.periodo : undefined);
  const bu = bucle ? bucle.u : -1, bP = bucle?.periodo ?? 0, bT = bucle?.t0 ?? 0, giroB = Math.PI * 2 * Math.max(0, bu);
  const t = useSharedValue(tFijo ?? 0);
  const pesos = useSharedValue<number[]>(EXPRS.map(e => (e === expr ? 1 : 0.001)));
  const objetivo = useSharedValue(EXPRS.indexOf(expr));
  const miraObj = useSharedValue<number[] | null>(mira ?? null);
  const miraAct = useSharedValue(bucle ? [Math.sin(giroB) * 0.18, Math.cos(giroB) * 0.08] : tFijo != null ? [Math.sin(tFijo * 0.7) * 0.55, Math.cos(tFijo * 0.5) * 0.3] : [0, 0]);
  const hab = useSharedValue(habla), habProp = useSharedValue(habla);
  const ojoVer = useSharedValue(EXPRS.indexOf(expr));
  const parp = useSharedValue(instante?.parpadeo ?? bucle?.parpadeo ?? 0);
  const prox = useSharedValue(2.5); // próximo parpadeo
  const cambio = useSharedValue(-1);

  useEffect(() => { objetivo.value = EXPRS.indexOf(expr); }, [expr, objetivo]);
  useEffect(() => { miraObj.value = mira ?? null; }, [mira, miraObj]);
  useEffect(() => { habProp.value = habla; }, [habla, habProp]);

  // modo liviano: 30 cuadros por segundo (cada cuadro saltado no recalcula la forma ni redibuja)
  const ligero = useLigero(), lig = useSharedValue(ligero), acum = useSharedValue(0);
  useEffect(() => { lig.set(ligero); }, [ligero, lig]);
  const reloj = useFrameCallback(f => {
    'worklet';
    let dt = Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000);
    if (lig.value) { acum.value += dt; if (acum.value < 1 / 31) return; dt = Math.min(0.08, acum.value); acum.value = 0; }
    const tt = t.value + dt;
    t.value = tt;
    // voz: sube rápido y baja más lento, como en los videos
    const meta = hablaViva ? Math.max(habProp.value, hablaViva.value) : habProp.value;
    hab.value += (meta - hab.value) * (1 - Math.exp(-dt * (meta > hab.value ? 28 : 12)));
    // pesos de expresión: se acercan al objetivo (sin saltos)
    const k = 1 - Math.exp(-dt * 5);
    const np = pesos.value.slice();
    let dom = 0;
    for (let i = 0; i < np.length; i++) { np[i] = Math.max(0.001, np[i] + ((i === objetivo.value ? 1 : 0) - np[i]) * k); if (np[i] > np[dom]) dom = i; }
    pesos.value = np;
    // mirada: objetivo dado, o mira alrededor sola
    const mo = miraViva?.value ?? miraObj.value ?? [Math.sin(tt * 0.7) * 0.55, Math.cos(tt * 0.5) * 0.3];
    const km = 1 - Math.exp(-dt * 6);
    miraAct.value = [miraAct.value[0] + (mo[0] - miraAct.value[0]) * km, miraAct.value[1] + (mo[1] - miraAct.value[1]) * km];
    // parpadeo periódico; si cambia la expresión dominante, la forma de los ojos cambia dentro de un parpadeo
    let pp = 0;
    if (tt > prox.value + 0.18) prox.value = tt + 2.4 + ((Math.sin(tt * 12.9898) * 43758.5453) % 1 + 1) % 1 * 2.6;
    if (tt > prox.value) pp = Math.sin(((tt - prox.value) / 0.18) * Math.PI);
    if (dom !== ojoVer.value && cambio.value < 0) cambio.value = tt;
    if (cambio.value >= 0) {
      const q = (tt - cambio.value) / 0.2;
      if (q >= 0.5) ojoVer.value = dom;
      if (q >= 1) cambio.value = -1; else pp = Math.max(pp, Math.sin(q * Math.PI));
    }
    parp.value = Math.max(0, pp);
  }, false);
  usePausa(reloj, activo && tFijo == null);

  const cy = useDerivedValue(() => (bu >= 0 ? C - Math.sin(giroB) * S * 0.008 : C + Math.sin(t.value * 1.2) * S * 0.012 + Math.sin(t.value * 1.6) * R * 0.03));
  const cuerpo = useDerivedValue(() => {
    if (bu < 0) return cerrada(siluetaPts(C, cy.value, R, pesos.value, t.value, hab.value));
    // bucle: mezcla con peso suave (smoothstep) entre el tramo actual y el anterior → empalma en forma y velocidad
    const w = bu * bu * (3 - 2 * bu), resp = Math.sin(giroB);
    const A = siluetaPts(C, cy.value, R, pesos.value, bT + bu * bP, 0), B = siluetaPts(C, cy.value, R, pesos.value, bT + (bu - 1) * bP, 0);
    const P: number[] = [];
    for (let i = 0; i < A.length; i += 2) {
      const x = A[i] * (1 - w) + B[i] * w, y = A[i + 1] * (1 - w) + B[i + 1] * w;
      P.push(C + (x - C) * (1 + 0.025 * resp), cy.value + (y - cy.value) * (1 + 0.045 * resp));
    }
    return cerrada(P);
  });
  const orb = useDerivedValue(() => orbes(C, cy.value, R, t.value, 1 + hab.value * 0.08, giro?.value[0] ?? 0, giro?.value[1] ?? 0));
  const vis = (k: number) => Math.min(1, Math.max(0, nOrbes - k));
  const centroG = useDerivedValue(() => vec(C + miraAct.value[0] * R * 0.06, cy.value + R * 0.08 + miraAct.value[1] * R * 0.05));
  const polvo = useDerivedValue(() => POLVO.map(([r, v, f]) => { const a = t.value * v + f; return vec(C + Math.cos(a) * r * R, cy.value + Math.sin(a) * r * R * 0.32 + Math.sin(t.value * 0.8 + f) * R * 0.05); }));
  const ojosD = useDerivedValue(() => ojos(C, cy.value, R, ojoVer.value, [miraAct.value[0] * 1.6, miraAct.value[1] * 1.4], parp.value, giro?.value[0] ?? 0, giro?.value[1] ?? 0));
  const ojoFill = useDerivedValue(() => (ojosD.value.trazo ? Skia.Path.Make() : ojosD.value.path));
  const ojoTrazo = useDerivedValue(() => (ojosD.value.trazo ? ojosD.value.path : Skia.Path.Make()));
  const anchoTrazo = useDerivedValue(() => ojosD.value.ancho || 1);
  const reflejo = useDerivedValue(() => [{ translateX: C - R * 0.34 }, { translateY: cy.value - R * 0.52 }, { rotate: -0.49 }]);
  const brillo = useDerivedValue(() => [{ translateX: C - R * 0.4 }, { translateY: cy.value - R * 0.56 }, { rotate: -0.52 }]);
  const haloOp = useDerivedValue(() => 1 + hab.value * 0.6);
  // al hablar, NOVA emite luz: un resplandor que late con cada sílaba
  const luzR = useDerivedValue(() => R * (1.5 + hab.value * 0.9));
  const luzOp = useDerivedValue(() => hab.value * 0.75);

  const gel = [PAL.centro, PAL.hondo, PAL.medio, PAL.borde, PAL.claro];
  const posGel = [0, 0.25, 0.43, 0.56, 1];
  const orbeIdx = ligero ? [0, 1, 2] : [0, 1, 2, 3, 4, 5];

  return (
    <Canvas style={{ width: S, height: S }}>
      {halo && (
        <Circle cx={C} cy={cy} r={R * 2.6} opacity={haloOp}>
          <RadialGradient c={vec(C, C)} r={R * 2.6} colors={['rgba(70,200,232,0.42)', 'rgba(70,200,232,0.1)', 'rgba(70,200,232,0)']} positions={[0, 0.55, 1]} />
        </Circle>
      )}
      {halo && (
        <Circle cx={C} cy={cy} r={luzR} opacity={luzOp}>
          <RadialGradient c={vec(C, C)} r={R * 2.4} colors={['rgba(196,246,253,0.9)', 'rgba(90,216,242,0.35)', 'rgba(70,200,232,0)']} positions={[0, 0.45, 1]} />
        </Circle>
      )}
      {nOrbes > 0 && <Points points={polvo} mode="points" color={PAL.claro} strokeWidth={Math.max(1, R * 0.018)} strokeCap="round" opacity={0.45 * Math.min(1, nOrbes / 2)} />}
      {/* orbes de atrás: más tenues y desenfocados */}
      {orbeIdx.map(k => (
        <OrbeAtras key={`a${k}`} orb={orb} k={k} vis={vis(k)} ligero={ligero} />
      ))}
      {/* cuerpo + orbes delanteros fundidos en un solo material (metaball por umbral de alfa) */}
      <Group layer={<Paint><Blur blur={R * 0.075} /><ColorMatrix matrix={[1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 22, -9]} /></Paint>}>
        <Path path={cuerpo}>
          <RadialGradient c={centroG} r={R * 1.9} colors={gel} positions={posGel} />
        </Path>
        {orbeIdx.map(k => (
          <OrbeDelante key={`d${k}`} orb={orb} k={k} vis={vis(k)} centro={centroG} R={R} gel={gel} pos={posGel} />
        ))}
      </Group>
      {/* borde interior luminoso */}
      <Group clip={cuerpo}>
        <Path path={cuerpo} style="stroke" strokeWidth={R * 0.16} color={PAL.claro} opacity={0.3}>
          {!ligero && <BlurMask blur={R * 0.06} style="normal" />}
        </Path>
      </Group>
      {/* reflejos fijos arriba */}
      <Group transform={reflejo}>
        <Oval x={-R * 0.36} y={-R * 0.15} width={R * 0.72} height={R * 0.3} color="white" opacity={0.3}>
          {!ligero && <BlurMask blur={R * 0.06} style="normal" />}
        </Oval>
      </Group>
      <Group transform={brillo}>
        <Oval x={-R * 0.14} y={-R * 0.045} width={R * 0.28} height={R * 0.09} color="white" opacity={0.8} />
      </Group>
      {/* ojos: brillo + núcleo blanco */}
      {!ligero && <Path path={ojoFill} color={PAL.ojo} opacity={0.95}><BlurMask blur={R * 0.07} style="normal" /></Path>}
      {!ligero && <Path path={ojoTrazo} style="stroke" strokeWidth={anchoTrazo} strokeCap="round" color={PAL.ojo} opacity={0.95}><BlurMask blur={R * 0.07} style="normal" /></Path>}
      <Path path={ojoFill} color="white" />
      <Path path={ojoTrazo} style="stroke" strokeWidth={anchoTrazo} strokeCap="round" color="white" />
    </Canvas>
  );
}

type OrbP = { orb: { value: number[] }; k: number; vis: number };
function OrbeAtras({ orb, k, vis, ligero }: OrbP & { ligero?: boolean }) {
  const cx = useDerivedValue(() => orb.value[k * 4]);
  const cy = useDerivedValue(() => orb.value[k * 4 + 1]);
  const r = useDerivedValue(() => (orb.value[k * 4 + 2] < -0.15 ? orb.value[k * 4 + 3] * 0.9 * vis : 0));
  const op = useDerivedValue(() => (0.35 + 0.4 * ((orb.value[k * 4 + 2] + 1) / 0.85)) * vis);
  return (
    <Circle cx={cx} cy={cy} r={r} color={PAL.medio} opacity={op}>
      {!ligero && <BlurMask blur={3} style="normal" />}
    </Circle>
  );
}
function OrbeDelante({ orb, k, vis, centro, R, gel, pos }: OrbP & { centro: { value: { x: number; y: number } }; R: number; gel: string[]; pos: number[] }) {
  const cx = useDerivedValue(() => orb.value[k * 4]);
  const cy = useDerivedValue(() => orb.value[k * 4 + 1]);
  const r = useDerivedValue(() => (orb.value[k * 4 + 2] >= -0.15 ? orb.value[k * 4 + 3] * vis : 0));
  return (
    <Circle cx={cx} cy={cy} r={r}>
      <RadialGradient c={centro} r={R * 1.9} colors={gel} positions={pos} />
    </Circle>
  );
}
