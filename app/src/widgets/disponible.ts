/* Los widgets solo existen en la versión de desarrollo para Android: la librería exige su módulo nativo al importarse,
   así que se carga recién cuando ese módulo está (en Expo Go y en web no se toca). */
import { Platform, TurboModuleRegistry } from 'react-native';

export const widgetsDisponibles = () => Platform.OS === 'android' && !!TurboModuleRegistry.get('AndroidWidget');
