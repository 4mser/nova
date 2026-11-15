/* Pase de NOVA Station en tu perfil (modo misión): tu QR siempre a mano para entrar a la tablet de la nave sin tarjeta.
   Tocarlo lo abre en grande. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useQrNave } from '../cuenta/qrNave';
import { useIdioma } from '../i18n';
import { QR } from './QR';
import { C, Cel, Toque, Txt } from './tema';

export function PaseStation() {
  const { t } = useIdioma(), { codigo, error, quedan, enlazada, asiento } = useQrNave();
  if (!enlazada) return null;
  return (
    <Toque onPress={() => router.push('/qr-nave')} label={t('My station QR')} style={{ marginTop: 18 }}>
      <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderColor: 'rgba(168,152,255,0.45)' }}>
        <View style={{ width: 132, height: 132, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
          {codigo ? <QR texto={codigo} tam={116} /> : <Ionicons name={error ? 'cloud-offline-outline' : 'qr-code-outline'} size={34} color="#041218" />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt f="s" size={17}>{t('NOVA Station pass')}</Txt>
          <Txt size={13} lh={18} color={C.t2} style={{ marginTop: 4 }}>{t('Show it to the station tablet to open your space.')}</Txt>
          <Txt f="m" size={12} color={error ? C.alerta : C.nova} style={{ marginTop: 10 }}>
            {error ? t('The ship is not answering.') : `${t('Seat {s}', { s: asiento })} · ${t('new code in {n} s', { n: quedan })}`}
          </Txt>
        </View>
        <Ionicons name="expand-outline" size={18} color={C.t3} />
      </Cel>
    </Toque>
  );
}
