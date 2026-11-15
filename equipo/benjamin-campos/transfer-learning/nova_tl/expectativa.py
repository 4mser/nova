"""Rango esperado en vuelo: el modelo residual de NOVA_CONTEXT §6.2, aplicado a la línea base personal.

    esperado(sujeto, variable, día) = línea base de Tierra (media del pre-reposo)
                                    + Δ_población(día)         ← aprendido del reposo de OTRAS personas
                                    + δ_personal(k)            ← primeros k días en cama de esta persona

Se evalúa con validación por sujetos (los de prueba nunca entran al ajuste), sobre los días de reposo desde
`DIA_EVAL` en adelante, para que todos los k se comparen en el mismo tramo. Por ahora no se propone como el
rango `ESPERADO_VUELO` de `nave/docs/umbrales.md` (PREGUNTAS.md, 15); los umbrales fijos de emergencia no se tocan.

Cómo se comparan los modelos sin hacerse trampa:
- Centro y ancho se separan. «tierra» usa ±1,96·sd del pre-reposo; «tierra (ancho calibrado)» usa el mismo centro con
  el ancho calibrado como los adaptados; «adaptado (ancho de Tierra)» usa el centro adaptado con ±1,96·sd. Así se ve
  cuánto de la mejora es el centro y cuánto es solo calibrar el ancho.
- El ancho calibrado sale de residuos fuera de muestra: validación cruzada por sujetos dentro de los de entrenamiento.
- Falsas alarmas y detección se miden con la misma regla («≥ 2 de 3 días seguidos fuera»), sobre días de calendario.
- Los escalones inyectados tienen signo al azar y se informa la detección a favor y en contra de la deriva del reposo.
- El placebo aplica la regla de Tierra dentro del propio pre-reposo (dejando un día fuera): es el piso de falsas
  alarmas de esa regla sin ningún efecto del reposo.

Constantes fijadas a mano y sin barrido: DIA_EVAL, KAPPA, el alpha del ridge y las magnitudes de ANOMALIAS.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.linear_model import Ridge

from nova_tl import incertidumbre
from nova_tl.variables import TITULAR

DIA_EVAL = 28
KS = (0, 3, 7, 14, 21, 28)
KAPPA = 3.0  # contracción del ajuste personal: peso n/(n+KAPPA)
Z = 1.96
MIN_PRE = 3  # días de pre-reposo mínimos para tener línea base
GRUPOS_CV = 4  # validación cruzada por sujetos dentro de los de entrenamiento, para calibrar el ancho

# Magnitud de los escalones de 3 días inyectados para medir detección; el signo se sortea. Fuente: umbrales.md
# («pulso en reposo +10 lpm en 3 días»); el resto es SUPUESTO, elegido como un cambio clínicamente notable.
ANOMALIAS = {"pulso": 10.0, "pa_sis": 15.0, "pa_dia": 10.0, "fr": 4.0, "temp": 0.8, "peso": 1.5,
             "diuresis": 1000.0, "agua": 1000.0}

# nombre, usa corrector poblacional, k evaluados, tipo de ancho
MODELOS = (
    ("tierra", False, (0,), "tierra"),
    ("tierra (ancho calibrado)", False, (0,), "calibrado"),
    ("tierra+personal", False, KS[1:], "calibrado"),
    ("tierra+poblacion", True, (0,), "calibrado"),
    ("tierra+poblacion+personal", True, KS[1:], "calibrado"),
    ("adaptado (ancho de Tierra)", True, (28,), "tierra"),
)
ADAPTADO = ("tierra+poblacion+personal", 28)


# ── Línea base y corrector ────────────────────────────────────────────────────────────────────────────────────────

def linea_base(largo: pd.DataFrame, sujetos_piso: list[str] | None = None) -> pd.DataFrame:
    """Media y desviación del pre-reposo por sujeto y variable.

    La desviación tiene un piso (media de las medianas por variable): con 10 a 21 días, una sd casualmente chica
    dispararía alarmas. El piso se calcula solo con `sujetos_piso` (los de entrenamiento) si se entregan.
    """
    pre = largo[largo.fase == "PRE_TEST"]
    lb = pre.groupby(["sujeto", "variable"])["valor"].agg(media_pre="mean", sd_pre="std", n_pre="size").reset_index()
    lb = lb[lb["n_pre"] >= MIN_PRE].copy()
    ref = lb[lb.sujeto.isin(sujetos_piso)] if sujetos_piso is not None else lb
    piso = lb["variable"].map(ref.groupby("variable")["sd_pre"].median() * 0.5)
    lb["sd_pre"] = np.fmax(lb["sd_pre"], piso)
    return lb.dropna(subset=["sd_pre"]).reset_index(drop=True)


def rasgos(dia: np.ndarray) -> np.ndarray:
    d = np.maximum(np.asarray(dia, float), 0)
    return np.column_stack([np.log1p(d), d / 30.0])


def _en_reposo(largo: pd.DataFrame, lb: pd.DataFrame) -> pd.DataFrame:
    r = largo[largo.fase == "IN_TEST"].merge(lb, on=["sujeto", "variable"], how="inner")
    r["resid"] = r["valor"] - r["media_pre"]
    return r.reset_index(drop=True)


def ajustar_poblacion(r_train: pd.DataFrame) -> dict[str, Ridge]:
    return {v: Ridge(alpha=1.0).fit(rasgos(g["dia"]), g["resid"]) for v, g in r_train.groupby("variable")}


def delta_poblacion(modelos: dict[str, Ridge], r: pd.DataFrame) -> np.ndarray:
    out = np.zeros(len(r))
    for v, idx in r.groupby("variable").groups.items():
        if v in modelos:
            pos = r.index.get_indexer(idx)
            out[pos] = modelos[v].predict(rasgos(r.loc[idx, "dia"]))
    return out


def delta_personal(r: pd.DataFrame, columna: str, k: int) -> pd.Series:
    """Media contraída del residuo en los días [0, k) de cada sujeto y variable; 0 si k = 0."""
    if k == 0:
        return pd.Series(0.0, index=r.index)
    prim = r[r["dia"] < k].groupby(["sujeto", "variable"])[columna].agg(["mean", "size"])
    prim["delta"] = prim["mean"] * prim["size"] / (prim["size"] + KAPPA)
    return r.join(prim["delta"], on=["sujeto", "variable"])["delta"].fillna(0.0)


def predecir(r: pd.DataFrame, modelos: dict[str, Ridge] | None, k: int) -> pd.Series:
    pop = delta_poblacion(modelos, r) if modelos else np.zeros(len(r))
    r = r.assign(_pop=pop, _res_pop=r["resid"] - pop)
    return r["media_pre"] + r["_pop"] + delta_personal(r, "_res_pop", k)


# ── Días de calendario ────────────────────────────────────────────────────────────────────────────────────────────

def _clave(r: pd.DataFrame, lag: int = 0) -> pd.MultiIndex:
    return pd.MultiIndex.from_arrays([r["sujeto"].to_numpy(), r["variable"].to_numpy(), r["dia"].to_numpy() - lag])


def _ventana3(r: pd.DataFrame, x) -> np.ndarray:
    """(n, 3): el valor de x en los días d−2, d−1 y d de cada fila; NaN si ese día no se midió."""
    s = pd.Series(np.asarray(x, float), index=_clave(r))
    if s.index.has_duplicates:
        raise ValueError("hay más de una medición por sujeto, variable y día")
    return np.column_stack([s.reindex(_clave(r, lag)).to_numpy() for lag in (2, 1, 0)])


def media3(r: pd.DataFrame, resid) -> pd.Series:
    """Media de 3 días de calendario seguidos que terminan en el día de la fila (la regla de tendencias de
    umbrales.md). NaN si falta alguno de los 3 días."""
    return pd.Series(_ventana3(r, resid).mean(axis=1), index=r.index)


def regla_2de3(r: pd.DataFrame, fuera) -> pd.Series:
    """1 si al menos 2 de los 3 días seguidos que terminan en el día de la fila están fuera; NaN si falta un día."""
    v = _ventana3(r, np.asarray(fuera, float))
    completo = ~np.isnan(v).any(axis=1)
    return pd.Series(np.where(completo, (np.nan_to_num(v).sum(axis=1) >= 2).astype(float), np.nan), index=r.index)


# ── Ancho calibrado y anomalías ────────────────────────────────────────────────────────────────────────────────────

def _pred_cv(r_train: pd.DataFrame, con_poblacion: bool, k: int, semilla: int) -> pd.Series:
    """Predicción fuera de muestra para cada sujeto de entrenamiento (CV por sujetos)."""
    sujetos = np.array(sorted(r_train.sujeto.unique()))
    perm = np.random.default_rng(semilla).permutation(sujetos)
    pred = pd.Series(np.nan, index=r_train.index)
    for i in range(GRUPOS_CV):
        fuera = r_train.sujeto.isin(set(perm[i::GRUPOS_CV]))
        if not fuera.any():
            continue
        mods = ajustar_poblacion(r_train[~fuera]) if con_poblacion else None
        b = r_train[fuera]
        pred[b.index] = predecir(b, mods, k).to_numpy()
    return pred


def anchos(r_train: pd.DataFrame, con_poblacion: bool, k: int, semilla: int = 0) -> tuple[pd.Series, pd.Series]:
    """Cuantil 95 % del error absoluto (diario y de la media de 3 días), por variable, con residuos fuera de muestra."""
    res = r_train["valor"] - _pred_cv(r_train, con_poblacion, k, semilla)
    ev = r_train["dia"] >= DIA_EVAL
    a1 = res.abs()[ev].groupby(r_train.loc[ev, "variable"]).quantile(0.95)
    m3 = media3(r_train, res).abs()
    ev3 = (r_train["dia"] >= DIA_EVAL + 2) & m3.notna()
    a3 = m3[ev3].groupby(r_train.loc[ev3, "variable"]).quantile(0.95)
    return a1, a3


def deriva(r_train: pd.DataFrame) -> dict[str, int]:
    """Signo del cambio medio en reposo (día ≥ DIA_EVAL) respecto del pre-reposo, por variable."""
    ev = r_train[r_train["dia"] >= DIA_EVAL]
    return {v: int(np.sign(m)) for v, m in ev.groupby("variable")["resid"].mean().items()}


def inyectar(r: pd.DataFrame, sentido: dict[str, int], semilla: int = 0) -> pd.DataFrame:
    """Copia de r con escalones de 3 días seguidos (medidos) en los días de evaluación, con signo al azar.

    Marca `anomalia`, `evento`, `signo` y `a_favor` (el escalón va en el mismo sentido que la deriva del reposo).
    """
    rng = np.random.default_rng(semilla)
    r = r.copy()
    r["anomalia"], r["evento"], r["signo"], r["a_favor"] = False, -1, 0, False
    ev_id = 0
    for (s, v), g in r[r["dia"] >= DIA_EVAL].groupby(["sujeto", "variable"], sort=True):
        dias = set(g["dia"].tolist())
        inicios = sorted(d for d in dias if d + 1 in dias and d + 2 in dias)
        n_ev = min(3, len(dias) // 12)
        ocupados: set[int] = set()
        puestos = 0
        for ini in rng.permutation(inicios) if n_ev else []:
            if puestos >= n_ev:
                break
            ini = int(ini)
            if any(d in ocupados for d in range(ini - 1, ini + 4)):
                continue
            bloque = g.index[g["dia"].isin([ini, ini + 1, ini + 2])]
            signo = int(rng.choice([-1, 1]))
            r.loc[bloque, "valor"] += signo * ANOMALIAS[v]
            r.loc[bloque, "anomalia"] = True
            r.loc[bloque, "evento"] = ev_id
            r.loc[bloque, "signo"] = signo
            r.loc[bloque, "a_favor"] = signo == sentido.get(v, 0)
            ocupados.update(range(ini, ini + 3))
            ocupados.add(ini + 3)
            ev_id += 1
            puestos += 1
    r["anomalia"] = r["anomalia"].astype(bool)
    r["a_favor"] = r["a_favor"].astype(bool)
    r["evento"] = r["evento"].astype(int)
    return r


# ── Evaluación ─────────────────────────────────────────────────────────────────────────────────────────────────────

def _registro_fold(r_te: pd.DataFrame, r_an: pd.DataFrame, pred, pred_an, ancho, ancho3) -> pd.DataFrame:
    """Sumas por (sujeto, variable) de un modelo en un fold."""
    res, res_an = r_te["valor"] - pred, r_an["valor"] - pred_an
    fuera = (res.abs() > ancho).to_numpy()
    alarma = regla_2de3(r_te, fuera)
    m3 = media3(r_te, res).abs()
    ev = r_te["dia"] >= DIA_EVAL
    ev_b = r_te["dia"] >= DIA_EVAL + 2  # el bloque de 3 días cae entero en el tramo evaluado
    t = pd.DataFrame({
        "sujeto": r_te["sujeto"], "variable": r_te["variable"],
        "n": ev.astype(int), "abs_err_sum": res.abs().where(ev, 0.0), "fuera": (fuera & ev).astype(int),
        "ancho_sum": ancho.where(ev, 0.0),
        "n_bloques": (ev_b & alarma.notna()).astype(int), "alarmas_bloque": alarma.where(ev_b, 0.0).fillna(0.0),
        "n3": (ev_b & m3.notna()).astype(int), "fuera3": ((m3 > ancho3) & ev_b).astype(int),
    })
    reg = t.groupby(["sujeto", "variable"], as_index=False).sum()

    an = r_an[r_an["anomalia"]]
    alarma_an = regla_2de3(r_an, (res_an.abs() > ancho).to_numpy())
    m3_an = media3(r_an, res_an).abs()
    ult = an.sort_values("dia").groupby("evento").tail(1)  # el bloque que termina ahí es el escalón entero
    e = pd.DataFrame({"sujeto": ult["sujeto"], "variable": ult["variable"], "a_favor": ult["a_favor"],
                      "det": (alarma_an[ult.index] == 1).astype(int),
                      "det3": (m3_an[ult.index] > ancho3[ult.index]).astype(int)})
    e["eventos"] = 1
    e["eventos_favor"], e["detectados_favor"] = e["a_favor"].astype(int), e["det"] * e["a_favor"]
    e["eventos_contra"], e["detectados_contra"] = 1 - e["eventos_favor"], e["det"] * (1 - e["eventos_favor"])
    ev_reg = (e.rename(columns={"det": "detectados", "det3": "detectados3"}).drop(columns="a_favor")
              .groupby(["sujeto", "variable"], as_index=False).sum())
    reg = reg.merge(ev_reg, on=["sujeto", "variable"], how="left").fillna(0)
    return reg


def evaluar(largo: pd.DataFrame, folds: list[tuple[list[str], list[str]]], semilla: int = 0) -> pd.DataFrame:
    """Registro por (fold, sujeto, variable, modelo, k) con las sumas que necesitan las métricas."""
    partes = []
    for f, (train, test) in enumerate(folds):
        lb = linea_base(largo, sujetos_piso=train)
        r_all = _en_reposo(largo, lb)
        r_tr = r_all[r_all.sujeto.isin(train)].reset_index(drop=True)
        r_te = r_all[r_all.sujeto.isin(test)].reset_index(drop=True)
        r_an = inyectar(r_te, deriva(r_tr), semilla + f)
        pob = ajustar_poblacion(r_tr)
        for nombre, con_pob, ks, tipo in MODELOS:
            mods = pob if con_pob else None
            for k in ks:
                pred, pred_an = predecir(r_te, mods, k), predecir(r_an, mods, k)  # δ_personal ve solo días < k ≤ 28
                if tipo == "tierra":
                    ancho = Z * r_te["sd_pre"]
                    ancho3 = ancho / np.sqrt(3)
                else:
                    a1, a3 = anchos(r_tr, con_pob, k, semilla + f)
                    ancho, ancho3 = r_te["variable"].map(a1), r_te["variable"].map(a3)
                if ancho.isna().any() or ancho3.isna().any():
                    raise ValueError(f"ancho sin definir en {nombre}, k={k}, fold {f}")
                reg = _registro_fold(r_te, r_an, pred, pred_an, ancho, ancho3)
                partes.append(reg.assign(fold=f, modelo=nombre, k=k))
    return pd.concat(partes, ignore_index=True)


METRICAS_IC = {  # nombre: (numerador, denominador, escala)
    "mae": ("abs_err_sum", "n", 1.0),
    "falsas_alarmas_pct": ("fuera", "n", 100.0),
    "falsas_alarmas_regla_pct": ("alarmas_bloque", "n_bloques", 100.0),
    "ancho_medio": ("ancho_sum", "n", 1.0),
    "recall_pct": ("detectados", "eventos", 100.0),
}


def resumir(reg: pd.DataFrame, b: int = incertidumbre.B, semilla: int = 0) -> pd.DataFrame:
    """Tabla por (variable, modelo, k) con IC 95 % por bootstrap de sujetos en las métricas principales."""
    claves = ["variable", "modelo", "k"]
    t = reg.groupby(claves, as_index=False).sum(numeric_only=True).drop(columns="fold")
    t["sujetos"] = reg.groupby(claves)["sujeto"].nunique().to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        def tasa(a, d, e=100.0):
            return e * t[a] / t[d].where(t[d] > 0)
        t["mae"] = tasa("abs_err_sum", "n", 1.0)
        t["ancho_medio"] = tasa("ancho_sum", "n", 1.0)
        t["falsas_alarmas_pct"] = tasa("fuera", "n")
        t["falsas_alarmas_regla_pct"] = tasa("alarmas_bloque", "n_bloques")
        t["recall_pct"] = tasa("detectados", "eventos")
        t["recall_favor_pct"] = tasa("detectados_favor", "eventos_favor")
        t["recall_contra_pct"] = tasa("detectados_contra", "eventos_contra")
        t["falsas_alarmas_3d_pct"] = tasa("fuera3", "n3")
        t["recall_3d_pct"] = tasa("detectados3", "eventos")
    for nombre, (num, den, esc) in METRICAS_IC.items():
        ic = incertidumbre.cociente(reg, claves, num, den, esc, b, semilla)
        t = t.merge(ic.drop(columns="valor").rename(columns={"ic_bajo": f"{nombre}_ic_bajo",
                                                             "ic_alto": f"{nombre}_ic_alto"}), on=claves, how="left")
    cols = (claves + ["sujetos", "n", "eventos", "eventos_favor", "eventos_contra", "mae", "ancho_medio",
                      "falsas_alarmas_pct", "falsas_alarmas_regla_pct", "recall_pct", "recall_favor_pct",
                      "recall_contra_pct", "falsas_alarmas_3d_pct", "recall_3d_pct"]
            + [f"{m}_ic_{x}" for m in METRICAS_IC for x in ("bajo", "alto")])
    return t[cols]


def placebo_pre(largo: pd.DataFrame) -> pd.DataFrame:
    """La regla de Tierra (±Z·sd, con el mismo piso) aplicada dentro del pre-reposo, dejando fuera lo evaluado.

    Diario: cada día contra la media y la sd de los demás días. Regla 2 de 3: cada bloque de 3 días seguidos
    contra los demás días. Devuelve sumas por (sujeto, variable).
    """
    lb = linea_base(largo)
    piso = (lb.groupby("variable")["sd_pre"].median() * 0.5).to_dict()
    filas = []
    pre = largo[largo.fase == "PRE_TEST"]
    for (s, v), g in pre.groupby(["sujeto", "variable"]):
        g = g.sort_values("dia")
        x, d = g["valor"].to_numpy(float), g["dia"].to_numpy()
        n = len(x)
        if n < MIN_PRE + 3 or v not in piso:
            continue
        fuera = []
        for i in range(n):
            resto = np.delete(x, i)
            fuera.append(abs(x[i] - resto.mean()) > Z * max(resto.std(ddof=1), piso[v]))
        bloques, alarmas = 0, 0
        pos = {dd: i for i, dd in enumerate(d)}
        for i, dd in enumerate(d):
            if dd + 1 in pos and dd + 2 in pos:
                idx = [i, pos[dd + 1], pos[dd + 2]]
                resto = np.delete(x, idx)
                sd = max(resto.std(ddof=1), piso[v])
                bloques += 1
                alarmas += int(sum(abs(x[j] - resto.mean()) > Z * sd for j in idx) >= 2)
        filas.append({"sujeto": s, "variable": v, "n": n, "fuera": int(sum(fuera)), "n_bloques": bloques,
                      "alarmas_bloque": alarmas})
    return pd.DataFrame(filas)


def resumir_placebo(plac: pd.DataFrame, b: int = incertidumbre.B, semilla: int = 0) -> pd.DataFrame:
    a = incertidumbre.cociente(plac, ["variable"], "fuera", "n", 100.0, b, semilla)
    c = incertidumbre.cociente(plac, ["variable"], "alarmas_bloque", "n_bloques", 100.0, b, semilla)
    a.columns = ["variable", "placebo_fa_pct", "placebo_fa_ic_bajo", "placebo_fa_ic_alto"]
    c.columns = ["variable", "placebo_fa_regla_pct", "placebo_fa_regla_ic_bajo", "placebo_fa_regla_ic_alto"]
    return a.merge(c, on="variable").merge(plac.groupby("variable").sujeto.nunique().rename("sujetos").reset_index())


def titular(tabla: pd.DataFrame, placebo: pd.DataFrame, reg: pd.DataFrame, semilla: int = 0) -> dict:
    """Lo que se presenta: por variable y promedio de las variables del titular (sin agua)."""
    t = tabla.copy()
    num = t.select_dtypes("number").columns
    t[num] = t[num].astype(float)

    def fila(modelo, k):
        return t[(t.modelo == modelo) & (t.k == k)].set_index("variable")

    tierra, calib, adapt = fila("tierra", 0), fila("tierra (ancho calibrado)", 0), fila(*ADAPTADO)
    adapt_ancho_tierra = fila("adaptado (ancho de Tierra)", 28)
    pl = placebo.set_index("variable")
    reg_t = reg[(reg.modelo == "tierra") & (reg.k == 0)]
    reg_c = reg[(reg.modelo == "tierra (ancho calibrado)") & (reg.k == 0)]
    reg_a = reg[(reg.modelo == ADAPTADO[0]) & (reg.k == ADAPTADO[1])]
    dif_fa = incertidumbre.diferencia(reg_t, reg_a, "fuera", "n", escala=100.0, semilla=semilla).set_index("variable")
    dif_rec = incertidumbre.diferencia(reg_a, reg_c, "detectados", "eventos", escala=100.0,
                                       semilla=semilla).set_index("variable")

    def ic(d, v):
        return {c: round(float(d.loc[v, c]), 2) for c in ("diferencia", "ic_bajo", "ic_alto")}

    pct = ["falsas_alarmas_pct", "falsas_alarmas_regla_pct", "recall_pct", "recall_favor_pct", "recall_contra_pct"]
    out: dict = {"variables": {}, "promedio_sin_agua": {}}
    modelos = [("tierra", tierra), ("tierra_ancho_calibrado", calib), ("adaptado_k28", adapt),
               ("adaptado_ancho_de_tierra", adapt_ancho_tierra)]
    for v in tierra.index:
        d = {n: {c: round(float(f.loc[v, c]), 2) for c in pct + ["ancho_medio", "mae"]} for n, f in modelos}
        d["placebo_pre_fa_pct"] = round(float(pl.loc[v, "placebo_fa_pct"]), 2) if v in pl.index else None
        d["ancho_adaptado_sobre_calibrado"] = round(float(adapt.loc[v, "ancho_medio"] / calib.loc[v, "ancho_medio"]),
                                                    3)
        d["fa_tierra_menos_adaptado_pp"] = ic(dif_fa, v)
        d["recall_adaptado_menos_calibrado_pp"] = ic(dif_rec, v)
        out["variables"][v] = d
    for n, f in modelos:  # unidades distintas: ancho y error se promedian relativos
        f = f.reindex(TITULAR)
        out["promedio_sin_agua"][n] = {c: round(float(f[c].mean()), 2) for c in pct}
        out["promedio_sin_agua"][n]["ancho_sobre_calibrado"] = round(
            float((f["ancho_medio"] / calib.reindex(TITULAR)["ancho_medio"]).mean()), 3)
        out["promedio_sin_agua"][n]["mae_sobre_tierra"] = round(
            float((f["mae"] / tierra.reindex(TITULAR)["mae"]).mean()), 3)
    out["promedio_sin_agua"]["placebo_pre_fa_pct"] = round(float(pl.reindex(TITULAR)["placebo_fa_pct"].mean()), 2)
    return out


def desplazamiento(largo: pd.DataFrame) -> pd.DataFrame:
    """Cambio pareado reposo (día ≥ DIA_EVAL) menos pre-reposo, por variable, con IC 95 % (t de Student)."""
    filas = []
    for v, g in largo.groupby("variable"):
        pre = g[g.fase == "PRE_TEST"].groupby("sujeto")["valor"].mean()
        en = g[(g.fase == "IN_TEST") & (g.dia >= DIA_EVAL)].groupby("sujeto")["valor"].mean()
        post = g[g.fase == "POST_TEST"].groupby("sujeto")["valor"].mean()
        d, dp = (en - pre).dropna(), (post - pre).dropna()
        ic = stats.t.ppf(0.975, len(d) - 1) * d.std(ddof=1) / np.sqrt(len(d)) if len(d) > 1 else np.nan
        sd_pre = g[g.fase == "PRE_TEST"].groupby("sujeto")["valor"].std().median()
        filas.append({"variable": v, "sujetos": len(d), "reposo_menos_pre": d.mean(), "ic95": ic,
                      "post_menos_pre": dp.mean(), "sd_dia_a_dia_pre": sd_pre,
                      "cambio_en_sd": d.mean() / sd_pre if sd_pre else np.nan})
    return pd.DataFrame(filas)
