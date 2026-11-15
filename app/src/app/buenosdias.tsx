/* Tu mañana: se abre desde el aviso de las 8:00 (o desde Hoy / pidiéndoselo a NOVA). NOVA te cuenta el día con su voz
   frase por frase (cada una aparece mientras la dice) y abajo queda el detalle: clima, agenda, tareas, hábitos y el
   mejor hueco para concentrarte. Sin voz (apagada o sin conexión) las frases aparecen solas, con su ritmo. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cambiarFuncion, useFunciones } from '../engine/funciones';
import { componerManana } from '../engine/manana';
import { useIdioma } from '../i18n';
import { NovaOrb } from '../nova/NovaOrb';
import { useAhora } from '../ui/ahora';
import { volver } from '../ui/volver';
import { C, Cel, Txt } from '../ui/tema';
import { callar, decirSeguido, useDiciendo, vozNovaDisponible } from '../voz/decir';

export default function BuenosDias() {
  const ins = useSafeAreaInsets(), tr = useIdioma(), { t } = tr, ahora = useAhora(10 * 60e3), { vozHoy } = useFunciones();
  const m = useMemo(() => componerManana(tr, ahora), [tr, ahora]);
  const [visto, setVisto] = useState(0), [vuelta, setVuelta] = useState(0);
  const hablando = useDiciendo(), habla = useSharedValue(0);
  // el cuerpo de NOVA late mientras habla
  useEffect(() => {
    if (!hablando) { habla.set(0); return; }
    const id = setInterval(() => habla.set(0.3 + Math.random() * 0.55), 110);
    return () => clearInterval(id);
  }, [hablando, habla]);
  // con voz: cada frase aparece cuando empieza a decirla; sin voz: aparecen solas, una cada ~2 s
  useEffect(() => {
    let vivo = true, id: ReturnType<typeof setTimeout> | undefined;
    const sinVoz = () => { let i = 0; const sig = () => { if (!vivo) return; i++; setVisto(i); if (i < m.frases.length) id = setTimeout(sig, 1400 + m.frases[i - 1].length * 25); }; id = setTimeout(sig, 500); };
    if (vozHoy && vozNovaDisponible()) decirSeguido(m.frases, i => vivo && setVisto(Math.max(i + 1, 1))).then(ok => { if (vivo && !ok) setVisto(m.frases.length); });
    else sinVoz();
    return () => { vivo = false; if (id) clearTimeout(id); callar(); };
  }, [vuelta]); // eslint-disable-line react-hooks/exhaustive-deps

  const d = m.datos;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); if (vozHoy) callar(); cambiarFuncion('vozHoy', !vozHoy); }} hitSlop={8} accessibilityLabel={t(vozHoy ? 'Mute Nova' : 'Unmute Nova')}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={vozHoy ? 'volume-high-outline' : 'volume-mute-outline'} size={17} color={vozHoy ? C.nova : C.t3} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: ins.bottom + 30 }}>
        <Txt f="mono" size={12} ls={1.4} color={C.nova} style={{ textTransform: 'uppercase', textAlign: 'center' }}>{new Date(ahora).toLocaleDateString(tr.locale, { weekday: 'long', day: 'numeric', month: 'long' })}</Txt>
        <View style={{ alignItems: 'center', marginTop: 8 }}>
          <NovaOrb size={190} orbes={3} expr={visto >= m.frases.length ? 'feliz' : 'normal'} hablaViva={habla} />
        </View>

        {/* lo que dice, frase por frase */}
        <View style={{ gap: 12, marginTop: 6, minHeight: 120 }}>
          {m.frases.slice(0, visto).map((f, i) => (
            <Animated.View key={`${vuelta}-${i}`} entering={FadeInDown.duration(380)}>
              <Txt f={i === 0 ? 's' : 'r'} size={i === 0 ? 22 : 17} lh={i === 0 ? 28 : 24} ls={i === 0 ? -0.5 : -0.2} color={i === visto - 1 && hablando ? C.t1 : i === 0 ? C.t1 : C.t2}>{f}</Txt>
            </Animated.View>
          ))}
        </View>

        {visto >= m.frases.length ? (
          <Animated.View entering={FadeIn.duration(400)} style={{ gap: 8, marginTop: 22 }}>
            {d.clima ? (
              <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Ionicons name={d.clima.icono as keyof typeof Ionicons.glyphMap} size={26} color={C.aviso} />
                <Txt f="s" size={26}>{d.clima.temp}°</Txt>
                <Txt size={13.5} color={C.t2} style={{ flex: 1 }}>{d.clima.texto} · {d.clima.min}° / {d.clima.max}°</Txt>
              </Cel>
            ) : null}
            {d.eventos.length ? (
              <Cel style={{ gap: 8 }}>
                {d.eventos.map(e => (
                  <View key={e.hora + e.titulo} style={{ flexDirection: 'row', gap: 12 }}>
                    <Txt f="mono" size={13} color={C.nova} style={{ width: 48 }}>{e.hora}</Txt>
                    <Txt size={14.5} style={{ flex: 1 }} numberOfLines={1}>{e.titulo}</Txt>
                  </View>
                ))}
              </Cel>
            ) : null}
            {d.tareas.length ? (
              <Cel style={{ gap: 6 }}>
                {d.tareas.map(x => <View key={x} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><Ionicons name="ellipse-outline" size={14} color={C.t3} /><Txt size={14.5} numberOfLines={1} style={{ flex: 1 }}>{x}</Txt></View>)}
              </Cel>
            ) : null}
            {d.hueco ? (
              <Pressable onPress={() => router.push('/foco')}>
                <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: `${C.nova}55` }}>
                  <Ionicons name="timer-outline" size={20} color={C.nova} />
                  <Txt size={14.5} style={{ flex: 1 }}>{t('Focus gap {x}', { x: d.hueco })}</Txt>
                  <Txt f="s" size={13.5} color={C.nova}>{t('Focus')}</Txt>
                </Cel>
              </Pressable>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Pressable onPress={() => { setVisto(0); setVuelta(v => v + 1); }} style={{ flex: 1, height: 50, borderRadius: 25, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}>
                <Ionicons name="refresh" size={16} color={C.t2} />
                <Txt f="m" size={14.5} color={C.t2}>{t('Again')}</Txt>
              </Pressable>
              <Pressable onPress={() => { callar(); volver('/'); }} style={({ pressed }) => ({ flex: 2, height: 50, borderRadius: 25, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
                <Txt f="s" size={15.5} color={C.tinta}>{t('Start the day')}</Txt>
              </Pressable>
            </View>
          </Animated.View>
        ) : (
          <Pressable onPress={() => { callar(); setVisto(m.frases.length); }} style={{ alignSelf: 'center', marginTop: 20, paddingVertical: 8, paddingHorizontal: 14 }}>
            <Txt f="m" size={13.5} color={C.t3}>{t('Skip')}</Txt>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}
