/* Crew: las personas con las que usas NOVA. El momento del día (una foto espontánea a una hora sorpresa), las historias
   de hoy, el calendario de fotos, las tareas en conjunto con su avance, los retos y cómo va el día de cada uno. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Share, TextInput, View, useWindowDimensions } from 'react-native';
import { imagen } from '../../cuenta/api';
import { useCalendario, useEstados, useFotos, useRetos, useTareas, type EstadoDia, type Reto } from '../../cuenta/datos';
import { crearCrew, elegirCrew, unirseCrew, useCrew, useSesion, type Crew } from '../../cuenta/sesion';
import { useIdioma, mayus } from '../../i18n';
import { useFunciones } from '../../engine/funciones';
import CrewNave from '../../pantallas/CrewNave';
import { rango7, saludCrew, ultimoDia } from '../../engine/crewSalud';
import { fechaDe } from '../../engine/diario';
import { NovaOrb } from '../../nova/NovaOrb';
import { useAhora } from '../../ui/ahora';
import { AvatarMiembro, colorDe } from '../../ui/Crew';
import { COLOR_NIVEL } from '../../ui/nivelSalud';
import { Pantalla } from '../../ui/Pantalla';
import { TarjetaStandup } from '../../ui/Standup';
import { TarjetaGithubCrew } from '../../ui/GithubCrew';
import { SeccionMetas } from '../../ui/Metas';
import { ListaTareas } from '../../ui/Tareas';
import { Barra, C, Cel, F, Seccion, Toque, Txt } from '../../ui/tema';

export default function CrewPantalla() {
  const { mision } = useFunciones();
  return mision ? <CrewNave /> : <CrewDiaria />;
}

function CrewDiaria() {
  const crew = useCrew(), s = useSesion(), { tp } = useIdioma();
  if (!crew) return <SinCrew />;
  return (
    <Pantalla titulo={crew.nombre} sub={tp(crew.miembros.length, '{n} person', '{n} people')}>
      {s.crews.length > 1 ? <CambiarCrew /> : null}
      <Momento crew={crew} />
      <View style={{ marginTop: 8 }}><TarjetaStandup crew={crew} /></View>
      <HistoriasHoy crew={crew} />
      <Calendario crew={crew} />
      <Equipo crew={crew} />
      <SeccionMetas crew={crew} />
      <TareasCrew crew={crew} />
      <TarjetaGithubCrew crew={crew} />
      <Retos crew={crew} />
      <PulsoHoy crew={crew} />
      <Invitar crew={crew} />
    </Pantalla>
  );
}

function CambiarCrew() {
  const s = useSesion();
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
      {s.crews.map(c => {
        const on = c.id === s.crewId;
        return (
          <Pressable key={c.id} onPress={() => elegirCrew(c.id)} style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', backgroundColor: on ? C.nova : 'transparent', borderWidth: on ? 0 : 1, borderColor: C.l2 }}>
            <Txt f="m" size={13.5} color={on ? C.tinta : C.t2}>{c.nombre}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** el momento de hoy: antes es sorpresa; al llegar hay 10 minutos «a tiempo» con su cuenta; después, quién compartió */
function Momento({ crew }: { crew: Crew }) {
  const { t, tp } = useIdioma(), { usuario } = useSesion(), ahora = useAhora(1000);
  const m = crew.hoy.momento, abierto = ahora >= m && ahora - m < 10 * 60e3, paso = ahora >= m + 10 * 60e3;
  const yaSubi = !!usuario && crew.hoy.subieron.includes(usuario.id), n = crew.hoy.subieron.length;
  const resta = Math.max(0, m + 10 * 60e3 - ahora), mm = Math.floor(resta / 60e3), ss = Math.floor((resta % 60e3) / 1000);
  const col = abierto ? C.nova : C.t2;
  return (
    <Cel style={{ padding: 0, overflow: 'hidden', borderColor: abierto ? 'rgba(143,230,245,0.35)' : C.l1 }}>
      <View style={{ padding: 18, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {abierto ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.nova }} /> : <Ionicons name="sparkles-outline" size={14} color={C.t2} />}
          <Txt f="m" size={13} color={col} style={{ flex: 1 }} numberOfLines={1}>{t(abierto ? 'Crew moment · now' : 'Crew moment')}</Txt>
          <Txt f="monoR" size={12.5} color={C.t3} accessibilityLabel={tp(n, '{n} of {total} shared', '{n} of {total} shared', { total: crew.miembros.length })}>{n}/{crew.miembros.length}</Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <View style={{ flex: 1 }}>
            {abierto ? (
              <>
                <Txt f="l" size={52} ls={-2.5} lh={56}>{mm}:{String(ss).padStart(2, '0')}</Txt>
                <Txt size={14} color={C.t2}>{t('left to share on time')}</Txt>
              </>
            ) : (
              <>
                <Txt f="s" size={20} ls={-0.5} lh={25}>{paso ? (yaSubi ? t('You shared today') : t("Today's moment already passed")) : t("Today's moment is a surprise")}</Txt>
                <Txt size={14} lh={20} color={C.t2} style={{ marginTop: 4 }}>{paso ? t('You can still share a photo anytime.') : t('Nova lets everyone know at the same time. You get 10 minutes.')}</Txt>
              </>
            )}
          </View>
          <View style={{ width: 76, height: 76, alignItems: 'center', justifyContent: 'center' }}>
            <NovaOrb size={110} halo={false} orbes={abierto ? 2 : 0} expr={abierto ? 'sorprendida' : yaSubi ? 'feliz' : 'pensativa'} />
          </View>
        </View>
        {abierto ? <View style={{ marginTop: 14 }}><Barra v={resta / (10 * 60e3)} color={C.nova} /></View> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}>
          {crew.miembros.map(mi => {
            const ok = crew.hoy.subieron.includes(mi.id);
            return (
              <View key={mi.id}>
                <AvatarMiembro u={mi} size={34} anillo={ok ? colorDe(mi.id) : undefined} apagado={!ok} />
                {ok ? <View style={{ position: 'absolute', right: -2, bottom: -2, width: 15, height: 15, borderRadius: 8, backgroundColor: C.ok, borderWidth: 2, borderColor: C.s1, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="checkmark" size={9} color={C.bg} /></View> : null}
              </View>
            );
          })}
        </View>
      </View>
      <Pressable onPress={() => router.push({ pathname: '/compartir', params: abierto ? { momento: '1' } : {} })} accessibilityRole="button" accessibilityLabel={t(abierto ? 'Share my moment' : 'Share a photo')}
        style={({ pressed }) => ({ height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: abierto ? (pressed ? C.sig : C.nova) : pressed ? C.s2 : 'transparent', borderTopWidth: abierto ? 0 : 1, borderTopColor: C.l1 })}>
        <Ionicons name="camera" size={19} color={abierto ? C.tinta : C.nova} />
        <Txt f="s" size={15.5} color={abierto ? C.tinta : C.nova}>{t(abierto ? 'Share my moment' : 'Share a photo')}</Txt>
      </Pressable>
    </Cel>
  );
}

/** los miembros como círculos: con anillo de color si compartieron hoy; tocar abre sus historias */
function HistoriasHoy({ crew }: { crew: Crew }) {
  const { t, tp } = useIdioma();
  const { datos } = useFotos(crew.id, crew.hoy.fecha, crew.hoy.fecha);
  const fotos = datos ?? [];
  const orden = [...crew.miembros].sort((a, b) => Number(fotos.some(f => f.usuario === b.id)) - Number(fotos.some(f => f.usuario === a.id)));
  // columnas según cuántos son, para filas parejas que llenan el ancho (4 → 4, 6 → 3+3, 7 → 4+3, 10 → 5+5)
  const { width } = useWindowDimensions(), W = Math.min(width, 520) - 40, n = orden.length;
  const cols = n <= 5 ? Math.max(1, n) : Math.ceil(n / Math.ceil(n / 5)), G = 10;
  const celda = (W - G * (cols - 1)) / cols, aro = Math.min(78, celda - 4);
  return (
    <>
      <Seccion t={t('Today')} nota={fotos.length ? tp(fotos.length, '{n} photo', '{n} photos') : undefined} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: G, rowGap: 14 }}>
        {orden.map(m => {
          const suyas = fotos.filter(f => f.usuario === m.id), ultima = suyas[0];
          return (
            <Pressable key={m.id} disabled={!suyas.length} onPress={() => router.push({ pathname: '/historias', params: { fecha: crew.hoy.fecha, u: m.id } })} style={{ alignItems: 'center', width: celda, gap: 6 }} accessibilityLabel={m.nombre}>
              <View style={{ width: aro, height: aro, borderRadius: aro / 2, borderWidth: 2.5, borderColor: suyas.length ? colorDe(m.id) : C.l2, padding: 3 }}>
                {ultima ? <Image source={imagen(ultima.mini)} style={{ flex: 1, borderRadius: aro / 2 }} contentFit="cover" transition={150} /> : <AvatarMiembro u={m} size={aro - 11} apagado />}
                {suyas.some(x => x.video) ? <View style={{ position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: C.bg, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="play" size={10} color={C.t1} style={{ marginLeft: 1 }} /></View> : null}
              </View>
              <Txt size={12.5} color={suyas.length ? C.t1 : C.t3} numberOfLines={1}>{m.nombre.split(/\s+/)[0]}</Txt>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

const DIAS_SEMANA = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** calendario del mes con la primera foto de cada día de portada; tocar un día abre las historias de ese día */
function Calendario({ crew }: { crew: Crew }) {
  const { t, locale } = useIdioma();
  const [mes, setMes] = useState(crew.hoy.fecha.slice(0, 7));
  const { datos } = useCalendario(crew.id, mes);
  const [a, m] = mes.split('-').map(Number);
  const primero = (new Date(a, m - 1, 1).getDay() + 6) % 7, dias = new Date(a, m, 0).getDate();
  const celdas: (number | null)[] = [...Array(primero).fill(null), ...Array.from({ length: dias }, (_, i) => i + 1)];
  while (celdas.length % 7) celdas.push(null);
  const semanas = Array.from({ length: celdas.length / 7 }, (_, i) => celdas.slice(i * 7, i * 7 + 7));
  const mover = (d: number) => { const f = new Date(a, m - 1 + d, 1); setMes(`${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`); };
  const esActual = mes >= crew.hoy.fecha.slice(0, 7);
  const nombreMes = mayus(new Date(a, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' }));
  return (
    <>
      <Seccion t={t('Calendar')} nota={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={() => mover(-1)} hitSlop={10} accessibilityLabel={t('Previous month')}><Ionicons name="chevron-back" size={18} color={C.t2} /></Pressable>
          <Txt f="m" size={13.5} color={C.t2}>{nombreMes}</Txt>
          <Pressable onPress={() => !esActual && mover(1)} hitSlop={10} accessibilityLabel={t('Next month')}><Ionicons name="chevron-forward" size={18} color={esActual ? C.l2 : C.t2} /></Pressable>
        </View>
      } />
      <Cel style={{ padding: 10 }}>
        <View style={{ flexDirection: 'row', marginBottom: 6 }}>
          {DIAS_SEMANA.map(d => <Txt key={d} f="m" size={11} color={C.t3} style={{ flex: 1, textAlign: 'center' }}>{t(d).slice(0, 2)}</Txt>)}
        </View>
        {semanas.map((s, i) => (
          <View key={i} style={{ flexDirection: 'row' }}>
            {s.map((d, j) => {
              const fecha = d ? `${mes}-${String(d).padStart(2, '0')}` : '', dia = d ? datos?.dias[fecha] : undefined, hoy = fecha === crew.hoy.fecha;
              return (
                <View key={j} style={{ flex: 1, aspectRatio: 1, padding: 2 }}>
                  {d ? (
                    <Pressable disabled={!dia} onPress={() => router.push({ pathname: '/historias', params: { fecha } })} accessibilityLabel={fecha}
                      style={{ flex: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: dia ? C.s2 : 'transparent', borderWidth: hoy ? 1.5 : 0, borderColor: C.nova, alignItems: 'center', justifyContent: 'center' }}>
                      {dia ? <Image source={imagen(dia.portada)} style={{ position: 'absolute', inset: 0 }} contentFit="cover" transition={150} /> : null}
                      {dia ? <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(5,8,12,0.25)' }} /> : null}
                      <Txt f={dia ? 's' : 'r'} size={12.5} color={dia ? '#fff' : hoy ? C.nova : C.t3}>{d}</Txt>
                      {dia && dia.personas.length > 1 ? <View style={{ position: 'absolute', bottom: 3, right: 4 }}><Txt f="s" size={9.5} color="#fff">{dia.personas.length}</Txt></View> : null}
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </Cel>
    </>
  );
}

/** las tareas compartidas, con el avance de la crew */
function TareasCrew({ crew }: { crew: Crew }) {
  const { t } = useIdioma(), { datos } = useTareas();
  const tareas = (datos ?? []).filter(x => x.crew === crew.id);
  const hechas = tareas.filter(x => x.hecha).length;
  return (
    <>
      <Seccion t={t('Crew tasks')} nota={tareas.length ? t('{a} of {b} done', { a: hechas, b: tareas.length }) : undefined} />
      {tareas.length ? (
        <View style={{ marginBottom: 8, paddingHorizontal: 2 }}><Barra v={hechas / tareas.length} color={C.ok} /></View>
      ) : null}
      <ListaTareas tareas={tareas} crew={crew.id} vacia={t('Things you do together: plans, the hackathon, the trip. Everyone sees them and anyone can tick them off.')} />
    </>
  );
}

const METRICA: Record<Reto['metrica'], { u: string; icono: keyof typeof Ionicons.glyphMap }> = {
  pasos: { u: 'steps', icono: 'footsteps-outline' }, focoMin: { u: 'focus min', icono: 'timer-outline' }, ejercicioMin: { u: 'exercise min', icono: 'barbell-outline' },
  aprendizajeMin: { u: 'learning min', icono: 'school-outline' }, fotos: { u: 'photo days', icono: 'camera-outline' }, tareas: { u: 'tasks', icono: 'checkmark-done-outline' },
};
const num = (n: number, locale: string) => Math.round(n).toLocaleString(locale);

function Retos({ crew }: { crew: Crew }) {
  const { t, locale } = useIdioma(), { datos } = useRetos(crew.id), ahora = useAhora(60e3);
  const retos = datos ?? [];
  return (
    <>
      <Seccion t={t('Challenges')} nota={
        <Pressable onPress={() => router.push('/reto')} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="add" size={16} color={C.nova} /><Txt f="m" size={13.5} color={C.nova}>{t('New')}</Txt>
        </Pressable>
      } />
      {!retos.length ? (
        <Toque onPress={() => router.push('/reto')} label={t('Start a challenge')}>
          <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: C.avisoSuave, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="trophy-outline" size={19} color={C.aviso} /></View>
            <View style={{ flex: 1 }}>
              <Txt f="s" size={15.5}>{t('Start a challenge')}</Txt>
              <Txt size={13} lh={18} color={C.t2}>{t('100,000 steps this week together, 10 hours of focus, a photo every day…')}</Txt>
            </View>
          </Cel>
        </Toque>
      ) : retos.map((r, i) => {
        const v = Math.min(1, r.total / r.meta), M = METRICA[r.metrica], lider = Object.entries(r.por).sort((a, b) => b[1] - a[1]);
        const fin = new Date(`${r.hasta}T23:59:59`), dias = Math.ceil((+fin - ahora) / 864e5);
        return (
          <Cel key={r.id} style={{ marginTop: i ? 8 : 0, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name={M.icono} size={16} color={v >= 1 ? C.ok : C.aviso} />
              <Txt f="s" size={15.5} style={{ flex: 1 }}>{r.titulo}</Txt>
              <Txt size={12.5} color={C.t3}>{dias > 0 ? t('{n} days left', { n: dias }) : t('Finished')}</Txt>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Txt f="l" size={28} ls={-1}>{num(r.total, locale)}</Txt>
              <Txt size={13} color={C.t2}>/ {num(r.meta, locale)} {t(M.u)}</Txt>
            </View>
            <Barra v={v} color={v >= 1 ? C.ok : C.aviso} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {lider.map(([id, n]) => {
                const mi = crew.miembros.find(x => x.id === id);
                return mi ? (
                  <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <AvatarMiembro u={mi} size={22} />
                    <Txt size={13} color={n ? C.t1 : C.t3}>{num(n, locale)}</Txt>
                  </View>
                ) : null;
              })}
            </View>
          </Cel>
        );
      })}
    </>
  );
}

/** cómo va el día de cada uno (solo lo que cada persona decidió compartir); el anillo del avatar es su nivel de hoy
    y tocar abre la salud de la crew con los últimos 7 días */
function PulsoHoy({ crew }: { crew: Crew }) {
  const { t, locale } = useIdioma(), ahora = useAhora(10 * 60e3), { usuario } = useSesion();
  const { datos } = useEstados(crew.id, rango7(ahora).desde, rango7(ahora).hasta);
  const hoy = fechaDe(ahora);
  const por = new Map<string, EstadoDia>((datos ?? []).filter(e => e.fecha === hoy).map(e => [e.usuario, e]));
  const salud = new Map(saludCrew(crew.miembros.map(m => m.id), datos ?? [], ahora).map(s => [s.usuario, s]));
  if (!datos?.length) return null;
  const caras = ['sad-outline', 'sad-outline', 'remove-circle-outline', 'happy-outline', 'happy-outline'] as const;
  const preocupa = [...salud.values()].filter(s => s.usuario !== usuario?.id && s.racha >= 3).sort((a, b) => b.racha - a.racha)[0];
  const quien = preocupa ? crew.miembros.find(m => m.id === preocupa.usuario)?.nombre.split(/\s+/)[0] : null;
  return (
    <>
      <Seccion t={t('How everyone is doing')} nota={
        <Pressable onPress={() => router.push('/crew-salud')} hitSlop={8} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Txt f="m" size={13} color={C.nova}>{t('Wellbeing')}</Txt>
          <Ionicons name="chevron-forward" size={14} color={C.nova} />
        </Pressable>
      } />
      <Pressable onPress={() => router.push('/crew-salud')} accessibilityRole="button" accessibilityLabel={t('Crew wellbeing')}>
        <Cel style={{ paddingVertical: 4 }}>
          {preocupa && quien ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11 }}>
              <Ionicons name="heart-outline" size={16} color={C.alerta} />
              <Txt size={13.5} lh={18} color={C.t1} style={{ flex: 1 }}>{t('{n} has had {d} rough days in a row. Check in with them.', { n: quien, d: preocupa.racha })}</Txt>
            </View>
          ) : null}
          {crew.miembros.map((m, i) => {
            const e = por.get(m.id), s = salud.get(m.id), d = s ? ultimoDia(s) : null;
            return (
              <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderTopWidth: i || (preocupa && quien) ? 1 : 0, borderTopColor: C.l1 }}>
                <AvatarMiembro u={m} size={32} apagado={!e} anillo={d ? COLOR_NIVEL[d.nivel] : undefined} />
                <Txt f="m" size={14.5} style={{ flex: 1 }} numberOfLines={1}>{m.nombre.split(/\s+/)[0]}</Txt>
                {e ? (
                  <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                    {e.suenoH ? <Dato icono="moon-outline" v={`${e.suenoH.toLocaleString(locale, { maximumFractionDigits: 1 })}h`} /> : null}
                    {e.pasos != null ? <Dato icono="footsteps-outline" v={num(e.pasos, locale)} /> : null}
                    {e.focoMin ? <Dato icono="timer-outline" v={`${e.focoMin}m`} /> : null}
                    {e.animo ? <Ionicons name={caras[e.animo - 1]} size={17} color={e.animo >= 4 ? C.ok : e.animo <= 2 ? C.aviso : C.t2} /> : null}
                  </View>
                ) : <Txt size={12.5} color={C.t3}>{t('not shared yet')}</Txt>}
              </View>
            );
          })}
        </Cel>
      </Pressable>
    </>
  );
}
const Dato = ({ icono, v }: { icono: keyof typeof Ionicons.glyphMap; v: string }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Ionicons name={icono} size={14} color={C.t3} /><Txt f="m" size={13}>{v}</Txt></View>
);

function Invitar({ crew }: { crew: Crew }) {
  const { t } = useIdioma();
  const compartir = () => Share.share({ message: t('Join my crew on NOVA with the code {c}', { c: crew.codigo }) }).catch(() => {});
  return (
    <Toque onPress={compartir} label={t('Invite to the crew')} style={{ marginTop: 24 }}>
      <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: C.sigSuave, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="person-add-outline" size={19} color={C.nova} /></View>
        <View style={{ flex: 1 }}>
          <Txt f="s" size={15.5}>{t('Invite to the crew')}</Txt>
          <Txt size={13} color={C.t2}>{t('Code')} <Txt f="mono" size={13.5} color={C.t1} ls={1.5}>{crew.codigo}</Txt></Txt>
        </View>
        <Ionicons name="share-outline" size={18} color={C.t3} />
      </Cel>
    </Toque>
  );
}

/** sin crew: crear una o unirse con el código que te pasaron */
function SinCrew() {
  const { t } = useIdioma();
  const [modo, setModo] = useState<'unirse' | 'crear'>('unirse'), [v, setV] = useState(''), [cargando, setCargando] = useState(false), [error, setError] = useState<string | null>(null);
  const ok = modo === 'unirse' ? v.trim().length >= 6 : v.trim().length >= 2;
  const enviar = async () => {
    if (!ok || cargando) return;
    setCargando(true); setError(null);
    try { if (modo === 'unirse') await unirseCrew(v); else await crearCrew(v); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }
    catch (e) { setError(t((e as Error).message)); }
    finally { setCargando(false); }
  };
  return (
    <Pantalla titulo={t('Crew')} sub={t('The people you use NOVA with')}>
      <View style={{ alignItems: 'center', marginTop: 4 }}><NovaOrb size={150} orbes={2} expr="feliz" /></View>
      <Txt size={15.5} lh={23} color={C.t2} style={{ textAlign: 'center', marginTop: 4, marginBottom: 20, paddingHorizontal: 10 }}>
        {t('Share a spontaneous photo every day, keep tasks together, set challenges and see how everyone is doing.')}
      </Txt>
      <Cel style={{ padding: 6, flexDirection: 'row', gap: 6 }}>
        {(['unirse', 'crear'] as const).map(k => (
          <Pressable key={k} onPress={() => { setModo(k); setV(''); setError(null); }} style={{ flex: 1, height: 44, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: modo === k ? C.nova : 'transparent' }}>
            <Txt f="s" size={14.5} color={modo === k ? C.tinta : C.t2}>{t(k === 'unirse' ? 'Join with a code' : 'Create a crew')}</Txt>
          </Pressable>
        ))}
      </Cel>
      <TextInput value={v} onChangeText={x => setV(modo === 'unirse' ? x.toUpperCase() : x)} placeholder={t(modo === 'unirse' ? 'Crew code' : 'Crew name')} placeholderTextColor={C.t3}
        autoCapitalize={modo === 'unirse' ? 'characters' : 'words'} maxLength={modo === 'unirse' ? 6 : 40} onSubmitEditing={enviar} returnKeyType="go"
        style={{ marginTop: 10, height: 54, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, paddingHorizontal: 18, color: C.t1, fontFamily: modo === 'unirse' ? F.mono : F.r, fontSize: modo === 'unirse' ? 20 : 16, letterSpacing: modo === 'unirse' ? 4 : 0, textAlign: modo === 'unirse' ? 'center' : 'left' }} />
      {error ? <Txt size={14} color={C.alerta} style={{ marginTop: 8, paddingHorizontal: 4 }}>{error}</Txt> : null}
      <Pressable onPress={enviar} disabled={!ok} style={({ pressed }) => ({ marginTop: 12, height: 52, borderRadius: 26, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', opacity: ok ? (pressed ? 0.8 : 1) : 0.4 })}>
        {cargando ? <ActivityIndicator color={C.tinta} /> : <Txt f="s" size={16} color={C.tinta}>{t(modo === 'unirse' ? 'Join' : 'Create')}</Txt>}
      </Pressable>
    </Pantalla>
  );
}

/** el equipo en acción: actas de reunión, retro, reconocimientos, carga y conexiones (Slack, Discord, Notion) */
function Equipo({ crew }: { crew: Crew }) {
  const { t } = useIdioma();
  const ir = (r: '/acta' | '/retro' | '/kudos' | '/carga' | '/crew-conexiones') => { Haptics.selectionAsync().catch(() => {}); router.push(r); };
  const b = (k: string, d: string, icono: keyof typeof Ionicons.glyphMap, color: string, r: Parameters<typeof ir>[0]) => (
    <Pressable key={k} onPress={() => ir(r)} accessibilityRole="button" style={({ pressed }) => ({ width: '48.5%', minHeight: 132, padding: 14, borderRadius: 20, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1, gap: 8, opacity: pressed ? 0.75 : 1 })}>
      <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: `${color}1f`, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icono} size={17} color={color} /></View>
      <View>
        <Txt f="s" size={14.5}>{k}</Txt>
        <Txt size={12} lh={16} color={C.t3} numberOfLines={2}>{d}</Txt>
      </View>
    </Pressable>
  );
  return (
    <>
      <Seccion t={t('Team')} nota={<Pressable onPress={() => ir('/crew-conexiones')} hitSlop={8}><Txt f="m" size={13} color={C.nova}>{t('Connections')}</Txt></Pressable>} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 }}>
        {b(t('Meeting notes'), t('Record it, Nova writes decisions and tasks'), 'reader-outline', C.lila, '/acta')}
        {b(t('Workload'), t('Who has too much, who has room'), 'speedometer-outline', C.nova, '/carga')}
        {b(t('Weekly retro'), t('What worked, what to improve'), 'repeat-outline', C.aviso, '/retro')}
        {b(t('Kudos'), t('Thank someone for something concrete'), 'heart-outline', C.alerta, '/kudos')}
      </View>
    </>
  );
}
