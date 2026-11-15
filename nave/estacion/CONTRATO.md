# Data contract · Medical station → NOVA core

Version 1 · draft reviewed with Luis González (hardware)

The medical station (the sensors Luis builds) sends the on-board core one message per measurement. The core does not
need to know which board or sensor is behind it: if the message follows this contract, the core understands it.

Field names and values are in Spanish and are part of the contract; they must be sent exactly as written here.

## Transport

- **Data line:** JSON on a single line, terminated by `\n` (NDJSON), UTF-8 encoded.
- **Preferred connection:** USB serial at 115200 baud (it does not depend on a network, as on a spacecraft).
- **Alternative:** UDP to port `50050` of the core, one message per datagram (for boards with Wi-Fi or Ethernet).
- At most 1 KB per message. Long waveforms are split across several messages.

> In this repository the F Prime core reads UDP 50050 directly. USB serial reaches the ship through the bridge in
> [`hardware/lector_nova.py`](../../hardware/lector_nova.py), which reads the Arduino and posts to the ship link.

## Messages

Every message carries:

| Field | Type | Meaning |
|---|---|---|
| `v` | integer | contract version (today `1`) |
| `tipo` | text | `medicion`, `onda`, `latido` or `evento` |
| `est` | text | station identifier, e.g. `"estacion-1"` |
| `t` | integer | milliseconds since 1970 (UTC) when it was measured; if the board has no clock, `0` and the core uses the arrival time |

### `medicion`: one value

```json
{"v":1,"tipo":"medicion","est":"estacion-1","t":1763164800123,"trip":"T2","sensor":"spo2","valor":97,"unidad":"%","calidad":0.92}
```

| Field | Type | Meaning |
|---|---|---|
| `trip` | text | crew member measured: `T1`…`T6`. See "Who is being measured" |
| `sensor` | text | one from the sensor table |
| `valor` | number | the value, already converted to the unit in the table |
| `unidad` | text | the unit from the table (it is checked) |
| `calidad` | number 0–1 | confidence in the reading (contact, motion, signal). Optional; if absent, `1` |
| `extra` | object | optional, for compound values (e.g. blood pressure: `{"sis":118,"dia":76}`) |

### `onda`: a chunk of a continuous signal

```json
{"v":1,"tipo":"onda","est":"estacion-1","t":1763164800000,"trip":"T2","sensor":"ecg","fs":250,"seq":41,"muestras":[512,515,530,601,880,640,520]}
```

- `fs`: samples per second. `seq`: running chunk number, to detect losses.
- `muestras`: raw integers from the converter; the scale goes in `escala` (e.g. `{"mV_por_unidad":0.00488}`) in the
  first chunk.

### `latido`: the station is still alive

```json
{"v":1,"tipo":"latido","est":"estacion-1","t":0,"sensores":["spo2","pulso","temp","pa"],"bateria":0.81}
```

Every 5 seconds. If the core stops receiving it for 15 s, it reports the station as disconnected.

### `evento`: something happened at the station

```json
{"v":1,"tipo":"evento","est":"estacion-1","t":0,"trip":"T2","evento":"sin_contacto","sensor":"spo2"}
```

Events: `inicio_medicion` (measurement start), `fin_medicion` (measurement end), `sin_contacto` (no contact),
`movimiento` (motion), `error_sensor` (sensor error), `tripulante_identificado` (crew member identified).

## Sensors and units

| `sensor` | Unit | Accepted range | Notes |
|---|---|---|---|
| `pulso` | `lpm` | 20–250 | beats per minute |
| `spo2` | `%` | 50–100 | oxygen saturation |
| `pa` | `mmHg` | sis 50–250 · dia 30–150 | goes in `extra: {sis, dia}`; `valor` = mean arterial pressure |
| `temp` | `C` | 30–43 | body temperature |
| `fr` | `rpm` | 4–60 | breaths per minute |
| `glucosa` | `mg/dL` | 20–600 | blood glucose |
| `peso` | `kg` | 30–200 | in microgravity, body mass measured by oscillation |
| `vfc` | `ms` | 5–250 | heart rate variability (RMSSD) |
| `ecg` | waveform | — | electrocardiogram |
| `ppg` | waveform | — | pulse oximeter signal, for pulse and HRV in the core |
| `co2_cabina` | `ppm` | 0–10000 | cabin environmental sensors (`trip` = `"CABINA"`) |
| `o2_cabina` | `%` | 0–30 | |
| `temp_cabina` | `C` | 0–50 | |
| `pa_sis` / `pa_dia` | `mmHg` | 50–250 / 30–150 | alternative to `pa` when they arrive separately |
| `sueno_h` | `h` | 0–16 | hours of sleep last night (NOVA app) |
| `animo` | `1-5` | 1–5 | mood from the app check-in, only if the person shares their day |
| `energia` | `1-5` | 1–5 | energy from the app check-in, only if the person shares their day |
| `pasos` | `pasos` | 0–100000 | steps today (phone) |
| `fc_reposo` | `lpm` | 25–130 | resting heart rate (watch / Health Connect) |
| `luz` | `lux` | 0–150000 | ambient light (phone) |
| `ruido` | `dB` | 0–140 | approximate noise (phone) |

A value outside the accepted range is discarded as a sensor error (not as an emergency) and the core logs it.
Missing a sensor? Add it to this table before using it, so the core knows it.

> The flight core in this repository knows the 18 scalar sensors above (everything except `peso`, `ecg` and `ppg`)
> and tracks `T1`…`T4` (`TRIPULANTES = 4` in `Salud.fpp`). `latido`, `evento` and `onda` messages count as signs
> of life for the station watchdog.

## Who is being measured

The station has to know whom it is measuring. Options, from best to simplest:

1. A personal NFC tag (wristband or badge) that the station reads at the start → event `tripulante_identificado`.
2. Buttons or a knob T1…T6 on the station.
3. The crew member picks it on the NOVA screen and the core tells the station (return message
   `{"v":1,"tipo":"sesion","trip":"T2"}`).

The NOVA Station tablet uses option 1 through the ship link; see [`NFC.md`](NFC.md).

## What the core does with it

The `Estacion` component of the flight core (F Prime) validates each message, turns it into per-crew-member telemetry
and passes it to the rules engine. From there it goes to the crew screen, to NOVA (to answer questions) and to the
nightly report to Earth.

## Phones with the NOVA app

Phones do not speak UDP: they send batches over HTTP to the ship link (`tripulacion/`, port 8750), which converts them
to this same contract.

```http
POST http://<ship-pc>:8750/v1/lote
x-nova-token: <optional, if the ship sets NOVA_TOKEN>

{"trip":"T2","fuente":"nova-movil","mediciones":[{"sensor":"pulso","valor":61,"unidad":"lpm","calidad":0.95},{"sensor":"sueno_h","valor":7.2,"unidad":"h"}]}
```

`GET /v1/estado` returns the full crew state (the same thing the screen shows).

## Testing without the station

`estacion/simulador/simulador.py` sends messages with this contract. Pulse, SpO₂ and respiration use the real
variability of four records from the BIDMC PPG and Respiration Dataset (PhysioNet, ODC-By 1.0) laid over each crew
member's baseline; the rest is modeled. Demo scenarios: `desmayo T3` (fainting), `hipoglucemia T1` (hypoglycemia),
`fiebre T2` (fever), `hipoxia T4` (hypoxia), `co2`, `normal` (typed in the terminal or sent over UDP 50053).

## Radiation (active detector by Luis González)

The ship's radiation detector (proposal in [`research/radiation-detector/`](../../research/radiation-detector):
⁶LiF/ZnS:Ag neutron screens in a Bonner sphere, a ΔE-E telescope, a LET spectrometer and a fast solar particle alert
channel) sends a reading every few seconds to the ship link over HTTP (it does not go through the F Prime core yet).
The detector itself is a conceptual design; the ship side of this contract is implemented.

```http
POST http://<ship-pc>:8750/v1/radiacion
x-nova-token: <optional, if the ship sets NOVA_TOKEN>

{"est":"radiacion-1","tasa_usv_h":78.4,"alerta_spe":false,"let_kev_um":12.5,"neutrones_usv_h":14.2,"protones_cm2_s":2.1}
```

| Field | Unit | Required | Meaning |
|---|---|---|---|
| `tasa_usv_h` | µSv/h | yes | total equivalent dose rate (with the quality factor Q(LET) applied); accepted 0 to 10⁶ |
| `alerta_spe` | bool | no | the FPGA fast channel declares a solar particle event |
| `let_kev_um` | keV/µm | no | mean LET over the last interval (silicon spectrometer) |
| `neutrones_usv_h` | µSv/h | no | neutron contribution (Bonner sphere) |
| `protones_cm2_s` | p/cm²/s | no | proton flux above the telescope threshold |

A reading larger than 4000 bytes is rejected.

What the ship does ([`tripulacion/src-tauri/src/radiacion.rs`](../tripulacion/src-tauri/src/radiacion.rs), evaluated
every 2 s):
- With no detector readings for 2 minutes, it simulates the rate from what MSL RAD measured (cruise ~1.84 mSv/day,
  Zeitlin et al. 2013; Mars surface ~0.64 mSv/day, Hassler et al. 2014) and says so on every screen.
- **Solar storm:** if `alerta_spe` arrives or the rate stays at or above 500 µSv/h for 30 s, it alerts every screen
  (banner on the PC, the `tormenta_solar` guide on the PC and on NOVA Station, NOVA's voice) and writes it to the log
  (`spe_inicio`). With a real detector the storm ends after 5 minutes below 200 µSv/h (20 s when the rate is simulated
  or in the demo) and is logged as `spe_fin` with its peak rate and the dose of the event.
- Limits (NASA-STD-3001 Vol. 1, OCHMO Technical Brief Radiation Protection): 600 mSv per career and 250 mSv per solar
  event.
- `GET /v1/radiacion` returns the rate, its origin (`detector` or `simulado (MSL RAD)`), the mission dose against the
  limit, the storm and a 24 h series.
- NOVA's answers include a radiation summary in their context.
- Demonstration: `POST /v1/radiacion/demo {"spe":true}` starts a simulated storm of about 4 minutes (marked as demo);
  `{"spe":false}` ends it.
