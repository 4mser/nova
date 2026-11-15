/* En web, Skia necesita cargar CanvasKit (wasm) antes de montar cualquier pantalla. */
import '@expo/metro-runtime';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { App } from 'expo-router/build/qualified-entry';
import { renderRootComponent } from 'expo-router/build/renderRootComponent';

LoadSkiaWeb({ locateFile: (f: string) => `/${f}` }).then(() => renderRootComponent(App));
