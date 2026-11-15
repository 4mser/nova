/* Salud: Cuerpo y Mente en una sola pestaña, con un selector arriba. La sección se recuerda y también llega por
   parámetro (?seg=cuerpo|mente), así los enlaces viejos a /body y /mind caen donde corresponde. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useIdioma } from '../../i18n';
import Cuerpo from '../../pantallas/Cuerpo';
import Mente from '../../pantallas/Mente';
import Ciclo from '../../pantallas/Ciclo';
import { useCiclo } from '../../engine/ciclo';
import { BajoTitulo, Selector } from '../../ui/Pantalla';

type Seg = 'cuerpo' | 'mente' | 'ciclo';
const esSeg = (v: unknown): v is Seg => v === 'cuerpo' || v === 'mente' || v === 'ciclo';
const CLAVE = 'nova.salud.seg';

export default function Salud() {
  const { t } = useIdioma(), { seg: param } = useLocalSearchParams<{ seg?: string }>();
  const [guardada, setGuardada] = useState<Seg | null>(null);
  const [elegida, setElegida] = useState<{ p?: string; s: Seg } | null>(null);
  const { config } = useCiclo();
  useEffect(() => { AsyncStorage.getItem(CLAVE).then(v => { if (esSeg(v)) setGuardada(v); }).catch(() => {}); }, []);
  // lo elegido aquí manda hasta que llegue otro parámetro; si no hay, la última sección que viste
  let seg: Seg = elegida && elegida.p === param ? elegida.s : esSeg(param) ? param : guardada ?? 'cuerpo';
  if (seg === 'ciclo' && !config.activo) seg = 'cuerpo';
  const cambiar = (k: Seg) => { setElegida({ p: param, s: k }); AsyncStorage.setItem(CLAVE, k).catch(() => {}); };
  const opciones: { k: Seg; t: string; icono: 'heart-outline' | 'happy-outline' | 'water-outline' }[] = [{ k: 'cuerpo', t: t('Body'), icono: 'heart-outline' }, { k: 'mente', t: t('Mind'), icono: 'happy-outline' }];
  if (config.activo) opciones.push({ k: 'ciclo', t: t('Cycle'), icono: 'water-outline' });
  const selector = <Selector opciones={opciones} valor={seg} onCambio={cambiar} />;
  return <BajoTitulo.Provider value={selector}>{seg === 'cuerpo' ? <Cuerpo /> : seg === 'mente' ? <Mente /> : <Ciclo />}</BajoTitulo.Provider>;
}
