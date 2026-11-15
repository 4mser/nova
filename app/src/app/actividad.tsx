/* Lo que hizo NOVA: cada acción que le pediste, con la hora y un toque para ir a donde quedó. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActividad, type Hecho } from '../engine/actividad';
import { nombreDia } from '../engine/diario';
import { useIdioma } from '../i18n';
import { volver } from '../ui/volver';
import { C, Cel, Txt } from '../ui/tema';

export default function Actividad() {
  const ins = useSafeAreaInsets(), tr = useIdioma(), { t } = tr, { lista } = useActividad();
  const dias: Hecho[][] = [];
  for (const h of lista) { const ult = dias[dias.length - 1]; if (ult && new Date(ult[0].ts).toDateString() === new Date(h.ts).toDateString()) ult.push(h); else dias.push([h]); }
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: ins.bottom + 30 }}>
        <Txt f="s" size={30} ls={-1.2} lh={34}>{t('What Nova did')}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6 }}>{t('Everything you asked Nova to do, and where it is. Tap one to open it.')}</Txt>
        {!lista.length ? <Txt size={14} lh={20} color={C.t3} style={{ marginTop: 20 }}>{t('Nothing yet. Ask Nova to add a task, set a reminder or log something, and it will show up here.')}</Txt> : null}
        {dias.map(d => (
          <View key={d[0].id} style={{ marginTop: 20, gap: 8 }}>
            <Txt f="m" size={13} color={C.t2} style={{ paddingHorizontal: 4 }}>{nombreDia(d[0].ts, tr)}</Txt>
            {d.map(h => (
              <Pressable key={h.id} disabled={!h.ir} onPress={() => h.ir && router.push(h.ir as never)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.sigSuave, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={h.icono as keyof typeof Ionicons.glyphMap} size={17} color={C.nova} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt size={14.5} lh={20}>{h.texto}</Txt>
                    <Txt f="monoR" size={12} color={C.t3} style={{ marginTop: 2 }}>{new Date(h.ts).toLocaleTimeString(tr.locale, { hour: '2-digit', minute: '2-digit', hour12: false })}{h.donde ? ` · ${h.donde}` : ''}</Txt>
                  </View>
                  {h.ir ? <Ionicons name="chevron-forward" size={17} color={C.t3} /> : null}
                </Cel>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
