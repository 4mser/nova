/* Mide los cuadros por segundo reales del hilo de UI unos segundos después de abrir (sin la carga inicial), para el
   modo de rendimiento automático. En modo liviano también apaga las animaciones de entrada y de reordenamiento. */
import { useEffect } from 'react';
import { ReducedMotionConfig, ReduceMotion, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { leerRendimiento, medido, useLigero } from '../engine/rendimiento';

export function MedidorFps() {
  const cuadros = useSharedValue(0), tiempo = useSharedValue(0), ligero = useLigero();
  const fc = useFrameCallback(f => {
    'worklet';
    const dt = (f.timeSincePreviousFrame ?? 16) / 1000;
    // un salto enorme (app en segundo plano) no cuenta como cuadro lento
    if (dt > 0.5) return;
    cuadros.value += 1; tiempo.value += dt;
  }, false);
  useEffect(() => {
    if (leerRendimiento().modo !== 'auto') return;
    const ini = setTimeout(() => { cuadros.set(0); tiempo.set(0); fc.setActive(true); }, 2500);
    const fin = setTimeout(() => {
      fc.setActive(false);
      const s = tiempo.get();
      if (s > 2) medido(cuadros.get() / s);
    }, 8500);
    return () => { clearTimeout(ini); clearTimeout(fin); fc.setActive(false); };
  }, [fc, cuadros, tiempo]);
  return ligero ? <ReducedMotionConfig mode={ReduceMotion.Always} /> : null;
}
