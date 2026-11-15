/* Tu rutina: lo fijo de tu semana (trabajo, reuniones de siempre, clases, gimnasio…). Se agrega aquí o diciéndoselo a
   NOVA; cuenta como ocupado en tu agenda y en los huecos libres. Tocar un bloque lo borra (con confirmación). */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { agregarBloque, quitarBloque, TIPOS_BLOQUE, useRutina, type Bloque, type TipoBloque } from '../engine/rutina';
import { useIdioma } from '../i18n';
import { volver } from '../ui/volver';
import { C, Cel, F, MsgNova, Seccion, Txt } from '../ui/tema';

// lunes primero; los valores son los de Date.getDay()
const DIAS = [1, 2, 3, 4, 5, 6, 0];
const NOMBRE_DIA = { es: ['D', 'L', 'M', 'M', 'J', 'V', 'S'], en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'] };

export default function Rutina() {
  const ins = useSafeAreaInsets(), tr = useIdioma(), { t } = tr, { bloques } = useRutina();
  const [titulo, setTitulo] = useState(''), [tipo, setTipo] = useState<TipoBloque>('trabajo'), [dias, setDias] = useState<number[]>([1, 2, 3, 4, 5]);
  const [ini, setIni] = useState('09:00'), [fin, setFin] = useState('18:00'), [error, setError] = useState<string | null>(null);
  const agregar = () => {
    const b = agregarBloque({ titulo: titulo || t(TIPOS_BLOQUE.find(x => x.k === tipo)!.t), tipo, dias, ini, fin });
    if (!b) { setError(t('Check the days and the times (HH:MM).')); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setTitulo(''); setError(null);
  };
  const diasTxt = (d: number[]) => {
    const k = [...d].sort().join();
    if (k === '1,2,3,4,5') return t('Mon–Fri');
    if (k === '0,6') return t('Weekends');
    if (d.length === 7) return t('Every day');
    return DIAS.filter(x => d.includes(x)).map(x => new Date(2026, 9, 4 + x).toLocaleDateString(tr.locale, { weekday: 'short' })).join(' · ');
  };
  const campo = { borderRadius: 14, backgroundColor: C.s2, paddingHorizontal: 14, color: C.t1, fontFamily: F.r, fontSize: 15.5 } as const;
  const ordenados = [...bloques].sort((a, b) => a.ini.localeCompare(b.ini));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: ins.bottom + 30 }}>
        <Txt f="s" size={30} ls={-1.2} lh={34}>{t('Your routine')}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6 }}>{t('What is fixed in your week and is not on your calendar. Nova counts it as busy when it looks for free time.')}</Txt>
        <View style={{ marginTop: 14 }}>
          <MsgNova>{t('You can also just tell me: «I work Monday to Friday from 9 to 6», «on Tuesdays I have a meeting at 10», «I go to the gym at 7 on Mondays and Wednesdays».')}</MsgNova>
        </View>

        <Cel style={{ marginTop: 14, padding: 12, gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {TIPOS_BLOQUE.map(x => {
              const on = tipo === x.k;
              return (
                <Pressable key={x.k} onPress={() => { Haptics.selectionAsync().catch(() => {}); setTipo(x.k); }} style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: on ? C.lila : C.l2, backgroundColor: on ? `${C.lila}1f` : 'transparent' }}>
                  <Ionicons name={x.icono as keyof typeof Ionicons.glyphMap} size={13} color={on ? C.lila : C.t3} />
                  <Txt f="m" size={13} color={on ? C.lila : C.t2}>{t(x.t)}</Txt>
                </Pressable>
              );
            })}
          </View>
          <TextInput value={titulo} onChangeText={setTitulo} maxLength={60} placeholder={t('Name (optional): e.g. Work at AGP')} placeholderTextColor={C.t3} style={{ ...campo, height: 46 }} />
          <View style={{ flexDirection: 'row', gap: 5 }}>
            {DIAS.map(d => {
              const on = dias.includes(d);
              return (
                <Pressable key={d} onPress={() => setDias(x => (on ? x.filter(y => y !== d) : [...x, d]))} accessibilityState={{ selected: on }}
                  style={{ flex: 1, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.lila : C.s2 }}>
                  <Txt f="s" size={13.5} color={on ? C.tinta : C.t3}>{NOMBRE_DIA[tr.idioma][d]}</Txt>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TextInput value={ini} onChangeText={x => setIni(x.replace(/[^0-9:]/g, '').slice(0, 5))} keyboardType="numbers-and-punctuation" style={{ ...campo, flex: 1, minWidth: 0, height: 44, fontFamily: F.mono, textAlign: 'center' }} />
            <Txt color={C.t3}>–</Txt>
            <TextInput value={fin} onChangeText={x => setFin(x.replace(/[^0-9:]/g, '').slice(0, 5))} keyboardType="numbers-and-punctuation" style={{ ...campo, flex: 1, minWidth: 0, height: 44, fontFamily: F.mono, textAlign: 'center' }} />
          </View>
          <Pressable onPress={agregar} style={({ pressed }) => ({ height: 46, borderRadius: 23, backgroundColor: C.lila, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
            <Txt f="s" size={15} color={C.tinta}>{t('Add to my routine')}</Txt>
          </Pressable>
          {error ? <Txt size={13} color={C.alerta}>{error}</Txt> : null}
        </Cel>

        <Seccion t={t('Your week')} nota={bloques.length ? String(bloques.length) : undefined} />
        {!bloques.length ? <Txt size={14} color={C.t3} style={{ paddingHorizontal: 4 }}>{t('Nothing yet. Start with your work or study hours.')}</Txt> : (
          <View style={{ gap: 8 }}>{ordenados.map(b => <FilaBloque key={b.id} b={b} dias={diasTxt(b.dias)} />)}</View>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

function FilaBloque({ b, dias }: { b: Bloque; dias: string }) {
  const { t } = useIdioma(), [borrar, setBorrar] = useState(false);
  const tipo = TIPOS_BLOQUE.find(x => x.k === b.tipo) ?? TIPOS_BLOQUE[5];
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} layout={LinearTransition}>
      <Pressable onPress={() => setBorrar(x => !x)}>
        <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: `${C.lila}1f`, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={tipo.icono as keyof typeof Ionicons.glyphMap} size={17} color={C.lila} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt f="m" size={15.5} numberOfLines={1}>{b.titulo}</Txt>
            <Txt f="monoR" size={12.5} color={C.t2}>{b.ini}–{b.fin} · {dias}</Txt>
          </View>
          {borrar ? (
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); quitarBloque(b.id); }} style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: C.alerta, justifyContent: 'center' }}>
              <Txt f="m" size={13} color={C.alerta}>{t('Delete')}</Txt>
            </Pressable>
          ) : <Ionicons name="ellipsis-horizontal" size={17} color={C.t3} />}
        </Cel>
      </Pressable>
    </Animated.View>
  );
}
