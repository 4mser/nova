/* «Connect your watch»: cada marca llega a NOVA por un camino distinto, y esta pantalla muestra el que sirve para la
   tuya, con botones que hacen cada paso. Dos caminos:
   · Health Connect (pasos, sueño, pulso del día, SpO₂, ejercicio): la app del reloj escribe ahí y NOVA lee. Lo usan
     Mi Fitness, Samsung Health, Zepp, Garmin Connect y Fitbit. Huawei Health NO escribe en Health Connect.
   · Pulso en vivo por Bluetooth estándar: el reloj transmite el pulso y NOVA lo recibe directo (Huawei, Garmin,
     Amazfit y algunos Xiaomi). Galaxy Watch y Fitbit no lo transmiten. */
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIdioma } from '../i18n';
import { consentir, useConsentimiento } from '../sensores/fuentes';
import { conectarReloj, diagnosticoReloj, estadoBluetooth, permisos as permisosReloj, relojDisponible, type DiagReloj } from '../sensores/reloj';
import { diagnosticoSalud, leerSalud, pedirSalud, saludDisponible, type DiagSalud } from '../sensores/salud';
import { useVivo } from '../sensores/vivo';
import { volver } from '../ui/volver';
import { Boton, C, Cel, Txt } from '../ui/tema';

type Marca = { id: string; nombre: string; app?: string; paquetes?: string[]; hc: boolean; vivo: 'si' | 'algunos' | 'no'; vivoComo?: string };
const MARCAS: Marca[] = [
  { id: 'xiaomi', nombre: 'Xiaomi', app: 'Mi Fitness', paquetes: ['com.mi.health', 'com.xiaomi.wearable'], hc: true, vivo: 'algunos', vivoComo: 'On the watch, look for «Heart rate broadcast» (newer models only).' },
  { id: 'samsung', nombre: 'Samsung', app: 'Samsung Health', paquetes: ['com.sec.android.app.shealth'], hc: true, vivo: 'no' },
  { id: 'huawei', nombre: 'Huawei', app: 'Huawei Health', paquetes: ['com.huawei.health'], hc: false, vivo: 'si', vivoComo: 'On the watch: Settings › Workout settings › HR data broadcasts on. Then start a workout and keep it close.' },
  { id: 'amazfit', nombre: 'Amazfit', app: 'Zepp', paquetes: ['com.huami.watch.hmwatchmanager'], hc: true, vivo: 'si', vivoComo: 'On the watch, turn on «Heart rate broadcast» (in Settings or in the heart rate app).' },
  { id: 'garmin', nombre: 'Garmin', app: 'Garmin Connect', paquetes: ['com.garmin.android.apps.connectmobile'], hc: true, vivo: 'si', vivoComo: 'On the watch: open the controls menu or heart rate settings › «Broadcast heart rate».' },
  { id: 'fitbit', nombre: 'Fitbit / Pixel', app: 'Fitbit', paquetes: ['com.fitbit.FitbitMobile'], hc: true, vivo: 'no' },
  { id: 'otro', nombre: 'Other', hc: true, vivo: 'algunos', vivoComo: 'If your watch or band can broadcast heart rate over Bluetooth, turn it on and keep it close.' },
];
const CLAVE = 'nova.marcaReloj.v1';

// de dónde vienen los datos que ya llegan (dataOrigin de Health Connect, abreviado en salud.ts)
const ORIGEN: Record<string, string> = { mi: 'Mi Fitness', xiaomi: 'Mi Fitness', sec: 'Samsung Health', samsung: 'Samsung Health', huami: 'Zepp', garmin: 'Garmin', fitbit: 'Fitbit', huawei: 'Huawei' };

function abrirApp(m: Marca) {
  const IL = Platform.OS === 'android' && requireOptionalNativeModule('ExpoIntentLauncher') ? (require('expo-intent-launcher') as typeof import('expo-intent-launcher')) : null; // eslint-disable-line @typescript-eslint/no-require-imports
  for (const p of m.paquetes ?? []) {
    try { if (IL) { IL.openApplication(p); return; } } catch { /* esa app no está instalada: se prueba la siguiente */ }
  }
  if (m.paquetes?.[0]) Linking.openURL(`market://details?id=${m.paquetes[0]}`).catch(() => {});
}
/* la pantalla de Health Connect donde se le da permiso de escritura a la app del reloj */
function abrirPermisosDe(paquete?: string) {
  try { (require('react-native-health-connect') as typeof import('react-native-health-connect')).openHealthConnectDataManagement(paquete); } // eslint-disable-line @typescript-eslint/no-require-imports
  catch { abrirHealthConnect(); }
}
const instalarHC = () => Linking.openURL('market://details?id=com.google.android.apps.healthdata').catch(() => {});
function abrirBluetooth() {
  const IL = Platform.OS === 'android' && requireOptionalNativeModule('ExpoIntentLauncher') ? (require('expo-intent-launcher') as typeof import('expo-intent-launcher')) : null; // eslint-disable-line @typescript-eslint/no-require-imports
  if (IL) IL.startActivityAsync('android.settings.BLUETOOTH_SETTINGS').catch(() => Linking.openSettings());
  else Linking.openSettings();
}
// de qué marca vienen los datos (paquete de origen en Health Connect)
const MARCA_DE: [RegExp, string][] = [[/^com\.(mi\.health|xiaomi)/, 'xiaomi'], [/^com\.sec\.android|samsung/, 'samsung'], [/huami|zepp/, 'amazfit'], [/garmin/, 'garmin'], [/fitbit/, 'fitbit'], [/huawei/, 'huawei']];

function abrirHealthConnect() {
  try { (require('react-native-health-connect') as typeof import('react-native-health-connect')).openHealthConnectSettings(); } // eslint-disable-line @typescript-eslint/no-require-imports
  catch { Linking.openURL('market://details?id=com.google.android.apps.healthdata').catch(() => {}); }
}

export default function ConectarReloj() {
  const ins = useSafeAreaInsets(), { t } = useIdioma();
  const { c } = useConsentimiento(), v = useVivo();
  const [marca, setMarca] = useState<string | null>(null), [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => { AsyncStorage.getItem(CLAVE).then(m => m && setMarca(m)).catch(() => {}); }, []);
  const elegir = (id: string) => { setMarca(id); setAviso(null); AsyncStorage.setItem(CLAVE, id).catch(() => {}); };
  const m = MARCAS.find(x => x.id === marca);

  const activarHC = async () => {
    setAviso(null);
    const r = await pedirSalud();
    if (r.ok) consentir('salud', true); else setAviso(r.mensaje ?? 'No permission granted');
  };
  const buscarVivo = async () => {
    setAviso(null);
    if (!(await permisosReloj())) { setAviso('Allow Nearby devices for Nova in Android settings'); return; }
    consentir('reloj', true);
    conectarReloj();
  };

  const origenes = (v.salud?.origenes ?? []).map(o => ORIGEN[o] ?? o);
  const hcEstado = !saludDisponible() ? t('Needs the NOVA development build') : !c.salud ? t('Not on yet') : origenes.length ? t('Reading · from {apps}', { apps: origenes.join(', ') }) : t('On · no data from other apps yet');
  const vivoEstado = v.reloj.estado === 'conectado' ? t('Connected · {reloj}', { reloj: v.reloj.nombre ?? '' }) : v.reloj.estado === 'buscando' ? t('Searching for your watch…') : c.reloj && v.reloj.mensaje ? t(v.reloj.mensaje) : t('Not connected');

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: ins.bottom + 30 }}>
        <Txt f="s" size={30} ls={-1.2} lh={34}>{t('Connect your watch')}</Txt>
        <Txt size={15} lh={21} color={C.t2} style={{ marginTop: 6 }}>{t('Each brand reaches Nova a different way. Pick yours and follow the steps.')}</Txt>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
          {MARCAS.map(x => {
            const on = x.id === marca;
            return (
              <Pressable key={x.id} onPress={() => elegir(x.id)} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={{ paddingHorizontal: 16, height: 40, borderRadius: 20, justifyContent: 'center', backgroundColor: on ? C.nova : C.s1, borderWidth: 1, borderColor: on ? C.nova : C.l2 }}>
                <Txt f="m" size={14.5} color={on ? C.tinta : C.t1}>{t(x.nombre)}</Txt>
              </Pressable>
            );
          })}
        </View>

        <Asistente marca={m} alDetectar={elegir} />

        {m ? (
          <View style={{ gap: 14, marginTop: 20 }}>
            <Txt f="m" size={13} color={C.t3} style={{ paddingHorizontal: 4 }}>{t('Step by step')}</Txt>
            {/* camino 1: Health Connect */}
            <Cel style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="fitness-outline" size={20} color={m.hc ? C.ok : C.t3} />
                <Txt f="s" size={16.5} style={{ flex: 1 }}>{t('Steps, sleep and heart rate of the day')}</Txt>
              </View>
              {m.hc ? (
                <>
                  <Paso n={1} texto={m.app ? t('Pair your watch in {app} (if it is not already).', { app: m.app }) : t('Pair your watch in its own app (if it is not already).')} />
                  <Paso n={2} texto={m.app ? t('In {app}, find «Health Connect» (usually in your profile or in connected apps) and turn on sharing.', { app: m.app }) : t('In your watch app, find «Health Connect» and turn on sharing.')} />
                  <Paso n={3} texto={t('Turn on Health Connect in Nova and allow what it asks.')} />
                  <Paso n={4} texto={m.app ? t('Open {app} once so it syncs. Data arrives with each sync, not live.', { app: m.app }) : t('Open your watch app once so it syncs. Data arrives with each sync, not live.')} />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
                    {m.app ? <Boton t={t('Open {app}', { app: m.app })} icono="open-outline" onPress={() => abrirApp(m)} /> : null}
                    <Boton t={t('Open Health Connect')} icono="settings-outline" onPress={abrirHealthConnect} />
                    {!c.salud ? <Boton t={t('Turn on in Nova')} icono="checkmark" primario onPress={activarHC} /> : null}
                  </View>
                  <Estado texto={hcEstado} ok={!!origenes.length} />
                </>
              ) : (
                <Txt size={14} lh={20} color={C.t2}>{t('{app} does not share data with other apps on Android, so steps and sleep from Huawei cannot reach Nova yet. Live heart rate does work (below).', { app: m.app ?? m.nombre })}</Txt>
              )}
            </Cel>

            {/* camino 2: pulso en vivo */}
            <Cel style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="pulse-outline" size={20} color={m.vivo === 'no' ? C.t3 : C.alerta} />
                <Txt f="s" size={16.5} style={{ flex: 1 }}>{t('Live heart rate')}</Txt>
              </View>
              {m.vivo === 'no' ? (
                <Txt size={14} lh={20} color={C.t2}>{t('This watch does not broadcast heart rate to other apps. Nova reads it from Health Connect after each sync.')}</Txt>
              ) : !relojDisponible() ? (
                <Txt size={14} lh={20} color={C.t2}>{t('Needs the NOVA development build')}</Txt>
              ) : (
                <>
                  <Txt size={14} lh={20} color={C.t2}>{t(m.vivoComo ?? '')}</Txt>
                  {m.vivo === 'algunos' ? <Txt size={12.5} lh={18} color={C.t3}>{t('If your watch does not have that option, it cannot send live heart rate: use Health Connect.')}</Txt> : null}
                  <View style={{ flexDirection: 'row', marginTop: 2 }}>
                    <Boton t={v.reloj.estado === 'buscando' ? t('Searching…') : t('Find my watch')} icono="bluetooth-outline" primario={m.vivo === 'si'} onPress={buscarVivo} />
                  </View>
                  {c.reloj || v.reloj.estado !== 'apagado' ? <Estado texto={vivoEstado} ok={v.reloj.estado === 'conectado'} /> : null}
                </>
              )}
            </Cel>
            {aviso ? <Txt size={13} color={C.aviso} style={{ paddingHorizontal: 4 }}>{t(aviso)}</Txt> : null}
          </View>
        ) : (
          <Txt size={14} color={C.t3} style={{ marginTop: 20, paddingHorizontal: 4 }}>{t('Choose the brand of your watch to see how to connect it.')}</Txt>
        )}
        <Diagnostico activarHC={activarHC} />
      </ScrollView>
    </View>
  );
}

function Paso({ n, texto }: { n: number; texto: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
        <Txt f="s" size={12} color={C.nova}>{n}</Txt>
      </View>
      <Txt size={14} lh={20} color={C.t1} style={{ flex: 1 }}>{texto}</Txt>
    </View>
  );
}

function Estado({ texto, ok }: { texto: string; ok: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ok ? C.ok : C.aviso }} />
      <Txt f="m" size={12.5} color={ok ? C.ok : C.aviso} style={{ flex: 1 }}>{texto}</Txt>
    </View>
  );
}

/* «¿No conecta?»: lo que Nova ve de verdad en este teléfono, para saber en qué paso se corta */
function Diagnostico({ activarHC }: { activarHC: () => Promise<void> }) {
  const { t } = useIdioma();
  const [revisando, setRevisando] = useState(false), [salud, setSalud] = useState<DiagSalud | null>(null), [reloj, setReloj] = useState<DiagReloj | null>(null);
  const revisar = async () => {
    setRevisando(true); setSalud(null); setReloj(null);
    const [a, b] = await Promise.all([diagnosticoSalud(), diagnosticoReloj()]);
    setSalud(a); setReloj(b); setRevisando(false);
  };
  const fecha = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const NOMBRE: Record<string, string> = { Steps: t('Steps'), HeartRate: t('Heart rate'), SleepSession: t('Sleep'), RestingHeartRate: t('Resting heart rate') };
  return (
    <Cel style={{ gap: 10, marginTop: 22 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Ionicons name="medkit-outline" size={20} color={C.lila} />
        <Txt f="s" size={16.5} style={{ flex: 1 }}>{t('Not connecting? Check what Nova sees')}</Txt>
      </View>
      <Txt size={13.5} lh={19} color={C.t2}>{t('Takes about 12 seconds. Keep the watch close and Bluetooth on. A screenshot of the result tells us exactly where it breaks.')}</Txt>
      <View style={{ flexDirection: 'row' }}>
        <Boton t={revisando ? t('Checking…') : t('Check now')} icono="search-outline" onPress={revisando ? () => {} : revisar} />
      </View>
      {salud ? (
        <View style={{ gap: 6, marginTop: 4 }}>
          <Txt f="m" size={13} color={C.t3}>HEALTH CONNECT</Txt>
          <Linea ok={salud.modulo} texto={salud.modulo ? t('This Nova app supports Health Connect') : t('This Nova app does not include Health Connect: install the newest Nova APK')} />
          {salud.modulo ? <Linea ok={salud.sdk === 3} texto={salud.sdk === 3 ? t('Health Connect is on this phone') : salud.sdk === 2 ? t('Health Connect needs an update from the Play Store') : t('Health Connect is not installed on this phone')} /> : null}
          {salud.sdk === 3 ? <Linea ok={salud.permisos.length > 0} texto={salud.permisos.length ? t('Nova can read: {x}', { x: salud.permisos.join(', ') }) : t('Nova has no permission yet')} /> : null}
          {salud.sdk === 3 && !salud.permisos.length ? <View style={{ flexDirection: 'row' }}><Boton t={t('Turn on in Nova')} icono="checkmark" primario onPress={activarHC} /></View> : null}
          {salud.registros.filter(r => r.n !== -1).map(r => (
            <Linea key={r.tipo} ok={r.n > 0} texto={r.n > 0 ? t('{tipo}: {n} records in 7 days · from {apps} · last {f}', { tipo: NOMBRE[r.tipo] ?? r.tipo, n: r.n, apps: r.origenes.join(', '), f: fecha(r.ultimo) }) : r.n === -2 ? t('{tipo}: error reading ({e})', { tipo: NOMBRE[r.tipo] ?? r.tipo, e: r.ultimo ?? '' }) : t('{tipo}: no data in 7 days. Your watch app is not sending it to Health Connect.', { tipo: NOMBRE[r.tipo] ?? r.tipo })} />
          ))}
          {salud.error ? <Linea ok={false} texto={salud.error} /> : null}
        </View>
      ) : null}
      {reloj ? (
        <View style={{ gap: 6, marginTop: 6 }}>
          <Txt f="m" size={13} color={C.t3}>BLUETOOTH</Txt>
          <Linea ok={reloj.modulo} texto={reloj.modulo ? t('This Nova app supports Bluetooth heart rate') : t('This Nova app does not include Bluetooth: install the newest Nova APK')} />
          {reloj.modulo ? <Linea ok={!!reloj.permiso} texto={reloj.permiso ? t('Nearby devices permission granted') : t('Nearby devices permission is off for Nova')} /> : null}
          {reloj.bluetooth ? <Linea ok={reloj.bluetooth === 'PoweredOn'} texto={reloj.bluetooth === 'PoweredOn' ? t('Bluetooth is on') : t('Bluetooth: {e}', { e: reloj.bluetooth })} /> : null}
          {reloj.conectados.length ? <Linea ok texto={t('Connected and sharing heart rate: {x}', { x: reloj.conectados.join(', ') })} /> : null}
          {reloj.bluetooth === 'PoweredOn' ? (
            reloj.equipos.length ? (
              reloj.equipos.map((e, i) => <Linea key={i} ok={e.pulso} texto={`${e.nombre || t('No name')} · ${e.pulso ? t('broadcasts heart rate') : t('does not announce heart rate')}${e.rssi != null ? ` · ${e.rssi} dBm` : ''}`} />)
            ) : (
              <Linea ok={false} texto={t('No Bluetooth devices seen nearby. Many watches only appear while broadcasting heart rate.')} />
            )
          ) : null}
          {reloj.error ? <Linea ok={false} texto={reloj.error} /> : null}
        </View>
      ) : null}
    </Cel>
  );
}

function Linea({ ok, texto }: { ok: boolean; texto: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Ionicons name={ok ? 'checkmark-circle' : 'close-circle'} size={16} color={ok ? C.ok : C.aviso} style={{ marginTop: 2 }} />
      <Txt size={13.5} lh={19} color={C.t1} style={{ flex: 1 }}>{texto}</Txt>
    </View>
  );
}

/* El asistente: revisa en qué paso estás y muestra UNA acción que lleva al lugar correcto. Vuelve a revisar solo al
   volver de otra app (Health Connect, la app del reloj, Ajustes) y avanza. */
type PasoAsistente = { texto: string; detalle?: string; boton?: { t: string; icono: keyof typeof Ionicons.glyphMap; accion: () => void }; otro?: { t: string; accion: () => void }; listo?: boolean };
function Asistente({ marca, alDetectar }: { marca?: Marca; alDetectar: (id: string) => void }) {
  const { t } = useIdioma();
  const v = useVivo();
  const [salud, setSalud] = useState<DiagSalud | null>(null), [bt, setBt] = useState<{ modulo: boolean; permiso: boolean; encendido: boolean } | null>(null);
  const [revisando, setRevisando] = useState(true);

  const revisar = useCallback(async () => {
    setRevisando(true);
    const [s, b] = await Promise.all([diagnosticoSalud(), estadoBluetooth()]);
    setSalud(s); setBt(b); setRevisando(false);
    // ya llegan datos: Health Connect queda activo en Nova
    if (s.registros.some(r => r.n > 0)) {
      consentir('salud', true);
      leerSalud().catch(() => {});
    }
  }, []);

  // si no había marca elegida, se deduce de la app que manda los datos
  const origen = salud?.registros.flatMap(r => r.origenes)[0];
  useEffect(() => {
    if (!origen || marca) return;
    const deducida = MARCA_DE.find(([re]) => re.test(origen))?.[1];
    if (deducida) alDetectar(deducida);
  }, [origen, marca, alDetectar]);

  useEffect(() => {
    const id = setTimeout(revisar, 0);
    const sub = AppState.addEventListener('change', e => { if (e === 'active') revisar(); });
    return () => { clearTimeout(id); sub.remove(); };
  }, [revisar]);

  // cuando el reloj se conecta en vivo, se celebra sin esperar otra revisión
  const vivoListo = v.reloj.estado === 'conectado';
  const conDatos = (salud?.registros ?? []).filter(r => r.n > 0);
  const origenes = [...new Set(conDatos.flatMap(r => r.origenes))].map(o => ORIGEN[o.replace(/^com\.(google\.android\.apps\.)?/, '').split('.')[0]] ?? o);
  const paquete = marca?.paquetes?.find(p => conDatos.some(r => r.origenes.includes(p))) ?? marca?.paquetes?.[0];

  const pasoSalud = (): PasoAsistente | null => {
    if (!salud || marca?.hc === false) return null;
    if (!salud.modulo) return { texto: t('This Nova app does not include Health Connect: install the newest Nova APK') };
    if (salud.sdk === 1 || salud.sdk == null) return { texto: t('Install Health Connect'), detalle: t('Your watch app sends its data to Health Connect, and Nova reads it from there.'), boton: { t: t('Install from the Play Store'), icono: 'download-outline', accion: instalarHC } };
    if (salud.sdk === 2) return { texto: t('Update Health Connect'), detalle: t('Your phone has an old version.'), boton: { t: t('Update from the Play Store'), icono: 'download-outline', accion: instalarHC } };
    if (!salud.permisos.length) return { texto: t('Let Nova read Health Connect'), detalle: t('Only reading. You choose what in the next screen.'), boton: { t: t('Give permission'), icono: 'checkmark', accion: async () => { const r = await pedirSalud(); if (r.ok) consentir('salud', true); revisar(); } } };
    if (conDatos.length) return { texto: t('Done: Nova receives your data from {apps}', { apps: origenes.join(', ') }), detalle: t('Steps, sleep and heart rate arrive each time your watch app syncs.'), listo: true };
    if (!marca) return { texto: t('Health Connect is ready. Which watch do you have?'), detalle: t('Choose the brand above to take you to the right place.') };
    return {
      texto: t('{app} is not sending your data yet', { app: marca.app ?? t('Your watch app') }),
      detalle: t('Turn on the permissions for {app} in Health Connect. If {app} does not appear there, open {app} and turn on Health Connect in its settings; then come back here.', { app: marca.app ?? t('your watch app') }),
      boton: { t: t('Open {app} in Health Connect', { app: marca.app ?? 'app' }), icono: 'key-outline', accion: () => abrirPermisosDe(paquete) },
      otro: marca.app ? { t: t('Open {app}', { app: marca.app }), accion: () => abrirApp(marca) } : undefined,
    };
  };

  const pasoVivo = (): PasoAsistente | null => {
    if (!marca || marca.vivo === 'no' || !bt) return null;
    if (!bt.modulo) return { texto: t('This Nova app does not include Bluetooth: install the newest Nova APK') };
    if (vivoListo) return { texto: t('Connected · {reloj}', { reloj: v.reloj.nombre ?? '' }), detalle: t('Live heart rate is reaching Nova.'), listo: true };
    if (!bt.permiso) return { texto: t('Let Nova find your watch'), detalle: t('Permission for nearby devices, only to read heart rate.'), boton: { t: t('Give permission'), icono: 'bluetooth-outline', accion: async () => { await permisosReloj(); revisar(); } } };
    if (!bt.encendido) return { texto: t('Turn Bluetooth on'), boton: { t: t('Open Bluetooth settings'), icono: 'bluetooth-outline', accion: abrirBluetooth } };
    if (v.reloj.estado === 'buscando') return { texto: t('Searching for your watch…'), detalle: t(marca.vivoComo ?? '') };
    return {
      texto: t('Live heart rate'),
      detalle: t(marca.vivoComo ?? ''),
      boton: { t: t('Find and connect my watch'), icono: 'pulse-outline', accion: () => { consentir('reloj', true); conectarReloj(); } },
    };
  };

  const pasos = [pasoSalud(), pasoVivo()].filter(Boolean) as PasoAsistente[];
  return (
    <Cel style={{ gap: 14, marginTop: 18, borderColor: `${C.nova}44` }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Txt f="m" size={12.5} color={C.nova} style={{ flex: 1, textTransform: 'uppercase', letterSpacing: 1 }}>{t('Next step')}</Txt>
        {revisando ? <ActivityIndicator size="small" color={C.nova} /> : <Pressable onPress={revisar} hitSlop={8}><Ionicons name="refresh" size={16} color={C.t3} /></Pressable>}
      </View>
      {!pasos.length && !revisando ? <Txt size={14} color={C.t2}>{t('Choose the brand of your watch to see how to connect it.')}</Txt> : null}
      {pasos.map((p, i) => (
        <View key={i} style={{ gap: 8, paddingTop: i ? 12 : 0, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <Ionicons name={p.listo ? 'checkmark-circle' : 'arrow-forward-circle'} size={20} color={p.listo ? C.ok : C.nova} style={{ marginTop: 1 }} />
            <Txt f="s" size={16} lh={21} style={{ flex: 1 }}>{p.texto}</Txt>
          </View>
          {p.detalle ? <Txt size={13.5} lh={19} color={C.t2} style={{ paddingLeft: 28 }}>{p.detalle}</Txt> : null}
          {p.boton || p.otro ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingLeft: 28 }}>
              {p.boton ? <Boton t={p.boton.t} icono={p.boton.icono} primario onPress={p.boton.accion} /> : null}
              {p.otro ? <Boton t={p.otro.t} icono="open-outline" onPress={p.otro.accion} /> : null}
            </View>
          ) : null}
        </View>
      ))}
    </Cel>
  );
}
