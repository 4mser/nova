/* Actualizaciones sin reinstalar (EAS Update): al abrir la app y al volver a ella (cada 20 min como mucho) se busca
   una versión nueva del JS y se descarga por detrás. Lista la descarga, aparece una píldora arriba: tocarla reinicia
   con la versión nueva. Si nadie la toca, la próxima vez que se abra la app ya parte con ella. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { AppState, Platform, Pressable } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIdioma } from '../i18n';
import { C, Txt } from './tema';

const CADA = 20 * 60e3;
// en web no hay actualizaciones: el hook se reemplaza por uno vacío (fijo para toda la vida de la app)
const useEstado = Platform.OS === 'web' ? () => ({ isUpdatePending: false }) : Updates.useUpdates;

export function AvisoActualizacion() {
  const { isUpdatePending } = useEstado();
  const ultima = useRef(0), ins = useSafeAreaInsets(), { t } = useIdioma();

  useEffect(() => {
    if (__DEV__ || Platform.OS === 'web' || !Updates.isEnabled) return;
    const buscar = async () => {
      if (Date.now() - ultima.current < CADA) return;
      ultima.current = Date.now();
      try { if ((await Updates.checkForUpdateAsync()).isAvailable) await Updates.fetchUpdateAsync(); } catch {}
    };
    buscar();
    const s = AppState.addEventListener('change', e => { if (e === 'active') buscar(); });
    return () => s.remove();
  }, []);

  if (!isUpdatePending) return null;
  return (
    <Animated.View entering={FadeInUp.duration(380)} exiting={FadeOutUp} style={{ position: 'absolute', top: ins.top + 8, alignSelf: 'center', zIndex: 50 }}>
      <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); Updates.reloadAsync().catch(() => {}); }} accessibilityRole="button" accessibilityLabel={t('New version ready. Tap to update')}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingLeft: 14, paddingRight: 16, borderRadius: 20, backgroundColor: C.nova, opacity: pressed ? 0.85 : 1, boxShadow: '0 10px 28px -8px rgba(70,200,232,0.7)' })}>
        <Ionicons name="sparkles" size={15} color={C.tinta} />
        <Txt f="s" size={14} color={C.tinta}>{t('New version ready')}</Txt>
        <Txt size={13.5} color={C.tinta} style={{ opacity: 0.7 }}>· {t('tap to update')}</Txt>
      </Pressable>
    </Animated.View>
  );
}

/** «0.4.0 · act. 3f2a91c · 5 oct» para el pie de Tú: qué versión corre de verdad */
export function versionActual(locale: string) {
  if (Platform.OS === 'web') return 'web';
  const id = Updates.updateId?.slice(0, 7);
  const fecha = Updates.createdAt && !Updates.isEmbeddedLaunch ? Updates.createdAt.toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : null;
  return [Updates.runtimeVersion, id && fecha ? `${id} · ${fecha}` : null].filter(Boolean).join(' · ');
}
