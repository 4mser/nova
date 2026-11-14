# Plan · transfer learning Tierra → espacio

Estado al 14-11-2026, versión 2: Benja dio el OK y pidió sacar los datos de `datos/enviado_whatsapp/`, en su carpeta
local del proyecto. Ahí están las tablas de reposo en cama de la NASA. Esta versión reemplaza a la primera, que
simulaba el espacio y usaba las 8 variables de un reloj.

## Objetivo

Construir un modelo que sepa cómo es cada astronauta en la Tierra y que aprenda, con pocos días de datos, su «nueva
normalidad» en microgravedad. Al final tiene que poder mostrar los tres gráficos de `NOVA_CONTEXT.md` §8:

1. El modelo de Tierra falla en el espacio.
2. La adaptación lo arregla.
3. Cuántos días necesita NOVA para ser confiable.

## Datos

| Rol | Fuente | Qué trae |
|---|---|---|
| Espacio (análogo) | NASA NLSP/LSDA, reposo en cama con inclinación de −6° en la UTMB: campañas 1 y 3, CFT70 (tanda 3 de `enviado_whatsapp`) | 29 sujetos; signos vitales de cada mañana durante 11 a 21 días de pre-reposo, 42 a 90 días en cama y hasta 14 de post-reposo; diuresis y agua diarias en 24 y 23 sujetos |
| Tierra | LifeSnaps (Yfantidou et al. 2022, doi:10.1038/s41597-022-01764-x, CC BY 4.0), 71 personas | pulso en reposo, respiración y temperatura de piel del reloj, más VFC, SpO₂, sueño, actividad y estrés |
| Tierra personal | el pre-reposo de cada sujeto | su línea base antes de «despegar» |

El reposo en cama es el análogo terrestre estándar de la microgravedad y **no es un vuelo**. En la presentación se
presenta como «análogo terrestre (reposo en cama a −6°)».

Las 8 variables, con el nombre del contrato de la nave:

| Variable | Unidad | ¿En el contrato? |
|---|---|---|
| `pulso` | lpm | sí |
| `pa_sis` | mmHg | sí |
| `pa_dia` | mmHg | sí |
| `fr` | rpm | sí |
| `temp` | °C | sí |
| `peso` | kg | sí |
| `diuresis` | g/día | no (pregunta 18) |
| `agua` | g/día | no (pregunta 18) |

La ingesta de agua sigue una meta diaria del protocolo, así que es la más débil como «fisiología».

## Lo que mostró la comprobación (pandas, en el PC)

- **Hay cambio.** En las mismas personas, y desde el día 28 en cama, el pulso sube 2,6 lpm (±1,8) y el peso baja
  1,3 kg (±0,5). El resto cambia poco. En el post-reposo el pulso queda 7,8 lpm sobre la línea base.
- **No encontramos que el pronóstico a corto plazo empeore en el reposo.** Un promedio de 7 días tiene un error
  parecido en el reposo y en el pre-reposo. Esa comparación no es pareada: las ventanas del pre-reposo caen en los
  primeros días de ingreso y tienen el contexto incompleto. Por eso el gráfico 1 no se cuenta como error de pronóstico
  sino como **rango esperado**: el monitor de Tierra, armado con la línea base personal, marca como anormal lo que en
  el reposo es normal.

## Experimento

La validación es por sujetos, en 5 grupos estratificados por campaña: los sujetos de prueba nunca entran al ajuste.
Se reporta por variable, y la campaña 3 aporta 23 de los 29 sujetos. Las cifras llevan IC 95 % por bootstrap de
sujetos (se remuestrean personas, no días).

**Tarea 1 · Rango esperado** (`nova_tl/expectativa.py`; es el modelo residual de NOVA_CONTEXT §6.2):
- `tierra`: la media del pre-reposo ± 1,96 desviaciones del pre-reposo.
- `tierra+poblacion`: le suma un corrector ridge en función del día en cama, aprendido con OTROS sujetos.
- `+personal(k)`: le suma la media contraída del residuo de sus primeros k días en cama, con k = 3, 7, 14, 21 y 28.
- Centro y ancho se separan. Los modelos adaptados usan un ancho calibrado al 5 % con residuos fuera de muestra
  (validación cruzada por sujetos dentro de los de entrenamiento). Para no atribuirle al centro lo que es solo
  calibración, hay dos cruces: `tierra (ancho calibrado)`, con el centro de Tierra y el ancho calibrado, y
  `adaptado (ancho de Tierra)`, con el centro adaptado y ±1,96·sd.
- Placebo: la regla de Tierra aplicada dentro del propio pre-reposo, dejando fuera el día evaluado. Es el piso de
  falsas alarmas de esa regla sin ningún efecto del reposo.
- Se evalúa sobre los días en cama desde el día 28, con MAE, % de falsas alarmas, ancho del intervalo y detección de
  escalones inyectados de 3 días (anomalías sintéticas sobre datos reales, declaradas como tales). Los escalones tienen
  signo al azar, y falsas alarmas y detección se miden con la misma regla («≥ 2 de 3 días seguidos fuera»).
- Constantes fijadas a mano, sin barrido: el día 28, KAPPA = 3, el alpha del ridge y la magnitud de los escalones.

**Tarea 2 · Pronóstico a 7 días** (`nova_tl/modelo.py`): PatchTST de `transformers`, univariado y compartido entre
variables, con 14 días de contexto y pérdida con máscara.
- Se entrena en Tierra con LifeSnaps y el pre-reposo de los sujetos de entrenamiento, un modelo por fold: el
  pre-reposo de los sujetos de prueba nunca entra.
- Se compara contra persistencia, media de 7 días, el modelo de Tierra sin adaptar, un modelo «solo espacio» desde
  cero, un modelo «solo reposo» desde cero con el pre-reposo y la cama pero sin LifeSnaps (aísla el aporte de
  LifeSnaps), Tierra→espacio ajustando solo la cabeza o todo, y Chronos-2 sin adaptar.
- La métrica es el MAE relativo a persistencia (no es el MASE de Hyndman), promediado sin el agua. Las diferencias
  entre modelos llevan IC 95 % pareado por bootstrap de sujetos.
- La presión, el peso y los fluidos solo aparecen en Tierra a través del pre-reposo. El pulso, la respiración y la
  temperatura de LifeSnaps vienen de otro instrumento (el reloj, no la enfermería).

## Dónde corre

- **PC:** pandas, pytest y el ridge de la tarea 1 para la prueba rápida. Ninguna red neuronal.
- **Kaggle:** el kernel `benjacampos/nova-transfer-learning` (GPU T4) corre todo con el dataset privado
  `benjacampos/nova-tl`, que contiene el código y tres parquet.
- **Hugging Face:** los pesos `nova-tierra` y `nova-espacio` se suben como privados. El kernel solo puede subirlos si
  tiene el secreto `HF_TOKEN`; si no, se suben desde el PC.

## Qué prueba que quedó listo

- pytest en verde.
- El kernel COMPLETE con `metricas.json`, `rango_esperado.csv`, `pronostico.csv` y los gráficos 1 a 4.
- Los pesos en HF.
- La revisión de `ecc:python-reviewer` y `ecc:mle-reviewer`.

## Pasos

1. ✅ `datos.py` con sus tests: armoniza los tres formularios, usa un eje de días único, aplica los rangos del contrato
   y suma los fluidos.
2. ✅ `ventanas.py`, `baselines.py` y `expectativa.py` con sus tests.
3. ✅ `modelo.py` y `kaggle/correr.py`. Tres runs en Kaggle: el primero tenía rota la escala de la pérdida; el
   segundo pasó a `ecc:python-reviewer` y `ecc:mle-reviewer`; el tercero corrige lo que encontraron (fuga del
   pre-reposo en el pronóstico, comparación de anchos, ancho calibrado dentro de muestra, días de calendario).
4. Los resultados en el README, los pesos en HF.
5. *(opcional)* LoRA, la rotación de semillas, la curva de detección según el tamaño del escalón y la variante con
   ventana móvil de los k días.
6. *(opcional)* El PR a `4mser/nova`, con tu OK.

## Reproducir

```
python -m nova_tl.datos --reposo <carpeta nlsp_tablas> --lifesnaps <daily .csv|.parquet> --salida <carpeta>
python -m pytest tests
kaggle datasets version -p <carpeta con nova_tl/ y los parquet> -m "..." --dir-mode zip
kaggle kernels push -p kaggle --accelerator NvidiaTeslaT4
```
