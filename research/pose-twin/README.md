# pose-twin: seguimiento corporal de una persona en tiempo real

Línea base en contexto Tierra (no astronautas). Una cámara (webcam, archivo, URL o el teléfono) y una
persona: esqueleto en vivo, ángulos de codos, hombros, caderas y rodillas, indicador de calidad,
abstención cuando no se ve bien, perfil personal, registro CSV y video anotado.

> No es un dispositivo médico ni diagnostica. Las cifras son estimaciones de un modelo genérico.

## Instalación (PowerShell)

```powershell
cd research\pose-twin   # desde la raiz del repositorio
uv venv --python 3.13 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
# Opcional, solo para comparar con RTMPose-m en el bench:
uv pip install --python .venv\Scripts\python.exe rtmlib==0.0.16 --no-deps
uv pip install --python .venv\Scripts\python.exe onnxruntime tqdm
.venv\Scripts\Activate.ps1
```

Los modelos de MediaPipe se leen de `nave/vision/modelos/` del repo (no se copian).

Muestras públicas para probar sin cámara (quedan en `data/`, fuera de git):

```powershell
New-Item -ItemType Directory -Force data\muestras | Out-Null
Invoke-WebRequest https://storage.googleapis.com/mediapipe-assets/pose.jpg -OutFile data\muestras\pose.jpg
Invoke-WebRequest "https://upload.wikimedia.org/wikipedia/commons/5/5c/Squat_-_exercise_demonstration_video.webm" -OutFile data\muestras\sentadilla.webm -UserAgent "pose-twin"
```

- `pose.jpg`: imagen de ejemplo de MediaPipe (bucket público `mediapipe-assets` de Google, usada en su documentación).
- `sentadilla.webm`: "Squat - exercise demonstration video", FitnessScape, Wikimedia Commons, licencia CC BY 3.0.

## Uso

```powershell
# En vivo con la webcam (índice 0). Si Windows no ve la cámara, el programa lo dice y sugiere alternativas.
python -m pose_twin live --source 0

# En vivo con un archivo (video o imagen) o una URL (RTSP/HTTP)
python -m pose_twin live --source data\muestras\sentadilla.webm
python -m pose_twin live --source rtsp://192.168.1.50:8554/cam

# Teléfono como cámara (misma red Wi-Fi)
python -m pose_twin live --source telefono

# Video anotado sin ventana (+ CSV junto al video)
python -m pose_twin video --in data\muestras\sentadilla.webm --out data\salidas\sentadilla_anotado.mp4

# Perfil personal sin ventana (también se crea en vivo con la tecla c). La fuente debe estar quieta:
# con sentadilla.webm se rechaza por movimiento.
python -m pose_twin calibrar --source data\muestras\pose.jpg --nombre prueba --segundos 2
python -m pose_twin live --source 0 --perfil prueba

# Sentadillas de un video, sin cámara (JSON y CSV en data\sentadillas\)
python -m pose_twin video --in data\muestras\sentadilla.webm --out data\salidas\sentadilla_medida.mp4 --sentadilla

# Bench de rotación (escribe docs\linea-base.md)
python -m pose_twin bench

# Pruebas
python -m pytest -q
```

Teclas en la ventana: `q`/`Esc` salir, `g` grabar o detener mp4 anotado (en `data\grabaciones\`),
`c` calibrar el perfil, `s` empezar o terminar una serie de sentadillas, `e` activar o desactivar el enderezado.
Opciones útiles: `--modelo lite|full|heavy` (heavy por defecto), `--enderezar`, `--umbral-vis 0.6`, `--delegado cpu`.

### Fluidez en vivo

- Para 25 FPS o más en CPU usa `--modelo full` o `lite`: `heavy` tarda unos 57 ms por cuadro (techo de unos 17 FPS).
- Con poca luz la webcam baja sola a unos 10 FPS (exposición automática larga). El programa lo avisa en
  consola. Solución: más luz, o `--exposicion -5` (1/32 s, 30 FPS, imagen más oscura; al salir vuelve a automática).
- `--diagnostico` imprime al salir el tiempo de cada etapa (captura, inferencia, dibujo, pantalla...) con
  mediana y p95, y guarda un CSV de tiempos. Resultados y causa del caso real en `docs/fluidez.md`.
- La cámara se lee en un hilo aparte y se usa siempre el último cuadro (`--captura directa` para desactivarlo).
  Otras opciones de cámara: `--backend dshow|msmf`, `--ancho`, `--alto`, `--fps-camara`, `--fourcc MJPG`.
- La sesión en vivo se cierra sola tras 5 minutos sin persona, para no dejar la cámara encendida
  (`--cerrar-sin-persona MIN`, 0 = nunca). `--max-segundos N` la cierra tras N segundos.
- `lite` no viene en el repo: descárgalo a `data\modelos\`:

```powershell
New-Item -ItemType Directory -Force data\modelos | Out-Null
Invoke-WebRequest https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task -OutFile data\modelos\pose_landmarker_lite.task
```

Cada sesión en vivo guarda un CSV en `data\sesiones\` (tiempo, FPS, latencia, calidad, rotación y los
8 ángulos; celda vacía cuando hay abstención). La latencia va desde que llega el cuadro hasta que está
dibujado (antes incluía la espera a la cámara).

### Modo teléfono

1. `python -m pose_twin live --source telefono` imprime una URL `https://<ip-del-PC>:8443/<token>/` y un QR
   (también en `data\telefono_qr.png`).
2. Ábrela en el teléfono, acepta la advertencia del certificado (es autofirmado, generado en tu PC) y pulsa
   "Iniciar cámara". El botón "Cámara" cambia entre frontal y trasera.
3. El teléfono envía cuadros JPEG de 480 px por WebSocket seguro; el PC devuelve puntos y ángulos y el
   teléfono los dibuja sobre su propio video. Los botones Grabar, Calibrar y Enderezar actúan en el PC.

Seguridad: escucha solo en la IP de la red local (no en todas las interfaces), la ruta exige un token
aleatorio nuevo en cada ejecución (sin token responde 404), acepta un teléfono a la vez y el certificado y
la clave quedan en `data\certs\` (fuera de git). Si Windows pregunta por el Firewall, permite solo
"Redes privadas".

## Cómo funciona

```
cuadro ─► [enderezado opcional] ─► BlazePose (detector ─► red de puntos) ─► 33 puntos 2D + 33 puntos 3D
                ▲                        │ seguimiento por recorte                     │
                └── torso del cuadro ◄───┘                                             ▼
                    anterior                         selección de persona ─► ángulos 3D ─► One-Euro ─► abstención
```

- **BlazePose** (MediaPipe Pose Landmarker) trabaja en dos etapas: un detector ligero encuentra a la
  persona y estima su centro, tamaño e inclinación; luego una red de puntos predice 33 puntos dentro de
  ese recorte. En video, el recorte del cuadro siguiente se calcula con los puntos del anterior, así que
  el detector solo corre cuando se pierde a la persona (Bazarevsky et al., 2020, arXiv:2006.10204).
- **BlazePose GHUM 3D**: además de los puntos en la imagen da 33 puntos "de mundo" en metros, con origen
  en el centro de las caderas, aprendidos con el modelo corporal GHUM (Grishchenko et al., 2022,
  arXiv:2206.11678). Los ángulos se calculan con esos puntos 3D, así no dependen tanto del punto de vista.
- **Ángulos**: codo (hombro-codo-muñeca), hombro (codo-hombro-cadera), cadera (hombro-cadera-rodilla) y
  rodilla (cadera-rodilla-tobillo). Se suavizan con el filtro One-Euro (Casiez, Roussel y Vogel, CHI 2012):
  suaviza mucho cuando la articulación está quieta y poco cuando se mueve rápido.
- **Abstención**: si alguno de los tres puntos de un ángulo tiene visibilidad menor que 0,6, ese ángulo no
  se muestra ni se registra. Mejor no dar un número que dar uno inventado.
- **Calidad**: media de visibilidad de 12 puntos del cuerpo y fracción sobre el umbral: buena, regular o baja.
- **Una sola persona**: el modelo busca hasta 3; la primera vez se fija la más grande, visible y centrada.
  Después se elige la candidata cuyo recuadro está más cerca del anterior (distancia de centros normalizada
  por su tamaño, desempate por solapamiento). Si nadie pasa esa compuerta durante 15 cuadros, se vuelve a fijar.
- **Enderezado**: gira la imagen según la inclinación del torso del cuadro anterior para que la persona
  quede de pie antes de inferir, y devuelve los puntos a las coordenadas originales con la transformación
  inversa (también los 3D, girándolos alrededor del eje de la cámara). Si se pierde a la persona prueba
  0/90/180/-90°. Viene apagado: en `docs/linea-base.md` MediaPipe ya resultó casi insensible a la rotación
  (su recorte se alinea con el torso) y el enderezado no lo mejoró en esa muestra; sí mejora mucho a
  RTMPose-m. Queda como opción para probar en posturas acostadas o cabeza abajo.
- **Perfil personal** (`c` o `calibrar`): durante unos segundos de pie y a cuerpo completo guarda, solo de
  cuadros con calidad buena, la mediana y la dispersión (MAD) del largo de cada segmento y su proporción
  respecto del torso, y la mediana y percentiles 5–95 de cada ángulo, en `data\perfiles\<nombre>.json`.
  En vivo se muestra la diferencia de cada ángulo frente a la postura de pie (`d+12`).
  **No es entrenamiento de ninguna red**: es una tabla de estadísticas sobre el modelo genérico.

### Calibración: rechazo por movimiento

La captura se rechaza, sin crear ni sobrescribir el perfil, si en los cuadros válidos:

| Articulaciones | Se rechaza si | Capturas reales quietas (3) | Captura con sentadillas (1) |
|---|---|---|---|
| Caderas y rodillas | p95 − p5 > 20° o MAD > 10° | p95 − p5 ≤ 7,9°; MAD ≤ 3,2° | p95 − p5 de 76 a 119°; MAD de 6 a 15° |
| Codos y hombros | MAD > 15° | MAD ≤ 9,5° (p95 − p5 hasta 37°, por eso no se mira el rango) | MAD hasta 16,7° |

Un ángulo visto en menos de 10 cuadros no se juzga. La pantalla dice qué ángulo se movió y qué hacer. Si la
captura va a menos de 15 cuadros por segundo se avisa (poca luz o equipo lento), sin bloquear. Son límites
técnicos ajustados con cuatro capturas de una sola persona, no umbrales clínicos. Un movimiento muy breve (menos
del 5 % de la captura) no se detecta. Los perfiles ya guardados no se revisan al cargarlos.

### Sentadilla de lado

> No validado, no es medición médica. Solo medidas; no hay juicios ni umbrales de salud.

1. Cámara quieta a 2 o 3 m, con luz de frente. Pulsa `s`.
2. Cuenta regresiva de 8 s: ponte **de lado**, de pie, cuerpo completo.
3. Quieto alrededor de un segundo: se toma el ángulo de rodilla de partida (al menos 140°).
4. Haz las sentadillas volviendo a quedar de pie. El contador avanza en pantalla.
5. Para terminar, quédate de pie 8 s o pulsa `s`. El resultado queda a la derecha y se guarda en
   `data\sentadillas\` (JSON y CSV, fuera de git). Con `video --sentadilla` la serie dura todo el archivo, sin
   cuenta regresiva.

| Medida por repetición | Cómo se calcula |
|---|---|
| Conteo (histéresis) | Empieza al flexionar la rodilla 30° o más desde el punto de partida; termina al volver a menos de 15° |
| Rodilla y cadera mínimas | Menor ángulo (180° = extendido), tras una mediana de 3 cuadros, del lado que se sigue |
| Bajada, fondo, subida (s) | Desde el último cuadro de pie hasta quedar a 5° del mínimo; tiempo allí; hasta volver arriba |
| Diferencia (izquierda − derecha) | Solo si ambos lados se ven en el 80 % de los cuadros; si no, `--` |
| Calidad | `buena`: rodilla vista ≥ 90 %, sin huecos > 0,3 s y ≥ 15 cuadros/s; `regular`: vista ≥ 70 %; si no, `baja` |

No se cuentan las repeticiones incompletas, las de menos de 0,5 s o más de 20 s, ni las que pierden la rodilla
más de 1 s. Resumen de la serie: n, media, desviación estándar muestral, mínimo y máximo.

Límites propios: el suavizado One-Euro y la baja tasa de cuadros pueden recortar el mínimo y mover los tiempos; no
se comprueba que la persona esté de lado; de lado, el lado oculto es estimado por el modelo aunque pase el umbral
de visibilidad, así que la diferencia entre lados es poco fiable; caminar justo antes de terminar puede contar como
repetición. No se ha comparado contra goniómetro ni probado con una persona de lado delante de la cámara.

## Validación

Protocolo para comparar los ángulos contra un goniómetro: [docs/validacion.md](docs/validacion.md).

## Límites

- Una sola cámara: la profundidad (eje z) es aproximada, inferida por la red, no medida.
- Los puntos 3D son relativos a las caderas y en escala de una persona promedio; no son medidas antropométricas.
- Oclusiones, ropa holgada, poca luz o el cuerpo fuera de cuadro bajan la calidad; por eso existe la abstención.
- Izquierda y derecha son las de la persona. De espaldas o de lado el modelo puede confundirlas.
- No validado clínicamente ni en microgravedad. No es un dispositivo médico.
- En este equipo (Windows 11, MediaPipe 1.2.3) el delegado GPU no está disponible y todo corre en CPU.
  Vía de GPU posible (no instalada): ONNX Runtime con DirectML o CUDA y RTMPose (ver `docs/fluidez.md`).
- Con poca luz la webcam limita a unos 10 FPS; los 30 FPS con persona se midieron con una cámara emulada
  a partir de un video, no con una persona real delante (ver `docs/fluidez.md`).

## Integración futura (no implementada)

Otro integrante trabaja profundidad y segmentación; puntos de unión previstos:

- **Profundidad**: MoGe-2 (geometría monocular con escala métrica, arXiv:2507.02546) o un sensor Kinect
  (profundidad medida). Uso previsto: dar escala real a los puntos 3D (hoy relativos) y corregir la
  profundidad de cada punto con el mapa de profundidad en su píxel. Entrada natural: `Pose.puntos2d`
  (píxeles en la imagen original) y `Pose.mundo` en `pose_twin/motor.py`.
- **Segmentación**: Mask2Former (arXiv:2112.01527). Uso previsto: máscara de la persona para filtrar
  puntos que caen fuera del cuerpo, separar personas cercanas en la selección y medir oclusiones.
  Entrada natural: `Seguidor.elegir` en `pose_twin/seleccion.py`.

## Estructura

```
pose_twin/
  geometria.py   ángulos, rotación ida y vuelta, torso, segmentos (puro, con pruebas)
  filtros.py     One-Euro
  seleccion.py   una persona y continuidad de identidad
  perfil.py      calidad, calibración y perfil personal
  motor.py       MediaPipe PoseLandmarker + enderezado
  sesion.py      procesador por cuadro, CSV, grabación
  dibujo.py      esqueleto, panel e instrucciones
  sentadilla.py  repeticiones, flexión máxima y tiempos de la sentadilla de lado
  fuente.py      cámara (con hilo de captura y opciones del driver), archivo, imagen, URL
  diagnostico.py tiempos por etapa y cierre por ausencia de persona
  telefono.py    servidor HTTPS + WebSocket (web/telefono.html)
  vivo.py        bucles live, video y calibrar
  bench.py       bench de rotación
docs/linea-base.md   resultados medidos del bench
docs/validacion.md   cómo validar los ángulos contra un goniómetro
docs/fluidez.md      diagnóstico de FPS y latencia en vivo
```

## Referencias

- Bazarevsky, V. et al. (2020). BlazePose: On-device Real-time Body Pose tracking. arXiv:2006.10204.
- Grishchenko, I. et al. (2022). BlazePose GHUM Holistic: Real-time 3D Human Landmarks and Pose Estimation. arXiv:2206.11678.
- Casiez, G., Roussel, N. y Vogel, D. (2012). 1€ Filter. CHI 2012. doi:10.1145/2207676.2208639.
- Jiang, T. et al. (2023). RTMPose: Real-Time Multi-Person Pose Estimation based on MMPose. arXiv:2303.07399.
- Wang, R. et al. (2025). MoGe-2. arXiv:2507.02546. Cheng, B. et al. (2022). Mask2Former. arXiv:2112.01527.
