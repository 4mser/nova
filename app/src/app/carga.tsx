/* Carga del equipo: cuánto tiene cada uno abierto, vencido y para esta semana, cuánto cerró y cuánto foco hizo en 7
   días. Sirve para repartir mejor: quien está con poco puede tomar algo de quien está sobrecargado. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useCarga } from '../cuenta/datos';
import { miembroDe, useCrew } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { AvatarMiembro } from '../ui/Crew';
import { Hoja } from '../ui/Hoja';
import { C, Cel, Txt } from '../ui/tema';

const NIVEL = { alta: { color: C.alerta, t: 'Overloaded' }, normal: { color: C.ok, t: 'Balanced' }, baja: { color: C.nova, t: 'Has room' } } as const;

export default function CargaPantalla() {
  const { t } = useIdioma(), crew = useCrew(), { datos, cargando } = useCarga(crew?.id ?? null);
  const max = Math.max(1, ...(datos?.personas.map(p => p.abiertas) ?? [1]));
  const alta = datos?.personas.filter(p => p.nivel === 'alta') ?? [], baja = datos?.personas.filter(p => p.nivel === 'baja') ?? [];
  return (
    <Hoja titulo={t('Team workload')} sub={t('Open tasks per person, what is overdue and what they closed this week. Only crew tasks count.')} volverA="/crew">
      {cargando && !datos ? <ActivityIndicator color={C.nova} style={{ marginTop: 30 }} /> : null}
      {alta.length && baja.length ? (
        <Cel style={{ marginTop: 16, flexDirection: 'row', gap: 10, borderColor: 'rgba(168,152,255,0.35)' }}>
          <Ionicons name="sparkles" size={16} color={C.lila} style={{ marginTop: 2 }} />
          <Txt size={14} lh={20} style={{ flex: 1 }}>{t('{a} has a lot on their plate and {b} has room. Maybe pass something along?', { a: alta.map(p => miembroDe(p.usuario)?.nombre.split(' ')[0]).join(', '), b: baja.map(p => miembroDe(p.usuario)?.nombre.split(' ')[0]).join(', ') })}</Txt>
        </Cel>
      ) : null}
      {datos?.sinNadie ? (
        <Pressable onPress={() => router.navigate('/crew')}>
          <Cel style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="help-circle-outline" size={18} color={C.aviso} />
            <Txt size={14} style={{ flex: 1 }}>{t('{n} tasks without anyone in charge', { n: datos.sinNadie })}</Txt>
            <Ionicons name="chevron-forward" size={16} color={C.t3} />
          </Cel>
        </Pressable>
      ) : null}
      <View style={{ gap: 10, marginTop: 16 }}>
        {datos?.personas.map(p => {
          const m = miembroDe(p.usuario), n = NIVEL[p.nivel];
          return (
            <Cel key={p.usuario} style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <AvatarMiembro u={m} size={38} />
                <View style={{ flex: 1 }}>
                  <Txt f="s" size={15.5}>{m?.nombre ?? '?'}</Txt>
                  <Txt f="m" size={12.5} color={n.color}>{t(n.t)}</Txt>
                </View>
                <Txt f="l" size={32} ls={-1.4}>{p.abiertas}</Txt>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: C.l1, overflow: 'hidden', flexDirection: 'row' }}>
                <View style={{ width: `${(p.vencidas / max) * 100}%`, backgroundColor: C.alerta }} />
                <View style={{ width: `${(Math.max(0, p.abiertas - p.vencidas) / max) * 100}%`, backgroundColor: n.color, opacity: 0.7 }} />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[[t('overdue'), p.vencidas, p.vencidas ? C.alerta : C.t2], [t('due this week'), p.semana, C.t2], [t('done · 7 d'), p.hechas7, C.ok], [t('focus · 7 d'), `${Math.round(p.focoMin7 / 60)} h`, C.t2]].map(([k, v, color]) => (
                  <View key={String(k)} style={{ flex: 1 }}>
                    <Txt f="s" size={16} color={String(color)}>{String(v)}</Txt>
                    <Txt size={11} lh={14} color={C.t3} numberOfLines={2}>{String(k)}</Txt>
                  </View>
                ))}
              </View>
            </Cel>
          );
        })}
      </View>
    </Hoja>
  );
}
