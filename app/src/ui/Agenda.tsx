/* Tu agenda en Hoy: lo que te queda del día (lo que está pasando ahora, marcado), el próximo hueco libre con un botón
   para reservarlo como foco y, desde las 18:00, cómo parte mañana. Solo con la fuente «Calendario» encendida. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useIdioma } from '../i18n';
import { useRutina } from '../engine/rutina';
import { agendaDisponible, delDia, huecos, useAgenda, type Evento } from '../sensores/agenda';
import { useConsentimiento } from '../sensores/fuentes';
import { C, Cel, Seccion, Toque, Txt } from './tema';

const hora = (ts: number, locale: string) => new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });

export function TarjetaAgenda({ ahora }: { ahora: number }) {
  const { t, locale } = useIdioma(), { eventos, leido } = useAgenda(), { c } = useConsentimiento(), { bloques } = useRutina();
  const conCalendario = c.agenda && agendaDisponible() && !!leido;
  // sin calendario ni rutina igual se muestra: invita a contarle tu rutina (si no, NOVA cree que todo el día está libre)
  if (!conCalendario && !bloques.length) return <InvitarRutina />;
  const hoy = delDia(eventos, ahora).filter(e => e.todoElDia || e.fin > ahora);
  const hueco = huecos(eventos, ahora)[0];
  const tarde = new Date(ahora).getHours() >= 18;
  const manana = tarde ? delDia(eventos, ahora + 864e5).filter(e => !e.todoElDia)[0] : undefined;
  const minHueco = hueco ? Math.round((hueco.fin - hueco.ini) / 60e3) : 0;
  return (
    <>
      <Seccion t={t('Your schedule')} nota={
        <Toque onPress={() => router.push('/rutina')} label={t('Your routine')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="repeat" size={14} color={C.nova} />
          <Txt f="m" size={13} color={C.nova}>{t('Routine')}</Txt>
        </Toque>
      } />
      <Cel style={{ paddingVertical: 4 }}>
        {hoy.slice(0, 4).map((e, i) => <FilaEvento key={e.id} e={e} ahora={ahora} primero={!i} />)}
        {!hoy.length ? <Txt size={14.5} color={C.t2} style={{ paddingVertical: 14 }}>{t('Nothing left on your calendar today.')}</Txt> : null}
        {hueco && minHueco >= 45 ? (
          <Toque onPress={() => router.push({ pathname: '/foco', params: { min: String(Math.min(90, minHueco >= 60 ? 50 : 25)) } })} label={t('Book it for focus')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: 1, borderTopColor: C.l1 }}>
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: C.sigSuave, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="sparkles" size={14} color={C.nova} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt f="m" size={14.5}>{t('Free {a}–{b}', { a: hora(hueco.ini, locale), b: hora(hueco.fin, locale) })}</Txt>
              <Txt size={12.5} color={C.t3}>{t('A good gap for a focus session')}</Txt>
            </View>
            <Txt f="s" size={13.5} color={C.nova}>{t('Focus')}</Txt>
          </Toque>
        ) : null}
        {!bloques.length ? <InvitarRutina dentro /> : null}
        {manana ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.l1 }}>
            <Ionicons name="sunny-outline" size={16} color={C.t3} />
            <Txt size={13.5} color={C.t2} style={{ flex: 1 }} numberOfLines={1}>{t('Tomorrow {h}: {x}', { h: hora(manana.ini, locale), x: manana.titulo })}</Txt>
          </View>
        ) : null}
      </Cel>
    </>
  );
}

function FilaEvento({ e, ahora, primero }: { e: Evento; ahora: number; primero: boolean }) {
  const { t, locale } = useIdioma();
  const ya = !e.todoElDia && e.ini <= ahora && e.fin > ahora;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: primero ? 0 : 1, borderTopColor: C.l1 }} accessible accessibilityLabel={`${e.todoElDia ? t('All day') : `${hora(e.ini, locale)}–${hora(e.fin, locale)}`}, ${e.titulo}`}>
      <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: e.color ?? C.sig, opacity: e.libre ? 0.4 : 1 }} />
      <View style={{ width: 92 }}>
        <Txt f="monoR" size={12.5} color={ya ? C.nova : C.t2}>{e.todoElDia ? t('All day') : `${hora(e.ini, locale)}–${hora(e.fin, locale)}`}</Txt>
      </View>
      <View style={{ flex: 1 }}>
        <Txt size={14.5} numberOfLines={1}>{e.titulo}</Txt>
        {e.lugar ? <Txt size={12} color={C.t3} numberOfLines={1}>{e.lugar}</Txt> : e.id.startsWith('rutina|') ? <Txt size={12} color={C.lila}>{t('your routine')}</Txt> : null}
      </View>
      {ya ? <View style={{ paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: C.sigSuave, justifyContent: 'center' }}><Txt f="m" size={11.5} color={C.nova}>{t('now')}</Txt></View> : null}
    </View>
  );
}

/** «¿trabajas o estudias?»: lleva a contarle tu rutina, para que NOVA no crea que tienes libre todo el día */
function InvitarRutina({ dentro }: { dentro?: boolean }) {
  const { t } = useIdioma();
  const fila = (
    <Toque onPress={() => router.push('/rutina')} label={t('Tell Nova your routine')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, ...(dentro ? { borderTopWidth: 1, borderTopColor: C.l1 } : {}) }}>
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: `${C.lila}22`, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="briefcase-outline" size={14} color={C.lila} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt f="m" size={14.5}>{t('Tell Nova your routine')}</Txt>
        <Txt size={12.5} lh={17} color={C.t3}>{t('Work, fixed meetings, classes… so it knows when you are really free.')}</Txt>
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.t3} />
    </Toque>
  );
  return dentro ? fila : <Cel style={{ marginTop: 16, paddingVertical: 2 }}>{fila}</Cel>;
}
