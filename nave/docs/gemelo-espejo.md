# Gemelo 3D y Mirror me: estado y lo que falta

Para Richardson (@xSempiternus). Escrito el 27 de noviembre de 2026, al cerrar el trabajo de Nico con Claude en el gemelo.
Aquí está lo que hay, lo que está mal y el plan para dejarlo profesional. Lo más importante primero:

> **Mirror me no copia al 100 % lo que hace la persona frente a la cámara.** Falla por dos lados: la pose que se lee
> de la cámara es imprecisa (MediaPipe, 33 puntos, profundidad inventada) y el cuerpo 3D se deforma mal (un esqueleto
> armado a mano sobre una anatomía que nunca se hizo para moverse). Tu trabajo en `research/pose-twin` ataca el primer
> lado. El segundo se arregla cambiando el cuerpo por MHR (abajo).

## Qué es

`nave/tripulacion/ui/gemelo3d.mjs` (three.js) dibuja el cuerpo de cada astronauta con la anatomía de BodyParts3D
(2.234 estructuras: piel, huesos, órganos, músculos, vasos, nervios). Tiene tres modos de movimiento:

| Modo | Qué hace | Dónde |
|---|---|---|
| Trote | 13 segmentos con las curvas de carrera de Novacheck (1998) | `TROTE`, `poseTrote` (shader, `uModo = 0`) |
| Poses | 11 poses quietas (manos en la cintura, sentadilla, estocada, saludo…) que rotan solas | `POSES`, `puntosPose`, `galeriaPaso` |
| Mirror me | El gemelo copia a la persona que ven una o más cámaras | `prenderEspejo`, `actualizarEspejo`, `fusionar`, `posarEspejo`, `calzarACamara` |

Poses y Mirror me usan el mismo esqueleto de 51 huesos (`uS`, `uModo = 1`). Cada vértice de cada estructura va atado
a 3 huesos con pesos que se calculan al abrir el gemelo (`pesarModelo`).

### Cómo llega la pose de la cámara

1. **Teléfono:** `nave/tripulacion/ui/camara.html` + `camara.js`. MediaPipe Pose corre en el teléfono y manda
   `POST /v1/espejo/vista` con `{ cam, nombre, w }`, unas 20 veces por segundo. Cada punto de `w` es
   `[x, y, z, visibilidad, u, v]`: mundo de MediaPipe en metros, más dónde cae en la imagen (0–1, sin reflejar). El
   primer punto lleva además `[ancho, alto]` del video. Para abrirla, el botón «+ Add a phone camera» muestra un QR.
2. **Este computador:** la webcam local entra como una cámara más (`'local'`), con manos (21 puntos) y cara (478 puntos
   + 52 gestos).
3. **Servidor:** `nave/tripulacion/src-tauri/src/espejo.rs` reenvía cada vista por SSE (`/v1/espejo/flujo`) sin tocarla.
4. **Fusión:** `fusionar()` alinea cada cámara con la de referencia (Horn) y promedia cada punto, dándole menos peso a
   la profundidad.
5. **Pose:** `posarEspejo()` convierte los puntos en matrices de los 51 huesos.
6. **Encuadre (nuevo):** el gemelo se ve como lo ve la cámara de referencia: misma perspectiva y mismo cuadro. Si la
   cámara te ve hasta los hombros, el gemelo se ve hasta los hombros. Lo que la cámara no ve se desvanece. El botón
   «Framing» del panel de cámaras vuelve a la vista libre. Funciones: `fuenteEncuadre`, `lienzoCam`, `encuadrarEspejo`.

## Lo que está mal (medido)

### Deformación del cuerpo

El 27 de noviembre se arreglaron las fallas más grandes. Están contadas con un chequeo que compara piezas vecinas y
triángulos estirados en las poses:

| | Antes | Después |
|---|---|---|
| Puntos de piezas vecinas separados > 4 cm (16 poses) | 12.314 | 48 |
| Separación más grande | 73 cm | 7 cm |
| Triángulos de piel estirados, saludo / sentadilla / brazos arriba | 80 / 264 / 186 | 0 / 17 / 62 |

Arreglos que se hicieron:
- Láminas de piel bajo la axila: la piel de BodyParts3D es una sola superficie que en reposo une brazo y tronco.
- Hoyos al quitarlas.
- Venas atadas a la pelvis.
- Dientes que seguían al tórax.
- Partes que desaparecían por el recorte de cámara.
- La vista Anatomy no se movía.

Lo que queda, y no tiene arreglo con este método:
- **Brazos sobre la cabeza:** el pliegue de atrás de la axila se estira hasta 18 cm.
- **Venas del brazo:** la basílica y sus vecinas se estiran hasta 9 cm.
- **Tapas de la axila:** cerradas con abanicos, se notan de lado.
- **Codo muy doblado:** se pliega en seco, sin corrección de volumen.

**La causa de fondo:** son pesos calculados con reglas a mano sobre una malla que no se hizo para animar. Cada parche
arregla una zona y abre otra.

### Pose de la cámara

- MediaPipe da 33 puntos. La profundidad (`z`) es una estimación débil: una mano delante del cuerpo y una al costado se
  confunden.
- Con una sola cámara, lo que está tapado se inventa.
- Sin dedos ni giro de antebrazo confiables desde el teléfono (las manos solo se leen en la webcam local).
- No hay medida de exactitud contra una verdad: no sabemos cuántos grados se equivoca cada articulación. **Tu
  validación en `pose-twin` es justo lo que falta aquí.**

## El plan

### 1. Cambiar el cuerpo por MHR (arregla la deformación)

MHR (Momentum Human Rig, Meta, licencia Apache 2.0) es un cuerpo humano armado profesionalmente:
- esqueleto de 127 articulaciones, con dedos, columna, cara y articulaciones de giro de brazo y pierna;
- piel de 18.439 vértices, cada uno con 8 pesos;
- 117 formas de cuerpo;
- una red chica que predice 3.000 correcciones de pose. Esas correcciones son las que evitan los pliegues en
  hombros, codos y caderas.

Para descargarlo: `nave/vision/mhr/descargar.sh` (necesita `gh`). Datos útiles:
- **Medidas:** centímetros, Y hacia arriba, pose de reposo en T.
- **Evaluación:** el código de referencia en PyTorch está en `repo/mhr/_torch_rig.py` y `repo/mhr/_model.py`.
  - Parámetros del modelo (204) → parámetros de articulación con `parameter_transform` (889 × 321).
  - Cada articulación: traslación + Euler XYZ + escala, con su prerotación.
  - Piel: skinning lineal con `inverse_bind_pose`.
  - Correcciones: rotación 6D de 125 articulaciones (750) → capa dispersa (750 → 3.000) → ReLU → 3.000 formas de
    vértices.
- **Peso:** las correcciones pesan 663 MB en denso. Hay que reducirlas (cada forma toca pocos vértices) para el
  navegador.

Fases:
1. **MHR en el navegador:** un exportador en Python a un binario compacto, y la evaluación en three.js. Comprobar
   punto por punto contra `_torch_rig.py`.
2. **Calzar MHR con BodyParts3D:** optimizar forma, escala y pose de MHR para que su piel coincida con la del modelo
   anatómico en reposo, y medir el error que quede.
3. **Que la anatomía siga a MHR:**
   - cada vértice de cada estructura toma los pesos del punto más cercano de la piel de MHR, y se lleva a la pose T
     de MHR una sola vez, al exportar;
   - los huesos van rígidos con su articulación;
   - la piel visible pasa a ser la de MHR.
4. **Poses y trote:** pasarlos a parámetros de MHR, con correcciones.
5. **Mirror me con MHR:** la pose de la cámara va a las 127 articulaciones (con MediaPipe por puntería de huesos, o
   directo desde SAM 3D Body, abajo).
6. **Revisión completa:** chequeo automático en todas las poses y posturas extremas, capturas de frente, lado y
   espalda, y fluidez medida.

### 2. Mejor visión (tu parte)

- **SAM 3D Body** (Meta, CVPR 2026) estima el cuerpo completo en 3D desde una imagen, directamente en parámetros de
  MHR. Ve profundidad real, partes tapadas, manos y pies.
  - Servidor listo en `nave/vision/sam3d/servidor.py` (FastAPI, `127.0.0.1:8793`, `POST /cuadro` con un JPEG), pero
    todavía no está conectado al gemelo.
  - Los pesos están cerrados: hay que pedir acceso en <https://huggingface.co/facebook/sam-3d-body-dinov3>. Nico ya
    lo pidió y está pendiente.
  - Instalación: `nave/vision/sam3d/instalar.sh`.
  - Hay que medir si alcanza tiempo real en un Mac (MPS). Si no alcanza, MediaPipe da la pose rápida y SAM la
    corrige cuando puede.
- **`research/pose-twin`:**
  - Los ángulos, la calibración por persona, el rechazo de movimiento y sobre todo la validación son lo que el
    espejo necesita para dejar de adivinar.
  - Idea concreta: correr tu validación contra lo que dibuja el gemelo (los ángulos de sus articulaciones) y no solo
    contra MediaPipe. Así sabemos cuántos grados se equivoca el espejo en cada articulación.

## Cómo correrlo y probarlo

- **NOVA:** `cd nave/tripulacion && npm run dev` (con ventana) o `npm run enlace` (solo el servidor). La interfaz queda en
  `http://127.0.0.1:8750` y se lee del disco: recargar la página basta para ver cambios en `ui/`.
- **Gemelo:** en la consola del navegador, `abrirGemelo(0)`, o desde el menú.
- **Teléfono:** «Mirror me» → «+ Add a phone camera» → escanear el QR (https, aceptar el certificado de la nave).
- **Simular un teléfono sin cámara:** `node nave/tripulacion/pruebas/espejo/telefono.cjs`. Necesita `playwright-core`
  y Chrome. Proyecta una pose de prueba a 3,2 m y de cerca, la manda a la nave y guarda capturas.
- **Mirar la deformación:**
  - pintar la piel opaca con un color por cadena de huesos (MeshLambert + `conEsqueleto`), de frente, lado y
    espalda;
  - contar triángulos cuyo lado posado mide más de 3 veces el de reposo.

  Con eso se encontraron las láminas de la axila, que el chequeo de piezas vecinas no veía.
