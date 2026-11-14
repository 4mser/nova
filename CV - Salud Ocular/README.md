# CV - Salud Ocular

**Área:** visión artificial · **Responsable:** Nicolás Richardson · **Rama:** `computer-vision-ocular`

Salud ocular de NOVA con computer vision pura (sin soft sensors), pensada para integrarse al escáner RA del teléfono
(`nave/tripulacion/ui/escaner.js`) y al puente de visión de la nave (`nave/vision/`, `/v1/vision/ws`, puerto 8792).
La cámara mira la cara, mide parpadeo, párpado inferior y distancia a la pantalla, lo compara con la línea base de cada
persona y emite una **alerta de seguimiento**. NOVA no diagnostica ni nombra «SANS».

## Estado
Solo diseño y una medición del instrumento (spike). **No hay código integrado a la nave ni a la app todavía.**
Todo está medido con una persona, una webcam de 640×480 y buena luz; no hay validación en astronautas.

## Contenido
| Ruta | Qué es |
|---|---|
| `docs/nova-vision-ocular.pdf` · `.html` | Diseño visual: arquitectura, guía de pruebas, resultados, plan |
| `docs/plan.md` | Plan por fases, con lo hecho y lo pendiente |
| `docs/soft-sensors-antecedentes.md` | Antecedentes con fuentes primarias y marcas [V] verificado, [P] parcial, [NV] no verificado, [INF] inferencia |
| `docs/spike-resultados.md` | Resultados de las mediciones con webcam |
| `scripts/spike_*.py` | Spike: mide MediaPipe Face Landmarker (barrido de condiciones, suelo de ruido, diagnóstico de quietud, vista en vivo) |
| `tests/` | Pruebas automáticas (80) |
| `src/vision/` | Reservado para el módulo (fase 1) |
| `data/` | Sesiones propias con consentimiento; no se versiona su contenido |

## Cómo correr el spike (Windows, PowerShell, desde esta carpeta)
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# el modelo (3,76 MB, no se versiona) va en models/face_landmarker.task:
mkdir models
Invoke-WebRequest https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task -OutFile models\face_landmarker.task
python -m pytest tests -q
python scripts\spike_face_landmarker.py --smoke          # sin cámara
python scripts\spike_face_landmarker.py --gate-diagnose --facing front   # con webcam
```
La guía de qué hacer en cada prueba está en `docs/nova-vision-ocular.pdf`.
Para regenerar el PDF: `bash scripts/build_pdf.sh` (necesita Chrome).

## Privacidad
No se guardan imágenes ni video. Los puntos de la cara son datos biométricos y solo se guardan con `--save-landmarks`
(en `data/`, que no se versiona).

## Reglas (de NOVA)
Sin evidencia no hay afirmación. No es dispositivo médico. Español neutro. Sin secretos en git.
Modelo: MediaPipe Face Landmarker (Apache 2.0), ficha técnica en la sección 12 de los antecedentes.
