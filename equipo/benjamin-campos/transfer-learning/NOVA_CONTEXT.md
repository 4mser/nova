# NOVA — Contexto del proyecto (NASA Space Apps, Health Monitoring de astronautas)

> Este archivo es contexto para Claude. Léelo completo antes de proponer código o arquitectura.
> Estamos en un hackathon: prioriza lo que se pueda demostrar funcionando por sobre lo perfecto.

## 1. Problema

Monitorear la salud de astronautas en el espacio y anticipar problemas antes de que ocurran.
El obstáculo: casi no hay datos fisiológicos de humanos en el espacio (pocos astronautas, pocas
misiones, datos restringidos). No alcanza para entrenar un modelo desde cero.

## 2. Idea central

Aprender en la Tierra, adaptar en el espacio.

1. **Fase Tierra (big data):** entrenamos un modelo grande con muchos datos fisiológicos
   terrestres para que aprenda cómo se comporta el cuerpo humano, y además una línea base
   personal de cada astronauta (sus meses de entrenamiento previo al vuelo).
2. **Fase espacio (small data):** en microgravedad las variables cambian (el modelo terrestre
   deja de calzar). Tomamos los pocos datos que se van recolectando en vuelo y hacemos
   transfer learning / fine-tuning sobre un modelo pequeño que aprende la "nueva normalidad"
   de ese astronauta en el espacio.
3. **Salida:** predicciones de signos vitales, detección de anomalías (real vs. predicho) y
   correlación con variables físicas del entorno (radiación, CO2, etc.).

```
TIERRA                                              ESPACIO
Big data ──► Modelo de forecasting ──► Predicciones
   │                 │
   │                 │ transfer learning (pesos congelados)
   │                 ▼
Small data ──► Modelo pequeño adaptado ──► fine-tuning ──► Predicciones en microgravedad
(en vuelo)                                                   │
                                                             ▼
                              Real vs. predicho ──► anomalías ──► explicación (LLM)
Variables físicas (radiación, cabina) ──► covariables + correlación
```

## 3. Decisiones de diseño (importantes)

- **El forecasting lo hace un modelo de series de tiempo, no el LLM.** El LLM se usa como capa
  de explicación: recibe predicciones, anomalías y contexto, y redacta el reporte para la
  tripulación o el médico de vuelo. No inventa números.
- **"Big data por astronauta" no existe en la práctica.** El pre-entrenamiento usa datos de
  población general; la línea base individual se suma como una segunda capa (personalización).
- **Con pocos datos no se re-entrena todo.** Se congela el modelo base y se entrena algo
  pequeño encima (ver sección 6).
- **En una misión real el modelo debe correr a bordo** (el retardo de comunicación con Marte
  hace inviable depender de la Tierra). Para el MVP corremos todo en un notebook/laptop.

## 4. Qué cambia en microgravedad (el "domain shift")

Efectos conocidos que el modelo adaptado debe capturar. Usar como guía cualitativa y verificar
magnitudes en la literatura antes de citarlas en la presentación:

| Sistema | Efecto esperado |
|---|---|
| Cardiovascular | Desplazamiento de fluidos hacia la cabeza, cambios en frecuencia cardíaca, presión arterial y variabilidad cardíaca (HRV) |
| Sueño / circadiano | Menos horas de sueño, ritmo circadiano alterado (16 amaneceres al día en la ISS) |
| Temperatura | Temperatura corporal central tiende a subir en misiones largas |
| Músculo y hueso | Pérdida progresiva de masa ósea y muscular (lenta, escala de semanas a meses) |
| Respiratorio | CO2 de cabina más alto que en la Tierra, asociado a dolores de cabeza |
| Radiación | Dosis acumulada mucho mayor que en la Tierra; picos por eventos solares |

## 5. Datos a rescatar

### 5.1 Variables fisiológicas (lo que predecimos)

Prioridad MVP (series continuas, fáciles de conseguir):

- Frecuencia cardíaca (HR)
- Variabilidad cardíaca (HRV: RMSSD, SDNN)
- Saturación de oxígeno (SpO2)
- Frecuencia respiratoria
- Temperatura de piel / corporal
- Actividad (acelerómetro) y sueño (duración, etapas)

Segunda prioridad: presión arterial, ECG crudo, peso/masa, marcadores de estrés.

### 5.2 Variables físicas del entorno (covariables)

- **Radiación ionizante:** dosis absorbida (mGy), dosis equivalente (mSv), flujo de protones
  por canal de energía (MeV), neutrones, gamma. Separar fondo constante (rayos cósmicos
  galácticos) de picos (eventos de partículas solares).
- **Cabina:** CO2, temperatura, humedad, presión.

### 5.3 Variables globales / de contexto

- Día de misión, fase (pre-vuelo, vuelo, post-vuelo)
- Agenda: ejercicio, caminata espacial (EVA), turnos de sueño
- Datos del astronauta: edad, sexo, línea base pre-vuelo

### 5.4 Fuentes de datos (verificar acceso y licencia de cada una)

**Tierra (big data):**
- PhysioNet: PTB-XL (ECG), MIMIC waveform, WESAD (wearable + estrés), PPG-DaLiA, MMASH
  (HR 24 h + sueño + actividad), Sleep-EDF
- Datasets abiertos de wearables (Fitbit / Apple Watch en Kaggle)

**Espacio y análogos (small data):**
- NASA Open Science Data Repository (OSDR / GeneLab)
- NASA Life Sciences Data Archive (LSDA)
- Inspiration4 / SOMA (Space Omics and Medical Atlas)
- Estudios de reposo en cama con cabeza inclinada (bed rest), el análogo terrestre estándar
  de microgravedad

**Radiación y clima espacial:**
- NOAA SWPC (flujo de protones GOES)
- NASA OMNIWeb
- Dosimetría de la ISS (instrumentos RAD, DOSIS 3D)

**Plan B si no conseguimos datos de vuelo a tiempo:** simular el domain shift. Tomar un dataset
terrestre, separar un sujeto, y aplicarle transformaciones basadas en la tabla de la sección 4
(desplazar la media de HR, reducir HRV, acortar el sueño, sumar ruido, inyectar anomalías).
Declararlo abiertamente en la presentación como "datos sintéticos de microgravedad".

## 6. Modelos

### 6.1 Modelo base (Tierra)

| Opción | Cuándo usarla |
|---|---|
| Modelo fundacional de series de tiempo pre-entrenado (Chronos, TimesFM, Moirai, MOMENT) | Opción recomendada: ya viene entrenado, funciona zero-shot y admite fine-tuning |
| PatchTST / N-BEATS / GRU entrenado por nosotros en datos PhysioNet | Si queremos mostrar el pre-entrenamiento propio |
| LightGBM con lags + seasonal naive | Baseline obligatorio para comparar |

### 6.2 Adaptación al espacio (el corazón del proyecto)

De más simple a más complejo. Implementar en este orden:

1. **Modelo residual (recomendado para el MVP):** el modelo base predice; un modelo pequeño
   (regresión ridge o MLP chico) aprende la diferencia entre esa predicción y lo observado en
   el espacio, usando como entrada día de misión y covariables físicas.
   `predicción_espacio = modelo_tierra(x) + corrector(x, día_misión, radiación, CO2)`
   Funciona con muy pocos datos y es explicable.
2. **Fine-tuning de la última capa** con el backbone congelado.
3. **LoRA / adapters** sobre el modelo fundacional.
4. **Actualización continua:** re-ajustar el corrector cada día con los datos nuevos.

### 6.3 Detección de anomalías

- Residuo = real − predicho. Alerta cuando el residuo sale del intervalo de predicción
  (cuantiles del modelo o conformal prediction) durante N pasos seguidos.
- Correlación entre residuos y variables físicas (radiación, CO2) para sugerir causa.

### 6.4 Capa LLM

- Entrada: JSON con predicciones, anomalías, covariables y contexto de misión.
- Salida: reporte breve en lenguaje natural (estado, qué cambió, posible causa, qué revisar).
- Regla: el LLM solo interpreta números que recibe, nunca genera predicciones propias, y no
  entrega diagnósticos médicos; sugiere qué debe revisar el médico de vuelo.

## 7. Alcance del MVP

**Sí entra:**
1. Pipeline de datos: carga, limpieza, remuestreo a una frecuencia común (p. ej. 1 min)
2. Modelo base + baseline sobre datos terrestres
3. Datos "espacio" (reales o simulados) y evaluación zero-shot del modelo terrestre
4. Corrector residual y comparación antes/después
5. Detección de anomalías real vs. predicho
6. Dashboard (Streamlit): series, predicción, banda de confianza, alertas, reporte del LLM

**No entra:** hardware/sensores reales, ECG crudo, despliegue a bordo, validación clínica.

## 8. Cómo demostramos que funciona

Tres gráficos para la presentación:

1. **El modelo terrestre falla en el espacio:** error (MAE / MASE) en Tierra vs. zero-shot en
   espacio.
2. **La adaptación lo arregla:** error del modelo terrestre vs. modelo adaptado sobre los
   mismos datos de espacio.
3. **Curva de aprendizaje:** error vs. días de datos en vuelo usados para adaptar. Responde
   la pregunta clave: ¿cuántos días en órbita necesita NOVA para ser confiable?

Extra: precisión/recall de anomalías inyectadas y correlación residuo–radiación.

## 9. Estructura sugerida del repo

```
nova/
├── data/            # raw/ y processed/ (no subir datos pesados)
├── notebooks/       # exploración y gráficos de la presentación
├── nova/
│   ├── data.py      # carga y preprocesamiento
│   ├── simulate.py  # simulador de domain shift de microgravedad
│   ├── base.py      # modelo base y baseline
│   ├── adapt.py     # corrector residual / fine-tuning
│   ├── anomaly.py   # residuos, intervalos, alertas
│   └── report.py    # llamada al LLM
├── app.py           # dashboard Streamlit
└── NOVA_CONTEXT.md
```

Stack: Python, pandas, scikit-learn, PyTorch, una librería de forecasting (p. ej. la del
modelo fundacional elegido), Streamlit, API de un LLM.

## 10. Orden de trabajo

1. Elegir dataset terrestre y dejarlo limpio en un formato único
2. Baseline + modelo base funcionando en Tierra
3. Simulador de microgravedad (o datos reales si aparecen)
4. Corrector residual + los tres gráficos de la sección 8
5. Anomalías + reporte LLM
6. Dashboard y relato para el pitch

## 11. Preguntas abiertas

- ¿Conseguimos datos reales de vuelo o vamos con simulación + bed rest?
- ¿Qué modelo fundacional corre en nuestros equipos sin GPU?
- ¿Qué variable es la protagonista de la demo? (sugerencia: HR + HRV)
- ¿Cómo modelamos radiación: covariable del corrector o solo análisis de correlación?
