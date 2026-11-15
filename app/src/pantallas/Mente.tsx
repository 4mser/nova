/* Mind, como el mockup del video: la constelación de la semana, tres promedios y lo que NOVA notó. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { animoDe, cargarDiario, fechaDe, preguntaDelDia, racha, solDe, useDiario } from '../engine/diario';
import { useIdioma } from '../i18n';
import { nombreEstres, SEMANA } from '../engine/motor';
import { NovaOrb } from '../nova/NovaOrb';
import { Barritas, Constelacion } from '../ui/Graficos';
import { useDia } from '../ui/ahora';
import { Pantalla } from '../ui/Pantalla';
import { pendientesHoy, useRepaso } from '../engine/repaso';
import { Boton, C, Cel, Lbl, MsgNova, Num, Seccion, Toque, Txt } from '../ui/tema';
import { minutosDe, useFoco } from '../engine/foco';
import { useFunciones } from '../engine/funciones';

export default function Mind() {
  const { mision } = useFunciones();
  return mision ? <Mente /> : <MenteDiaria />;
}

/** Mind en el día a día: tu semana sale de tus check-ins reales; foco y aprendizaje de tus sesiones con NOVA */
function MenteDiaria() {
  const { width } = useWindowDimensions(), tr = useIdioma(), { t, tp, locale } = tr;
  const W = Math.min(width, 520) - 40, tercio = (W - 16) / 3;
  const diario = useDiario(), ultima = diario.entradas[0], { sesiones } = useFoco();
  const ahora = useDia();
  useEffect(() => { cargarDiario(); }, []);
  // últimos 7 check-ins con ánimo, del más viejo al más nuevo
  const regs = Object.values(diario.registros).filter(r => r.valores.animo).sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-7);
  const dias = regs.map(r => ({
    dia: new Date(`${r.fecha}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' }),
    animo: r.valores.animo!, sueno: 5 + (r.valores.sueno ?? 3), estres: 0.3 + ((r.valores.estres ?? 3) - 1) * 0.1,
  }));
  const prom = (k: 'animo' | 'energia' | 'estres') => { const v = regs.map(r => r.valores[k]).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const animo = prom('animo'), energia = prom('energia'), estres = prom('estres');
  const semana = ahora - 7 * 864e5;
  const focoSem = sesiones.filter(x => x.ini > semana && x.tipo === 'foco').reduce((a, x) => a + x.min, 0);
  const aprSem = sesiones.filter(x => x.ini > semana && x.tipo === 'aprender').reduce((a, x) => a + x.min, 0);
  const porDia = Array.from({ length: 7 }, (_, i) => { const f = fechaDe(ahora - (6 - i) * 864e5); return minutosDe(f); });
  const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`);
  return (
    <Pantalla titulo={t('Mind')} sub={t('Your week, from your check-ins and focus')}>
      {dias.length >= 2 ? (
        <Cel style={{ paddingHorizontal: 18 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Lbl t={t('Your constellation')} />
            <Lbl t={tp(dias.length, '{n} day', '{n} days')} color={C.t3} />
          </View>
          <View style={{ marginTop: 6 }}><Constelacion w={W - 38} h={210} dias={dias} /></View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
            {['height · mood', 'size · sleep', 'color · stress'].map(k => <Txt key={k} size={12} color={C.t3}>{t(k)}</Txt>)}
          </View>
        </Cel>
      ) : (
        <Toque onPress={() => router.navigate('/journal')} label={t('Start your daily check-in')}>
          <Cel style={{ alignItems: 'center', paddingVertical: 22, gap: 6 }}>
            <NovaOrb size={110} halo={false} orbes={0} expr="pensativa" />
            <Txt f="s" size={17} style={{ textAlign: 'center' }}>{t('Your week appears here')}</Txt>
            <Txt size={14} lh={20} color={C.t2} style={{ textAlign: 'center', maxWidth: 290 }}>{t('Do the one-minute check-in a couple of days and you will see how your mood, sleep and stress move.')}</Txt>
          </Cel>
        </Toque>
      )}

      {animo != null ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          {([['Mood', animo], ['Energy', energia], ['Stress', estres]] as const).map(([k, v]) => (
            <Cel key={k} style={{ width: tercio, padding: 14 }}>
              <Lbl t={t(k)} />
              <Num v={v != null ? v.toFixed(1) : '—'} u={v != null ? '/5' : undefined} size={26} style={{ marginTop: 8 }} />
            </Cel>
          ))}
        </View>
      ) : null}

      <Seccion t={t('Focus and learning')} nota={t('7 days')} />
      <Toque onPress={() => router.push('/foco')} label={t('Start a session')}>
        <Cel style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 18 }}>
            <View><Lbl t={t('Focus')} /><Txt f="l" size={26} ls={-0.8} style={{ marginTop: 4 }}>{hm(focoSem)}</Txt></View>
            <View><Lbl t={t('Learning')} /><Txt f="l" size={26} ls={-0.8} style={{ marginTop: 4 }}>{hm(aprSem)}</Txt></View>
          </View>
          {porDia.some(Boolean) ? <Barritas w={W - 34} h={36} vals={porDia.map(m => m / Math.max(...porDia, 1))} col={C.nova} /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="play-circle" size={18} color={C.nova} />
            <Txt f="m" size={14} color={C.nova}>{t('Start a session with Nova')}</Txt>
          </View>
        </Cel>
      </Toque>
      <FilaRepaso />
      <Toque onPress={() => router.push('/resumen')} label={t('Your week with Nova')} style={{ marginTop: 8 }}>
        <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
          <Ionicons name="calendar-outline" size={18} color={C.nova} />
          <Txt f="s" size={15} style={{ flex: 1 }}>{t('Your week with Nova')}</Txt>
          <Ionicons name="chevron-forward" size={16} color={C.t3} />
        </Cel>
      </Toque>

      <Toque onPress={() => router.navigate('/journal')} label={t('Open your journal')} style={{ marginTop: 8 }}>
        <Cel style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="book-outline" size={16} color={C.nova} />
            <Lbl t={t('Journal')} style={{ flex: 1 }} />
            <Txt size={12.5} color={C.t3}>{diario.entradas.length ? tp(diario.entradas.length, '{n} entry', '{n} entries') : t('only you can read it')}</Txt>
          </View>
          {ultima ? <Txt size={15.5} lh={22} numberOfLines={2}>{ultima.texto}</Txt> : <Txt size={15.5} lh={22} color={C.t2}>{t('What is on your mind today?')}</Txt>}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <Ionicons name="create-outline" size={15} color={C.nova} />
            <Txt f="m" size={13.5} color={C.nova}>{t("Write today's entry")}</Txt>
          </View>
        </Cel>
      </Toque>

      <Toque onPress={() => router.push({ pathname: '/nova', params: { modo: 'checkin' } })} label={t('Talk it through with Nova')} style={{ marginTop: 8 }}>
        <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 }}>
          <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <NovaOrb size={52} halo={false} orbes={0} expr="feliz" />
          </View>
          <View style={{ flex: 1 }}>
            <Txt f="s" size={16} ls={-0.3}>{t('Talk it through with Nova')}</Txt>
            <Txt size={13.5} color={C.t2}>{t('How today went, out loud. About a minute.')}</Txt>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.t3} />
        </Cel>
      </Toque>

      <Txt size={12.5} color={C.t3} style={{ textAlign: 'center', marginTop: 18 }}>{t('Patterns from what you log, not a diagnosis.')}</Txt>
    </Pantalla>
  );
}

function Mente() {
  const { width } = useWindowDimensions(), tr = useIdioma(), { t } = tr;
  const W = Math.min(width, 520) - 40, tercio = (W - 16) / 3;
  const [plan, setPlan] = useState<'?' | 'si' | 'no'>('?');
  const diario = useDiario(), ultima = diario.entradas[0];
  useEffect(() => { cargarDiario(); }, []);
  const animo = SEMANA.reduce((a, d) => a + d.animo, 0) / SEMANA.length;
  const estres = SEMANA.reduce((a, d) => a + d.estres, 0) / SEMANA.length;
  return (
    <Pantalla titulo={t('Mind')} sub={t('Your week, from evening check-ins')}>
      <Cel style={{ paddingHorizontal: 18 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Lbl t={t('Your constellation')} />
          <Lbl t={t('7 days')} color={C.t3} />
        </View>
        <View style={{ marginTop: 6 }}><Constelacion w={W - 38} h={210} dias={SEMANA} /></View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
          {['height · mood', 'size · sleep', 'color · stress'].map(k => <Txt key={k} size={12} color={C.t3}>{t(k)}</Txt>)}
        </View>
      </Cel>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        {([['Mood', animo.toFixed(1), '/5'], ['Stress', tr.tc('nivel', nombreEstres(estres)), ''], ['Focus', '268', 'ms']] as const).map(([k, v, u]) => (
          <Cel key={k} style={{ width: tercio, padding: 14 }}>
            <Lbl t={t(k)} />
            <Num v={v} u={u || undefined} size={26} style={{ marginTop: 8 }} />
          </Cel>
        ))}
      </View>

      <View style={{ marginTop: 8 }}>
        <MsgNova pie={plan === '?' ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <Boton t={t('Keep it')} primario onPress={() => setPlan('si')} />
            <Boton t={t('Not now')} onPress={() => setPlan('no')} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
            <Ionicons name={plan === 'si' ? 'checkmark-circle' : 'time-outline'} size={16} color={plan === 'si' ? C.ok : C.t2} />
            <Txt f="m" size={14} color={plan === 'si' ? C.ok : C.t2}>{t(plan === 'si' ? 'Added: tomorrow, 07:30 cardio' : "Okay. I'll ask again next week.")}</Txt>
          </View>
        )}>{t('Your best days follow a morning workout. Want me to keep it on your schedule?')}</MsgNova>
      </View>

      <Toque onPress={() => router.navigate('/journal')} label={t('Open your journal')} style={{ marginTop: 8 }}>
        <Cel style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="book-outline" size={16} color={C.nova} />
            <Lbl t={t('Journal')} style={{ flex: 1 }} />
            <Txt size={12.5} color={C.t3}>{diario.entradas.length ? `${tr.tp(diario.entradas.length, '{n} entry', '{n} entries')} · ${t('{n} sol streak', { n: racha(diario.entradas) })}` : t('only you can read it')}</Txt>
          </View>
          {ultima ? (
            <>
              <Txt size={15.5} lh={22} numberOfLines={2}>{ultima.texto}</Txt>
              <Txt size={12.5} color={C.t3}>Sol {solDe(ultima.ts)} · {animoDe(tr, ultima.animo)}</Txt>
            </>
          ) : (
            <Txt size={15.5} lh={22} color={C.t2}>{preguntaDelDia(tr)}</Txt>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <Ionicons name="create-outline" size={15} color={C.nova} />
            <Txt f="m" size={13.5} color={C.nova}>{t("Write today's entry")}</Txt>
          </View>
        </Cel>
      </Toque>

      <Toque onPress={() => router.push({ pathname: '/nova', params: { modo: 'checkin' } })} label={t('Start evening check-in')} style={{ marginTop: 8 }}>
        <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 }}>
          <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <NovaOrb size={52} halo={false} orbes={0} expr="feliz" />
          </View>
          <View style={{ flex: 1 }}>
            <Txt f="s" size={16} ls={-0.3}>{t('Evening check-in')}</Txt>
            <Txt size={13.5} color={C.t2}>{t('About one minute')}</Txt>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.t3} />
        </Cel>
      </Toque>

      <Txt size={12.5} color={C.t3} style={{ textAlign: 'center', marginTop: 18 }}>{t('Demo data. Patterns, not a diagnosis.')}</Txt>
    </Pantalla>
  );
}

/** acceso a lo que aprendiste (repaso espaciado): cuántas tarjetas y cuántas tocan hoy */
function FilaRepaso() {
  const { t, tp } = useIdioma(), { tarjetas } = useRepaso();
  const hoy = pendientesHoy(tarjetas).length;
  return (
    <Toque onPress={() => router.push('/repaso')} label={t('Review')} style={{ marginTop: 8 }}>
      <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
        <Ionicons name="school-outline" size={18} color={C.lila} />
        <View style={{ flex: 1 }}>
          <Txt f="s" size={15}>{t('Review what you learned')}</Txt>
          <Txt size={12.5} color={C.t3} style={{ marginTop: 2 }}>{tarjetas.length ? tp(tarjetas.length, '{n} idea saved', '{n} ideas saved') : t('After a learning session, save the main idea')}</Txt>
        </View>
        {hoy ? <View style={{ minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, backgroundColor: C.lila, alignItems: 'center', justifyContent: 'center' }}><Txt f="s" size={12.5} color={C.tinta}>{hoy}</Txt></View> : null}
        <Ionicons name="chevron-forward" size={16} color={C.t3} />
      </Cel>
    </Toque>
  );
}
