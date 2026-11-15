/* Lo que Android llama para dibujar los widgets, aunque la app esté cerrada: lee la última instantánea y dibuja. */
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { cargar } from './datos';
import { CasaWidget, CrewWidget, dibujar } from './Widgets';
import { cargarCasaWidget } from './casa';
import { cargarCrewWidget, refrescarCrewDesdeWidget } from './crew';

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const { widgetAction, widgetInfo, renderWidget } = props;
  if (widgetAction === 'WIDGET_ADDED' || widgetAction === 'WIDGET_UPDATE' || widgetAction === 'WIDGET_RESIZED') {
    if (widgetInfo.widgetName === 'Crew') {
      const guardado = await cargarCrewWidget();
      renderWidget(<CrewWidget d={guardado} w={widgetInfo.width} h={widgetInfo.height} ahora={Date.now()} />);
      // y luego lo más nuevo de la API, si hay sesión y señal
      const nuevo = await refrescarCrewDesdeWidget();
      if (nuevo) renderWidget(<CrewWidget d={nuevo} w={widgetInfo.width} h={widgetInfo.height} ahora={Date.now()} />);
      return;
    }
    if (widgetInfo.widgetName === 'Casa') {
      renderWidget(<CasaWidget d={await cargarCasaWidget()} w={widgetInfo.width} h={widgetInfo.height} ahora={Date.now()} />);
      return;
    }
    const d = await cargar();
    renderWidget(dibujar(widgetInfo.widgetName, d, widgetInfo));
  }
}
