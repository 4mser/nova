/* Tus listas: compras, ideas, libros, películas… Cada una con cuántas cosas quedan; las de la crew lo dicen.
   Arriba se crea una nueva (con atajos de nombre e ícono y si es para la crew). NOVA también las maneja por voz:
   «agrega leche y pan a la lista de compras». */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { crearLista, useListas } from '../cuenta/datos';
import { useCrew } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { Interruptor } from '../ui/Interruptor';
import { volver } from '../ui/volver';
import { colorLista, PLANTILLAS } from '../ui/listas';
import { C, Cel, F, Seccion, Txt } from '../ui/tema';

export default function Listas() {
  const ins = useSafeAreaInsets(), { t } = useIdioma(), crew = useCrew(), { datos: listas, cargando } = useListas();
  const [nombre, setNombre] = useState(''), [icono, setIcono] = useState('list-outline'), [paraCrew, setParaCrew] = useState(false), [creando, setCreando] = useState(false);
  const crear = async () => {
    if (!nombre.trim() || creando) return;
    setCreando(true);
    try { const l = await crearLista(nombre.trim(), icono, paraCrew && crew ? crew.id : null); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); setNombre(''); router.push({ pathname: '/lista', params: { id: l.id } }); }
    finally { setCreando(false); }
  };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: ins.bottom + 30 }}>
        <Txt f="s" size={30} ls={-1.2} lh={34}>{t('Lists')}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6 }}>{t('Groceries, ideas, books… yours or shared with your crew. Tell Nova «add milk to groceries».')}</Txt>

        {cargando && !listas ? <ActivityIndicator color={C.nova} style={{ marginTop: 20 }} /> : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
            {(listas ?? []).map(l => {
              const quedan = l.items.filter(i => !i.hecho).length, col = colorLista(l.icono);
              return (
                <Animated.View key={l.id} entering={FadeIn.duration(220)} style={{ width: '48.5%' }}>
                  <Pressable onPress={() => router.push({ pathname: '/lista', params: { id: l.id } })} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
                    <Cel style={{ padding: 14, gap: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: `${col}1f`, alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name={(l.icono ?? 'list-outline') as keyof typeof Ionicons.glyphMap} size={17} color={col} />
                        </View>
                        <View style={{ flex: 1 }} />
                        {l.crew ? <Ionicons name="people" size={14} color={C.lila} /> : null}
                      </View>
                      <View>
                        <Txt f="s" size={15} numberOfLines={1}>{l.nombre}</Txt>
                        <Txt size={12.5} color={C.t3}>{quedan ? t('{n} left', { n: quedan }) : l.items.length ? t('All done') : t('Empty')}</Txt>
                      </View>
                    </Cel>
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
        )}

        <Seccion t={t('New list')} />
        <Cel style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {PLANTILLAS.map(p => (
              <Pressable key={p.n} onPress={() => { Haptics.selectionAsync().catch(() => {}); setNombre(t(p.n)); setIcono(p.i); }} style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: icono === p.i ? p.c : C.l2, backgroundColor: icono === p.i ? `${p.c}1f` : 'transparent' }}>
                <Ionicons name={p.i as keyof typeof Ionicons.glyphMap} size={14} color={icono === p.i ? p.c : C.t3} />
                <Txt f="m" size={12.5} color={icono === p.i ? p.c : C.t2}>{t(p.n)}</Txt>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={nombre} onChangeText={setNombre} onSubmitEditing={crear} returnKeyType="done" maxLength={40} placeholder={t('List name')} placeholderTextColor={C.t3}
              style={{ flex: 1, height: 46, borderRadius: 14, backgroundColor: C.s2, paddingHorizontal: 14, color: C.t1, fontFamily: F.r, fontSize: 15.5 }} />
            <Pressable onPress={crear} disabled={!nombre.trim()} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', opacity: nombre.trim() ? 1 : 0.4 }}>
              {creando ? <ActivityIndicator color={C.tinta} /> : <Ionicons name="add" size={22} color={C.tinta} />}
            </Pressable>
          </View>
          {crew ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name="people-outline" size={17} color={C.lila} />
              <Txt size={14} style={{ flex: 1 }}>{t('Shared with {crew}', { crew: crew.nombre })}</Txt>
              <Interruptor on={paraCrew} label={t('Shared with {crew}', { crew: crew.nombre })} onChange={setParaCrew} />
            </View>
          ) : null}
        </Cel>
      </KeyboardAwareScrollView>
    </View>
  );
}
