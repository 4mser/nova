"""Señales y poses sintéticas para las pruebas. Solo sirven para probar la lógica; no miden precisión."""
import math
import time
from types import SimpleNamespace

import numpy as np

from pose_twin import sesion as S


def pose_base() -> np.ndarray:
    """33 puntos 3D de una figura de pie."""
    p = np.zeros((33, 3))
    for i, xyz in {11: (.18, -.5, 0), 12: (-.18, -.5, 0), 13: (.25, -.22, .02), 14: (-.25, -.22, .02),
                   15: (.30, .04, .05), 16: (-.30, .04, .05), 23: (.1, 0, 0), 24: (-.1, 0, 0),
                   25: (.11, .42, .01), 26: (-.11, .42, .01), 27: (.12, .82, .03), 28: (-.12, .82, .03)}.items():
        p[i] = xyz
    return p


def doblar_rodillas(pose: np.ndarray, grados: float) -> np.ndarray:
    """Gira las dos piernas (rodilla-tobillo) para flexionar las rodillas esos grados."""
    p = pose.copy()
    r = math.radians(grados)
    for rodilla, tobillo in ((25, 27), (26, 28)):
        largo = float(np.linalg.norm(p[tobillo] - p[rodilla]))
        p[tobillo] = p[rodilla] + largo * np.array([0.0, math.cos(r), math.sin(r)])
    return p


def procesador_falso(monkeypatch, tmp, **kw):
    """Procesador real con motor, reloj y dibujo sustituidos. Devuelve (proc, reloj, salida)."""
    reloj = SimpleNamespace(t=0.0)
    salida = SimpleNamespace(pose=None)

    class MotorFalso:
        def __init__(self, **kw):
            self.enderezar, self.delegado, self.tiempos = False, "cpu", {}

        def procesar(self, img, t_ms):
            return SimpleNamespace(pose=salida.pose, rot_grados=0.0, identidad=1, n_candidatas=1, ms_inferencia=0.0)

        def cerrar(self):
            pass

    monkeypatch.setattr(S, "Motor", MotorFalso)
    monkeypatch.setattr(S, "dibujar", lambda img, estado, umbral: img)
    monkeypatch.setattr(S, "CARPETA_PERFILES", tmp)
    monkeypatch.setattr(S, "CARPETA_SENTADILLAS", tmp / "sentadillas")
    monkeypatch.setattr(S, "time", SimpleNamespace(monotonic=lambda: reloj.t, perf_counter=time.perf_counter,
                                                   strftime=time.strftime))
    return S.Procesador(**kw), reloj, salida


def pose_falsa(mundo: np.ndarray, vis: np.ndarray):
    return SimpleNamespace(puntos2d=mundo[:, :2], visibilidad=vis, mundo=mundo)


def senal(tramos: list[tuple], fps: float = 30.0, ruido: float = 0.0, semilla: int = 0, lados: str = "ambos",
          desfase: float = 0.0) -> list[dict]:
    """Cuadros de ángulos a partir de tramos.

    ("pie", s): de pie (rodilla 170). ("rep", s, minimo): baja y sube con forma de coseno.
    ("media", s, minimo): solo baja y se queda abajo. ("hueco", s): sin rodilla ni cadera (el tramo anterior sigue
    avanzando el reloj). lados: "ambos", "izq" o "der". desfase: grados que se suman al lado derecho.
    """
    rng = np.random.default_rng(semilla)
    cuadros, t = [], 0.0
    for tramo in tramos:
        tipo, dur = tramo[0], tramo[1]
        n = int(round(dur * fps))
        for i in range(n):
            t += 1.0 / fps
            if tipo == "rep":
                rodilla = 170 - (170 - tramo[2]) * (1 - math.cos(2 * math.pi * (i + 1) / n)) / 2
            elif tipo == "media":
                rodilla = 170 - (170 - tramo[2]) * min(1.0, 2 * (i + 1) / n)
            else:
                rodilla = 170.0
            cadera = 175 - (170 - rodilla) * 0.9
            ang = {}
            for lado, extra in (("izq", 0.0), ("der", desfase)):
                visto = tipo != "hueco" and lados in ("ambos", lado)
                for art, v in (("rodilla", rodilla), ("cadera", cadera)):
                    ang[f"{art}_{lado}"] = float(v + extra + rng.normal(0, ruido)) if visto else None
            cuadros.append({"t": t, "angulos": ang})
    return cuadros
