"""Baselines obligatorios (NOVA_CONTEXT §6.1): persistencia y media de los últimos 7 días observados."""

from __future__ import annotations

import numpy as np

from nova_tl.ventanas import Ventanas


def persistencia(v: Ventanas) -> np.ndarray:
    """Último valor observado del contexto, repetido en todo el horizonte."""
    H = v.y.shape[1]
    ult = np.array([x[m.astype(bool)][-1] for x, m in zip(v.x, v.mx)], dtype=np.float32)
    return np.repeat(ult[:, None], H, axis=1)


def media7(v: Ventanas) -> np.ndarray:
    H = v.y.shape[1]
    out = []
    for x, m in zip(v.x, v.mx):
        obs = x[m.astype(bool)]
        out.append(obs[-7:].mean())
    return np.repeat(np.asarray(out, np.float32)[:, None], H, axis=1)


def mae(yhat: np.ndarray, v: Ventanas) -> np.ndarray:
    """Error absoluto medio por ventana, solo sobre días observados del objetivo."""
    e = np.abs(yhat - v.y) * v.my
    return e.sum(axis=1) / v.my.sum(axis=1)
