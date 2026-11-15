/* Configuración: todo lo ajustable de NOVA en un solo lugar, ordenado.
   · Rendimiento: Automático (mide tu teléfono), Máxima calidad o Rendimiento, con lo que mide y lo que cambia
   · Experiencia: voz de NOVA en Hoy, personalizar Hoy, idioma
   · Control del teléfono (Android): NOVA como asistente, ficha de ajustes rápidos, qué está sonando
   · Avisos, clima, conexiones y privacidad, laboratorio, cuenta (con buscar actualizaciones y la versión) */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NovaControl } from '../../modules/nova-control';
import { cambiarFuncion, useFunciones } from '../engine/funciones';
import { elegirModo, useRendimiento, type ModoRendimiento } from '../engine/rendimiento';
import { useIdioma } from '../i18n';
import { Avisos, CicloAjuste, CiudadClima, Cuenta_, ModoMision, SelectorIdioma } from '../ui/AjustesSecciones';
import { Interruptor } from '../ui/Interruptor';
import { volver } from '../ui/volver';
import { C, Cel, Seccion, Txt } from '../ui/tema';

const MODOS: { k: ModoRendimiento; t: string; d: string; icono: keyof typeof Ionicons.glyphMap }[] = [
  { k: 'auto', t: 'Automatic', d: 'Nova measures your phone and decides', icono: 'sparkles-outline' },
  { k: 'calidad', t: 'Max quality', d: 'Every animation, at 60 fps', icono: 'diamond-outline' },
  { k: 'rendimiento', t: 'Performance', d: 'Lighter and smoother on any phone', icono: 'flash-outline' },
];

export default function Ajustes() {
  const ins = useSafeAreaInsets(), { t } = useIdioma(), { mision } = useFunciones();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: ins.bottom + 40 }}>
        <Txt f="s" size={30} ls={-1.2} lh={34}>{t('App settings')}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6 }}>{t('Everything you can adjust in Nova, in one place.')}</Txt>

        <Rendimiento />
        <Experiencia />
        {/* en modo misión solo queda lo que sirve en la nave */}
        {!mision ? <ControlTelefono /> : null}
        <Avisos />
        {!mision ? <CiudadClima /> : null}
        {!mision ? <Conexiones /> : null}
        <CicloAjuste />
        <ModoMision />
        <Cuenta_ />
        <BuscarActualizacion />
      </ScrollView>
    </View>
  );
}

function Rendimiento() {
  const { t } = useIdioma(), { modo, fps, ligero } = useRendimiento();
  return (
    <>
      <Seccion t={t('Performance')} nota={fps != null ? t('your phone: {n} fps', { n: fps }) : t('measuring…')} />
      <Cel style={{ padding: 8, gap: 6 }}>
        {MODOS.map(m => <OpcionModo key={m.k} m={m} on={modo === m.k} />)}
      </Cel>
      {/* qué está pasando ahora, en palabras */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, paddingHorizontal: 4 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ligero ? C.aviso : C.ok }} />
        <Txt size={13} lh={18} color={C.t2} style={{ flex: 1 }}>
          {ligero ? t('Light mode is on: Nova moves at 30 fps without glow effects, decorations stay still and hidden tabs do not redraw.') : t('Full mode: every animation at full quality.')}
        </Txt>
      </View>
    </>
  );
}

function OpcionModo({ m, on }: { m: (typeof MODOS)[number]; on: boolean }) {
  const { t } = useIdioma();
  const marca = useAnimatedStyle(() => ({ opacity: withTiming(on ? 1 : 0, { duration: 180 }), transform: [{ scale: withTiming(on ? 1 : 0.6, { duration: 180 }) }] }), [on]);
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); elegirModo(m.k); }} accessibilityRole="radio" accessibilityState={{ selected: on }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: on ? C.sigSuave : pressed ? C.s2 : 'transparent', borderWidth: 1, borderColor: on ? `${C.nova}66` : 'transparent' })}>
      <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: on ? C.nova : C.s2, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={m.icono} size={18} color={on ? C.tinta : C.t2} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt f="s" size={15} color={on ? C.t1 : C.t1}>{t(m.t)}</Txt>
        <Txt size={12.5} color={C.t3}>{t(m.d)}</Txt>
      </View>
      <Animated.View style={marca}><Ionicons name="checkmark-circle" size={22} color={C.nova} /></Animated.View>
    </Pressable>
  );
}

function Fila({ icono, t, d, onPress, derecha, color = C.nova, primero }: { icono: keyof typeof Ionicons.glyphMap; t: string; d?: string; onPress?: () => void; derecha?: React.ReactNode; color?: string; primero?: boolean }) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: primero ? 0 : 1, borderTopColor: C.l1, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: `${color}1f`, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icono} size={16} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt size={15}>{t}</Txt>
        {d ? <Txt size={12.5} lh={17} color={C.t3}>{d}</Txt> : null}
      </View>
      {derecha ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={C.t3} /> : null)}
    </Pressable>
  );
}

function Experiencia() {
  const { t } = useIdioma(), { vozHoy } = useFunciones();
  return (
    <>
      <Seccion t={t('Experience')} />
      <Cel style={{ paddingVertical: 2 }}>
        <Fila primero icono="volume-high-outline" t={t('Nova’s voice on Today')} d={t('She says the essentials out loud when you open the app')} derecha={<Interruptor on={vozHoy} label={t('Nova’s voice on Today')} onChange={v => cambiarFuncion('vozHoy', v)} />} />
        <Fila icono="options-outline" t={t('Customize Today')} d={t('Show, hide and reorder the sections')} onPress={() => router.push('/personalizar')} />
        <Fila icono="sparkles-outline" t={t('What’s new in NOVA')} d={t('What changed in the last update, told by Nova')} onPress={() => router.push('/novedades')} />
        <Fila icono="navigate-outline" t={t('Tour with Nova')} d={t('Two minutes, step by step')} color={C.lila} onPress={() => router.push('/mapa')} />
      </Cel>
      <SelectorIdioma />
    </>
  );
}

/** NOVA fuera de la app (Android, modules/nova-control): se llama desde cualquier lado y controla música, cámara y apps.
    El estado se relee al volver de los Ajustes de Android. */
function ControlTelefono() {
  const { t } = useIdioma();
  const N = NovaControl;
  const leer = () => ({ asistente: N?.esAsistente() ?? false, musica: N?.tieneAccesoNotificaciones() ?? false, noMolestar: N?.tienePermisoNoMolestar?.() ?? false, sobreponer: N?.puedeSobreponer?.() ?? false, accesibilidad: N?.accesibilidadActiva?.() ?? false });
  const [e, setE] = useState(leer);
  const [ficha, setFicha] = useState<boolean | null>(null);
  useEffect(() => {
    const s = AppState.addEventListener('change', x => { if (x === 'active') setE(leer()); });
    return () => s.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!N) return null;
  const listo = <Txt f="m" size={13} color={C.ok}>{t('On')}</Txt>;
  return (
    <>
      <Seccion t={t('Phone control')} nota={t('outside the app')} />
      <Cel style={{ paddingVertical: 2 }}>
        <Fila primero icono="radio-button-on-outline" t={t('NOVA as your phone assistant')} d={e.asistente ? t('Hold the power button (or the assistant gesture) from any app') : t('Choose NOVA in «Digital assistant app»; then hold the power button from any app')} derecha={e.asistente ? listo : undefined} onPress={() => N.abrirAjustesAsistente()} />
        <Fila icono="apps-outline" t={t('NOVA in Quick Settings')} d={ficha ? t('Added: swipe down and tap NOVA') : t('A NOVA tile in the top shade, one tap away')} derecha={ficha ? listo : undefined} onPress={() => N.agregarFicha().then(setFicha).catch(() => setFicha(false))} />
        <Fila icono="albums-outline" t={t('Over your apps')} d={e.sobreponer ? t('Nova stays as a bubble when she opens another app') : t('Allow «display over other apps» so Nova shrinks to a bubble instead of closing')} derecha={e.sobreponer ? listo : undefined} onPress={() => N.pedirSobreponer?.()} />
        <Fila icono="hand-left-outline" t={t('Use apps for you')} d={t('Accessibility: Nova sees what is on screen and taps, types and scrolls for you («open the latest email»)')} color={C.lila} derecha={e.accesibilidad ? listo : undefined} onPress={() => N.abrirAccesibilidad?.()} />
        <Fila icono="chatbubbles-outline" t={t('Music and chats')} d={t('Notification access: NOVA knows what is playing, reads your unread chats and the latest notifications of any app, and replies to chats without opening the app.')} derecha={e.musica ? listo : undefined} onPress={() => N.abrirAccesoNotificaciones()} />
        <Fila icono="moon-outline" t={t('Do not disturb by voice')} d={t('Let NOVA switch silent, vibrate or do not disturb')} color={C.aviso} derecha={e.noMolestar ? listo : undefined} onPress={() => N.abrirPermisoNoMolestar?.()} />
        <Fila icono="mic-outline" t={t('Try it now')} d={t('«Pause», «open the latest email», «what does the last notification say?», «play Tool on Spotify»')} color={C.lila} onPress={() => N.abrirAsistente()} />
      </Cel>
    </>
  );
}

function Conexiones() {
  const { t } = useIdioma();
  return (
    <>
      <Seccion t={t('Connections and privacy')} />
      <Cel style={{ paddingVertical: 2 }}>
        <Fila primero icono="git-network-outline" t={t('Integrations')} d={t('Health, calendars, watch, Spotify, GitHub…')} color={C.ok} onPress={() => router.push('/integraciones')} />
        <Fila icono="shield-checkmark-outline" t={t('Your data')} d={t('What Nova can read and from where')} onPress={() => router.push('/datos')} />
        <Fila icono="key-outline" t={t('Permissions')} d={t('Microphone, notifications, health, calendar')} onPress={() => router.push('/permisos')} />
        <Fila icono="bookmark-outline" t={t('Nova’s memory')} d={t('What Nova remembers about you; delete anything')} color={C.lila} onPress={() => router.push('/memoria')} />
      </Cel>
    </>
  );
}

/** buscar una actualización ahora (sin esperar a reabrir la app) */
function BuscarActualizacion() {
  const { t } = useIdioma();
  const [estado, setEstado] = useState<'nada' | 'buscando' | 'al_dia' | 'lista' | 'error'>('nada');
  if (Platform.OS === 'web' || !Updates.isEnabled) return null;
  const buscar = async () => {
    setEstado('buscando');
    try {
      const r = await Updates.checkForUpdateAsync();
      if (!r.isAvailable) { setEstado('al_dia'); return; }
      await Updates.fetchUpdateAsync();
      setEstado('lista');
    } catch { setEstado('error'); }
  };
  return (
    <Pressable onPress={estado === 'lista' ? () => Updates.reloadAsync().catch(() => {}) : buscar} disabled={estado === 'buscando'}
      style={({ pressed }) => ({ marginTop: 14, height: 48, borderRadius: 24, borderWidth: 1, borderColor: estado === 'lista' ? C.nova : C.l2, backgroundColor: estado === 'lista' ? C.nova : 'transparent', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: pressed ? 0.8 : 1 })}>
      {estado === 'buscando' ? <ActivityIndicator color={C.nova} /> : <Ionicons name={estado === 'lista' ? 'refresh' : estado === 'al_dia' ? 'checkmark-circle-outline' : 'cloud-download-outline'} size={17} color={estado === 'lista' ? C.tinta : C.t2} />}
      <Txt f="m" size={14} color={estado === 'lista' ? C.tinta : C.t2}>
        {t(estado === 'lista' ? 'Update ready: tap to restart' : estado === 'al_dia' ? 'You have the latest version' : estado === 'error' ? 'Could not check. Try again' : 'Check for updates')}
      </Txt>
    </Pressable>
  );
}
