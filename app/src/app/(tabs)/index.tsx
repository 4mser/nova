/* Today, como el mockup del video: NOVA grande, su parte del día y una grilla de 2×2 con lo que importa. */
import { router } from 'expo-router';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { hh, hoy } from '../../engine/motor';
import { usePerfil } from '../../engine/perfil';
import { NovaDice } from '../../nova/NovaDice';
import { NovaHeroe } from '../../nova/NovaHeroe';
import { useVivo } from '../../sensores/vivo';
import { Anillos, Barritas, TrazaViva } from '../../ui/Graficos';
import { TarjetaRecordatorios } from '../../ui/TusCosas';
import { TarjetaGithub } from '../../ui/GithubHoy';
import { useInicio, type SeccionHoy } from '../../engine/inicio';
import { Pantalla } from '../../ui/Pantalla';
import { Barra, C, Cel, Lbl, Num, Seccion, Toque, Txt } from '../../ui/tema';
import { Ionicons } from '@expo/vector-icons';
import { estadoAgenda, horaNave, MISION } from '../../engine/agenda';
import { ESCALAS, fechaDe, nivelDe, useDiario } from '../../engine/diario';
import { FUENTES, useConsentimiento } from '../../sensores/fuentes';
import { avanceCheckIn, colorNivel } from '../../ui/CheckIn';
import { mayus, useIdioma } from '../../i18n';
import { Image } from 'expo-image';
import { imagen } from '../../cuenta/api';
import { useFotos, useTareas, type Foto, aCargo } from '../../cuenta/datos';
import { useCrew, useSesion } from '../../cuenta/sesion';
import { fraseDelDia, saludo } from '../../engine/dia';
import { minutosDe, useFoco } from '../../engine/foco';
import { useFunciones } from '../../engine/funciones';
import { ListaTareas } from '../../ui/Tareas';
import { TarjetaExternas } from '../../ui/Externas';
import { AvatarMiembro } from '../../ui/Crew';
import { TarjetaHabitos } from '../../ui/Habitos';
import { TarjetaAgenda } from '../../ui/Agenda';
import { TarjetaClima } from '../../ui/Clima';
import { NovaNoto } from '../../ui/NovaNoto';
import { TarjetaStandup } from '../../ui/Standup';
import { useHistoria } from '../../sensores/historia';
import { TarjetaRepaso, TarjetaSemana } from '../../ui/TarjetaRepaso';
import { CasaTarjeta } from '../../ui/CasaTarjeta';
import { miIndice, useNaveEstado, type Nivel } from '../../cuenta/naveEstado';
import { urlEscaner, useNave } from '../../cuenta/nave';
import { Linking } from 'react-native';


export default function Hoy() {
  const { mision } = useFunciones();
  return mision ? <HoyMision /> : <HoyDiario />;
}

/** el scroll (para que el héroe se encoja) y la voz del héroe; NOVA vive además, siempre, en la barra */
function useHeroe() {
  const y = useSharedValue(0), habla = useSharedValue(0);
  return { y, habla };
}

/** reloj que avanza solo (el render no puede leer la hora) */
function useAhora(cada = 30e3) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setAhora(Date.now()), cada); return () => clearInterval(id); }, [cada]);
  return ahora;
}

const META_PASOS = 8000;
const dur = (h: number) => [Math.floor(h), Math.round((h % 1) * 60)] as const;

/** Today en el día a día: NOVA con lo que de verdad sabe, tus números reales, el momento de la crew y tus tareas */
function HoyDiario() {
  const tr = useIdioma(), { t, locale } = tr, { width } = useWindowDimensions();
  const ahora = useAhora(), { y, habla } = useHeroe();
  const { usuario } = useSesion(), crew = useCrew(), vivo = useVivo(), { registros } = useDiario();
  useFoco(); // se redibuja al terminar una sesión de foco
  const { datos: tareas } = useTareas();
  const celda = (Math.min(width, 520) - 40 - 8) / 2, dentro = celda - 32;
  const hoyF = fechaDe(ahora);
  const nombre = (usuario?.nombre ?? '').split(/\s+/)[0];
  const mias = (tareas ?? []).filter(x => !x.crew || aCargo(x).includes(usuario?.id ?? '') || (!aCargo(x).length && x.vence === hoyF));
  const pendientes = mias.filter(x => !x.hecha && (!x.vence || x.vence <= hoyF));
  // si la lectura en vivo de Health Connect aún no llega, se usa lo guardado del día (historia)
  const { dias } = useHistoria(), guardado = dias[fechaDe(ahora)];
  const s = vivo.salud, pasos = s?.pasos ?? guardado?.pasos ?? (vivo.sensores.pasos ? vivo.pasos : undefined), suenoH = s?.sueno?.horas ?? guardado?.suenoH;
  const fc = vivo.reloj.estado === 'conectado' && vivo.fc ? { v: vivo.fc, vivo: true } : s?.fc ? { v: s.fc, vivo: false } : null;
  const focoMin = minutosDe(hoyF);
  const m = crew?.hoy.momento ?? 0, momentoAbierto = !!crew && ahora >= m && ahora - m < 10 * 60e3;
  const frase = fraseDelDia(tr, { ahora, nombre, tareasHoy: pendientes.filter(x => x.vence && x.vence <= hoyF), sinFecha: pendientes.filter(x => !x.vence), checkinHecho: avanceCheckIn(registros[hoyF]).completo, focoMin, pasos, suenoH, momentoAbierto, crewSubieron: crew?.hoy.subieron.length ?? 0, crewTotal: crew?.miembros.length ?? 0 });
  const fecha = mayus(new Date(ahora).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }));
  const [hs, ms] = suenoH != null ? dur(suenoH) : [0, 0];
  const inicio = useInicio();
  const bloques: Record<SeccionHoy, ReactNode> = {
    noto: <NovaNoto />,
    numeros: (
      <>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
        <Toque onPress={() => router.navigate({ pathname: '/salud', params: { seg: 'cuerpo' } })} label={t('Steps')} style={{ width: celda, flex: 1 }}>
          <Cel style={{ flex: 1 }}>
            <Lbl t={t('Steps')} />
            <Num v={pasos != null ? pasos.toLocaleString(locale) : '—'} style={{ marginTop: 10 }} />
            {pasos != null ? <View style={{ marginTop: 14 }}><Barra v={pasos / META_PASOS} color={pasos >= META_PASOS ? C.ok : C.sig} /></View> : null}
            <Txt size={12.5} color={C.t3} style={{ marginTop: 8 }}>{pasos != null ? t('Goal {n}', { n: META_PASOS.toLocaleString(locale) }) : t('Connect your phone or watch')}</Txt>
          </Cel>
        </Toque>
        <Toque onPress={() => router.push('/foco')} label={t('Focus')} style={{ width: celda, flex: 1 }}>
          <Cel style={{ flex: 1 }}>
            <Lbl t={t('Focus')} />
            <Num v={String(focoMin)} u="min" color={focoMin ? C.t1 : C.t2} style={{ marginTop: 10 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 }}>
              <Ionicons name="play-circle" size={18} color={C.nova} />
              <Txt f="m" size={13.5} color={C.nova}>{t(focoMin ? 'Another session' : 'Start a session')}</Txt>
            </View>
          </Cel>
        </Toque>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Toque onPress={() => router.navigate({ pathname: '/salud', params: { seg: 'cuerpo' } })} label={t('Sleep')} style={{ width: celda, flex: 1 }}>
          <Cel style={{ flex: 1 }}>
            <Lbl t={t('Sleep')} />
            {suenoH != null ? (
              <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 10 }}>
                <Num v={String(hs)} u="h" />
                <Num v={` ${String(ms).padStart(2, '0')}`} u="m" />
              </View>
            ) : <Num v="—" style={{ marginTop: 10 }} />}
            <Txt size={12.5} color={C.t3} style={{ marginTop: 8 }}>{suenoH != null ? t('from {apps}', { apps: s?.origenes.join(', ') || 'Health Connect' }) : t('Needs Health Connect')}</Txt>
          </Cel>
        </Toque>
        <Toque onPress={() => router.navigate({ pathname: '/salud', params: { seg: 'cuerpo' } })} label={t('Heart')} style={{ width: celda, flex: 1 }}>
          <Cel style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Lbl t={t('Heart')} style={{ flex: 1 }} />
              {fc?.vivo ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.ok }} /><Txt f="m" size={11.5} color={C.ok}>{t('Live')}</Txt></View> : null}
            </View>
            <Num v={fc ? String(Math.round(fc.v)) : '—'} u={fc ? t('bpm') : undefined} style={{ marginTop: 10 }} />
            {fc?.vivo ? <View style={{ marginTop: 10 }}><TrazaViva w={dentro} h={30} bpm={fc.v} col={C.ok} /></View>
              : <Txt size={12.5} color={C.t3} style={{ marginTop: 8 }}>{fc ? t('Latest, from Health Connect') : t('Connect your watch')}</Txt>}
          </Cel>
        </Toque>
      </View>
      </>
    ),
    semana: <TarjetaSemana />,
    clima: <TarjetaClima />,
    agenda: <TarjetaAgenda ahora={ahora} />,
    standup: crew && new Date(ahora).getDay() % 6 !== 0 ? <TarjetaStandup crew={crew} compacta /> : null,
    crew: crew ? <MomentoCrew /> : null,
    recordatorios: <TarjetaRecordatorios />,
    tareas: (
      <>
        <Seccion t={t('Your tasks')} nota={pendientes.length ? tr.tp(pendientes.length, '{n} left', '{n} left') : undefined} />
        <ListaTareas tareas={mias.filter(x => !x.hecha || (x.hechaTs ?? 0) > ahora - 12 * 3600e3)} crew={null} max={6}
          vacia={t('Write what you want to get done. Only you see these; crew tasks live in Crew.')} />
      </>
    ),
    repaso: <TarjetaRepaso />,
    habitos: <TarjetaHabitos />,
    github: <TarjetaGithub />,
    externas: <TarjetaExternas />,
    checkin: <TarjetaCheckIn />,
    fuentes: <View style={{ marginTop: 8 }}><TarjetaFuentes /></View>,
  };
  return (
    <Pantalla y={y} titulo={`${saludo(tr, ahora)},\n${nombre}`} corto={`${saludo(tr, ahora)}, ${nombre}`} sub={fecha}>
      <NovaHeroe y={y} base={frase.expr === 'sorprendida' ? 'feliz' : frase.expr} habla={habla} />
      <NovaDice texto={frase.texto} habla={habla} sinPorQue voz />
      {/* atajos: una nota rápida por voz siempre; por la mañana, NOVA te cuenta tu día */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 14 }}>
        <Pressable onPress={() => router.push('/nota')} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 7, height: 40, paddingHorizontal: 15, borderRadius: 20, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, opacity: pressed ? 0.8 : 1 })}>
          <Ionicons name="mic-outline" size={16} color={C.t1} />
          <Txt f="s" size={14}>{t('Quick note')}</Txt>
        </Pressable>
        {new Date(ahora).getHours() >= 5 && new Date(ahora).getHours() < 12 ? (
          <Pressable onPress={() => router.push('/buenosdias')} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 7, height: 40, paddingHorizontal: 15, borderRadius: 20, backgroundColor: C.sigSuave, borderWidth: 1, borderColor: `${C.nova}44`, opacity: pressed ? 0.8 : 1 })}>
            <Ionicons name="sunny-outline" size={16} color={C.nova} />
            <Txt f="s" size={14} color={C.nova}>{t('Hear your morning')}</Txt>
          </Pressable>
        ) : null}
      </View>
      {/* el resto, en el orden que elegiste en Personalizar Hoy (las ocultas no aparecen) */}
      {inicio.orden.filter(k => !inicio.ocultas.includes(k)).map(k => <Fragment key={k}>{bloques[k]}</Fragment>)}
      <Pressable onPress={() => router.push('/personalizar')} accessibilityRole="button" style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 22, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: C.l2 }}>
        <Ionicons name="options-outline" size={15} color={C.t2} />
        <Txt f="m" size={13} color={C.t2}>{t('Customize Today')}</Txt>
      </Pressable>
    </Pantalla>
  );
}

/** la crew en Today: fotos de hoy en miniatura y el botón para compartir */
function MomentoCrew() {
  const crew = useCrew()!, { t, tp } = useIdioma(), { usuario } = useSesion();
  const { datos } = useFotos(crew.id, crew.hoy.fecha, crew.hoy.fecha);
  // un cuadro por persona (la última foto de hoy, o su avatar si aún no comparte) + la cámara: llenan todo el ancho
  const ultima = new Map<string, Foto>();
  for (const f of [...(datos ?? [])].sort((a, b) => b.ts - a.ts)) if (!ultima.has(f.usuario)) ultima.set(f.usuario, f);
  const gente = [...crew.miembros].sort((a, b) => Number(ultima.has(b.id)) - Number(ultima.has(a.id)) || (ultima.get(b.id)?.ts ?? 0) - (ultima.get(a.id)?.ts ?? 0));
  const visibles = gente.slice(0, 5), mas = gente.length - visibles.length;
  const yoFalta = !!usuario && !ultima.has(usuario.id);
  return (
    <>
      <Seccion t={crew.nombre} nota={tp(crew.hoy.subieron.length, '{n} of {total} shared', '{n} of {total} shared', { total: crew.miembros.length })} />
      <Toque onPress={() => router.navigate('/crew')} label={t('Open your crew')}>
        <Cel style={{ flexDirection: 'row', gap: 6, padding: 8 }}>
          {visibles.map(m => {
            const f = ultima.get(m.id);
            return (
              <View key={m.id} style={{ flex: 1, aspectRatio: 0.78, borderRadius: 14, overflow: 'hidden', backgroundColor: C.s2, borderWidth: f ? 0 : 1, borderColor: C.l2, borderStyle: f ? 'solid' : 'dashed' }}>
                {f ? (
                  <>
                    <Image source={imagen(f.mini)} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} contentFit="cover" transition={150} />
                    {f.video ? <View style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="play" size={10} color="#fff" style={{ marginLeft: 1 }} /></View> : null}
                    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 6, paddingTop: 14, paddingBottom: 5, experimental_backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.7))' }}>
                      <Txt f="m" size={11} color="#fff" numberOfLines={1}>{m.nombre.split(/\s+/)[0]}</Txt>
                    </View>
                  </>
                ) : (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, opacity: 0.75 }}>
                    <AvatarMiembro u={m} size={26} />
                    <Txt size={10.5} color={C.t3} numberOfLines={1}>{m.nombre.split(/\s+/)[0]}</Txt>
                  </View>
                )}
              </View>
            );
          })}
          <Pressable onPress={() => router.push('/compartir')} accessibilityLabel={t('Share a photo')}
            style={({ pressed }) => ({ flex: 1, aspectRatio: 0.78, borderRadius: 14, backgroundColor: yoFalta ? C.nova : C.sigSuave, alignItems: 'center', justifyContent: 'center', gap: 4, opacity: pressed ? 0.8 : 1 })}>
            <Ionicons name="camera" size={22} color={yoFalta ? C.tinta : C.nova} />
            {mas > 0 ? <Txt f="m" size={10.5} color={yoFalta ? C.tinta : C.nova}>+{mas}</Txt> : null}
          </Pressable>
        </Cel>
      </Toque>
    </>
  );
}

function HoyMision() {
  usePerfil(); // si cambias tu nombre, Today se vuelve a dibujar
  const tr = useIdioma(), { t } = tr;
  const H = hoy(tr), { width } = useWindowDimensions();
  const celda = (Math.min(width, 520) - 40 - 8) / 2, dentro = celda - 32;
  const atencion = H.resp.estado === 'attention';
  // si el reloj está conectado, el corazón es real
  const vivo = useVivo(), enVivo = vivo.reloj.estado === 'conectado' && !!vivo.fc;
  const [hs, ms] = [Math.floor(H.sueno), Math.round((H.sueno % 1) * 60)];
  const { y, habla } = useHeroe();
  // con la nave enlazada, lo que dice la nave manda (misión real y mis signos según el núcleo)
  const enlazada = !!useNave().url;
  const nave = useNaveEstado(), mio = nave.vivo && nave.estado ? nave.estado.trip[miIndice()] : null, mis = nave.mision;
  const fase = mis ? { cruise: t('cruise to Mars'), mars: t('on Mars'), return: t('return to Earth') }[mis.fase] : H.fase;
  const sub = mis ? `${t('Day {n}', { n: mis.dia })} · ${fase}` : `Sol ${H.sol} · ${H.fase}`;
  const ETQ: Record<string, string> = { pulso: t('heart rate'), spo2: t('oxygen'), pa_sis: t('blood pressure'), pa_dia: t('blood pressure'), temp: t('temperature'), fr: t('breathing'), glucosa: t('blood sugar'), sueno_h: t('sleep') };
  const fuera = mio ? Object.entries(mio.niveles).filter(([k, n]) => ETQ[k] && (n === 'atencion' || n === 'aviso_tierra') && mio.edades[k] > 0) : [];
  const urgente = fuera.some(([, n]) => n === 'aviso_tierra');
  const mensaje = !mio ? H.resp.mensaje
    : urgente ? t('Your {x} needs attention now. The ship has flagged it for the flight surgeon. If you feel unwell, tell your crew and open Emergency.', { x: ETQ[fuera.find(([, n]) => n === 'aviso_tierra')![0]] })
    : fuera.length ? t('Keep an eye on your {x} today. Everything else is in range.', { x: [...new Set(fuera.map(([k]) => ETQ[k]))].join(', ') })
    : t('All your signs are in range. Have a good day up there.');
  const col = (n?: Nivel) => n === 'aviso_tierra' ? C.alerta : n === 'atencion' ? C.aviso : C.t1;
  return (
    <Pantalla y={y} titulo={t('Good morning,\n{nombre}', { nombre: H.nombre })} corto={t('Good morning, {nombre}', { nombre: H.nombre })} sub={sub}>
      <NovaHeroe y={y} base={urgente || (!mio && atencion) ? 'pensativa' : 'feliz'} habla={habla} />

      <NovaDice texto={mensaje} habla={habla} />

      {/* emergencia siempre a mano, con el retraso real de la luz */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
        <Pressable onPress={() => router.push('/emergencia')} accessibilityRole="button" accessibilityLabel={t('Emergency')}
          style={({ pressed }) => ({ flex: 1, height: 52, borderRadius: 26, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2a0f1e', borderWidth: 1, borderColor: 'rgba(236,106,168,0.55)', opacity: pressed ? 0.75 : 1 })}>
          <Ionicons name="medkit" size={18} color={C.alerta} />
          <Txt f="s" size={15} color="#ffd3e7">{t('Emergency')}</Txt>
        </Pressable>
        <View style={{ flex: 1, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1 }}>
          {mis ? (mis.conjuncion
            ? <Txt f="m" size={13.5} color={C.aviso}>{t('Solar conjunction · no Earth link')}</Txt>
            : <Txt size={13.5} color={C.t2}>{t('Earth')} <Txt f="m" size={13.5}>{t('{m} light-min', { m: (mis.luz_seg / 60).toFixed(1) })}</Txt></Txt>)
            : <Txt size={13.5} color={C.t3}>{t('Ship not linked')}</Txt>}
        </View>
      </View>

      {/* escáner del cuerpo: la cámara del teléfono (en la mano o en el visor) y NOVA Station lo ve en vivo */}
      {enlazada ? (
        <Pressable onPress={() => { const u = urlEscaner(); if (u) Linking.openURL(u); }} accessibilityRole="button" accessibilityLabel={t('Body scan')}
          style={({ pressed }) => ({ marginTop: 8, minHeight: 60, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 22, flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: C.s1, borderWidth: 1, borderColor: 'rgba(143,230,245,0.4)', opacity: pressed ? 0.75 : 1 })}>
          <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: 'rgba(70,200,232,0.12)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="scan" size={20} color={C.sig} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt f="s" size={15} numberOfLines={1}>{t('Body scan')}</Txt>
            <Txt size={12.5} color={C.t3} numberOfLines={1} style={{ marginTop: 2 }}>{t('camera · live on the station')}</Txt>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.t3} />
        </Pressable>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 26 }}>
        <Toque onPress={() => router.navigate({ pathname: '/salud', params: { seg: 'cuerpo' } })} label={t('Heart')} style={{ width: celda }}>
          <Cel>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Lbl t={t('Heart')} style={{ flex: 1 }} />
              {enVivo ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.ok }} /><Txt f="m" size={11.5} color={C.ok}>{t('Live')}</Txt></View> : null}
            </View>
            <Num v={String(enVivo ? Math.round(vivo.fc ?? 0) : mio && mio.edades.pulso > 0 ? Math.round(mio.pulso) : H.fc)} u={t('bpm')} color={!enVivo && mio ? col(mio.niveles.pulso) : C.t1} style={{ marginTop: 10 }} />
            <View style={{ marginTop: 10 }}><TrazaViva w={dentro} h={30} bpm={enVivo ? vivo.fc ?? H.fc : mio && mio.edades.pulso > 0 ? mio.pulso : H.fc} col={enVivo ? C.ok : C.sig} /></View>
          </Cel>
        </Toque>
        {mio ? (
          <Toque onPress={() => router.navigate({ pathname: '/salud', params: { seg: 'cuerpo' } })} label={t('Oxygen')} style={{ width: celda }}>
            <Cel>
              <Lbl t={t('Oxygen · ship')} />
              <Num v={mio.edades.spo2 > 0 ? String(Math.round(mio.spo2)) : '—'} u="%" color={col(mio.niveles.spo2)} style={{ marginTop: 10 }} />
              <Txt size={12.5} color={C.t3} style={{ marginTop: 14 }}>{mio.edades.pa_sis > 0 ? t('BP {s}/{d} mmHg', { s: Math.round(mio.pa_sis), d: Math.round(mio.pa_dia) }) : t('No blood pressure yet')}</Txt>
            </Cel>
          </Toque>
        ) : (
        <Toque onPress={() => router.push('/evidencia')} label={t('Readiness')} style={{ width: celda }}>
          <Cel>
            <Lbl t={t('Readiness')} />
            <Num v={String(H.preparacion)} u="/ 100" color={atencion ? C.aviso : C.t1} style={{ marginTop: 10 }} />
            <View style={{ marginTop: 10 }}><Barritas w={dentro} h={30} vals={H.histPrep.map(v => v / 100)} col={atencion ? C.aviso : C.sig} /></View>
          </Cel>
        </Toque>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Cel style={{ width: celda }}>
          <Lbl t={t('Sleep')} />
          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 10 }}>
            <Num v={String(hs)} u="h" />
            <Num v={` ${String(ms).padStart(2, '0')}`} u="m" />
          </View>
          <Txt size={12.5} color={C.t3} style={{ marginTop: 8 }}>{t('Deep sleep {h}', { h: hh(H.suenoProfundo) })}</Txt>
        </Cel>
        <Cel style={{ width: celda }}>
          <Lbl t={t('Mission dose')} />
          <Num v={String(H.dosis)} u="mSv" style={{ marginTop: 10 }} />
          <View style={{ marginTop: 16 }}><Barra v={H.dosis / H.limite} color={C.aviso} /></View>
          <Txt size={12.5} color={C.t3} style={{ marginTop: 8 }}>{t('{p}% of career limit', { p: Math.round((H.dosis / H.limite) * 100) })}</Txt>
        </Cel>
      </View>

      <View style={{ marginTop: 16 }}><CasaTarjeta w={celda * 2 + 8} compacta /></View>

      <Abajo ancho={celda} />

      <Txt size={12.5} color={C.t3} style={{ textAlign: 'center', marginTop: 22 }}>{mio ? t('Live from the ship’s onboard core. Readiness, sleep and dose are still demo data.') : enVivo ? t('Heart rate live from {reloj}. The rest is demo data.', { reloj: vivo.reloj.nombre ?? t('your watch') }) : t('Demo data. Link the ship in Settings → Mission mode.')}</Txt>
    </Pantalla>
  );
}

/** debajo de la grilla: el check-in, el plan del día, la misión con la próxima sesión y las fuentes de datos */
function Abajo({ ancho }: { ancho: number }) {
  const tr = useIdioma(), { t } = tr;
  // la hora de la nave avanza sola (el render no puede leer el reloj)
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setAhora(Date.now()), 30e3); return () => clearInterval(id); }, []);
  const plan = estadoAgenda(ahora);
  const mis = useNaveEstado().mision;
  const avance = mis && mis.fase === 'cruise' ? mis.dia / Math.max(1, mis.dia + mis.llegada_en_dias) : MISION.avance;
  return (
    <>
      <TarjetaCheckIn />

      <Seccion t={t("Today's plan")} nota={t('{h} ship time', { h: horaNave(ahora) })} />
      <Cel style={{ paddingVertical: 8 }}>
        {plan.map((b, i) => {
          const ya = b.estado === 'hecho', ahoraEs = b.estado === 'ahora';
          return (
            <View key={b.h} style={{ flexDirection: 'row', gap: 12 }}>
              <Txt f="mono" size={12.5} color={ahoraEs ? C.nova : C.t3} style={{ width: 42, paddingTop: 12 }}>{b.h}</Txt>
              <View style={{ width: 12, alignItems: 'center' }}>
                <View style={{ width: 1, height: 15, backgroundColor: i ? C.l2 : 'transparent' }} />
                <View style={{ width: ahoraEs ? 10 : 8, height: ahoraEs ? 10 : 8, borderRadius: 5, backgroundColor: ahoraEs ? C.nova : ya ? C.t3 : 'transparent', borderWidth: ya || ahoraEs ? 0 : 1.5, borderColor: C.t3, boxShadow: ahoraEs ? `0 0 10px ${C.nova}` : undefined }} />
                <View style={{ width: 1, flex: 1, backgroundColor: i < plan.length - 1 ? C.l2 : 'transparent' }} />
              </View>
              <View style={{ flex: 1, paddingVertical: 9, opacity: ya ? 0.5 : 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Txt f={ahoraEs ? 's' : 'm'} size={15} style={{ flexShrink: 1, textDecorationLine: ya ? 'line-through' : 'none' }}>{t(b.t)}</Txt>
                  {ahoraEs ? <View style={{ paddingHorizontal: 7, height: 20, borderRadius: 10, justifyContent: 'center', backgroundColor: C.sigSuave }}><Txt f="m" size={11} color={C.nova}>{t('Now')}</Txt></View> : null}
                </View>
                <Txt size={12.5} color={C.t3} style={{ marginTop: 1 }}>{b.estado === 'luego' && b.faltan < 120 ? t('In {n} min · {d}', { n: b.faltan, d: t(b.d) }) : t(b.d)}</Txt>
              </View>
            </View>
          );
        })}
      </Cel>

      <Seccion t={t('Mission')} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Cel style={{ width: ancho }}>
          <Lbl t={t('To Mars')} />
          <Num v={String(Math.round(avance * 100))} u="%" style={{ marginTop: 10 }} />
          <View style={{ marginTop: 14 }}><Barra v={avance} /></View>
          <Txt size={12.5} color={C.t3} style={{ marginTop: 8 }}>{mis ? t('{n} days to Mars orbit', { n: mis.llegada_en_dias }) : t('{n} sols to arrival', { n: MISION.solesRestantes })}</Txt>
        </Cel>
        <Toque onPress={() => router.navigate('/perfil')} label={t('Your next private session')} style={{ width: ancho }}>
          <Cel>
            <Lbl t={t('Private session')} />
            <Num v={t('In {n}', { n: MISION.sesionEnDias })} u={t('days')} color={C.lila} style={{ marginTop: 10 }} />
            <Txt size={12.5} lh={17} color={C.t3} style={{ marginTop: 10 }}>{t('Dr. Ruiz · {cuando}. Add topics in You.', { cuando: t(MISION.sesion) })}</Txt>
          </Cel>
        </Toque>
      </View>

      <TarjetaFuentes />
    </>
  );
}

/** el check-in del día: cuánto falta o cómo respondiste */
function TarjetaCheckIn() {
  const tr = useIdioma(), { t } = tr;
  const ahora = useAhora();
  const { registros } = useDiario(), r = registros[fechaDe(ahora)];
  const { escalas, completo } = avanceCheckIn(r);
  const animo = r?.valores.animo, energia = r?.valores.energia;
  return (
    <>
      <Seccion t={t('Check-in')} nota={t(completo ? 'done for today' : 'about a minute')} />
      <Toque onPress={() => router.navigate('/journal')} label={t(completo ? 'Open your check-in' : 'Start your daily check-in')}>
        <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}>
          <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Anillos size={48} anillos={[{ v: escalas / ESCALAS.length, col: completo ? C.ok : C.nova, r: 46, w: 10 }]} />
            <View style={{ position: 'absolute' }}>
              {completo ? <Ionicons name="checkmark" size={20} color={C.ok} /> : <Txt f="s" size={13}>{escalas}/{ESCALAS.length}</Txt>}
            </View>
          </View>
          <View style={{ flex: 1 }}>
            {completo ? (
              <>
                <Txt f="s" size={16}>{t('You checked in')}</Txt>
                <Txt size={13.5} lh={19} color={C.t2}>
                  {t('Mood')} <Txt f="m" size={13.5} color={animo ? colorNivel(animo, true) : C.t3}>{animo ? nivelDe(tr, ESCALAS[0], animo).toLowerCase() : '—'}</Txt>
                  {energia ? <>, {t('energy')} <Txt f="m" size={13.5} color={colorNivel(energia, true)}>{nivelDe(tr, ESCALAS[1], energia).toLowerCase()}</Txt></> : null}
                  {r?.emociones.length ? `, ${r.emociones.slice(0, 2).map(m => t(m)).join(t(' and ')).toLowerCase()}` : ''}
                </Txt>
              </>
            ) : (
              <>
                <Txt f="s" size={16}>{t(escalas ? 'Finish your check-in' : 'How are you today?')}</Txt>
                <Txt size={13.5} lh={19} color={C.t2}>{escalas ? tr.tp(ESCALAS.length - escalas, '{n} quick question left.', '{n} quick questions left.') : t('Six quick questions. Nova learns what helps you.')}</Txt>
              </>
            )}
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.t3} />
        </Cel>
      </Toque>

    </>
  );
}

/** cuántas fuentes reales están encendidas; abre «Tus datos» */
function TarjetaFuentes() {
  const { t } = useIdioma();
  const { c: consent } = useConsentimiento(), activas = FUENTES.filter(f => consent[f.id]).length;
  return (
    <Toque onPress={() => router.push('/datos')} label={t('Your data sources')} style={{ marginTop: 8 }}>
        <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 }}>
          <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: C.sigSuave, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="pulse-outline" size={20} color={C.nova} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt f="s" size={15.5}>{activas ? t('{n} of {total} sources on', { n: activas, total: FUENTES.length }) : t('Connect your data')}</Txt>
            <Txt size={13} lh={18} color={C.t2}>{t(activas ? 'Watch, health apps and phone. You choose each one.' : 'Your watch, health apps and phone make Nova accurate.')}</Txt>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.t3} />
        </Cel>
      </Toque>
  );
}
