/* La ficha de un hábito: el anillo de hoy con − y + (y atajos por paso), la racha, la mejor racha, el % de los
   últimos 30 días y 12 semanas en un mapa de calor. Abajo se ajusta: meta del día y unidad, qué días toca y a qué
   horas avisar (con atajo «cada 2 h»). */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { configurarAvisos } from '../cuenta/momento';
import { fechaDe } from '../engine/diario';
import { COLORES_HABITO, cronometro, cuentaDe, diasSin, editarHabito, estadisticas, ICONOS_HABITO, metaDe, TIPOS_HABITO, pasoDe, quitarHabito, racha, sumar, tipoDe, tocaEl, useHabitos } from '../engine/habitos';
import { useIdioma } from '../i18n';
import { useAhora } from '../ui/ahora';
import { Anillo } from '../ui/Habitos';
import { volver } from '../ui/volver';
import { C, Cel, F, Seccion, Txt } from '../ui/tema';

const DIAS = [1, 2, 3, 4, 5, 6, 0];
const LETRA = { es: ['D', 'L', 'M', 'M', 'J', 'V', 'S'], en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'] };

export default function Habito() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ins = useSafeAreaInsets(), tr = useIdioma(), { t } = tr, ahora = useAhora(1000), hoy = fechaDe(ahora);
  const { habitos, marcas, cuentas } = useHabitos();
  const h = habitos.find(x => x.id === id);
  const [hora, setHora] = useState(''), [borrar, setBorrar] = useState(false), [nombre, setNombre] = useState(h ? t(h.nombre) : '');
  if (!h) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  const tipo = tipoDe(h), corre = !!h.corriendo, enCurso = corre ? Math.floor((ahora - h.corriendo!) / 1e3) : 0;
  const meta = metaDe(h), paso = pasoDe(h), v = cuentaDe(h, hoy, marcas, cuentas), ok = tipo === 'evitar' ? v === 0 : v >= meta;
  const st = estadisticas(h, marcas, ahora), n = racha(marcas, h.id, ahora);
  const unidad = h.unidad ? t(h.unidad) : '';
  const tocar = (k: number) => { const listo = sumar(h.id, k); if (listo && !ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); else Haptics.selectionAsync().catch(() => {}); };
  // 12 semanas: columnas de lunes a domingo, la última termina hoy
  const lunes = new Date(ahora); lunes.setHours(12, 0, 0, 0); lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7) - 11 * 7);
  const semanas = Array.from({ length: 12 }, (_, w) => Array.from({ length: 7 }, (_, d) => lunes.getTime() + (w * 7 + d) * 864e5));
  const recordar = h.recordar ?? [];
  const ponerRecordar = async (l: string[]) => { await configurarAvisos().catch(() => {}); editarHabito(h.id, { recordar: [...new Set(l)].sort() }); };
  const campo = { borderRadius: 14, backgroundColor: C.s2, paddingHorizontal: 12, color: C.t1, fontFamily: F.mono, fontSize: 15 } as const;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: ins.bottom + 30 }}>
        <Txt f="s" size={28} ls={-1} lh={32}>{t(h.nombre)}</Txt>
        <Txt size={14} color={C.t2} style={{ marginTop: 4 }}>{tipo === 'evitar' ? t('Something to avoid') : meta > 1 ? t('Goal: {n} {u} a day', { n: meta, u: unidad }) : t('Once a day')}{h.dias?.length && h.dias.length < 7 ? ` · ${DIAS.filter(d => h.dias!.includes(d)).map(d => LETRA[tr.idioma][d]).join(' ')}` : ''}</Txt>

        {/* hoy: cada tipo con su control */}
        <View style={{ alignItems: 'center', marginTop: 20 }}>
          <Anillo v={tipo === 'evitar' ? (ok ? 1 : 0) : v / meta} color={corre ? C.nova : h.color} size={190} grosor={14}>
            <Ionicons name={(tipo === 'evitar' ? (ok ? 'shield-checkmark' : 'refresh') : corre ? 'timer' : ok ? 'checkmark-circle' : h.icono) as keyof typeof Ionicons.glyphMap} size={26} color={corre ? C.nova : h.color} />
            <Txt f="s" size={40} ls={-1.5} style={{ marginTop: 2 }}>{tipo === 'evitar' ? diasSin(h, ahora) : corre ? `${Math.floor(enCurso / 60)}:${String(enCurso % 60).padStart(2, '0')}` : meta > 1 ? v : ok ? '✓' : '0'}</Txt>
            <Txt size={13} color={C.t3}>{tipo === 'evitar' ? t('days without') : corre ? t('{v} of {n} min today', { v, n: meta }) : meta > 1 ? t('of {n} {u}', { n: meta, u: unidad }) : ''}</Txt>
          </Anillo>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18 }}>
            {tipo === 'evitar' ? (
              <>
                {v ? <Pressable onPress={() => tocar(-1)} style={{ height: 52, paddingHorizontal: 18, borderRadius: 26, borderWidth: 1, borderColor: C.l2, justifyContent: 'center' }}><Txt f="m" size={14} color={C.t2}>{t('Undo')}</Txt></Pressable> : null}
                <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}); sumar(h.id, 1); }} style={({ pressed }) => ({ height: 56, paddingHorizontal: 24, borderRadius: 28, borderWidth: 1, borderColor: C.alerta, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
                  <Txt f="s" size={15} color={C.alerta}>{t('I slipped today')}</Txt>
                </Pressable>
              </>
            ) : tipo === 'tiempo' ? (
              <>
                <Pressable onPress={() => tocar(-5)} disabled={!v} accessibilityLabel={t('Less')} style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center', opacity: v ? 1 : 0.35 }}>
                  <Txt f="m" size={13} color={C.t1}>−5</Txt>
                </Pressable>
                <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); cronometro(h.id); }} style={({ pressed }) => ({ height: 56, paddingHorizontal: 26, borderRadius: 28, backgroundColor: corre ? C.nova : h.color, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: pressed ? 0.85 : 1 })}>
                  <Ionicons name={corre ? 'pause' : 'play'} size={20} color={C.tinta} />
                  <Txt f="s" size={16} color={C.tinta}>{corre ? t('Stop and save') : t('Start')}</Txt>
                </Pressable>
                <Pressable onPress={() => tocar(5)} accessibilityLabel={t('Add')} style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt f="m" size={13} color={C.t1}>+5</Txt>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable onPress={() => tocar(meta > 1 ? -paso : -v)} disabled={!v} accessibilityLabel={t('Less')} style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center', opacity: v ? 1 : 0.35 }}>
                  <Ionicons name="remove" size={22} color={C.t1} />
                </Pressable>
                <Pressable onPress={() => tocar(meta > 1 ? paso : ok ? 0 : 1)} accessibilityLabel={t('Add')} style={({ pressed }) => ({ height: 56, paddingHorizontal: 26, borderRadius: 28, backgroundColor: h.color, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: pressed ? 0.85 : 1 })}>
                  <Ionicons name="add" size={22} color={C.tinta} />
                  <Txt f="s" size={16} color={C.tinta}>{meta > 1 ? `${paso}` : ok ? t('Done today') : t('Mark done')}</Txt>
                </Pressable>
              </>
            )}
          </View>
        </View>

        {/* números */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 22 }}>
          {[{ k: t('Streak'), v: `${n}`, c: n >= 3 ? C.aviso : C.t1, i: 'flame' }, { k: t('Best'), v: `${st.mejor}`, c: C.t1, i: 'trophy-outline' }, { k: t('30 days'), v: `${Math.round(st.pct * 100)}%`, c: C.t1, i: 'stats-chart-outline' }].map(x => (
            <Cel key={x.k} style={{ flex: 1, padding: 12, gap: 4 }}>
              <Ionicons name={x.i as keyof typeof Ionicons.glyphMap} size={15} color={C.t3} />
              <Txt f="s" size={22} color={x.c}>{x.v}</Txt>
              <Txt size={12} color={C.t3}>{x.k}</Txt>
            </Cel>
          ))}
        </View>

        {/* 12 semanas */}
        <Seccion t={t('Last 12 weeks')} />
        <Cel style={{ padding: 12 }}>
          <View style={{ flexDirection: 'row', gap: 3 }}>
            <View style={{ gap: 3, marginRight: 4 }}>{DIAS.map(d => <View key={d} style={{ height: 14, justifyContent: 'center' }}><Txt f="monoR" size={9} color={C.t3}>{LETRA[tr.idioma][d]}</Txt></View>)}</View>
            {semanas.map((s, w) => (
              <View key={w} style={{ flex: 1, gap: 3 }}>
                {s.map(ts => {
                  const f = fechaDe(ts), futuro = ts > ahora + 3600e3, c = cuentaDe(h, f, marcas, cuentas), antes = ts < h.creado - 864e5;
                  const r = antes ? 0 : tipo === 'evitar' ? (c ? 0 : 1) : Math.min(1, c / meta);
                  return <View key={f} style={{ height: 14, borderRadius: 3, backgroundColor: futuro ? 'transparent' : !tocaEl(h, ts) ? 'rgba(255,255,255,0.03)' : r ? h.color : 'rgba(255,255,255,0.07)', opacity: r ? 0.3 + 0.7 * r : 1, borderWidth: f === hoy ? 1 : 0, borderColor: C.t2 }} />;
                })}
              </View>
            ))}
          </View>
        </Cel>

        {/* ajustes */}
        <Seccion t={t('Settings')} />
        <Cel style={{ gap: 14 }}>
          {/* tipo */}
          <View style={{ gap: 8 }}>
            <Txt size={14.5}>{t('Type')}</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {TIPOS_HABITO.map(x => (
                <Pressable key={x.k} onPress={() => editarHabito(h.id, { tipo: x.k, ...(x.k === 'contar' && meta < 2 ? { meta: 8, paso: 1 } : x.k === 'tiempo' && meta < 2 ? { meta: 20, paso: 5, unidad: 'min' } : x.k === 'si' ? { meta: 1 } : {}) })}
                  style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: tipo === x.k ? h.color : C.l2, backgroundColor: tipo === x.k ? `${h.color}22` : 'transparent' }}>
                  <Ionicons name={x.i as keyof typeof Ionicons.glyphMap} size={13} color={tipo === x.k ? h.color : C.t3} />
                  <Txt f="m" size={12.5} color={tipo === x.k ? h.color : C.t2}>{t(x.t)}</Txt>
                </Pressable>
              ))}
            </View>
          </View>
          {tipo === 'contar' || tipo === 'tiempo' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Txt size={14.5} style={{ flex: 1 }}>{t('Daily goal')}</Txt>
            <Pressable onPress={() => editarHabito(h.id, { meta: Math.max(1, meta - (meta > 10 ? 5 : 1)) })} style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="remove" size={16} color={C.t2} /></Pressable>
            <Txt f="mono" size={15} style={{ minWidth: 34, textAlign: 'center' }}>{meta}</Txt>
            <Pressable onPress={() => editarHabito(h.id, { meta: meta + (meta >= 10 ? 5 : 1), paso: h.paso ?? 1 })} style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="add" size={16} color={C.t2} /></Pressable>
          </View>
          ) : null}
          {tipo === 'contar' && meta > 1 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Txt size={14.5} style={{ flex: 1 }}>{t('Each tap adds')}</Txt>
              {[1, 5, 10].filter(p => p < meta).map(p => (
                <Pressable key={p} onPress={() => editarHabito(h.id, { paso: p })} style={{ height: 32, minWidth: 40, paddingHorizontal: 10, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: paso === p ? h.color : C.l2, backgroundColor: paso === p ? `${h.color}22` : 'transparent' }}>
                  <Txt f="m" size={13} color={paso === p ? h.color : C.t2}>{p}</Txt>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={{ gap: 8 }}>
            <Txt size={14.5}>{t('Days')}</Txt>
            <View style={{ flexDirection: 'row', gap: 5 }}>
              {DIAS.map(d => {
                const todos = !h.dias?.length, on = todos || h.dias!.includes(d);
                const cambiar = () => { const base = todos ? [0, 1, 2, 3, 4, 5, 6] : h.dias!; const nuevo = on ? base.filter(x => x !== d) : [...base, d]; if (nuevo.length) editarHabito(h.id, { dias: nuevo.length === 7 ? [] : nuevo }); };
                return (
                  <Pressable key={d} onPress={cambiar} accessibilityState={{ selected: on }} style={{ flex: 1, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? h.color : C.s2 }}>
                    <Txt f="s" size={13} color={on ? C.tinta : C.t3}>{LETRA[tr.idioma][d]}</Txt>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={{ gap: 8 }}>
            <Txt size={14.5}>{t('Reminders')}</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {recordar.map(r => (
                <Pressable key={r} onPress={() => ponerRecordar(recordar.filter(x => x !== r))} style={{ height: 32, paddingLeft: 12, paddingRight: 8, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.sigSuave }}>
                  <Txt f="mono" size={13} color={C.nova}>{r}</Txt>
                  <Ionicons name="close" size={14} color={C.nova} />
                </Pressable>
              ))}
              <TextInput value={hora} onChangeText={x => setHora(x.replace(/[^0-9:]/g, '').slice(0, 5))} placeholder="HH:MM" placeholderTextColor={C.t3} keyboardType="numbers-and-punctuation"
                onSubmitEditing={() => { const m = hora.match(/^(\d{1,2}):?(\d{2})$/); if (m && Number(m[1]) < 24 && Number(m[2]) < 60) { ponerRecordar([...recordar, `${m[1].padStart(2, '0')}:${m[2]}`]); setHora(''); } }}
                returnKeyType="done" style={{ ...campo, height: 32, width: 80, textAlign: 'center', fontSize: 13 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Pressable onPress={() => ponerRecordar(['10:00', '12:00', '14:00', '16:00', '18:00', '20:00'])} style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', borderWidth: 1, borderColor: C.l2 }}>
                <Txt f="m" size={12.5} color={C.t2}>{t('Every 2 h (10–20)')}</Txt>
              </Pressable>
              {recordar.length ? (
                <Pressable onPress={() => ponerRecordar([])} style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', borderWidth: 1, borderColor: C.l2 }}>
                  <Txt f="m" size={12.5} color={C.t2}>{t('No reminders')}</Txt>
                </Pressable>
              ) : null}
            </View>
          </View>
        </Cel>

        <Seccion t={t('Look')} />
        <Cel style={{ gap: 12 }}>
          <TextInput value={nombre} onChangeText={setNombre} onEndEditing={() => nombre.trim() && editarHabito(h.id, { nombre: nombre.trim().slice(0, 40) })} maxLength={40}
            style={{ height: 46, borderRadius: 14, backgroundColor: C.s2, paddingHorizontal: 14, color: C.t1, fontFamily: F.r, fontSize: 15.5 }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {ICONOS_HABITO.map(ic => (
              <Pressable key={ic} onPress={() => editarHabito(h.id, { icono: ic })} accessibilityLabel={ic} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: h.icono === ic ? `${h.color}2a` : C.s2, borderWidth: h.icono === ic ? 1 : 0, borderColor: h.color }}>
                <Ionicons name={ic as keyof typeof Ionicons.glyphMap} size={18} color={h.icono === ic ? h.color : C.t2} />
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {COLORES_HABITO.map(c => (
              <Pressable key={c} onPress={() => editarHabito(h.id, { color: c })} accessibilityLabel={c} style={{ flex: 1, aspectRatio: 1, borderRadius: 99, backgroundColor: c, borderWidth: h.color === c ? 3 : 0, borderColor: C.t1 }} />
            ))}
          </View>
        </Cel>

        <Pressable onPress={() => { if (!borrar) { setBorrar(true); return; } quitarHabito(h.id); volver('/'); }} style={{ alignSelf: 'center', marginTop: 22, paddingVertical: 10 }}>
          <Txt f="m" size={14} color={C.alerta}>{borrar ? t('Tap again to delete it') : t('Delete habit')}</Txt>
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}
