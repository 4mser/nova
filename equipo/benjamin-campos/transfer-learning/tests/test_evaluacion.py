import numpy as np
import pandas as pd
import pytest

from nova_tl import expectativa as ex
from nova_tl import incertidumbre, ventanas


def _r(dias, valores, sujeto="S1", variable="pulso"):
    return pd.DataFrame({"sujeto": sujeto, "variable": variable, "dia": dias, "valor": np.asarray(valores, float)})


def test_media3_usa_dias_de_calendario():
    r = _r([30, 31, 32, 35, 36, 37], [1, 2, 3, 10, 20, 30])
    m = ex.media3(r, r["valor"])
    assert m.iloc[2] == pytest.approx(2.0)
    assert np.isnan(m.iloc[3]) and np.isnan(m.iloc[4])  # 35 y 36 no tienen 3 días seguidos detrás
    assert m.iloc[5] == pytest.approx(20.0)


def test_regla_2de3_exige_tres_dias_seguidos():
    r = _r([0, 1, 2, 4, 5, 6], np.zeros(6))
    a = ex.regla_2de3(r, [1, 1, 0, 1, 0, 0])
    assert a.iloc[2] == 1.0 and a.iloc[5] == 0.0
    assert a.iloc[:2].isna().all() and a.iloc[3:5].isna().all()


def test_ventana3_rechaza_dias_repetidos():
    r = _r([0, 0, 1], [1, 2, 3])
    with pytest.raises(ValueError):
        ex.media3(r, r["valor"])


def test_inyectar_escalones_de_tres_dias_con_signo_al_azar():
    filas = [_r(np.arange(0, 90), np.full(90, 70.0), sujeto=f"S{i}") for i in range(20)]
    r = pd.concat(filas, ignore_index=True)
    r["resid"] = 0.0
    an = ex.inyectar(r, {"pulso": 1}, semilla=0)
    ev = an[an["anomalia"]]
    assert (ev["dia"] >= ex.DIA_EVAL).all()
    signos = set()
    for _, g in ev.groupby("evento"):
        assert sorted(g["dia"]) == list(range(g["dia"].min(), g["dia"].min() + 3))
        assert (g["valor"] - 70.0).round(6).nunique() == 1
        s = int(g["signo"].iloc[0])
        assert g["valor"].iloc[0] - 70.0 == pytest.approx(s * ex.ANOMALIAS["pulso"])
        assert bool(g["a_favor"].iloc[0]) == (s == 1)
        signos.add(s)
    assert signos == {-1, 1}
    assert (an.loc[~an["anomalia"], "valor"] == 70.0).all()


def test_ancho_calibrado_fuera_de_muestra():
    """La predicción CV de un sujeto no cambia si se alteran sus propios datos (k = 0)."""
    rng = np.random.default_rng(0)
    partes = []
    for i in range(8):
        d = np.arange(0, 60)
        partes.append(_r(d, 70 + 0.1 * d + rng.normal(0, 1, len(d)), sujeto=f"S{i}"))
    r = pd.concat(partes, ignore_index=True)
    r["media_pre"], r["sd_pre"] = 70.0, 1.0
    r["resid"] = r["valor"] - 70.0
    p1 = ex._pred_cv(r, True, 0, semilla=0)
    r2 = r.copy()
    m = r2.sujeto == "S3"
    r2.loc[m, "valor"] += 50.0
    r2["resid"] = r2["valor"] - 70.0
    p2 = ex._pred_cv(r2, True, 0, semilla=0)
    assert np.allclose(p1[m], p2[m])
    assert not np.allclose(p1[~m], p2[~m])  # a los demás sí les cambia el corrector


def test_linea_base_piso_solo_con_entrenamiento():
    largo = pd.concat([
        pd.DataFrame({"sujeto": "A", "variable": "pulso", "fase": "PRE_TEST", "dia": [-3, -2, -1],
                      "valor": [70.0, 70.0, 70.0]}),
        pd.DataFrame({"sujeto": "B", "variable": "pulso", "fase": "PRE_TEST", "dia": [-3, -2, -1],
                      "valor": [60.0, 70.0, 80.0]}),
        pd.DataFrame({"sujeto": "C", "variable": "pulso", "fase": "PRE_TEST", "dia": [-3, -2, -1],
                      "valor": [69.0, 70.0, 71.0]}),
    ])
    lb = ex.linea_base(largo, sujetos_piso=["C"]).set_index("sujeto")
    assert lb.loc["A", "sd_pre"] == pytest.approx(0.5)  # la mitad de la mediana de C, no de A, B y C
    assert lb.loc["B", "sd_pre"] == pytest.approx(10.0)


def test_cociente_y_diferencia_pareada():
    reg = pd.DataFrame({"sujeto": ["a", "b", "c", "d"], "variable": "x", "modelo": "m", "k": 0,
                        "num": [1, 2, 3, 4], "den": [10, 10, 10, 10]})
    t = incertidumbre.cociente(reg, ["variable"], "num", "den", 100.0, b=200)
    assert t.loc[0, "valor"] == pytest.approx(25.0)
    assert t.loc[0, "ic_bajo"] <= 25.0 <= t.loc[0, "ic_alto"]
    d = incertidumbre.diferencia(reg, reg, "num", "den", b=200)
    assert d.loc[0, "diferencia"] == 0 and d.loc[0, "ic_bajo"] == 0 and d.loc[0, "ic_alto"] == 0


def test_placebo_detecta_un_dia_atipico():
    dias = np.arange(-12, 0)
    base = 70 + np.tile([-1.0, 1.0], 6)
    largo = pd.DataFrame({"sujeto": "A", "variable": "pulso", "fase": "PRE_TEST", "dia": dias, "valor": base})
    assert ex.placebo_pre(largo)["fuera"].iloc[0] == 0
    largo.loc[5, "valor"] = 95.0
    assert ex.placebo_pre(largo)["fuera"].iloc[0] >= 1


def _sintetico(n=12, semilla=0):
    rng = np.random.default_rng(semilla)
    partes = []
    for i in range(n):
        pre_d, in_d = np.arange(-14, 0), np.arange(0, 70)
        mu = 70 + rng.normal(0, 5)
        partes.append(pd.DataFrame({"sujeto": f"S{i}", "variable": "pulso", "fase": "PRE_TEST", "dia": pre_d,
                                    "valor": mu + rng.normal(0, 2, len(pre_d))}))
        deriva = 8 * (1 - np.exp(-in_d / 10))  # todos suben ~8 lpm en cama
        partes.append(pd.DataFrame({"sujeto": f"S{i}", "variable": "pulso", "fase": "IN_TEST", "dia": in_d,
                                    "valor": mu + deriva + rng.normal(0, 2, len(in_d))}))
    return pd.concat(partes, ignore_index=True)


def test_evaluar_de_punta_a_punta_en_datos_sinteticos():
    largo = _sintetico()
    sujetos = sorted(largo.sujeto.unique())
    folds = [([s for s in sujetos if s not in sujetos[i::3]], sujetos[i::3]) for i in range(3)]
    reg = ex.evaluar(largo, folds, semilla=0)
    tab = ex.resumir(reg, b=100).set_index(["modelo", "k"])
    tierra, calib = tab.loc[("tierra", 0)], tab.loc[("tierra (ancho calibrado)", 0)]
    adapt = tab.loc[ex.ADAPTADO]
    assert tierra["falsas_alarmas_pct"] > 50  # +8 lpm con sd 2: la línea base de Tierra alarma casi siempre
    assert adapt["falsas_alarmas_pct"] < 15
    assert adapt["ancho_medio"] < calib["ancho_medio"]
    assert adapt["mae"] < tierra["mae"]
    assert tierra["recall_favor_pct"] >= tierra["recall_contra_pct"]
    pl = ex.resumir_placebo(ex.placebo_pre(largo), b=100)
    out = ex.titular(ex.resumir(reg, b=100), pl, reg)
    assert out["variables"]["pulso"]["ancho_adaptado_sobre_calibrado"] < 1


def test_ruido_y_escala_sin_nan():
    largo = pd.DataFrame({"sujeto": ["a", "b"], "variable": "x", "valor": [1.0, 2.0]})  # una medición por persona
    assert ventanas.ruido_por_variable(largo) == {"x": 1.0}
    v = ventanas.Ventanas(np.zeros((1, 3), np.float32), np.ones((1, 3), np.float32), np.zeros((1, 2), np.float32),
                          np.ones((1, 2), np.float32), pd.DataFrame({"variable": ["y"]}))
    with pytest.raises(ValueError):
        ventanas.escala(v, {"x": 1.0})
