# Demo: persona y esqueleto 3D

> Estimación no validada, no es medición médica. La profundidad es aproximada.

Todo se genera en este equipo. Los videos quedan en `data\`, que está fuera de git: no los subas.

## Pasos (PowerShell, desde `research\pose-twin`)

```powershell
.venv\Scripts\python.exe -m pose_twin.demo grabar --source 0 --segundos 30
.venv\Scripts\python.exe -m pose_twin.demo generar
# opcional: escáner de NOVA (anatomía 3D) sobre la misma grabación
.venv\Scripts\python.exe escaner\demo\capturar.py
```

`generar` y `capturar.py` usan la última grabación `data\grabaciones\demo_*.mp4`; con `--in ARCHIVO` se elige otra.
Las grabaciones de la sesión en vivo (`grabacion_*.mp4`) llevan anotaciones y no se toman por defecto.

## Grabar

La ventana dice qué hacer en cada paso. La vista previa se ve en espejo (`--sin-espejo` la quita); el video
guardado nunca se refleja ni lleva anotaciones.

| Paso | Duración (con 30 s) |
|---|---|
| Colocarse de cuerpo completo (Espacio lo adelanta, `--preparacion`) | 10 s, no se graba |
| Cuenta regresiva | 5 s, no se graba |
| De frente y quieto | 6 s |
| Levantar los brazos | 7,5 s |
| Girar de lado | 6 s |
| 3 sentadillas | 10,5 s |

`q`, `Esc` o cerrar la ventana cancela y borra lo grabado. Al terminar se cierra sola, libera la cámara e imprime
el comando siguiente. Si la cámara entrega pocos cuadros (poca luz), se repiten cuadros para que el video dure lo
mismo que la toma; con más luz o `--exposicion -5` se ve más fluido.

## Video generado (`data\salidas\<grabacion>_3d.mp4`, 1280x720)

- Izquierda: el video con puntos y líneas. Derecha: los 33 puntos "mundo" de BlazePose GHUM (modelo `heavy`,
  todos los cuadros), proyectados con OpenCV; la vista oscila entre -60 y +60 grados y empieza como la cámara.
- Celeste = izquierda de la persona; naranja = derecha.
- Visibilidad desde 0,6: trazo firme. De 0,3 a 0,6: tenue. Menor que 0,3: oculto. Un ángulo con algún punto
  bajo 0,6 muestra `--`.
- Es H.264 si hay `ffmpeg` en el PATH; si no, mp4v.

## Escáner (opcional, `<grabacion>_escaner.mp4`, 1280x776)

`capturar.py` abre Chrome o Edge sin ventana, con perfil temporal, la grabación como cámara falsa (nunca la real)
y la red externa bloqueada, y captura la copia del escáner con solo la capa de huesos. Para esta toma sube la
opacidad del hueso (0,28 a 0,85) y reemplaza los nombres de la tripulación por "Demo". La atribución
BodyParts3D y HuBMAP, CC BY 4.0, va en una franja inferior. Los temporales se borran al terminar.

## Límites

- Una sola cámara: la profundidad la infiere la red, no se mide.
- Los puntos 3D tienen origen en las caderas: no hay desplazamiento por la sala, y el suelo supone que el pie
  visible más bajo está apoyado (un salto no se vería).
- Puntos y ángulos se suavizan con el filtro One-Euro.
- De lado, el lado oculto lo estima el modelo aunque supere el umbral.
- El esqueleto anatómico del escáner es genérico, no es el cuerpo de la persona; su video no está sincronizado
  cuadro a cuadro con el original (la cámara falsa se reproduce en bucle y empieza en otro instante) y recorta
  los bordes de la imagen para llenar la pantalla.
