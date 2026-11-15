/* Lo nuevo de NOVA (src/engine/novedades.ts): aparece sola la primera vez que abres la app después de actualizar, y
   desde Ajustes cuando quieras. Todo a la vista de inmediato (sin esperar a ninguna voz): la intro y cada tarjeta
   entran con un fundido corto, una tras otra. Los botones de cada tarjeta encienden lo que haga falta (asistente,
   sobre otras apps, accesibilidad) y muestran «Ya está» cuando vuelves de los Ajustes. Al cerrar queda marcada como vista. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { Easing, FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NovaControl } from '../../modules/nova-control';
import { marcarNovedadesVistas, porMostrar, type Novedad } from '../engine/novedades';
import { useIdioma } from '../i18n';
import { NovaOrb } from '../nova/NovaOrb';
import { Orbita } from '../nova/Orbita';
import { volver } from '../ui/volver';
import { C, Txt } from '../ui/tema';

const COLOR = { nova: C.nova, ok: C.ok, lila: C.lila, aviso: C.aviso };
const entrar = (d = 0) => FadeIn.duration(260).delay(d).easing(Easing.out(Easing.cubic));

/** qué acciones de las tarjetas ya están hechas en este teléfono */
function estados() {
  const N = NovaControl;
  return { activar_asistente: N?.esAsistente() ?? false, permitir_sobreponer: N?.puedeSobreponer?.() ?? false, activar_accesibilidad: N?.accesibilidadActiva?.() ?? false } as Record<string, boolean>;
}

export default function Novedades() {
  const ins = useSafeAreaInsets(), { t } = useIdioma();
  const [version] = useState(porMostrar);
  const tarjetas = useMemo(() => version?.novedades ?? [], [version]);
  const [hecho, setHecho] = useState(estados);

  useEffect(() => { marcarNovedadesVistas(); }, []);
  // al volver de los Ajustes de Android se relee qué quedó encendido
  useEffect(() => {
    const s = AppState.addEventListener('change', x => { if (x === 'active') setHecho(estados()); });
    return () => s.remove();
  }, []);

  if (!version) return null;
  const cerrar = () => volver('/');
  const hacer = (a: NonNullable<Novedad['accion']>) => {
    Haptics.selectionAsync().catch(() => {});
    const N = NovaControl;
    if (!N) return;
    if (a.hacer === 'activar_asistente') N.abrirAjustesAsistente();
    else if (a.hacer === 'probar_asistente') N.abrirAsistente();
    else if (a.hacer === 'permitir_sobreponer') N.pedirSobreponer?.();
    else if (a.hacer === 'activar_accesibilidad') N.abrirAccesibilidad?.();
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={cerrar} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: ins.bottom + 30 }}>
        <View style={{ alignItems: 'center' }}>
          <View style={{ width: 200, height: 200, alignItems: 'center', justifyContent: 'center' }}>
            <Orbita size={200} marcas={80} vel={0.4} />
            <NovaOrb size={186} orbes={4} expr="feliz" />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, paddingHorizontal: 12, borderRadius: 13, backgroundColor: C.sigSuave, marginTop: 2 }}>
            <Ionicons name="sparkles" size={12} color={C.nova} />
            <Txt f="mono" size={11.5} ls={1.2} color={C.nova}>{t('VERSION {v}', { v: version.id })}</Txt>
          </View>
          <Txt f="s" size={30} ls={-1.2} lh={34} style={{ marginTop: 12, textAlign: 'center' }}>{t('What’s new in NOVA')}</Txt>
          <Animated.View entering={entrar()} style={{ minHeight: 52, marginTop: 8, paddingHorizontal: 8 }}>
            <Txt size={17} lh={24} color={C.t2} style={{ textAlign: 'center' }}>{t(version.dice)}</Txt>
          </Animated.View>
        </View>

        <View style={{ gap: 12, marginTop: 14 }}>
          {tarjetas.map((n, i) => (
            <Animated.View key={n.titulo} entering={entrar(80 + i * 70)}>
              <Tarjeta n={n} hecho={!!n.accion && !!hecho[n.accion.hacer]} onAccion={hacer} />
            </Animated.View>
          ))}
        </View>

        <Animated.View entering={entrar(120 + tarjetas.length * 70)} style={{ flexDirection: 'row', gap: 8, marginTop: 22 }}>
          {NovaControl ? (
            <Pressable onPress={() => hacer({ texto: '', hacer: 'probar_asistente' })} style={{ flex: 1, height: 52, borderRadius: 26, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 }}>
              <Ionicons name="mic" size={16} color={C.nova} />
              <Txt f="m" size={15} color={C.t1}>{t('Try it now')}</Txt>
            </Pressable>
          ) : null}
          <Pressable onPress={cerrar} style={({ pressed }) => ({ flex: 1, height: 52, borderRadius: 26, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
            <Txt f="s" size={15.5} color={C.tinta}>{t('Got it')}</Txt>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

/** una novedad: ícono en su color, qué es, cómo se usa y, si aplica, frases para probar y un botón */
function Tarjeta({ n, hecho, onAccion }: { n: Novedad; hecho: boolean; onAccion: (a: NonNullable<Novedad['accion']>) => void }) {
  const { t } = useIdioma(), col = COLOR[n.color];
  return (
    <View style={{ borderRadius: 24, padding: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: `${col}1f`, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={n.icono} size={20} color={col} />
        </View>
        <Txt f="s" size={18} ls={-0.4} style={{ flex: 1 }}>{t(n.titulo)}</Txt>
      </View>
      <Txt size={14.5} lh={21} color={C.t2}>{t(n.texto)}</Txt>
      {n.ejemplos?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {n.ejemplos.map(e => (
            <View key={e} style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: C.s2, borderWidth: 1, borderColor: C.l2 }}>
              <Txt f="m" size={13} color={C.t1}>{t(e)}</Txt>
            </View>
          ))}
        </View>
      ) : null}
      {n.accion ? (
        hecho ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="checkmark-circle" size={17} color={C.ok} />
            <Txt f="m" size={14} color={C.ok}>{t('Already on')}</Txt>
          </View>
        ) : (
          <Pressable onPress={() => onAccion(n.accion!)} style={({ pressed }) => ({ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 16, borderRadius: 19, backgroundColor: `${col}22`, opacity: pressed ? 0.7 : 1 })}>
            <Txt f="s" size={14} color={col}>{t(n.accion.texto)}</Txt>
            <Ionicons name="arrow-forward" size={14} color={col} />
          </Pressable>
        )
      ) : null}
    </View>
  );
}
