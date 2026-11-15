/* Piezas de la crew: avatar de cada miembro (foto o iniciales con su color), fila de avatares y el aviso breve que
   aparece arriba cuando alguien de la crew comparte algo. */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { imagen } from '../cuenta/api';
import type { Usuario } from '../cuenta/sesion';
import { cerrarAviso, useAviso } from '../cuenta/tiempoReal';
import { iniciales } from '../engine/perfil';
import { useIdioma } from '../i18n';
import { C, Txt } from './tema';

const PALETA = [C.nova, C.ok, C.lila, C.aviso, '#f59ad0', '#7fb2ff'];
/** cada persona tiene su color, estable (sale de su id) */
export function colorDe(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return PALETA[Math.abs(h) % PALETA.length];
}

export function AvatarMiembro({ u, size = 36, anillo, apagado }: { u: Pick<Usuario, 'id' | 'nombre' | 'foto'> | null | undefined; size?: number; anillo?: string; apagado?: boolean }) {
  if (!u) return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.s2 }} />;
  const col = colorDe(u.id), borde = anillo ? 2 : 0, dentro = size - (anillo ? 6 : 0);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: borde, borderColor: anillo, alignItems: 'center', justifyContent: 'center', opacity: apagado ? 0.45 : 1 }}>
      <View style={{ width: dentro, height: dentro, borderRadius: dentro / 2, overflow: 'hidden', backgroundColor: col, alignItems: 'center', justifyContent: 'center' }}>
        {u.foto ? <Image source={imagen(u.foto)} style={{ width: dentro, height: dentro }} contentFit="cover" transition={150} /> : <Txt f="s" size={dentro * 0.36} color={C.bg}>{iniciales(u.nombre)}</Txt>}
      </View>
    </View>
  );
}

/** varios avatares encimados */
export function FilaAvatares({ us, size = 28, max = 5 }: { us: Pick<Usuario, 'id' | 'nombre' | 'foto'>[]; size?: number; max?: number }) {
  const vis = us.slice(0, max), resto = us.length - vis.length;
  return (
    <View style={{ flexDirection: 'row' }}>
      {vis.map((u, i) => (
        <View key={u.id} style={{ marginLeft: i ? -size * 0.3 : 0, borderRadius: size, borderWidth: 2, borderColor: C.s1 }}>
          <AvatarMiembro u={u} size={size} />
        </View>
      ))}
      {resto > 0 ? (
        <View style={{ marginLeft: -size * 0.3, width: size + 4, height: size + 4, borderRadius: size, backgroundColor: C.s2, borderWidth: 2, borderColor: C.s1, alignItems: 'center', justifyContent: 'center' }}>
          <Txt f="m" size={11} color={C.t2}>+{resto}</Txt>
        </View>
      ) : null}
    </View>
  );
}

/** el aviso de arriba: «Benja compartió su foto», «Kevin terminó Comprar pasajes»… se va solo a los 4 s */
export function AvisoCrew() {
  const a = useAviso(), ins = useSafeAreaInsets(), { t } = useIdioma();
  useEffect(() => { if (!a) return; const id = setTimeout(cerrarAviso, 4000); return () => clearTimeout(id); }, [a]);
  if (!a) return null;
  const [icono, texto] =
    a.tipo === 'foto' ? ['camera', t('{n} shared a photo', { n: a.nombre ?? '' })]
    : a.tipo === 'reaccion' ? ['heart', t('{n} reacted {e} to your photo', { n: a.nombre ?? '', e: a.emoji ?? '' })]
    : a.tipo === 'reto' ? ['trophy', t('{n} started a challenge: {t}', { n: a.nombre ?? '', t: a.titulo ?? '' })]
    : a.hecha ? ['checkmark-circle', t('{n} finished {t}', { n: a.nombre ?? '', t: a.titulo ?? '' })]
    : ['list', t('{n} gave you a task: {t}', { n: a.nombre ?? '', t: a.titulo ?? '' })];
  return (
    <Animated.View key={a.id} entering={FadeInUp.duration(220)} exiting={FadeOutUp.duration(180)} style={{ position: 'absolute', top: ins.top + 8, left: 16, right: 16, zIndex: 50 }}>
      <Pressable onPress={() => { cerrarAviso(); router.navigate('/crew'); }} accessibilityRole="button"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 20, backgroundColor: C.barra, borderWidth: 1, borderColor: C.l2, boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
        <Ionicons name={icono as keyof typeof Ionicons.glyphMap} size={18} color={C.nova} />
        <Txt f="m" size={14.5} style={{ flex: 1 }} numberOfLines={2}>{texto}</Txt>
      </Pressable>
    </Animated.View>
  );
}

/** botón chico con contorno, para acciones secundarias dentro de tarjetas */
export function Chip({ t, icono, onPress, activo, color = C.nova }: { t: string; icono?: keyof typeof Ionicons.glyphMap; onPress: () => void; activo?: boolean; color?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={t} hitSlop={4}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: activo ? color : pressed ? C.s2 : 'transparent', borderWidth: activo ? 0 : 1, borderColor: C.l2 })}>
      {icono ? <Ionicons name={icono} size={15} color={activo ? C.tinta : color} /> : null}
      <Txt f="m" size={13.5} color={activo ? C.tinta : C.t1}>{t}</Txt>
    </Pressable>
  );
}
