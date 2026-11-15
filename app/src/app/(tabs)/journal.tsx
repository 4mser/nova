/* Journal: la pestaña para registrar cómo estás, con datos que sirven.
   · registro del día de un toque: 6 escalas de un ítem (1–5), emociones y «lo bueno de hoy»; se guarda solo
   · entradas escritas con la pregunta del día de NOVA
   · el mes como calendario de ánimo, tendencias de 14 días y hallazgos calculados con tus propios registros
   · línea de tiempo con búsqueda y filtros
   Privado: queda en el teléfono. NOVA solo lee los números del registro si lo autorizas. */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { animoDe, cargarDiario, ESCALAS, etiquetas, fechaDe, nombreDia, nivelDe, permitirNova, preguntaDelDia, racha, solDe, useDiario, type Entrada, type Escala, type Registro } from '../../engine/diario';
import { mayus, useIdioma, type Traductor } from '../../i18n';
import { useFunciones } from '../../engine/funciones';
import { hoy } from '../../engine/motor';
import { NovaOrb } from '../../nova/NovaOrb';
import { CheckIn, colorNivel } from '../../ui/CheckIn';
import { Chip, COLOR_ANIMO, Editor, EntradaVista } from '../../ui/DiarioUI';
import { Serie } from '../../ui/Graficos';
import { Interruptor } from '../../ui/Interruptor';
import { BajoTitulo, Pantalla, Selector } from '../../ui/Pantalla';
import { BitacoraCrew } from '../../ui/BitacoraCrew';
import { useDia } from '../../ui/ahora';
import { useCrew } from '../../cuenta/sesion';
import { C, Cel, F, Lbl, Seccion, Txt } from '../../ui/tema';

/** calendario del mes: semanas de lunes a domingo, cada día con datos coloreado por tu ánimo, hoy con borde,
    los días futuros atenuados; flechas para ver meses anteriores */
const DIAS_SEMANA = { en: ['M', 'T', 'W', 'T', 'F', 'S', 'S'], es: ['L', 'M', 'M', 'J', 'V', 'S', 'D'] };
function Mes({ registros, entradas, ahora }: { registros: Record<string, Registro>; entradas: Entrada[]; ahora: number }) {
  const tr = useIdioma(), { t } = tr;
  const [desfase, setDesfase] = useState(0); // 0 = este mes, -1 = el anterior…
  const [sel, setSel] = useState(() => fechaDe(ahora)); // el día que se ve abajo
  const base = new Date(ahora); base.setDate(1); base.setMonth(base.getMonth() + desfase);
  const anio = base.getFullYear(), mes = base.getMonth();
  const enMes = new Date(anio, mes + 1, 0).getDate();
  const vacios = (new Date(anio, mes, 1).getDay() + 6) % 7; // lunes primero
  const hoyF = fechaDe(ahora);
  const sep = 6;
  const animoDe = (f: string) => {
    const r = registros[f]?.valores.animo;
    if (r) return r;
    const es = entradas.filter(e => fechaDe(e.ts) === f);
    return es.length ? Math.round(es.reduce((a, e) => a + e.animo + 1, 0) / es.length) : undefined;
  };
  const celdas: (number | null)[] = [...Array(vacios).fill(null), ...Array.from({ length: enMes }, (_, i) => i + 1)];
  while (celdas.length % 7) celdas.push(null);
  const semanas = Array.from({ length: celdas.length / 7 }, (_, i) => celdas.slice(i * 7, i * 7 + 7));
  const nombre = mayus(base.toLocaleDateString(tr.locale, { month: 'long', year: 'numeric' }));
  const conDatos = Array.from({ length: enMes }, (_, i) => fechaDe(+new Date(anio, mes, i + 1))).filter(f => animoDe(f)).length;
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Pressable onPress={() => setDesfase(d => d - 1)} hitSlop={10} accessibilityLabel={t('Previous month')} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s2 }}>
          <Ionicons name="chevron-back" size={16} color={C.t2} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Txt f="s" size={15.5}>{nombre}</Txt>
          <Txt size={12} color={C.t3}>{conDatos ? tr.tp(conDatos, '{n} day logged', '{n} days logged') : t('No days logged')}</Txt>
        </View>
        <Pressable onPress={() => setDesfase(d => Math.min(0, d + 1))} disabled={desfase === 0} hitSlop={10} accessibilityLabel={t('Next month')} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s2, opacity: desfase === 0 ? 0.35 : 1 }}>
          <Ionicons name="chevron-forward" size={16} color={C.t2} />
        </Pressable>
      </View>
      <View style={{ gap: sep }}>
        <View style={{ flexDirection: 'row', gap: sep }}>
          {DIAS_SEMANA[tr.idioma].map((d, i) => <Txt key={i} size={11.5} color={C.t3} style={{ flex: 1, textAlign: 'center' }}>{d}</Txt>)}
        </View>
        {semanas.map((sem, w) => (
          <View key={w} style={{ flexDirection: 'row', gap: sep }}>
            {sem.map((dia, i) => {
              if (dia === null) return <View key={`v${i}`} style={{ flex: 1, aspectRatio: 1 }} />;
              const f = fechaDe(+new Date(anio, mes, dia)), v = animoDe(f), esHoy = f === hoyF, futuro = f > hoyF;
              const elegido = f === sel;
              return (
                <Pressable key={f} disabled={futuro} onPress={() => setSel(f)} accessibilityLabel={t('Day {n}', { n: dia })} accessibilityState={{ selected: elegido }}
                  style={{ flex: 1, aspectRatio: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: v ? COLOR_ANIMO[v - 1] : futuro ? 'transparent' : C.s2, borderWidth: elegido || esHoy ? 2 : futuro ? 1 : 0, borderColor: elegido ? C.t1 : esHoy ? C.t3 : C.l1, opacity: futuro ? 0.45 : 1 }}>
                  <Txt f={esHoy || elegido ? 's' : 'r'} size={12.5} color={v ? C.bg : elegido || esHoy ? C.t1 : C.t3}>{dia}</Txt>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
        {ESCALAS[0].niveles.map((k, i) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: COLOR_ANIMO[i] }} />
            <Txt size={10.5} color={C.t3}>{nivelDe(tr, ESCALAS[0], i + 1)}</Txt>
          </View>
        ))}
      </View>
      <Dia f={sel} r={registros[sel]} es={entradas.filter(e => fechaDe(e.ts) === sel)} hoyF={hoyF} />
    </View>
  );
}

/** lo de un día del calendario: ánimo, el resto de las escalas, emociones y cuántas entradas escribiste */
function Dia({ f, r, es, hoyF }: { f: string; r?: Registro; es: Entrada[]; hoyF: string }) {
  const tr = useIdioma(), { t } = tr;
  const [a, m, d] = f.split('-').map(Number);
  const titulo = f === hoyF ? t('Today') : mayus(new Date(a, m - 1, d).toLocaleDateString(tr.locale, { weekday: 'long', month: 'long', day: 'numeric' }));
  const animoE = es.length ? Math.round(es.reduce((s, e) => s + e.animo + 1, 0) / es.length) : undefined;
  const animo = r?.valores.animo ?? animoE;
  const otras = ESCALAS.filter(e => e.id !== 'animo' && r?.valores[e.id] != null);
  const vacio = !r && !es.length;
  return (
    <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.l1, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Txt f="s" size={15} style={{ flex: 1 }}>{titulo}</Txt>
        {animo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLOR_ANIMO[animo - 1] }} />
            <Txt f="m" size={13} color={COLOR_ANIMO[animo - 1]}>{t('{nivel} mood', { nivel: nivelDe(tr, ESCALAS[0], animo) })}</Txt>
          </View>
        ) : null}
      </View>
      {vacio ? (
        <Txt size={13.5} color={C.t3}>{t(f === hoyF ? 'Nothing logged yet today.' : 'Nothing logged this day.')}</Txt>
      ) : (
        <>
          {otras.length ? (
            <Txt size={13.5} lh={19} color={C.t2}>{otras.map(e => t('{escala} {nivel}', { escala: t(e.t), nivel: nivelDe(tr, e, r!.valores[e.id]!).toLowerCase() })).join(' · ')}</Txt>
          ) : null}
          {r?.emociones.length ? <Txt size={13.5} color={C.lila}>{r.emociones.map(x => t(x)).join(', ')}</Txt> : null}
          {r?.bueno ? <Txt size={13.5} lh={19} color={C.t1}>“{r.bueno}”</Txt> : null}
          {es.length ? <Txt size={12.5} color={C.t3}>{tr.tp(es.length, '{n} entry', '{n} entries')}{animoE && !r?.valores.animo ? t(', {animo} on average', { animo: animoDe(tr, animoE - 1).toLowerCase() }) : ''}</Txt> : null}
        </>
      )}
    </View>
  );
}

/** hallazgos simples con tus propios registros (diferencia de promedios), solo si hay datos suficientes */
function hallazgos(regs: Registro[], { t }: Traductor) {
  const out: string[] = [];
  const comparar = (a: Escala, b: Escala, txtAlto: string, txtBajo: string) => {
    const conAmbos = regs.filter(r => r.valores[a] != null && r.valores[b] != null);
    const altos = conAmbos.filter(r => r.valores[a]! >= 4), bajos = conAmbos.filter(r => r.valores[a]! <= 2);
    if (altos.length < 2 || bajos.length < 2) return;
    const m = (rs: Registro[]) => rs.reduce((s, r) => s + r.valores[b]!, 0) / rs.length;
    const dif = m(altos) - m(bajos);
    if (Math.abs(dif) >= 0.7) out.push(t('On days {alto}, your {escala} averaged {a}, against {b} on days {bajo}.', { alto: t(txtAlto), escala: t(ESCALAS.find(e => e.id === b)!.t).toLowerCase(), a: m(altos).toFixed(1), b: m(bajos).toFixed(1), bajo: t(txtBajo) }));
  };
  comparar('sueno', 'animo', 'you slept well', 'you slept poorly');
  comparar('conexion', 'animo', 'you felt close to the crew', 'you felt isolated');
  comparar('carga', 'estres', 'with a heavy workload', 'with a light one');
  comparar('energia', 'animo', 'with high energy', 'with low energy');
  return out;
}

function BitacoraPersonal() {
  const { width } = useWindowDimensions(), tr = useIdioma(), { t } = tr;
  const W = Math.min(width, 520) - 40, H = hoy(tr);
  const { entradas, compartir, registros, novaLee, cargado } = useDiario(), { mision } = useFunciones();
  useEffect(() => { cargarDiario(); }, []);
  // «hoy» cambia a medianoche: la pestaña queda montada días enteros (el render no puede leer el reloj)
  const ahora = useDia();
  const hoyR = registros[fechaDe(ahora)];
  const [editando, setEditando] = useState<Entrada | 'nueva' | null>(null);
  const [buscar, setBuscar] = useState('');
  const [filtro, setFiltro] = useState<string | null>(null);

  const ultimos14 = useMemo(() => Array.from({ length: 14 }, (_, i) => registros[fechaDe(ahora - (13 - i) * 864e5)]), [registros, ahora]);
  const serie = (e: Escala) => ultimos14.map(r => r?.valores[e]).filter((x): x is number => x != null);
  const ideas = useMemo(() => hallazgos(Object.values(registros), tr), [registros, tr]);
  const diasConRegistro = Object.keys(registros).length;

  const visibles = useMemo(() => entradas.filter(e => (!filtro || e.etiquetas.includes(filtro)) && (!buscar.trim() || e.texto.toLowerCase().includes(buscar.trim().toLowerCase()))), [entradas, filtro, buscar]);
  const porSol = useMemo(() => {
    const m = new Map<number, Entrada[]>();
    visibles.forEach(e => { const s = solDe(e.ts); m.set(s, [...(m.get(s) ?? []), e]); });
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [visibles]);
  const usadas = useMemo(() => [...new Set([...etiquetas(), ...entradas.flatMap(e => e.etiquetas)])].filter(t => entradas.some(e => e.etiquetas.includes(t))), [entradas]);

  return (
    <Pantalla titulo={t('Log')} sub={mision ? t('Sol {n} · private, on this phone', { n: H.sol }) : t('Personal · private, on this phone')}>
      {/* check-in del día */}
      {/* parte de nuevo al cargar el diario y al cambiar el día, no con la primera respuesta: elegir una emoción
          habiendo saltado las escalas devolvía a la pregunta 1 */}
      <CheckIn key={`${fechaDe(ahora)}${cargado ? '' : '…'}`} hoyR={hoyR} />

      {/* permiso para NOVA */}
      <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8, paddingVertical: 12 }}>
        <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}><NovaOrb size={44} halo={false} orbes={0} expr="feliz" /></View>
        <View style={{ flex: 1 }}>
          <Txt f="m" size={14.5}>{t('Let Nova use your log')}</Txt>
          <Txt size={12.5} lh={17} color={C.t3}>{t('Only the numbers, never what you write.')}</Txt>
        </View>
        <Interruptor on={novaLee} label={t('Let Nova use your log')} onChange={permitirNova} />
      </Cel>

      {/* escribir */}
      <Seccion t={t('Write')} nota={entradas.length ? `${tr.tp(entradas.length, '{n} entry', '{n} entries')} · ${t('{n} sol streak', { n: racha(entradas) })}` : undefined} />
      {editando ? (
        <Editor key={editando === 'nueva' ? 'nueva' : editando.id} inicial={editando === 'nueva' ? undefined : editando} puedeCompartir={compartir} onListo={() => setEditando(null)} />
      ) : (
        <Pressable onPress={() => setEditando('nueva')} accessibilityLabel={t('Write a new entry')}>
          <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}>
            <View style={{ flex: 1 }}>
              <Txt f="m" size={12.5} color={C.lila}>{t("Today's prompt from Nova")}</Txt>
              <Txt size={16} lh={22} style={{ marginTop: 2 }}>{preguntaDelDia(tr)}</Txt>
            </View>
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="create-outline" size={18} color={C.tinta} />
            </View>
          </Cel>
        </Pressable>
      )}

      {/* el mes */}
      <Seccion t={t('Calendar')} nota={t('tap a day to see it')} />
      <Cel>
        <Mes registros={registros} entradas={entradas} ahora={ahora} />
      </Cel>

      {/* tendencias */}
      <Seccion t={t('Trends')} nota={t('last 14 days')} />
      {diasConRegistro >= 2 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(['animo', 'energia', 'estres', 'sueno'] as Escala[]).map(e => {
            const def = ESCALAS.find(x => x.id === e)!, s = serie(e), ult = s[s.length - 1];
            return (
              <Cel key={e} style={{ width: (W - 8) / 2, padding: 14 }}>
                <Lbl t={t(def.t)} />
                <Txt f="s" size={20} ls={-0.4} color={ult ? colorNivel(ult, def.altoEsBueno) : C.t3} style={{ marginTop: 6 }}>{ult ? nivelDe(tr, def, ult) : '—'}</Txt>
                <View style={{ marginTop: 8 }}>{s.length >= 2 ? <Serie w={(W - 8) / 2 - 28} h={36} vals={s} col={def.altoEsBueno ? C.sig : C.aviso} /> : <Txt size={12} color={C.t3}>{t('Needs 2 days')}</Txt>}</View>
              </Cel>
            );
          })}
        </View>
      ) : (
        <Cel><Txt size={14} lh={20} color={C.t2}>{t('Log a couple of days and your trends appear here.')}</Txt></Cel>
      )}

      {/* hallazgos */}
      <Seccion t={t('What your log shows')} />
      <Cel style={{ gap: 10 }}>
        {ideas.length ? ideas.map(t => (
          <View key={t} style={{ flexDirection: 'row', gap: 10 }}>
            <Ionicons name="sparkles-outline" size={15} color={C.lila} style={{ marginTop: 3 }} />
            <Txt size={14.5} lh={21} style={{ flex: 1 }}>{t}</Txt>
          </View>
        )) : (
          <Txt size={14} lh={20} color={C.t2}>{diasConRegistro < 4 ? t('After about a week of logs Nova compares your days: sleep and mood, crew and mood, workload and stress. {n} of 7 days so far.', { n: diasConRegistro }) : t('No clear pattern yet. Keep logging; patterns show up after a couple of weeks.')}</Txt>
        )}
        <Txt size={11.5} color={C.t3}>{t('From your own logs. Patterns, not a diagnosis.')}</Txt>
      </Cel>

      {/* línea de tiempo */}
      {entradas.length > 0 && (
        <>
          <Seccion t={t('Entries')} />
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1 }}>
              <Ionicons name="search" size={16} color={C.t3} />
              <TextInput value={buscar} onChangeText={setBuscar} placeholder={t('Search your journal')} placeholderTextColor={C.t3} style={{ flex: 1, color: C.t1, fontFamily: F.r, fontSize: 15 }} />
            </View>
            {usadas.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {usadas.map(k => <Chip key={k} t={t(k)} on={filtro === k} onPress={() => setFiltro(filtro === k ? null : k)} />)}
              </ScrollView>
            )}
          </View>
          {porSol.map(([sol, es]) => (
            <Animated.View key={sol} entering={FadeIn.duration(200)} layout={LinearTransition.duration(200)} style={{ gap: 8, marginTop: 14 }}>
              <Txt f="m" size={13} color={C.t2} style={{ paddingHorizontal: 4 }}>{nombreDia(es[0].ts, tr)}</Txt>
              {es.map(e => <EntradaVista key={e.id} e={e} onEditar={() => setEditando(e)} />)}
            </Animated.View>
          ))}
          {!porSol.length && <Txt size={14} color={C.t3} style={{ textAlign: 'center', marginTop: 16 }}>{t('No entries match.')}</Txt>}
        </>
      )}
    </Pantalla>
  );
}

/** Bitácora: la personal (privada, en el teléfono: check-in, entradas, tendencias) y la de la crew (el registro del
    equipo). Se elige arriba; ?vista=crew abre la del equipo (lo usan los avisos y NOVA). */
export default function Bitacora() {
  const { t } = useIdioma(), crew = useCrew(), { vista: param } = useLocalSearchParams<{ vista?: string }>();
  // lo que elegiste vale mientras no llegue otro parámetro (un aviso que abre la de la crew, por ejemplo)
  const [elegida, setElegida] = useState<{ p?: string; v: 'personal' | 'crew' } | null>(null);
  const vista = elegida && elegida.p === param ? elegida.v : param === 'crew' ? 'crew' : 'personal';
  const setVista = (v: 'personal' | 'crew') => setElegida({ p: param, v });
  const selector = crew ? <Selector opciones={[{ k: 'personal', t: t('Personal'), icono: 'lock-closed-outline' }, { k: 'crew', t: crew.nombre, icono: 'people-outline' }]} valor={vista} onCambio={setVista} /> : null;
  return (
    <BajoTitulo.Provider value={selector}>
      {vista === 'crew' && crew ? (
        <Pantalla titulo={t('Log')} sub={t('Shared with {crew}', { crew: crew.nombre })}><BitacoraCrew crew={crew} /></Pantalla>
      ) : <BitacoraPersonal />}
    </BajoTitulo.Provider>
  );
}
