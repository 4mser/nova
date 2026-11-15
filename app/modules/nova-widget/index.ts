/* Widgets nativos de NOVA (Android): «Nova» y «Nova · Today», animados con un bucle de cuadros. La app les deja los
   datos del día en JSON; la cara de noche y la animación las resuelve el propio widget. En Expo Go no existe: null. */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type DatosNova = {
  prep: number; atencion: boolean; sorpresa: boolean; sol: number; frase: string; sueno: string;
  ciValor: string; ciEtiqueta: string; ciColor: string;
  /** textos fijos de los widgets, en el idioma de la app (si faltan, el widget usa los de inglés) */
  etqPrep?: string; etqSueno?: string; vivaDormida?: string; vivaPensativa?: string; vivaFeliz?: string;
};
type Modulo = { actualizar(datos: string): void };

const modulo: Modulo | null = Platform.OS === 'android' ? requireOptionalNativeModule<Modulo>('NovaWidget') : null;
export const NovaWidget = modulo && { actualizar: (d: DatosNova) => modulo.actualizar(JSON.stringify(d)) };
