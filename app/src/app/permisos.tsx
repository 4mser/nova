/* Tú → Permisos: la misma lista de la bienvenida, para dar (o revisar) permisos después. */
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { agendarMomentos } from '../cuenta/momento';
import { registrarPush } from '../cuenta/push';
import { useCrew } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { ListaPermisos } from '../ui/ListaPermisos';
import { volver } from '../ui/volver';
import { C, Txt } from '../ui/tema';

export default function Permisos() {
  const ins = useSafeAreaInsets(), { t, idioma } = useIdioma(), crew = useCrew();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: ins.bottom + 30 }}>
        <Txt f="s" size={30} ls={-1.2} lh={34}>{t('Permissions')}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6, marginBottom: 18 }}>{t('Only what you allow. If Android blocked one, the button opens Nova settings so you can turn it on there.')}</Txt>
        <ListaPermisos alAvisos={() => { agendarMomentos(crew ? { id: crew.id, nombre: crew.nombre } : null); registrarPush(idioma); }} />
      </ScrollView>
    </View>
  );
}
