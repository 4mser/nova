/* Conexiones de la crew (las cambia un admin):
   · Slack y Discord: un webhook entrante por canal. NOVA publica ahí lo que el equipo elija (standups, bloqueos,
     tareas cerradas, GitHub, actas, reconocimientos, decisiones y el resumen del viernes).
   · Notion: una página donde NOVA deja el resumen semanal y cada acta de reunión como página nueva. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, TextInput, View } from 'react-native';
import { buscarPaginasNotion, cambiarAjustes, useAjustesCrew } from '../cuenta/datos';
import { useIntegraciones } from '../cuenta/integraciones';
import { useCrew } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { Chip, Hoja } from '../ui/Hoja';
import { C, Cel, F, Seccion, Txt } from '../ui/tema';

const TIPOS: { k: string; t: string }[] = [
  { k: 'standup', t: 'Standups' }, { k: 'bloqueo', t: 'Blockers' }, { k: 'hecha', t: 'Tasks done' }, { k: 'tarea', t: 'New tasks' },
  { k: 'github', t: 'GitHub' }, { k: 'acta', t: 'Meeting notes' }, { k: 'decision', t: 'Decisions' }, { k: 'kudos', t: 'Kudos' }, { k: 'resumen', t: 'Weekly summary' },
];

export default function ConexionesCrew() {
  const { t } = useIdioma(), crew = useCrew(), { datos: a, cargando } = useAjustesCrew(crew?.id ?? null);
  const [error, setError] = useState<string | null>(null), [ok, setOk] = useState<string | null>(null);
  if (!crew) return null;
  const admin = !!a?.soyAdmin;
  const guardar = async (c: Parameters<typeof cambiarAjustes>[1], aviso?: string) => {
    setError(null); setOk(null);
    try { await cambiarAjustes(crew.id, c); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); if (aviso) setOk(aviso); }
    catch (e) { setError(t((e as Error).message)); }
  };
  return (
    <Hoja titulo={t('Crew connections')} sub={t('Where Nova also posts what happens in {crew}.', { crew: crew.nombre })} volverA="/crew">
      {cargando && !a ? <ActivityIndicator color={C.nova} style={{ marginTop: 24 }} /> : null}
      {a && !admin ? <Txt size={13.5} lh={19} color={C.aviso} style={{ marginTop: 14 }}>{t('Only crew admins can change these.')}</Txt> : null}
      {a ? (
        <>
          <Webhook nombre="Slack" icono="logo-slack" color="#e2b4f5" actual={a.slack} admin={admin} ayuda="https://api.slack.com/messaging/webhooks"
            ph="https://hooks.slack.com/services/…" guardar={url => guardar({ slack: url, probar: !!url }, url ? t('Connected. Nova sent a hello to the channel.') : undefined)} />
          <Webhook nombre="Discord" icono="logo-discord" color="#8e9bff" actual={a.discord} admin={admin} ayuda="https://support.discord.com/hc/articles/228383668"
            ph="https://discord.com/api/webhooks/…" guardar={url => guardar({ discord: url, probar: !!url }, url ? t('Connected. Nova sent a hello to the channel.') : undefined)} />
          {a.slack || a.discord ? (
            <>
              <Seccion t={t('What gets posted')} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {TIPOS.map(x => {
                  const on = a.espejo.includes(x.k);
                  return <Chip key={x.k} t={t(x.t)} on={on} onPress={() => admin && guardar({ espejo: on ? a.espejo.filter(k => k !== x.k) : [...a.espejo, x.k] })} />;
                })}
              </View>
            </>
          ) : null}
          <Notion pagina={a.notion} admin={admin} guardar={n => guardar({ notion: n }, n ? t('Nova will save the weekly summary and the meeting notes there.') : undefined)} />
        </>
      ) : null}
      {ok ? <Txt size={13.5} color={C.ok} style={{ marginTop: 14 }}>{ok}</Txt> : null}
      {error ? <Txt size={13.5} color={C.alerta} style={{ marginTop: 14 }}>{error}</Txt> : null}
    </Hoja>
  );
}

function Webhook({ nombre, icono, color, actual, admin, ayuda, ph, guardar }: { nombre: string; icono: keyof typeof Ionicons.glyphMap; color: string; actual: string | null; admin: boolean; ayuda: string; ph: string; guardar: (url: string | null) => Promise<void> }) {
  const { t } = useIdioma(), [url, setUrl] = useState(''), [editando, setEditando] = useState(false), [enviando, setEnviando] = useState(false);
  return (
    <>
      <Seccion t={nombre} nota={actual ? t('Connected') : undefined} />
      <Cel style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: `${color}22`, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icono} size={20} color={color} /></View>
          <View style={{ flex: 1 }}>
            <Txt size={14.5}>{actual ? t('Posting to your channel') : t('Not connected')}</Txt>
            {actual ? <Txt f="monoR" size={11.5} color={C.t3}>{actual}</Txt> : null}
            <Pressable onPress={() => Linking.openURL(ayuda).catch(() => {})}><Txt size={12.5} color={C.nova}>{t('How to create an incoming webhook')} ↗</Txt></Pressable>
          </View>
          {admin && actual && !editando ? <Pressable onPress={() => guardar(null)} hitSlop={8}><Txt f="m" size={13} color={C.alerta}>{t('Remove')}</Txt></Pressable> : null}
        </View>
        {admin && (!actual || editando) ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={url} onChangeText={setUrl} placeholder={ph} placeholderTextColor={C.t3} autoCapitalize="none" autoCorrect={false} keyboardType="url"
              style={{ flex: 1, height: 42, borderRadius: 12, backgroundColor: C.s2, paddingHorizontal: 12, color: C.t1, fontFamily: F.r, fontSize: 13.5 }} />
            <Pressable disabled={!url.trim() || enviando} onPress={async () => { setEnviando(true); await guardar(url.trim()); setEnviando(false); setUrl(''); setEditando(false); }}
              style={{ height: 42, paddingHorizontal: 14, borderRadius: 21, backgroundColor: C.nova, justifyContent: 'center', opacity: url.trim() ? 1 : 0.4 }}>
              {enviando ? <ActivityIndicator color={C.tinta} /> : <Txt f="s" size={14} color={C.tinta}>{t('Connect')}</Txt>}
            </Pressable>
          </View>
        ) : admin && actual ? <Pressable onPress={() => setEditando(true)}><Txt f="m" size={13} color={C.t2}>{t('Change channel')}</Txt></Pressable> : null}
      </Cel>
    </>
  );
}

function Notion({ pagina, admin, guardar }: { pagina: { pagina: string; titulo: string; de: string } | null; admin: boolean; guardar: (n: { pagina: string; titulo: string } | null) => Promise<void> }) {
  const { t } = useIdioma(), { datos: cuentas } = useIntegraciones(), conectado = !!cuentas?.notion?.conectado;
  const [q, setQ] = useState(''), [res, setRes] = useState<{ id: string; titulo: string; icono: string | null }[] | null>(null), [buscando, setBuscando] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!conectado || !admin || pagina) return;
    const id = setTimeout(() => { setBuscando(true); buscarPaginasNotion(q).then(setRes, e => setError(t((e as Error).message))).finally(() => setBuscando(false)); }, 350);
    return () => clearTimeout(id);
  }, [q, conectado, admin, pagina]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Seccion t="Notion" nota={pagina ? t('Connected') : undefined} />
      <Cel style={{ gap: 10 }}>
        {pagina ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="document-text-outline" size={18} color={C.t1} />
            <Txt size={14.5} style={{ flex: 1 }} numberOfLines={1}>{pagina.titulo}</Txt>
            {admin ? <Pressable onPress={() => guardar(null)} hitSlop={8}><Txt f="m" size={13} color={C.alerta}>{t('Remove')}</Txt></Pressable> : null}
          </View>
        ) : !conectado ? (
          <>
            <Txt size={14} lh={20} color={C.t2}>{t('Connect your Notion account first, then choose the page where Nova writes.')}</Txt>
            <Pressable onPress={() => router.push({ pathname: '/integracion', params: { k: 'notion' } })} style={{ alignSelf: 'flex-start', height: 38, paddingHorizontal: 14, borderRadius: 19, backgroundColor: C.t1, justifyContent: 'center' }}>
              <Txt f="s" size={14} color={C.tinta}>{t('Connect Notion')}</Txt>
            </Pressable>
          </>
        ) : admin ? (
          <>
            <Txt size={13.5} lh={19} color={C.t2}>{t('Choose a page. Nova adds the weekly summary and each meeting as a new page inside it.')}</Txt>
            <TextInput value={q} onChangeText={setQ} placeholder={t('Search your Notion pages')} placeholderTextColor={C.t3}
              style={{ height: 42, borderRadius: 12, backgroundColor: C.s2, paddingHorizontal: 12, color: C.t1, fontFamily: F.r, fontSize: 14.5 }} />
            {buscando ? <ActivityIndicator color={C.nova} /> : null}
            {res?.map(p => (
              <Pressable key={p.id} onPress={() => guardar({ pagina: p.id, titulo: p.titulo })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                <Txt size={16}>{p.icono ?? '📄'}</Txt><Txt size={14.5} style={{ flex: 1 }} numberOfLines={1}>{p.titulo}</Txt><Ionicons name="add-circle-outline" size={18} color={C.nova} />
              </Pressable>
            ))}
            {res && !res.length && !buscando ? <Txt size={13} color={C.t3}>{t('No pages. In Notion, share a page with the Nova integration.')}</Txt> : null}
            {error ? <Txt size={13} color={C.alerta}>{error}</Txt> : null}
          </>
        ) : <Txt size={14} color={C.t3}>{t('Not connected')}</Txt>}
      </Cel>
    </>
  );
}
