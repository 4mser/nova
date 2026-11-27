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

# Perfil personal sin ventana (también se crea en vivo con la tecla c)
python -m pose_twin calibrar --source data\muestras\sentadilla.webm --nombre prueba --segundos 2
python -m pose_twin live --source 0 --perfil prueba

# Bench de rotación (escribe docs\linea-base.md)
python -m pose_twin bench

# Pruebas
python -m pytest -q
```

Teclas en la ventana: `q`/`Esc` salir, `g` grabar o detener mp4 anotado (en `data\grabaciones\`),
`c` calibrar el perfil, `e` activar o desactivar el enderezado.
Opciones útiles: `--modelo full|heavy` (heavy por defecto), `--enderezar`, `--umbral-vis 0.6`, `--delegado cpu`.

Cada sesión en vivo guarda un CSV en `data\sesiones\` (tiempo, FPS, latencia, calidad, rotación y los
8 ángulos; celda vacía cuando hay abstención).

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

## Límites

- Una sola cámara: la profundidad (eje z) es aproximada, inferida por la red, no medida.
- Los puntos 3D son relativos a las caderas y en escala de una persona promedio; no son medidas antropométricas.
- Oclusiones, ropa holgada, poca luz o el cuerpo fuera de cuadro bajan la calidad; por eso existe la abstención.
- Izquierda y derecha son las de la persona. De espaldas o de lado el modelo puede confundirlas.
- No validado clínicamente ni en microgravedad. No es un dispositivo médico.
- En este equipo (Windows 11, MediaPipe 1.2.3) el delegado GPU no está disponible y todo corre en CPU.

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
  dibujo.py      esqueleto y panel
  fuente.py      cámara, archivo, imagen, URL
  telefono.py    servidor HTTPS + WebSocket (web/telefono.html)
  vivo.py        bucles live, video y calibrar
  bench.py       bench de rotación
docs/linea-base.md   resultados medidos del bench
```

## Referencias

- Bazarevsky, V. et al. (2020). BlazePose: On-device Real-time Body Pose tracking. arXiv:2006.10204.
- Grishchenko, I. et al. (2022). BlazePose GHUM Holistic: Real-time 3D Human Landmarks and Pose Estimation. arXiv:2206.11678.
- Casiez, G., Roussel, N. y Vogel, D. (2012). 1€ Filter. CHI 2012. doi:10.1145/2207676.2208639.
- Jiang, T. et al. (2023). RTMPose: Real-Time Multi-Person Pose Estimation based on MMPose. arXiv:2303.07399.
- Wang, R. et al. (2025). MoGe-2. arXiv:2507.02546. Cheng, B. et al. (2022). Mask2Former. arXiv:2112.01527.
