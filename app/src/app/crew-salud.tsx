/* Salud de la crew: cómo viene cada persona los últimos 7 días, solo con lo que cada una decide compartir.
   Arriba, el reparto de hoy (bien · atentos · a cuidar) y lo que NOVA lee de eso; después, una tarjeta por persona
   con sus números de hoy y una tira de 7 días. Si alguien lleva varios días mal, aparece primero y con una acción. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEstados } from '../cuenta/datos';
import { useCrew, useSesion, type Crew } from '../cuenta/sesion';
import { rango7, saludCrew, ultimoDia, type Nivel, type SaludMiembro, type Senal } from '../engine/crewSalud';
import { ESCALAS, nivelDe } from '../engine/diario';
import { cambiarFuncion, useFunciones } from '../engine/funciones';
import { useIdioma } from '../i18n';
import { NovaOrb } from '../nova/NovaOrb';
import { useAhora } from '../ui/ahora';
import { AvatarMiembro } from '../ui/Crew';
import { Interruptor } from '../ui/Interruptor';
import { COLOR_NIVEL, TXT_NIVEL } from '../ui/nivelSalud';
import { volver } from '../ui/volver';
import { C, Cel, MsgNova, Seccion, Txt } from '../ui/tema';

const TXT_SENAL: Record<Senal, string> = { sueno: 'little sleep', animo: 'low mood', energia: 'low energy', recup: 'low recovery' };
const ORDEN: Record<Nivel, number> = { cuidar: 0, atento: 1, bien: 2, sin: 3 };

export default function SaludCrew() {
  const ins = useSafeAreaInsets(), { t, locale } = useIdioma(), crew = useCrew(), { usuario } = useSesion(), ahora = useAhora(10 * 60e3);
  const { compartirDia, compartirSalud } = useFunciones();
  const { datos } = useEstados(crew?.id ?? null, rango7(ahora).desde, rango7(ahora).hasta);
  if (!crew) return null;
  const salud = saludCrew(crew.miembros.map(m => m.id), datos ?? [], ahora)
    .sort((a, b) => (a.usuario === usuario?.id ? 1 : b.usuario === usuario?.id ? -1 : 0) || ORDEN[nivelDe7(a)] - ORDEN[nivelDe7(b)] || b.racha - a.racha);
  const otros = salud.filter(s => s.usuario !== usuario?.id);
  const cuenta = { bien: 0, atento: 0, cuidar: 0, sin: 0 } as Record<Nivel, number>;
  for (const s of salud) cuenta[nivelDe7(s)]++;
  const nombre = (id: string) => crew.miembros.find(m => m.id === id)?.nombre.split(/\s+/)[0] ?? '';
  const preocupa = otros.filter(s => s.racha >= 3).sort((a, b) => b.racha - a.racha)[0];
  const lectura = preocupa
    ? t('{n} has had {d} rough days in a row ({s}). A message today can make a difference.', { n: nombre(preocupa.usuario), d: preocupa.racha, s: senales(t, preocupa) })
    : cuenta.cuidar + cuenta.atento === 0 && cuenta.bien
      ? t('The crew is doing well today. Good moment to push on the goals.')
      : cuenta.bien + cuenta.atento + cuenta.cuidar === 0
        ? t('Nobody has shared today yet. When they do the check-in or sync their sleep, you will see it here.')
        : t('Some signals to keep an eye on, nothing that lasts. Normal for a team that is working hard.');

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/crew')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: ins.bottom + 30 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Txt f="mono" size={12} ls={1.2} color={C.nova} style={{ textTransform: 'uppercase' }}>{crew.nombre}</Txt>
            <Txt f="s" size={30} ls={-1.2} lh={34} style={{ marginTop: 6 }}>{t('Crew wellbeing')}</Txt>
          </View>
          <NovaOrb size={96} orbes={2} expr={preocupa ? 'pensativa' : cuenta.bien && !cuenta.cuidar ? 'feliz' : 'normal'} />
        </View>

        {/* reparto de hoy */}
        <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 3, marginTop: 14 }}>
          {(['bien', 'atento', 'cuidar', 'sin'] as Nivel[]).filter(k => cuenta[k]).map(k => <View key={k} style={{ flex: cuenta[k], backgroundColor: COLOR_NIVEL[k], borderRadius: 5 }} />)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6, marginTop: 10 }}>
          {(['bien', 'atento', 'cuidar', 'sin'] as Nivel[]).filter(k => cuenta[k]).map(k => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLOR_NIVEL[k] }} />
              <Txt size={13} color={C.t2}><Txt f="s" size={13}>{cuenta[k]}</Txt> {t(TXT_NIVEL[k])}</Txt>
            </View>
          ))}
        </View>

        <View style={{ marginTop: 16 }}><MsgNova>{lectura}</MsgNova></View>

        {/* tu parte: qué compartes */}
        {!compartirDia || !compartirSalud ? (
          <Cel style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Txt f="s" size={15}>{t('Share my health with the crew')}</Txt>
              <Txt size={12.5} lh={17} color={C.t3} style={{ marginTop: 2 }}>{compartirDia ? t('Recovery, resting heart rate and HRV, and the crew gets a heads-up if you have several rough days. You can turn it off anytime.') : t('Turn on «Share my day» first (Me → Crew).')}</Txt>
            </View>
            <Interruptor on={compartirDia && compartirSalud} label={t('Share my health with the crew')} onChange={v => { if (!compartirDia && v) cambiarFuncion('compartirDia', true); cambiarFuncion('compartirSalud', v); }} />
          </Cel>
        ) : null}

        <Seccion t={t('Everyone')} nota={t('last 7 days')} />
        <View style={{ gap: 8 }}>
          {salud.map((s, i) => <TarjetaMiembro key={s.usuario} s={s} crew={crew} yo={s.usuario === usuario?.id} i={i} locale={locale} />)}
        </View>

        <Txt size={12.5} lh={18} color={C.t3} style={{ marginTop: 18, paddingHorizontal: 2 }}>
          {t('Each person decides what they share in Me → Crew. Nova does not diagnose anything: these are signals so the team can look out for each other.')}
        </Txt>
      </ScrollView>
    </View>
  );
}

/** el nivel que se muestra para hoy: el último día con datos, o «sin datos» */
const nivelDe7 = (s: SaludMiembro): Nivel => ultimoDia(s)?.nivel ?? 'sin';

function senales(t: (k: string) => string, s: SaludMiembro) {
  const cuenta = new Map<Senal, number>();
  for (const d of s.dias.slice(-s.racha - 1)) for (const b of d.bajas) cuenta.set(b, (cuenta.get(b) ?? 0) + 1);
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => t(TXT_SENAL[k])).join(' · ');
}

function TarjetaMiembro({ s, crew, yo, i, locale }: { s: SaludMiembro; crew: Crew; yo: boolean; i: number; locale: string }) {
  const tr = useIdioma(), { t } = tr;
  const m = crew.miembros.find(x => x.id === s.usuario);
  const d = ultimoDia(s), e = d?.e, nivel = d?.nivel ?? 'sin', col = COLOR_NIVEL[nivel];
  const nombre = m?.nombre.split(/\s+/)[0] ?? '';
  const datos: { k: string; v: string; bajo: boolean }[] = [];
  if (e?.suenoH) datos.push({ k: t('Sleep'), v: `${e.suenoH.toLocaleString(locale, { maximumFractionDigits: 1 })} h`, bajo: d!.bajas.includes('sueno') });
  if (e?.animo) datos.push({ k: t('Mood'), v: nivelDe(tr, ESCALAS[0], e.animo), bajo: d!.bajas.includes('animo') });
  if (e?.energia) datos.push({ k: t('Energy'), v: nivelDe(tr, ESCALAS[1], e.energia), bajo: d!.bajas.includes('energia') });
  if (e?.recup) datos.push({ k: t('Recovery'), v: tr.tc('recup', ['', 'Low', 'Normal', 'Good'][e.recup]), bajo: e.recup === 1 });
  if (e?.fcReposo) datos.push({ k: t('HR at rest'), v: `${Math.round(e.fcReposo)}`, bajo: false });
  if (e?.vfc) datos.push({ k: t('HRV'), v: `${Math.round(e.vfc)} ms`, bajo: false });
  const dia = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString(locale, { weekday: 'narrow' });
  return (
    <Animated.View entering={FadeInDown.delay(60 * i).duration(320)}>
      <Cel style={{ padding: 16, borderColor: !yo && s.racha >= 3 ? `${C.alerta}55` : C.l1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <AvatarMiembro u={m} size={40} anillo={nivel === 'sin' ? undefined : col} apagado={nivel === 'sin'} />
          <View style={{ flex: 1 }}>
            <Txt f="s" size={16} numberOfLines={1}>{yo ? t('You') : nombre}</Txt>
            <Txt size={12.5} color={s.racha >= 2 ? C.aviso : C.t3} numberOfLines={2}>
              {s.racha >= 2 ? t('{d} days in a row with {s}', { d: s.racha, s: senales(t, s) }) : d && d !== s.hoy ? t('Yesterday') : nivel === 'sin' ? t('Has not shared this week') : t('Today')}
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, height: 24, borderRadius: 12, backgroundColor: nivel === 'sin' ? C.s2 : `${col}1f` }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: nivel === 'sin' ? C.t3 : col }} />
            <Txt f="m" size={11.5} color={nivel === 'sin' ? C.t3 : col}>{t(TXT_NIVEL[nivel])}</Txt>
          </View>
        </View>

        {datos.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, rowGap: 10 }}>
            {datos.map(x => (
              <View key={x.k} style={{ width: '33.33%', paddingRight: 8 }}>
                <Txt size={11.5} color={C.t3}>{x.k}</Txt>
                <Txt f="m" size={14} color={x.bajo ? C.aviso : C.t1} numberOfLines={1}>{x.v}</Txt>
              </View>
            ))}
          </View>
        ) : null}

        {/* 7 días: un cuadro por día con el color del nivel */}
        <View style={{ flexDirection: 'row', gap: 5, marginTop: 14 }}>
          {s.dias.map(x => (
            <View key={x.fecha} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <View style={{ alignSelf: 'stretch', height: 8, borderRadius: 4, backgroundColor: x.nivel === 'sin' ? C.s2 : COLOR_NIVEL[x.nivel], opacity: x.nivel === 'sin' ? 1 : 0.9 }} />
              <Txt f="monoR" size={10} color={x === s.hoy ? C.t1 : C.t3}>{dia(x.fecha)}</Txt>
            </View>
          ))}
        </View>

        {!yo && (nivel === 'cuidar' || s.racha >= 2) ? (
          <Pressable onPress={() => router.push({ pathname: '/nova', params: { q: t('{n} has had a few rough days. How can I support them today, without being intrusive?', { n: nombre }) } })}
            accessibilityRole="button" style={{ alignSelf: 'flex-start', marginTop: 12, height: 32, paddingHorizontal: 13, borderRadius: 16, backgroundColor: C.sigSuave, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="sparkles-outline" size={14} color={C.nova} />
            <Txt f="s" size={13} color={C.nova}>{t('How can I help?')}</Txt>
          </Pressable>
        ) : null}
      </Cel>
    </Animated.View>
  );
}
