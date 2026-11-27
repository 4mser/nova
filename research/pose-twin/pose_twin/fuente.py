"""Fuentes de cuadros: cámara, archivo de video, imagen, URL o teléfono."""
from __future__ import annotations

import sys
import time
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


def _abrir_camara(indice: int) -> cv2.VideoCapture:
    backends = [cv2.CAP_DSHOW, cv2.CAP_MSMF] if sys.platform == "win32" else [cv2.CAP_ANY]
    for b in backends:
        cap = cv2.VideoCapture(indice, b)
        if cap.isOpened():
            ok, _ = cap.read()
            if ok:
                return cap
        cap.release()
    raise ErrorFuente(
        f"No se pudo abrir la cámara {indice}. Windows no la reporta o está en uso por otra aplicación.\n"
        f"  - Revisa Configuración > Privacidad > Cámara y el Administrador de dispositivos.\n"
        f"  - Prueba otro índice (--source 1) o usa el teléfono: --source telefono\n"
        f"  - Para probar sin cámara: --source data\\muestras\\sentadilla.webm"
    )


def abrir_fuente(spec: str, **kw) -> Fuente:
    spec = str(spec).strip()
    if spec.lower() in {"telefono", "teléfono", "phone"}:
        from .telefono import FuenteTelefono

        return FuenteTelefono(**kw)
    if spec.isdigit():
        return FuenteCaptura(_abrir_camara(int(spec)), f"camara {spec}", es_archivo=False)
    if "://" in spec:
        cap = cv2.VideoCapture(spec)
        if not cap.isOpened():
            raise ErrorFuente(f"No se pudo abrir la URL {spec}. Revisa que el flujo esté activo y accesible.")
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
