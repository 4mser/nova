/* Lo que llega desde el menú «Compartir» de cualquier app (un texto, un enlace, una foto): se guarda aquí y se abre
   /recibir para decidir qué hacer con ello. El módulo nativo llega con el APK 0.4.2: antes, el hook no hace nada. */
import { router } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { useEffect } from 'react';
import { Platform } from 'react-native';

export type Compartido = { texto?: string; url?: string; titulo?: string; imagen?: { uri: string; ancho: number; alto: number }; video?: { uri: string; ancho: number; alto: number; ms: number | null; bytes: number | null } };
let actual: Compartido | null = null;
export const leerCompartido = () => actual;
export const olvidarCompartido = () => { actual = null; };

/** se monta una vez con sesión: cuando llega algo compartido, lo guarda y abre /recibir */
export function useRecibirCompartido(activo: boolean) {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ disabled: Platform.OS === 'web', resetOnBackground: true });
  useEffect(() => {
    if (!activo || !hasShareIntent) return;
    const img = shareIntent.files?.find(f => f.mimeType?.startsWith('image/')), vid = shareIntent.files?.find(f => f.mimeType?.startsWith('video/'));
    actual = {
      texto: shareIntent.text ?? undefined, url: shareIntent.webUrl ?? undefined, titulo: (shareIntent.meta?.title as string | undefined) ?? undefined,
      imagen: img ? { uri: img.path, ancho: img.width ?? 1080, alto: img.height ?? 1440 } : undefined,
      video: vid ? { uri: vid.path, ancho: vid.width ?? 1080, alto: vid.height ?? 1920, ms: vid.duration ?? null, bytes: vid.size ?? null } : undefined,
    };
    resetShareIntent();
    setTimeout(() => router.push('/recibir'), 300);
  }, [activo, hasShareIntent, shareIntent, resetShareIntent]);
}
