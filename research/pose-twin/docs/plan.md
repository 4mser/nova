# Plan: seguimiento corporal en vivo y modelo corporal (fase Tierra)

Rama `pose-estimation-irl`. Primera medida: ángulos articulares. Entrada: webcam y teléfono.

### Tarea 1: línea base en vivo con MediaPipe (webcam, video, ángulos, abstención, grabación)

### Tarea 2: teléfono como cámara por la red local (HTTPS con token)

### Tarea 3: calibración personal (proporciones y rangos propios)

### Tarea 4: comparación con rotación 0 a 360 grados (MediaPipe y RTMPose)

### Tarea 5: QA en vivo, video de demostración, push de la rama y PR

### Tarea 6: modelo corporal en 3D con repetibilidad medida (fase siguiente)

### Tarea 7: integrar profundidad y segmentación (MoGe-2, Kinect, Mask2Former) (fase siguiente)

## Actualización: mezcla con la anatomía 3D de NOVA

### Tarea 8: medir y mejorar fluidez y retraso (meta: 25 cuadros por segundo y menos de 60 ms)

### Tarea 9: enviar puntos, ángulos y calibración desde pose-twin por WebSocket local

### Tarea 10: visor 3D con la anatomía de NOVA que se mueve con la persona (brazos y piernas primero)

### Tarea 11: ajustar el cuerpo 3D a las proporciones de la calibración

### Tarea 12: validar ángulos contra una referencia (goniómetro) y repetir poses

### Tarea 13: ajustar el plan con el tríptico que enviará el equipo
