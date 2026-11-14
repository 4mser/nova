# Guía de pruebas: qué hacer, en orden

Pega cada comando en Claude Code (con el `!` al inicio). Se abre una ventana con tu cámara.
`q` o ESC abortan sin guardar nada. Nunca se guardan imágenes ni video.

## Antes de empezar (una sola vez)
- Luz de escritorio, sin lentes, monitor a unos 50 cm.
- Cabeza apoyada (respaldo o una mano en la sien).
- **Cejas relajadas** durante todas las grabaciones (sin fruncir ni alzar), salvo en la prueba de control.
- Cuando abra la ventana, **súbela al borde superior de la pantalla, pegada a la cámara**. Así el punto rojo queda a la altura de tus ojos.

## Paso 1. Comprobar los puntos de la ceja (1 minuto, no graba nada)
Comando: `--brow-check`
- Mira la ventana: **ceja superior en verde, inferior en rojo**. Deben seguir el borde de tus cejas.
- Con la tecla **n** se numeran los puntos.
- Si las líneas no caen donde deben, **para y avísame** antes de seguir.
- Sal con **q**.

## Paso 2. Tres sesiones de suelo de ruido (sesiones 5, 6 y 7)
Cada sesión son 3 bloques de 20 segundos. Dura unos 2 a 3 minutos (más el procesamiento).

**En cada bloque:**
1. Cuenta regresiva de 15 s al inicio y de 5 s entre bloques: acomódate y mira el **punto rojo**.
2. "Esperando quietud": no muevas la cabeza ni hables. Empieza solo cuando los indicadores estén en verde.
3. **1 pitido = grabando.** Mira el punto rojo todo el tiempo, quieto, sin hablar. **Parpadea normal**, sin aguantarte. Cejas relajadas.
4. **2 pitidos = terminó el bloque.** En la pausa de 5 s relaja el cuello.
5. **3 pitidos = te moviste.** El bloque se repite solo (hasta 2 veces).

**Entre una sesión y la siguiente (importante):**
1. **Levántate de la silla** y camina unos 20 a 30 segundos.
2. **Vuelve a sentarte como lo harías normalmente.** No busques quedar igual ni distinto: esa variación natural es lo que se mide.
3. Apoya la cabeza otra vez y deja las cejas relajadas.
4. Lanza la sesión siguiente con otro `--session-id` (6, luego 7).

**Por qué hay que levantarse:** la línea base de un astronauta se mide un día y se compara con otro. Nadie se sienta exactamente igual dos días. Si te quedas sentado, el cambio mínimo detectable sale demasiado optimista. Al terminar cada sesión, el programa te lo recuerda en consola y con 3 pitidos.

## Paso 3. Prueba de control de cejas (1 minuto)
Comando: `--brow-control`. Hazla **después** de las 3 sesiones.
- 10 s con la cara neutra, 10 s con las **cejas alzadas**, 4 s de descanso y 10 s con el **ceño fruncido**.
- Sirve para confirmar que el filtro de expresión funciona y que el cambio de distancia pupila-ceja supera 3 veces el ruido.

## Paso 4. Informe final
Comando: `--noise-floor-report --exclude-sessions 1,2,3,4`
- Excluye las sesiones antiguas, que no medían la ceja.
- No pide nada de ti. Lo imprime y lo guarda en `docs/spike-resultados.md`.

## Si algo sale raro
- **Nunca se pone verde:** apoya mejor la cabeza y respira con calma; tras 30 s empieza igual y deja la captura marcada.
- **"TE MOVISTE" repetido:** el mensaje dice qué criterio falló (por ejemplo "IOD 70 %"). Pásamelo.
- **La ventana no abre:** añade `--no-view` al comando.
- **Los puntos de la ceja no caen bien (paso 1):** avísame antes de medir.
