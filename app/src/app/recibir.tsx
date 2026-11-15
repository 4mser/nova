/* Recibido: lo que compartiste desde otra app, y qué hacer con ello en un toque (tarea, bitácora personal o de la
   crew, repaso, foto para la crew o preguntarle a NOVA). */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { leerCompartido, olvidarCompartido } from '../cuenta/compartido';
import { escribirBitacora, nuevaTarea } from '../cuenta/datos';
import { subirFoto, subirVideo } from '../cuenta/fotos';
import { useCrew } from '../cuenta/sesion';
import { escribir } from '../engine/diario';
import { crearTarjeta } from '../engine/repaso';
import { useIdioma } from '../i18n';
import { NovaOrb } from '../nova/NovaOrb';
import { volver } from '../ui/volver';
import { C, Cel, Txt } from '../ui/tema';

type Accion = { k: string; icono: keyof typeof Ionicons.glyphMap; t: string; color: string; hacer: () => Promise<string | void> };

export default function Recibir() {
  const ins = useSafeAreaInsets(), { t } = useIdioma(), crew = useCrew();
  const [c] = useState(leerCompartido);
  const [haciendo, setHaciendo] = useState<string | null>(null), [hecho, setHecho] = useState<string | null>(null);
  const cuerpo = [c?.titulo, c?.texto && c.texto !== c?.url ? c.texto : undefined, c?.url].filter(Boolean).join('\n');
  const titulo = (c?.titulo ?? c?.texto ?? c?.url ?? '').split('\n')[0].slice(0, 120);
  const cerrar = () => { olvidarCompartido(); volver('/'); };

  const acciones: Accion[] = !c ? [] : [
    { k: 'nova', icono: 'sparkles', t: t('Ask Nova about it'), color: C.lila, hacer: async () => { olvidarCompartido(); router.replace({ pathname: '/nova', params: { q: `${t('About this:')}\n${cuerpo}` } }); } },
    ...(cuerpo ? [
      { k: 'tarea', icono: 'checkbox-outline' as const, t: t('Make it a task'), color: C.nova, hacer: async () => { await nuevaTarea({ titulo: titulo || t('Shared'), nota: cuerpo.length > titulo.length ? cuerpo : null }); return t('Added to your tasks'); } },
      { k: 'personal', icono: 'lock-closed-outline' as const, t: t('Save in my log'), color: C.t2, hacer: async () => { escribir({ texto: cuerpo, animo: 2, etiquetas: [], compartir: false }); return t('Saved in your personal log'); } },
      ...(crew ? [{ k: 'crew', icono: 'people-outline' as const, t: t('Post to the {crew} log', { crew: crew.nombre }), color: C.ok, hacer: async () => { await escribirBitacora(crew.id, cuerpo, 'nota'); return t('Posted to {crew}', { crew: crew.nombre }); } }] : []),
      { k: 'repaso', icono: 'school-outline' as const, t: t('Save to review'), color: C.aviso, hacer: async () => { await crearTarjeta(titulo || t('Shared'), cuerpo); return t('I will ask you about it tomorrow'); } },
    ] : []),
    ...(c.video && crew ? [{ k: 'video', icono: 'videocam-outline' as const, t: t('Share the video with {crew}', { crew: crew.nombre }), color: C.sig, hacer: async () => { await subirVideo(crew.id, { uri: c.video!.uri, width: c.video!.ancho, height: c.video!.alto, duration: c.video!.ms, fileSize: c.video!.bytes ?? undefined }); return t('Shared with {crew}', { crew: crew.nombre }); } }] : []),
    ...(c.imagen && crew ? [{ k: 'foto', icono: 'camera-outline' as const, t: t('Share it with {crew}', { crew: crew.nombre }), color: C.sig, hacer: async () => { await subirFoto(crew.id, { uri: c.imagen!.uri, width: c.imagen!.ancho, height: c.imagen!.alto }); return t('Shared with {crew}', { crew: crew.nombre }); } }] : []),
  ];

  const tocar = async (a: Accion) => {
    if (haciendo) return;
    setHaciendo(a.k);
    try {
      const r = await a.hacer();
      if (r) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); setHecho(r); setTimeout(cerrar, 1100); }
    } catch (e) { setHecho(t((e as Error).message)); }
    finally { setHaciendo(null); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 14 : ins.top + 8, paddingBottom: 6 }}>
        <Pressable onPress={cerrar} hitSlop={10} accessibilityLabel={t('Close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.s1, borderWidth: 1, borderColor: C.l2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-down" size={18} color={C.t2} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: ins.bottom + 30 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Txt f="s" size={30} ls={-1.2} lh={34}>{t('Received')}</Txt>
            <Txt size={15} color={C.t2} style={{ marginTop: 4 }}>{t('What should I do with it?')}</Txt>
          </View>
          <NovaOrb size={96} orbes={2} expr={hecho ? 'feliz' : 'pensativa'} />
        </View>
        {!c ? <Txt size={15} color={C.t2} style={{ marginTop: 20 }}>{t('Nothing to show. Share something from another app and choose Nova.')}</Txt> : (
          <Cel style={{ marginTop: 16, gap: 10 }}>
            {c.imagen ? <Image source={{ uri: c.imagen.uri }} style={{ width: '100%', aspectRatio: Math.max(0.6, Math.min(1.8, c.imagen.ancho / c.imagen.alto)), borderRadius: 14 }} contentFit="cover" /> : null}
            {c.titulo ? <Txt f="s" size={16} lh={22}>{c.titulo}</Txt> : null}
            {c.texto && c.texto !== c.url ? <Txt size={14.5} lh={21} color={C.t2} numberOfLines={8}>{c.texto}</Txt> : null}
            {c.url ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Ionicons name="link" size={14} color={C.nova} /><Txt size={13} color={C.nova} numberOfLines={1} style={{ flex: 1 }}>{c.url}</Txt></View> : null}
          </Cel>
        )}
        {hecho ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 }}>
            <Ionicons name="checkmark-circle" size={20} color={C.ok} />
            <Txt f="m" size={15} color={C.ok}>{hecho}</Txt>
          </View>
        ) : (
          <View style={{ gap: 8, marginTop: 16 }}>
            {acciones.map(a => (
              <Pressable key={a.k} onPress={() => tocar(a)} disabled={!!haciendo} accessibilityRole="button"
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, height: 56, paddingHorizontal: 16, borderRadius: 18, backgroundColor: pressed ? C.s2 : C.s1, borderWidth: 1, borderColor: C.l1 })}>
                <Ionicons name={a.icono} size={19} color={a.color} />
                <Txt f="m" size={15} style={{ flex: 1 }} numberOfLines={1}>{a.t}</Txt>
                {haciendo === a.k ? <ActivityIndicator color={C.nova} /> : <Ionicons name="chevron-forward" size={16} color={C.t3} />}
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
