"""Fuentes de cuadros: cámara, archivo de video, imagen, URL o teléfono."""
from __future__ import annotations

import sys
import threading
import time
from collections import deque
from pathlib import Path

import cv2
import numpy as np

EXT_IMAGEN = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


class ErrorFuente(RuntimeError):
    pass


class Fuente:
    nombre = "fuente"
    es_archivo = False
    fps = 30.0

    def leer(self) -> tuple[bool, np.ndarray | None, int | None]:
        """(ok, cuadro BGR, tiempo en ms o None para usar el reloj)."""
        raise NotImplementedError

    def responder(self, estado_json: dict) -> None:  # solo el teléfono lo usa
        pass

    def comandos(self) -> list[str]:  # órdenes remotas (teléfono): grabar, calibrar, enderezar
        return []

    def cerrar(self) -> None:
        pass


class FuenteCaptura(Fuente):
    def __init__(self, cap: cv2.VideoCapture, nombre: str, es_archivo: bool):
        self.cap = cap
        self.nombre = nombre
        self.es_archivo = es_archivo
        f = cap.get(cv2.CAP_PROP_FPS)
        self.fps = f if f and 1 <= f <= 240 else 30.0
        self.total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        self._i = 0

    def leer(self):
        ok, cuadro = self.cap.read()
        if not ok:
            return False, None, None
        self._i += 1
        t = int(self._i * 1000 / self.fps) if self.es_archivo else None
        return True, cuadro, t

    def cerrar(self):
        self.cap.release()


class FuenteImagen(Fuente):
    """Una imagen repetida como si fuera video (sirve para probar sin cámara)."""

    es_archivo = True

    def __init__(self, ruta: Path, repeticiones: int | None = None):
        img = cv2.imread(str(ruta))
        if img is None:
            raise ErrorFuente(f"No se pudo leer la imagen {ruta}.")
        self.img = img
        self.nombre = ruta.name
        self.repeticiones = repeticiones
        self.total = repeticiones or 0
        self._i = 0

    def leer(self):
        if self.repeticiones is not None and self._i >= self.repeticiones:
            return False, None, None
        self._i += 1
        return True, self.img.copy(), int(self._i * 1000 / self.fps)


BACKENDS = {"auto": None, "dshow": cv2.CAP_DSHOW, "msmf": cv2.CAP_MSMF, "any": cv2.CAP_ANY}


def _fourcc_texto(cap: cv2.VideoCapture) -> str:
    v = int(cap.get(cv2.CAP_PROP_FOURCC) or 0)
    txt = "".join(chr((v >> 8 * i) & 0xFF) for i in range(4))
    return txt if txt.isprintable() and txt.strip() else f"0x{v:08x}"


def _configurar(cap: cv2.VideoCapture, ancho: int | None, alto: int | None, fps: float | None,
                fourcc: str | None, exposicion: float | None) -> None:
    if fourcc:  # antes del tamaño: algunos drivers solo aceptan el formato con la cámara sin configurar
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*fourcc[:4].ljust(4)))
    if ancho:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, ancho)
    if alto:
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, alto)
    if fps:
        cap.set(cv2.CAP_PROP_FPS, fps)
    if exposicion is not None:
        # DSHOW/MSMF: 0.25 = manual; la exposición va en log2(segundos): -5 = 1/32 s, -4 = 1/16 s
        cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.25)
        cap.set(cv2.CAP_PROP_EXPOSURE, exposicion)
        if not (ancho or alto):
            # DSHOW solo aplica el nuevo intervalo entre cuadros al renegociar el formato (medido en esta webcam)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cap.get(cv2.CAP_PROP_FRAME_HEIGHT))


def restaurar_exposicion_automatica(cap: cv2.VideoCapture) -> None:
    """El driver recuerda la exposición manual aun después de cerrar: hay que devolverla a automática."""
    cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.75)


def _abrir_camara(indice: int, backend: str = "auto", ancho: int | None = None, alto: int | None = None,
                  fps: float | None = None, fourcc: str | None = None, exposicion: float | None = None) -> cv2.VideoCapture:
    if backend not in BACKENDS:
        raise ErrorFuente(f"Backend desconocido '{backend}'. Usa: {', '.join(BACKENDS)}.")
    if backend == "auto":
        backends = [cv2.CAP_DSHOW, cv2.CAP_MSMF] if sys.platform == "win32" else [cv2.CAP_ANY]
    else:
        backends = [BACKENDS[backend]]
    for b in backends:
        cap = cv2.VideoCapture(indice, b)
        if cap.isOpened():
            _configurar(cap, ancho, alto, fps, fourcc, exposicion)
            ok, _ = cap.read()
            if ok:
                return cap
            if exposicion is not None:
                restaurar_exposicion_automatica(cap)
        cap.release()
    raise ErrorFuente(
        f"No se pudo abrir la cámara {indice}. Windows no la reporta o está en uso por otra aplicación.\n"
        f"  - Revisa Configuración > Privacidad > Cámara y el Administrador de dispositivos.\n"
        f"  - Prueba otro índice (--source 1) o usa el teléfono: --source telefono\n"
        f"  - Para probar sin cámara: --source data\\muestras\\sentadilla.webm"
    )


class FuenteCamaraHilo(FuenteCaptura):
    """Cámara leída en un hilo aparte que se queda solo con el último cuadro.

    Así el bucle principal no espera a la cámara mientras infiere y nunca procesa cuadros viejos
    acumulados en el búfer del driver. `ultimo_t_captura` es el instante en que llegó el cuadro.
    """

    def __init__(self, cap: cv2.VideoCapture, nombre: str, restaurar_exposicion: bool = False,
                 max_fallos: int = 30):
        super().__init__(cap, nombre, es_archivo=False)
        self.restaurar_exposicion = restaurar_exposicion
        self.max_fallos = max_fallos
        self.ultimo_t_captura: float | None = None
        self.descartados = 0  # cuadros que llegaron y nadie alcanzó a procesar
        self._cond = threading.Condition()
        self._cuadro: np.ndarray | None = None
        self._t: float | None = None
        self._seq = 0
        self._entregado = 0
        self._vivo = True
        self._llegadas: deque[float] = deque(maxlen=61)
        self._hilo = threading.Thread(target=self._correr, daemon=True, name="captura-camara")
        self._hilo.start()

    def _correr(self) -> None:
        fallos = 0
        while self._vivo:
            ok, cuadro = self.cap.read()
            t = time.perf_counter()
            with self._cond:
                if not ok or cuadro is None:
                    fallos += 1
                    if fallos >= self.max_fallos:
                        self._vivo = False
                        self._cond.notify_all()
                    continue
                fallos = 0
                if self._seq > self._entregado:
                    self.descartados += 1
                self._cuadro, self._t = cuadro, t
                self._seq += 1
                self._llegadas.append(t)
                self._cond.notify_all()

    @property
    def fps_entrega(self) -> float:
        """Cuadros por segundo que entrega la cámara (mediana de los últimos 60 intervalos)."""
        with self._cond:
            ts = list(self._llegadas)
        if len(ts) < 2:
            return 0.0
        dt = float(np.median(np.diff(ts)))
        return 1.0 / dt if dt > 0 else 0.0

    def leer(self, espera_s: float = 2.0):
        with self._cond:
            self._cond.wait_for(lambda: self._seq > self._entregado or not self._vivo, espera_s)
            if self._seq > self._entregado:
                self._entregado = self._seq
                self.ultimo_t_captura = self._t
                return True, self._cuadro, None
            if not self._vivo:
                return False, None, None  # la cámara dejó de entregar cuadros
            return True, None, None  # sin cuadro nuevo todavía

    def cerrar(self) -> None:
        self._vivo = False
        self._hilo.join(timeout=3)
        if self.restaurar_exposicion:
            restaurar_exposicion_automatica(self.cap)
        self.cap.release()


def describir_camara(cap: cv2.VideoCapture) -> str:
    if not hasattr(cap, "getBackendName"):
        return "sin datos del driver"
    return (f"{int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))} "
            f"backend {cap.getBackendName()} formato {_fourcc_texto(cap)} fps pedido {cap.get(cv2.CAP_PROP_FPS):.0f}")


def abrir_fuente(spec: str, captura: str = "hilo", backend: str = "auto", ancho: int | None = None,
                 alto: int | None = None, fps_camara: float | None = None, fourcc: str | None = None,
                 exposicion: float | None = None, **kw) -> Fuente:
    """captura='hilo' lee la cámara en un hilo aparte (último cuadro); 'directa' lee en el bucle principal."""
    spec = str(spec).strip()
    if spec.lower() in {"telefono", "teléfono", "phone"}:
        from .telefono import FuenteTelefono

        return FuenteTelefono(**kw)
    if spec.isdigit():
        cap = _abrir_camara(int(spec), backend, ancho, alto, fps_camara, fourcc, exposicion)
        if captura == "hilo":
            return FuenteCamaraHilo(cap, f"camara {spec}", restaurar_exposicion=exposicion is not None)
        return FuenteCaptura(cap, f"camara {spec}", es_archivo=False)
    if "://" in spec:
        cap = cv2.VideoCapture(spec)
        if not cap.isOpened():
            raise ErrorFuente(f"No se pudo abrir la URL {spec}. Revisa que el flujo esté activo y accesible.")
        if captura == "hilo":  # en flujos de red también conviene quedarse con el último cuadro
            return FuenteCamaraHilo(cap, spec)
        return FuenteCaptura(cap, spec, es_archivo=False)
    ruta = Path(spec)
    if not ruta.exists():
        raise ErrorFuente(f"No existe el archivo {ruta.resolve()}.")
    if ruta.suffix.lower() in EXT_IMAGEN:
        return FuenteImagen(ruta, kw.get("repeticiones"))
    cap = cv2.VideoCapture(str(ruta))
    if not cap.isOpened():
        raise ErrorFuente(f"OpenCV no pudo abrir el video {ruta}. Prueba convertirlo a mp4 (H.264).")
    return FuenteCaptura(cap, ruta.name, es_archivo=True)


class Reloj:
    """FPS (media móvil exponencial) del bucle."""

    def __init__(self):
        self._t = None
        self.fps = 0.0

    def tic(self) -> float:
        t = time.perf_counter()
        if self._t is not None:
            dt = t - self._t
            if dt > 0:
                inst = 1.0 / dt
                self.fps = inst if self.fps == 0 else 0.9 * self.fps + 0.1 * inst
        self._t = t
        return self.fps
