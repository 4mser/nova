# Escáner AR con ángulos y calibración (copia experimental)

Copia del escáner de NOVA (cámara en vivo y anatomía 3D) que además muestra los 8 ángulos articulares y permite
calibrar un perfil personal, con la misma lógica que la versión Python. Contexto Tierra; no es un dispositivo
médico ni diagnostica.

## Arrancar (PowerShell, desde la raíz del repositorio)

```powershell
research\pose-twin\.venv\Scripts\python.exe research\pose-twin\escaner\servidor.py
```

Abrir en Chrome o Edge, en el mismo equipo:

<http://127.0.0.1:8010/escaner.html?local&nosend&auto&mudo&sistema=oseo&estilo=clinico>

El navegador pedirá permiso para la cámara. `Ctrl+C` cierra el servidor; `--puerto N` cambia el puerto.
El servidor usa solo la biblioteca estándar de Python.

## Uso

Las instrucciones aparecen en el panel de la pantalla:

1. Ponte donde se vea el cuerpo completo, con luz de frente.
2. Pulsa **Calibrar** o la tecla **C**.
3. Durante la cuenta regresiva de 6 s, ponte de pie, de frente, con los brazos algo separados.
4. Quédate quieto 6 s. Se necesitan al menos 15 cuadros con calidad buena; si no, la pantalla dice por qué falló.
5. Muévete: la columna *Diferencia* compara cada ángulo con tu postura de pie.

Si te mueves durante la captura (cadera o rodilla con p95 − p5 > 20° o MAD > 10°; codo u hombro con MAD > 15°)
se rechaza y se mantiene el perfil anterior. Con menos de 15 cuadros por segundo se avisa de poca luz o equipo lento.

### Sentadillas de lado

1. Pulsa **Sentadilla** o la tecla **S**.
2. Cuenta regresiva de 8 s: ponte de lado, de pie, cuerpo completo. Quédate quieto un segundo.
3. Haz las sentadillas; el contador avanza. Para terminar, quédate de pie 8 s o pulsa **S**.
4. **Descargar CSV** o **Descargar JSON de la serie**. No se guarda nada en el navegador: se pierde al cerrar.

Mismas reglas que Python (ver el README principal). Solo medidas: no validado, no es medición médica.

### Tamaño de la figura 3D: mi perfil o en vivo

Botón **Figura** o tecla **F**. Con un perfil aceptado se usa *mi perfil*; sin perfil, o con uno rechazado, la
figura se ajusta en vivo como en el original. La elección no se guarda: al recargar vuelve a *mi perfil*.

El modelo anatómico es genérico (no es el cuerpo real de la persona) y el perfil no es antropometría validada.

Se acepta un perfil con el formato vigente, 15 cuadros o más, todos los largos usados y que pase la regla de
quietud actual (también los guardados antes).

| Medida del escáner | Segmento del perfil (puntos) | Efecto |
|---|---|---|
| Ancho de hombros (× 1,18) | `ancho_hombros` (11-12) | Ancho del tronco y de sus órganos |
| Torso | `torso` (medio 11-12 a medio 23-24) | Alto del tronco y posición de la pelvis |
| Brazos | `brazo_izq`, `brazo_der` (11-13, 12-14) | Tamaño (largo y grosor) del hueso |
| Antebrazos | `antebrazo_izq`, `antebrazo_der` (13-15, 14-16) | Igual |
| Muslos | `muslo_izq`, `muslo_der` (23-25, 24-26) | Igual |
| Piernas | `pierna_izq`, `pierna_der` (25-27, 26-28) | Igual |

No salen del perfil: cabeza (distancia entre orejas), `ancho_caderas` (el escáner no tiene esa medida; la pelvis
usa el promedio de las escalas de hombros y torso), distancia a la cámara, posición y orientación. El ajuste
plano (`?plano`, o cuando el ajuste 3D falla) usa las proporciones de referencia, como antes.

Mezcla (`figura.mjs`): se usa el largo del perfil, pero nunca a más de 15 % del largo en vivo (límite técnico, no
validado). Se mantienen además los límites de escala del original. Antes de ver las caderas, el torso es el del
perfil. Cada hueso nace en la articulación vista y apunta a la siguiente; como su tamaño sale del perfil, el otro
extremo puede quedar corrido hasta ese 15 %.

El perfil y el ajuste en vivo usan los mismos puntos, pero no se calculan igual: el perfil mide los puntos 3D del
modelo y el escáner reproyecta los puntos de la imagen con la profundidad 3D. En una prueba con imagen fija, un
perfil calibrado sobre esa misma imagen difirió de lo visto en vivo entre 0,8 % (torso) y 10 % (una pierna).

El perfil se guarda en `localStorage` de ese navegador. **Descargar JSON** entrega un archivo con el formato de
`data\perfiles\`: cópialo ahí para usarlo con `python -m pose_twin live --source 0 --perfil <nombre>`.

## Archivos

| Archivo | Qué es |
|---|---|
| `escaner.html`, `escaner.js` | Copias de `nave/tripulacion/ui/` del commit `b14fc41`; cambios marcados con `pose-twin:` |
| `angulos.mjs` | Port de `geometria.py`, `filtros.py`, `perfil.py` y de la lógica por cuadro de `sesion.py` |
| `sentadilla.mjs` | Port de `sentadilla.py` |
| `panel.mjs`, `panel.css` | Panel, instrucciones, calibración, perfil y botón de la figura |
| `figura.mjs` | Qué perfiles sirven para la figura 3D y mezcla de medidas |
| `servidor.py` | Sirve esta carpeta y, si el archivo no está, `nave/tripulacion/ui` (solo lectura) |
| `pruebas/paridad.mjs` | Comparación JavaScript contra Python |
| `pruebas/figura.mjs` | Pruebas de `figura.mjs` |

Modelos, wasm, anatomía, librerías y fuentes no se duplican. Pruebas (incluyen paridad, requiere `node`, y
servidor):

```powershell
cd research\pose-twin
.venv\Scripts\python.exe -m pytest -q
```

## Qué cambia respecto del original

- Solo visión en este equipo: no usa la nave (estado, misión, historia, visión remota ni envío de cuadros),
  no carga la voz y no incluye la revisión de ojos. Por eso no muestra signos vitales.
- El lienzo deja espacio al panel (a la derecha, o abajo en pantallas angostas).
- Sin dato de visibilidad, el punto cuenta como no visible (antes contaba como visible).

## Privacidad y red

No se envían ni se guardan imágenes. La librería MediaPipe (`vision_bundle.mjs`) intenta enviar telemetría de
uso a `https://odml.pa.googleapis.com/v1/log` cada 60 s. El servidor la **bloquea** con la cabecera
`Content-Security-Policy` (`connect-src 'self'`); en la consola aparece como error de CSP y es lo esperado.
El bloqueo depende de abrir la página con `servidor.py`.

## Diferencias frente a la versión Python

La lógica de ángulos, filtro, calibración y sentadilla es la misma, pero la entrada no: el navegador usa el modelo `full`
en computador (`lite` en teléfono) sobre una imagen de 384 px, sigue a una persona con el criterio del escáner y
no tiene enderezado; Python usa `heavy` por defecto y su propia selección de persona. Los grados de una y otra
no tienen por qué coincidir en el mismo video.

## Atribución

Anatomía de referencia: BodyParts3D y HuBMAP, licencia CC BY 4.0. Las posiciones de los órganos son estimadas.
