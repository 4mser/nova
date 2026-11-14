# Plan de trabajo: salud ocular en NOVA con computer vision

Actualizado: 14 nov 2026. Marca cada ítem al avanzar. Estado: `[x]` hecho, `[~]` en curso, `[ ]` pendiente.

## Objetivo
Integrar salud ocular al escáner AR de NOVA usando **solo computer vision** (sin soft sensors). El teléfono mira la cara, mide parpadeo, párpado inferior y distancia, compara con la línea base de cada persona y emite una **alerta de seguimiento**, nunca un diagnóstico ni "SANS". Todo a bordo, sin internet.

## Decisiones tomadas
- Solo teléfono y webcam. Instrumentos de la misión (OCT, fondo de ojo, tonómetro) entran como dato opcional por el contrato de la estación médica.
- Cámara conmutable: frontal (autochequeo) y trasera (otra persona escanea). Línea base por cámara.
- Agudeza y rejilla de Amsler se incluyen, asistidas por la cámara (Amsler exploratoria).
- Pupila: diferida. A 512 px el iris mide ~17 px y la pupila ~3 a 6 px; hace falta una imagen mayor.
- El ojo es un sistema más del holograma del escáner AR.
- Modos autónomo y supervisado. El umbral de alerta de agudeza lo define Niko.
- Modelo: MediaPipe Face Landmarker. El módulo corre dentro del puente `/v1/vision/ws`.
- Todo dato científico con fuente primaria; lo no verificado [NV] no se cita.
- Por ahora no se toca el pitch.

## Fases

### Fase 0 · Spike (rama `nico/vision-spike`)
- [x] Investigación y antecedentes verificados (`docs/soft-sensors-antecedentes.md`)
- [x] Repo `hackaton-vision` en GitHub (privado), página de diseño publicada
- [x] Spike v1 con webcam: 478 puntos, iris presente, 90/90 detecciones, 7,76 ms
- [x] Prueba a 512 px con JPEG: detección 100 %, iris 17 px
- [x] Documentación del modelo (sección 12)
- [x] Spike v2 programado (diseño de `cv-arquitecto`, código de `impl-python`): 22 pruebas automáticas y prueba de humo pasan; falta correrlo con webcam
- [x] Correr `--check --sweep` con tu webcam: detección e iris al 100 % en 31 condiciones; el gate de quietud aprobó 0 % (hay que arreglarlo)
- [x] Gate de quietud corregido y diagnosticado: con la persona quieta pasa el 100 % de las ventanas (matriz de orientación en el 100 % de los cuadros)
- [x] Interfaz en vivo con espera de quietud: probada en la webcam (100 % de quietud quieto, 37 % moviéndose)
- [x] Reintento automático si te mueves (probado con simulaciones)
- [x] Barrido repetido con el gate corregido: aceptación cumplida (quietud 84,6 %, MDC de A ~0,33 mm [INF])
- [~] Suelo de ruido, 3 sesiones
- [ ] Correr el suelo de ruido: 3 bloques de 20 s, en 3 sesiones con reposicionamiento
- [ ] Anotar resultados y el cambio mínimo detectable en los docs

### Fase 1 · Base (`nico/vision-base`) · agente `impl-python`
- [ ] Módulo de landmarks con registro de cámara, espejo y resolución
- [ ] Puerta de calidad (luz, nitidez, pose, oclusión); se abstiene si la imagen es mala
- [ ] Línea base personal por persona y por cámara (mediana y MAD, mínimo 7 días válidos)
- [ ] Contrato de salida en `docs/contrato.md` (valor, calidad, incertidumbre, estado, fuente, versión)
- [ ] Demo con webcam y botón de voltear cámara

### Fase 2 · Mediciones, en paralelo (agentes `impl-python`)
- [ ] 2a `nico/vision-parpadeo-periocular`: parpadeo, PERCLOS, apertura del párpado y MRD2 como cambio contra la línea base
- [ ] 2b `nico/vision-distancia`: distancia por iris y fijación para agudeza y Amsler
- [ ] Pupila: diferida hasta tener imagen mayor o procesamiento en el teléfono

### Fase 3 · Cierre
- [ ] QA con webcam real (agente `qa`): lentes, poca luz, ojos marrones, cabeza inclinada, otra persona
- [ ] Especificación de entrega para quien mantiene `nova-pc`: puente `/v1/vision/ws`, overlay AR y el ojo como sistema del holograma
- [ ] Revisión por oftalmología y cirujano de vuelo

## Depende de otras personas o de datos que faltan
- [ ] FPS real del escáner. Con menos de ~15 fps, parpadeo y PERCLOS no son viables por esa ruta.
- [ ] Calidad JPEG real del escáner y si el teléfono recorta la imagen antes de enviarla.
- [ ] Qué cámara usa el escáner hoy.
- [ ] Si las 689 estructuras anatómicas incluyen el ojo (BodyParts3D lo trae; retina y nervio óptico no).
- [ ] Cambio mínimo clínicamente relevante: literatura o cirujano de vuelo.
- [ ] Umbral de alerta de agudeza (Niko).
- [ ] Protocolo de lesión ocular: no existe entre los 12; candidato a sumar.
- [ ] Licencia de BodyParts3D: el PDF dice CC BY 4.0 y su README dice CC BY-SA 2.1 Japón.

## Pendientes de orden
- [ ] Borrar el repo de GitHub `aura-modelos` (`gh auth refresh -h github.com -s delete_repo`, o Settings en la web)
- [ ] Borrar las copias duplicadas de `Antecedentes/` y editar solo en `hackaton-vision/docs/`
- [ ] Revisar la carpeta `NASA-datos-salud/` que apareció en el proyecto

## Quién hace qué
| Tarea | Agente | Modelo |
|---|---|---|
| Decisiones de visión y metodología | `cv-arquitecto` | el más capaz |
| Implementación de módulos | `impl-python` | gama media |
| Investigación con fuentes | `investigador` | gama media |
| Verificar con webcam real | `qa` | gama media |
| Si un modelo falla dos veces | subir un nivel | |

## Reglas
- Sin evidencia no hay afirmación. NOVA no es dispositivo médico ni diagnostica.
- Imágenes nunca se guardan. Los landmarks crudos son datos biométricos y solo se guardan con una bandera explícita.
- Commits sin atribución de IA. Ramas `nico/<tema>`.
