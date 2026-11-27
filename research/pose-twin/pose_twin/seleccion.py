"""Selección de UNA persona y continuidad de identidad entre cuadros.

Primera vez: se fija la persona más grande, visible y centrada.
Luego: se elige la candidata más cercana (IoU de cajas + distancia de centros normalizada
por el tamaño de la persona). Si ninguna pasa la compuerta durante `max_perdidos` cuadros,
se libera la identidad y se vuelve a fijar.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .geometria import CUERPO, caja, iou


@dataclass
class Candidata:
    puntos2d: np.ndarray  # (33, 2) píxeles en la imagen original
    visibilidad: np.ndarray  # (33,)


def _centro_tam(c):
    x0, y0, x1, y1 = c
    return np.array([(x0 + x1) / 2, (y0 + y1) / 2]), max(x1 - x0, y1 - y0, 1.0)


def puntaje_inicial(cand: Candidata, ancho: int, alto: int) -> float:
    c = caja(cand.puntos2d, cand.visibilidad)
    centro, tam = _centro_tam(c)
    vis = float(np.mean(cand.visibilidad[CUERPO]))
    diag = float(np.hypot(ancho, alto))
    dist_centro = float(np.linalg.norm(centro - np.array([ancho / 2, alto / 2]))) / diag
    return (tam / diag) * vis - 0.5 * dist_centro


class Seguidor:
    def __init__(self, compuerta: float = 0.6, max_perdidos: int = 15):
        self.compuerta = compuerta
        self.max_perdidos = max_perdidos
        self.caja_previa: tuple | None = None
        self.perdidos = 0
        self.identidad = 0  # sube cada vez que se fija una persona nueva

    @property
    def fijado(self) -> bool:
        return self.caja_previa is not None

    def elegir(self, candidatas: list[Candidata], ancho: int, alto: int) -> int | None:
        """Índice de la candidata que corresponde a la persona seguida, o None."""
        if not candidatas:
            self._perder()
            return None
        if self.caja_previa is None:
            i = int(np.argmax([puntaje_inicial(c, ancho, alto) for c in candidatas]))
            self._fijar(candidatas[i], nueva=True)
            return i
        c_prev, tam_prev = _centro_tam(self.caja_previa)
        mejor, mejor_costo = None, float("inf")
        for i, cand in enumerate(candidatas):
            cj = caja(cand.puntos2d, cand.visibilidad)
            centro, _ = _centro_tam(cj)
            dist = float(np.linalg.norm(centro - c_prev)) / tam_prev
            costo = dist - iou(cj, self.caja_previa)
            if dist <= self.compuerta and costo < mejor_costo:
                mejor, mejor_costo = i, costo
        if mejor is None:
            self._perder()
            return None
        self._fijar(candidatas[mejor], nueva=False)
        return mejor

    def _fijar(self, cand: Candidata, nueva: bool) -> None:
        if nueva:
            self.identidad += 1
        self.caja_previa = caja(cand.puntos2d, cand.visibilidad)
        self.perdidos = 0

    def _perder(self) -> None:
        if self.caja_previa is None:
            return
        self.perdidos += 1
        if self.perdidos > self.max_perdidos:
            self.caja_previa = None
            self.perdidos = 0

    def liberar(self) -> None:
        self.caja_previa = None
        self.perdidos = 0
