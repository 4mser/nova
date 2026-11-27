# Validar los ángulos contra un goniómetro

Compara la flexión que calcula pose-twin con la que se lee en un goniómetro. Se empieza por la rodilla.
Todo se anota en **flexión: 0 grados = pierna extendida**. No anotar el ángulo interior (180 = extendida);
el programa hace la conversión (flexión = 180 - interior).

Criterio fijado antes de medir: **error absoluto medio <= 5 grados**. Es una elección del equipo, no un estándar.
Para usar otro, indicarlo al crear la hoja (`--criterio-mae 4`), nunca después de ver los resultados.

## 1. Preparar

Se necesitan dos personas: quien posa y quien mide.

```powershell
cd research\pose-twin   # desde la raíz del repositorio
.venv\Scripts\Activate.ps1
python -m pose_twin.validacion plantilla
```

Crea `data\validacion\hoja.csv` (24 mediciones: 2 lados, 30/60/90/120 grados, 3 repeticiones, orden
aleatorio) y `hoja.criterio.json` (no editarlo). Para añadir otras articulaciones:
`--articulaciones rodilla,codo,cadera`.

## 2. Colocar la cámara

- De lado, perpendicular a la pierna que se mide, a la altura de la rodilla y a unos 2 m.
- Cámara fija y nivelada. Cadera, rodilla y tobillo visibles. Buena luz y ropa ajustada.
- Al cambiar de lado, la persona se gira; la cámara no se mueve.
- Usar posturas estables, con apoyo (acostada de lado o sentada, o de pie sujetándose).

## 3. Medir cada fila, en el orden de la hoja

1. La persona adopta un ángulo cercano al objetivo y se queda quieta.
2. Quien mide coloca el goniómetro por fuera de la rodilla: centro en el lado externo de la articulación,
   un brazo hacia la cadera (trocánter mayor) y el otro hacia el tobillo (maléolo externo).
3. Anotar la lectura real en `goniometro_flexion` (no el objetivo).
4. Quien mide sale del encuadre y se graban unos 5 segundos sin moverse.

Las referencias anatómicas son las de uso habitual y no se verificaron aquí con una fuente primaria;
conviene confirmarlas con un manual de goniometría o un profesional.

## 4. Grabar

**Opción A (recomendada): un video con la app de cámara del teléfono.** Un video por medición, o uno largo
anotando en cada fila el inicio y el fin del tramo quieto.

**Opción B: sesión en vivo.** Una ejecución por medición, con la persona ya en posición:

```powershell
python -m pose_twin live --source telefono                # salir con la tecla q
python -m pose_twin live --source 0 --max-segundos 15     # con webcam, se cierra sola
```

Cada ejecución guarda un CSV en `data\sesiones\`; anotar su nombre. Revisar en un editor que los tiempos
(`t_s`) elegidos correspondan al tramo quieto, porque el reloj empieza antes de que aparezca la imagen.
No usar los videos grabados con la tecla `g`: llevan el esqueleto dibujado encima.

## 5. Completar la hoja

| Columna | Qué poner |
|---|---|
| `goniometro_flexion` | lectura en grados de flexión |
| `archivo` | nombre del video o CSV (en `data\validacion\` o con ruta completa) |
| `inicio_s`, `fin_s` | tramo quieto, en segundos o `m:ss`; vacío = desde el principio o hasta el final |
| `notas` | cualquier incidencia |

`lado` es el lado de la persona (izq o der). Guardar como CSV (sirven `,` y `;`) y cerrar Excel.

## 6. Calcular

```powershell
python -m pose_twin.validacion calcular
```

Resultados en `data\validacion\resultados_hoja\`: `informe.md` (error absoluto medio, sesgo, dispersión
entre repeticiones, límites de acuerdo de Bland-Altman, abstenciones y límites) y `graficos.png`.

- Cada tramo se resume con la mediana de sus cuadros.
- **Abstención**: menos de 10 cuadros con ángulo, o menos de la mitad del tramo. Se cuenta y se reporta;
  no repetir la medición solo porque el resultado no gustó.
- Si la rodilla sale con el lado cambiado o con muchas abstenciones, revisar encuadre y luz, y anotarlo.
- Para videos se usa `--modelo heavy` por defecto.

## Si no hay goniómetro

Una app de ángulos (inclinómetro) del teléfono sirve **solo como aproximación para ensayar el procedimiento**.
No está validada aquí: no usar esos números como validación ni citarlos. Si se hace, usar otra hoja
(`--hoja data\validacion\ensayo.csv`, tanto en `plantilla` como en `calcular`) y escribirlo en `notas`.

## Comparar con RTMPose

Con el código actual **no se puede**: `calcular` y el comando `video` solo usan los modelos de MediaPipe
(`lite`, `full`, `heavy`). RTMPose solo está en `bench`, que mide la robustez a la rotación y no genera
ángulos por cuadro. Conservar los videos originales para compararlos si se añade esa función.

## Límites

Una persona, pocas muestras y medidas repetidas que no son independientes. El resultado describe este
montaje y posturas quietas; no demuestra precisión en otras personas, en movimiento ni en microgravedad.
No es un dispositivo médico.
