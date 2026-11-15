/* La ficha de una integración, con sus ajustes ahí mismo:
   · Spotify: conectar tu cuenta; lo que suena (con play/pausa/anterior/siguiente), tus playlists (elegir para el foco o
     reproducir) y las playlists de foco sin cuenta.
   · YouTube Music: pegar el enlace de tu playlist para el foco.
   · GitHub: conectar; tus PRs, revisiones que te piden, issues asignados (a tareas con un toque) y lo de hoy.
   · Calendarios: cuáles lee NOVA.
   Al volver del navegador (nova://integracion?k=…&ok=1) se refresca sola. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { completarExterna, crearExterna, nuevaTarea, useExternas, useStrava, type Externa } from '../cuenta/datos';
import { conectar, controlSpotify, desconectar, NOMBRE_PROV, refrescarIntegraciones, useGithub, useIntegraciones, usePlaylists, useSpotifyAhora, type ItemGh, type Proveedor } from '../cuenta/integraciones';
import { elegirDeSpotify, elegirMusica, guardarPropia, PLAYLISTS, useMusica } from '../engine/musica';
import { useIdioma } from '../i18n';
import { leerCalendario, listarCalendarios, type Calendario } from '../sensores/agenda';
import { BarrasSemana } from '../ui/GithubHoy';
import { Interruptor } from '../ui/Interruptor';
import { volver } from '../ui/volver';
import { C, Cel, F, Seccion, Txt } from '../ui/tema';

const INFO: Record<string, { t: string; icono: keyof typeof Ionicons.glyphMap; color: string; d: string }> = {
  spotify: { t: 'Spotify', icono: 'musical-notes', color: '#1DB954', d: 'See what is playing, control it and pick your focus playlist from your own.' },
  youtube: { t: 'YouTube Music', icono: 'logo-youtube', color: '#ff4e45', d: 'Your YouTube Music playlist opens when a focus session starts.' },
  github: { t: 'GitHub', icono: 'logo-github', color: '#f2f5f8', d: 'Your pull requests, reviews and assigned issues, as tasks and context for Nova.' },
  calendario: { t: 'Calendars', icono: 'calendar', color: C.sig, d: 'Choose which calendars of this phone Nova reads.' },
  strava: { t: 'Strava', icono: 'bicycle', color: '#fc5200', d: 'Your runs, rides and workouts count as exercise for Nova, your recovery and crew challenges.' },
  todoist: { t: 'Todoist', icono: 'checkbox', color: '#e44332', d: 'Your Todoist tasks for today and the week, to complete or add from Nova.' },
  google: { t: 'Google Tasks', icono: 'checkmark-done', color: '#4f8df5', d: 'Your Google Tasks lists in your day; Nova can add to them by voice.' },
  linear: { t: 'Linear', icono: 'git-network', color: '#8e8cf8', d: 'Issues assigned to you, to close or create without leaving Nova.' },
  notion: { t: 'Notion', icono: 'document-text', color: '#f2f5f8', d: 'So your crew can save the weekly summary and meeting notes in your workspace.' },
};

export default function Integracion() {
  const { k = 'spotify', ok } = useLocalSearchParams<{ k: string; ok?: string }>();
  const ins = useSafeAreaInsets(), { t } = useIdioma(), info = INFO[k] ?? INFO.spotify;
  useEffect(() => { if (ok) refrescarIntegraciones(); }, [ok]);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={() => volver('/')} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: ins.bottom + 30 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: `${info.color}1f`, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={info.icono} size={28} color={info.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt f="s" size={28} ls={-1} lh={32}>{t(info.t)}</Txt>
            <Txt size={14} lh={19} color={C.t2}>{t(info.d)}</Txt>
          </View>
        </View>
        {k === 'spotify' ? <Spotify /> : k === 'youtube' ? <YouTube /> : k === 'github' ? <Github /> : k === 'calendario' ? <Calendarios />
          : k === 'strava' ? <Strava /> : k === 'todoist' || k === 'google' || k === 'linear' ? <TareasDe f={k} /> : k === 'notion' ? <NotionFicha /> : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

/** conectar / cuenta conectada / desconectar (o cómo activarla si el servidor aún no tiene las credenciales) */
function Cuenta({ p, color }: { p: Proveedor; color: string }) {
  const { t } = useIdioma(), { datos, cargando } = useIntegraciones();
  const [error, setError] = useState<string | null>(null), [abriendo, setAbriendo] = useState(false);
  const e = datos?.[p];
  if (cargando && !datos) return <ActivityIndicator color={C.nova} style={{ marginTop: 20 }} />;
  if (e && !e.disponible) {
    return (
      <Cel style={{ marginTop: 16, gap: 6, borderColor: `${C.aviso}55` }}>
        <Txt f="s" size={14.5}>{t('Almost ready')}</Txt>
        <Txt size={13.5} lh={19} color={C.t2}>{t('The server still needs the developer app credentials. On the Mac run api/integraciones.sh and then api/desplegar.sh.')}</Txt>
      </Cel>
    );
  }
  if (e?.conectado) {
    return (
      <Cel style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.ok }} />
        <Txt size={14.5} style={{ flex: 1 }} numberOfLines={1}>{t('Connected as {x}', { x: e.cuenta ?? '' })}</Txt>
        <Pressable onPress={() => desconectar(p).catch(() => {})} hitSlop={8}><Txt f="m" size={13} color={C.alerta}>{t('Disconnect')}</Txt></Pressable>
      </Cel>
    );
  }
  return (
    <View style={{ marginTop: 16, gap: 8 }}>
      <Pressable onPress={async () => { setError(null); setAbriendo(true); try { await conectar(p); } catch (x) { setError(t((x as Error).message)); } finally { setAbriendo(false); } }}
        style={({ pressed }) => ({ height: 52, borderRadius: 26, backgroundColor: color, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: pressed ? 0.85 : 1 })}>
        {abriendo ? <ActivityIndicator color={C.tinta} /> : <Txt f="s" size={16} color={C.tinta}>{t('Connect {x}', { x: NOMBRE_PROV[p] })}</Txt>}
      </Pressable>
      <Txt size={12.5} lh={17} color={C.t3} style={{ textAlign: 'center' }}>{t('It opens the browser to sign in; then it comes back to Nova on its own.')}</Txt>
      {error ? <Txt size={13} color={C.alerta}>{error}</Txt> : null}
    </View>
  );
}

function Spotify() {
  const { t } = useIdioma(), { datos } = useIntegraciones(), conectado = !!datos?.spotify?.conectado;
  const ahora = useSpotifyAhora(conectado), listas = usePlaylists(conectado), m = useMusica();
  const [error, setError] = useState<string | null>(null);
  // lo que suena se refresca cada 8 s mientras la ficha está abierta
  useEffect(() => { if (!conectado) return; const id = setInterval(() => ahora.recargar(), 8000); return () => clearInterval(id); }, [conectado]); // eslint-disable-line react-hooks/exhaustive-deps
  const control = (a: 'play' | 'pause' | 'next' | 'previous', playlist?: string) => { Haptics.selectionAsync().catch(() => {}); setError(null); controlSpotify(a, playlist).catch(e => setError(t((e as Error).message))); };
  const s = ahora.datos;
  return (
    <>
      <Cuenta p="spotify" color="#1DB954" />
      {conectado ? (
        <>
          <Seccion t={t('Now playing')} />
          <Cel style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {s?.imagen ? <Image source={{ uri: s.imagen }} style={{ width: 64, height: 64, borderRadius: 10 }} /> : <View style={{ width: 64, height: 64, borderRadius: 10, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="musical-notes-outline" size={22} color={C.t3} /></View>}
            <View style={{ flex: 1 }}>
              <Txt f="s" size={15} numberOfLines={1}>{s?.titulo ?? t('Nothing playing')}</Txt>
              <Txt size={13} color={C.t2} numberOfLines={1}>{s?.artista ?? (s?.dispositivo ? '' : t('Open Spotify on any device'))}</Txt>
              {s?.duracion ? <View style={{ height: 3, borderRadius: 2, backgroundColor: C.l2, marginTop: 8 }}><View style={{ width: `${Math.min(100, ((s.avance ?? 0) / s.duracion) * 100)}%`, height: 3, borderRadius: 2, backgroundColor: '#1DB954' }} /></View> : null}
              {s?.dispositivo ? <Txt f="monoR" size={11} color={C.t3} style={{ marginTop: 4 }}>{s.dispositivo}</Txt> : null}
            </View>
          </Cel>
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 18, marginTop: 12 }}>
            <Pressable onPress={() => control('previous')} hitSlop={8}><Ionicons name="play-skip-back" size={24} color={C.t1} /></Pressable>
            <Pressable onPress={() => control(s?.sonando ? 'pause' : 'play')} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#1DB954', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={s?.sonando ? 'pause' : 'play'} size={24} color={C.tinta} style={{ marginLeft: s?.sonando ? 0 : 3 }} />
            </Pressable>
            <Pressable onPress={() => control('next')} hitSlop={8}><Ionicons name="play-skip-forward" size={24} color={C.t1} /></Pressable>
          </View>
          {error ? <Txt size={13} color={C.alerta} style={{ textAlign: 'center', marginTop: 8 }}>{error}</Txt> : null}

          <Seccion t={t('Your playlists')} nota={t('tap: focus · ▶: play')} />
          <Cel style={{ paddingVertical: 4 }}>
            {!listas.datos ? <ActivityIndicator color={C.nova} style={{ marginVertical: 14 }} /> : listas.datos.map((p, i) => {
              const elegida = m.elegida === 'propia' && m.propia === p.id;
              return (
                <Pressable key={p.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); elegirDeSpotify(p.id, p.nombre); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
                  {p.imagen ? <Image source={{ uri: p.imagen }} style={{ width: 42, height: 42, borderRadius: 6 }} /> : <View style={{ width: 42, height: 42, borderRadius: 6, backgroundColor: C.s2 }} />}
                  <View style={{ flex: 1 }}>
                    <Txt size={14.5} numberOfLines={1}>{p.nombre}</Txt>
                    <Txt size={12} color={elegida ? '#1DB954' : C.t3}>{elegida ? t('Your focus playlist') : t('{n} songs', { n: p.canciones })}</Txt>
                  </View>
                  <Pressable onPress={() => control('play', p.id)} hitSlop={8} accessibilityLabel={t('Play')} style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="play" size={14} color={C.t1} style={{ marginLeft: 2 }} />
                  </Pressable>
                </Pressable>
              );
            })}
          </Cel>
          <Txt size={12} lh={17} color={C.t3} style={{ marginTop: 8, paddingHorizontal: 4 }}>{t('Controlling playback needs Spotify Premium and Spotify open on some device.')}</Txt>
        </>
      ) : null}

      <Seccion t={t('Focus music without an account')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {PLAYLISTS.map(p => {
          const on = m.elegida === p.id;
          return (
            <Pressable key={p.id} onPress={() => elegirMusica(p.id)} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', borderWidth: 1, borderColor: on ? '#1DB954' : C.l2, backgroundColor: on ? 'rgba(29,185,84,0.12)' : 'transparent' }}>
              <Txt f="m" size={13} color={on ? '#1DB954' : C.t2}>{t(p.nombre)}</Txt>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

function YouTube() {
  const { t } = useIdioma(), m = useMusica();
  const [enlace, setEnlace] = useState(''), [malo, setMalo] = useState(false);
  const activa = m.elegida === 'yt' && !!m.yt;
  return (
    <>
      <Cel style={{ marginTop: 16, gap: 10 }}>
        <Txt f="s" size={14.5}>{activa ? t('Your focus playlist is set') : t('Paste your playlist link')}</Txt>
        <Txt size={13} lh={18} color={C.t2}>{t('In YouTube Music: open the playlist → Share → Copy link, and paste it here.')}</Txt>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={enlace} onChangeText={x => { setEnlace(x); setMalo(false); }} placeholder="music.youtube.com/playlist?list=…" placeholderTextColor={C.t3} autoCapitalize="none" autoCorrect={false}
            style={{ flex: 1, height: 44, borderRadius: 14, backgroundColor: C.s2, paddingHorizontal: 12, color: C.t1, fontFamily: F.r, fontSize: 14 }} />
          <Pressable onPress={() => { if (guardarPropia(enlace)) { setEnlace(''); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); } else setMalo(true); }}
            style={{ height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: '#ff4e45', justifyContent: 'center' }}>
            <Txt f="s" size={14} color="#fff">{t('Save')}</Txt>
          </Pressable>
        </View>
        {malo ? <Txt size={13} color={C.alerta}>{t('That link does not look like a playlist.')}</Txt> : null}
        {activa ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => Linking.openURL(`https://music.youtube.com/playlist?list=${m.yt}`).catch(() => {})} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', borderWidth: 1, borderColor: C.l2 }}>
              <Txt f="m" size={13} color={C.t1}>{t('Open it')}</Txt>
            </Pressable>
            <Pressable onPress={() => elegirMusica('nada')} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', borderWidth: 1, borderColor: C.l2 }}>
              <Txt f="m" size={13} color={C.t2}>{t('Remove')}</Txt>
            </Pressable>
          </View>
        ) : null}
      </Cel>
      <Txt size={12} lh={17} color={C.t3} style={{ marginTop: 10, paddingHorizontal: 4 }}>{t('YouTube Music has no public API to control playback, so Nova opens your playlist in its app when focus starts.')}</Txt>
    </>
  );
}

function Github() {
  const { t } = useIdioma(), { datos } = useIntegraciones(), conectado = !!datos?.github?.conectado;
  const { datos: g, cargando, error } = useGithub(conectado);
  const [agregadas, setAgregadas] = useState<string[]>([]);
  const aTarea = (x: ItemGh) => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); nuevaTarea({ titulo: `${x.repo}#${x.numero} ${x.titulo}`.slice(0, 140), crew: null, vence: null }).catch(() => {}); setAgregadas(a => [...a, x.url]); };
  const lista = (titulo: string, items: ItemGh[]) => (
    <>
      <Seccion t={titulo} nota={String(items.length)} />
      {!items.length ? <Txt size={13.5} color={C.t3} style={{ paddingHorizontal: 4 }}>{t('Nothing here.')}</Txt> : (
        <Cel style={{ paddingVertical: 4 }}>
          {items.map((x, i) => (
            <View key={x.url} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
              <Pressable onPress={() => Linking.openURL(x.url).catch(() => {})} style={{ flex: 1 }}>
                <Txt size={14.5} numberOfLines={2}>{x.titulo}</Txt>
                <Txt f="monoR" size={11.5} color={C.t3}>{x.repo}#{x.numero}</Txt>
              </Pressable>
              <Pressable onPress={() => aTarea(x)} disabled={agregadas.includes(x.url)} accessibilityLabel={t('Add as a task')} style={{ height: 30, paddingHorizontal: 10, borderRadius: 15, borderWidth: 1, borderColor: agregadas.includes(x.url) ? C.ok : C.l2, justifyContent: 'center' }}>
                <Txt f="m" size={12} color={agregadas.includes(x.url) ? C.ok : C.t2}>{agregadas.includes(x.url) ? t('Added') : t('+ Task')}</Txt>
              </Pressable>
            </View>
          ))}
        </Cel>
      )}
    </>
  );
  return (
    <>
      <Cuenta p="github" color="#f2f5f8" />
      {conectado ? (
        cargando && !g ? <ActivityIndicator color={C.nova} style={{ marginTop: 20 }} /> : error ? <Txt size={13.5} color={C.alerta} style={{ marginTop: 14 }}>{t(error)}</Txt> : g ? (
          <>
            <Seccion t={t('Today')} />
            <Cel style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Txt f="s" size={28} color={C.ok}>{g.hoy.contribuciones ?? 0}</Txt><Txt size={12} color={C.t3}>{t('contributions')}</Txt></View>
                <View style={{ flex: 1 }}><Txt f="s" size={28}>{g.hoy.commits}</Txt><Txt size={12} color={C.t3}>{t('commits')}</Txt></View>
              </View>
              <BarrasSemana v={g.hoy.semana ?? []} />
              <Txt size={12.5} color={C.t2} numberOfLines={2}>{g.hoy.repos.join(' · ') || t('No activity yet today')}</Txt>
            </Cel>
            {lista(t('Reviews requested'), g.revisar)}
            {lista(t('Your open pull requests'), g.prs)}
            {lista(t('Issues assigned to you'), g.issues)}
            {g.errores?.length ? (
              <Cel style={{ marginTop: 14, gap: 4, borderColor: `${C.aviso}55` }}>
                <Txt f="m" size={13} color={C.aviso}>{t('Some parts could not load')}</Txt>
                {g.errores.map(e => <Txt key={e} f="monoR" size={11.5} color={C.t3}>{e}</Txt>)}
              </Cel>
            ) : null}
          </>
        ) : null
      ) : null}
    </>
  );
}

function Calendarios() {
  const { t } = useIdioma();
  const [cals, setCals] = useState<Calendario[] | null>(null);
  useEffect(() => { listarCalendarios().then(setCals, () => setCals([])); }, []);
  if (!cals) return <ActivityIndicator color={C.nova} style={{ marginTop: 20 }} />;
  if (!cals.length) return <Txt size={14} lh={20} color={C.t2} style={{ marginTop: 16 }}>{t('No calendars yet: allow Calendar for Nova in Integrations → Your data.')}</Txt>;
  return (
    <Cel style={{ marginTop: 16, paddingVertical: 4 }}>
      {cals.map((c, i) => (
        <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.color ?? C.sig }} />
          <View style={{ flex: 1 }}>
            <Txt size={14.5} numberOfLines={1}>{c.titulo}</Txt>
            {c.cuenta ? <Txt size={12} color={C.t3} numberOfLines={1}>{c.cuenta}</Txt> : null}
          </View>
          <Interruptor on={c.leido} label={c.titulo} onChange={v => { setCals(x => x?.map(y => (y.id === c.id ? { ...y, leido: v } : y)) ?? null); leerCalendario(c.id, v); }} />
        </View>
      ))}
    </Cel>
  );
}


function Strava() {
  const { t, locale } = useIdioma(), { datos } = useIntegraciones(), conectado = !!datos?.strava?.conectado;
  const { datos: s, cargando, error } = useStrava(conectado);
  return (
    <>
      <Cuenta p="strava" color="#fc5200" />
      {conectado ? (cargando && !s ? <ActivityIndicator color={C.nova} style={{ marginTop: 20 }} /> : error ? <Txt size={13.5} color={C.alerta} style={{ marginTop: 14 }}>{t(error)}</Txt> : s ? (
        <>
          <Seccion t={t('Last 7 days')} />
          <Cel style={{ flexDirection: 'row' }}>
            {[[String(s.semana.n), t('activities')], [`${Math.round(s.semana.min / 6) / 10} h`, t('moving')], [`${s.semana.km}`, 'km']].map(([v, k]) => (
              <View key={k} style={{ flex: 1 }}><Txt f="l" size={30} ls={-1.2} color="#fc5200">{v}</Txt><Txt size={12} color={C.t3}>{k}</Txt></View>
            ))}
          </Cel>
          <Seccion t={t('Activities')} nota={t('14 days')} />
          <Cel style={{ paddingVertical: 4 }}>
            {s.actividades.length ? s.actividades.slice(0, 14).map((a, i) => (
              <Pressable key={a.id} onPress={() => Linking.openURL(a.url).catch(() => {})} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
                <Ionicons name={/Run|Walk|Hike/.test(a.tipo) ? 'walk-outline' : /Ride|Bike/.test(a.tipo) ? 'bicycle-outline' : /Swim/.test(a.tipo) ? 'water-outline' : 'barbell-outline'} size={18} color={C.t2} />
                <View style={{ flex: 1 }}>
                  <Txt size={14.5} numberOfLines={1}>{a.nombre}</Txt>
                  <Txt f="monoR" size={11.5} color={C.t3}>{new Date(a.fecha).toLocaleDateString(locale, { weekday: 'short', day: 'numeric' })} · {a.min} min{a.km ? ` · ${a.km} km` : ''}{a.fc ? ` · ${a.fc} bpm` : ''}</Txt>
                </View>
              </Pressable>
            )) : <Txt size={13.5} color={C.t3} style={{ paddingVertical: 12 }}>{t('No activities in the last 14 days.')}</Txt>}
          </Cel>
        </>
      ) : null) : null}
    </>
  );
}

/** Todoist, Google Tasks o Linear: tus tareas de ahí, para completarlas o agregar una nueva */
function TareasDe({ f }: { f: Externa['fuente'] }) {
  const { t, locale } = useIdioma(), { datos } = useIntegraciones(), conectado = !!datos?.[f]?.conectado;
  const { datos: x, cargando } = useExternas(conectado);
  const [nueva, setNueva] = useState(''), [error, setError] = useState<string | null>(null);
  const mias = (x?.tareas ?? []).filter(y => y.fuente === f), fallo = x?.errores.find(e => e.startsWith(f));
  const color = INFO[f].color;
  return (
    <>
      <Cuenta p={f} color={color} />
      {conectado ? (
        <>
          <Seccion t={t('Your tasks')} nota={mias.length ? String(mias.length) : undefined} />
          <Cel style={{ paddingVertical: 4 }}>
            {cargando && !x ? <ActivityIndicator color={C.nova} style={{ marginVertical: 14 }} /> : null}
            {mias.map((y, i) => (
              <View key={y.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
                <Pressable hitSlop={10} accessibilityRole="checkbox" accessibilityLabel={y.titulo} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); completarExterna(y).catch(e => setError(t((e as Error).message))); }}
                  style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: C.t3 }} />
                <Pressable style={{ flex: 1 }} onPress={() => Linking.openURL(y.url).catch(() => {})}>
                  <Txt size={14.5} numberOfLines={2}>{y.titulo}</Txt>
                  {y.vence || y.lista || y.estado ? <Txt size={12} color={C.t3}>{[y.vence && new Date(`${y.vence}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }), y.lista, y.estado].filter(Boolean).join(' · ')}</Txt> : null}
                </Pressable>
              </View>
            ))}
            {x && !mias.length && !fallo ? <Txt size={13.5} color={C.t3} style={{ paddingVertical: 12 }}>{t('Nothing pending. Nice.')}</Txt> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: mias.length ? 1 : 0, borderTopColor: C.l1 }}>
              <Ionicons name="add" size={20} color={C.t3} />
              <TextInput value={nueva} onChangeText={setNueva} placeholder={t('Add to {x}', { x: INFO[f].t })} placeholderTextColor={C.t3} returnKeyType="done"
                onSubmitEditing={() => { const v = nueva.trim(); if (!v) return; setNueva(''); crearExterna(f, v).catch(e => setError(t((e as Error).message))); }}
                style={{ flex: 1, height: 46, color: C.t1, fontFamily: F.r, fontSize: 14.5 }} />
            </View>
          </Cel>
          {fallo ? <Txt size={12.5} color={C.aviso} style={{ marginTop: 8 }}>{fallo}</Txt> : null}
          {error ? <Txt size={13} color={C.alerta} style={{ marginTop: 8 }}>{error}</Txt> : null}
          <Txt size={12} lh={17} color={C.t3} style={{ marginTop: 10, paddingHorizontal: 4 }}>{t('They also show up in Today and Nova knows them: «what do I have in {x}?», «mark it done».', { x: INFO[f].t })}</Txt>
        </>
      ) : null}
    </>
  );
}

function NotionFicha() {
  const { t } = useIdioma(), { datos } = useIntegraciones(), conectado = !!datos?.notion?.conectado;
  return (
    <>
      <Cuenta p="notion" color="#f2f5f8" />
      <Cel style={{ marginTop: 14, gap: 8 }}>
        <Txt size={14} lh={20} color={C.t2}>{t('When connecting, choose the pages Nova can use. Then, in Crew connections, a crew admin picks the page where Nova writes.')}</Txt>
        {conectado ? (
          <Pressable onPress={() => router.push('/crew-conexiones')} style={{ alignSelf: 'flex-start', height: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1, borderColor: C.l2, justifyContent: 'center' }}>
            <Txt f="m" size={13.5}>{t('Crew connections')} →</Txt>
          </Pressable>
        ) : null}
      </Cel>
    </>
  );
}
