/* «NOVA notó»: lo más importante que NOVA ve en tus datos hoy, con una acción a un toque. Reglas simples y prudentes
   sobre datos reales (sueño, agenda, tareas, crew, retos, hábitos, check-in). Se descarta por día. Máximo dos. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useBitacora, useGithubCrew, useRetos, useTareas, aCargo } from '../cuenta/datos';
import { useCrew, useSesion } from '../cuenta/sesion';
import { avanceCheckIn } from './CheckIn';
import { fechaDe, useDiario } from '../engine/diario';
import { hecho, racha, useHabitos } from '../engine/habitos';
import { useIdioma } from '../i18n';
import { delDia, huecos, useAgenda } from '../sensores/agenda';
import { recuperacion, ultimos, useHistoria } from '../sensores/historia';
import { useAhora } from './ahora';
import { C, Cel, Txt } from './tema';

type Nota = { id: string; texto: string; icono: keyof typeof Ionicons.glyphMap; color: string; boton?: string; ir?: () => void };
const CLAVE = 'nova.noto.descartadas';

export function NovaNoto() {
  const { t } = useIdioma(), ahora = useAhora(10 * 60e3), hoy = fechaDe(ahora);
  const { dias } = useHistoria(), { eventos, leido } = useAgenda(), { datos: tareas } = useTareas();
  const crew = useCrew(), { usuario } = useSesion(), { datos: bitacora } = useBitacora(crew?.id ?? null), { datos: retos } = useRetos(crew?.id ?? null), { datos: gh } = useGithubCrew(crew?.id ?? null);
  const { habitos, marcas } = useHabitos(), { registros } = useDiario();
  const [descartadas, setDescartadas] = useState<string[]>([]);
  useEffect(() => { AsyncStorage.getItem(`${CLAVE}.${hoy}`).then(v => setDescartadas(v ? JSON.parse(v) : []), () => {}); }, [hoy]);
  const descartar = (id: string) => {
    Haptics.selectionAsync().catch(() => {});
    const n = [...descartadas, id]; setDescartadas(n);
    AsyncStorage.setItem(`${CLAVE}.${hoy}`, JSON.stringify(n)).catch(() => {});
  };

  const notas: Nota[] = [];
  const h = new Date(ahora).getHours();
  // sueño: 3 noches seguidas bajo 6 h
  const noches = ultimos(dias, 3, ahora).map(d => d.suenoH);
  if (noches.every(x => x != null && x < 6)) notas.push({ id: 'sueno', icono: 'moon-outline', color: C.lila, texto: t('Three nights in a row under 6 hours. Tonight, try going to bed 45 minutes earlier.'), boton: t('See my sleep'), ir: () => router.navigate({ pathname: '/salud', params: { seg: 'cuerpo' } }) });
  // recuperación baja
  if (recuperacion(dias)?.nivel === 'baja') notas.push({ id: 'recup', icono: 'pulse-outline', color: C.aviso, texto: t('Your recovery is lower than usual. A light day and an early night will help.') });
  // crew: alguien bloqueado dos días seguidos
  if (crew && bitacora) {
    const ayer = fechaDe(ahora - 864e5);
    for (const m of crew.miembros) {
      if (m.id === usuario?.id) continue;
      const bloq = (f: string) => bitacora.find(e => e.tipo === 'standup' && e.usuario === m.id && fechaDe(e.ts) === f && (() => { try { return !!JSON.parse(e.texto).bloqueo; } catch { return false; } })());
      const b = bloq(hoy) ?? bloq(ayer);
      if (bloq(hoy) && bloq(ayer) && b) {
        let que = ''; try { que = JSON.parse(b.texto).bloqueo; } catch {}
        notas.push({ id: `bloq-${m.id}`, icono: 'alert-circle-outline', color: C.aviso, texto: t('{n} has been blocked for two days: «{x}». Can you help?', { n: m.nombre.split(' ')[0], x: que.slice(0, 80) }), boton: t('See the log'), ir: () => router.navigate({ pathname: '/journal', params: { vista: 'crew' } }) });
        break;
      }
    }
  }
  // agenda de mañana llena
  if (leido && h >= 12) {
    const manana = delDia(eventos, ahora + 864e5).filter(e => !e.todoElDia && !e.libre);
    const d = new Date(ahora + 864e5); d.setHours(8, 0, 0, 0);
    const libre = huecos(eventos, d.getTime()).some(x => x.fin - x.ini >= 60 * 60e3);
    if (manana.length >= 4 && !libre) notas.push({ id: 'agenda', icono: 'calendar-outline', color: C.nova, texto: t('Tomorrow you have {n} events and almost no gaps. A focus block today would help.', { n: manana.length }), boton: t('Focus now'), ir: () => router.push('/foco') });
  }
  // algo se rompió en los repos del equipo en las últimas 3 horas (y no se arregló después)
  const ev = gh?.eventos ?? [], fallo = ev.find(e => (e.tipo === 'deploy_fallo' || e.tipo === 'ci_fallo') && ahora - e.ts < 3 * 3600e3);
  if (fallo && !ev.some(e => e.repo === fallo.repo && e.ts > fallo.ts && (e.tipo === 'deploy_ok' || e.tipo === 'ci_ok')))
    notas.push({ id: `gh-${fallo.id}`, icono: 'warning-outline', color: C.alerta, texto: t('{r}: {x}. Someone on it?', { r: fallo.repo.split('/')[1], x: fallo.titulo }), boton: t('See it'), ir: () => router.push('/github') });
  // tareas atrasadas
  const atrasadas = (tareas ?? []).filter(x => !x.hecha && x.vence && x.vence < hoy && (!x.crew || aCargo(x).includes(usuario?.id ?? '')));
  if (atrasadas.length) notas.push({ id: 'atrasadas', icono: 'time-outline', color: C.alerta, texto: atrasadas.length === 1 ? t('«{x}» is overdue. Do it, move it or drop it?', { x: atrasadas[0].titulo }) : t('{n} tasks are overdue. Shall we sort them out together?', { n: atrasadas.length }), boton: t('Ask Nova'), ir: () => router.push({ pathname: '/nova', params: { q: t('Help me reschedule my overdue tasks') } }) });
  // racha en juego (desde las 18:00)
  if (h >= 18) for (const hb of habitos) { const n = racha(marcas, hb.id, ahora); if (n >= 4 && !hecho(marcas, hb.id, hoy)) { notas.push({ id: `racha-${hb.id}`, icono: 'flame', color: C.aviso, texto: t('Your {n}-day streak of «{x}» is on the line today.', { n, x: t(hb.nombre) }) }); break; } }
  // reto que termina mañana lejos de la meta
  for (const r of retos ?? []) {
    if (r.hasta === fechaDe(ahora + 864e5) && r.total / r.meta < 0.8) { notas.push({ id: `reto-${r.id}`, icono: 'trophy-outline', color: C.aviso, texto: t('«{x}» ends tomorrow and the crew is at {p}%.', { x: r.titulo, p: Math.round((r.total / r.meta) * 100) }), boton: t('See it'), ir: () => router.navigate('/crew') }); break; }
  }
  // check-in: 3 días sin hacerlo
  const sinCheckin = [1, 2, 3].every(k => !avanceCheckIn(registros[fechaDe(ahora - k * 864e5)]).completo) && Object.keys(registros).length > 0;
  if (sinCheckin && h >= 17) notas.push({ id: 'checkin', icono: 'happy-outline', color: C.lila, texto: t('Three days without your check-in. One minute today and I can keep seeing how you are.'), boton: t('Do it now'), ir: () => router.navigate('/journal') });

  const visibles = notas.filter(n => !descartadas.includes(n.id)).slice(0, 2);
  if (!visibles.length) return null;
  return (
    <View style={{ marginTop: 16, gap: 8 }}>
      {visibles.map(n => (
        <Animated.View key={n.id} entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)} layout={LinearTransition}>
          <Cel style={{ padding: 14, borderColor: `${n.color}40` }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Ionicons name={n.icono} size={18} color={n.color} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Txt f="m" size={12} color={C.lila}>{t('Nova noticed')}</Txt>
                <Txt size={14.5} lh={20.5} style={{ marginTop: 2 }}>{n.texto}</Txt>
                {n.boton ? (
                  <Pressable onPress={n.ir} accessibilityRole="button" style={{ alignSelf: 'flex-start', marginTop: 10, height: 32, paddingHorizontal: 13, borderRadius: 16, backgroundColor: `${n.color}1f`, justifyContent: 'center' }}>
                    <Txt f="s" size={13} color={n.color}>{n.boton}</Txt>
                  </Pressable>
                ) : null}
              </View>
              <Pressable onPress={() => descartar(n.id)} hitSlop={10} accessibilityLabel={t('Dismiss')}>
                <Ionicons name="close" size={17} color={C.t3} />
              </Pressable>
            </View>
          </Cel>
        </Animated.View>
      ))}
    </View>
  );
}
