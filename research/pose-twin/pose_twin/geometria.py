"""Geometría pura (sin MediaPipe ni OpenCV de ventana): ángulos, rotación, torso, segmentos.

Convención de imagen: x a la derecha, y hacia abajo, en píxeles.
Convención de índices: los 33 puntos de BlazePose / MediaPipe Pose.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

# Índices BlazePose usados aquí
HOMBRO_I, HOMBRO_D = 11, 12
CODO_I, CODO_D = 13, 14
MUNECA_I, MUNECA_D = 15, 16
CADERA_I, CADERA_D = 23, 24
RODILLA_I, RODILLA_D = 25, 26
TOBILLO_I, TOBILLO_D = 27, 28

# Ángulo articular = ángulo en el vértice (punto central) de la terna (a, vértice, b)
ANGULOS: dict[str, tuple[int, int, int]] = {
    "codo_izq": (HOMBRO_I, CODO_I, MUNECA_I),
    "codo_der": (HOMBRO_D, CODO_D, MUNECA_D),
    "hombro_izq": (CODO_I, HOMBRO_I, CADERA_I),
    "hombro_der": (CODO_D, HOMBRO_D, CADERA_D),
    "cadera_izq": (HOMBRO_I, CADERA_I, RODILLA_I),
    "cadera_der": (HOMBRO_D, CADERA_D, RODILLA_D),
    "rodilla_izq": (CADERA_I, RODILLA_I, TOBILLO_I),
    "rodilla_der": (CADERA_D, RODILLA_D, TOBILLO_D),
}

# Segmentos corporales para el perfil (pares de índices; "torso" se trata aparte)
SEGMENTOS: dict[str, tuple[int, int]] = {
    "brazo_izq": (HOMBRO_I, CODO_I),
    "brazo_der": (HOMBRO_D, CODO_D),
    "antebrazo_izq": (CODO_I, MUNECA_I),
    "antebrazo_der": (CODO_D, MUNECA_D),
    "muslo_izq": (CADERA_I, RODILLA_I),
    "muslo_der": (CADERA_D, RODILLA_D),
    "pierna_izq": (RODILLA_I, TOBILLO_I),
    "pierna_der": (RODILLA_D, TOBILLO_D),
    "ancho_hombros": (HOMBRO_I, HOMBRO_D),
    "ancho_caderas": (CADERA_I, CADERA_D),
}

# Conexiones para dibujar el esqueleto (subconjunto del cuerpo, sin cara fina)
CONEXIONES: list[tuple[int, int]] = [
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
    (11, 23), (12, 24), (23, 24), (23, 25), (25, 27), (24, 26), (26, 28),
    (27, 29), (29, 31), (27, 31), (28, 30), (30, 32), (28, 32),
    (15, 17), (15, 19), (15, 21), (16, 18), (16, 20), (16, 22),
    (0, 2), (0, 5), (2, 7), (5, 8), (9, 10),
]

# Puntos del cuerpo usados para calidad y selección (hombros, codos, muñecas, caderas, rodillas, tobillos)
CUERPO = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]


def angulo_vertice(a, v, b) -> float:
    """Ángulo en grados (0-180) en el vértice v formado por a-v-b. Sirve en 2D o 3D."""
    a, v, b = (np.asarray(p, dtype=float) for p in (a, v, b))
    u, w = a - v, b - v
    nu, nw = np.linalg.norm(u), np.linalg.norm(w)
    if nu < 1e-9 or nw < 1e-9:
        return float("nan")
    c = float(np.clip(np.dot(u, w) / (nu * nw), -1.0, 1.0))
    return math.degrees(math.acos(c))


def angulos_articulares(
    puntos: np.ndarray,
    visibilidad: np.ndarray,
    umbral: float = 0.6,
) -> dict[str, float | None]:
    """Ángulos de codos, hombros, caderas y rodillas.

    ABSTENCIÓN: si la visibilidad mínima de los tres puntos de la terna es menor que
    `umbral`, el ángulo es None (no se muestra ni se registra).
    """
    res: dict[str, float | None] = {}
    for nombre, (a, v, b) in ANGULOS.items():
        if min(visibilidad[a], visibilidad[v], visibilidad[b]) < umbral:
            res[nombre] = None
            continue
        ang = angulo_vertice(puntos[a], puntos[v], puntos[b])
        res[nombre] = None if math.isnan(ang) else ang
    return res


def angulo_torso(puntos2d: np.ndarray) -> float:
    """Inclinación del torso en la imagen, en grados.

    0 = de pie (hombros sobre caderas). Positivo = la parte de arriba del torso se inclina
    hacia la derecha de la imagen (giro horario visto en pantalla). Rango (-180, 180].
    """
    hombros = (puntos2d[HOMBRO_I] + puntos2d[HOMBRO_D]) / 2.0
    caderas = (puntos2d[CADERA_I] + puntos2d[CADERA_D]) / 2.0
    dx, dy = hombros[0] - caderas[0], hombros[1] - caderas[1]
    return math.degrees(math.atan2(dx, -dy))


@dataclass(frozen=True)
class Rotacion:
    """Rotación de imagen con lienzo ampliado (no recorta). M: original -> rotada (2x3)."""

    M: np.ndarray
    Minv: np.ndarray
    ancho: int
    alto: int
    grados: float


def rotacion_lienzo(ancho: int, alto: int, grados: float, cuadrado: bool = False) -> Rotacion:
    """Matriz que gira una imagen `grados` en sentido antihorario (visto en pantalla).

    Amplía el lienzo para que no se pierda ninguna parte. Para enderezar un torso con
    inclinación `angulo_torso = t`, usar `grados = t` (gira antihorario lo que se inclinó horario).
    Con `cuadrado=True` el lienzo es siempre de lado = diagonal, así su tamaño no cambia con el
    ángulo (útil para el modo de video de MediaPipe).
    """
    cx, cy = ancho / 2.0, alto / 2.0
    r = math.radians(grados)
    c, s = math.cos(r), math.sin(r)
    if cuadrado:
        nuevo_w = nuevo_h = int(math.ceil(math.hypot(ancho, alto)))
    else:
        nuevo_w = int(math.ceil(abs(ancho * c) + abs(alto * s)))
        nuevo_h = int(math.ceil(abs(ancho * s) + abs(alto * c)))
    # Igual que cv2.getRotationMatrix2D(centro, grados, 1) pero sin depender de cv2
    M = np.array([[c, s, (1 - c) * cx - s * cy], [-s, c, s * cx + (1 - c) * cy]], dtype=float)
    M[0, 2] += nuevo_w / 2.0 - cx
    M[1, 2] += nuevo_h / 2.0 - cy
    return Rotacion(M=M, Minv=invertir_afin(M), ancho=nuevo_w, alto=nuevo_h, grados=grados)


def invertir_afin(M: np.ndarray) -> np.ndarray:
    A, t = M[:, :2], M[:, 2]
    Ai = np.linalg.inv(A)
    return np.hstack([Ai, (-Ai @ t)[:, None]])


def aplicar_afin(M: np.ndarray, puntos: np.ndarray) -> np.ndarray:
    """Aplica una afín 2x3 a puntos Nx2."""
    p = np.asarray(puntos, dtype=float)
    return p @ M[:, :2].T + M[:, 2]


def desrotar_mundo(mundo: np.ndarray, rot: Rotacion) -> np.ndarray:
    """Devuelve los puntos 3D (x der, y abajo, z prof.) al marco de la imagen original.

    La rotación de imagen es un giro alrededor del eje óptico (z), así que solo cambian x, y.
    """
    R_inv = rot.Minv[:, :2]
    out = np.array(mundo, dtype=float, copy=True)
    out[:, :2] = mundo[:, :2] @ R_inv.T
    return out


def longitudes_segmentos(mundo: np.ndarray) -> dict[str, float]:
    """Longitud de cada segmento en las unidades de `mundo` (metros en MediaPipe)."""
    res = {n: float(np.linalg.norm(mundo[a] - mundo[b])) for n, (a, b) in SEGMENTOS.items()}
    hombros = (mundo[HOMBRO_I] + mundo[HOMBRO_D]) / 2.0
    caderas = (mundo[CADERA_I] + mundo[CADERA_D]) / 2.0
    res["torso"] = float(np.linalg.norm(hombros - caderas))
    return res


def caja(puntos2d: np.ndarray, visibilidad: np.ndarray, umbral: float = 0.3) -> tuple[float, float, float, float] | None:
    """Caja (x0, y0, x1, y1) de los puntos del cuerpo visibles; None si no hay suficientes."""
    idx = [i for i in CUERPO if visibilidad[i] >= umbral]
    if len(idx) < 3:
        idx = CUERPO
    p = puntos2d[idx]
    return float(p[:, 0].min()), float(p[:, 1].min()), float(p[:, 0].max()), float(p[:, 1].max())


def iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0
