/* En Hoy: lo pendiente en Todoist, Google Tasks y Linear (si conectaste alguno), lo que vence primero arriba.
   El círculo lo completa allá mismo; tocar el texto lo abre en su app. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Linking, Pressable, View } from 'react-native';
import { completarExterna, useExternas, type Externa } from '../cuenta/datos';
import { NOMBRE_PROV, useIntegraciones } from '../cuenta/integraciones';
import { fechaDe } from '../engine/diario';
import { useIdioma } from '../i18n';
import { useAhora } from './ahora';
import { C, Cel, Seccion, Txt } from './tema';

export const FUENTE: Record<Externa['fuente'], { icono: keyof typeof Ionicons.glyphMap; color: string }> = {
  todoist: { icono: 'checkbox', color: '#e44332' }, google: { icono: 'checkmark-done', color: '#4f8df5' }, linear: { icono: 'git-network', color: '#8e8cf8' },
};

export function TarjetaExternas() {
  const { t, locale } = useIdioma(), ahora = useAhora(30 * 60e3), { datos: c } = useIntegraciones();
  const alguna = !!(c?.todoist?.conectado || c?.google?.conectado || c?.linear?.conectado);
  const { datos } = useExternas(alguna);
  if (!alguna || !datos) return null;
  const hoy = fechaDe(ahora), lista = datos.tareas.slice(0, 6);
  const fuentes = [...new Set(datos.tareas.map(x => NOMBRE_PROV[x.fuente]))].join(' · ');
  return (
    <>
      <Seccion t={t('From your other apps')} nota={fuentes || undefined} />
      <Cel style={{ paddingVertical: 4, paddingHorizontal: 16 }}>
        {lista.length ? lista.map((x, i) => {
          const f = FUENTE[x.fuente], vencida = x.vence && x.vence < hoy;
          return (
            <View key={`${x.fuente}:${x.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
              <Pressable hitSlop={10} accessibilityRole="checkbox" accessibilityLabel={x.titulo} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); completarExterna(x).catch(() => {}); }}
                style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: C.t3 }} />
              <Pressable style={{ flex: 1 }} onPress={() => Linking.openURL(x.url).catch(() => {})}>
                <Txt size={15} lh={20} numberOfLines={2}>{x.titulo}</Txt>
                {x.vence ? <Txt size={12.5} color={vencida ? C.aviso : C.t3}>{x.vence === hoy ? t('Today') : new Date(`${x.vence}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}</Txt> : null}
              </Pressable>
              <Ionicons name={f.icono} size={15} color={f.color} accessibilityLabel={NOMBRE_PROV[x.fuente]} />
            </View>
          );
        }) : <Txt size={14} color={C.t3} style={{ paddingVertical: 14 }}>{t('Nothing pending in your other apps.')}</Txt>}
        {datos.tareas.length > lista.length ? (
          <Pressable onPress={() => router.push('/integraciones')} style={{ paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.l1 }}>
            <Txt f="m" size={13.5} color={C.nova}>{t('{n} more', { n: datos.tareas.length - lista.length })}</Txt>
          </Pressable>
        ) : null}
      </Cel>
    </>
  );
}
