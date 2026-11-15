/* Todo lo tuyo en NOVA, a un toque: recordatorios, lo que hizo NOVA, hábitos, repaso, tu semana, lo que NOVA
   recuerda, metas del equipo y permisos. En Tú (arriba) y los recordatorios también en Hoy. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Platform, Pressable, View } from 'react-native';
import { useListas } from '../cuenta/datos';
import { useActividad } from '../engine/actividad';
import { useRutina } from '../engine/rutina';
import { fechaDe } from '../engine/diario';
import { hecho, useHabitos } from '../engine/habitos';
import { useMemoria } from '../engine/memoria';
import { useRecordatoriosPropios } from '../engine/recordatoriosPropios';
import { pendientesHoy, useRepaso } from '../engine/repaso';
import { useIdioma } from '../i18n';
import { useAhora } from './ahora';
import { C, Cel, Seccion, Txt } from './tema';

type Cosa = { k: string; icono: keyof typeof Ionicons.glyphMap; t: string; d: string; ir: string; color: string };

export function TusCosas() {
  const { t } = useIdioma(), ahora = useAhora(60e3), hoy = fechaDe(ahora);
  const { datos: listas } = useListas(), { bloques } = useRutina();
  const { lista } = useRecordatoriosPropios(), { lista: hechos } = useActividad(), { habitos, marcas } = useHabitos(), { tarjetas } = useRepaso(), { recuerdos } = useMemoria();
  const vienen = lista.filter(r => r.cuando > ahora && !r.hecho).length;
  const hoyNova = hechos.filter(h => fechaDe(h.ts) === hoy).length;
  const cosas: Cosa[] = [
    { k: 'rec', icono: 'alarm-outline', t: t('Reminders'), d: vienen ? t('{n} coming up', { n: vienen }) : t('None coming up'), ir: '/recordatorios', color: C.nova },
    { k: 'act', icono: 'sparkles-outline', t: t('What Nova did'), d: hoyNova ? t('{n} today', { n: hoyNova }) : t('Your requests'), ir: '/actividad', color: C.lila },
    { k: 'hab', icono: 'repeat', t: t('Habits'), d: habitos.length ? t('{a} of {b} today', { a: habitos.filter(h => hecho(marcas, h.id, hoy)).length, b: habitos.length }) : t('Create one'), ir: '/habitos', color: C.ok },
    { k: 'rep', icono: 'school-outline', t: t('Review'), d: tarjetas.length ? t('{n} for today', { n: pendientesHoy(tarjetas, ahora).length }) : t('What you learn'), ir: '/repaso', color: C.aviso },
    { k: 'sem', icono: 'calendar-outline', t: t('Your week'), d: t('Summary'), ir: '/resumen', color: C.sig },
    { k: 'mem', icono: 'bookmark-outline', t: t('Nova’s memory'), d: t('{n} things', { n: recuerdos.length }), ir: '/memoria', color: C.lila },
    { k: 'lis', icono: 'list-outline', t: t('Lists'), d: listas?.length ? t('{n} lists', { n: listas.length }) : t('Groceries, ideas…'), ir: '/listas', color: C.aviso },
    { k: 'rut', icono: 'briefcase-outline', t: t('Your routine'), d: bloques.length ? t('{n} blocks', { n: bloques.length }) : t('Work, classes…'), ir: '/rutina', color: C.sig },
  ];
  const filas = [cosas.slice(0, 2), cosas.slice(2, 4), cosas.slice(4, 6), cosas.slice(6, 8)];
  return (
    <>
      <Seccion t={t('Your things')} />
      <View style={{ gap: 8 }}>
        {filas.map((f, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
            {f.map(c => (
              <Pressable key={c.k} onPress={() => router.push(c.ir as never)} accessibilityRole="button" accessibilityLabel={c.t} style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.75 : 1 })}>
                <Cel style={{ padding: 14, gap: 10, flex: 1 }}>
                  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: `${c.color}1f`, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={c.icono} size={17} color={c.color} />
                  </View>
                  <View>
                    <Txt f="s" size={14.5} numberOfLines={1}>{c.t}</Txt>
                    <Txt size={12.5} color={C.t3} numberOfLines={1}>{c.d}</Txt>
                  </View>
                </Cel>
              </Pressable>
            ))}
          </View>
        ))}
        <Pressable onPress={() => router.push('/integraciones')} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
          <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
            <Ionicons name="git-network-outline" size={19} color={C.ok} />
            <View style={{ flex: 1 }}>
              <Txt f="s" size={14.5}>{t('Integrations')}</Txt>
              <Txt size={12.5} color={C.t3}>{t('Health, calendars, watch, Spotify, alarms…')}</Txt>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.t3} />
          </Cel>
        </Pressable>
        <Pressable onPress={() => router.push('/mapa')} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
          <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
            <Ionicons name="map-outline" size={19} color={C.nova} />
            <View style={{ flex: 1 }}>
              <Txt f="s" size={14.5}>{t('Map of Nova')}</Txt>
              <Txt size={12.5} color={C.t3}>{t('Every screen, and the tour with Nova')}</Txt>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.t3} />
          </Cel>
        </Pressable>
      </View>
    </>
  );
}

/** Hoy: los próximos recordatorios (siempre visible, para que se sepa dónde quedan) */
export function TarjetaRecordatorios() {
  const { t, locale } = useIdioma(), ahora = useAhora(30e3);
  const { lista } = useRecordatoriosPropios();
  const vienen = lista.filter(r => r.cuando > ahora && !r.hecho);
  const cuando = (ts: number) => { const h = new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false }); return fechaDe(ts) === fechaDe(ahora) ? h : `${t('tomorrow')} ${h}`.trim(); };
  return (
    <>
      <Seccion t={t('Reminders')} nota={
        <Pressable onPress={() => router.push('/recordatorios')} hitSlop={8} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="add" size={15} color={C.nova} />
          <Txt f="m" size={13} color={C.nova}>{t('New')}</Txt>
        </Pressable>
      } />
      <Pressable onPress={() => router.push('/recordatorios')} accessibilityRole="button" accessibilityLabel={t('Reminders')}>
        <Cel style={{ paddingVertical: vienen.length ? 4 : 14 }}>
          {!vienen.length ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name="alarm-outline" size={18} color={C.t3} />
              <Txt size={13.5} lh={19} color={C.t2} style={{ flex: 1 }}>{t('Nothing coming up. Tell Nova «remind me at 6 to…» or add one.')}</Txt>
            </View>
          ) : vienen.slice(0, 4).map((r, i) => (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
              <Txt f="mono" size={13} color={C.nova} style={{ minWidth: 48 }}>{cuando(r.cuando)}</Txt>
              <Txt size={14.5} style={{ flex: 1 }} numberOfLines={1}>{r.texto}</Txt>
              {!r.notif && Platform.OS !== 'web' ? <Ionicons name="notifications-off-outline" size={14} color={C.aviso} /> : null}
            </View>
          ))}
          {vienen.length > 4 ? <Txt f="m" size={13} color={C.nova} style={{ paddingVertical: 10 }}>{t('See {n} more', { n: vienen.length - 4 })}</Txt> : null}
        </Cel>
      </Pressable>
    </>
  );
}
