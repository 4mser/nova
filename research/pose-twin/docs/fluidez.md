# Fluidez en vivo: diagnóstico y resultados (26 nov 2026)

Equipo: Windows 11, CPU (el delegado GPU de MediaPipe 1.2.3 no está disponible en Windows), webcam
integrada 640x480 YUY2 por DirectShow, modelo `full`. Meta: 25 FPS o más y latencia menor que 60 ms.

## Causa

**La cámara, no el procesamiento.** Con poca luz la exposición automática de la webcam alarga cada cuadro
y entrega solo 10,4 FPS (un cuadro cada 96 ms). El programa procesa un cuadro con persona en unos 30 ms,
así que pasaba unos 65 ms de cada vuelta esperando a la cámara.

Evidencia:

1. CSV de la sesión real (2 h 30 min). Los primeros 125 min, con luz de día, la cámara dio un cuadro cada
   32 ms (31 FPS). Al atardecer el intervalo saltó a 64 ms y luego a 96 ms **sin nadie delante**
   (entre los minutos 134 y 139 no hubo persona y el intervalo ya era de 96 ms). La persona apareció
   después; el FPS bajo coincidió con ella, pero no lo causó.
2. Sonda de la cámara esta noche (sin procesar nada): DSHOW 10,4 FPS. MSMF parece más rápida
   (mediana de 8 ms entre lecturas), pero 74 de 121 cuadros eran copias idénticas: también son 10 FPS reales.
   Pedir MJPG o 30 FPS no cambia nada (el driver se queda en YUY2).
3. Con exposición manual de 1/32 s (`--exposicion -5`) la misma cámara entrega 30,8 FPS, pero con esta luz
   la imagen queda casi negra (brillo medio 2 a 4 de 255) y no se detecta a nadie.
4. La latencia de 92 ms del CSV antiguo se medía desde *antes* de pedir el cuadro, así que incluía la
   espera a la cámara (unos 65 ms). La latencia real, desde que llega el cuadro hasta que se ve, era de unos 31 ms.

## Tiempos por etapa (`--diagnostico`)

Mediana y p95 en ms. Fuente indicada en cada columna.

| Etapa | Cámara real esta noche, con persona (antes: lectura directa) | Cámara real esta noche, con persona (después: hilo) | Cámara emulada a 30 FPS con `sentadilla.webm` 640x480 (después) |
|---|---|---|---|
| captura (espera) | 66,1 / 83,9 | 65,4 / 81,6 | 0,0 / 4,4 |
| preparación | 0,5 / 0,8 | 0,4 / 0,8 | 0,3 / 0,4 |
| inferencia | 26,0 / 31,6 | 27,1 / 34,3 | 24,7 / 27,2 |
| post + filtro | 0,2 / 0,2 | 0,2 / 0,2 | 0,2 / 0,3 |
| dibujo (esqueleto y panel) | 0,8 / 1,1 | 0,8 / 1,1 | 1,0 / 1,2 |
| CSV | < 0,1 | < 0,1 | < 0,1 |
| pantalla (imshow + waitKey) | 1,4 / 14,5 | 1,4 / 10,6 | 4,7 / 16,2 |
| **FPS** | **10,2** | **10,3** | **31,9** |
| **latencia** (llegada del cuadro a pantalla) | 30,5 / 43,0 | 31,3 / 41,5 | 37,0 / 52,3 |

Panel y CSV cuestan menos de 1,5 ms juntos: no hacía falta optimizarlos. En otra corrida de esta noche la
inferencia subió a 37 ms de mediana (variación de carga de la CPU), con latencia de 42 / 58 ms.

## Antes y después

| | FPS con persona | Latencia con persona | Fuente |
|---|---|---|---|
| Antes, sesión real con poca luz | 10,2 (p95 18) | 92 ms, p95 237 (medida incluía la espera a la cámara) | CSV de la sesión |
| Después, misma luz | 10,3 | 31 ms, p95 42 (llegada a pantalla) | cámara real, 15 s |
| Después, cámara a 30 FPS (exposición 1/32 s, imagen oscura, sin persona) | 30,7 sin persona | 15 ms, p95 28 | cámara real, 12 s |
| Después, cámara emulada a 30 FPS con persona, `full` | 31,9 | 37 ms, p95 52 | `sentadilla.webm`, bucle en vivo real con ventana |
| Después, cámara emulada a 30 FPS con persona, `lite` | 31,8 | 33 ms, p95 43 | idem |

Inferencia sola con persona (`sentadilla.webm` a 640 px, 406 cuadros, CPU): lite 20,5 ms, full 25,1 ms,
heavy 56,8 ms (mediana). Con `heavy` el techo es unos 17 FPS en esta CPU: para 25 FPS usar `full` o `lite`.

Conclusión: con una cámara que entregue 30 FPS (buena luz) el programa llega a unos 30 FPS con persona y
latencia mediana de 31 a 37 ms. Con poca luz el techo lo pone la cámara: o más luz, o exposición manual
(más FPS, imagen más oscura).

## Cambios

- `--diagnostico`: tiempo de cada etapa por cuadro (captura, preparación, inferencia, post, filtro, dibujo,
  CSV, grabación, pantalla), resumen con mediana y p95 al salir, separado con y sin persona, y CSV de tiempos
  en `data/sesiones/diagnostico_*.csv`.
- Latencia corregida: se mide desde que llega el cuadro, no desde que se empieza a esperarlo.
- Captura en hilo aparte (`--captura hilo`, por defecto) que se queda con el último cuadro: el bucle nunca
  procesa cuadros viejos del búfer y la espera a la cámara no se suma a la latencia. `--captura directa`
  conserva el comportamiento anterior.
- Opciones de cámara: `--backend auto|dshow|msmf|any`, `--ancho`, `--alto`, `--fps-camara`, `--fourcc`,
  `--exposicion` (manual, en log2 de segundos). Al cerrar se devuelve la exposición a automática, porque el
  driver la recuerda entre sesiones (comprobado: tras fijarla, otra aplicación la vería oscura).
  DSHOW solo aplica el nuevo intervalo entre cuadros al renegociar el formato; el programa lo hace solo.
- Aviso en consola si la cámara entrega menos de 20 FPS, con la causa probable y qué hacer.
- `--modelo lite` (`pose_landmarker_lite.task`). Si no está en `nave/vision/modelos/` se busca en
  `data/modelos/`; si falta, el error da la URL oficial de descarga.
- `--cerrar-sin-persona MIN` (por defecto 5; 0 = nunca): cierra la sesión en vivo tras MIN minutos sin ver a
  nadie, para no dejar la cámara encendida (la sesión del CSV quedó 2 h abierta sin persona).
- El modelo se carga antes de abrir la cámara y la cámara se cierra primero al salir, aunque haya error.

## Descartado (con datos)

- **MediaPipe LIVE_STREAM o hilo de inferencia**: el procesamiento ya cabe en un cuadro de 33 ms
  (unos 31 ms en total con persona). Separar la inferencia de la pantalla subiría el techo, pero no hace
  falta para 25 FPS y agregaría un cuadro de retraso. Solo valdría la pena con `heavy`.
- **Optimizar el panel o el CSV**: menos de 1,5 ms por cuadro.
- **MJPG o 30 FPS pedidos**: el driver de esta webcam los ignora (sigue en YUY2 y en 10,4 FPS con poca luz).

## Vía de GPU (no instalada, solo descrita)

MediaPipe para Python no trae delegado GPU en Windows. La vía realista con la RTX 3050 Ti (4 GB) es
ONNX Runtime con DirectML (`onnxruntime-directml`, no pide CUDA) o con CUDA (`onnxruntime-gpu` + CUDA y
cuDNN), usando RTMPose o RTMW por `rtmlib`, que el bench ya soporta en CPU. Otra opción es WSL2 con CUDA,
pero la webcam no pasa a WSL2 sin `usbipd`. No hay modelo BlazePose oficial en ONNX. No medido: la ganancia
sería sobre unos 25 ms de inferencia, y el techo con poca luz seguiría siendo la cámara.

## Sin verificar

- 25 FPS con una persona real delante y buena luz: no se pudo medir esta noche (con poca luz la cámara da
  10 FPS; con exposición manual no se ve a nadie). La cifra con persona a 30 FPS viene de la cámara emulada.
- Otras webcams o drivers: los valores de exposición (log2 de segundos) y el formato dependen del driver.
- Que `--exposicion` funcione igual con MSMF: solo se probó con DSHOW.

## Cómo repetir

```powershell
python -m pose_twin live --source 0 --modelo full --diagnostico --max-segundos 15
python -m pose_twin live --source 0 --modelo full --diagnostico --exposicion -5 --max-segundos 15
python -m pose_twin live --source data\muestras\sentadilla.webm --modelo full --diagnostico
```
