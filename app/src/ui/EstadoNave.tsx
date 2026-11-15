/* Estado de la nave (Tú, modo misión): el núcleo de vuelo, el enlace con la Tierra y lo último que subió de allá. */
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { useNave } from '../cuenta/nave';
import { useNaveEstado } from '../cuenta/naveEstado';
import { useIdioma } from '../i18n';
import { C, Cel, Txt } from './tema';

export function EstadoNave() {
  const { t } = useIdioma(), { url } = useNave(), { vivo, mision, sistemas } = useNaveEstado();
  if (!url) return null;
  const nucleo = sistemas?.nucleo.en_linea ?? vivo;
  const entregado = sistemas?.subida.find(x => x.estado === 'entregado');
  const enVuelo = sistemas?.subida.filter(x => x.estado === 'en_vuelo').length ?? 0;
  const fila = (icono: keyof typeof Ionicons.glyphMap, titulo: string, valor: string, col: string = C.t1) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.l1 }}>
      <Ionicons name={icono} size={18} color={C.t2} />
      <Txt size={15} style={{ flex: 1 }}>{titulo}</Txt>
      <Txt f="m" size={14} color={col}>{valor}</Txt>
    </View>
  );
  return (
    <Cel style={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 4 }}>
      {fila('hardware-chip-outline', t('Onboard core'), nucleo ? t('Online') : t('No signal'), nucleo ? C.ok : C.aviso)}
      {mision ? fila('radio-outline', t('Earth link'), mision.conjuncion ? t('Solar conjunction') : t('{m} light-min', { m: (mision.luz_seg / 60).toFixed(1) }), mision.conjuncion ? C.aviso : C.t1) : null}
      {fila('arrow-up-circle-outline', t('Last update from Earth'), entregado ? entregado.nombre.split('.').pop()!.replace(/_PRM_(SET|SAVE)$/, '') : t('None yet'))}
      {enVuelo ? fila('time-outline', t('On the way from Earth'), String(enVuelo), C.lila) : null}
    </Cel>
  );
}
