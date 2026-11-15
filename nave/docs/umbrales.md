# Umbrales de partida del monitor de salud

Son parámetros de F Prime (`vuelo/Nova/Components/MonitorSalud/MonitorSalud.fpp`): la actualización nocturna desde la
Tierra los puede cambiar sin recompilar. Dos niveles por indicador: **atención** (lo resuelve la tripulación) y
**aviso a Tierra** (avisar al cirujano de vuelo).

Estado: valores de partida para el prototipo. Cada fila tiene que quedar con su fuente verificada antes de la entrega,
y una versión real la valida un médico.

| Indicador | Atención | Aviso a Tierra | Base | Verificado |
|---|---|---|---|---|
| Pulso (lpm) | ≥110 o ≤45 | ≥140 o ≤35 | Taquicardia >100 y bradicardia <50 en adultos; margen para tripulación entrenada | pendiente |
| SpO₂ (%) | <94 | <90 | Hipoxemia bajo 90 % | pendiente |
| Presión sistólica (mmHg) | ≥140 o ≤90 | ≥180 o ≤80 | Hipertensión etapa 2 (ACC/AHA 2017) y crisis ≥180; hipotensión <90 | pendiente |
| Presión diastólica (mmHg) | ≥90 | ≥120 | ACC/AHA 2017 | pendiente |
| Temperatura (°C) | ≥38,0 o ≤35,5 | ≥39,5 o ≤35,0 | Fiebre ≥38; hipotermia <35 | pendiente |
| Frecuencia respiratoria (rpm) | ≥24 o ≤10 | ≥30 o ≤8 | Rangos de alerta temprana clínica | pendiente |
| Glucosa (mg/dL) | <70 o ≥180 | <54 o ≥250 | Hipoglucemia nivel 1 (<70) y nivel 2 (<54) de la ADA | pendiente |
| CO₂ de cabina (ppm) | ≥2600 | ≥5000 | NASA-STD-3001 vol. 2 (límites de CO₂ de cabina) | pendiente: confirmar cifras vigentes |

Pendiente:
- **Rangos de vuelo** (OSDR / SOMA): marcar `ESPERADO_VUELO` cuando el cambio está dentro de lo esperado por la microgravedad.
- **VFC:** se compara con la línea base de cada persona, no con un umbral fijo.
- **Tendencias:** detectar subidas sostenidas (p. ej. pulso en reposo +10 lpm en 3 días), no solo cruces de umbral.
