# Contrato de datos · Estación médica → Núcleo NOVA

Versión 1 · borrador para revisar con Luis

La estación médica (los sensores que arma Luis) le manda al núcleo de a bordo un mensaje por medición.
El núcleo no necesita saber qué placa ni qué sensor hay detrás: si el mensaje cumple este contrato, lo entiende.

## Transporte

- **Línea de datos:** JSON en una sola línea, terminado en `\n` (NDJSON), codificado en UTF-8.
- **Conexión preferida:** USB serie a 115200 baudios (no depende de red, igual que en una nave).
- **Alternativa:** UDP al puerto `50050` del núcleo, un mensaje por datagrama (para placas con wifi o ethernet).
- Máximo 1 KB por mensaje. Las ondas largas se parten en varios mensajes.

## Mensajes

Todos los mensajes llevan:

| Campo | Tipo | Qué es |
|---|---|---|
| `v` | entero | versión del contrato (hoy `1`) |
| `tipo` | texto | `medicion`, `onda`, `latido` o `evento` |
| `est` | texto | identificador de la estación, p. ej. `"estacion-1"` |
| `t` | entero | milisegundos desde 1970 (UTC) en que se midió; si la placa no tiene reloj, `0` y el núcleo pone la hora de llegada |

### `medicion`: un valor

```json
{"v":1,"tipo":"medicion","est":"estacion-1","t":1763164800123,"trip":"T2","sensor":"spo2","valor":97,"unidad":"%","calidad":0.92}
```

| Campo | Tipo | Qué es |
|---|---|---|
| `trip` | texto | tripulante medido: `T1`…`T6`. Ver «Quién se está midiendo» |
| `sensor` | texto | uno de la tabla de sensores |
| `valor` | número | el valor ya convertido a la unidad de la tabla |
| `unidad` | texto | la unidad de la tabla (se comprueba) |
| `calidad` | número 0–1 | confianza de la lectura (contacto, movimiento, señal). Opcional; si no hay, `1` |
| `extra` | objeto | opcional, para valores compuestos (p. ej. presión: `{"sis":118,"dia":76}`) |

### `onda`: un trozo de señal continua

```json
{"v":1,"tipo":"onda","est":"estacion-1","t":1763164800000,"trip":"T2","sensor":"ecg","fs":250,"seq":41,"muestras":[512,515,530,601,880,640,520]}
```

- `fs`: muestras por segundo. `seq`: número correlativo del trozo, para detectar pérdidas.
- `muestras`: enteros crudos del conversor; la escala va en `escala` (p. ej. `{"mV_por_unidad":0.00488}`) en el primer trozo.

### `latido`: la estación sigue viva

```json
{"v":1,"tipo":"latido","est":"estacion-1","t":0,"sensores":["spo2","pulso","temp","pa"],"bateria":0.81}
```

Cada 5 segundos. Si el núcleo deja de recibirlo 15 s, avisa que la estación está desconectada.

### `evento`: algo que pasó en la estación

```json
{"v":1,"tipo":"evento","est":"estacion-1","t":0,"trip":"T2","evento":"sin_contacto","sensor":"spo2"}
```

Eventos: `inicio_medicion`, `fin_medicion`, `sin_contacto`, `movimiento`, `error_sensor`, `tripulante_identificado`.

## Sensores y unidades

| `sensor` | Unidad | Rango aceptado | Notas |
|---|---|---|---|
| `pulso` | `lpm` | 20–250 | latidos por minuto |
| `spo2` | `%` | 50–100 | saturación de oxígeno |
| `pa` | `mmHg` | sis 50–250 · dia 30–150 | va en `extra: {sis, dia}`; `valor` = presión media |
| `temp` | `C` | 30–43 | temperatura corporal |
| `fr` | `rpm` | 4–60 | respiraciones por minuto |
| `glucosa` | `mg/dL` | 20–600 | |
| `peso` | `kg` | 30–200 | en microgravedad, masa corporal medida por oscilación |
| `vfc` | `ms` | 5–250 | variabilidad de la frecuencia cardiaca (RMSSD) |
| `ecg` | onda | — | electrocardiograma |
| `ppg` | onda | — | señal del oxímetro, para pulso y VFC en el núcleo |
| `co2_cabina` | `ppm` | 0–10000 | sensores ambientales de la cabina (`trip` = `"CABINA"`) |
| `o2_cabina` | `%` | 0–30 | |
| `temp_cabina` | `C` | 0–50 | |
| `pa_sis` / `pa_dia` | `mmHg` | 50–250 / 30–150 | alternativa a `pa` cuando llegan por separado |
| `sueno_h` | `h` | 0–16 | horas de sueño de la última noche (app NOVA) |
| `animo` | `1-5` | 1–5 | check-in de la app, solo si la persona comparte su día |
| `energia` | `1-5` | 1–5 | check-in de la app, solo si la persona comparte su día |
| `pasos` | `pasos` | 0–100000 | pasos de hoy (teléfono) |
| `fc_reposo` | `lpm` | 25–130 | pulso en reposo (reloj / Health Connect) |
| `luz` | `lux` | 0–150000 | luz ambiente (teléfono) |
| `ruido` | `dB` | 0–140 | ruido aproximado (teléfono) |

Un valor fuera del rango aceptado se descarta como error del sensor (no como emergencia) y el núcleo lo registra.
¿Falta un sensor? Se agrega a esta tabla antes de usarlo, para que el núcleo lo conozca.

## Quién se está midiendo

La estación tiene que saber a quién mide. Opciones, de mejor a más simple:

1. Etiqueta NFC personal (pulsera o credencial) que la estación lee al empezar → evento `tripulante_identificado`.
2. Botones o perilla T1…T6 en la estación.
3. El tripulante lo elige en la pantalla de NOVA y el núcleo se lo dice a la estación (mensaje de vuelta `{"v":1,"tipo":"sesion","trip":"T2"}`).

## Qué hace el núcleo con esto

El componente `Estacion` del núcleo de vuelo (F Prime) valida cada mensaje, lo convierte en telemetría por tripulante
y se lo pasa al motor de reglas. Desde ahí van a la pantalla de la tripulación, a NOVA (para responder preguntas)
y al informe nocturno a la Tierra.

## Teléfonos con la app NOVA

Los teléfonos no hablan UDP: mandan lotes por HTTP al enlace de la nave (`tripulacion/`, puerto 8750), que los
convierte a este mismo contrato.

```http
POST http://<pc-de-la-nave>:8750/v1/lote
x-nova-token: <opcional, si la nave define NOVA_TOKEN>

{"trip":"T2","fuente":"nova-movil","mediciones":[{"sensor":"pulso","valor":61,"unidad":"lpm","calidad":0.95},{"sensor":"sueno_h","valor":7.2,"unidad":"h"}]}
```

`GET /v1/estado` devuelve el estado completo de la tripulación (lo mismo que ve la pantalla).

## Para probar sin la estación

`estacion/simulador/simulador.py` manda mensajes con este contrato. El pulso, la SpO₂ y la respiración usan la
variabilidad real de cuatro registros del BIDMC PPG and Respiration Dataset (PhysioNet, ODC-By 1.0) montada sobre la
línea base de cada tripulante; el resto está modelado. Escenarios para la demo: `desmayo T3`, `hipoglucemia T1`,
`fiebre T2`, `hipoxia T4`, `co2`, `normal` (en la terminal o por UDP 50053).

## Radiación (detector activo de Luis González)

El detector de radiación de la nave (propuesta en `equipo/luis-gonzalez/radiacion/`: neutrones ⁶LiF/ZnS:Ag en esfera
de Bonner, telescopio ΔE-E, espectrómetro de LET y canal rápido de alerta de partículas solares) manda una lectura
cada pocos segundos al enlace de la nave por HTTP (no pasa por el núcleo F Prime todavía):

```http
POST http://<pc-de-la-nave>:8750/v1/radiacion
x-nova-token: <opcional, si la nave define NOVA_TOKEN>

{"est":"radiacion-1","tasa_usv_h":78.4,"alerta_spe":false,"let_kev_um":12.5,"neutrones_usv_h":14.2,"protones_cm2_s":2.1}
```

| Campo | Unidad | Obligatorio | Qué es |
|---|---|---|---|
| `tasa_usv_h` | µSv/h | sí | tasa de dosis equivalente total (con el factor de calidad Q(LET) aplicado) |
| `alerta_spe` | bool | no | el canal rápido de la FPGA declara un evento de partículas solares |
| `let_kev_um` | keV/µm | no | LET medio del último intervalo (espectrómetro de silicio) |
| `neutrones_usv_h` | µSv/h | no | aporte de neutrones (esfera de Bonner) |
| `protones_cm2_s` | p/cm²/s | no | flujo de protones sobre el umbral del telescopio |

Qué hace la nave (`tripulacion/src-tauri/src/radiacion.rs`):
- Sin lecturas del detector en 2 minutos, simula la tasa con lo que midió MSL RAD (crucero ~1,84 mSv/día, Zeitlin et
  al. 2013; superficie de Marte ~0,64 mSv/día, Hassler et al. 2014) y lo dice en todas las pantallas.
- **Tormenta solar:** si llega `alerta_spe` o la tasa pasa 500 µSv/h durante 30 s, avisa a todas las pantallas
  (letrero en el PC, guía «tormenta_solar» en el PC y en NOVA Station, voz de NOVA) y lo anota en la bitácora; termina
  tras 5 minutos bajo 200 µSv/h, con la dosis del evento.
- Límites (NASA-STD-3001 Vol. 1, OCHMO Technical Brief Radiation Protection): 600 mSv en la carrera y 250 mSv por
  evento solar.
- `GET /v1/radiacion` devuelve la tasa, su origen, la dosis de la misión frente al límite, la tormenta y 24 h de serie.
- Demostración: `POST /v1/radiacion/demo {"spe":true}` lanza una tormenta simulada de unos 4 minutos (marcada como demo).
