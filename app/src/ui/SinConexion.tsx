/* «Sin conexión»: una píldora discreta arriba mientras la API no responde por red. Lo guardado se sigue viendo; se va
   sola apenas un pedido vuelve a andar (y se reintenta cada 20 s y al volver a la app). */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { estaEnLinea, suscribirRed } from '../cuenta/api';
import { refrescarSesion } from '../cuenta/sesion';
import { usePendientes } from '../cuenta/cola';
import { useIdioma } from '../i18n';
import { C, Txt } from './tema';
import { useFunciones } from '../engine/funciones';
import { useNave } from '../cuenta/nave';
import { useNaveEstado } from '../cuenta/naveEstado';

export function SinConexion() {
  const enLinea = useSyncExternalStore(suscribirRed, estaEnLinea, estaEnLinea), ins = useSafeAreaInsets(), { t, tp } = useIdioma(), pendientes = usePendientes();
  useEffect(() => {
    if (enLinea) return;
    const id = setInterval(refrescarSesion, 20e3);
    const s = AppState.addEventListener('change', e => { if (e === 'active') refrescarSesion(); });
    return () => { clearInterval(id); s.remove(); };
  }, [enLinea]);
  // en la nave no hay internet: eso es lo normal. Lo que importa es la señal de la nave
  const { mision } = useFunciones(), { url } = useNave(), { vivo, recibido } = useNaveEstado();
  if (mision && url) {
    if (vivo || !recibido) return null;
    return (
      <Animated.View entering={FadeInUp.duration(300)} exiting={FadeOutUp.duration(250)} pointerEvents="none" style={{ position: 'absolute', top: ins.top + 6, alignSelf: 'center', zIndex: 40 }}
        accessibilityLiveRegion="polite" accessibilityLabel={t('No signal from the ship')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 32, paddingHorizontal: 13, borderRadius: 16, backgroundColor: 'rgba(15,21,29,0.96)', borderWidth: 1, borderColor: 'rgba(242,180,87,0.35)' }}>
          <Ionicons name="planet-outline" size={14} color={C.aviso} />
          <Txt f="m" size={12.5} color={C.t1}>{t('No signal from the ship')}</Txt>
          <Txt size={12.5} color={C.t3}>· {t('showing what was saved')}</Txt>
        </View>
      </Animated.View>
    );
  }
  if (enLinea) return null;
  return (
    <Animated.View entering={FadeInUp.duration(300)} exiting={FadeOutUp.duration(250)} pointerEvents="none" style={{ position: 'absolute', top: ins.top + 6, alignSelf: 'center', zIndex: 40 }}
      accessibilityLiveRegion="polite" accessibilityLabel={t('No connection. Showing what was saved.')}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 32, paddingHorizontal: 13, borderRadius: 16, backgroundColor: 'rgba(15,21,29,0.96)', borderWidth: 1, borderColor: 'rgba(242,180,87,0.35)' }}>
        <Ionicons name="cloud-offline-outline" size={14} color={C.aviso} />
        <Txt f="m" size={12.5} color={C.t1}>{t('No connection')}</Txt>
        <Txt size={12.5} color={C.t3}>· {pendientes ? tp(pendientes, '{n} to send', '{n} to send') : t('showing what was saved')}</Txt>
      </View>
    </Animated.View>
  );
}
