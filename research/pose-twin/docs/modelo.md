# El modelo que usamos: MediaPipe Pose (BlazePose GHUM)

Leído el 26 nov 2026 sobre el texto de los PDF originales.

| Sigla | Fuente | Páginas |
|---|---|---|
| [B] | Bazarevsky et al., *BlazePose*, taller CVPR de AR/VR 2020. https://arxiv.org/abs/2006.10204 | 4 |
| [H] | Grishchenko et al., *BlazePose GHUM Holistic*, 2022. https://arxiv.org/abs/2206.11678 | 5 |
| [M] | Ficha del modelo *BlazePose GHUM 3D*, 16 abr 2021. https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf | 8 |

No leído: Xu et al., *GHUM & GHUML*, CVPR 2020 (el sitio respondió 403).

## 1. Flujo en cada cuadro

1. **Detector** [B §2.2]: se apoya en la cara (se asume cabeza visible). Predice el punto medio de las caderas, el tamaño del círculo que encierra a la persona y la inclinación del torso.
2. **Recorte alineado** [B §2.6]: caderas al centro y línea caderas-hombros vertical. Entrada de 256x256 píxeles [M p.2].
3. **Red de puntos** [B §2.1 y §2.5]: entrega 33 puntos, si hay persona y la región del cuadro siguiente. Red convolucional tipo MobileNetV2 [M p.2].
4. **Seguimiento** [B §2.1]: el detector solo vuelve a correr cuando la red indica que no hay persona.

Salida por punto: x, y, z, visibilidad y presencia [M p.2].

## 2. La red

- Combina mapas de calor, desplazamientos y regresión directa de coordenadas. Los dos primeros solo se usan al entrenar y se eliminan al usar el modelo [B §2.5].
- El gradiente de la regresión no vuelve a la parte de mapas de calor [B §2.5].
- Tamaños [B §3]: Full 6,9 MFlop y 3,5 M de parámetros; Lite 2,7 MFlop y 1,3 M.
- Archivos [M p.2]: Lite 3 MB, Full 6 MB, Heavy 26 MB.

## 3. Entrenamiento

- 60 000 imágenes de poses comunes y 25 000 de ejercicio, anotadas por personas [B §2.4]. La ficha menciona 30 000 imágenes con consentimiento de una aplicación móvil de realidad aumentada [M p.3].
- Aumentos: 10 % de escala y desplazamiento, y rectángulos que simulan oclusiones [B §2.6]. Los rangos de ángulo se limitan a propósito [B §2.6].
- La ficha declara tolerancia de ±10 grados de giro en la entrada [M p.2] y de 8 grados en otra sección [M p.4].

## 4. El 3D

- La verdad de referencia 3D **no se midió**: se ajustó el modelo de cuerpo GHUM a anotaciones 2D, con siluetas y orden de profundidad entre segmentos [H §2].
- El orden de profundidad anotado bajó los errores de orden de 25 % a 3 % [H §2].
- Coordenadas métricas con origen en el centro de las caderas [H §2].
- La ficha advierte que **z no es métrica, solo a escala** [M p.2 y p.3].

## 5. Resultados publicados

Frente a OpenPose, con datos propios de 1 000 imágenes por conjunto. PCK@0.2: punto correcto si el error es menor que el 20 % del tamaño del torso. Referencia humana: 97,2 [B §3, tabla 1].

| Modelo | Cuadros/s | AR | Yoga |
|---|---|---|---|
| OpenPose (PC de 20 núcleos) | 0,4 | 87,8 | 83,4 |
| BlazePose Full (Pixel 2, CPU) | 10 | 84,1 | 84,5 |
| BlazePose Lite (Pixel 2, CPU) | 31 | 79,6 | 77,6 |

Yoga, una persona a 2-4 m, 17 puntos [H tabla 1].

| Modelo | 2D mAP (más es mejor) | Error 3D medio, mm |
|---|---|---|
| Heavy | 68,1 | 36 |
| Full | 62,6 | 39 |
| Lite | 45,0 | 45 |
| AlphaPose ResNet50 | 63,4 | no aplica |
| Apple Vision | 32,8 | no aplica |

Milisegundos por cuadro [H tabla 2]:

| Equipo | Lite | Full | Heavy |
|---|---|---|---|
| Navegador (MacBook Pro 2017) | 13 | 15 | 29 |
| Pixel 4, CPU | 25 | 40 | 147 |
| Pixel 4, GPU | 8 | 9 | 22 |
| PC (i9-10900K, GTX 1070) | 7 | 8 | 10 |

Equidad, 1 400 fotos de cámara trasera en 14 regiones [M p.5-7]: acierto medio 87,0 (Lite), 91,8 (Full) y 94,2 (Heavy). Brecha máxima por tono de piel: 7,3 / 7,0 / 5,7 puntos.

## 6. Límites declarados [M p.2-4]

- Una sola persona. Fuera de alcance: varias personas, más de 4 m, cabeza no visible.
- Fuera de alcance: profundidad métrica precisa, vigilancia y reconocimiento de identidad.
- No está pensado para decisiones críticas para la vida; el uso principal declarado es entretenimiento.
- Sensible a posición de la cara, escala y orientación. Empeora con poca luz, ruido y movimiento.
- Medir ángulos y distancias 3D figura entre los usos previstos.
- Licencia Apache 2.0.

## 7. Consecuencias para nosotros (inferencias propias)

- Enderezar la imagen tiene sentido: la red se entrenó con el cuerpo casi vertical.
- Los ángulos 3D son estimaciones; hay que validarlos contra una referencia.
- La calibración personal no debe usarse para identificar personas.
- Los 36-45 mm son en yoga y contra ajustes de GHUM: no son nuestro error con webcam.
- La ficha es de 2021; no está verificado que los archivos `.task` actuales correspondan a esa versión.
