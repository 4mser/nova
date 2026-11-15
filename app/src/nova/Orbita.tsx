/* Anillo orbital alrededor de NOVA: escala fina de marcas, un barrido turquesa que gira lento (NOVA está atenta)
   y, si se le pasa un valor, el arco de preparación sobre su banda habitual. Hilos de 1 px, sin brillos. */
import { useLigero } from '../engine/rendimiento';
import { Canvas, Circle, Path, Skia, SweepGradient, vec } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { Easing, useDerivedValue, useFrameCallback, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { usePausa } from '../ui/activa';
import { C } from '../ui/tema';

type P = {
  /** false = quieta (además de cuando su pantalla no se ve) */
  activo?: boolean;
  size: number;
  /** 0..1: arco de preparación (270°, empieza abajo a la izquierda) */
  valor?: number;
  /** banda habitual en 0..1 */
  banda?: [number, number];
  /** densidad de marcas; 0 las oculta */
  marcas?: number;
  vel?: number;
  grosor?: number;
};

const INI = 135, BARRIDO = 270;

export function Orbita({ size, valor, banda, marcas = 72, vel = 0.35, grosor = 1, activo = true }: P) {
  const c = size / 2, rM = c - 2, rA = rM - size * 0.05, rB = rA - size * 0.035;
  const ang = useSharedValue(0), w = useSharedValue(vel), p = useSharedValue(0);
  useEffect(() => { w.value = withTiming(vel, { duration: 700 }); }, [vel, w]);
  // en modo liviano queda quieta (es decoración)
  const ligero = useLigero();
  usePausa(useFrameCallback(f => { 'worklet'; ang.value += Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000) * w.value; }, false), activo && !ligero);
  useEffect(() => { if (valor != null) p.value = withDelay(200, withTiming(valor, { duration: 1400, easing: Easing.out(Easing.cubic) })); }, [valor, p]);

  const escalaB = Skia.PathBuilder.Make();
  const conValor = valor != null;
  for (let i = 0; i < marcas; i++) {
    const deg = conValor ? INI + (i / (marcas - 1)) * BARRIDO : (i / marcas) * 360;
    const a = (deg * Math.PI) / 180, larga = i % 6 === 0, r0 = larga ? rM - size * 0.03 : rM - size * 0.016;
    escalaB.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    escalaB.lineTo(c + Math.cos(a) * rM, c + Math.sin(a) * rM);
  }
  const caja = (r: number) => ({ x: c - r, y: c - r, width: r * 2, height: r * 2 });
  const escala = escalaB.build();
  const pista = conValor ? Skia.PathBuilder.Make().addArc(caja(rA), INI, BARRIDO).build() : Skia.Path.Circle(c, c, rA);
  const bandaP = banda ? Skia.PathBuilder.Make().addArc(caja(rA), INI + banda[0] * BARRIDO, (banda[1] - banda[0]) * BARRIDO).build() : Skia.Path.Make();
  const fuera = banda && valor != null && (valor < banda[0] || valor > banda[1]);

  // el rectángulo se calcula aquí: dentro del worklet solo puede haber worklets o valores capturados
  const cajaA = caja(rA);
  const arco = useDerivedValue(() => {
    return Skia.PathBuilder.Make().addArc(cajaA, INI, Math.max(0.5, p.value * BARRIDO)).build();
  });
  const punta = useDerivedValue(() => {
    const a = ((INI + p.value * BARRIDO) * Math.PI) / 180;
    return vec(c + Math.cos(a) * rA, c + Math.sin(a) * rA);
  });
  const giro = useDerivedValue(() => [{ rotate: ang.value }]);
  // con valor, el barrido recorre solo la escala de 270° y deja libre el hueco del número
  const barrido = conValor ? Skia.PathBuilder.Make().addArc(caja(rB), INI, BARRIDO).build() : Skia.Path.Circle(c, c, rB);

  return (
    <Canvas style={{ position: 'absolute', width: size, height: size, pointerEvents: 'none' }}>
      {marcas > 0 && <Path path={escala} style="stroke" strokeWidth={1} color="rgba(150,185,215,0.22)" />}
      <Path path={pista} style="stroke" strokeWidth={grosor} color={C.l2} />
      {banda && <Path path={bandaP} style="stroke" strokeWidth={size * 0.022} color="rgba(143,230,245,0.18)" />}
      {conValor && <Path path={arco} style="stroke" strokeWidth={grosor * 2.2} strokeCap="round" color={fuera ? C.aviso : C.nova} />}
      {conValor && <Circle c={punta} r={grosor * 3} color={fuera ? C.aviso : C.nova} />}
      <Path path={barrido} style="stroke" strokeWidth={grosor}>
        <SweepGradient c={vec(c, c)} origin={vec(c, c)} transform={giro} colors={['rgba(70,200,232,0)', 'rgba(70,200,232,0)', 'rgba(143,230,245,0.9)']} positions={[0, 0.72, 1]} />
      </Path>
    </Canvas>
  );
}
