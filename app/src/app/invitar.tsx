/* Invitar a la crew: un QR para escanear al lado, y el enlace para mandar por WhatsApp (abre NOVA en «Unirse»). */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API } from '../cuenta/api';
import { useCrew } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { QR } from '../ui/QR';
import { volver } from '../ui/volver';
import { C, Txt } from '../ui/tema';

export default function Invitar() {
  const ins = useSafeAreaInsets(), { t } = useIdioma(), crew = useCrew();
  if (!crew) return null;
  const enlace = `${API.replace(/\/$/, '')}/unirse/${crew.codigo}`;
  const compartir = () => { Haptics.selectionAsync().catch(() => {}); Share.share({ message: t('Join {crew} on NOVA: {link} (code {c})', { crew: crew.nombre, link: enlace, c: crew.codigo }) }).catch(() => {}); };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/crew')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 10 }}>
        <Txt f="s" size={28} ls={-1} style={{ textAlign: 'center' }}>{t('Invite to {crew}', { crew: crew.nombre })}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ textAlign: 'center', marginTop: 6, maxWidth: 320 }}>{t('Scan it with the phone camera, or send the link. They need a NOVA account to join.')}</Txt>
        <View style={{ marginTop: 28, padding: 14, borderRadius: 28, backgroundColor: '#fff', boxShadow: '0 20px 60px -20px rgba(143,230,245,0.45)' }}>
          <QR texto={enlace} tam={230} />
        </View>
        <Txt f="mono" size={26} ls={6} color={C.nova} style={{ marginTop: 22 }}>{crew.codigo}</Txt>
        <Txt size={12.5} color={C.t3} style={{ marginTop: 4 }} numberOfLines={1}>{enlace.replace(/^https?:\/\//, '')}</Txt>
        <Pressable onPress={compartir} style={({ pressed }) => ({ marginTop: 26, height: 54, paddingHorizontal: 28, borderRadius: 27, backgroundColor: C.nova, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.85 : 1 })}>
          <Ionicons name="share-social-outline" size={18} color={C.tinta} />
          <Txt f="s" size={16} color={C.tinta}>{t('Send the invitation')}</Txt>
        </Pressable>
      </View>
    </View>
  );
}
