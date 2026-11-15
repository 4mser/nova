/* GitHub en Hoy: tus contribuciones de hoy (las mismas que cuenta tu perfil), la semana en barras y lo que te espera
   (revisiones que te piden, tus PRs abiertos, issues asignados). Solo aparece con GitHub conectado; tocarla abre la ficha. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useGithub, useIntegraciones } from '../cuenta/integraciones';
import { useIdioma } from '../i18n';
import { useAhora } from './ahora';
import { C, Cel, Seccion, Txt } from './tema';

/** contribuciones de los últimos 7 días (la última barra es hoy) */
export function BarrasSemana({ v, alto = 44 }: { v: number[]; alto?: number }) {
  const { locale } = useIdioma(), ahora = useAhora(60 * 60e3), max = Math.max(1, ...v);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: alto + 16 }}>
      {v.map((n, i) => (
        <View key={i} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
          <View style={{ alignSelf: 'stretch', height: Math.max(3, (n / max) * alto), borderRadius: 3, backgroundColor: n ? (i === v.length - 1 ? C.ok : 'rgba(111,214,176,0.45)') : C.l2 }} />
          <Txt f="monoR" size={9.5} color={i === v.length - 1 ? C.t1 : C.t3}>{new Date(ahora - (v.length - 1 - i) * 864e5).toLocaleDateString(locale, { weekday: 'narrow' })}</Txt>
        </View>
      ))}
    </View>
  );
}

export function TarjetaGithub() {
  const { t } = useIdioma(), { datos: cuentas } = useIntegraciones(), conectado = !!cuentas?.github?.conectado;
  const { datos: g } = useGithub(conectado);
  if (!conectado || !g) return null;
  const pendiente = [
    g.revisar.length ? t('{n} reviews for you', { n: g.revisar.length }) : '',
    g.prs.length ? t('{n} open PRs', { n: g.prs.length }) : '',
    g.issues.length ? t('{n} issues', { n: g.issues.length }) : '',
  ].filter(Boolean).join(' · ');
  return (
    <>
      <Seccion t="GitHub" nota={`@${g.login}`} />
      <Pressable onPress={() => router.push({ pathname: '/integracion', params: { k: 'github' } })} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
        <Cel style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 92 }}>
              <Txt f="s" size={30} color={C.ok}>{g.hoy.contribuciones ?? 0}</Txt>
              <Txt size={12} color={C.t3}>{t('contributions today')}</Txt>
            </View>
            <View style={{ flex: 1 }}><BarrasSemana v={g.hoy.semana ?? []} alto={36} /></View>
          </View>
          {pendiente ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.l1 }}>
              <Ionicons name="git-pull-request-outline" size={15} color={g.revisar.length ? C.aviso : C.t2} />
              <Txt size={13.5} color={C.t2} style={{ flex: 1 }} numberOfLines={1}>{pendiente}</Txt>
              <Ionicons name="chevron-forward" size={15} color={C.t3} />
            </View>
          ) : null}
        </Cel>
      </Pressable>
    </>
  );
}
