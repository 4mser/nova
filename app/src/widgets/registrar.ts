/* Se carga solo si los widgets existen (ver disponible.ts): registra el manejador que Android usa para dibujarlos. */
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from './handler';

registerWidgetTaskHandler(widgetTaskHandler);
