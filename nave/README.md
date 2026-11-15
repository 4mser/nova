# NOVA PC · núcleo de a bordo

NOVA es el copiloto de salud de la tripulación en el viaje a Marte (NASA Space Apps 2026, desafío
«Create Health Monitoring Software for Astronauts on Space Missions»). Este repositorio es la versión de la nave:
todo corre a bordo, sin conexión con la Tierra, y cada noche NOVA vuelve a casa para mejorar.

## Piezas

| Carpeta | Qué es | Tecnología |
|---|---|---|
| `vuelo/` | Núcleo de a bordo: sensores, reglas, alertas, protocolos de emergencia, enlace con la Tierra | F Prime (JPL/NASA), C++ |
| `voz/` | Voz de NOVA a bordo | Kokoro-82M (ONNX) |
| `tripulacion/` | Pantalla de la tripulación | Tauri (Rust) + interfaz web |
| `tierra/` | Consola del control de misión y del cirujano de vuelo | Open MCT (NASA) |
| `estacion/` | Contrato de datos y simulador de la estación médica | NDJSON por USB serie o UDP |
| `docs/` | Decisiones, umbrales y fuentes | |

## Principios

1. **Todo a bordo.** Nada de lo que usa la tripulación depende de internet ni de la Tierra.
2. **Los pasos médicos los dicta un protocolo, no el modelo.** NOVA explica, pregunta y acompaña; el protocolo decide.
3. **Cada umbral tiene su fuente** (NASA-STD-3001, Human Research Program, OSDR).
4. **Rangos de vuelo:** el cambio esperado por estar en el espacio se distingue del que necesita atención.
5. **Cada astronauta decide quién ve qué.**
6. **Las actualizaciones nocturnas llegan firmadas** y la nave vuelve a la versión anterior si algo falla.

## Puertos de la nave

| Puerto | Qué pasa |
|---|---|
| UDP 50050 | estación médica, simulador y teléfonos → núcleo (contrato de `estacion/CONTRATO.md`) |
| UDP 50051 | núcleo → pantalla de la tripulación (estado 1 Hz y alertas) |
| UDP 50052 | pantalla → núcleo (mediciones ingresadas a mano) |
| UDP 50053 | pantalla → simulador (escenarios de demo) |
| TCP 8750 | enlace HTTP de la nave: pantallas (SSE) y teléfonos con la app NOVA |
| TCP 8081 | modelo de lenguaje de a bordo (llama.cpp, Qwen3 4B Instruct), solo local |
| TCP 8082 | voz de NOVA a bordo (Kokoro-82M: af_heart en inglés, ef_dora en español), solo local |
| TCP 8083 | oído de NOVA a bordo (whisper.cpp, large-v3-turbo multilingüe): hablarle por voz desde la pantalla, solo local |
| TCP 8084 | búsqueda de la biblioteca (llama.cpp --embedding, nomic-embed-text-v2-moe), solo local |
| TCP 5080 | GDS de F Prime: consola técnica y API que usa la vista Systems |

## Correr todo en un computador

La nave levanta y vigila sola todo lo que necesita: núcleo de vuelo (GDS en :5080), simulador de la estación, modelo
de lenguaje, voz, oído, búsqueda de la biblioteca y visión (`tripulacion/src-tauri/src/servicios.rs`). Lo que ya esté
corriendo no se duplica, lo que se cae se vuelve a abrir y cada uno deja su registro en `~/.nova-pc/logs/`.

```sh
cd tripulacion && npm install && npm run dev      # ventana Tauri + todo lo anterior
cd tripulacion && npm run enlace                  # sin ventana: http://127.0.0.1:8750
```

`NOVA_SIN_SIMULADOR=1` cuando está la estación real de Luis · `NOVA_SIN_SERVICIOS=1` para abrir cada pieza a mano:

```sh
# 1. núcleo de vuelo (con la consola de tierra de F Prime en http://127.0.0.1:5060)
cd vuelo/Nova/Nave && source ../../fprime-venv/bin/activate && fprime-gds -g html --gui-port 5080
# 2. simulador de la estación médica (o la estación de Luis)
#    sembrar_diarios.py deja dos semanas de check-ins de demo (sueño, ánimo, energía) para la vista Mind; antes de abrir el enlace
python3 estacion/simulador/sembrar_diarios.py
python3 estacion/simulador/simulador.py
# 3. modelo de lenguaje y voz de a bordo (modelos en ~/.nova-pc/modelos y ~/.nova-pc/voz)
# reglas y protocolos van primero en el prompt: con -fa y la caché de prefijo NOVA empieza a responder en ~1,5 s
llama-server -m ~/.nova-pc/modelos/Qwen3-4B-Instruct-2507-Q4_K_M.gguf --host 127.0.0.1 --port 8081 -c 16384 -np 2 -fa on -b 2048 -ub 1024 --cache-reuse 256 -ngl 99 --jinja
cd voz && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt && .venv/bin/python servidor.py
# oído (brew install whisper-cpp; modelo ggml-large-v3-turbo-q5_0.bin de huggingface.co/ggerganov/whisper.cpp, MIT)
whisper-server -m ~/.nova-pc/modelos/ggml-large-v3-turbo-q5_0.bin --host 127.0.0.1 --port 8083 -l auto -t 8 -nt
# 4. pantalla de la tripulación (ventana Tauri + enlace en :8750)
cd tripulacion && npm install && npm run dev
#    sin ventana, solo el enlace (se abre en el navegador en http://127.0.0.1:8750):
cd tripulacion && npm run enlace
```

En la pantalla, la tecla D abre los escenarios de demo.

## Compilar el núcleo

```sh
git submodule update --init --recursive
cd vuelo && python3.12 -m venv fprime-venv && source fprime-venv/bin/activate
pip install -r requirements.txt
cd Nova/Nave && fprime-util generate && fprime-util build -j
```

NOVA es un concepto del Equipo B&N para el NASA International Space Apps Challenge. No está afiliado a la NASA
ni cuenta con su respaldo.

## Gemelo anatómico

`tripulacion/ui/anatomia/` trae la anatomía de referencia lista para el navegador: BodyParts3D 4.0 (hombre) y el set femenino del Human Reference Atlas del NIH, ambos CC BY 4.0. Créditos y adaptaciones en `anatomia/CREDITOS.md`; el set femenino se regenera con `node anatomia/convertir-mujer.mjs <glb> anatomia/mujer` (necesita `@gltf-transform/core` y `meshoptimizer`).
