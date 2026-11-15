/* Lista de tareas: privadas (solo tú) o de la crew (todos las ven; cualquiera las marca; se asignan a una o varias
   personas). Se agrega escribiendo abajo; tocar el círculo la completa y tocar el texto la abre: cuándo vence, quiénes
   la tienen, sus enlaces y archivos (un PR, un documento, un diseño) y borrarla. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { urlConToken } from '../cuenta/api';
import { aCargo, adjuntarArchivo, adjuntarEnlace, borrarTarea, cambiarTarea, nuevaTarea, quitarAdjunto, type Adjunto, type Tarea } from '../cuenta/datos';
import { miembroDe, useSesion, type Miembro } from '../cuenta/sesion';
import { fechaDe } from '../engine/diario';
import { useIdioma } from '../i18n';
import { useDia } from './ahora';
import { AvatarMiembro } from './Crew';
import { C, Cel, F, Txt } from './tema';

/** avatares encimados de quienes tienen la tarea (hasta 3 y «+n») */
export function Apilados({ ids, size = 26 }: { ids: string[]; size?: number }) {
  const gente = ids.map(miembroDe).filter((m): m is Miembro => !!m), ver = gente.slice(0, 3), mas = gente.length - ver.length;
  if (!gente.length) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {ver.map((m, i) => (
        <View key={m.id} style={{ marginLeft: i ? -size * 0.32 : 0, borderRadius: size, borderWidth: 2, borderColor: C.s1 }}>
          <AvatarMiembro u={m} size={size} />
        </View>
      ))}
      {mas > 0 ? <Txt f="m" size={11.5} color={C.t2} style={{ marginLeft: 4 }}>+{mas}</Txt> : null}
    </View>
  );
}

export function ListaTareas({ tareas, crew, vacia, max }: { tareas: Tarea[]; crew: string | null; vacia?: string; max?: number }) {
  const { t, locale } = useIdioma(), { usuario } = useSesion();
  const [nueva, setNueva] = useState(''), [abierta, setAbierta] = useState<string | null>(null), [todas, setTodas] = useState(false);
  const agregar = () => {
    const titulo = nueva.trim();
    if (!titulo) return;
    setNueva('');
    Haptics.selectionAsync().catch(() => {});
    // un enlace pegado solo se guarda como adjunto con el título de la página
    const enlace = titulo.match(/https?:\/\/\S+/)?.[0];
    nuevaTarea({ titulo: (enlace ? titulo.replace(enlace, '').trim() : titulo) || enlace!.replace(/^https?:\/\//, '').slice(0, 80), crew, enlaces: enlace ? [enlace] : undefined }).catch(() => {});
  };
  const visibles = max && !todas ? tareas.slice(0, max) : tareas, ocultas = tareas.length - visibles.length;
  const ahora = useDia(), hoy = fechaDe(ahora), manana = fechaDe(ahora + 864e5);
  return (
    <Cel style={{ paddingVertical: 4, paddingHorizontal: 16 }}>
      {!tareas.length && vacia ? <Txt size={14} lh={20} color={C.t3} style={{ paddingTop: 14, paddingBottom: 4 }}>{vacia}</Txt> : null}
      {visibles.map(x => {
        const gente = aCargo(x), hizo = x.hechaPor && x.hechaPor !== usuario?.id ? miembroDe(x.hechaPor) : null;
        const vencida = !x.hecha && x.vence && x.vence < hoy, adj = x.adjuntos?.length ?? 0;
        const cuando = x.vence ? (x.vence === hoy ? t('Today') : x.vence === manana ? t('Tomorrow') : new Date(`${x.vence}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })) : null;
        return (
          <Animated.View key={x.id} entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} layout={LinearTransition.duration(200)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.l1 }}>
              <Pressable hitSlop={10} accessibilityRole="checkbox" accessibilityState={{ checked: x.hecha }} accessibilityLabel={x.titulo}
                onPress={() => { Haptics.impactAsync(x.hecha ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); cambiarTarea(x.id, { hecha: !x.hecha }).catch(() => {}); }}
                style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: x.hecha ? C.ok : C.t3, backgroundColor: x.hecha ? C.ok : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {x.hecha ? <Ionicons name="checkmark" size={15} color={C.bg} /> : null}
              </Pressable>
              <Pressable style={{ flex: 1 }} onPress={() => setAbierta(a => (a === x.id ? null : x.id))}>
                <Txt size={15} lh={20} color={x.hecha ? C.t3 : C.t1} style={{ textDecorationLine: x.hecha ? 'line-through' : 'none' }}>{x.titulo}</Txt>
                {cuando || hizo || adj ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 }}>
                    {hizo || cuando ? <Txt size={12.5} color={vencida ? C.aviso : C.t3}>{hizo ? t('Done by {n}', { n: hizo.nombre }) : cuando}</Txt> : null}
                    {adj ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><Ionicons name="attach" size={13} color={C.t3} /><Txt f="monoR" size={11.5} color={C.t3}>{adj}</Txt></View> : null}
                  </View>
                ) : null}
              </Pressable>
              {gente.length ? <Apilados ids={gente} /> : x.crew ? null : <Ionicons name="lock-closed-outline" size={13} color={C.t3} />}
            </View>
            {abierta === x.id ? <Editor tarea={x} ahora={ahora} cerrar={() => setAbierta(null)} /> : null}
          </Animated.View>
        );
      })}
      {ocultas > 0 ? (
        <Pressable onPress={() => setTodas(true)} style={{ paddingVertical: 12 }}><Txt f="m" size={13.5} color={C.nova}>{t('Show {n} more', { n: ocultas })}</Txt></Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Ionicons name="add" size={22} color={C.t3} />
        <TextInput value={nueva} onChangeText={setNueva} onSubmitEditing={agregar} placeholder={t(crew ? 'Add a crew task' : 'Add a task')} placeholderTextColor={C.t3} returnKeyType="done" submitBehavior="submit"
          style={{ flex: 1, height: 48, color: C.t1, fontFamily: F.r, fontSize: 15 }} />
      </View>
    </Cel>
  );
}

const icono = (a: Adjunto): keyof typeof Ionicons.glyphMap => {
  if (a.tipo === 'enlace') return /github\.com/.test(a.url) ? 'logo-github' : /figma\.com/.test(a.url) ? 'color-palette-outline' : /docs\.google|notion\.so|drive\.google/.test(a.url) ? 'document-text-outline' : 'link-outline';
  return a.mime?.startsWith('image/') ? 'image-outline' : a.mime === 'application/pdf' ? 'document-outline' : a.mime?.startsWith('audio/') ? 'musical-note-outline' : a.mime?.startsWith('video/') ? 'videocam-outline' : 'document-attach-outline';
};
const peso = (b: number | null) => (!b ? '' : b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);

/** debajo de la tarea abierta: cuándo vence, quiénes la tienen (si es de la crew), adjuntos y borrarla */
function Editor({ tarea, ahora, cerrar }: { tarea: Tarea; ahora: number; cerrar: () => void }) {
  const { t } = useIdioma(), s = useSesion();
  const crew = tarea.crew ? s.crews.find(c => c.id === tarea.crew) : null;
  const hoy = fechaDe(ahora), manana = fechaDe(ahora + 864e5), gente = aCargo(tarea);
  const [enlace, setEnlace] = useState(''), [ocupado, setOcupado] = useState(false), [error, setError] = useState<string | null>(null);
  const local = tarea.id.startsWith('local-');
  const intentar = async (f: () => Promise<unknown>) => { setError(null); setOcupado(true); try { await f(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); } catch (e) { setError(t((e as Error).message)); } finally { setOcupado(false); } };
  const opcion = (k: string, activo: boolean, f: () => void) => (
    <Pressable key={k} onPress={() => { Haptics.selectionAsync().catch(() => {}); f(); }} style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', backgroundColor: activo ? C.sigSuave : 'transparent', borderWidth: 1, borderColor: activo ? 'transparent' : C.l2 }}>
      <Txt f="m" size={13} color={activo ? C.nova : C.t2}>{k}</Txt>
    </Pressable>
  );
  const alternar = (id: string) => { Haptics.selectionAsync().catch(() => {}); cambiarTarea(tarea.id, { asignados: gente.includes(id) ? gente.filter(x => x !== id) : [...gente, id] }).catch(() => {}); };
  const archivo = () => intentar(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const DP = require('expo-document-picker') as typeof import('expo-document-picker');
    const r = await DP.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets?.[0]) return;
    await adjuntarArchivo(tarea.id, r.assets[0]);
  });
  const abrir = (a: Adjunto) => Linking.openURL(a.tipo === 'enlace' ? a.url : urlConToken(a.url)).catch(() => {});
  return (
    <Animated.View entering={FadeIn.duration(180)} style={{ paddingVertical: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: C.l1 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {opcion(t('Today'), tarea.vence === hoy, () => cambiarTarea(tarea.id, { vence: tarea.vence === hoy ? null : hoy }).catch(() => {}))}
        {opcion(t('Tomorrow'), tarea.vence === manana, () => cambiarTarea(tarea.id, { vence: tarea.vence === manana ? null : manana }).catch(() => {}))}
        {opcion(t('This week'), !!tarea.vence && tarea.vence > manana, () => cambiarTarea(tarea.id, { vence: fechaDe(ahora + 6 * 864e5) }).catch(() => {}))}
      </View>
      {crew ? (
        <View style={{ gap: 6 }}>
          <Txt size={12.5} color={C.t3}>{t('Who has it · tap to add or remove')}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {crew.miembros.map(m => {
              const on = gente.includes(m.id);
              return (
                <Pressable key={m.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={m.nombre} onPress={() => alternar(m.id)} style={{ alignItems: 'center', gap: 3, width: 48 }}>
                  <AvatarMiembro u={m} size={36} anillo={on ? C.nova : undefined} apagado={gente.length > 0 && !on} />
                  <Txt size={11} color={on ? C.nova : C.t3} numberOfLines={1}>{m.nombre.split(' ')[0]}</Txt>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* adjuntos: enlaces (con el título de la página) y archivos */}
      {tarea.adjuntos?.length ? (
        <View style={{ gap: 2 }}>
          {tarea.adjuntos.map(a => (
            <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 }}>
              <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icono(a)} size={15} color={C.t1} /></View>
              <Pressable style={{ flex: 1 }} onPress={() => abrir(a)} accessibilityRole="link">
                <Txt size={14} numberOfLines={1}>{a.nombre}</Txt>
                <Txt f="monoR" size={11} color={C.t3} numberOfLines={1}>{a.tipo === 'enlace' ? a.url.replace(/^https?:\/\/(www\.)?/, '') : peso(a.bytes)}</Txt>
              </Pressable>
              <Pressable onPress={() => intentar(() => quitarAdjunto(a.id))} hitSlop={8} accessibilityLabel={t('Remove')}><Ionicons name="close" size={16} color={C.t3} /></Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {local ? <Txt size={12.5} color={C.t3}>{t('Links and files can be added once it syncs.')}</Txt> : (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput value={enlace} onChangeText={setEnlace} placeholder={t('Paste a link (PR, doc, design…)')} placeholderTextColor={C.t3} autoCapitalize="none" autoCorrect={false} keyboardType="url"
            onSubmitEditing={() => enlace.trim() && intentar(async () => { await adjuntarEnlace(tarea.id, enlace.trim()); setEnlace(''); })}
            style={{ flex: 1, height: 40, borderRadius: 12, backgroundColor: C.s2, paddingHorizontal: 12, color: C.t1, fontFamily: F.r, fontSize: 14 }} />
          <Pressable onPress={archivo} accessibilityLabel={t('Attach a file')} style={{ width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
            {ocupado ? <ActivityIndicator size="small" color={C.nova} /> : <Ionicons name="attach" size={19} color={C.t1} />}
          </Pressable>
        </View>
      )}
      {error ? <Txt size={13} color={C.alerta}>{error}</Txt> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Pressable onPress={() => { borrarTarea(tarea.id).catch(() => {}); cerrar(); }} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="trash-outline" size={15} color={C.alerta} />
          <Txt f="m" size={13} color={C.alerta}>{t('Delete')}</Txt>
        </Pressable>
        <Pressable onPress={cerrar} hitSlop={8}><Txt f="m" size={13} color={C.t2}>{t('Close')}</Txt></Pressable>
      </View>
    </Animated.View>
  );
}
