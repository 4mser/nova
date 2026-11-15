/* Uso del teléfono (Android, con permiso del usuario en Ajustes → Acceso al uso). En Expo Go no existe: null. */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type UsoApp = { paquete: string; nombre: string; ms: number };
export type Uso = { pantallaMs: number; desbloqueos: number; apps: UsoApp[]; intervalos: { ini: number; fin: number }[] };

type Modulo = { tienePermiso(): boolean; abrirAjustes(): void; uso(desde: number, hasta: number): Promise<Uso> };

export const NovaUso: Modulo | null = Platform.OS === 'android' ? requireOptionalNativeModule<Modulo>('NovaUso') : null;
