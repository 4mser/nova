"""Video de demostración: la persona junto a su esqueleto en 3D, todo en local.

    python -m pose_twin.demo grabar [--source 0] [--segundos 30]
    python -m pose_twin.demo generar [--in ARCHIVO]

`grabar` guarda el video sin anotaciones en data/grabaciones/; `generar` produce en data/salidas/ un video
con el original (puntos y líneas) a la izquierda y un esqueleto 3D de los puntos "mundo" de MediaPipe a la
derecha. Texto dibujado solo en ASCII (las fuentes Hershey de OpenCV no tienen tildes).
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time
from pathlib import Path

# Silencia los registros de glog/TFLite de MediaPipe (deben fijarse antes de importarlo)
os.environ.setdefault("GLOG_minloglevel", "2")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import cv2
import numpy as np

from .dibujo import ETIQUETA, _partir, _texto
from .filtros import FiltroAngulos, OneEuro
from .fuente import ErrorFuente, abrir_fuente
from .geometria import ANGULOS, CONEXIONES, CUERPO, angulos_articulares
from .motor import ErrorModelo, Motor
from .perfil import calidad
from .sesion import CARPETA_GRABACIONES, DATA, Grabador

CARPETA_SALIDAS = DATA / "salidas"
VENTANA = "pose-twin demo  [q] cancelar"
ROTULO = "Estimacion no validada, no es medicion medica. La profundidad es aproximada"

# ---------------------------------------------------------------------------------- grabación
PREPARACION_S = 10.0
CUENTA_S = 5.0
SIN_CUADROS_S = 5.0
# (fracción del tiempo total, título, detalle)
GUION: list[tuple[float, str, str]] = [
    (0.20, "DE FRENTE Y QUIETO", "Mira a la camara, brazos algo separados del cuerpo"),
    (0.25, "LEVANTA LOS BRAZOS", "Subelos despacio por los lados hasta arriba y bajalos"),
    (0.20, "GIRA DE LADO", "Gira despacio hasta quedar de lado a la camara y quedate asi"),
    (0.35, "HAZ 3 SENTADILLAS", "De lado, a tu ritmo, y vuelve a quedar de pie en cada una"),
]


class Cancelado(Exception):
    """La persona canceló la grabación."""


def tramos(segundos: float) -> list[tuple[float, float, str, str]]:
    """Guion con tiempos (inicio, fin, título, detalle) para una grabación de `segundos`."""
    res, t = [], 0.0
    for i, (frac, titulo, detalle) in enumerate(GUION):
        fin = segundos if i == len(GUION) - 1 else t + frac * segundos
        res.append((t, fin, titulo, detalle))
        t = fin
    return res


def tramo_en(t: float, segundos: float) -> int:
    """Índice del tramo del guion que corresponde al segundo `t`."""
    for i, (_, fin, _, _) in enumerate(tramos(segundos)):
        if t < fin:
            return i
    return len(GUION) - 1


class EscritorTiempoReal:
    """Escribe a FPS constantes respetando el tiempo real de llegada de cada cuadro.

    Cada hueco del video (1/fps) recibe el último cuadro disponible en ese instante: si la cámara baja
    de velocidad se repiten cuadros y si sube se descartan, así el video dura lo mismo que la toma.
    """

    def __init__(self, grabador, fps: float):
        self.grabador = grabador
        self.fps = fps
        self.n = 0
        self._ultimo: np.ndarray | None = None

    def _llenar(self, hasta: int) -> None:
        while self.n < hasta:
            self.grabador.escribir(self._ultimo)
            self.n += 1

    def agregar(self, cuadro: np.ndarray, t: float) -> None:
        """`t`: segundos desde el inicio de la grabación (creciente)."""
        if self._ultimo is not None:
            self._llenar(math.ceil(t * self.fps - 1e-6))
        self._ultimo = cuadro

    def terminar(self, t_fin: float) -> None:
        if self._ultimo is not None:
            self._llenar(round(t_fin * self.fps))


def fps_de_grabacion(medidos: float) -> float:
    """FPS del archivo a partir de los que entrega la cámara (entre 10 y 30; 30 si aún no se sabe)."""
    if medidos <= 0:
        return 30.0
    return float(min(30, max(10, round(medidos))))


def pantalla_grabacion(cuadro: np.ndarray, titulo: str, detalle: str, pie: str, grande: str = "",
                       espejo: bool = True, grabando: bool = False, progreso: float | None = None) -> np.ndarray:
    """Vista de la ventana: imagen (en espejo, solo para verse) y franja de instrucciones debajo."""
    h, w = cuadro.shape[:2]
    ancho = 960
    img = cv2.resize(cuadro, (ancho, max(1, round(h * ancho / w))))
    if espejo:
        img = cv2.flip(img, 1)
    alto = img.shape[0]
    if grande:
        (tw, th), _ = cv2.getTextSize(grande, cv2.FONT_HERSHEY_SIMPLEX, 5.0, 10)
        _texto(img, grande, ((ancho - tw) // 2, (alto + th) // 2), 5.0, (0, 220, 255), 10)
    if grabando:
        cv2.circle(img, (ancho - 30, 30), 11, (0, 0, 255), -1, cv2.LINE_AA)
        _texto(img, "REC", (ancho - 110, 39), 0.9, (0, 0, 255), 2)
    franja = np.zeros((170, ancho, 3), np.uint8)
    esc = 1.1
    tw = cv2.getTextSize(titulo, cv2.FONT_HERSHEY_SIMPLEX, esc, 2)[0][0]
    _texto(franja, titulo, (14, 42), esc * min(1.0, (ancho - 28) / tw), (0, 230, 255), 2)
    for i, renglon in enumerate(_partir(detalle, ancho - 28, 0.75)[:2]):
        _texto(franja, renglon, (14, 78 + 30 * i), 0.75, (255, 255, 255), 1)
    _texto(franja, pie, (14, 148), 0.6, (180, 180, 180), 1)
    if progreso is not None:
        cv2.rectangle(franja, (0, 162), (int(ancho * min(1.0, max(0.0, progreso))), 169), (80, 200, 80), -1)
    return np.vstack([img, franja])


class VentanaCV:
    def __init__(self):
        cv2.namedWindow(VENTANA, cv2.WINDOW_NORMAL)
        self._dimensionada = False

    def mostrar(self, img: np.ndarray | None, espera_ms: int = 1) -> int:
        """Muestra la imagen y devuelve la tecla (-1 si ninguna). Cancela si se cerró la ventana."""
        if img is not None:
            if not self._dimensionada:
                cv2.resizeWindow(VENTANA, img.shape[1], img.shape[0])
                self._dimensionada = True
            cv2.imshow(VENTANA, img)
        tecla = cv2.waitKey(max(1, espera_ms))
        if self._dimensionada and cv2.getWindowProperty(VENTANA, cv2.WND_PROP_VISIBLE) < 1:
            raise Cancelado
        return -1 if tecla < 0 else tecla & 0xFF

    def cerrar(self) -> None:
        cv2.destroyAllWindows()


def bucle_grabacion(fuente, ventana, ruta: Path, segundos: float, preparacion: float = PREPARACION_S,
                    cuenta: float = CUENTA_S, espejo: bool = True, reloj=time.monotonic,
                    crear_grabador=Grabador) -> Path:
    """Preparación, cuenta regresiva y grabación guiada. Devuelve la ruta del video sin anotaciones.

    Si se cancela o la cámara deja de entregar cuadros, borra lo grabado y lanza Cancelado o ErrorFuente.
    No cierra la fuente ni la ventana (lo hace quien llama).
    """
    t0 = reloj()
    t_cuenta = t0 + preparacion  # inicio de la cuenta regresiva
    t_ultimo = t0
    escritor, grabador, inicio = None, None, 0.0
    cuadro = None
    completo = False
    try:
        while True:
            t_vuelta = reloj()
            ok, nuevo, _ = fuente.leer()
            ahora = reloj()
            if not ok:
                if fuente.es_archivo and escritor is not None:  # un archivo de prueba más corto que la toma
                    segundos = min(segundos, ahora - inicio)
                    break
                raise ErrorFuente("La fuente dejo de entregar cuadros antes de terminar.")
            if nuevo is not None:
                cuadro, t_ultimo = nuevo, ahora
            elif ahora - t_ultimo > SIN_CUADROS_S:
                raise ErrorFuente(f"La camara no entrega cuadros desde hace {SIN_CUADROS_S:.0f} s.")

            if escritor is None and ahora >= t_cuenta + cuenta and nuevo is not None:
                fps = fuente.fps if fuente.es_archivo else fps_de_grabacion(getattr(fuente, "fps_entrega", 0.0))
                grabador = crear_grabador(ruta, fps, (nuevo.shape[1], nuevo.shape[0]))
                escritor = EscritorTiempoReal(grabador, fps)
                inicio = ahora
                print(f"Grabando {segundos:.0f} s a {fps:.0f} cuadros/s...", flush=True)

            vista = None
            if escritor is not None:
                t = ahora - inicio
                if t >= segundos:
                    break
                if nuevo is not None:
                    escritor.agregar(nuevo.copy(), t)
                lista = tramos(segundos)
                i = tramo_en(t, segundos)
                _, fin, titulo, detalle = lista[i]
                sig = f"Despues: {lista[i + 1][2].lower()}" if i + 1 < len(lista) else "Ultimo paso"
                pie = f"Paso {i + 1}/{len(lista)} | {sig} | quedan {math.ceil(segundos - t)} s | Q cancelar"
                if cuadro is not None:
                    vista = pantalla_grabacion(cuadro, f"{titulo}  ({math.ceil(fin - t)} s)", detalle, pie,
                                               espejo=espejo, grabando=True, progreso=t / segundos)
            elif cuadro is not None:
                if ahora < t_cuenta:
                    vista = pantalla_grabacion(
                        cuadro, "COLOCATE DE CUERPO COMPLETO",
                        "Alejate 2 a 3 m, con luz de frente, hasta verte entero de la cabeza a los pies. "
                        "Pulsa ESPACIO cuando estes listo.",
                        f"La cuenta regresiva empieza en {math.ceil(t_cuenta - ahora)} s | Aun no se graba | Q cancelar",
                        espejo=espejo)
                else:
                    falta = max(1, math.ceil(t_cuenta + cuenta - ahora))
                    vista = pantalla_grabacion(cuadro, "PREPARATE: DE FRENTE Y DE PIE",
                                               "La grabacion empieza al terminar la cuenta",
                                               "Aun no se graba | Q cancelar", grande=str(falta), espejo=espejo)

            espera = 1
            if fuente.es_archivo:  # un archivo se reproduce a su velocidad real, como una cámara
                espera = int(1000 / fuente.fps - (reloj() - t_vuelta) * 1000)
            tecla = ventana.mostrar(vista, espera)
            if tecla in (ord("q"), ord("Q"), 27):
                raise Cancelado
            if tecla == ord(" ") and escritor is None:
                t_cuenta = min(t_cuenta, reloj())
        escritor.terminar(segundos)
        completo = True
    finally:
        if grabador is not None:
            final = grabador.cerrar()
            if not completo:
                Path(final).unlink(missing_ok=True)
    return ruta


def ejecutar_grabar(args) -> int:
    if args.segundos < 10:
        print("Error: usa al menos 10 segundos para que quepa el guion.", file=sys.stderr)
        return 2
    ruta = Path(args.salida) if args.salida else CARPETA_GRABACIONES / time.strftime("demo_%Y%m%d_%H%M%S.mp4")
    print("Abriendo la fuente...", flush=True)
    fuente = abrir_fuente(args.source, exposicion=args.exposicion)
    ventana = None
    try:
        ventana = VentanaCV()
        bucle_grabacion(fuente, ventana, ruta, args.segundos, preparacion=args.preparacion,
                        espejo=not args.sin_espejo)
    except (Cancelado, KeyboardInterrupt):
        print("Grabacion cancelada: no se guarda ningun video.")
        return 1
    finally:
        try:
            fuente.cerrar()  # primero la cámara: que se apague pase lo que pase después
        finally:
            if ventana is not None:
                ventana.cerrar()
    print(f"Video sin anotaciones: {ruta.resolve()}")
    print("Siguiente paso (desde research\\pose-twin):")
    print(f'  .venv\\Scripts\\python.exe -m pose_twin.demo generar --in "{ruta.resolve()}"')
    return 0


# ---------------------------------------------------------------------------------- generación
ANCHO, ALTO = 1280, 720
ALTO_CABECERA, ALTO_PANEL = 40, 540
UMBRAL_TENUE = 0.3  # por debajo, el punto no se dibuja
COLOR_IZQ = (255, 200, 40)  # BGR: celeste = izquierda de la persona
COLOR_DER = (40, 140, 255)  # naranja = derecha de la persona
COLOR_CENTRO = (220, 220, 220)
FONDO = (22, 16, 12)
PIES = [27, 28, 29, 30, 31, 32]
GIRO_GRADOS = 60.0
GIRO_PERIODO_S = 16.0
ELEVACION_GRADOS = 12.0
DISTANCIA_M = 4.0  # perspectiva
ALTURA_CENTRO_M = 0.85


def lado(i: int) -> str:
    """Lado de la persona de un punto BlazePose (1-3 ojo izquierdo, 4-6 derecho; desde 7, impar = izquierdo)."""
    if i == 0:
        return "centro"
    if i <= 6:
        return "izq" if i <= 3 else "der"
    return "izq" if i % 2 == 1 else "der"


def color_hueso(a: int, b: int) -> tuple[int, int, int]:
    la, lb = lado(a), lado(b)
    if la != lb:
        return COLOR_CENTRO
    return {"izq": COLOR_IZQ, "der": COLOR_DER, "centro": COLOR_CENTRO}[la]


def estilo(vis: float, umbral: float) -> str:
    """'solido', 'tenue' u 'oculto' según la visibilidad que informa el modelo."""
    if vis >= umbral:
        return "solido"
    return "tenue" if vis >= UMBRAL_TENUE else "oculto"


def a_escena(mundo: np.ndarray) -> np.ndarray:
    """Ejes de MediaPipe (x derecha de la imagen, y abajo, z alejándose) a escena (y arriba, z hacia quien mira).

    Es un giro de 180 grados alrededor de x: no refleja, así que izquierda y derecha se conservan.
    """
    return np.asarray(mundo, dtype=float) * np.array([1.0, -1.0, -1.0])


def proyectar(puntos: np.ndarray, azimut: float, elevacion: float, escala: float,
              centro: tuple[float, float]) -> tuple[np.ndarray, np.ndarray]:
    """Proyección en perspectiva de puntos de escena (N, 3). Devuelve (píxeles (N, 2), profundidad (N,)).

    Con azimut y elevación 0 la vista coincide con la de la cámara: +x a la derecha y +y arriba.
    El centro de la pantalla corresponde al punto (0, ALTURA_CENTRO_M, 0). Mayor profundidad = más cerca.
    """
    p = np.asarray(puntos, dtype=float) - np.array([0.0, ALTURA_CENTRO_M, 0.0])
    a, e = math.radians(azimut), math.radians(elevacion)
    x = p[:, 0] * math.cos(a) + p[:, 2] * math.sin(a)
    z = -p[:, 0] * math.sin(a) + p[:, 2] * math.cos(a)
    y = p[:, 1] * math.cos(e) - z * math.sin(e)
    prof = p[:, 1] * math.sin(e) + z * math.cos(e)
    f = DISTANCIA_M / np.maximum(DISTANCIA_M - prof, 0.5)
    px = np.stack([centro[0] + escala * x * f, centro[1] - escala * y * f], axis=1)
    return px, prof


def azimut_en(t: float) -> float:
    """Vaivén suave de la vista; empieza en 0 (el mismo punto de vista que el video)."""
    return GIRO_GRADOS * math.sin(2 * math.pi * t / GIRO_PERIODO_S)


class Suavizador:
    """One-Euro por coordenada para que los puntos 3D no tiemblen. Un punto oculto reinicia su filtro."""

    def __init__(self):
        self._f = [[OneEuro(min_corte=1.5, beta=2.0) for _ in range(3)] for _ in range(33)]

    def __call__(self, mundo: np.ndarray | None, vis: np.ndarray | None, t: float) -> np.ndarray | None:
        if mundo is None:
            for filtros in self._f:
                for f in filtros:
                    f.reiniciar()
            return None
        out = np.array(mundo, dtype=float, copy=True)
        for i in range(33):
            for k in range(3):
                if vis[i] < UMBRAL_TENUE:
                    self._f[i][k].reiniciar()
                else:
                    out[i, k] = self._f[i][k](float(mundo[i, k]), t)
        return out


class Suelo:
    """Altura del esqueleto sobre el suelo.

    Los puntos "mundo" tienen el origen en las caderas, así que no dicen dónde está el piso. SUPUESTO: el pie
    visible más bajo está apoyado (un salto no se vería). Si no se ve ningún pie, se mantiene la última
    altura; si nunca se vio, no hay suelo.
    """

    def __init__(self):
        self.altura: float | None = None  # cuánto subir los puntos de escena

    def actualizar(self, escena: np.ndarray, vis: np.ndarray, umbral: float) -> float | None:
        visibles = [i for i in PIES if vis[i] >= umbral]
        if visibles:
            self.altura = float(-escena[visibles, 1].min())
        return self.altura


def _linea(img, a, b, color, grosor: int, tenue: bool) -> None:
    if tenue:
        color = tuple(int(0.35 * c + 0.65 * f) for c, f in zip(color, FONDO))
        grosor = max(1, grosor // 3)
    cv2.line(img, a, b, color, grosor, cv2.LINE_AA)


def _huesos(img: np.ndarray, px: np.ndarray, vis: np.ndarray, umbral: float, grosor: int,
            orden: list[int] | None = None) -> None:
    for j in (orden if orden is not None else range(len(CONEXIONES))):
        a, b = CONEXIONES[j]
        e = estilo(min(vis[a], vis[b]), umbral)
        if e != "oculto":
            fino = a <= 10  # cara
            _linea(img, tuple(map(int, px[a])), tuple(map(int, px[b])), color_hueso(a, b),
                   max(1, grosor // 2) if fino else grosor, e == "tenue")
    for i in [0, *range(11, 33)]:
        e = estilo(vis[i], umbral)
        if e != "oculto":
            punto = tuple(map(int, px[i]))
            if e == "solido":
                cv2.circle(img, punto, grosor + 1, color_hueso(i, i), -1, cv2.LINE_AA)
                cv2.circle(img, punto, grosor + 1, (255, 255, 255), 1, cv2.LINE_AA)
            else:
                cv2.circle(img, punto, max(2, grosor - 1), (110, 110, 110), 1, cv2.LINE_AA)


def panel_video(img: np.ndarray, pose, ancho: int, alto: int, umbral: float) -> np.ndarray:
    """Video original (ajustado sin deformar) con los puntos y líneas encima."""
    h, w = img.shape[:2]
    k = min(ancho / w, alto / h)
    nw, nh = max(1, round(w * k)), max(1, round(h * k))
    x0, y0 = (ancho - nw) // 2, (alto - nh) // 2
    panel = np.zeros((alto, ancho, 3), np.uint8)
    panel[:] = FONDO
    reducido = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_LINEAR)
    if pose is not None:
        _huesos(reducido, pose.puntos2d * np.array([nw / w, nh / h]), pose.visibilidad, umbral, 3)
    panel[y0:y0 + nh, x0:x0 + nw] = reducido
    return panel


def panel_3d(mundo: np.ndarray | None, vis: np.ndarray | None, altura: float | None, azimut: float,
             ancho: int, alto: int, umbral: float) -> np.ndarray:
    panel = np.zeros((alto, ancho, 3), np.uint8)
    panel[:] = FONDO
    escala = min(alto / 2.2, ancho / 1.7)
    centro = (ancho / 2.0, alto / 2.0)

    def p2(puntos):
        return proyectar(puntos, azimut, ELEVACION_GRADOS, escala, centro)

    if altura is not None or mundo is None:  # cuadrícula de 1,6 m con líneas cada 0,4 m
        for v in np.linspace(-0.8, 0.8, 5):
            for extremos in ([[v, 0, -0.8], [v, 0, 0.8]], [[-0.8, 0, v], [0.8, 0, v]]):
                px, _ = p2(np.array(extremos))
                cv2.line(panel, tuple(map(int, px[0])), tuple(map(int, px[1])), (80, 66, 52), 1, cv2.LINE_AA)
    if mundo is None:
        _texto(panel, "Sin persona: sin esqueleto", (16, 28), 0.6, (170, 170, 170), 1)
        return panel
    escena = a_escena(mundo)
    # sin ningún pie visto aún no se sabe dónde está el piso: las caderas se centran y no se dibuja el suelo
    escena[:, 1] += altura if altura is not None else ALTURA_CENTRO_M
    px, prof = p2(escena)
    orden = sorted(range(len(CONEXIONES)), key=lambda j: prof[list(CONEXIONES[j])].mean())  # lejos primero
    _huesos(panel, px, vis, umbral, 5, orden)
    if altura is None:
        _texto(panel, "No se ven los pies: sin suelo", (16, 28), 0.55, (170, 170, 170), 1)
    return panel


def componer(img: np.ndarray, pose, mundo: np.ndarray | None, altura: float | None, angulos: dict,
             calidad_txt: str, t: float, umbral: float = 0.6) -> np.ndarray:
    """Cuadro final de 1280x720: video | esqueleto 3D, ángulos abajo y rótulo permanente."""
    h, w = img.shape[:2]
    ancho_video = int(min(780, max(420, ALTO_PANEL * w / h)))
    lienzo = np.zeros((ALTO, ANCHO, 3), np.uint8)
    y0, y1 = ALTO_CABECERA, ALTO_CABECERA + ALTO_PANEL
    lienzo[y0:y1, :ancho_video] = panel_video(img, pose, ancho_video, ALTO_PANEL, umbral)
    vis = pose.visibilidad if pose is not None else None
    azimut = azimut_en(t)
    lienzo[y0:y1, ancho_video:] = panel_3d(mundo, vis, altura, azimut, ANCHO - ancho_video, ALTO_PANEL, umbral)
    cv2.line(lienzo, (ancho_video, 0), (ancho_video, y1), (70, 70, 70), 1)

    _texto(lienzo, f"Video + puntos | calidad: {calidad_txt}", (14, 26), 0.6)
    _texto(lienzo, f"Esqueleto 3D estimado | vista {azimut:+.0f} gr", (ancho_video + 14, 26), 0.6)
    _texto(lienzo, "Supuesto: el pie mas bajo toca el suelo", (ancho_video + 14, y1 - 12), 0.45, (150, 150, 150))

    y = y1 + 28
    _texto(lienzo, "Angulos (grados)", (14, y), 0.55, (190, 190, 190))
    _texto(lienzo, "-- = no se ve bien: sin dato", (260, y), 0.5, (150, 150, 150))
    cv2.line(lienzo, (760, y - 5), (800, y - 5), COLOR_IZQ, 5, cv2.LINE_AA)
    _texto(lienzo, "izquierda", (810, y), 0.55)
    cv2.line(lienzo, (940, y - 5), (980, y - 5), COLOR_DER, 5, cv2.LINE_AA)
    _texto(lienzo, "derecha (de la persona)", (990, y), 0.55)
    columnas = {"codo": 0, "hombro": 1, "cadera": 2, "rodilla": 3}
    for nombre in ANGULOS:
        parte, lado_txt = nombre.split("_")
        x = 14 + columnas[parte] * 318
        fila = y + (36 if lado_txt == "izq" else 68)
        val = angulos.get(nombre)
        color = (120, 120, 120) if val is None else (COLOR_IZQ if lado_txt == "izq" else COLOR_DER)
        _texto(lienzo, ETIQUETA[nombre], (x, fila), 0.65, color)
        _texto(lienzo, "--" if val is None else f"{val:.0f}", (x + 180, fila), 0.8, color, 2)

    cv2.rectangle(lienzo, (0, ALTO - 36), (ANCHO, ALTO), (0, 0, 0), -1)
    tw = cv2.getTextSize(ROTULO, cv2.FONT_HERSHEY_SIMPLEX, 0.65, 1)[0][0]
    _texto(lienzo, ROTULO, ((ANCHO - tw) // 2, ALTO - 12), 0.65, (0, 220, 255))
    return lienzo


def ultima_grabacion(carpeta: Path = CARPETA_GRABACIONES) -> Path | None:
    """La grabación de `grabar` más reciente (las de la sesión en vivo llevan anotaciones y no se usan)."""
    # el nombre lleva fecha y hora; los temporales de una grabación interrumpida se ignoran
    lista = sorted(p for p in carpeta.glob("demo_*.mp4") if not p.name.endswith(".tmp.mp4"))
    return lista[-1] if lista else None


def generar(entrada: Path, salida: Path, modelo: str = "heavy", umbral: float = 0.6, max_cuadros: int = 0,
            delegado: str = "auto") -> dict:
    """Procesa todos los cuadros de `entrada` y escribe el video de demostración en `salida`."""
    if salida.resolve() == entrada.resolve():
        raise ErrorFuente("La salida no puede ser el mismo archivo que la entrada.")
    fuente = abrir_fuente(str(entrada))
    motor, grabador = None, None
    n, detectados, completo = 0, 0, False
    t0 = time.perf_counter()
    try:
        motor = Motor(modelo=modelo, modo="video", delegado=delegado)
        filtro_angulos = FiltroAngulos(min_corte=1.0, beta=0.02)  # el mismo suavizado que en vivo
        suavizador, suelo = Suavizador(), Suelo()
        while not max_cuadros or n < max_cuadros:
            ok, img, t_ms = fuente.leer()
            if not ok:
                break
            t = t_ms / 1000.0 if t_ms is not None else n / fuente.fps
            pose = motor.procesar(img, t_ms).pose
            mundo = None
            if pose is not None:
                calidad_txt = calidad(pose.visibilidad, CUERPO, umbral)[0]
                if pose.mundo is None:
                    crudos = {k: None for k in ANGULOS}
                else:
                    crudos = angulos_articulares(pose.mundo, pose.visibilidad, umbral)
                mundo = suavizador(pose.mundo, pose.visibilidad, t)
                detectados += 1
            else:
                calidad_txt = "sin persona"
                crudos = {k: None for k in ANGULOS}
                suavizador(None, None, t)
            altura = suelo.altura
            if mundo is not None:
                altura = suelo.actualizar(a_escena(mundo), pose.visibilidad, umbral)
            cuadro = componer(img, pose, mundo, altura, filtro_angulos(crudos, t), calidad_txt, t, umbral)
            if grabador is None:
                grabador = Grabador(salida, fuente.fps, (ANCHO, ALTO))
            grabador.escribir(cuadro)
            n += 1
            if n % 50 == 0:
                total = getattr(fuente, "total", 0)
                print(f"  {n}{f'/{total}' if total > 0 else ''} cuadros...", flush=True)
        completo = True
    finally:
        if grabador is not None:
            grabador.cerrar()
            if not completo:
                salida.unlink(missing_ok=True)
        if motor is not None:
            motor.cerrar()
        fuente.cerrar()
    if n == 0:
        raise ErrorFuente(f"No se leyo ningun cuadro de {entrada}.")
    return {"salida": salida, "cuadros": n, "detectados": detectados, "fps": fuente.fps,
            "segundos": time.perf_counter() - t0}


def ejecutar_generar(args) -> int:
    entrada = Path(args.entrada) if args.entrada else ultima_grabacion()
    if entrada is None:
        print(f"Error: no hay grabaciones demo_*.mp4 en {CARPETA_GRABACIONES}. Ejecuta primero "
              "'python -m pose_twin.demo grabar' o indica un video con --in.", file=sys.stderr)
        return 2
    if args.salida:
        salida = Path(args.salida)
    else:
        salida = CARPETA_SALIDAS / f"{entrada.stem}_3d.mp4"
    print(f"Procesando {entrada} | modelo {args.modelo}", flush=True)
    r = generar(entrada, salida, args.modelo, args.umbral_vis, args.max_cuadros, args.delegado)
    print(f"Listo en {r['segundos']:.0f} s: {r['salida'].resolve()}")
    print(f"{r['cuadros']} cuadros ({r['cuadros'] / r['fps']:.1f} s de video), persona en {r['detectados']} "
          f"({100 * r['detectados'] / r['cuadros']:.0f}%)")
    return 0


def construir_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="pose_twin.demo",
                                 description="Video de demostracion: persona y esqueleto 3D, en local.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("grabar", help="graba un video sin anotaciones, con instrucciones en pantalla")
    g.add_argument("--source", default="0", help="indice de camara, URL o archivo de video")
    g.add_argument("--segundos", type=float, default=30.0, help="duracion de la grabacion")
    g.add_argument("--preparacion", type=float, default=PREPARACION_S,
                   help="segundos para colocarse antes de la cuenta regresiva (ESPACIO la adelanta)")
    g.add_argument("--exposicion", type=float, default=None, help="exposicion manual, p. ej. -5 con poca luz")
    g.add_argument("--sin-espejo", action="store_true", help="no refleja la vista previa (el video nunca se refleja)")
    g.add_argument("--out", dest="salida", default=None, help="ruta del video (por defecto data/grabaciones/)")
    v = sub.add_parser("generar", help="crea el video con el esqueleto 3D")
    v.add_argument("--in", dest="entrada", default=None, help="video de entrada (por defecto la ultima grabacion)")
    v.add_argument("--out", dest="salida", default=None, help="ruta de salida (por defecto data/salidas/)")
    v.add_argument("--modelo", choices=["lite", "full", "heavy"], default="heavy")
    v.add_argument("--delegado", choices=["auto", "gpu", "cpu"], default="auto")
    v.add_argument("--umbral-vis", type=float, default=0.6, help="visibilidad minima para dato firme (0-1)")
    v.add_argument("--max-cuadros", type=int, default=0, help="procesa solo los primeros N cuadros (0 = todos)")
    return ap


def main(argv=None) -> int:
    for flujo in (sys.stdout, sys.stderr):  # la consola de Windows usa cp1252 por defecto
        if hasattr(flujo, "reconfigure"):
            flujo.reconfigure(encoding="utf-8", errors="replace")
    args = construir_parser().parse_args(argv)
    try:
        return ejecutar_grabar(args) if args.cmd == "grabar" else ejecutar_generar(args)
    except (ErrorFuente, ErrorModelo) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
