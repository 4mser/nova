/* Lo último que llegó de casa: en Tú (grilla de fotos) y en Hoy (el más reciente). Toca para abrir Casa. */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useNave } from '../cuenta/nave';
import { urlArchivoCasa, useNaveEstado } from '../cuenta/naveEstado';
import { useIdioma } from '../i18n';
import { C, Cel, Txt } from './tema';

export function CasaTarjeta({ w, compacta }: { w: number; compacta?: boolean }) {
  const { t } = useIdioma(), { casa } = useNaveEstado(), { url } = useNave();
  const mensajes = casa?.mensajes ?? [];
  const fotos = mensajes.filter(m => m.tipo === 'foto' && m.archivo).slice(0, compacta ? 1 : 4);
  const ultimo = mensajes[0];
  const abrir = () => router.push('/casa');
  if (compacta && !ultimo) return null;
  const lado = (w - 34 - 3 * 6) / 4;
  return (
    <Pressable onPress={abrir} accessibilityRole="button" accessibilityLabel={t('From home')} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      <Cel style={{ padding: compacta ? 0 : 16, overflow: 'hidden' }}>
        {compacta && ultimo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {fotos[0] ? <Image source={{ uri: urlArchivoCasa(fotos[0].id) }} style={{ width: 92, height: 92 }} contentFit="cover" cachePolicy="disk" /> : (
              <View style={{ width: 92, height: 92, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(168,152,255,0.12)' }}><Ionicons name="chatbubble-ellipses-outline" size={26} color={C.lila} /></View>
            )}
            <View style={{ flex: 1, paddingHorizontal: 16, gap: 4 }}>
              <Txt f="m" size={12.5} color={C.lila}>{t('From home')}{casa?.en_camino ? ` · ${t('{n} on the way', { n: casa.en_camino })}` : ''}</Txt>
              <Txt size={15} lh={20} numberOfLines={2}>{ultimo.texto || t('A photo from {n}', { n: ultimo.de })}</Txt>
              <Txt size={12.5} color={C.t3}>{ultimo.de}</Txt>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.t3} style={{ marginRight: 14 }} />
          </View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Txt size={15} style={{ flex: 1 }}>{!url ? t('Link the ship to receive messages from home') : mensajes.length ? t('{n} messages from your family', { n: mensajes.length }) : t('Nothing from home yet')}</Txt>
              <Ionicons name="chevron-forward" size={18} color={C.t3} />
            </View>
            {fotos.length ? (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
                {fotos.map(f => <Image key={f.id} source={{ uri: urlArchivoCasa(f.id) }} style={{ width: lado, height: lado, borderRadius: 12 }} contentFit="cover" cachePolicy="disk" />)}
              </View>
            ) : null}
            {casa?.en_camino ? <Txt size={12.5} color={C.lila} style={{ marginTop: 10 }}>{t('{n} on the way from Earth', { n: casa.en_camino })}</Txt> : null}
          </>
        )}
      </Cel>
    </Pressable>
  );
}
