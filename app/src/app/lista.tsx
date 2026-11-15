/* Una lista: arriba se agregan cosas (varias a la vez separadas por coma), un toque marca o desmarca, mantener
   apretado borra. Lo marcado baja; «Limpiar marcados» lo saca. Si es de la crew, se ve quién agregó cada cosa y los
   cambios llegan en vivo. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { agregarItems, borrarItem, borrarLista, limpiarLista, marcarItem, useListas, type ItemLista } from '../cuenta/datos';
import { useCrew, useSesion } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { AvatarMiembro } from '../ui/Crew';
import { volver } from '../ui/volver';
import { C, Cel, F, Txt } from '../ui/tema';
import { colorLista } from '../ui/listas';

export default function Lista() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ins = useSafeAreaInsets(), { t } = useIdioma(), { datos } = useListas(), crew = useCrew(), { usuario } = useSesion();
  const l = datos?.find(x => x.id === id);
  const [nuevo, setNuevo] = useState(''), [borrar, setBorrar] = useState(false);
  if (!l) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  const col = colorLista(l.icono);
  const pendientes = l.items.filter(i => !i.hecho), hechos = l.items.filter(i => i.hecho);
  const agregar = () => {
    const textos = nuevo.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
    if (!textos.length) return;
    Haptics.selectionAsync().catch(() => {});
    setNuevo('');
    agregarItems(l.id, textos).catch(() => setNuevo(textos.join(', ')));
  };
  const fila = (i: ItemLista, k: number) => {
    const autor = l.crew ? crew?.miembros.find(m => m.id === i.por) : undefined;
    return (
      <Animated.View key={i.id} entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} layout={LinearTransition.duration(220)}>
        <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); marcarItem(l.id, i.id, !i.hecho); }} onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); borrarItem(l.id, i.id); }} delayLongPress={450}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: k ? 1 : 0, borderTopColor: C.l1 }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: i.hecho ? 0 : 1.5, borderColor: C.l2, backgroundColor: i.hecho ? col : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            {i.hecho ? <Ionicons name="checkmark" size={15} color={C.tinta} /> : null}
          </View>
          <Txt size={15.5} color={i.hecho ? C.t3 : C.t1} style={{ flex: 1, textDecorationLine: i.hecho ? 'line-through' : 'none' }}>{i.texto}</Txt>
          {autor && autor.id !== usuario?.id ? <AvatarMiembro u={autor} size={22} /> : null}
        </Pressable>
      </Animated.View>
    );
  };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: ins.bottom + 30 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: `${col}1f`, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={(l.icono ?? 'list-outline') as keyof typeof Ionicons.glyphMap} size={22} color={col} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt f="s" size={26} ls={-0.8} numberOfLines={1}>{l.nombre}</Txt>
            <Txt size={13} color={l.crew ? C.lila : C.t3}>{l.crew ? t('Shared with {crew}', { crew: crew?.nombre ?? '' }) : t('Only you')} · {t('{n} left', { n: pendientes.length })}</Txt>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
          <TextInput value={nuevo} onChangeText={setNuevo} onSubmitEditing={agregar} returnKeyType="done" blurOnSubmit={false} placeholder={t('Add (several with commas)')} placeholderTextColor={C.t3}
            style={{ flex: 1, height: 48, borderRadius: 16, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, paddingHorizontal: 14, color: C.t1, fontFamily: F.r, fontSize: 15.5 }} />
          <Pressable onPress={agregar} disabled={!nuevo.trim()} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: col, alignItems: 'center', justifyContent: 'center', opacity: nuevo.trim() ? 1 : 0.4 }}>
            <Ionicons name="add" size={22} color={C.tinta} />
          </Pressable>
        </View>

        <Cel style={{ marginTop: 12, paddingVertical: 2 }}>
          {!l.items.length ? <Txt size={14} color={C.t3} style={{ paddingVertical: 14 }}>{t('Empty. Add the first thing above, or tell Nova.')}</Txt> : null}
          {pendientes.map(fila)}
          {hechos.map((i, k) => fila(i, pendientes.length + k))}
        </Cel>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingHorizontal: 4 }}>
          {hechos.length ? (
            <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); limpiarLista(l.id).catch(() => {}); }} hitSlop={8}><Txt f="m" size={13.5} color={C.t2}>{t('Clear checked ({n})', { n: hechos.length })}</Txt></Pressable>
          ) : <View />}
          <Pressable onPress={() => { if (!borrar) { setBorrar(true); return; } borrarLista(l.id).catch(() => {}); volver('/'); }} hitSlop={8}>
            <Txt f="m" size={13.5} color={C.alerta}>{borrar ? t('Tap again to delete it') : t('Delete list')}</Txt>
          </Pressable>
        </View>
        <Txt size={12} color={C.t3} style={{ marginTop: 10, paddingHorizontal: 4 }}>{t('Tap to check · hold to delete')}</Txt>
      </KeyboardAwareScrollView>
    </View>
  );
}
