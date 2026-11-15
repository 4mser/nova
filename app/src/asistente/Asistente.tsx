/* NOVA sobre cualquier app (Android): la capa que abre el botón del asistente del teléfono, la ficha de ajustes
   rápidos, el atajo «Escúchame» del ícono o el botón de los audífonos. Es otra raíz de React (NovaAsistente, en
   index.tsx). Desde la 0.9 vive en una ventana propia (modules/nova-control/NovaCapa, un servicio en primer plano):
   por eso sigue viva aunque NOVA te deje en otra app. Si el teléfono no deja «mostrar sobre otras apps» (o está
   bloqueado), la hospeda la actividad transparente, como antes.

   Cómo se ve: sin tarjeta. La pantalla se oscurece de arriba hacia abajo y NOVA aparece al centro, con su órbita,
   sobre lo que estabas usando. Debajo, una línea de estado en mono («TE ESCUCHO», «HABLANDO») y lo que dices, grande y
   liviano, palabra por palabra a medida que lo entiende; el tamaño baja suave si te extiendes. Lo que hace aparece
   como píldoras y lo que responde, en su turquesa claro, también palabra por palabra. Nada se corta: el bloque crece
   con el texto (y si es muy largo, se desplaza solo). Nada rebota: todo entra con fundidos cortos.
   · apenas abre, NOVA escucha; la música baja de volumen mientras tanto y vuelve al cerrar
   · si te deja en otra app (la cámara, Spotify, Gmail), la ventana se encoge a una BURBUJA: el orbe chico, que no tapa
     la app, sigue escuchando y hablando, muestra en una píldora breve lo que dice o hace, se arrastra, y tocarla la
     vuelve a agrandar. Con accesibilidad, además ve esa app y la usa por ti («abre el último correo»).
   · si hay dos contactos que suenan igual, aparecen con su foto: tocas uno o dices el nombre.
   · «mira esto»: se enciende la cámara (vista previa arriba) y NOVA recibe un cuadro por segundo mientras hablan.
   · «¿qué dice esto?»: lee la pantalla (texto) o la fotografía (sin la capa encima) para mirarla. */
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import { SpaceGrotesk_300Light, SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, useFonts } from '@expo-google-fonts/space-grotesk';
import { Ionicons } from '@expo/vector-icons';
import { getRecordingPermissionsAsync } from 'expo-audio';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, interpolateColor, LinearTransition, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { SafeAreaInsetsContext, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Image } from 'expo-image';
import { NovaControl, type Contacto, type ModoCapa } from '../../modules/nova-control';
import { cargarCola } from '../cuenta/cola';
import { CLAVE_TAREAS, leerCache, type Tarea } from '../cuenta/datos';
import { cargarRecordatorios } from '../cuenta/recordatorios';
import { cargarSesion, leerSesion, useCrew, useSesion } from '../cuenta/sesion';
import { cargarActividad } from '../engine/actividad';
import { cargarDiario } from '../engine/diario';
import { cargarFoco } from '../engine/foco';
import { cargarFunciones, useFunciones } from '../engine/funciones';
import { cargarHabitos } from '../engine/habitos';
import { cargarMemoria } from '../engine/memoria';
import { hoy } from '../engine/motor';
import { cargarMusica } from '../engine/musica';
import { cargarPerfil } from '../engine/perfil';
import { cargarRecordatoriosPropios } from '../engine/recordatoriosPropios';
import { cargarRepaso } from '../engine/repaso';
import { cargarRutina } from '../engine/rutina';
import { cargarIdioma, useIdioma } from '../i18n';
import { NovaOrb, PAL } from '../nova/NovaOrb';
import { Orbita } from '../nova/Orbita';
import { cargarHistoria } from '../sensores/historia';
import { C, F, Txt } from '../ui/tema';
import { TarjetaMensaje } from '../ui/TarjetaMensaje';
import { ejecutar, type Visual } from '../voz/acciones';
import { cargarAlarmas } from '../voz/alarmas';
import { TarjetaAccion } from '../ui/TarjetasAccion';
import { datosConversacion } from '../voz/contexto';
import { descartarCandidatos, useBorrador, useCandidatos } from '../voz/telefono';
import { useNovaVivo } from '../voz/vivo';

// si la app no estaba abierta, la capa carga lo que NOVA necesita para hacer cosas (tareas, hábitos, listas…)
let cargado = false;
function cargarLoNecesario() {
  if (cargado) return;
  cargado = true;
  cargarAlarmas();
  if (leerSesion().listo) return; // la app ya estaba viva: todo está en memoria
  cargarSesion(); cargarFunciones(); cargarIdioma(); cargarFoco(); cargarDiario(); cargarPerfil(); cargarHistoria(); cargarHabitos(); cargarRepaso();
  cargarMusica(); cargarRecordatorios(); cargarMemoria(); cargarCola(); cargarRecordatoriosPropios(); cargarActividad(); cargarRutina();
}

const SILENCIO_MS = 8000; // tras la última respuesta, sin que digas nada, la capa se cierra
const SILENCIO_BURBUJA_MS = 180000; // en burbuja aguanta tres minutos: estás usando la otra app y puedes seguir pidiéndole cosas
const SUAVE = Easing.out(Easing.cubic);
const ACOMODO = LinearTransition.duration(240).easing(SUAVE);
/** la burbuja (dp): el orbe solo (84, lo mismo que ORBE_DP en NovaCapa) y, con su píldora al lado, más ancha */
const BURBUJA = { lado: 84, pildora: 280, aire: 8 };

type PropsRaiz = { modoCapa?: string; insetTop?: number; insetBottom?: number };

export default function RaizAsistente(props: PropsRaiz) {
  cargarLoNecesario();
  const [fuentes] = useFonts({ SpaceGrotesk_300Light, SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, IBMPlexMono_400Regular, IBMPlexMono_500Medium });
  const sesion = useSesion();
  const enVentana = props.modoCapa === 'ventana';
  const dentro = fuentes && sesion.listo ? <Asistente enVentana={enVentana} /> : null;
  // en la ventana del servicio no hay actividad que informe los bordes del sistema: vienen desde Android
  if (enVentana) {
    return (
      <SafeAreaInsetsContext.Provider value={{ top: props.insetTop ?? 0, bottom: props.insetBottom ?? 0, left: 0, right: 0 }}>
        <View style={{ flex: 1, backgroundColor: 'transparent' }}>{dentro}</View>
      </SafeAreaInsetsContext.Provider>
    );
  }
  return <SafeAreaProvider style={{ backgroundColor: 'transparent' }}>{dentro}</SafeAreaProvider>;
}

type Hecho = { icono: string; texto: string; visual?: Visual };

function Asistente({ enVentana }: { enVentana: boolean }) {
  const tr = useIdioma(), { t } = tr;
  const { usuario } = useSesion(), crew = useCrew(), { mision } = useFunciones();
  const H = hoy(tr);
  const [datos] = useState(() => {
    const suena = NovaControl?.ahora();
    const ahora = suena?.titulo ? `\nNOW PLAYING on the phone: «${suena.titulo}»${suena.artista ? ` by ${suena.artista}` : ''} in ${suena.app}${suena.suena ? '' : ' (paused)'}` : '';
    const frente = NovaControl?.appEnFrente?.();
    const pantalla = frente ? `\nON SCREEN RIGHT NOW: the app «${frente.app}» (they called you over it). If they refer to "this" («este correo», «esta página», «esto»), read it with leer_pantalla or look at it with mirar_pantalla.` : '';
    return datosConversacion({ mision, usuario, crew, nombre: H.nombre }) + ahora + pantalla;
  });
  const [dices, setDices] = useState('');
  const [responde, setResponde] = useState('');
  const [hechos, setHechos] = useState<Hecho[]>([]);
  const [piensa, setPiensa] = useState(false);
  const [sinMic, setSinMic] = useState(false);
  const [mini, setMini] = useState(false);
  const [ladoMini, setLadoMini] = useState<'izq' | 'der'>('der');
  const [tic, setTic] = useState(0); // fuerza a reevaluar el cierre
  const miniRef = useRef(false);
  const borrador = useBorrador(), candidatos = useCandidatos();
  // «mira esto»: la cámara en vivo; cada ~1 s se manda un cuadro chico a NOVA
  const [mirando, setMirando] = useState(false);
  const [permisoCam, pedirCam] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [tamFoto, setTamFoto] = useState<string | undefined>(undefined);
  const turnoNuevo = useRef(true);
  const salir = useRef(false); // NOVA te dejó en otra app sin burbuja: cerrar apenas termine de hablar
  const cerrando = useRef(false);

  const cerrar = useCallback(() => {
    if (cerrando.current) return;
    cerrando.current = true;
    NovaControl?.enfocar(false);
    NovaControl?.cerrarAsistente().catch(() => {});
  }, []);

  const vivo = useNovaVivo({
    modo: 'chat', datos, nombre: H.nombre, sol: H.sol, idioma: tr.idioma, perfil: mision ? 'mision' : 'diario', asistente: true,
    eventos: {
      oye: trozo => {
        if (turnoNuevo.current) { turnoNuevo.current = false; setDices(trozo.trimStart()); setResponde(''); setHechos([]); descartarCandidatos(); }
        else setDices(x => x + trozo);
        setPiensa(true);
      },
      dice: trozo => { setPiensa(false); setResponde(x => (x ? x + trozo : trozo.trimStart())); },
      finTurno: () => { turnoNuevo.current = true; setPiensa(false); },
      sinConexion: () => setPiensa(false),
      herramienta: async (nombre, args) => {
        if (nombre === 'mirar') {
          const on = args.encender !== false;
          if (on) {
            if (miniRef.current) NovaControl?.capaCompleta?.(); // la cámara va en la capa completa
            const p = permisoCam?.granted ? permisoCam : await pedirCam().catch(() => null);
            if (!p?.granted) return { ok: false, motivo: 'no camera permission; they must allow Camera for NOVA' };
          }
          setMirando(on);
          return { ok: true, camara: on ? 'on: frames will arrive about once per second; answer about what you see' : 'off' };
        }
        if (nombre === 'mirar_pantalla') {
          // una foto de la pantalla (sin la capa encima) va como cuadro de video: NOVA la mira y responde
          if (!NovaControl?.capturaPantalla) return { ok: false, motivo: 'needs the newer NOVA app (0.9)' };
          if (!NovaControl.accesibilidadActiva?.()) return { ok: false, motivo: 'NOVA is not enabled in Accessibility: they must turn on NOVA in Settings → Accessibility → NOVA (Settings → Phone control → Use apps for you opens it)' };
          const b64 = await NovaControl.capturaPantalla().catch(() => null);
          if (!b64) return { ok: false, motivo: 'could not capture the screen (Android 11+ needed)' };
          vivo.imagen(b64);
          return { ok: true, nota: 'one picture of the screen was sent as a frame; answer about what you see in it, briefly' };
        }
        if (nombre === 'burbuja') {
          if (!enVentana || !NovaControl?.capaABurbuja) return { ok: false, motivo: 'the bubble needs «display over other apps» allowed for NOVA (Settings → Phone control → Over your apps)' };
          NovaControl.capaABurbuja();
          return { ok: true, nota: 'you are now a small bubble; say nothing or two words' };
        }
        const r = await ejecutar(nombre, args, { tr, crew: crew ? { id: crew.id, nombre: crew.nombre } : null, tareas: leerCache<Tarea[]>(CLAVE_TAREAS) ?? [], yo: usuario?.id });
        if (!r) return { ok: false, motivo: 'not available from the assistant; they can do it inside the NOVA app' };
        // «abre mis listas», «abre la lista de compras»: la capa abre la app en esa pantalla (antes lo decía sin abrir nada)
        if (r.ir && r.respuesta.ok !== false && (nombre === 'abrir' || (nombre === 'leer_lista' && args.abrir))) {
          setTimeout(() => { cerrar(); Linking.openURL(`nova://${r.ir!.replace(/^\//, '')}`).catch(() => {}); }, 1400);
        }
        if (r.accion) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          setHechos(x => [...x, { icono: r.accion!.icono, texto: r.accion!.texto, visual: r.visual?.tipo === 'mensaje' ? undefined : r.visual }]);
        }
        if (r.fuera) {
          NovaControl?.enfocar(false);
          // en la ventana, la capa ya pasó a burbuja; si la hospeda la actividad, se cierra al terminar de hablar
          setTimeout(() => { if (!miniRef.current) { salir.current = true; setTic(x => x + 1); } }, 900);
        }
        return r.respuesta;
      },
    },
  });
  const { escuchar, escuchando, hablando, estado } = vivo;

  // al abrir: la música baja y NOVA escucha de inmediato (el audio espera en el servidor mientras conecta)
  const empezar = useCallback(async () => {
    const p = await getRecordingPermissionsAsync().catch(() => null);
    if (!p?.granted) { setSinMic(true); return; }
    NovaControl?.enfocar(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try { await escuchar(); } catch { setSinMic(true); }
  }, [escuchar]);
  useEffect(() => { empezar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  // abrir otra app desde aquí deja la capa como burbuja (no la cierra); los timers siguen vivos aunque la actividad
  // quede atrás; al desmontar, se apaga todo
  useEffect(() => {
    NovaControl?.miniAlSalir(true); NovaControl?.capaViva?.(true);
    return () => { NovaControl?.miniAlSalir(false); NovaControl?.capaViva?.(false); NovaControl?.enfocar(false); };
  }, []);
  // latido: cada 2 s le dice a la ventana que JS sigue vivo. Si se congela (Android pausó a React, un error), la ventana
  // deja pasar los toques a los 6 s y se cierra sola a los 15: nunca queda una capa pegada que no se pueda cerrar
  useEffect(() => {
    if (!enVentana || !NovaControl?.latido) return;
    NovaControl.latido();
    const id = setInterval(() => NovaControl?.latido?.(), 2000);
    return () => clearInterval(id);
  }, [enVentana]);
  // la ventana avisa cuando pasa a burbuja o vuelve a completa
  useEffect(() => {
    const s = NovaControl?.addListener('capa', (e: { modo: ModoCapa; lado?: 'izq' | 'der' }) => {
      if (e.modo === 'cerrada') return;
      const m = e.modo === 'mini';
      if (e.lado) setLadoMini(e.lado);
      if (m && miniRef.current) return; // solo cambió de lado
      miniRef.current = m; setMini(m);
      if (!m) NovaControl?.enfocar(true);
      else {
        // NOVA sabe que ahora es una burbuja sobre la otra app, y puede seguir trabajando en ella
        const frente = NovaControl?.appEnFrente?.();
        vivo.contexto(`(You are now a small floating bubble${frente ? ` over «${frente.app}»` : ' over another app'}; they keep using it and can still talk to you. For anything inside that app, call ver_pantalla first, then act step by step.)`);
      }
    });
    return () => s?.remove();
  }, [vivo]);

  // volver a invocarla con la capa abierta: corta lo que NOVA estaba diciendo y escucha de nuevo
  useEffect(() => {
    const s = NovaControl?.addListener('invocada', () => {
      vivo.interrumpir(); salir.current = false; cerrando.current = false;
      if (!escuchando) empezar();
    });
    return () => s?.remove();
  }, [vivo, escuchando, empezar]);

  // cuándo cerrarse: si NOVA te dejó en otra app sin burbuja, cuando termina de hablar; en burbuja aguanta tres
  // minutos de silencio (estás usando la otra app); si no, tras unos segundos de silencio
  useEffect(() => {
    if (hablando || piensa || !turnoNuevo.current) return;
    if (salir.current) { const id = setTimeout(cerrar, 350); return () => clearTimeout(id); }
    const id = setTimeout(cerrar, mini ? SILENCIO_BURBUJA_MS : mirando ? 120000 : borrador || candidatos ? SILENCIO_MS * 2 : dices ? SILENCIO_MS : SILENCIO_MS + 4000);
    return () => clearTimeout(id);
  }, [hablando, piensa, dices, responde, hechos, borrador, candidatos, mini, mirando, tic, cerrar]);

  // mientras mira: un cuadro por segundo (chico, para que viaje rápido); nunca dos capturas a la vez
  const capturando = useRef(false);
  useEffect(() => {
    if (!mirando || mini) return;
    const id = setInterval(async () => {
      const cam = camRef.current;
      if (!cam || capturando.current) return;
      capturando.current = true;
      try {
        const f = await cam.takePictureAsync({ quality: 0.3, base64: true, skipProcessing: true, shutterSound: false });
        if (f?.base64) vivo.imagen(f.base64);
      } catch {} finally { capturando.current = false; }
    }, 1100);
    return () => clearInterval(id);
  }, [mirando, mini, vivo]);
  // el tamaño de foto más chico que sirva (≥ 480 px de ancho): el cuadro pesa unas decenas de KB
  const camaraLista = useCallback(async () => {
    try {
      const lista = await camRef.current?.getAvailablePictureSizesAsync();
      const util = (lista ?? []).map(x => ({ x, w: Number(x.split('x')[0]) })).filter(p => p.w >= 480).sort((a, b) => a.w - b.w)[0];
      if (util) setTamFoto(util.x);
    } catch {}
  }, []);

  // sin voz (el servidor no responde): lo dice y se cierra
  useEffect(() => {
    if (estado !== 'sin_conexion') return;
    const id = setTimeout(cerrar, 3500);
    return () => clearTimeout(id);
  }, [estado, cerrar]);

  const activa = hablando || piensa;
  const titulo = sinMic ? t('NOVA needs the microphone')
    : estado === 'sin_conexion' ? t("I can't reach my voice right now")
    : estado === 'conectando' && !dices ? t('Listening…')
    : hablando ? t('Speaking') : piensa ? t('Thinking') : mirando ? t('Looking') : t('Listening…');

  if (mini) {
    return <Burbuja lado={ladoMini} piensa={piensa} hablando={hablando} escuchando={escuchando} responde={responde} ultimoHecho={hechos.at(-1)?.texto ?? ''} habla={vivo.habla} nivel={vivo.nivel} />;
  }

  return (
    <Capa
      titulo={titulo} activa={activa} piensa={piensa} hablando={hablando} escuchando={escuchando} conectando={estado === 'conectando'}
      dices={dices} responde={responde} hechos={hechos} sinMic={sinMic} conBorrador={!!borrador} candidatos={candidatos?.lista ?? null}
      mirando={mirando} camRef={camRef} tamFoto={tamFoto} onCamaraLista={camaraLista}
      onMirar={async on => {
        if (on && !(permisoCam?.granted || (await pedirCam().catch(() => null))?.granted)) return;
        Haptics.selectionAsync().catch(() => {});
        setMirando(on);
        vivo.texto(on ? '(They turned the camera on: frames will arrive; look and comment briefly on what you see, then listen.)' : '(They turned the camera off.)');
      }}
      conBurbuja={enVentana && !!NovaControl?.capaABurbuja}
      onBurbuja={() => { Haptics.selectionAsync().catch(() => {}); NovaControl?.capaABurbuja?.(); }}
      habla={vivo.habla} nivel={vivo.nivel}
      onCerrar={cerrar} onInterrumpir={vivo.interrumpir}
      onElegir={c => {
        // tocar un contacto es como decir su nombre: el modelo recibe el id y vuelve a llamar a la herramienta
        Haptics.selectionAsync().catch(() => {});
        descartarCandidatos();
        vivo.texto(`(They tapped «${c.nombre}» on screen, contacto_id ${c.id}. Continue with that one, no more questions.)`);
      }}
      onAbrirBorrador={() => { if (!enVentana) salir.current = true; cerrar(); }}
      onPermisos={() => { cerrar(); Linking.openURL('nova://permisos').catch(() => {}); }}
    />
  );
}

/** La burbuja: NOVA chica sobre la app que abrió. No tapa nada; sigue escuchando (anillo) y hablando (luz). Cuando
    dice o hace algo, una píldora breve aparece AL LADO del orbe, hacia el centro de la pantalla (Android dice de qué
    lado está el orbe), y se va sola. La ventana crece solo mientras hay píldora y siempre alrededor del orbe, que no
    se mueve. Arrastrarla hasta cualquier borde y tocarla los maneja Android (NovaCapa). */
function Burbuja({ lado, piensa, hablando, escuchando, responde, ultimoHecho, habla, nivel }: { lado: 'izq' | 'der'; piensa: boolean; hablando: boolean; escuchando: boolean; responde: string; ultimoHecho: string; habla: SharedValue<number>; nivel: SharedValue<number> }) {
  // lo último que dijo o hizo; se queda unos segundos después de que termina de hablar y se esconde sola
  const pildora = responde || ultimoHecho;
  const [escondida, setEscondida] = useState('');
  useEffect(() => {
    if (hablando || piensa || !pildora) return;
    const id = setTimeout(() => setEscondida(pildora), 4200);
    return () => clearTimeout(id);
  }, [hablando, piensa, pildora]);
  const conPildora = !!pildora && escondida !== pildora;
  useEffect(() => { NovaControl?.capaMini?.(conPildora ? BURBUJA.lado + BURBUJA.aire + BURBUJA.pildora : BURBUJA.lado, BURBUJA.lado); }, [conPildora]);
  const activa = hablando || piensa;
  const orbe = (
    <View style={{ width: BURBUJA.lado, height: BURBUJA.lado, alignItems: 'center', justifyContent: 'center' }}>
      {escuchando && !hablando ? <Anillo k={0} nivel={nivel} tam={BURBUJA.lado} /> : null}
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(5,8,12,0.78)', borderWidth: 1, borderColor: activa ? 'rgba(143,230,245,0.55)' : 'rgba(143,230,245,0.22)', alignItems: 'center', justifyContent: 'center' }}>
        <Orbita size={60} marcas={36} vel={piensa ? 1.6 : hablando ? 1 : 0.35} />
        <View style={{ position: 'absolute' }}>
          <Orbe habla={habla} nivel={nivel} expr={piensa ? 'pensativa' : hablando ? 'feliz' : 'normal'} size={46} />
        </View>
      </View>
      <View style={{ position: 'absolute', bottom: 6, width: 5, height: 5, borderRadius: 2.5, backgroundColor: activa ? C.nova : 'rgba(143,230,245,0.45)' }} />
    </View>
  );
  const texto = conPildora ? (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={{ flex: 1, justifyContent: 'center', alignItems: lado === 'der' ? 'flex-end' : 'flex-start' }}>
      <View style={{ maxWidth: BURBUJA.pildora, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 15, backgroundColor: 'rgba(5,8,12,0.9)', borderWidth: 1, borderColor: 'rgba(143,230,245,0.22)' }}>
        <Txt size={12.5} lh={16} color={responde ? PAL.claro : C.nova} numberOfLines={3} style={{ textAlign: lado === 'der' ? 'right' : 'left' }}>{pildora}</Txt>
      </View>
    </Animated.View>
  ) : null;
  // el orbe queda del lado del borde; la píldora, hacia el centro de la pantalla
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent', gap: BURBUJA.aire }}>
      {lado === 'der' ? texto : orbe}
      {lado === 'der' ? orbe : texto}
    </View>
  );
}

/** Lo que se ve. Separado del estado para poder mirarlo con datos simulados (y porque así se lee entero). */
export type PropsCapa = {
  titulo: string; activa: boolean; piensa: boolean; hablando: boolean; escuchando: boolean; conectando: boolean;
  dices: string; responde: string; hechos: Hecho[]; sinMic: boolean; conBorrador: boolean;
  /** varios contactos que suenan igual: se eligen con un toque (o diciendo el nombre) */
  candidatos: Contacto[] | null;
  /** «mira esto»: la cámara en vivo, con su vista previa */
  mirando: boolean; camRef?: React.RefObject<CameraView | null>; tamFoto?: string; onCamaraLista?: () => void; onMirar: (on: boolean) => void;
  /** el botón para encogerla a burbuja (solo cuando la capa vive en su ventana) */
  conBurbuja?: boolean; onBurbuja?: () => void;
  habla: SharedValue<number>; nivel: SharedValue<number>;
  onCerrar: () => void; onInterrumpir: () => void; onAbrirBorrador: () => void; onPermisos: () => void; onElegir: (c: Contacto) => void;
};
export function Capa({ titulo, activa, piensa, hablando, escuchando, conectando, dices, responde, hechos, sinMic, conBorrador, candidatos, mirando, camRef, tamFoto, onCamaraLista, onMirar, conBurbuja, onBurbuja, habla, nivel, onCerrar, onInterrumpir, onAbrirBorrador, onPermisos, onElegir }: PropsCapa) {
  const { t } = useIdioma();
  const ins = useSafeAreaInsets();
  const { height: alto, width: ancho } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  // lo que dices parte grande; si te extiendes, baja de tamaño con una transición suave (no de golpe), y cuando
  // NOVA responde, cede el foco: se achica y se atenúa, para que lo que importa sea su respuesta
  const tamDices = useSharedValue(27), cede = useSharedValue(0);
  useEffect(() => {
    const n = dices.length;
    const tam = n < 70 ? 27 : n < 150 ? 22 : 18.5;
    tamDices.set(withTiming(responde ? Math.min(tam, 19) : tam, { duration: 260, easing: SUAVE }));
    cede.set(withTiming(responde ? 1 : 0, { duration: 260, easing: SUAVE }));
  }, [dices, responde, tamDices, cede]);
  const tamResp = useSharedValue(18);
  const boton = { width: 36, height: 36, borderRadius: 18, alignItems: 'center' as const, justifyContent: 'center' as const };

  return (
    <View style={{ flex: 1 }}>
      <Velo onPress={onCerrar} label={t('Close')} />

      <Pressable onPress={onCerrar} hitSlop={12} accessibilityLabel={t('Close')} style={{ ...boton, position: 'absolute', top: ins.top + 10, right: 14, backgroundColor: 'rgba(255,255,255,0.08)' }}>
        <Ionicons name="close" size={17} color={C.t1} />
      </Pressable>
      <View style={{ position: 'absolute', top: ins.top + 10, left: 14, flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={() => onMirar(!mirando)} hitSlop={12} accessibilityLabel={t(mirando ? 'Stop the camera' : 'Show Nova something')} style={{ ...boton, backgroundColor: mirando ? C.nova : 'rgba(255,255,255,0.08)' }}>
          <Ionicons name={mirando ? 'eye' : 'eye-outline'} size={17} color={mirando ? C.tinta : C.t1} />
        </Pressable>
        {conBurbuja ? (
          <Pressable onPress={onBurbuja} hitSlop={12} accessibilityLabel={t('Shrink Nova to a bubble')} style={{ ...boton, backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <Ionicons name="contract-outline" size={17} color={C.t1} />
          </Pressable>
        ) : null}
      </View>

      <Animated.View entering={FadeIn.duration(220).easing(SUAVE)} layout={ACOMODO} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingBottom: Math.max(ins.bottom, 12) + 18, backgroundColor: 'rgba(5,8,12,0.97)' }}>
        <Degradado ancho={ancho} alto={ALTO_DEGRADADO} />
        {/* «mira esto»: lo que ve la cámara, arriba; NOVA se hace chica al lado del estado */}
        {mirando && (
          <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} style={{ width: ancho - 52, height: Math.min(300, alto * 0.34), borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(143,230,245,0.35)', backgroundColor: C.s1, marginBottom: 6 }}>
            <CameraView ref={camRef} style={{ flex: 1 }} facing="back" animateShutter={false} pictureSize={tamFoto} onCameraReady={onCamaraLista} />
          </Animated.View>
        )}
        <Pressable onPress={hablando ? onInterrumpir : undefined} accessibilityLabel={t(hablando ? 'Interrupt Nova' : 'Nova is listening')} style={{ width: mirando ? 110 : 176, height: mirando ? 110 : 176, alignItems: 'center', justifyContent: 'center' }}>
          {escuchando && !hablando && !mirando && [0, 1].map(k => <Anillo key={k} k={k} nivel={nivel} />)}
          <Orbita size={mirando ? 110 : 176} marcas={mirando ? 48 : 72} vel={conectando || piensa ? 1.6 : hablando ? 1 : 0.4} />
          <Orbe habla={habla} nivel={nivel} expr={piensa ? 'pensativa' : hablando ? 'feliz' : 'normal'} size={mirando ? 102 : 164} />
        </Pressable>

        <Estado texto={titulo} activa={activa} />

        <ScrollView ref={scroll} style={{ alignSelf: 'stretch', maxHeight: alto * 0.44 }} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 26, paddingTop: 14, gap: 14 }} showsVerticalScrollIndicator={false} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          {dices ? (
            <Palabras texto={dices} tam={tamDices} f="l" color={C.t1} colorCede={C.t2} cede={cede} ls={-0.5} />
          ) : (
            <Pistas sinMic={sinMic} />
          )}

          {candidatos?.length ? (
            <Animated.View entering={FadeIn.duration(200).easing(SUAVE)} style={{ alignSelf: 'stretch', alignItems: 'center', gap: 10 }}>
              <Txt f="mono" size={11} ls={1.4} color={C.nova} style={{ textTransform: 'uppercase' }}>{t('Which one?')}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
                {candidatos.map(c => <Candidato key={c.id} c={c} onPress={() => onElegir(c)} />)}
              </View>
              <Txt size={12.5} color={C.t3}>{t('Tap one or say the name')}</Txt>
            </Animated.View>
          ) : null}

          {/* lo que NOVA hizo o encontró: una tarjeta si tiene qué mostrar (commits, el año, una persona), si no una píldora */}
          {hechos.filter(h => h.visual).map((h, i) => (
            <View key={`v${i}${h.texto}`} style={{ alignSelf: 'stretch', alignItems: 'center' }}>
              <TarjetaAccion v={h.visual!} />
            </View>
          ))}
          {hechos.some(h => !h.visual) ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
              {hechos.filter(h => !h.visual).map((h, i) => (
                <Animated.View key={`${i}${h.texto}`} entering={FadeIn.duration(200).easing(SUAVE)} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(143,230,245,0.32)', backgroundColor: 'rgba(143,230,245,0.08)' }}>
                  <Ionicons name={h.icono as keyof typeof Ionicons.glyphMap} size={14} color={C.nova} />
                  <Txt f="m" size={13.5} color={C.nova} style={{ flexShrink: 1 }}>{h.texto}</Txt>
                </Animated.View>
              ))}
            </View>
          ) : null}

          {/* el mensaje que NOVA redactó: lo confirmas con la voz («mándalo») o con «Enviar» */}
          {conBorrador ? <View style={{ alignSelf: 'stretch' }}><TarjetaMensaje alAbrir={onAbrirBorrador} /></View> : null}

          {responde ? (
            <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(140)} style={{ alignSelf: 'stretch' }}>
              <Palabras texto={responde} tam={tamResp} f="r" color={PAL.claro} ls={-0.2} />
            </Animated.View>
          ) : null}

          {sinMic && (
            <Pressable onPress={onPermisos} style={{ height: 42, paddingHorizontal: 20, borderRadius: 21, justifyContent: 'center', backgroundColor: C.nova }}>
              <Txt f="s" size={14.5} color={C.tinta}>{t('Open NOVA')}</Txt>
            </Pressable>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

/** un velo parejo sobre lo que estabas usando (sigue ahí, más calmo). Tocarlo cierra. */
function Velo({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(140)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(5,8,12,0.34)' }}>
      <Pressable style={{ flex: 1 }} onPress={onPress} accessibilityLabel={label} />
    </Animated.View>
  );
}

const ALTO_DEGRADADO = 240;
/** el fondo del bloque nace en el aire: de transparente a casi tinta en los 240 px sobre NOVA. Va DENTRO del bloque,
    así se mueve con él cuando el texto crece (la transición de altura lo arrastra). */
function Degradado({ ancho, alto }: { ancho: number; alto: number }) {
  return (
    <Svg width={ancho} height={alto} style={{ position: 'absolute', top: -alto, left: 0 }}>
      <Defs>
        <LinearGradient id="aire" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={C.bg} stopOpacity="0" />
          <Stop offset="0.5" stopColor={C.bg} stopOpacity="0.55" />
          <Stop offset="1" stopColor={C.bg} stopOpacity="0.97" />
        </LinearGradient>
      </Defs>
      <Rect width={ancho} height={alto} fill="url(#aire)" />
    </Svg>
  );
}

/** línea de estado en mono, con un punto que late mientras NOVA piensa o habla */
function Estado({ texto, activa }: { texto: string; activa: boolean }) {
  const o = useSharedValue(1);
  useEffect(() => {
    if (!activa) { o.set(withTiming(1, { duration: 200 })); return; }
    o.set(withRepeat(withTiming(0.3, { duration: 650, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [activa, o]);
  const st = useAnimatedStyle(() => ({ opacity: o.value }));
  const color = activa ? C.nova : C.t3;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
      <Animated.View style={[{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: color }, st]} />
      <Txt f="mono" size={11} ls={1.6} color={color} style={{ textTransform: 'uppercase' }}>{texto}</Txt>
    </View>
  );
}

/** texto palabra por palabra: cada palabra nueva aparece sola, y el tamaño sigue a `tam` sin saltos */
type PropsPalabras = { texto: string; tam: SharedValue<number>; f: keyof typeof F; color: string; ls: number; /** 0..1: cuánto cede el foco (color → colorCede) */ cede?: SharedValue<number>; colorCede?: string };
function Palabras({ texto, ...resto }: PropsPalabras) {
  const palabras = texto.split(/\s+/).filter(Boolean);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignSelf: 'stretch' }}>
      {palabras.map((p, i) => <Palabra key={i} p={p} {...resto} />)}
    </View>
  );
}
function Palabra({ p, tam, f, color, ls, cede, colorCede }: Omit<PropsPalabras, 'texto'> & { p: string }) {
  const st = useAnimatedStyle(() => ({
    fontSize: tam.value, lineHeight: tam.value * 1.28, marginRight: tam.value * 0.3,
    color: cede && colorCede ? interpolateColor(cede.value, [0, 1], [color, colorCede]) : color,
  }));
  return <Animated.Text entering={FadeIn.duration(180)} style={[{ fontFamily: F[f], letterSpacing: ls, textAlign: 'center' }, st]}>{p}</Animated.Text>;
}

/** antes de que digas nada: ejemplos que van rotando, uno a la vez */
const PISTAS = ['«Pause»', '«Open the latest email»', '«What does the last notification say?»', '«Play Lateralus by Tool on Spotify»', '«Tell mom I will be late for lunch»', '«What does this say?»', '«Call Luis»', '«Take a screenshot»', '«Take me home»', '«Turn on the flashlight»', '«Search lo-fi on YouTube»'];
function Pistas({ sinMic }: { sinMic: boolean }) {
  const { t } = useIdioma();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (sinMic) return;
    const id = setInterval(() => setI(x => (x + 1) % PISTAS.length), 2600);
    return () => clearInterval(id);
  }, [sinMic]);
  if (sinMic) return <Txt size={17} lh={24} color={C.t2} style={{ textAlign: 'center' }}>{t('Open NOVA once to allow it.')}</Txt>;
  return (
    <View style={{ height: 30, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View key={i} entering={FadeIn.duration(260)} exiting={FadeOut.duration(200)} style={{ position: 'absolute' }}>
        <Txt f="l" size={19} lh={26} color={C.t2} style={{ textAlign: 'center' }}>{t(PISTAS[i])}</Txt>
      </Animated.View>
    </View>
  );
}

/** mientras escucha, tu voz también la ilumina un poco; la mirada baja hacia lo que vas diciendo */
function Orbe({ habla, nivel, expr, size = 164 }: { habla: SharedValue<number>; nivel: SharedValue<number>; expr: 'normal' | 'feliz' | 'pensativa'; size?: number }) {
  const luz = useDerivedValue(() => Math.max(habla.value, nivel.value * 0.45));
  return <NovaOrb size={size} orbes={4} expr={expr} mira={expr === 'normal' ? [0, 0.35] : undefined} hablaViva={luz} />;
}

/** un contacto para elegir: su foto (o sus iniciales), el nombre y en qué termina su número */
function Candidato({ c, onPress }: { c: Contacto; onPress: () => void }) {
  const { t } = useIdioma();
  const iniciales = c.nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('');
  const cola = c.telefonos[0]?.slice(-4);
  return (
    <Pressable onPress={onPress} accessibilityLabel={c.nombre} style={({ pressed }) => ({ width: 118, alignItems: 'center', gap: 7, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 20, borderWidth: 1, borderColor: C.l2, backgroundColor: pressed ? 'rgba(143,230,245,0.12)' : 'rgba(255,255,255,0.04)' })}>
      {c.foto ? (
        <Image source={{ uri: c.foto }} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.s2 }} contentFit="cover" />
      ) : (
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(143,230,245,0.14)', alignItems: 'center', justifyContent: 'center' }}>
          <Txt f="s" size={19} color={C.nova}>{iniciales}</Txt>
        </View>
      )}
      <Txt f="m" size={13.5} style={{ textAlign: 'center' }}>{c.nombre}</Txt>
      {cola ? <Txt f="mono" size={10.5} ls={0.6} color={C.t3}>{t('Ends in {x}', { x: cola })}</Txt> : null}
    </Pressable>
  );
}

function Anillo({ k, nivel, tam = 200 }: { k: number; nivel: SharedValue<number>; tam?: number }) {
  const p = useSharedValue(0);
  useEffect(() => { p.set(withDelay(k * 600, withRepeat(withTiming(1, { duration: 1200, easing: Easing.out(Easing.quad) }), -1))); }, [k, p]);
  const st = useAnimatedStyle(() => ({ opacity: (1 - p.value) * (0.18 + nivel.value * 0.7), transform: [{ scale: 0.55 + p.value * (0.45 + nivel.value * 0.5) }] }));
  return <Animated.View style={[{ position: 'absolute', width: tam, height: tam, borderRadius: tam / 2, borderWidth: 1.5, borderColor: C.nova }, st]} />;
}
