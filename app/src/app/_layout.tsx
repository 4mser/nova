import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import { SpaceGrotesk_300Light, SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, useFonts } from '@expo-google-fonts/space-grotesk';
import * as Notifications from 'expo-notifications';
import { DarkTheme, router, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Platform, Pressable, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PERMISOS_VISTOS, useBienvenidaVista } from '../cuenta/bienvenida';
import { instalarErrores, reportarError } from '../cuenta/errores';
import { estadoPermiso, pedirPermiso } from '../cuenta/permisos';
import { registrarPush } from '../cuenta/push';
import { cargarCola } from '../cuenta/cola';
import { useRecibirCompartido } from '../cuenta/compartido';
import { cargarRecordatorios, useRecordatorios } from '../cuenta/recordatorios';
import { useCompartirDia } from '../cuenta/compartirDia';
import { useEnlaceNave } from '../cuenta/nave';
import { useNaveEnVivo } from '../cuenta/naveEstado';
import { agendarMomentos, agendarResumen } from '../cuenta/momento';
import { cargarSesion, useCrew, useSesion } from '../cuenta/sesion';
import { useTiempoReal } from '../cuenta/tiempoReal';
import { cargarDiario, useDiario } from '../engine/diario';
import { cargarFoco } from '../engine/foco';
import { cargarFunciones, useFunciones } from '../engine/funciones';
import { cargarCiclo } from '../engine/ciclo';
import { cargarHabitos, sincronizarHabitos } from '../engine/habitos';
import { cargarMusica } from '../engine/musica';
import { cargarMemoria } from '../engine/memoria';
import { cargarPerfil } from '../engine/perfil';
import { cargarRepaso } from '../engine/repaso';
import { cargarHistoria } from '../sensores/historia';
import { cargarClima, refrescarClima } from '../sensores/clima';
import { cargarIdioma, useIdioma } from '../i18n';
import { useFuentes, useMedidorRuido } from '../sensores/telefono';
import { useWidgets } from '../widgets/datos';
import { actualizarWidgetCrew } from '../widgets/crew';
import { useBitacora, useEstados, useFotos, useListas, useMetas, useExternas, useGithubCrew, useStrava } from '../cuenta/datos';
import { rango7 } from '../engine/crewSalud';
import { cargarActividad } from '../engine/actividad';
import { cargarRutina } from '../engine/rutina';
import { cargarInicio } from '../engine/inicio';
import { cargarRendimiento } from '../engine/rendimiento';
import { MedidorFps } from '../ui/MedidorFps';
import { recuperarCompartir } from '../cuenta/pendiente';
import { useGithub, useIntegraciones } from '../cuenta/integraciones';
import { cargarRecorrido, empezarRecorrido, useRecorrido } from '../engine/recorrido';
import { cargarNovedades, marcarNovedadesVistas, useHayNovedades } from '../engine/novedades';
import { Recorrido } from '../ui/Recorrido';
import { cargarRecordatoriosPropios } from '../engine/recordatoriosPropios';
import { useAhora } from '../ui/ahora';
import { AvisoActualizacion } from '../ui/AvisoActualizacion';
import { SinConexion } from '../ui/SinConexion';
import { AvisoCrew } from '../ui/Crew';
import { NovaOrb } from '../nova/NovaOrb';
import { C, Txt } from '../ui/tema';

SplashScreen.preventAutoHideAsync().catch(() => {});
instalarErrores();

const tema = { ...DarkTheme, colors: { ...DarkTheme.colors, background: C.bg, card: C.bg, border: C.l1, primary: C.nova, text: C.t1 } };
const modal = { presentation: 'modal' as const, contentStyle: { backgroundColor: C.bg } };

export default function Raiz() {
  const [ok] = useFonts({ SpaceGrotesk_300Light, SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, IBMPlexMono_400Regular, IBMPlexMono_500Medium });
  const sesion = useSesion();
  // con sesión, primero se lee si esta cuenta ya vio la bienvenida (null mientras tanto: sigue el splash)
  const vista = useBienvenidaVista(sesion.usuario?.id);
  const leyendo = !!sesion.usuario && vista === null;
  useEffect(() => { if (ok && sesion.listo && !leyendo) SplashScreen.hideAsync().catch(() => {}); }, [ok, sesion.listo, leyendo]);
  // datos reales: cada fuente se enciende solo con tu consentimiento (src/sensores/fuentes.ts)
  useFuentes();
  useMedidorRuido();
  // widgets de la pantalla de inicio: se refrescan con los datos y con el diario
  const diario = useDiario(), { idioma } = useIdioma();
  useEffect(() => { cargarSesion(); cargarFunciones(); cargarFoco(); cargarDiario(); cargarPerfil(); cargarIdioma(); cargarHistoria(); cargarHabitos(); cargarRepaso(); cargarMusica(); cargarRecordatorios(); cargarClima(); cargarMemoria(); cargarCola(); cargarRecordatoriosPropios(); cargarActividad(); cargarRutina(); cargarInicio(); cargarRendimiento(); cargarCiclo(); }, []);
  useEffect(() => { const s = AppState.addEventListener('change', e => { if (e === 'active') { refrescarClima(); sincronizarHabitos(); } }); return () => s.remove(); }, []);
  useWidgets(diario, idioma);
  // la crew: tiempo real, tu día compartido y los avisos del momento NOVA
  useTiempoReal();
  useCompartirDia();
  useEnlaceNave();
  useNaveEnVivo();
  const crew = useCrew();
  // los momentos se agendan (y el permiso de avisos se pide) después de la bienvenida, que lo pide en su última página
  const dentro = !!sesion.usuario && vista === true;
  useEffect(() => { if (dentro) agendarMomentos(crew ? { id: crew.id, nombre: crew.nombre } : null); }, [dentro, crew?.id, crew?.nombre, idioma]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (dentro) { registrarPush(idioma); agendarResumen(); } }, [dentro, idioma]);
  useRecordatorios(dentro);
  // metas y bitácora del equipo siempre al día (NOVA las usa como contexto aunque no abras Crew)
  useMetas(dentro ? crew?.id ?? null : null);
  useBitacora(dentro ? crew?.id ?? null : null);
  useListas(dentro);
  // GitHub conectado: NOVA conoce tus PRs e issues aunque no abras la ficha
  const [tarde, setTarde] = useState(false);
  useEffect(() => { const id = setTimeout(() => setTarde(true), 4000); return () => clearTimeout(id); }, []);
  const { datos: cuentas } = useIntegraciones(dentro && tarde);
  useGithub(dentro && tarde && !!cuentas?.github?.conectado);
  // lo de la 0.5, también en segundo plano: tareas de Todoist/Google/Linear, GitHub de la crew y Strava
  useExternas(dentro && tarde && !!(cuentas?.todoist?.conectado || cuentas?.google?.conectado || cuentas?.linear?.conectado));
  useGithubCrew(dentro && tarde ? crew?.id ?? null : null);
  useStrava(dentro && tarde && !!cuentas?.strava?.conectado);
  const r7 = rango7(useAhora(30 * 60e3));
  useEstados(dentro ? crew?.id ?? null : null, r7.desde, r7.hasta);
  useRecibirCompartido(dentro);
  useEffect(() => {
    if (!dentro || Platform.OS === 'web') return;
    AsyncStorage.getItem(PERMISOS_VISTOS).then(async v => {
      if (v) return;
      AsyncStorage.setItem(PERMISOS_VISTOS, '1').catch(() => {});
      // el micrófono se pide al tiro (diálogo de Android); después, la lista con lo que falte
      await new Promise(r => setTimeout(r, 900));
      if ((await estadoPermiso('microfono')) === 'pedir') await pedirPermiso('microfono');
      router.push('/permisos');
    }).catch(() => {});
  }, [dentro]);
  useAbrirDesdeAviso(dentro);
  // volver de la cámara después de que Android cerró NOVA: recupera la foto o el video y abre Compartir
  useEffect(() => { if (dentro) recuperarCompartir(); }, [dentro]);
  // el recorrido con NOVA: una vez, cuando ya pasaste la bienvenida y los permisos y estás en Hoy
  const ruta = usePathname(), rec = useRecorrido(), funcionesActivas = useFunciones();
  useEffect(() => { cargarRecorrido(); }, []);
  useEffect(() => {
    // en modo misión no: el recorrido explica la app del día a día (tareas, crew, hábitos), que en la nave no está
    if (!dentro || !rec.cargado || rec.hecho || rec.activo || ruta !== '/' || funcionesActivas.mision) return;
    // quien recién llega ve todo en el recorrido: lo nuevo de esta versión ya queda visto
    const id = setTimeout(() => { marcarNovedadesVistas(); empezarRecorrido(); }, 1800);
    return () => clearTimeout(id);
  }, [dentro, rec.cargado, rec.hecho, rec.activo, ruta, funcionesActivas.mision]);
  // después de actualizar: NOVA cuenta qué hay de nuevo (una vez), cuando ya estás en Hoy
  const novedades = useHayNovedades();
  useEffect(() => { cargarNovedades(); }, []);
  useEffect(() => {
    if (!dentro || !novedades || !rec.cargado || !rec.hecho || rec.activo || ruta !== '/') return;
    const id = setTimeout(() => router.push('/novedades'), 1200);
    return () => clearTimeout(id);
  }, [dentro, novedades, rec.cargado, rec.hecho, rec.activo, ruta]);
  useWidgetCrew();
  if (!ok || !sesion.listo || leyendo) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bg }}>
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
      <ThemeProvider value={tema}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
            <Stack.Protected guard={!!sesion.usuario && vista === false}>
              <Stack.Screen name="bienvenida" options={{ animation: 'fade' }} />
            </Stack.Protected>
            <Stack.Protected guard={dentro}>
              <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
              <Stack.Screen name="nova" options={modal} />
              {/* modal completo: en Android una hoja con alturas se peleaba con el scroll del contenido */}
              <Stack.Screen name="evidencia" options={modal} />
              <Stack.Screen name="casa" options={modal} />
              <Stack.Screen name="emergencia" options={{ ...modal, presentation: 'fullScreenModal', gestureEnabled: false }} />
              <Stack.Screen name="datos" options={modal} />
              <Stack.Screen name="diario" options={modal} />
              <Stack.Screen name="reto" options={modal} />
              <Stack.Screen name="foco" options={modal} />
              <Stack.Screen name="habitos" options={modal} />
              <Stack.Screen name="repaso" options={modal} />
              <Stack.Screen name="resumen" options={modal} />
              <Stack.Screen name="permisos" options={modal} />
              <Stack.Screen name="standup" options={modal} />
              <Stack.Screen name="recibir" options={modal} />
              <Stack.Screen name="memoria" options={modal} />
              <Stack.Screen name="meta" options={modal} />
              <Stack.Screen name="crew-salud" options={modal} />
              <Stack.Screen name="recordatorios" options={modal} />
              <Stack.Screen name="actividad" options={modal} />
              <Stack.Screen name="rutina" options={modal} />
              <Stack.Screen name="mapa" options={modal} />
              <Stack.Screen name="habito" options={modal} />
              <Stack.Screen name="integraciones" options={modal} />
              <Stack.Screen name="personalizar" options={modal} />
              <Stack.Screen name="integracion" options={modal} />
              <Stack.Screen name="ajustes" options={modal} />
              <Stack.Screen name="listas" options={modal} />
              <Stack.Screen name="lista" options={modal} />
              <Stack.Screen name="nota" options={{ ...modal, presentation: 'fullScreenModal' }} />
              <Stack.Screen name="buenosdias" options={{ ...modal, presentation: 'fullScreenModal' }} />
              <Stack.Screen name="novedades" options={{ ...modal, presentation: 'fullScreenModal' }} />
              <Stack.Screen name="invitar" options={modal} />
              <Stack.Screen name="qr-nave" options={modal} />
              <Stack.Screen name="github" options={modal} />
              <Stack.Screen name="acta" options={modal} />
              <Stack.Screen name="retro" options={modal} />
              <Stack.Screen name="kudos" options={modal} />
              <Stack.Screen name="carga" options={modal} />
              <Stack.Screen name="crew-conexiones" options={modal} />
              <Stack.Screen name="unirse" options={modal} />
              <Stack.Screen name="compartir" options={{ ...modal, presentation: 'fullScreenModal' }} />
              <Stack.Screen name="historias" options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />
            </Stack.Protected>
            <Stack.Protected guard={!sesion.usuario}>
              <Stack.Screen name="entrar" options={{ animation: 'fade' }} />
            </Stack.Protected>
          </Stack>
          {dentro ? <AvisoCrew /> : null}
          <AvisoActualizacion />
          {dentro ? <SinConexion /> : null}
          {dentro ? <Recorrido /> : null}
          <MedidorFps />
        <StatusBar style="light" />
      </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

/** si una pantalla falla al dibujarse: se reporta y se ofrece reintentar, en vez de cerrar la app */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const { t } = useIdioma();
  useEffect(() => { reportarError(error, { donde: 'pantalla' }); }, [error]);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <NovaOrb size={150} orbes={2} expr="triste" />
      <Txt f="s" size={22} ls={-0.6} style={{ marginTop: 8, textAlign: 'center' }}>{t('Something went wrong')}</Txt>
      <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 8, textAlign: 'center', maxWidth: 300 }}>{t('Nova already reported it. Try again; if it keeps happening, tell your crew admin.')}</Txt>
      <Pressable onPress={() => { retry(); }} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 22, height: 50, paddingHorizontal: 26, borderRadius: 25, backgroundColor: C.nova, justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
        <Txt f="s" size={15.5} color={C.tinta}>{t('Try again')}</Txt>
      </Pressable>
    </View>
  );
}

// en web no hay notificaciones: el hook se reemplaza por uno vacío (fijo para toda la vida de la app)
const useUltimaRespuesta = Platform.OS === 'web' ? () => null : Notifications.useLastNotificationResponse;

/** tocar una notificación de NOVA (momento de la crew, fin del foco) abre su pantalla */
function useAbrirDesdeAviso(conSesion: boolean) {
  const r = useUltimaRespuesta();
  useEffect(() => {
    if (Platform.OS === 'web' || !conSesion || !r) return;
    const url = (r.notification.request.content.data as { url?: string } | undefined)?.url;
    if (url) router.push(url as never);
  }, [r, conSesion]);
}

/** el widget «Crew» se redibuja cuando cambian las fotos de hoy */
function useWidgetCrew() {
  const crew = useCrew();
  const { datos } = useFotos(crew?.id ?? null, crew?.hoy.fecha, crew?.hoy.fecha);
  useEffect(() => { actualizarWidgetCrew(crew, datos); }, [datos, crew?.id, crew?.hoy.fecha]); // eslint-disable-line react-hooks/exhaustive-deps
}
