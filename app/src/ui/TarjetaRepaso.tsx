/* En Hoy, solo cuando toca: lo que aprendiste y hoy conviene repasar (un minuto cada uno). */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { View } from 'react-native';
import { pendientesHoy, useRepaso } from '../engine/repaso';
import { useIdioma } from '../i18n';
import { useAhora } from './ahora';
import { C, Cel, Seccion, Toque, Txt } from './tema';

export function TarjetaRepaso() {
  const { t } = useIdioma(), { tarjetas } = useRepaso();
  const hoy = pendientesHoy(tarjetas);
  if (!hoy.length) return null;
  return (
    <>
      <Seccion t={t('To review')} nota={t('about a minute each')} />
      <Cel style={{ paddingVertical: 4 }}>
        {hoy.slice(0, 4).map((c, i) => (
          <Toque key={c.id} onPress={() => router.push({ pathname: '/repaso', params: { id: c.id } })} label={c.tema}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(168,152,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="school-outline" size={15} color={C.lila} />
            </View>
            <Txt size={15} style={{ flex: 1 }} numberOfLines={1}>{c.tema}</Txt>
            <Ionicons name="chevron-forward" size={16} color={C.t3} />
          </Toque>
        ))}
      </Cel>
    </>
  );
}

/** domingo desde las 18:00 y todo el lunes: la semana con NOVA */
export function TarjetaSemana() {
  const { t } = useIdioma(), d = new Date(useAhora()), dia = d.getDay();
  if (!((dia === 0 && d.getHours() >= 18) || dia === 1)) return null;
  return (
    <Toque onPress={() => router.push('/resumen')} label={t('Your week with Nova')} style={{ marginTop: 16 }}>
      <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 14, borderColor: 'rgba(143,230,245,0.22)' }}>
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: C.sigSuave, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="calendar-outline" size={19} color={C.nova} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt f="s" size={15}>{t('Your week with Nova')}</Txt>
          <Txt size={13} color={C.t2} style={{ marginTop: 2 }}>{t('Sleep, focus, mood and what I noticed.')}</Txt>
        </View>
        <Ionicons name="chevron-forward" size={18} color={C.t3} />
      </Cel>
    </Toque>
  );
}
