/* La hoja de NOVA: conversación en tiempo real por voz o texto (API Live, voz Aoede de los videos), en el idioma
   en que le hables. NOVA tiene los datos del día y solo afirma lo que está en ellos.
   · una sola pantalla: lo que dices y lo que ella responde aparece escrito en el chat mientras se habla
   · al abrir, NOVA está al centro con su saludo debajo; al conversar queda chica en la cabecera
   · micrófono: la barra de escritura se convierte en un panel con NOVA viva, justo bajo la última respuesta
   · su cuerpo ondula y emite luz con la envolvente real de su voz
   Sin servidor de voz, NOVA usa el motor de reglas local y la voz del teléfono. */
import { Ionicons } from '@expo/vector-icons';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { KeyboardAvoidingView, useKeyboardState } from 'react-native-keyboard-controller';
import Animated, { Easing, FadeIn, FadeInDown, FadeInUp, FadeOut, LinearTransition, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { entender, id, responder, type Entendido, type Msg } from '../engine/conversa';
import { hoy } from '../engine/motor';
import { NovaOrb } from '../nova/NovaOrb';
import { Orbita } from '../nova/Orbita';
import { C, F, Toque, Txt } from '../ui/tema';
import { urlVivo, useNovaVivo } from '../voz/vivo';
import { resumenVivo } from '../sensores/vivo';
import { graficoPara, TarjetaGrafico } from '../ui/TarjetasNova';
import { TarjetaAccion } from '../ui/TarjetasAccion';
import { TarjetaMensaje } from '../ui/TarjetaMensaje';
import { useVozTelefono } from '../voz/voz';
import { useIdioma } from '../i18n';
import { CLAVE_TAREAS, leerCache, type Tarea } from '../cuenta/datos';
import { anotar } from '../engine/actividad';
import { senal } from '../engine/recorrido';
import { ejecutar } from '../voz/acciones';
import { iniciarFoco } from '../cuenta/momento';
import { useCrew, useSesion } from '../cuenta/sesion';
import { datosConversacion } from '../voz/contexto';
import { leerFunciones, useFunciones } from '../engine/funciones';

// una sugerencia va en el otro idioma, para mostrar que NOVA entiende los dos
const SUGERENCIAS_DIA = {
  en: ['What do I have today?', 'Remind me to call mom', '¿Cómo dormí?', '25 minutes of focus', 'Quiz me on what I am studying'],
  es: ['¿Qué tengo para hoy?', 'Recuérdame llamar a mi mamá', 'How did I sleep?', '25 minutos de foco', 'Hazme preguntas de lo que estoy estudiando'],
};
const SUGERENCIAS = {
  en: ['How am I today?', 'Show me my sleep this week', '¿Cuánta radiación llevo?', 'Am I clear for the spacewalk?', "What's my plan today?"],
  es: ['¿Cómo estoy hoy?', 'Muéstrame mi sueño de esta semana', 'How much radiation have I had?', '¿Puedo salir a la caminata espacial?', '¿Qué tengo en el plan de hoy?'],
};

export default function Nova() {
  const { modo: modoRuta, q: pregunta } = useLocalSearchParams<{ modo?: string; q?: string }>();
  const tr = useIdioma(), { t } = tr;
  const checkin = modoRuta === 'checkin', H = hoy(tr), ins = useSafeAreaInsets();
  // sin servidor configurado, NOVA arranca con el motor de reglas local
  const misionAhora = leerFunciones().mision;
  const inicialLocal = (): Msg => ({ id: id(), de: 'nova', texto: checkin ? t("How was today, {nombre}? Say it however it comes. I'll pick out the rest.", { nombre: H.nombre }) : misionAhora ? H.resp.mensaje : t("Hi {nombre}. I can't reach my voice service right now, but you can still add tasks, start a focus session or do your check-in.", { nombre: H.nombre }), refs: checkin || !misionAhora ? undefined : H.resp.evidenceRefs });
  const [msgs, setMsgs] = useState<Msg[]>(() => (urlVivo() ? [] : [inicialLocal()]));
  const [texto, setTexto] = useState('');
  const [piensa, setPiensa] = useState(false);
  const [vozOn, setVozOn] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enVoz, setEnVoz] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const tecladoAbierto = useKeyboardState(k => k.isVisible);
  const actual = useRef<{ nova: string | null; yo: string | null }>({ nova: null, yo: null });
  const primera = useRef(true), primeraLocal = useRef(false);
  const { mision } = useFunciones(), { usuario } = useSesion(), crew = useCrew();
  // los datos se arman una vez al abrir la conversación
  const [datos] = useState(() => datosConversacion({ mision, usuario, crew, nombre: H.nombre }));
  const telefono = useVozTelefono();

  // la conversación en vivo va armando los mensajes a medida que llegan las transcripciones
  const vivo = useNovaVivo({
    modo: checkin ? 'checkin' : 'chat', datos, nombre: H.nombre, sol: H.sol, idioma: tr.idioma, perfil: mision ? 'mision' : 'diario',
    eventos: {
      dice: trozo => {
        setPiensa(false);
        const a = actual.current;
        if (!a.nova) {
          const nuevo: Msg = { id: id(), de: 'nova', texto: trozo.trimStart(), refs: primera.current && !checkin && misionAhora ? H.resp.evidenceRefs : undefined };
          primera.current = false; a.nova = nuevo.id;
          setMsgs(x => [...x, nuevo]);
        } else setMsgs(x => x.map(m => (m.id === a.nova ? { ...m, texto: m.texto + trozo } : m)));
      },
      oye: trozo => {
        senal('hablo');
        const a = actual.current;
        if (!a.yo) {
          const nuevo: Msg = { id: id(), de: 'yo', texto: trozo.trimStart(), voz: true };
          a.yo = nuevo.id;
          setMsgs(x => [...x, nuevo]);
          setPiensa(true);
        } else setMsgs(x => x.map(m => (m.id === a.yo ? { ...m, texto: m.texto + trozo } : m)));
      },
      finTurno: () => { actual.current = { nova: null, yo: null }; setPiensa(false); },
      sinConexion: () => {
        setPiensa(false);
        const ini = inicialLocal();
        setMsgs(x => (x.length ? x : [ini]));
        if (vozOn && !primeraLocal.current) { primeraLocal.current = true; telefono.decir(ini.texto); }
      },
      herramienta: (nombre, args) => {
        if (nombre === 'mostrar_grafico' || nombre === 'mostrar_resumen' || nombre === 'mostrar_plan') {
          const g = nombre === 'mostrar_grafico' ? String(args.metrica) : nombre === 'mostrar_resumen' ? 'summary' : 'plan';
          // un mismo gráfico no se repite seguido
          setMsgs(x => (x.slice(-3).some(m => m.grafico === g) ? x : [...x, { id: id(), de: 'nova', texto: '', grafico: g }]));
          return;
        }
        if (nombre === 'registrar_checkin') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          setMsgs(x => [...x, { id: id(), de: 'nova', texto: '', tarjeta: { animo: String(args.animo ?? 'Okay'), estres: String(args.estres ?? 'Low'), fatiga: String(args.fatiga ?? 'None') } }]);
          return;
        }
        // día a día: NOVA hace cosas de verdad (src/voz/acciones.ts) y le cuenta al modelo cómo resultó
        if (nombre !== 'empezar_foco') {
          return ejecutar(nombre, args, { tr, crew: crew ? { id: crew.id, nombre: crew.nombre } : null, tareas: leerCache<Tarea[]>(CLAVE_TAREAS) ?? [], yo: usuario?.id }).then(r => {
            if (!r) return { ok: false, motivo: 'unknown tool' };
            if (r.visual?.tipo === 'mensaje') {
              // el borrador: una sola tarjeta viva (si NOVA lo reescribe, la misma tarjeta cambia)
              setMsgs(x => (x.some(m => m.visual?.tipo === 'mensaje') ? x : [...x, { id: id(), de: 'nova', texto: '', visual: r.visual }]));
            } else if (r.accion) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              setMsgs(x => [...x, { id: id(), de: 'nova', texto: '', accion: r.accion, visual: r.visual }]);
            }
            if (r.ir) setTimeout(() => router.push(r.ir as never), 1600);
            return r.respuesta;
          });
        }
        if (nombre === 'empezar_foco') {
          const min = Math.max(5, Math.min(120, Math.round(Number(args.minutos) || 25))), que = args.que ? String(args.que) : undefined;
          iniciarFoco(min, args.aprender ? 'aprender' : 'foco', que);
          const accion = { icono: 'timer', texto: t('Focus session started: {n} min', { n: min }) + (que ? ` · ${que}` : ''), ir: '/foco' };
          anotar(accion);
          setMsgs(x => [...x, { id: id(), de: 'nova', texto: '', accion, visual: { tipo: 'foco', min, que } }]);
        }
      },
    },
  });

  // sin servidor: motor de reglas local y voz del teléfono
  const local = vivo.estado === 'sin_conexion';
  const [esperaCheckin, setEsperaCheckin] = useState(checkin);

  const habla = local ? telefono.habla : vivo.habla;
  const hablando = local ? telefono.hablando : vivo.hablando;

  const enviar = (escrito: string) => {
    const q = escrito.trim(); if (!q) return;
    senal('hablo');
    setTexto(''); setAviso(null);
    setMsgs(x => [...x, { id: id(), de: 'yo', texto: q }]);
    setPiensa(true);
    if (!local) { vivo.interrumpir(); actual.current = { nova: null, yo: null }; vivo.texto(q); return; }
    // modo local (reglas)
    telefono.callar();
    setTimeout(() => {
      let r: Msg;
      if (esperaCheckin) {
        setEsperaCheckin(false);
        const ent: Entendido = entender(q);
        setMsgs(x => [...x, { id: id(), de: 'nova', texto: '', tarjeta: ent }]);
        r = { id: id(), de: 'nova', texto: ent.animo === 'Low' ? (misionAhora ? t("Thanks for telling me, {nombre}. If you want, I'll add this to Saturday's session with Dr. Ruiz.", { nombre: H.nombre }) : t('Thanks for telling me, {nombre}. Go easy on yourself tonight; tomorrow is a new day.', { nombre: H.nombre })) : t('Thanks, {nombre}. Logged for tonight. Rest well.', { nombre: H.nombre }) };
      } else r = misionAhora ? responder(q, tr) : { id: id(), de: 'nova', texto: t("I can't reach my voice service right now, so I can't answer that. Your tasks and focus sessions still work.") };
      const g = misionAhora ? graficoPara(q) : null;
      setPiensa(false); setMsgs(x => [...x, r, ...(g ? [{ id: id(), de: 'nova' as const, texto: '', grafico: g }] : [])]);
      if (vozOn) telefono.decir(r.texto);
    }, 700);
  };

  // modo conversación por voz
  const abrirVoz = async () => {
    // sin conexión con la voz: el micrófono vuelve a intentarlo (el servidor puede haber estado dormido)
    if (local) { vivo.reconectar(); setAviso(t('Reconnecting to Nova’s voice… You can still type.')); return; }
    const { granted, canAskAgain } = await requestRecordingPermissionsAsync();
    if (!granted) {
      setAviso(t('Microphone access is off. Turn it on in Settings to talk to Nova.'));
      // si Android ya no deja preguntar, se abren los Ajustes de la app directamente
      if (!canAskAgain) Linking.openSettings().catch(() => {});
      return;
    }
    try { await vivo.escuchar(); } catch { setAviso(t("The microphone couldn't start. You can still type.")); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setEnVoz(true);
  };
  const cerrarVoz = () => { vivo.dejarDeEscuchar(); setEnVoz(false); };

  // llegó con una pregunta (desde «Compartir»): se envía apenas NOVA está lista
  const preguntada = useRef(false);
  useEffect(() => {
    if (!pregunta || preguntada.current || (vivo.estado !== 'listo' && !local)) return;
    preguntada.current = true;
    enviar(String(pregunta));
  }, [pregunta, vivo.estado, local]); // eslint-disable-line react-hooks/exhaustive-deps
  const conversando = msgs.some(m => m.de === 'yo');
  // NOVA recibe los datos en vivo cada 30 s (sin pedirle respuesta) mientras no está hablando
  useEffect(() => {
    if (local) return;
    const id = setInterval(() => { if (!hablando && vivo.estado === 'listo') vivo.contexto(resumenVivo()); }, 30000);
    return () => clearInterval(id);
  }, [local, hablando, vivo]);
  const estado = t(vivo.estado === 'conectando' ? 'Connecting…' : piensa ? 'Thinking…' : hablando ? 'Speaking…' : local ? 'Offline · on-board rules' : 'Live');
  const tono = local ? C.aviso : vivo.estado === 'conectando' ? C.t3 : C.ok;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* chat: todo sube junto con el teclado (translate-with-padding) y la barra de escribir queda pegada a él */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="translate-with-padding">
        {/* cabecera fija y compacta: NOVA chica solo cuando no está grande en otro lado */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: conversando ? C.l1 : 'transparent' }}>
          <Circulo icono="chevron-down" label={t('Close')} onPress={() => router.back()} />
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {conversando && (
              <Animated.View entering={FadeIn.duration(300)} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                <NovaOrb size={78} orbes={0} expr={piensa ? 'pensativa' : 'feliz'} hablaViva={habla} />
              </Animated.View>
            )}
            <View>
              <Txt f="s" size={16}>{checkin ? t('Evening check-in') : 'Nova'}</Txt>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: hablando || piensa ? C.nova : tono }} />
                <Txt size={12.5} color={hablando || piensa ? C.nova : C.t3}>{estado}</Txt>
              </View>
            </View>
          </View>
          <Circulo icono={vozOn ? 'volume-high-outline' : 'volume-mute-outline'} label={t(vozOn ? 'Mute Nova' : 'Unmute Nova')} activo={vozOn} onPress={() => { const v = !vozOn; setVozOn(v); vivo.silenciar(!v); if (!v) telefono.callar(); }} />
        </View>

        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 10 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })} keyboardShouldPersistTaps="handled">
          {/* al abrir, NOVA al centro; su saludo aparece justo debajo y todo sube a medida que conversan */}
          {!conversando && !enVoz && (
            <Animated.View exiting={FadeOut.duration(220)} style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 6 }}>
              <View style={{ width: 190, height: 190, alignItems: 'center', justifyContent: 'center' }}>
                <Orbita size={190} marcas={80} vel={vivo.estado === 'conectando' ? 1.6 : hablando ? 1 : 0.4} />
                <NovaOrb size={180} expr={piensa ? 'pensativa' : 'feliz'} orbes={4} hablaViva={habla} />
              </View>
              <Txt size={14} color={C.t3} style={{ marginTop: 4 }}>{t(checkin ? 'About one minute' : 'Ask me anything, in any language')}</Txt>
            </Animated.View>
          )}
          {msgs.map(m => (
            <Animated.View key={m.id} layout={LinearTransition.duration(220)}>
              {m.visual?.tipo === 'mensaje' ? <View style={{ alignSelf: 'flex-start', width: '86%', maxWidth: 340 }}><TarjetaMensaje /></View> : m.visual ? <TarjetaAccion v={m.visual} a={m.accion} /> : m.accion ? <Accion a={m.accion} /> : m.grafico ? <TarjetaGrafico tipo={m.grafico} /> : m.tarjeta ? <Tarjeta e={m.tarjeta} /> : m.de === 'yo' ? <MensajeMio m={m} /> : <MensajeNova m={m} />}
            </Animated.View>
          ))}
          {piensa && <Puntos />}
          {aviso && !(vivo.estado === 'listo' && aviso === t('Reconnecting to Nova’s voice… You can still type.')) && <Animated.View entering={FadeIn}><Txt size={13} color={C.aviso} style={{ textAlign: 'center', marginTop: 4 }}>{aviso}</Txt></Animated.View>}
        </ScrollView>

        {!conversando && !checkin && !enVoz && vivo.estado !== 'conectando' && (
          <Animated.View entering={FadeInUp.delay(300)} exiting={FadeOut}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 10 }} keyboardShouldPersistTaps="handled">
              {(mision ? SUGERENCIAS : SUGERENCIAS_DIA)[tr.idioma].map(s => (
                <Toque key={s} onPress={() => enviar(s)} style={{ paddingHorizontal: 16, height: 38, borderRadius: 19, justifyContent: 'center', backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2 }}>
                  <Txt size={14} color={C.t1}>{s}</Txt>
                </Toque>
              ))}
            </ScrollView>
          </Animated.View>
        )}

        {enVoz ? (
          <PanelVoz habla={habla} nivel={vivo.nivel} hablando={hablando} piensa={piensa} onInterrumpir={vivo.interrumpir} onCerrar={cerrarVoz} abajo={Math.max(ins.bottom, 12)} />
        ) : (
          <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: tecladoAbierto ? 10 : Math.max(ins.bottom, 12), backgroundColor: C.bg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 28, paddingLeft: 22, paddingRight: 8, height: 56, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2 }}>
              <TextInput
                value={texto}
                onChangeText={setTexto}
                onSubmitEditing={() => enviar(texto)}
                placeholder={t('Message Nova, in any language')}
                placeholderTextColor={C.t3}
                returnKeyType="send"
                style={{ flex: 1, height: 50, color: C.t1, fontFamily: F.r, fontSize: 16 }}
              />
              <Pressable onPress={texto.trim() ? () => enviar(texto) : abrirVoz} accessibilityLabel={t(texto.trim() ? 'Send' : 'Talk to Nova')} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.nova }}>
                <Ionicons name={texto.trim() ? 'arrow-up' : 'mic'} size={texto.trim() ? 20 : 19} color={C.tinta} />
              </Pressable>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

function Circulo({ icono, label, onPress, activo }: { icono: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; activo?: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel={label} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icono} size={18} color={activo ? C.nova : C.t2} />
    </Pressable>
  );
}

/** modo voz: un panel en la base, justo bajo la última respuesta. NOVA escucha (anillos con tu voz) o habla
    (luz y cuerpo con la suya); lo que dicen ambos va apareciendo escrito arriba, en el chat. */
function PanelVoz({ habla, nivel, hablando, piensa, onInterrumpir, onCerrar, abajo }: {
  habla: SharedValue<number>; nivel: SharedValue<number>; hablando: boolean; piensa: boolean; onInterrumpir: () => void; onCerrar: () => void; abajo: number;
}) {
  // mientras escucha, tu voz también la ilumina un poco
  const luz = useDerivedValue(() => Math.max(habla.value, nivel.value * 0.45));
  const { t } = useIdioma();
  const titulo = t(hablando ? 'Speaking' : piensa ? 'Thinking' : 'Listening');
  return (
    <Animated.View entering={FadeInDown.duration(260)} exiting={FadeOut.duration(160)} style={{ alignItems: 'center', paddingTop: 4, paddingBottom: abajo, borderTopWidth: 1, borderTopColor: C.l1, overflow: 'hidden' }}>
      <Pressable onPress={hablando ? onInterrumpir : undefined} accessibilityLabel={t(hablando ? 'Interrupt Nova' : 'Nova is listening')} style={{ width: 200, height: 170, alignItems: 'center', justifyContent: 'center' }}>
        {!hablando && [0, 1, 2].map(k => <Anillo key={k} k={k} nivel={nivel} />)}
        <NovaOrb size={190} orbes={5} expr={piensa ? 'pensativa' : hablando ? 'feliz' : 'normal'} mira={hablando ? undefined : [0, 0.3]} hablaViva={luz} />
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', paddingHorizontal: 20 }}>
        <View style={{ flex: 1 }}>
          <Txt f="s" size={16} color={hablando ? C.nova : C.t1}>{titulo}</Txt>
          <Txt size={13} color={C.t3}>{t(hablando ? 'Tap Nova to interrupt' : 'Speak in any language')}</Txt>
        </View>
        <Pressable onPress={onCerrar} accessibilityLabel={t('End voice conversation')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: C.s2, borderWidth: 1, borderColor: C.l2 }}>
          <Ionicons name="close" size={18} color={C.t1} />
          <Txt f="s" size={15}>{t('End')}</Txt>
        </Pressable>
      </View>
    </Animated.View>
  );
}

function Anillo({ k, nivel }: { k: number; nivel: SharedValue<number> }) {
  const t = useSharedValue(0);
  useEffect(() => { t.set(withDelay(k * 500, withRepeat(withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }), -1))); }, [k, t]);
  const st = useAnimatedStyle(() => ({ opacity: (1 - t.value) * (0.2 + nivel.value * 0.7), transform: [{ scale: 0.55 + t.value * (0.45 + nivel.value * 0.5) }] }));
  return <Animated.View style={[{ position: 'absolute', width: 300, height: 300, borderRadius: 150, borderWidth: 1.5, borderColor: C.nova }, st]} />;
}

function MensajeMio({ m }: { m: Msg }) {
  return (
    <Animated.View entering={FadeIn.duration(220)} style={{ alignSelf: 'flex-end', maxWidth: '84%', flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 22, borderBottomRightRadius: 8, backgroundColor: C.nova }}>
      {m.voz && <Ionicons name="mic" size={15} color={C.tinta} style={{ marginTop: 3 }} />}
      <Txt f="m" size={15.5} lh={22} color={C.tinta} style={{ flexShrink: 1 }}>{m.texto}</Txt>
    </Animated.View>
  );
}

function MensajeNova({ m }: { m: Msg }) {
  const { t } = useIdioma();
  return (
    <Animated.View entering={FadeIn.duration(350)} style={{ alignSelf: 'flex-start', maxWidth: '86%', gap: 8 }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 13, borderRadius: 22, borderBottomLeftRadius: 8, backgroundColor: C.s2 }}>
        <Txt size={15.5} lh={22}>{m.texto}</Txt>
      </View>
      {m.refs?.length ? (
        <Toque onPress={() => router.push('/evidencia')} style={{ flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 30, borderRadius: 15, borderWidth: 1, borderColor: C.l2 }}>
          <Ionicons name="document-text-outline" size={13} color={C.nova} />
          <Txt f="m" size={13} color={C.nova}>{t('See the evidence')}</Txt>
        </Toque>
      ) : null}
    </Animated.View>
  );
}

function Punto({ d }: { d: number }) {
  const o = useSharedValue(0.25);
  useEffect(() => { o.set(withDelay(d, withRepeat(withSequence(withTiming(1, { duration: 350 }), withTiming(0.25, { duration: 350 })), -1))); }, [d, o]);
  const st = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: (1 - o.value) * 2 }] }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.t2 }, st]} />;
}
function Puntos() {
  return (
    <Animated.View entering={FadeIn} style={{ flexDirection: 'row', gap: 5, paddingLeft: 14, paddingVertical: 6 }}>
      <Punto d={0} /><Punto d={150} /><Punto d={300} />
    </Animated.View>
  );
}

function Tarjeta({ e }: { e: Entendido }) {
  const { t, tc } = useIdioma();
  const col = (k: string, v: string) => (v === 'Good' || v === 'None' ? C.ok : v === 'Low' ? (k === 'Mood' ? C.aviso : C.sig) : v === 'High' ? C.alerta : C.aviso);
  // los valores llegan en inglés (de Gemini o de las reglas); la palabra cambia según de qué se habla
  const ctx: Record<string, string> = { Mood: 'animo', Stress: 'estres', Fatigue: 'fatiga' };
  return (
    <Animated.View entering={FadeIn.duration(260)} style={{ alignSelf: 'stretch', borderRadius: 24, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
        <Txt f="m" size={13} color={C.t2} style={{ flex: 1 }}>{t('What Nova understood')}</Txt>
        <Txt f="m" size={13} color={C.t3}>{t('logged for tonight')}</Txt>
      </View>
      {([['Mood', e.animo], ['Stress', e.estres], ['Fatigue', e.fatiga]] as const).map(([k, v], i) => (
        <Animated.View key={k} entering={FadeInDown.delay(120 + i * 110)} style={{ flexDirection: 'row', paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
          <Txt size={15} style={{ flex: 1 }}>{t(k)}</Txt>
          <Txt f="m" size={15} color={col(k, v)}>{tc(`tarjeta.${ctx[k]}`, v)}</Txt>
        </Animated.View>
      ))}
    </Animated.View>
  );
}

/** algo que NOVA hizo de verdad (agregó una tarea, empezó un foco): una línea con su ícono */
/** lo que NOVA acaba de hacer; tocarlo lleva a donde quedó (o dice dónde vive, si está fuera de la app) */
function Accion({ a }: { a: { icono: string; texto: string; ir?: string; donde?: string } }) {
  const { t } = useIdioma();
  return (
    <Animated.View entering={FadeIn.duration(220)} style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
      <Pressable disabled={!a.ir} onPress={() => a.ir && router.push(a.ir as never)} accessibilityRole={a.ir ? 'link' : undefined}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingLeft: 14, paddingRight: a.ir ? 10 : 14, borderRadius: 16, backgroundColor: C.sigSuave, opacity: pressed ? 0.7 : 1 })}>
        <Ionicons name={a.icono as keyof typeof Ionicons.glyphMap} size={16} color={C.nova} />
        <Txt f="m" size={14} color={C.nova} style={{ flexShrink: 1 }}>{a.texto}</Txt>
        {a.ir ? <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 2 }}><Txt f="s" size={12.5} color={C.t2}>{t('See')}</Txt><Ionicons name="chevron-forward" size={13} color={C.t2} /></View> : null}
      </Pressable>
      {a.donde ? <Txt size={12} color={C.t3} style={{ marginTop: 4, marginLeft: 6 }}>{a.donde}</Txt> : null}
    </Animated.View>
  );
}
