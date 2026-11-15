/* Metas del equipo en Crew: cada objetivo con su avance contra lo esperado a la fecha (la marca fina en la barra),
   su estado y sus resultados clave con responsable. Los hitos se marcan con un toque; los números suben o bajan con
   +/−. Mantener apretado un resultado o una meta (si la creaste) la borra. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { borrarMeta, borrarResultado, cambiarResultado, useMetas, type Meta, type Resultado } from '../cuenta/datos';
import { useSesion, type Crew } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { useAhora } from './ahora';
import { AvatarMiembro } from './Crew';
import { C, Cel, Seccion, Txt } from './tema';

const ESTADO: Record<Meta['estado'], { t: string; color: string }> = {
  en_camino: { t: 'On track', color: C.ok }, atrasada: { t: 'Behind', color: C.aviso }, vencida: { t: 'Overdue', color: C.alerta }, lista: { t: 'Done', color: C.ok },
};

export function SeccionMetas({ crew }: { crew: Crew }) {
  const { t } = useIdioma(), { datos: metas } = useMetas(crew.id);
  return (
    <>
      <Seccion t={t('Goals')} nota={
        <Pressable onPress={() => router.push('/meta')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('New goal')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="add" size={15} color={C.nova} />
          <Txt f="m" size={13} color={C.nova}>{t('New')}</Txt>
        </Pressable>
      } />
      {!metas?.length ? (
        <Pressable onPress={() => router.push('/meta')}>
          <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: C.sigSuave, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="flag-outline" size={19} color={C.nova} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt f="s" size={15}>{t('Set a goal for the crew')}</Txt>
              <Txt size={13} lh={18} color={C.t2} style={{ marginTop: 2 }}>{t('One objective, a deadline and 2–4 key results with an owner each. Nova tracks it with you.')}</Txt>
            </View>
          </Cel>
        </Pressable>
      ) : (
        <View style={{ gap: 8 }}>{metas.map(m => <TarjetaMeta key={m.id} m={m} crew={crew} />)}</View>
      )}
    </>
  );
}

function TarjetaMeta({ m, crew }: { m: Meta; crew: Crew }) {
  const { t, locale } = useIdioma(), { usuario } = useSesion(), ahora = useAhora(30 * 60e3);
  const e = ESTADO[m.estado];
  const quedan = Math.max(0, Math.ceil((Date.parse(`${m.hasta}T23:59:59`) - ahora) / 864e5));
  const fecha = new Date(`${m.hasta}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const puedoBorrar = m.creador === usuario?.id || crew.soyAdmin;
  return (
    <Animated.View entering={FadeIn.duration(250)} layout={LinearTransition}>
      <Pressable onLongPress={() => { if (puedoBorrar) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}); borrarMeta(m.id).catch(() => {}); } }} delayLongPress={900}>
        <Cel style={{ padding: 16, borderColor: m.estado === 'atrasada' || m.estado === 'vencida' ? `${e.color}55` : C.l1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Txt f="s" size={16} lh={21}>{m.titulo}</Txt>
              <Txt size={12.5} color={C.t3} style={{ marginTop: 2 }}>{m.estado === 'lista' ? t('Completed') : quedan === 0 ? t('Due today · {f}', { f: fecha }) : t('{n} days left · {f}', { n: quedan, f: fecha })}</Txt>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, height: 24, borderRadius: 12, backgroundColor: `${e.color}1f` }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: e.color }} />
              <Txt f="m" size={11.5} color={e.color}>{t(e.t)}</Txt>
            </View>
          </View>
          {/* avance real y la marca de lo esperado a la fecha */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: C.l2 }}>
              <View style={{ width: `${Math.max(2, m.avance * 100)}%`, height: 8, borderRadius: 4, backgroundColor: e.color }} />
              {m.estado !== 'lista' && m.esperado > 0.03 && m.esperado < 0.98 ? <View style={{ position: 'absolute', left: `${m.esperado * 100}%`, top: -3, width: 2, height: 14, borderRadius: 1, backgroundColor: C.t2 }} /> : null}
            </View>
            <Txt f="mono" size={13} color={C.t1}>{Math.round(m.avance * 100)}%</Txt>
          </View>
          <View style={{ marginTop: 10 }}>
            {m.resultados.map((r, i) => <FilaResultado key={r.id} r={r} crew={crew} primero={!i} />)}
          </View>
        </Cel>
      </Pressable>
    </Animated.View>
  );
}

function FilaResultado({ r, crew, primero }: { r: Resultado; crew: Crew; primero: boolean }) {
  const { t, locale } = useIdioma();
  const dueño = crew.miembros.find(m => m.id === r.responsable);
  const listo = r.avance >= 1;
  const tocar = (c: Parameters<typeof cambiarResultado>[1]) => { Haptics.selectionAsync().catch(() => {}); cambiarResultado(r.id, c).catch(() => {}); };
  const n = (x: number) => (Number.isInteger(x) ? x : Math.round(x * 10) / 10).toLocaleString(locale);
  return (
    <Pressable onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); borrarResultado(r.id).catch(() => {}); }} delayLongPress={900}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: primero ? 0 : 1, borderTopColor: C.l1 }}>
      {r.tipo === 'hito' ? (
        <Pressable onPress={() => tocar({ hecho: !listo })} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: listo }} accessibilityLabel={r.titulo}
          style={{ width: 24, height: 24, borderRadius: 12, borderWidth: listo ? 0 : 1.5, borderColor: C.l2, backgroundColor: listo ? C.ok : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          {listo ? <Ionicons name="checkmark" size={15} color={C.tinta} /> : null}
        </Pressable>
      ) : (
        <View style={{ width: 24, alignItems: 'center' }}><Txt f="mono" size={11} color={listo ? C.ok : C.t2}>{Math.round(r.avance * 100)}%</Txt></View>
      )}
      <View style={{ flex: 1 }}>
        <Txt size={14.5} color={listo ? C.t2 : C.t1} numberOfLines={2}>{r.titulo}</Txt>
        {r.tipo === 'numero' ? <Txt f="monoR" size={12} color={C.t3}>{n(r.actual)} / {n(r.meta)}{r.unidad ? ` ${r.unidad}` : ''}</Txt> : null}
      </View>
      {r.tipo === 'numero' ? (
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <Pressable onPress={() => tocar({ sumar: -1 })} hitSlop={6} accessibilityLabel={t('Minus one')} style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="remove" size={14} color={C.t2} /></Pressable>
          <Pressable onPress={() => tocar({ sumar: 1 })} hitSlop={6} accessibilityLabel={t('Plus one')} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: C.sigSuave, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="add" size={14} color={C.nova} /></Pressable>
        </View>
      ) : null}
      {dueño ? <AvatarMiembro u={dueño} size={24} /> : <Ionicons name="person-circle-outline" size={24} color={C.t3} />}
    </Pressable>
  );
}
