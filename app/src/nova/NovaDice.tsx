/* Lo que NOVA dice en Today, sin tarjeta: el texto queda bajo ella y aparece palabra por palabra,
   con el ritmo de quien habla (pausas en comas y puntos). Mientras lo dice, su cuerpo ondula y se ilumina (`habla`).
   El espacio de la frase completa está reservado desde el inicio, así la pantalla no salta.
   Al terminar aparecen dos acciones discretas; tocar el texto hace que lo vuelva a decir.
   Con `voz`, además lo dice en voz alta (una vez por frase y sesión; tocar lo repite) y aparece el parlante para apagarla. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { C, Toque, Txt } from '../ui/tema';
import { cambiarFuncion, useFunciones } from '../engine/funciones';
import { useIdioma } from '../i18n';
import { callar, decir, preparar } from '../voz/decir';

// frases ya dichas en voz alta en esta sesión (no se repiten solas cada vez que se vuelve a Hoy)
const dichas = new Set<string>();

/** cada palabra ocupa su lugar desde el principio (nada salta) y se enciende cuando NOVA llega a ella */
function Palabra({ p, visible }: { p: string; visible: boolean }) {
  const o = useSharedValue(0);
  useEffect(() => { o.set(withTiming(visible ? 1 : 0, { duration: visible ? 260 : 0 })); }, [visible, o]);
  const st = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: (1 - o.value) * 3 }] }));
  return <Animated.View style={st}><Txt size={17} lh={25} ls={-0.2} color={C.t1}>{p} </Txt></Animated.View>;
}

export function NovaDice({ texto, habla, onPorQue, sinPorQue, voz }: { texto: string; habla: SharedValue<number>; onPorQue?: () => void; sinPorQue?: boolean; voz?: boolean }) {
  const palabras = useMemo(() => texto.split(/\s+/).filter(Boolean), [texto]);
  const [vuelta, setVuelta] = useState(0); // cambiarla hace que lo vuelva a decir
  const { t } = useIdioma();
  const [n, setN] = useState(0);
  const { vozHoy } = useFunciones(), conVoz = !!voz && vozHoy;
  const tocada = useRef(false);
  useEffect(() => { if (conVoz) preparar(texto); }, [texto, conVoz]);
  // en voz alta: la primera vez que aparece esta frase, o cuando se toca para oírla de nuevo
  useEffect(() => {
    if (!conVoz || (dichas.has(texto) && !tocada.current)) return;
    dichas.add(texto); tocada.current = false;
    // con la voz real de NOVA (si aún no está lista, suena apenas llega; si no hay voz, solo el texto)
    decir(texto);
    return () => { callar(); };
  }, [texto, vuelta, conVoz]);

  useEffect(() => {
    let i = 0, vivo = true, t: ReturnType<typeof setTimeout>;
    // cadencia de voz: cada palabra ~90 ms más su largo; pausa tras coma y punto
    const siguiente = () => {
      if (!vivo) return;
      i++;
      setN(i);
      if (i >= palabras.length) { habla.set(0); return; }
      const p = palabras[i - 1];
      t = setTimeout(siguiente, 70 + p.length * 14 + (/[.?!]$/.test(p) ? 320 : /[,;:]$/.test(p) ? 170 : 0));
    };
    // mientras dice: el cuerpo de NOVA late con sílabas
    const silabas = setInterval(() => { if (i < palabras.length) habla.set(0.3 + Math.random() * 0.55); }, 95);
    t = setTimeout(siguiente, 450);
    return () => { vivo = false; clearTimeout(t); clearInterval(silabas); habla.set(0); };
  }, [palabras, habla, vuelta]);

  const listo = n >= palabras.length;
  return (
    <View style={{ alignItems: 'center', marginTop: -6, paddingHorizontal: 14 }}>

      <Pressable
        onPress={() => { if (!listo) return; Haptics.selectionAsync().catch(() => {}); tocada.current = true; setN(0); setVuelta(v => v + 1); }}
        accessibilityLabel={texto}
        accessibilityHint={t('Tap to hear it again')}
        style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}
      >
        {palabras.map((p, i) => <Palabra key={i} p={p} visible={i < n} />)}
      </Pressable>

      {listo && (
        <Animated.View entering={FadeIn.duration(300)} style={{ flexDirection: 'row', gap: 26, marginTop: 14 }}>
          {sinPorQue ? null : (
            <Toque onPress={onPorQue ?? (() => router.push('/evidencia'))} label={t('Why Nova said that')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="document-text-outline" size={15} color={C.nova} />
              <Txt f="m" size={14.5} color={C.nova}>{t('Why?')}</Txt>
            </Toque>
          )}
          {voz ? (
            <Toque onPress={() => { Haptics.selectionAsync().catch(() => {}); if (vozHoy) callar(); cambiarFuncion('vozHoy', !vozHoy); }} label={t(vozHoy ? 'Mute Nova' : 'Unmute Nova')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name={vozHoy ? 'volume-high-outline' : 'volume-mute-outline'} size={15} color={vozHoy ? C.nova : C.t3} />
              <Txt f="m" size={14.5} color={vozHoy ? C.nova : C.t3}>{t(vozHoy ? 'Voice on' : 'Voice off')}</Txt>
            </Toque>
          ) : null}
          <Toque onPress={() => router.push('/nova')} label={t('Reply to Nova')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="mic-outline" size={15} color={C.nova} />
            <Txt f="m" size={14.5} color={C.nova}>{t('Reply')}</Txt>
          </Toque>
        </Animated.View>
      )}
    </View>
  );
}
