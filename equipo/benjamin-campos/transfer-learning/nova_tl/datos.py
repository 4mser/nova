"""Carga y limpieza: reposo en cama de la NASA (análogo de microgravedad) y LifeSnaps (Tierra).

Formato común «largo»: una fila por medición, con columnas
    fuente, campana, sujeto, instrumento, dia, fase, variable, valor

- Reposo en cama (NLSP/LSDA, UTMB Flight Analogs: campañas 1 y 3, CFT70). `dia` = día respecto del inicio del reposo
  con inclinación de −6°: el pre-reposo es negativo, el primer día en cama es 0 y el post-reposo sigue después del
  último día en cama. Fases: PRE_TEST, IN_TEST, POST_TEST.
- LifeSnaps (Yfantidou et al. 2022, doi:10.1038/s41597-022-01764-x, CC BY 4.0): tabla diaria del reloj Fitbit.
  `dia` = días desde la primera fecha de cada persona; fase TIERRA.

Uso:
    python -m nova_tl.datos --reposo <carpeta nlsp_tablas> --lifesnaps <daily .csv o .parquet> --salida <carpeta>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from nova_tl.variables import OBJETIVOS, SOLO_TIERRA, rango

COLUMNAS_LARGO = ["fuente", "campana", "sujeto", "instrumento", "dia", "fase", "variable", "valor"]

# Nombres de columna que usa cada versión de los formularios de NLSP para la misma medición
COLUMNAS_VITALES = {
    "pulso": ["Pulse", "Pulse (bpm)"],
    "pa_sis": ["Blood Pressure, systolic", "SysBP", "SysBP (mmHg)"],
    "pa_dia": ["Blood Pressure, diastolic", "DiaBP", "DiaBP (mmHg)"],
    "fr": ["Respiration rate", "Respiration rate (rpm)", "Resp Rate", "Resp Rate (rpm)"],
    "temp_c": ["Temperature, body (Celsius)", "Body Temp (Celsius)", "Body Temp"],
    "temp_f": ["Temperature, body (Fahrenheit)"],
    "peso": ["Weight", "Weight (kg)", "Weight (Kg)"],
    "t_amb_f": ["Temperature, ambient", "Ambient Temperature (Fahrenheit)"],  # los valores (~72) son Fahrenheit
    "hum": ["Humidity, ambient", "Humidity, ambient (%)", "Humidity, ambient %", "Humidity (%)"],
}

TABLAS_VITALES = {
    "C3": "CRF_Campaign_3_Daily_Vitals.csv",
    "C1": "CRF_Campaign_1_Daily_Vitals.csv",
    "CFT70": "CRF_CFT70_VITALS.csv",
}

# (campaña, tabla, columna del total diario, columna de la meta diaria o None)
TABLAS_FLUIDOS = {
    "diuresis": [
        ("C3", "CRF_Campaign_3_Urine_Collection.csv", "Daily_Collection_g", None),
        ("C1", "CRF_Campaign_1_Urine_Collection.csv", "Daily_Collection_g", None),
    ],
    "agua": [
        ("C3", "CRF_Campaign_3_Water_Intake.csv", "Daily_Total_g", "Daily_Goal_g"),
        ("CFT70", "CRF_CFT70_FARUWATERIO.csv", "Daily Total Water - Grams", "Daily Water Goal - Grams"),
        ("CFT70", "CRF_CFT70_WATERINTAKE.csv", "Daily Total (g)", "Daily Goal (g)"),
    ],
}

LIFESNAPS = {
    "pulso": "resting_hr",
    "fr": "full_sleep_breathing_rate",
    "temp": "nightly_temperature",  # temperatura de piel nocturna, no central
    "vfc": "rmssd",
    "spo2": "spo2",
    "estres": "stress_score",
}


def a_numero(serie: pd.Series) -> pd.Series:
    """Primer número de cada celda; lo que no es número («Not reported») queda vacío."""
    texto = serie.astype("string").str.extract(r"(-?\d+(?:\.\d+)?)")[0]
    return pd.to_numeric(texto, errors="coerce").astype(float)


def coalescer(df: pd.DataFrame, columnas: list[str]) -> pd.Series:
    out = pd.Series(np.nan, index=df.index, dtype=float)
    for c in columnas:
        if c in df.columns:
            out = out.fillna(a_numero(df[c]))
    return out


def eje_dias(crudo: pd.DataFrame, largo_in: dict[str, int] | None = None) -> pd.Series:
    """Día respecto del inicio del reposo. Espera columnas sujeto, fase y dia_br.

    PRE_TEST cuenta hacia atrás (dia_br 11 = 11 días antes), IN_TEST parte en 1 y POST_TEST parte en 0 (R+0).
    """
    fase = crudo["fase"].astype(str).str.strip().str.upper()
    br = pd.to_numeric(crudo["dia_br"], errors="coerce")
    if largo_in is None:
        largo_in = br[fase == "IN_TEST"].groupby(crudo.loc[fase == "IN_TEST", "sujeto"]).max().to_dict()
    n_in = crudo["sujeto"].map(largo_in)
    dia = pd.Series(np.nan, index=crudo.index, dtype=float)
    dia[fase == "PRE_TEST"] = -br
    dia[fase == "IN_TEST"] = br - 1
    dia[fase == "POST_TEST"] = n_in + br
    return dia


def limpiar_rangos(largo: pd.DataFrame) -> pd.DataFrame:
    lo = largo["variable"].map(lambda v: rango(v)[0])
    hi = largo["variable"].map(lambda v: rango(v)[1])
    ok = largo["valor"].between(lo, hi)
    return largo[ok].reset_index(drop=True)


def _base(crudo: pd.DataFrame, campana: str) -> pd.DataFrame:
    sujeto_col = "Subject" if "Subject" in crudo.columns else "Subject ID"
    fase_col = "Test_Phase" if "Test_Phase" in crudo.columns else "Test Phase"
    return pd.DataFrame({
        "campana": campana,
        "sujeto": campana + "_" + crudo[sujeto_col].astype(str).str.strip(),
        "fase": crudo[fase_col].astype(str).str.strip().str.upper(),
        "dia_br": pd.to_numeric(crudo["BR_Day"], errors="coerce"),
    }, index=crudo.index)


def vitales_reposo(crudo: pd.DataFrame, campana: str) -> pd.DataFrame:
    """Una fila por sujeto y día, con las 6 variables de la toma de la mañana y el ambiente."""
    crudo = crudo.drop(columns=[c for c in ["archivo_origen", "ID", "Record"] if c in crudo.columns])
    crudo = crudo.drop_duplicates().reset_index(drop=True)
    o = _base(crudo, campana)
    for k, cols in COLUMNAS_VITALES.items():
        o[k] = coalescer(crudo, cols)
    o["temp"] = o["temp_c"].where(o["temp_c"].between(30, 43), (o["temp_f"] - 32) / 1.8)
    o["t_amb_c"] = (o["t_amb_f"] - 32) / 1.8
    o["dia"] = eje_dias(o)
    o = o.dropna(subset=["dia"]).drop_duplicates(subset=["sujeto", "dia"], keep="first")
    o["fuente"] = "reposo"
    cols = ["fuente", "campana", "sujeto", "dia", "fase", "pulso", "pa_sis", "pa_dia", "fr", "temp", "peso",
            "t_amb_c", "hum"]
    return o[cols].sort_values(["sujeto", "dia"]).reset_index(drop=True)


def fluidos_reposo(crudo: pd.DataFrame, campana: str, col_total: str, col_meta: str | None,
                   largo_in: dict[str, int]) -> pd.DataFrame:
    """Total diario (g) por sujeto y día; las tablas traen una fila por toma y el total en una de ellas."""
    o = _base(crudo, campana)
    o["valor"] = a_numero(crudo[col_total]) if col_total in crudo.columns else np.nan
    o["meta"] = a_numero(crudo[col_meta]) if col_meta and col_meta in crudo.columns else np.nan
    o = o.dropna(subset=["valor"])
    o["dia"] = eje_dias(o, largo_in)
    o = o.dropna(subset=["dia"])
    return o.groupby(["sujeto", "dia", "fase"], as_index=False).agg(valor=("valor", "max"), meta=("meta", "max"))


def a_largo(ancho: pd.DataFrame, variables: list[str]) -> pd.DataFrame:
    largo = ancho.melt(id_vars=[c for c in ["fuente", "campana", "sujeto", "dia", "fase"] if c in ancho.columns],
                       value_vars=variables, var_name="variable", value_name="valor")
    return largo.dropna(subset=["valor"]).reset_index(drop=True)


def cargar_reposo(carpeta: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Devuelve (largo de las 8 variables, covariables por sujeto y día)."""
    anchos = [vitales_reposo(pd.read_csv(carpeta / t, low_memory=False), c) for c, t in TABLAS_VITALES.items()]
    vit = pd.concat(anchos, ignore_index=True)
    largo_in = vit[vit.fase == "IN_TEST"].groupby("sujeto")["dia"].max().add(1).to_dict()
    largo = a_largo(vit, ["pulso", "pa_sis", "pa_dia", "fr", "temp", "peso"])

    metas = []
    for variable, tablas in TABLAS_FLUIDOS.items():
        for campana, tabla, col_total, col_meta in tablas:
            ruta = carpeta / tabla
            if not ruta.exists():
                continue
            f = fluidos_reposo(pd.read_csv(ruta, low_memory=False), campana, col_total, col_meta, largo_in)
            f = f[f.sujeto.isin(largo_in)]  # solo sujetos con signos vitales
            f["variable"], f["fuente"], f["campana"] = variable, "reposo", campana
            largo = pd.concat([largo, f[["fuente", "campana", "sujeto", "dia", "fase", "variable", "valor"]]])
            if variable == "agua":
                metas.append(f[["sujeto", "dia", "meta"]].rename(columns={"meta": "meta_agua"}))

    largo = largo.drop_duplicates(subset=["sujeto", "dia", "variable"], keep="first")
    largo["instrumento"] = "enfermeria"
    largo = limpiar_rangos(largo)[COLUMNAS_LARGO].sort_values(["sujeto", "variable", "dia"]).reset_index(drop=True)
    largo["dia"] = largo["dia"].astype(int)

    cov = vit[["sujeto", "dia", "fase", "t_amb_c", "hum"]].copy()
    if metas:
        meta = pd.concat(metas).drop_duplicates(subset=["sujeto", "dia"])
        cov = cov.merge(meta, on=["sujeto", "dia"], how="left")
    cov["dia"] = cov["dia"].astype(int)
    return largo, cov.sort_values(["sujeto", "dia"]).reset_index(drop=True)


def cargar_lifesnaps(ruta: Path) -> pd.DataFrame:
    d = pd.read_parquet(ruta) if ruta.suffix == ".parquet" else pd.read_csv(ruta, low_memory=False)
    d["date"] = pd.to_datetime(d["date"], errors="coerce")
    d = d.dropna(subset=["date"]).drop_duplicates(subset=["id", "date"], keep="first")
    ancho = pd.DataFrame({"sujeto": "LS_" + d["id"].astype(str), "fecha": d["date"]})
    for k, c in LIFESNAPS.items():
        ancho[k] = pd.to_numeric(d[c], errors="coerce")
    ancho["sueno_h"] = pd.to_numeric(d["minutesAsleep"], errors="coerce") / 60
    ancho["actividad_min"] = (pd.to_numeric(d["moderately_active_minutes"], errors="coerce")
                              + pd.to_numeric(d["very_active_minutes"], errors="coerce"))
    ancho["dia"] = (ancho["fecha"] - ancho.groupby("sujeto")["fecha"].transform("min")).dt.days
    ancho["fuente"], ancho["campana"], ancho["fase"] = "lifesnaps", "LS", "TIERRA"
    largo = a_largo(ancho, ["pulso", "fr", "temp", *SOLO_TIERRA])
    largo["instrumento"] = "reloj"
    largo = limpiar_rangos(largo)[COLUMNAS_LARGO]
    largo["dia"] = largo["dia"].astype(int)
    return largo.sort_values(["sujeto", "variable", "dia"]).reset_index(drop=True)


def resumen(largo: pd.DataFrame) -> pd.DataFrame:
    return largo.groupby(["fuente", "variable", "fase"]).agg(sujetos=("sujeto", "nunique"), dias=("valor", "size"),
                                                             media=("valor", "mean")).round(1)


def main(argv: list[str] | None = None) -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--reposo", type=Path, required=True)
    p.add_argument("--lifesnaps", type=Path, required=True)
    p.add_argument("--salida", type=Path, required=True)
    a = p.parse_args(argv)
    a.salida.mkdir(parents=True, exist_ok=True)
    reposo, cov = cargar_reposo(a.reposo)
    tierra = cargar_lifesnaps(a.lifesnaps)
    reposo.to_parquet(a.salida / "reposo_largo.parquet", index=False)
    cov.to_parquet(a.salida / "reposo_covariables.parquet", index=False)
    tierra.to_parquet(a.salida / "tierra_largo.parquet", index=False)
    print(resumen(pd.concat([reposo, tierra])).to_string())
    print(f"\nreposo: {reposo.sujeto.nunique()} sujetos, {len(reposo)} mediciones · "
          f"LifeSnaps: {tierra.sujeto.nunique()} personas, {len(tierra)} mediciones")
    faltan = [v for v in OBJETIVOS if v not in set(reposo.variable)]
    if faltan:
        print("AVISO: variables sin datos en el reposo:", faltan)


if __name__ == "__main__":
    main()
