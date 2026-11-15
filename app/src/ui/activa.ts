/* ¿Se está viendo esta parte de la app? El paginador lo dice por página (y la barra según si está en primer plano).
   Las animaciones continuas (relojes de NOVA, latidos, la órbita) se pausan cuando no se ven: con 5 pantallas
   montadas a la vez, si no, todas calcularían cada cuadro. */
import { createContext, useContext, useEffect } from 'react';
import type { FrameCallback } from 'react-native-reanimated';

export const Activa = createContext(true);
export const useActiva = () => useContext(Activa);

/** enciende o apaga un useFrameCallback según se vea */
export function usePausa(fc: FrameCallback, activo = true) {
  const visible = useActiva() && activo;
  useEffect(() => { fc.setActive(visible); }, [fc, visible]);
}
