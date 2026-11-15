/* GitHub de la crew en pequeño: cómo se dibuja cada evento (icono y color por tipo) y la tarjeta de la pantalla Crew
   con lo último que pasó (o cómo empezar). La pantalla completa es /github. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Linking, Pressable, View } from 'react-native';
import { useGithubCrew, type EventoGh } from '../cuenta/datos';
import type { Crew } from '../cuenta/sesion';
import { useIdioma } from '../i18n';
import { useAhora } from './ahora';
import { C, Cel, Seccion, Txt } from './tema';

export const EVENTO: Record<EventoGh['tipo'], { icono: keyof typeof Ionicons.glyphMap; color: string; grupo: 'deploy' | 'ci' | 'pr' }> = {
  deploy_fallo: { icono: 'cloud-offline-outline', color: C.alerta, grupo: 'deploy' },
  deploy_ok: { icono: 'rocket-outline', color: C.ok, grupo: 'deploy' },
  ci_fallo: { icono: 'close-circle-outline', color: C.alerta, grupo: 'ci' },
  ci_ok: { icono: 'checkmark-circle-outline', color: C.ok, grupo: 'ci' },
  pr_abierto: { icono: 'git-pull-request-outline', color: C.nova, grupo: 'pr' },
  pr_revision: { icono: 'eye-outline', color: C.aviso, grupo: 'pr' },
  pr_aprobado: { icono: 'thumbs-up-outline', color: C.ok, grupo: 'pr' },
  pr_cambios: { icono: 'create-outline', color: C.aviso, grupo: 'pr' },
  pr_mergeado: { icono: 'git-merge-outline', color: C.lila, grupo: 'pr' },
};

/** hace cuánto, corto: «ahora», «12 min», «3 h», «2 d» */
export function hace(ts: number, ahora: number, t: (s: string, v?: Record<string, string | number>) => string) {
  const m = Math.round((ahora - ts) / 60e3);
  return m < 1 ? t('now') : m < 60 ? t('{n} min', { n: m }) : m < 24 * 60 ? t('{n} h', { n: Math.round(m / 60) }) : t('{n} d', { n: Math.round(m / 1440) });
}

export function FilaEvento({ e, ahora, primera }: { e: EventoGh; ahora: number; primera?: boolean }) {
  const { t } = useIdioma(), x = EVENTO[e.tipo] ?? EVENTO.pr_abierto;
  return (
    <Pressable onPress={() => Linking.openURL(e.url).catch(() => {})} accessibilityRole="link" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderTopWidth: primera ? 0 : 1, borderTopColor: C.l1, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: `${x.color}1c`, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={x.icono} size={17} color={x.color} /></View>
      <View style={{ flex: 1 }}>
        <Txt size={14.5} lh={19} numberOfLines={2}>{e.titulo}</Txt>
        <Txt f="monoR" size={11.5} color={C.t3} numberOfLines={1}>{e.repo.split('/')[1]}{e.detalle ? ` · ${e.detalle}` : ''}</Txt>
      </View>
      <Txt f="monoR" size={11.5} color={C.t3}>{hace(e.ts, ahora, t)}</Txt>
    </Pressable>
  );
}


export function TarjetaGithubCrew({ crew }: { crew: Crew }) {
  const { t } = useIdioma(), ahora = useAhora(60e3), { datos } = useGithubCrew(crew.id);
  if (!datos) return null;
  const ultimos = datos.eventos.slice(0, 3);
  return (
    <>
      <Seccion t="GitHub" nota={datos.repos.length ? t('{n} repos', { n: datos.repos.length }) : undefined} />
      <Pressable onPress={() => router.push('/github')} accessibilityRole="button">
        <Cel style={{ paddingVertical: ultimos.length ? 2 : 16 }}>
          {ultimos.length ? ultimos.map((e, i) => <FilaEvento key={e.id} e={e} ahora={ahora} primera={!i} />) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name="logo-github" size={22} color={C.t2} />
              <Txt size={14} lh={19} color={C.t2} style={{ flex: 1 }}>{datos.repos.length ? t('All quiet in the team repos.') : t('Add the team repos: Nova warns about failed deploys, broken CI and reviews.')}</Txt>
              <Ionicons name="chevron-forward" size={16} color={C.t3} />
            </View>
          )}
        </Cel>
      </Pressable>
    </>
  );
}
