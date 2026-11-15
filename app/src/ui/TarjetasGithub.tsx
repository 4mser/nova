/* Lo que NOVA muestra cuando le preguntas por GitHub o por alguien (en el chat y en la capa sobre otras apps):
   · TarjetaGithub: tus commits de hoy en grande, la semana en barras, los repos de hoy y lo pendiente
   · Calendario: el mapa del año (un día por celda, como en tu perfil de GitHub), ajustado al ancho
   · TarjetaPersona: alguien de tu crew: su foto, sus redes (se tocan) y su GitHub (seguidores, repos, la semana) */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Linking, Pressable, View } from 'react-native';
import { imagen } from '../cuenta/api';
import { useIdioma } from '../i18n';
import type { Visual } from '../voz/acciones';
import { BarrasSemana } from './GithubHoy';
import { C, Txt } from './tema';

type VGithub = Extract<Visual, { tipo: 'github' }>;
type VCalendario = Extract<Visual, { tipo: 'calendario' }>;
type VPersona = Extract<Visual, { tipo: 'persona' }>;

/** un número grande con su etiqueta chica */
function Cifra({ n, t, color = C.t1 }: { n: number; t: string; color?: string }) {
  return (
    <View>
      <Txt f="l" size={34} ls={-1.2} lh={38} color={color}>{n}</Txt>
      <Txt size={12} color={C.t3}>{t}</Txt>
    </View>
  );
}

export function TarjetaGithub({ v }: { v: VGithub }) {
  const { t } = useIdioma();
  const pendientes = v.que === 'pendientes';
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name="logo-github" size={14} color={C.t2} />
        <Txt f="mono" size={11} ls={0.8} color={C.t2}>{v.login}</Txt>
      </View>
      {pendientes ? (
        <View style={{ flexDirection: 'row', gap: 18 }}>
          <Cifra n={v.prs} t={t('open PRs')} color={v.prs ? C.nova : C.t3} />
          <Cifra n={v.revisar} t={t('to review')} color={v.revisar ? C.aviso : C.t3} />
          <Cifra n={v.issues} t={t('issues')} color={v.issues ? C.lila : C.t3} />
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 18 }}>
            <Cifra n={v.commits} t={t('commits today')} color={v.commits ? C.ok : C.t3} />
            <Cifra n={v.contribuciones} t={t('contributions')} />
            <Cifra n={v.semana.reduce((a, b) => a + b, 0)} t={t('this week')} />
          </View>
          {v.semana.length ? <BarrasSemana v={v.semana} alto={36} /> : null}
          {v.repos.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {v.repos.map(r => <View key={r} style={{ paddingHorizontal: 9, height: 24, borderRadius: 12, justifyContent: 'center', backgroundColor: C.s1, borderWidth: 1, borderColor: C.l1 }}><Txt f="mono" size={10.5} color={C.t2}>{r}</Txt></View>)}
            </View>
          ) : null}
          {v.prs || v.revisar || v.issues ? <Txt size={12.5} color={C.t3}>{t('{n} PRs · {m} reviews · {k} issues', { n: v.prs, m: v.revisar, k: v.issues })}</Txt> : null}
        </>
      )}
    </View>
  );
}

/** el mapa del año: columnas = semanas (empiezan en domingo), filas = días; el color crece con las contribuciones */
export function Calendario({ v }: { v: VCalendario }) {
  const { t, locale } = useIdioma();
  const max = Math.max(1, ...v.dias.map(d => d.n));
  const nivel = (n: number) => (n <= 0 ? 0 : n >= max * 0.75 ? 4 : n >= max * 0.5 ? 3 : n >= max * 0.25 ? 2 : 1);
  const COLORES = [C.l2, `${C.ok}3d`, `${C.ok}70`, `${C.ok}a8`, C.ok];
  // columnas: una por semana; la primera parte el día de la semana del primer día
  const primera = new Date(`${v.dias[0]?.fecha ?? v.desde}T00:00:00`).getDay();
  const columnas: { fecha: string; n: number }[][] = [[]];
  for (let i = 0; i < primera; i++) columnas[0].push({ fecha: '', n: -1 });
  for (const d of v.dias) { if (columnas[columnas.length - 1].length === 7) columnas.push([]); columnas[columnas.length - 1].push(d); }
  const ANCHO = 300, HUECO = 2, celda = Math.max(3, Math.floor((ANCHO - (columnas.length - 1) * HUECO) / columnas.length));
  // la letra del mes sobre la primera columna que lo contiene
  const meses = columnas.map((col, i) => { const d = col.find(x => x.n >= 0); if (!d) return ''; const f = new Date(`${d.fecha}T00:00:00`); const prev = columnas[i - 1]?.find(x => x.n >= 0); const fp = prev ? new Date(`${prev.fecha}T00:00:00`) : null; return !fp || fp.getMonth() !== f.getMonth() ? f.toLocaleDateString(locale, { month: 'narrow' }) : ''; });
  const activos = v.dias.filter(d => d.n > 0).length;
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
        <Cifra n={v.total} t={t('contributions this year', { n: v.total }).replace(/^\d+\s*/, '')} color={C.ok} />
        <Cifra n={activos} t={t('active days')} />
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 18 }}>
          <Ionicons name="logo-github" size={13} color={C.t3} />
          <Txt f="mono" size={10.5} color={C.t3}>{v.login}</Txt>
        </View>
      </View>
      <View style={{ alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', gap: HUECO, height: 12 }}>
          {meses.map((m, i) => <View key={i} style={{ width: celda }}>{m ? <Txt f="monoR" size={9} color={C.t3}>{m}</Txt> : null}</View>)}
        </View>
        <View style={{ flexDirection: 'row', gap: HUECO }}>
          {columnas.map((col, i) => (
            <View key={i} style={{ gap: HUECO }}>
              {col.map((d, j) => <View key={j} style={{ width: celda, height: celda, borderRadius: Math.min(2, celda / 3), backgroundColor: d.n < 0 ? 'transparent' : COLORES[nivel(d.n)] }} />)}
            </View>
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
        <Txt f="monoR" size={9.5} color={C.t3}>{t('less')}</Txt>
        {COLORES.map((c, i) => <View key={i} style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: c }} />)}
        <Txt f="monoR" size={9.5} color={C.t3}>{t('more')}</Txt>
      </View>
    </View>
  );
}

const ICONO_RED: Record<string, { icono: keyof typeof Ionicons.glyphMap; nombre: string; color: string }> = {
  github: { icono: 'logo-github', nombre: 'GitHub', color: C.t1 },
  linkedin: { icono: 'logo-linkedin', nombre: 'LinkedIn', color: '#4aa3e8' },
  instagram: { icono: 'logo-instagram', nombre: 'Instagram', color: '#e8749a' },
  x: { icono: 'logo-twitter', nombre: 'X', color: C.t1 },
  sitio: { icono: 'globe-outline', nombre: 'Web', color: C.nova },
};

export function TarjetaPersona({ v }: { v: VPersona }) {
  const { t } = useIdioma();
  const iniciales = v.nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('');
  const foto = v.foto ?? null;
  const commits7 = v.github?.semana.reduce((a, b) => a + b, 0) ?? 0;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {foto ? (
          <Image source={imagen(foto)} style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.s1 }} contentFit="cover" />
        ) : (
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(143,230,245,0.14)', alignItems: 'center', justifyContent: 'center' }}><Txt f="s" size={18} color={C.nova}>{iniciales}</Txt></View>
        )}
        <View style={{ flex: 1 }}>
          <Txt f="s" size={17} ls={-0.3}>{v.nombre}</Txt>
          {v.github ? <Txt size={12.5} color={C.t3} numberOfLines={1}>{[v.github.login && `@${v.github.login}`, v.github.empresa, v.github.bio].filter(Boolean).join(' · ')}</Txt> : null}
        </View>
      </View>
      {v.redes.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {v.redes.map(r => {
            const d = ICONO_RED[r.red] ?? { icono: 'link-outline' as const, nombre: r.red, color: C.t2 };
            return (
              <Pressable key={r.red} onPress={() => Linking.openURL(r.url).catch(() => {})} accessibilityRole="link" accessibilityLabel={`${d.nombre}: ${r.usuario}`}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: C.l2, backgroundColor: pressed ? C.s1 : 'transparent' })}>
                <Ionicons name={d.icono} size={14} color={d.color} />
                <Txt f="m" size={13} color={C.t1}>{r.red === 'sitio' ? d.nombre : r.usuario}</Txt>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Txt size={13} color={C.t3}>{t('No networks saved yet')}</Txt>
      )}
      {v.github ? (
        <View style={{ gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.l1 }}>
          <View style={{ flexDirection: 'row', gap: 18 }}>
            <Cifra n={commits7} t={t('commits, last 7 days')} color={commits7 ? C.ok : C.t3} />
            <Cifra n={v.github.seguidores} t={t('followers')} />
            <Cifra n={v.github.repos} t={t('repos')} />
          </View>
          {v.github.semana.length ? <BarrasSemana v={v.github.semana} alto={28} /> : null}
        </View>
      ) : null}
    </View>
  );
}
