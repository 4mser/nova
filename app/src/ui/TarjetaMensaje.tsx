/* El mensaje que NOVA redactó, esperando tu visto bueno (src/voz/telefono.ts): para quién, por dónde y el texto.
   Si le pides cambios, NOVA lo reescribe y la tarjeta cambia sola. «Enviar» abre el chat con el texto puesto (solo
   tocas enviar); «Descartar» lo borra. Se usa en el chat y en la capa del asistente. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useIdioma } from '../i18n';
import { descartarBorrador, enviarBorrador, useBorrador } from '../voz/telefono';
import { C, Txt } from './tema';

const VIA = { whatsapp: { icono: 'logo-whatsapp', color: '#25d366', nombre: 'WhatsApp' }, sms: { icono: 'chatbubble', color: C.nova, nombre: 'SMS' }, correo: { icono: 'mail', color: C.lila, nombre: 'Email' }, notificacion: { icono: 'flash', color: '#25d366', nombre: 'Direct reply' } } as const;

export function TarjetaMensaje({ alAbrir }: { alAbrir?: () => void }) {
  const b = useBorrador(), { t } = useIdioma();
  if (!b) return null;
  const v = VIA[b.via];
  return (
    <Animated.View entering={FadeIn.duration(220)} style={{ borderRadius: 22, backgroundColor: C.s2, borderWidth: 1, borderColor: C.l2, padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={v.icono} size={16} color={v.color} />
        <Txt f="m" size={13} color={C.t2} style={{ flex: 1 }} numberOfLines={1}>{t('To {x}', { x: b.para })} · {b.via === 'notificacion' ? `${b.app ?? 'WhatsApp'} · ${t(v.nombre)}` : t(v.nombre)}</Txt>
      </View>
      {b.asunto ? <Txt f="s" size={14.5}>{b.asunto}</Txt> : null}
      <Animated.View key={b.texto} entering={FadeIn.duration(200)} style={{ alignSelf: 'flex-start', maxWidth: '100%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomLeftRadius: 6, backgroundColor: C.s1 }}>
        <Txt size={15} lh={21}>{b.texto}</Txt>
      </Animated.View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); descartarBorrador(); }} style={({ pressed }) => ({ height: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: C.l2, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
          <Txt f="m" size={14} color={C.t2}>{t('Discard')}</Txt>
        </Pressable>
        <Pressable onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); enviarBorrador().then(r => { if (r.ok && !r.enviado) alAbrir?.(); }); }} style={({ pressed }) => ({ flex: 1, height: 40, borderRadius: 20, backgroundColor: v.color, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: pressed ? 0.85 : 1 })}>
          <Ionicons name="paper-plane" size={15} color={C.tinta} />
          <Txt f="s" size={14.5} color={C.tinta}>{t('Send')}</Txt>
        </Pressable>
      </View>
    </Animated.View>
  );
}
