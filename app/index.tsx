import { AppRegistry, Platform } from 'react-native';
import { widgetsDisponibles } from './src/widgets/disponible';

// widgets de la pantalla de inicio (solo en la versión de desarrollo para Android)
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (widgetsDisponibles()) require('./src/widgets/registrar');

// NOVA sobre cualquier app: la capa del asistente del teléfono (modules/nova-control) monta esta otra raíz
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (Platform.OS === 'android') AppRegistry.registerComponent('NovaAsistente', () => require('./src/asistente/Asistente').default);
// mientras la capa es una burbuja sobre otra app, la actividad queda en segundo plano y Android congela los timers
// de JS; esta tarea (que nunca termina sola) los mantiene corriendo. La enciende y apaga la capa (NovaControl.capaViva).
if (Platform.OS === 'android') AppRegistry.registerHeadlessTask('NovaViva', () => () => new Promise<void>(() => {}));

// eslint-disable-next-line import/first
import 'expo-router/entry';
