/* Elegir hábitos: los tuyos (con lo de hoy, sus últimos 14 días y tocar para abrir su ficha), sugerencias con meta y
   recordatorios ya puestos, y uno propio (al crearlo se abre su ficha para ajustar meta, días y avisos). */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { fechaDe } from '../engine/diario';
import { agregarHabito, COLORES_HABITO, cuentaDe, hecho, MAX_HABITOS, metaDe, racha, SUGERIDOS, TIPOS_HABITO, useHabitos, type TipoHabito } from '../engine/habitos';
import { useIdioma } from '../i18n';
import { useAhora } from '../ui/ahora';
import { volver } from '../ui/volver';
import { C, Cel, F, Seccion, Txt } from '../ui/tema';

export default function Habitos() {
  const ins = useSafeAreaInsets(), { t } = useIdioma(), { habitos, marcas, cuentas } = useHabitos();
  const [propio, setPropio] = useState(''), [tipo, setTipo] = useState<TipoHabito>('si');
  // uno propio: con el tipo elegido y un color que no se repita; después se ajusta todo en su ficha
  const crear = () => {
    const nombre = propio.trim();
    if (!nombre) return;
    Haptics.selectionAsync().catch(() => {});
    const color = COLORES_HABITO.find(c => !habitos.some(h => h.color === c)) ?? C.nova;
    const icono = tipo === 'evitar' ? 'ban-outline' : tipo === 'tiempo' ? 'timer-outline' : tipo === 'contar' ? 'add-circle-outline' : 'star-outline';
    const n = agregarHabito({ nombre, icono, color, tipo, ...(tipo === 'contar' ? { meta: 5, paso: 1 } : tipo === 'tiempo' ? { meta: 20, paso: 5, unidad: 'min' } : {}) });
    setPropio('');
    if (n) router.push({ pathname: '/habito', params: { id: n.id } });
  };
  const lleno = habitos.length >= MAX_HABITOS;
  const sugeridos = SUGERIDOS.filter(s => !habitos.some(h => h.nombre === s.nombre));
  const sumar = (h: (typeof SUGERIDOS)[number]) => { if (lleno) return; Haptics.selectionAsync().catch(() => {}); agregarHabito(h); };
  const ahora = useAhora(), dias = Array.from({ length: 14 }, (_, i) => fechaDe(ahora - (13 - i) * 864e5));
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: ins.bottom + 30 }} keyboardShouldPersistTaps="handled">
        <Txt f="s" size={30} ls={-1.2} lh={34}>{t('Habits')}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6 }}>{t('Count (glasses, pages), time it, avoid something or just yes/no. Tap one to see its history and adjust it.')}</Txt>

        {habitos.length ? (
          <>
            <Seccion t={t('Yours')} nota={`${habitos.length}/${MAX_HABITOS}`} />
            <Cel style={{ paddingVertical: 4 }}>
              {habitos.map((h, i) => (
                <Animated.View key={h.id} entering={FadeIn} exiting={FadeOut} layout={LinearTransition} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
                  <Pressable onPress={() => router.push({ pathname: '/habito', params: { id: h.id } })} style={({ pressed }) => ({ paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Ionicons name={h.icono as keyof typeof Ionicons.glyphMap} size={18} color={h.color} />
                    <View style={{ flex: 1 }}>
                      <Txt size={15}>{t(h.nombre)}</Txt>
                      <Txt f="monoR" size={12} color={C.t3}>{metaDe(h) > 1 ? `${cuentaDe(h, fechaDe(ahora), marcas, cuentas)}/${metaDe(h)} ${h.unidad ? t(h.unidad) : ''} · ` : ''}{t('streak {n}', { n: racha(marcas, h.id) })}{h.recordar?.length ? ` · ${t('{n} reminders', { n: h.recordar.length })}` : ''}</Txt>
                    </View>
                    <Ionicons name="chevron-forward" size={17} color={C.t3} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 4, marginTop: 10, marginLeft: 30 }}>
                    {dias.map(f => <View key={f} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: hecho(marcas, h.id, f) ? h.color : 'rgba(255,255,255,0.07)' }} />)}
                  </View>
                  </Pressable>
                </Animated.View>
              ))}
            </Cel>
            <Txt size={12} color={C.t3} style={{ marginTop: 8, paddingHorizontal: 4 }}>{t('Last 14 days.')}</Txt>
          </>
        ) : null}

        {sugeridos.length && !lleno ? (
          <>
            <Seccion t={t('Ideas')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {sugeridos.map(s => (
                <Pressable key={s.nombre} onPress={() => sumar(s)} accessibilityRole="button" accessibilityLabel={t('Add {x}', { x: t(s.nombre) })}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, paddingHorizontal: 14, borderRadius: 21, borderWidth: 1, borderColor: C.l2, backgroundColor: pressed ? C.s2 : C.s1 })}>
                  <Ionicons name={s.icono as keyof typeof Ionicons.glyphMap} size={16} color={s.color} />
                  <Txt size={14.5}>{t(s.nombre)}</Txt>
                  {s.meta && s.meta > 1 ? <Txt f="monoR" size={12} color={C.t3}>{s.meta} {s.unidad ? t(s.unidad) : ''}</Txt> : null}
                  <Ionicons name="add" size={16} color={C.t3} />
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {!lleno ? (
          <>
            <Seccion t={t('Your own')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {TIPOS_HABITO.map(x => (
                <Pressable key={x.k} onPress={() => setTipo(x.k)} style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: tipo === x.k ? C.nova : C.l2, backgroundColor: tipo === x.k ? C.sigSuave : 'transparent' }}>
                  <Ionicons name={x.i as keyof typeof Ionicons.glyphMap} size={13} color={tipo === x.k ? C.nova : C.t3} />
                  <Txt f="m" size={12.5} color={tipo === x.k ? C.nova : C.t2}>{t(x.t)}</Txt>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput value={propio} onChangeText={setPropio} placeholder={t(tipo === 'evitar' ? 'e.g. No sugar' : tipo === 'tiempo' ? 'e.g. Practise guitar' : tipo === 'contar' ? 'e.g. Push-ups' : 'e.g. Make the bed')} placeholderTextColor={C.t3} maxLength={40} returnKeyType="done"
                onSubmitEditing={crear}
                style={{ flex: 1, height: 48, borderRadius: 16, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, paddingHorizontal: 14, color: C.t1, fontFamily: F.r, fontSize: 16 }} />
              <Pressable onPress={crear} disabled={!propio.trim()} accessibilityLabel={t('Add')}
                style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', opacity: propio.trim() ? 1 : 0.4 }}>
                <Ionicons name="add" size={22} color={C.tinta} />
              </Pressable>
            </View>
          </>
        ) : null}

        {habitos.length ? (
          <Pressable onPress={() => volver('/')} style={({ pressed }) => ({ marginTop: 28, height: 52, borderRadius: 26, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
            <Txt f="s" size={16} color={C.tinta}>{t('Done')}</Txt>
          </Pressable>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}
