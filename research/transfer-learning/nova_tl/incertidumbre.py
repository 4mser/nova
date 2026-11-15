"""Intervalos por bootstrap de sujetos: se remuestrean personas, no días, porque los días de una persona se parecen.

Todas las métricas de este proyecto son cocientes de sumas (errores, alarmas, eventos), así que cada remuestreo
suma numerador y denominador de los sujetos elegidos y recién ahí divide.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

B = 1000


def pesos(n_sujetos: int, b: int = B, semilla: int = 0) -> np.ndarray:
    """Matriz (b, n_sujetos): cuántas veces sale cada sujeto en cada remuestreo."""
    rng = np.random.default_rng(semilla)
    idx = rng.integers(0, n_sujetos, size=(b, n_sujetos))
    w = np.zeros((b, n_sujetos))
    np.add.at(w, (np.repeat(np.arange(b), n_sujetos), idx.ravel()), 1)
    return w


def matrices(reg: pd.DataFrame, claves: list[str], num: str, den: str) -> tuple[pd.Index, pd.MultiIndex, np.ndarray,
                                                                                np.ndarray]:
    """Numerador y denominador como matrices sujeto × grupo."""
    n = reg.pivot_table(index="sujeto", columns=claves, values=num, aggfunc="sum", fill_value=0)
    d = reg.pivot_table(index="sujeto", columns=claves, values=den, aggfunc="sum", fill_value=0)
    d = d.reindex(index=n.index, columns=n.columns, fill_value=0)
    return n.index, n.columns, n.to_numpy(float), d.to_numpy(float)


def cociente(reg: pd.DataFrame, claves: list[str], num: str, den: str, escala: float = 1.0, b: int = B,
             semilla: int = 0) -> pd.DataFrame:
    """Punto e IC 95 % (percentiles) de sum(num)/sum(den) por grupo."""
    suj, cols, n, d = matrices(reg, claves, num, den)
    w = pesos(len(suj), b, semilla)
    with np.errstate(invalid="ignore", divide="ignore"):
        punto = escala * n.sum(0) / np.where(d.sum(0) > 0, d.sum(0), np.nan)
        rem = escala * (w @ n) / np.where(w @ d > 0, w @ d, np.nan)
    lo, hi = np.nanpercentile(rem, [2.5, 97.5], axis=0) if len(rem) else (np.nan, np.nan)
    out = cols.to_frame(index=False)
    out["valor"], out["ic_bajo"], out["ic_alto"] = punto, lo, hi
    return out


def diferencia(reg_a: pd.DataFrame, reg_b: pd.DataFrame, num: str, den: str, por: str = "variable",
               escala: float = 1.0, b: int = B, semilla: int = 0) -> pd.DataFrame:
    """Diferencia pareada A − B del cociente, por `por`, con los mismos remuestreos para A y B."""
    sujetos = sorted(set(reg_a.sujeto) & set(reg_b.sujeto))
    w = pesos(len(sujetos), b, semilla)
    filas = []
    grupos = sorted(set(reg_a[por]) & set(reg_b[por]))
    for g in grupos:
        def mat(reg):
            t = reg[reg[por] == g].groupby("sujeto")[[num, den]].sum().reindex(sujetos, fill_value=0)
            return t[num].to_numpy(float), t[den].to_numpy(float)
        (na, da), (nb, db) = mat(reg_a), mat(reg_b)
        with np.errstate(invalid="ignore", divide="ignore"):
            punto = escala * (na.sum() / da.sum() - nb.sum() / db.sum())
            rem = escala * ((w @ na) / (w @ da) - (w @ nb) / (w @ db))
        lo, hi = np.nanpercentile(rem, [2.5, 97.5])
        filas.append({por: g, "diferencia": punto, "ic_bajo": lo, "ic_alto": hi})
    return pd.DataFrame(filas)


def diferencia_relativa_media(reg: pd.DataFrame, modelo_a: str, modelo_b: str, referencia: str,
                              variables: list[str], fase: str, b: int = B, semilla: int = 0) -> dict:
    """Pronóstico: diferencia pareada del MAE relativo a `referencia`, promediado entre `variables`.

    `reg` tiene una fila por (modelo, variable, sujeto, fase) con `mae_sum` y `n`.
    """
    r = reg[(reg.fase == fase) & reg.variable.isin(variables)]
    sujetos = sorted(set.intersection(*(set(r[r.modelo == m].sujeto) for m in (modelo_a, modelo_b, referencia))))
    w = pesos(len(sujetos), b, semilla)

    def rel(modelo):
        num, den = [], []
        for v in variables:
            t = r[(r.modelo == modelo) & (r.variable == v)].groupby("sujeto")[["mae_sum", "n"]].sum()
            t = t.reindex(sujetos, fill_value=0)
            num.append(t["mae_sum"].to_numpy(float))
            den.append(t["n"].to_numpy(float))
        return np.array(num).T, np.array(den).T  # sujetos × variables

    (na, da), (nb, db), (nr, dr) = rel(modelo_a), rel(modelo_b), rel(referencia)
    with np.errstate(invalid="ignore", divide="ignore"):
        def media(n, d, w_):
            return np.nanmean(((w_ @ n) / (w_ @ d)) / ((w_ @ nr) / (w_ @ dr)), axis=-1)
        uno = np.ones((1, len(sujetos)))
        punto = float(media(na, da, uno)[0] - media(nb, db, uno)[0])
        rem = media(na, da, w) - media(nb, db, w)
    lo, hi = np.nanpercentile(rem, [2.5, 97.5])
    return {"a": modelo_a, "b": modelo_b, "fase": fase, "diferencia": round(punto, 4), "ic_bajo": round(float(lo), 4),
            "ic_alto": round(float(hi), 4), "sujetos": len(sujetos)}
