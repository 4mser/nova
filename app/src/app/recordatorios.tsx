/* Tus recordatorios: los que le pediste a NOVA y los que agregas aquí. Arriba, agregar uno con atajos de hora; abajo,
   los que vienen por día (posponer o borrar) y los de hoy que ya pasaron. Si los avisos están apagados, lo dice. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Platform, Pressable, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { configurarAvisos } from '../cuenta/momento';
import { fechaDe } from '../engine/diario';
import { borrarRecordatorio, crearRecordatorio, moverRecordatorio, reprogramarSinAviso, useRecordatoriosPropios, type Recordatorio } from '../engine/recordatoriosPropios';
import { useIdioma } from '../i18n';
import { cuandoDe } from '../voz/acciones';
import { useAhora } from '../ui/ahora';
import { volver } from '../ui/volver';
import { C, Cel, F, Seccion, Txt } from '../ui/tema';

export default function Recordatorios() {
  const ins = useSafeAreaInsets(), tr = useIdioma(), { t, locale } = tr, ahora = useAhora(30e3);
  const { lista } = useRecordatoriosPropios();
  const [texto, setTexto] = useState(''), [hora, setHora] = useState(''), [elegido, setElegido] = useState<number | null>(null);
  const [avisos, setAvisos] = useState<boolean | null>(Platform.OS === 'web' ? true : null);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const leer = () => Notifications.getPermissionsAsync().then(p => { setAvisos(p.granted); if (p.granted) reprogramarSinAviso(t('Reminder')); }, () => {});
    leer();
    const s = AppState.addEventListener('change', e => { if (e === 'active') leer(); });
    return () => s.remove();
  }, [t]);

  const hm = (h: number, m = 0) => { const d = new Date(ahora); d.setHours(h, m, 0, 0); if (d.getTime() <= ahora) d.setDate(d.getDate() + 1); return d.getTime(); };
  const atajos = [
    { k: t('In 30 min'), v: ahora + 30 * 60e3 }, { k: t('In 1 hour'), v: ahora + 60 * 60e3 },
    { k: new Date(ahora).getHours() < 18 ? t('Today 18:00') : t('Tonight 21:00'), v: new Date(ahora).getHours() < 18 ? hm(18) : hm(21) },
    { k: t('Tomorrow 9:00'), v: (() => { const d = new Date(ahora); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); })() },
  ];
  const cuando = hora.trim() ? cuandoDe(hora, undefined, ahora) : elegido;
  const listo = texto.trim().length > 1 && !!cuando;
  const agregar = async () => {
    if (!listo || !cuando) return;
    await configurarAvisos().catch(() => {});
    await crearRecordatorio(texto, cuando, 'tu', t('Reminder'));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setTexto(''); setHora(''); setElegido(null);
  };
  const cuandoTxt = (ts: number) => {
    const h = new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
    const f = fechaDe(ts);
    return f === fechaDe(ahora) ? t('Today {h}', { h }) : f === fechaDe(ahora + 864e5) ? t('Tomorrow {h}', { h }) : `${new Date(ts).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })} · ${h}`;
  };
  const vienen = lista.filter(r => r.cuando > ahora && !r.hecho), pasaron = lista.filter(r => r.cuando <= ahora || r.hecho).reverse();
  const campo = { borderRadius: 14, backgroundColor: C.s2, paddingHorizontal: 14, color: C.t1, fontFamily: F.r, fontSize: 15.5 } as const;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: ins.bottom + 30 }}>
        <Txt f="s" size={30} ls={-1.2} lh={34}>{t('Reminders')}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6 }}>{t('The ones you ask Nova for and the ones you add here. Say «remind me at 6 to…» anytime.')}</Txt>

        {avisos === false ? (
          <Pressable onPress={() => router.push('/permisos')}>
            <Cel style={{ marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: `${C.aviso}55` }}>
              <Ionicons name="notifications-off-outline" size={20} color={C.aviso} />
              <Txt size={14} lh={19} style={{ flex: 1 }}>{t('Notifications are off: your reminders are saved but will not ring. Tap to turn them on.')}</Txt>
              <Ionicons name="chevron-forward" size={17} color={C.t3} />
            </Cel>
          </Pressable>
        ) : null}

        {/* agregar */}
        <Cel style={{ marginTop: 16, padding: 12, gap: 10 }}>
          <TextInput value={texto} onChangeText={setTexto} maxLength={140} placeholder={t('What should I remind you?')} placeholderTextColor={C.t3} style={{ ...campo, height: 48 }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {atajos.map(a => {
              const on = !hora.trim() && elegido === a.v;
              return (
                <Pressable key={a.k} onPress={() => { Haptics.selectionAsync().catch(() => {}); setHora(''); setElegido(a.v); }} style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, justifyContent: 'center', borderWidth: 1, borderColor: on ? C.nova : C.l2, backgroundColor: on ? C.sigSuave : 'transparent' }}>
                  <Txt f="m" size={13} color={on ? C.nova : C.t2}>{a.k}</Txt>
                </Pressable>
              );
            })}
            <TextInput value={hora} onChangeText={x => { setHora(x.replace(/[^0-9:.]/g, '').slice(0, 5)); setElegido(null); }} placeholder="HH:MM" placeholderTextColor={C.t3} keyboardType="numbers-and-punctuation"
              style={{ ...campo, height: 34, width: 84, borderRadius: 17, fontFamily: F.mono, fontSize: 14, textAlign: 'center', borderWidth: 1, borderColor: hora.trim() ? C.nova : C.l2 }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Txt size={13} color={cuando ? C.t2 : C.t3} style={{ flex: 1 }}>{cuando ? cuandoTxt(cuando) : hora.trim() ? t('Write the time as 18:30') : t('Choose when')}</Txt>
            <Pressable onPress={agregar} disabled={!listo} style={{ height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', opacity: listo ? 1 : 0.4 }}>
              <Txt f="s" size={14.5} color={C.tinta}>{t('Add')}</Txt>
            </Pressable>
          </View>
        </Cel>

        <Seccion t={t('Coming up')} nota={vienen.length ? String(vienen.length) : undefined} />
        {!vienen.length ? <Txt size={14} color={C.t3} style={{ paddingHorizontal: 4 }}>{t('No reminders coming up.')}</Txt> : (
          <View style={{ gap: 8 }}>
            {vienen.map(r => <FilaRecordatorio key={r.id} r={r} cuando={cuandoTxt(r.cuando)} ahora={ahora} />)}
          </View>
        )}
        {pasaron.length ? (
          <>
            <Seccion t={t('Earlier')} />
            <View style={{ gap: 8, opacity: 0.6 }}>{pasaron.map(r => <FilaRecordatorio key={r.id} r={r} cuando={cuandoTxt(r.cuando)} ahora={ahora} pasado />)}</View>
          </>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

function FilaRecordatorio({ r, cuando, ahora, pasado }: { r: Recordatorio; cuando: string; ahora: number; pasado?: boolean }) {
  const { t } = useIdioma();
  const [abierto, setAbierto] = useState(false);
  const mover = (ms: number) => { Haptics.selectionAsync().catch(() => {}); moverRecordatorio(r.id, Math.max(ahora, r.cuando) + ms, t('Reminder')); setAbierto(false); };
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} layout={LinearTransition}>
      <Pressable onPress={() => setAbierto(a => !a)}>
        <Cel style={{ padding: 14, gap: abierto ? 12 : 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: pasado ? C.s2 : C.sigSuave, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={pasado ? 'checkmark' : 'alarm-outline'} size={18} color={pasado ? C.t3 : C.nova} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt f="m" size={15.5} numberOfLines={2}>{r.texto}</Txt>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <Txt f="monoR" size={12.5} color={C.t2}>{cuando}</Txt>
                {r.de === 'nova' ? <Txt size={12} color={C.lila}>· {t('asked to Nova')}</Txt> : null}
                {!pasado && !r.notif && Platform.OS !== 'web' ? <Ionicons name="notifications-off-outline" size={13} color={C.aviso} /> : null}
              </View>
            </View>
            <Ionicons name={abierto ? 'chevron-up' : 'ellipsis-horizontal'} size={17} color={C.t3} />
          </View>
          {abierto ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {pasado ? null : <Boton t={t('+10 min')} onPress={() => mover(10 * 60e3)} />}
              <Boton t={pasado ? t('Again in 1 hour') : t('+1 hour')} onPress={() => mover(60 * 60e3)} />
              {pasado ? null : <Boton t={t('Tomorrow')} onPress={() => mover(864e5)} />}
              <Boton t={t('Delete')} peligro onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); borrarRecordatorio(r.id); }} />
            </View>
          ) : null}
        </Cel>
      </Pressable>
    </Animated.View>
  );
}
const Boton = ({ t, onPress, peligro }: { t: string; onPress: () => void; peligro?: boolean }) => (
  <Pressable onPress={onPress} style={{ height: 34, paddingHorizontal: 13, borderRadius: 17, justifyContent: 'center', borderWidth: 1, borderColor: peligro ? C.alerta : C.l2 }}>
    <Txt f="m" size={13} color={peligro ? C.alerta : C.t1}>{t}</Txt>
  </Pressable>
);
