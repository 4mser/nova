/* Nueva meta del equipo: el objetivo, el plazo y 2–4 resultados clave (hito o número), cada uno con responsable. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { nuevaMeta, type ResultadoNuevo } from '../cuenta/datos';
import { useCrew } from '../cuenta/sesion';
import { fechaDe } from '../engine/diario';
import { useIdioma } from '../i18n';
import { useAhora } from '../ui/ahora';
import { AvatarMiembro } from '../ui/Crew';
import { volver } from '../ui/volver';
import { C, F, Txt } from '../ui/tema';

const PLAZOS = [{ d: 14, t: '2 weeks' }, { d: 30, t: '1 month' }, { d: 90, t: '3 months' }, { d: 180, t: '6 months' }];
type Fila = ResultadoNuevo & { k: number; metaTxt: string };

export default function NuevaMeta() {
  const ins = useSafeAreaInsets(), { t } = useIdioma(), crew = useCrew(), ahora = useAhora();
  const [titulo, setTitulo] = useState(''), [dias, setDias] = useState(30);
  const [filas, setFilas] = useState<Fila[]>([{ k: 1, titulo: '', tipo: 'hito', metaTxt: '', responsable: null }, { k: 2, titulo: '', tipo: 'hito', metaTxt: '', responsable: null }]);
  const [enviando, setEnviando] = useState(false), [error, setError] = useState<string | null>(null);
  const validas = filas.filter(f => f.titulo.trim() && (f.tipo === 'hito' || Number(f.metaTxt) > 0));
  const listo = !!crew && titulo.trim().length > 2 && validas.length > 0 && !enviando;
  const cambiar = (k: number, c: Partial<Fila>) => setFilas(x => x.map(f => (f.k === k ? { ...f, ...c } : f)));
  const guardar = async () => {
    if (!listo || !crew) return;
    setEnviando(true); setError(null);
    try {
      await nuevaMeta(crew.id, { titulo: titulo.trim(), hasta: fechaDe(ahora + dias * 864e5), resultados: validas.map(f => ({ titulo: f.titulo.trim(), tipo: f.tipo, meta: f.tipo === 'numero' ? Number(f.metaTxt) : undefined, unidad: f.unidad?.trim() || null, responsable: f.responsable })) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      volver('/crew');
    } catch (e) { setError(t((e as Error).message)); setEnviando(false); }
  };
  const campo = { height: 46, borderRadius: 14, backgroundColor: C.s2, paddingHorizontal: 12, color: C.t1, fontFamily: F.r, fontSize: 15.5 } as const;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/crew')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: ins.bottom + 30 }} keyboardShouldPersistTaps="handled">
        <Txt f="s" size={30} ls={-1.2} lh={34}>{t('New goal')}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6 }}>{t('What the crew wants to achieve, by when, and how you will know. Each key result has an owner.')}</Txt>

        <Txt f="m" size={13} color={C.t2} style={{ marginTop: 20, marginBottom: 8 }}>{t('Objective')}</Txt>
        <TextInput value={titulo} onChangeText={setTitulo} maxLength={120} placeholder={t('e.g. Win NASA Space Apps')} placeholderTextColor={C.t3} style={{ ...campo, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, height: 52, fontSize: 16.5 }} />

        <Txt f="m" size={13} color={C.t2} style={{ marginTop: 18, marginBottom: 8 }}>{t('Deadline')}</Txt>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {PLAZOS.map(p => (
            <Pressable key={p.d} onPress={() => setDias(p.d)} style={{ flex: 1, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: dias === p.d ? C.nova : C.s1, borderWidth: 1, borderColor: dias === p.d ? C.nova : C.l1 }}>
              <Txt f="s" size={13} color={dias === p.d ? C.tinta : C.t2}>{t(p.t)}</Txt>
            </Pressable>
          ))}
        </View>

        <Txt f="m" size={13} color={C.t2} style={{ marginTop: 18, marginBottom: 8 }}>{t('Key results')}</Txt>
        <View style={{ gap: 10 }}>
          {filas.map((f, i) => (
            <View key={f.k} style={{ padding: 12, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Txt f="mono" size={12} color={C.t3}>{i + 1}</Txt>
                <TextInput value={f.titulo} onChangeText={x => cambiar(f.k, { titulo: x })} maxLength={140} placeholder={i === 0 ? t('e.g. Working sensor prototype') : t('Another key result')} placeholderTextColor={C.t3} style={{ ...campo, flex: 1 }} />
                {filas.length > 1 ? <Pressable onPress={() => setFilas(x => x.filter(y => y.k !== f.k))} hitSlop={8}><Ionicons name="close-circle" size={20} color={C.t3} /></Pressable> : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {(['hito', 'numero'] as const).map(tp => (
                  <Pressable key={tp} onPress={() => cambiar(f.k, { tipo: tp })} style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', borderWidth: 1, borderColor: f.tipo === tp ? C.nova : C.l2, backgroundColor: f.tipo === tp ? C.sigSuave : 'transparent' }}>
                    <Txt f="m" size={12.5} color={f.tipo === tp ? C.nova : C.t2}>{t(tp === 'hito' ? 'Milestone' : 'Number')}</Txt>
                  </Pressable>
                ))}
                {f.tipo === 'numero' ? (
                  <>
                    <TextInput value={f.metaTxt} onChangeText={x => cambiar(f.k, { metaTxt: x.replace(/[^0-9.]/g, '') })} keyboardType="numeric" placeholder={t('Goal')} placeholderTextColor={C.t3} style={{ ...campo, width: 70, height: 36 }} />
                    <TextInput value={f.unidad ?? ''} onChangeText={x => cambiar(f.k, { unidad: x })} maxLength={20} placeholder={t('unit')} placeholderTextColor={C.t3} style={{ ...campo, flex: 1, height: 36 }} />
                  </>
                ) : null}
              </View>
              {crew ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Txt size={12.5} color={C.t3}>{t('Owner')}</Txt>
                  {crew.miembros.map(m => {
                    const on = f.responsable === m.id;
                    return (
                      <Pressable key={m.id} onPress={() => cambiar(f.k, { responsable: on ? null : m.id })} accessibilityLabel={m.nombre} style={{ opacity: on || !f.responsable ? 1 : 0.4 }}>
                        <AvatarMiembro u={m} size={30} anillo={on ? C.nova : undefined} />
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ))}
        </View>
        {filas.length < 6 ? (
          <Pressable onPress={() => setFilas(x => [...x, { k: Date.now(), titulo: '', tipo: 'hito', metaTxt: '', responsable: null }])} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, alignSelf: 'flex-start', height: 36, paddingHorizontal: 12 }}>
            <Ionicons name="add" size={17} color={C.nova} />
            <Txt f="m" size={14} color={C.nova}>{t('Add key result')}</Txt>
          </Pressable>
        ) : null}
        {error ? <Txt size={13.5} color={C.alerta} style={{ marginTop: 10 }}>{error}</Txt> : null}
        <Pressable onPress={guardar} disabled={!listo} style={({ pressed }) => ({ marginTop: 22, height: 54, borderRadius: 27, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', opacity: listo ? (pressed ? 0.85 : 1) : 0.4 })}>
          {enviando ? <ActivityIndicator color={C.tinta} /> : <Txt f="s" size={16} color={C.tinta}>{t('Create goal')}</Txt>}
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}
