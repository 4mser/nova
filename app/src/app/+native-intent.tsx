/* Al recibir algo compartido, Android abre la app con un enlace interno de expo-share-intent: no es una pantalla.
   Se manda a Hoy y useRecibirCompartido (en el layout) abre /recibir con el contenido. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try { if (path.includes('dataUrl=')) return '/'; } catch {}
  return path;
}
