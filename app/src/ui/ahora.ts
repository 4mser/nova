/* Reloj que avanza solo: el render no puede leer la hora (React Compiler), así que se guarda en estado y se refresca. */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useAhora(cada = 60e3) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setAhora(Date.now()), cada); return () => clearInterval(id); }, [cada]);
  return ahora;
}

/** «Hoy» para las pantallas que quedan montadas días enteros (las pestañas no se desmontan y la burbuja mantiene viva
    la app): un instante que solo cambia cuando cambia la fecha. Con un «hoy» fijado al abrir, pasada la medianoche la
    pantalla seguía leyendo el día anterior mientras lo que tocabas se guardaba en el de hoy. */
export function useDia() {
  const [dia, setDia] = useState(() => Date.now());
  useEffect(() => {
    const ver = () => setDia(d => (new Date(d).toDateString() === new Date().toDateString() ? d : Date.now()));
    const id = setInterval(ver, 30e3), s = AppState.addEventListener('change', e => { if (e === 'active') ver(); });
    return () => { clearInterval(id); s.remove(); };
  }, []);
  return dia;
}
