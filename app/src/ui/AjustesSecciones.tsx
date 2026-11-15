/* Las secciones de Configuración (/ajustes): idioma, avisos, ciudad del clima, laboratorio y cuenta. Antes vivían sueltas
   en Tú; ahora están juntas y ordenadas en una sola pantalla. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { Interruptor } from '../ui/Interruptor';
import { C, Cel, F, Seccion, Txt } from '../ui/tema';
import { cambiarIdioma, IDIOMAS, useIdioma } from '../i18n';
import { cambiarClave, salir, useSesion } from '../cuenta/sesion';
import { cambiarFuncion, useFunciones } from '../engine/funciones';
import { agendarMomentos } from '../cuenta/momento';
import { cambiarRecordatorio, useRecordatoriosAjustes } from '../cuenta/recordatorios';
import { usePrefsAvisos, type CategoriaAviso } from '../cuenta/avisosCrew';
import { buscarCiudad, elegirCiudad, useClima, type Ciudad } from '../sensores/clima';
import { verBienvenidaOtraVez } from '../cuenta/bienvenida';
import { versionActual } from '../ui/AvisoActualizacion';
import { cambiarNave, useEnlaceEstado, useNave, type Asiento, type Pronombre } from '../cuenta/nave';
import { cambiarConfig as cambiarCiclo, useCiclo } from '../engine/ciclo';


/** foto y nombre: la foto se elige de la galería (recortada en cuadrado) y el nombre se edita en el lugar */
/** el idioma de toda la app (y con el que NOVA empieza a hablarte); cambia en el acto */
export function SelectorIdioma() {
  const { idioma, t } = useIdioma();
  return (
    <>
      <Seccion t={t('Language')} nota={idioma === 'es' ? 'Language' : 'Idioma'} />
      <Cel style={{ padding: 6 }}>
        <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 6 }}>
          {IDIOMAS.map(x => {
            const on = x.id === idioma;
            return (
              <Pressable key={x.id} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={x.nombre}
                onPress={() => { if (!on) { Haptics.selectionAsync().catch(() => {}); cambiarIdioma(x.id); } }}
                style={({ pressed }) => ({ flex: 1, height: 46, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: on ? C.nova : pressed ? C.s2 : 'transparent' })}>
                {on ? <Ionicons name="checkmark" size={16} color={C.tinta} /> : null}
                <Txt f="s" size={15} color={on ? C.tinta : C.t2}>{x.nombre}</Txt>
              </Pressable>
            );
          })}
        </View>
      </Cel>
      <Txt size={12.5} lh={18} color={C.t3} style={{ marginTop: 8, paddingHorizontal: 4 }}>{t('Nova starts talking to you in this language, and follows you if you switch.')}</Txt>
    </>
  );
}

/** la ciudad del clima: se busca por nombre (sin permiso de ubicación) */
export function CiudadClima() {
  const { t, idioma } = useIdioma(), { ciudad } = useClima();
  const [abierto, setAbierto] = useState(false), [q, setQ] = useState(''), [res, setRes] = useState<Ciudad[]>([]), [buscando, setBuscando] = useState(false);
  const buscar = async () => {
    if (q.trim().length < 2) return;
    setBuscando(true);
    try { setRes(await buscarCiudad(q.trim(), idioma)); } catch { setRes([]); } finally { setBuscando(false); }
  };
  return (
    <>
      <Seccion t={t('Weather')} />
      <Cel style={{ paddingVertical: 4 }}>
        <Pressable onPress={() => setAbierto(a => !a)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 }}>
          <Ionicons name="partly-sunny-outline" size={18} color={C.t2} />
          <Txt size={15} style={{ flex: 1 }}>{ciudad.nombre}{ciudad.pais ? <Txt size={13} color={C.t3}>{`  ${ciudad.pais}`}</Txt> : null}</Txt>
          <Txt f="m" size={13} color={C.nova}>{t('Change')}</Txt>
        </Pressable>
        {abierto ? (
          <View style={{ paddingBottom: 12, gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput value={q} onChangeText={setQ} onSubmitEditing={buscar} returnKeyType="search" placeholder={t('Search your city')} placeholderTextColor={C.t3} autoCorrect={false}
                style={{ flex: 1, height: 46, borderRadius: 16, backgroundColor: C.s2, paddingHorizontal: 14, color: C.t1, fontFamily: F.r, fontSize: 16 }} />
              <Pressable onPress={buscar} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center' }}>
                {buscando ? <ActivityIndicator color={C.tinta} /> : <Ionicons name="search" size={18} color={C.tinta} />}
              </Pressable>
            </View>
            {res.map(c => (
              <Pressable key={`${c.lat},${c.lon}`} onPress={() => { elegirCiudad(c); setAbierto(false); setRes([]); setQ(''); }} style={{ paddingVertical: 10, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: C.l1 }}>
                <Txt size={15}>{c.nombre}</Txt>
                {c.pais ? <Txt size={12.5} color={C.t3}>{c.pais}</Txt> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </Cel>
    </>
  );
}

/** avisos: los de la crew (push del servidor, llegan con la app cerrada) y los recordatorios de NOVA (en el teléfono) */
export function Avisos() {
  const { t } = useIdioma(), a = useRecordatoriosAjustes(), { prefs, cambiar } = usePrefsAvisos();
  const crew: { k: CategoriaAviso; ic: keyof typeof Ionicons.glyphMap; t: string; d: string }[] = [
    { k: 'crew', ic: 'camera-outline', t: t('Crew moments'), d: t('Photos, reactions and who joins') },
    { k: 'equipo', ic: 'checkbox-outline', t: t('Tasks'), d: t('Assigned to you, finished, due tomorrow') },
    { k: 'standup', ic: 'chatbubbles-outline', t: t('Standups and blockers'), d: t('When someone is blocked, and the 11:00 summary') },
    { k: 'bitacora', ic: 'book-outline', t: t('Crew log'), d: t('New entries from the team') },
    { k: 'retos', ic: 'trophy-outline', t: t('Challenges'), d: t('New ones, halfway and completed') },
    { k: 'github', ic: 'logo-github', t: 'GitHub', d: t('Failed deploys, broken CI, PRs and reviews for you') },
    { k: 'salud', ic: 'heart-outline', t: t('Crew wellbeing'), d: t('When someone who shares their health has had several rough days') },
  ];
  const nova: { k: 'manana' | 'checkin' | 'standup' | 'habitos' | 'dormir'; ic: keyof typeof Ionicons.glyphMap; t: string; d: string }[] = [
    { k: 'manana', ic: 'sunny-outline', t: t('Morning briefing · 8:00'), d: t('Weather, calendar, tasks due and the best gap for focus.') },
    { k: 'standup', ic: 'chatbubbles-outline', t: t('Crew standup · 9:30'), d: t('Weekdays, only if you have not posted it yet.') },
    { k: 'habitos', ic: 'repeat', t: t('Habits left · 20:00'), d: t('Only if some are still pending that day.') },
    { k: 'checkin', ic: 'moon-outline', t: t('Check-in reminder · 21:00'), d: t('Only if you have not done it that day.') },
    { k: 'dormir', ic: 'bed-outline', t: t('Bedtime'), d: t('30 minutes before your usual time, from your real sleep.') },
  ];
  const fila = (k: string, ic: keyof typeof Ionicons.glyphMap, titulo: string, d: string, on: boolean, cambio: (v: boolean) => void, i: number) => (
    <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
      <Ionicons name={ic} size={18} color={C.t2} />
      <View style={{ flex: 1 }}>
        <Txt size={15}>{titulo}</Txt>
        <Txt size={12.5} lh={17} color={C.t3} style={{ marginTop: 1 }}>{d}</Txt>
      </View>
      <Interruptor on={on} label={titulo} onChange={cambio} />
    </View>
  );
  return (
    <>
      <Seccion t={t('Notifications')} />
      <Txt f="m" size={12.5} color={C.t3} style={{ marginBottom: 6, paddingHorizontal: 4 }}>{t('From your crew · arrive even with the app closed')}</Txt>
      <Cel style={{ paddingVertical: 2 }}>
        {crew.map((f, i) => fila(f.k, f.ic, f.t, f.d, prefs?.[f.k] !== false, v => cambiar(f.k, v), i))}
      </Cel>
      <Txt f="m" size={12.5} color={C.t3} style={{ marginTop: 14, marginBottom: 6, paddingHorizontal: 4 }}>{t('From Nova, for you')}</Txt>
      <Cel style={{ paddingVertical: 2 }}>
        {nova.map((f, i) => fila(f.k, f.ic, f.t, f.d, a[f.k], v => cambiarRecordatorio(f.k, v), i))}
      </Cel>
    </>
  );
}

/** Ciclo: seguimiento o supresión menstrual en Salud. Se activa a mano (la app no supone nada de nadie) y es privado */
export function CicloAjuste() {
  const { t } = useIdioma(), { config } = useCiclo();
  return (
    <>
      <Seccion t={t('Health')} />
      <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
        <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: 'rgba(236,106,168,0.14)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="water-outline" size={20} color={C.alerta} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt size={15}>{t('Cycle')}</Txt>
          <Txt size={12.5} lh={17} color={C.t3} style={{ marginTop: 2 }}>{t('Track or suppress your period, pill reminder and supplies. Private: it stays on your phone unless you choose to share a summary.')}</Txt>
        </View>
        <Interruptor on={config.activo} label={t('Cycle')} onChange={v => cambiarCiclo({ activo: v })} />
      </Cel>
    </>
  );
}

/** las funciones de misión (sensores avanzados, Marte, radiación, sesión en la Tierra) quedan guardadas para después */
export function ModoMision() {
  const { t } = useIdioma(), { mision } = useFunciones();
  return (
    <>
      <Seccion t={t('Labs')} />
      <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
        <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: 'rgba(168,152,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="planet-outline" size={20} color={C.lila} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt size={15}>{t('Mission mode')}</Txt>
          <Txt size={12.5} lh={17} color={C.t3} style={{ marginTop: 2 }}>{t('The space version for the hackathon: Sol, radiation, the chest strap and the session on Earth. Uses demo data.')}</Txt>
        </View>
        <Interruptor on={mision} label={t('Mission mode')} onChange={v => cambiarFuncion('mision', v)} />
      </Cel>
      {mision ? <EnlaceNave /> : null}
    </>
  );
}

/** enlace con NOVA PC en la nave: dirección del computador de la tripulación y asiento (T1..T4) */
function EnlaceNave() {
  const { t } = useIdioma(), nave = useNave(), e = useEnlaceEstado();
  const [dir, setDir] = useState(nave.url.replace(/^https?:\/\//, ''));
  const vivo = e.ok; // el enlace pasa a ok:false en cuanto un envío falla
  return (
    <Cel style={{ marginTop: 8, paddingVertical: 14, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: 'rgba(70,200,232,0.12)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="rocket-outline" size={20} color={C.nova} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt size={15}>{t('Ship link')}</Txt>
          <Txt size={12.5} lh={17} color={vivo ? C.ok : C.t3} style={{ marginTop: 2 }}>
            {!nave.url ? t('Your real data goes to NOVA on the ship computer, over the ship network.') : vivo ? t('Linked · {n} readings sent', { n: e.enviadas }) : e.error ? e.error : t('Connecting…')}
          </Txt>
        </View>
      </View>
      <TextInput value={dir} onChangeText={setDir} onSubmitEditing={() => cambiarNave({ url: dir })} onBlur={() => cambiarNave({ url: dir })}
        placeholder="192.168.1.20" placeholderTextColor={C.t3} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="done"
        style={{ height: 46, borderRadius: 16, backgroundColor: C.s2, paddingHorizontal: 14, color: C.t1, fontFamily: F.r, fontSize: 16 }} />
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 6 }}>
        {(['T1', 'T2', 'T3', 'T4'] as Asiento[]).map(a => {
          const on = nave.asiento === a;
          return (
            <Pressable key={a} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => { Haptics.selectionAsync(); cambiarNave({ asiento: a }); }}
              style={{ flex: 1, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.t1 : C.s2 }}>
              <Txt f="s" size={14} color={on ? C.bg : C.t2}>{a}</Txt>
            </Pressable>
          );
        })}
      </View>
      {/* tu QR para entrar a NOVA Station sin tarjeta NFC */}
      {nave.url ? (
        <Pressable onPress={() => { Haptics.selectionAsync(); router.push('/qr-nave'); }} accessibilityRole="button"
          style={({ pressed }) => ({ height: 46, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, backgroundColor: C.s2, opacity: pressed ? 0.75 : 1 })}>
          <Ionicons name="qr-code-outline" size={18} color={C.nova} />
          <Txt size={15} style={{ flex: 1 }}>{t('My station QR')}</Txt>
          <Ionicons name="chevron-forward" size={16} color={C.t3} />
        </Pressable>
      ) : null}
      {/* tus pronombres: NOVA los usa para hablar de ti y el gemelo elige la anatomía de referencia */}
      <Txt size={12.5} color={C.t3}>{t('Your pronouns on the ship')}</Txt>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 6 }}>
        {(['she/her', 'he/him', 'they/them'] as Pronombre[]).map(p => {
          const on = (nave.pronombre ?? 'they/them') === p;
          return (
            <Pressable key={p} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => { Haptics.selectionAsync(); cambiarNave({ pronombre: p }); }}
              style={{ flex: 1, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.t1 : C.s2 }}>
              <Txt f="s" size={14} color={on ? C.bg : C.t2}>{p}</Txt>
            </Pressable>
          );
        })}
      </View>
    </Cel>
  );
}

/** tu cuenta: cambiar la clave y salir */
export function Cuenta_() {
  const { t, locale } = useIdioma(), { usuario } = useSesion();
  const [abierto, setAbierto] = useState(false), [actual, setActual] = useState(''), [nueva, setNueva] = useState('');
  const [estado, setEstado] = useState<{ ok?: string; error?: string; cargando?: boolean }>({});
  const guardar = async () => {
    setEstado({ cargando: true });
    try { await cambiarClave(actual, nueva); setEstado({ ok: t('Password changed') }); setActual(''); setNueva(''); setAbierto(false); }
    catch (e) { setEstado({ error: t((e as Error).message) }); }
  };
  const campo = { height: 48, borderRadius: 16, backgroundColor: C.s2, paddingHorizontal: 14, color: C.t1, fontFamily: F.r, fontSize: 15 } as const;
  return (
    <>
      <Seccion t={t('Account')} />
      <Cel style={{ paddingVertical: 4 }}>
        <Pressable onPress={() => setAbierto(a => !a)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 }}>
          <Ionicons name="key-outline" size={18} color={C.t2} />
          <Txt size={15} style={{ flex: 1 }}>{t('Change password')}</Txt>
          <Ionicons name={abierto ? 'chevron-up' : 'chevron-down'} size={16} color={C.t3} />
        </Pressable>
        {abierto ? (
          <View style={{ gap: 8, paddingBottom: 14 }}>
            <TextInput value={actual} onChangeText={setActual} placeholder={t('Current password')} placeholderTextColor={C.t3} secureTextEntry style={campo} />
            <TextInput value={nueva} onChangeText={setNueva} placeholder={t('New password (8+ characters)')} placeholderTextColor={C.t3} secureTextEntry style={campo} />
            <Pressable onPress={guardar} disabled={!actual || nueva.length < 8} style={{ height: 46, borderRadius: 23, backgroundColor: C.nova, alignItems: 'center', justifyContent: 'center', opacity: actual && nueva.length >= 8 ? 1 : 0.4 }}>
              {estado.cargando ? <ActivityIndicator color={C.tinta} /> : <Txt f="s" size={15} color={C.tinta}>{t('Save')}</Txt>}
            </Pressable>
          </View>
        ) : null}
        {estado.error || estado.ok ? <Txt size={13.5} color={estado.error ? C.alerta : C.ok} style={{ paddingBottom: 10 }}>{estado.error ?? estado.ok}</Txt> : null}
        <Pressable onPress={() => router.push('/memoria')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: 1, borderTopColor: C.l1 }}>
          <Ionicons name="bookmark-outline" size={18} color={C.t2} />
          <Txt size={15} style={{ flex: 1 }}>{t('What Nova remembers')}</Txt>
          <Ionicons name="chevron-forward" size={16} color={C.t3} />
        </Pressable>
        <Pressable onPress={() => router.push('/permisos')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: 1, borderTopColor: C.l1 }}>
          <Ionicons name="shield-checkmark-outline" size={18} color={C.t2} />
          <Txt size={15} style={{ flex: 1 }}>{t('Permissions')}</Txt>
          <Ionicons name="chevron-forward" size={16} color={C.t3} />
        </Pressable>
        <Pressable onPress={verBienvenidaOtraVez} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: 1, borderTopColor: C.l1 }}>
          <Ionicons name="sparkles-outline" size={18} color={C.t2} />
          <Txt size={15} style={{ flex: 1 }}>{t('See the welcome again')}</Txt>
          <Ionicons name="chevron-forward" size={16} color={C.t3} />
        </Pressable>
        <Pressable onPress={() => { agendarMomentos(null); salir(); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: 1, borderTopColor: C.l1 }}>
          <Ionicons name="log-out-outline" size={18} color={C.alerta} />
          <Txt size={15} color={C.alerta} style={{ flex: 1 }}>{t('Sign out')}</Txt>
          <Txt size={12.5} color={C.t3}>{usuario?.email}</Txt>
        </Pressable>
      </Cel>
      <Txt f="monoR" size={11.5} color={C.t3} style={{ textAlign: 'center', marginTop: 14 }}>NOVA {versionActual(locale)}</Txt>
    </>
  );
}
