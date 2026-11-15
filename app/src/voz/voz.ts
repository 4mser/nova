/* Respaldo sin conexión con la conversación en vivo: NOVA igual habla con SU voz (la del servidor de voz, /decir),
   nunca con la voz robótica del teléfono. Si tampoco hay voz, se queda en silencio y responde en texto.
   No hay envolvente real, así que `habla` sigue una cadencia de sílabas mientras suena. */
import { useCallback, useEffect, useRef } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { callar as callarNova, decir as decirNova, useDiciendo } from './decir';

export function useVozTelefono() {
  const habla = useSharedValue(0);
  const hablando = useDiciendo();
  const reloj = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!hablando) { if (reloj.current) clearInterval(reloj.current); reloj.current = null; habla.set(0); return; }
    let t = 0;
    reloj.current = setInterval(() => { t += 0.033; habla.set(Math.max(0, 0.35 + 0.45 * Math.abs(Math.sin(t * 9.5)) * (0.6 + 0.4 * Math.sin(t * 2.3)))); }, 33);
    return () => { if (reloj.current) clearInterval(reloj.current); reloj.current = null; };
  }, [hablando, habla]);
  const callar = useCallback(() => { callarNova(); habla.set(0); }, [habla]);
  useEffect(() => callar, [callar]);
  const decir = useCallback((texto: string) => { decirNova(texto); }, []);
  return { habla, hablando, decir, callar };
}
