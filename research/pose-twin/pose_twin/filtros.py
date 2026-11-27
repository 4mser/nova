"""Filtro One-Euro (Casiez, Roussel y Vogel, CHI 2012).

Pasa-bajos con frecuencia de corte adaptativa: suaviza mucho cuando la señal está quieta
(quita temblor) y poco cuando se mueve rápido (menos retraso).
"""
from __future__ import annotations

import math


def _alfa(corte_hz: float, dt: float) -> float:
    tau = 1.0 / (2.0 * math.pi * corte_hz)
    return 1.0 / (1.0 + tau / dt)


class OneEuro:
    def __init__(self, min_corte: float = 1.0, beta: float = 0.02, corte_derivada: float = 1.0):
        self.min_corte = min_corte
        self.beta = beta
        self.corte_derivada = corte_derivada
        self.reiniciar()

    def reiniciar(self) -> None:
        self._x: float | None = None
        self._dx = 0.0
        self._t: float | None = None

    def __call__(self, x: float, t: float) -> float:
        if self._x is None or self._t is None or t <= self._t:
            self._x, self._t, self._dx = x, t, 0.0
            return x
        dt = t - self._t
        dx = (x - self._x) / dt
        a_d = _alfa(self.corte_derivada, dt)
        self._dx = a_d * dx + (1 - a_d) * self._dx
        corte = self.min_corte + self.beta * abs(self._dx)
        a = _alfa(corte, dt)
        self._x = a * x + (1 - a) * self._x
        self._t = t
        return self._x


class FiltroAngulos:
    """Un One-Euro por ángulo. Si un ángulo se abstiene (None), su filtro se reinicia."""

    def __init__(self, **kw):
        self._kw = kw
        self._f: dict[str, OneEuro] = {}

    def __call__(self, angulos: dict[str, float | None], t: float) -> dict[str, float | None]:
        out: dict[str, float | None] = {}
        for n, v in angulos.items():
            f = self._f.setdefault(n, OneEuro(**self._kw))
            if v is None:
                f.reiniciar()
                out[n] = None
            else:
                out[n] = f(v, t)
        return out

    def reiniciar(self) -> None:
        for f in self._f.values():
            f.reiniciar()
