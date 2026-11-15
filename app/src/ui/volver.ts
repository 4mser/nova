/* Cerrar una pantalla: vuelve atrás si hay historia; si se abrió directo (desde una notificación o un enlace), va a su
   pestaña. Sin esto, router.back() sin historia avisa «GO_BACK was not handled». */
import { router } from 'expo-router';

export function volver(destino: '/crew' | '/' = '/crew') {
  if (router.canGoBack()) router.back();
  else router.replace(destino);
}
