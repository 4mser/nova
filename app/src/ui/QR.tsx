/* Código QR dibujado con SVG (qrcode-generator, sin nada nativo): módulos redondeados en blanco sobre la tarjeta. */
import crearQR from 'qrcode-generator';
import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

export function QR({ texto, tam = 220, color = '#041218', fondo = '#ffffff' }: { texto: string; tam?: number; color?: string; fondo?: string }) {
  const d = useMemo(() => {
    const q = crearQR(0, 'M'); q.addData(texto); q.make();
    const n = q.getModuleCount(), m = 2; // margen de 2 módulos
    let p = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) p += `M${c + m} ${r + m}h1v1h-1z`;
    return { p, total: n + m * 2 };
  }, [texto]);
  return (
    <Svg width={tam} height={tam} viewBox={`0 0 ${d.total} ${d.total}`}>
      <Rect x={0} y={0} width={d.total} height={d.total} rx={2} fill={fondo} />
      <Path d={d.p} fill={color} />
    </Svg>
  );
}
