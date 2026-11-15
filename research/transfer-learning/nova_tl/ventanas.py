"""Ventanas de pronóstico (contexto C días → horizonte H días) por sujeto y variable, con máscara de observados.

Cada serie es diaria y puede tener huecos. En el contexto, un día sin dato se rellena con el último valor observado
(o el siguiente, al inicio) y queda marcado como no observado; en el objetivo queda en 0 con máscara 0, así la pérdida
y las métricas solo cuentan lo medido. Ningún día del objetivo entra al contexto.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class Ventanas:
    x: np.ndarray  # (N, C) contexto, huecos rellenados
    mx: np.ndarray  # (N, C) 1 = observado
    y: np.ndarray  # (N, H) objetivo, huecos en 0
    my: np.ndarray  # (N, H) 1 = observado
    meta: pd.DataFrame  # sujeto, variable, fuente, campana, dia0, fase0

    def __len__(self) -> int:
        return len(self.x)

    def filtrar(self, mascara: np.ndarray | pd.Series) -> "Ventanas":
        m = np.asarray(mascara, dtype=bool)
        return Ventanas(self.x[m], self.mx[m], self.y[m], self.my[m], self.meta[m].reset_index(drop=True))

    @staticmethod
    def unir(partes: list["Ventanas"]) -> "Ventanas":
        partes = [p for p in partes if len(p)]
        return Ventanas(np.concatenate([p.x for p in partes]), np.concatenate([p.mx for p in partes]),
                        np.concatenate([p.y for p in partes]), np.concatenate([p.my for p in partes]),
                        pd.concat([p.meta for p in partes], ignore_index=True))


def _rellenar(fila: np.ndarray) -> np.ndarray:
    s = pd.Series(fila)
    return s.ffill().bfill().to_numpy()


def construir(largo: pd.DataFrame, C: int, H: int, min_ctx: int = 5, fases_objetivo: set[str] | None = None,
              paso: int = 1, relleno_inicio: bool = False) -> Ventanas:
    """Una ventana por día de inicio del objetivo, para cada (sujeto, variable).

    min_ctx: mínimo de días observados en el contexto. fases_objetivo: fases permitidas para el primer día del
    objetivo (p. ej. {"IN_TEST"}). El objetivo no puede cruzar a otra fase que la de su primer día.
    relleno_inicio: permite ventanas cerca del inicio de la serie, con el contexto completado a la izquierda con días
    no observados (el pre-reposo dura 10 a 21 días y no alcanza para 14 de contexto más 7 de objetivo).
    """
    xs, mxs, ys, mys, metas = [], [], [], [], []
    for (sujeto, variable), g in largo.groupby(["sujeto", "variable"], sort=True):
        g = g.sort_values("dia")
        d0, d1 = int(g["dia"].min()), int(g["dia"].max())
        dias = np.arange(d0, d1 + 1)
        valor = pd.Series(g["valor"].to_numpy(float), index=g["dia"].to_numpy()).reindex(dias).to_numpy()
        fase = pd.Series(g["fase"].to_numpy(), index=g["dia"].to_numpy()).reindex(dias).ffill().bfill().to_numpy()
        obs = ~np.isnan(valor)
        fuente, campana = g["fuente"].iloc[0], g["campana"].iloc[0]
        if relleno_inicio:
            pad = C
            valor = np.r_[np.full(pad, np.nan), valor]
            obs = np.r_[np.zeros(pad, bool), obs]
            fase = np.r_[np.full(pad, fase[0], dtype=object), fase]
            dias = np.r_[np.arange(d0 - pad, d0), dias]
            inicio = pad + 1
        else:
            inicio = C
        for i in range(inicio, len(dias) - H + 1, paso):
            f0 = fase[i]
            if fases_objetivo is not None and f0 not in fases_objetivo:
                continue
            if not (fase[i:i + H] == f0).all():
                continue
            ctx_obs, fut_obs = obs[i - C:i], obs[i:i + H]
            if ctx_obs.sum() < min_ctx or fut_obs.sum() == 0:
                continue
            ctx = valor[i - C:i].copy()
            ctx[~ctx_obs] = np.nan
            xs.append(_rellenar(ctx))
            mxs.append(ctx_obs.astype(np.float32))
            ys.append(np.nan_to_num(valor[i:i + H], nan=0.0))
            mys.append(fut_obs.astype(np.float32))
            metas.append((sujeto, variable, fuente, campana, int(dias[i]), f0))
    meta = pd.DataFrame(metas, columns=["sujeto", "variable", "fuente", "campana", "dia0", "fase0"])
    if not xs:
        z = np.zeros((0, C), np.float32)
        return Ventanas(z, z, np.zeros((0, H), np.float32), np.zeros((0, H), np.float32), meta)
    return Ventanas(np.asarray(xs, np.float32), np.asarray(mxs, np.float32), np.asarray(ys, np.float32),
                    np.asarray(mys, np.float32), meta)


def ruido_por_variable(largo: pd.DataFrame) -> dict[str, float]:
    """Ruido típico de un día a otro por variable: mediana entre personas de la desviación de cada una."""
    sd = largo.groupby(["variable", "sujeto"])["valor"].std().groupby("variable").median()
    return {k: float(max(v, 1e-6)) if np.isfinite(v) else 1.0 for k, v in sd.items()}


def escala(v: Ventanas, ruido: dict[str, float] | None = None) -> np.ndarray:
    """Escala de la pérdida para que no dependa de la unidad.

    Con `ruido`, la de cada variable (estable). Sin él, la desviación del contexto de cada ventana, con piso; esa
    opción explota en series con muchos ceros (minutos activos), por eso el kernel usa `ruido`.
    """
    if ruido is not None:
        faltan = set(v.meta["variable"]) - set(ruido)
        if faltan:
            raise ValueError(f"sin ruido para {sorted(faltan)}")
        return v.meta["variable"].map(ruido).to_numpy(np.float32)
    m = v.mx.astype(bool)
    x = np.where(m, v.x, np.nan)
    sd = np.nanstd(x, axis=1)
    media = np.abs(np.nanmean(x, axis=1))
    return np.maximum(np.nan_to_num(sd, nan=0.0), 0.01 * media + 1e-3).astype(np.float32)
