/* Tu QR para NOVA Station: la tablet común de la nave lo escanea y abre tu espacio (si no tienes tarjeta NFC a mano).
   El código lo da la nave, sirve una sola vez y vence en 60 s; la app pide uno nuevo cada 30 s, así una foto o una
   captura del QR deja de servir enseguida. */
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNave } from '../cuenta/nave';
import { useQrNave } from '../cuenta/qrNave';
import { useIdioma } from '../i18n';
import { QR } from '../ui/QR';
import { volver } from '../ui/volver';
import { C, Txt } from '../ui/tema';

export default function QrNave() {
  const ins = useSafeAreaInsets(), { t } = useIdioma(), nave = useNave();
  const q = useQrNave(), codigo = q.codigo, quedan = q.quedan;
  const error = !q.enlazada ? t('Link the ship first: write its address above.') : q.error ? t('The ship is not answering.') : '';
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 10 }}>
        <Txt f="s" size={28} ls={-1} style={{ textAlign: 'center' }}>{t('My station QR')}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ textAlign: 'center', marginTop: 6, maxWidth: 320 }}>{t('On NOVA Station, tap «Scan my QR» and hold your phone in front of the tablet.')}</Txt>
        <View style={{ marginTop: 28, padding: 14, borderRadius: 28, backgroundColor: '#fff', minWidth: 258, minHeight: 258, alignItems: 'center', justifyContent: 'center' }}>
          {codigo ? <QR texto={codigo} tam={230} /> : <Txt size={14} color="#041218">{error || t('Asking the ship…')}</Txt>}
        </View>
        <Txt f="mono" size={14} color={C.nova} style={{ marginTop: 18 }}>{t('Seat {s}', { s: nave.asiento })}</Txt>
        <Txt size={12.5} color={error ? C.alerta : C.t3} style={{ marginTop: 6, textAlign: 'center' }}>{error || t('New code in {n} s · each code works once', { n: quedan })}</Txt>
      </View>
    </View>
  );
}
