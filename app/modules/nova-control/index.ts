/* NOVA controla el teléfono (Android): música, cámara, apps, linterna, volumen, contactos, mensajes, llamadas, rutas,
   notificaciones, alarmas, y la capa del asistente (ventana completa o burbuja). Con accesibilidad, además ve lo que
   hay en pantalla y usa las apps por ti. Sin el APK que lo trae (o en Expo Go / web) es null y las herramientas lo
   dicen en vez de fallar. Lo que llegó en la 0.9 se llama con `?.` por si corre en un APK anterior. */
import { requireOptionalNativeModule } from 'expo';
import type { EventSubscription } from 'expo-modules-core';
import { Platform } from 'react-native';

export type Contacto = { id: string; nombre: string; puntaje: number; telefonos: string[]; correos: string[]; whatsapp: boolean; /** content:// de su foto, si tiene */ foto?: string | null };
export type AppMusica = 'spotify' | 'youtube_music';
export type Ahora = { acceso: boolean; suena: boolean; app?: string; titulo?: string | null; artista?: string | null; album?: string | null };

/** un chat con mensajes sin leer, sacado de su notificación */
export type Conversacion = { clave: string; paquete: string; app: string; quien: string | null; grupo: boolean; ultimo: string | null; mensajes: { de: string | null; texto: string | null; t: number }[]; t: number; puedeResponder: boolean };
/** una notificación abierta de cualquier app */
export type Notificacion = Conversacion & { texto: string | null; chat: boolean };
export type ModoTelefono = 'normal' | 'vibrar' | 'silencio' | 'no_molestar' | 'solo_alarmas';
/** ventana: la capa vive en su ventana propia (y puede ser burbuja) · actividad: la hospeda la actividad · cerrada */
export type ModoCapa = 'completa' | 'mini' | 'actividad' | 'cerrada';
export type Respuesta = { ok: boolean; motivo?: string } & Record<string, unknown>;
export type Pantalla = Respuesta & { paquete?: string; app?: string; elementos?: string; cantidad?: number; hay_mas?: boolean };

type Modulo = {
  conversaciones(): Conversacion[];
  notificaciones?(cuantas: number): Notificacion[];
  responderNotificacion(clave: string, texto: string): Promise<boolean>;
  abrirNotificacion?(clave: string): boolean;
  tienePermisoNoMolestar(): boolean;
  abrirPermisoNoMolestar(): boolean;
  modoTelefono(modo: ModoTelefono): boolean;
  modoActual(): ModoTelefono | 'silencio_total';
  media(accion: 'pausar' | 'reanudar' | 'alternar' | 'siguiente' | 'anterior'): { app: string | null; exacto: boolean };
  ahora(): Ahora;
  tieneAccesoNotificaciones(): boolean;
  abrirAccesoNotificaciones(): void;
  appsMusica(): AppMusica[];
  poner(consulta: string, app: AppMusica | null, tipo: string | null): { ok: boolean; app?: AppMusica; modo?: 'reproducir' | 'buscar'; motivo?: string };
  camara(modo: 'foto' | 'video' | 'selfie'): boolean;
  abrirApp(nombre: string): { app: string; paquete: string } | null;
  linterna(encender: boolean): boolean;
  volumen(accion: 'subir' | 'bajar' | 'silenciar' | 'nivel', nivel: number | null): number;
  copiar?(texto: string): boolean;
  quitarAlarma?(etiqueta: string | null, hora: number | null, minutos: number | null): boolean;
  verAlarmas?(): boolean;
  contactos(nombre: string): Contacto[];
  whatsapp(numero: string, texto: string): boolean;
  sms(numero: string, texto: string): boolean;
  correo(para: string, asunto: string, cuerpo: string): boolean;
  llamar(numero: string): boolean;
  navegar(destino: string, modo: string | null, app: string | null): boolean;
  /** la voz de NOVA por AudioTrack (PCM s16le mono): suena apenas llega */
  audioAbrir(hz: number): boolean;
  audioEscribir(b64: string): number;
  audioReproducido(): number;
  audioEscritos(): number;
  /** corta en seco y devuelve la posición de reproducción (cuadros) para medir desde ahí */
  audioParar(): number;
  audioVolumen(v: number): boolean;
  audioCerrar(): boolean;
  esAsistente(): boolean;
  abrirAjustesAsistente(): boolean;
  enfocar(tomar: boolean): boolean;
  abrirAsistente(): boolean;
  agregarFicha(): Promise<boolean>;
  cerrarAsistente(): Promise<void>;
  /** abrir otra app desde la capa la deja como burbuja en vez de cerrarla */
  miniAlSalir(v: boolean): void;
  // ── la capa como ventana propia (0.9) ──
  capaModo?(): ModoCapa;
  capaLado?(): 'izq' | 'der';
  /** tamaño de la burbuja en dp (el orbe solo, o con su píldora) */
  capaMini?(ancho: number, alto: number): boolean;
  capaABurbuja?(): boolean;
  capaCompleta?(): boolean;
  /** mantiene vivos los timers de JS mientras la capa está en segundo plano */
  capaViva?(v: boolean): boolean;
  /** JS sigue vivo (la capa lo llama cada 2 s): si deja de latir, la ventana deja pasar los toques y se cierra sola */
  latido?(): boolean;
  puedeSobreponer?(): boolean;
  pedirSobreponer?(): boolean;
  // ── ver y usar las apps por ti (accesibilidad, 0.9) ──
  accesibilidadActiva?(): boolean;
  abrirAccesibilidad?(): boolean;
  appEnFrente?(): { paquete: string; app: string } | null;
  pantalla?(esperar: boolean): Promise<Pantalla>;
  leerPantalla?(): Promise<Respuesta & { app?: string; texto?: string }>;
  tocar?(id: number): Promise<Respuesta>;
  tocarTexto?(texto: string): Promise<Respuesta>;
  escribir?(id: number | null, texto: string, enviar: boolean): Promise<Respuesta>;
  desplazar?(direccion: string, id: number | null): Promise<Respuesta>;
  tecla?(cual: 'atras' | 'inicio' | 'recientes' | 'notificaciones'): boolean;
  /** JPEG en base64 de la pantalla, sin la capa de NOVA (Android 11+) */
  capturaPantalla?(): Promise<string | null>;
  /** un pantallazo a la galería: el del sistema (suena y muestra la vista previa) o uno propio en Imágenes/Screenshots */
  pantallazo?(): Promise<Respuesta & { modo?: 'sistema' | 'guardado'; archivo?: string }>;
  addListener(evento: 'invocada', f: () => void): EventSubscription;
  addListener(evento: 'capa', f: (e: { modo: ModoCapa; lado?: 'izq' | 'der' }) => void): EventSubscription;
  addListener(evento: 'ventana', f: (e: { paquete: string; app: string }) => void): EventSubscription;
};

export const NovaControl: Modulo | null = Platform.OS === 'android' ? requireOptionalNativeModule<Modulo>('NovaControl') : null;
