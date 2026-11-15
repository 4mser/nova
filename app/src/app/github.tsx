/* GitHub de la crew: los repos del equipo y lo que pasa en ellos. La API los revisa cada 2 minutos y avisa al teléfono
   (y a Slack/Discord si la crew los conectó): deploys que fallan o salen a producción, workflows que se rompen o se
   arreglan, PRs nuevos, revisiones que te piden, aprobados, cambios pedidos e integrados. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, TextInput, View } from 'react-native';
import { agregarRepo, quitarRepo, useGithubCrew, useMisRepos } from '../cuenta/datos';
import { useIntegraciones } from '../cuenta/integraciones';
import { miembroDe, useCrew, useSesion } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { useAhora } from '../ui/ahora';
import { EVENTO, FilaEvento } from '../ui/GithubCrew';
import { Chip, Hoja } from '../ui/Hoja';
import { C, Cel, F, Seccion, Txt } from '../ui/tema';

export default function GithubCrew() {
  const { t, tp } = useIdioma(), crew = useCrew(), { usuario } = useSesion(), ahora = useAhora(60e3);
  const { datos: cuentas } = useIntegraciones(), conectado = !!cuentas?.github?.conectado;
  const { datos, cargando } = useGithubCrew(crew?.id ?? null);
  const [filtro, setFiltro] = useState<'todo' | 'deploy' | 'ci' | 'pr'>('todo');
  const [agregando, setAgregando] = useState(false);
  const eventos = useMemo(() => (datos?.eventos ?? []).filter(e => filtro === 'todo' || EVENTO[e.tipo]?.grupo === filtro), [datos, filtro]);
  if (!crew) return <Hoja titulo="GitHub" volverA="/crew"><Txt color={C.t2} style={{ marginTop: 16 }}>{t('Join a crew first.')}</Txt></Hoja>;
  const fallas = (datos?.eventos ?? []).filter(e => (e.tipo === 'deploy_fallo' || e.tipo === 'ci_fallo') && ahora - e.ts < 24 * 3600e3).length;
  return (
    <Hoja titulo={t('GitHub of {crew}', { crew: crew.nombre })} sub={t('Deploys, CI and pull requests of the team repos. Nova warns the right people when something breaks or needs a review.')} volverA="/crew">
      {!conectado ? (
        <Cel style={{ marginTop: 18, gap: 10, borderColor: 'rgba(143,230,245,0.3)' }}>
          <Txt f="s" size={15}>{t('Connect your GitHub')}</Txt>
          <Txt size={13.5} lh={19} color={C.t2}>{t('So Nova knows which pull requests are yours and can read the repos you add. Your token stays on the Nova server.')}</Txt>
          <Pressable onPress={() => router.push({ pathname: '/integracion', params: { k: 'github' } })} style={{ alignSelf: 'flex-start', height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: C.t1, justifyContent: 'center' }}>
            <Txt f="s" size={14} color={C.tinta}>{t('Connect GitHub')}</Txt>
          </Pressable>
        </Cel>
      ) : null}

      {fallas ? (
        <Cel style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: `${C.alerta}55` }}>
          <Ionicons name="warning-outline" size={18} color={C.alerta} />
          <Txt size={14} style={{ flex: 1 }}>{tp(fallas, '{n} failure in the last 24 h', '{n} failures in the last 24 h')}</Txt>
        </Cel>
      ) : null}

      <Seccion t={t('Repos')} nota={datos ? String(datos.repos.length) : undefined} />
      <Cel style={{ paddingVertical: 4 }}>
        {cargando && !datos ? <ActivityIndicator color={C.nova} style={{ marginVertical: 14 }} /> : null}
        {datos?.repos.map((r, i) => (
          <View key={r.repo} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: C.l1 }}>
            <Ionicons name="logo-github" size={18} color={C.t2} />
            <Pressable style={{ flex: 1 }} onPress={() => Linking.openURL(`https://github.com/${r.repo}`).catch(() => {})}>
              <Txt size={14.5} numberOfLines={1}>{r.repo}</Txt>
              <Txt size={12} color={r.error ? C.aviso : C.t3} numberOfLines={1}>{r.error ? t(r.error) : t('Added by {n}', { n: r.de === usuario?.id ? t('you') : miembroDe(r.de)?.nombre.split(' ')[0] ?? '?' })}</Txt>
            </Pressable>
            {r.de === usuario?.id || crew.soyAdmin ? (
              <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); quitarRepo(crew.id, r.repo).catch(() => {}); }} hitSlop={8} accessibilityLabel={t('Remove')}><Ionicons name="close" size={17} color={C.t3} /></Pressable>
            ) : null}
          </View>
        ))}
        {datos && !datos.repos.length ? <Txt size={13.5} lh={19} color={C.t3} style={{ paddingVertical: 12 }}>{t('No repos yet. Add the ones the team works on.')}</Txt> : null}
        {conectado ? (
          agregando ? <AgregarRepo crew={crew.id} listo={() => setAgregando(false)} ya={datos?.repos.map(r => r.repo) ?? []} /> : (
            <Pressable onPress={() => setAgregando(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, borderTopWidth: datos?.repos.length ? 1 : 0, borderTopColor: C.l1 }}>
              <Ionicons name="add" size={19} color={C.nova} /><Txt f="m" size={14} color={C.nova}>{t('Add a repo')}</Txt>
            </Pressable>
          )
        ) : null}
      </Cel>
      {datos?.conectados.length ? <Txt size={12} lh={17} color={C.t3} style={{ marginTop: 8, paddingHorizontal: 4 }}>{t('With GitHub in Nova: {x}. Whoever is missing will not get their review requests.', { x: datos.conectados.map(c => `${miembroDe(c.usuario)?.nombre.split(' ')[0] ?? ''} (@${c.login})`).join(', ') })}</Txt> : null}

      <Seccion t={t('Activity')} />
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <Chip t={t('All')} on={filtro === 'todo'} onPress={() => setFiltro('todo')} />
        <Chip t={t('Deploys')} icono="rocket-outline" on={filtro === 'deploy'} onPress={() => setFiltro('deploy')} />
        <Chip t="CI" icono="construct-outline" on={filtro === 'ci'} onPress={() => setFiltro('ci')} />
        <Chip t="PRs" icono="git-pull-request-outline" on={filtro === 'pr'} onPress={() => setFiltro('pr')} />
      </View>
      <Cel style={{ paddingVertical: 2 }}>
        {eventos.length ? eventos.map((e, i) => <FilaEvento key={e.id} e={e} ahora={ahora} primera={!i} />) : (
          <Txt size={13.5} lh={19} color={C.t3} style={{ paddingVertical: 14 }}>{datos?.repos.length ? t('Nothing new yet. Nova checks every 2 minutes and only tells you what is new from now on.') : t('Add a repo to see its activity here.')}</Txt>
        )}
      </Cel>
    </Hoja>
  );
}

function AgregarRepo({ crew, listo, ya }: { crew: string; listo: () => void; ya: string[] }) {
  const { t } = useIdioma(), { datos, cargando } = useMisRepos(true);
  const [q, setQ] = useState(''), [error, setError] = useState<string | null>(null), [enviando, setEnviando] = useState<string | null>(null);
  const lista = (datos ?? []).filter(r => !ya.includes(r.repo) && r.repo.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8);
  const agregar = async (repo: string) => {
    setError(null); setEnviando(repo);
    try { await agregarRepo(crew, repo); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); listo(); }
    catch (e) { setError(t((e as Error).message)); } finally { setEnviando(null); }
  };
  const escrito = /^[\w.-]+\/[\w.-]+$/.test(q.trim()) && !lista.some(r => r.repo === q.trim());
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: C.l1, paddingVertical: 10, gap: 6 }}>
      <TextInput value={q} onChangeText={setQ} autoFocus placeholder={t('Search your repos or type owner/name')} placeholderTextColor={C.t3} autoCapitalize="none" autoCorrect={false}
        style={{ height: 42, borderRadius: 12, backgroundColor: C.s2, paddingHorizontal: 12, color: C.t1, fontFamily: F.r, fontSize: 14.5 }} />
      {cargando && !datos ? <ActivityIndicator color={C.nova} style={{ marginVertical: 8 }} /> : null}
      {escrito ? <Fila repo={q.trim()} privado={false} cargando={enviando === q.trim()} onPress={() => agregar(q.trim())} /> : null}
      {lista.map(r => <Fila key={r.repo} repo={r.repo} privado={r.privado} cargando={enviando === r.repo} onPress={() => agregar(r.repo)} />)}
      {error ? <Txt size={13} color={C.alerta}>{error}</Txt> : null}
      <Pressable onPress={listo} style={{ alignSelf: 'flex-end', paddingVertical: 4 }}><Txt f="m" size={13} color={C.t2}>{t('Cancel')}</Txt></Pressable>
    </View>
  );
}
function Fila({ repo, privado, cargando, onPress }: { repo: string; privado: boolean; cargando: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={cargando} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, opacity: pressed ? 0.7 : 1 })}>
      <Ionicons name={privado ? 'lock-closed-outline' : 'git-branch-outline'} size={15} color={C.t3} />
      <Txt size={14} style={{ flex: 1 }} numberOfLines={1}>{repo}</Txt>
      {cargando ? <ActivityIndicator size="small" color={C.nova} /> : <Ionicons name="add-circle-outline" size={19} color={C.nova} />}
    </Pressable>
  );
}
