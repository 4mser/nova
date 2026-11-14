import numpy as np
import pandas as pd
import pytest

from nova_tl import baselines, expectativa, ventanas


def _serie(dias, valores, fases, sujeto="S1", variable="pulso"):
    return pd.DataFrame({"fuente": "reposo", "campana": "C3", "sujeto": sujeto, "instrumento": "enfermeria",
                         "dia": dias, "fase": fases, "variable": variable, "valor": valores})


def test_el_objetivo_nunca_entra_al_contexto():
    dias = np.arange(0, 20)
    largo = _serie(dias, dias.astype(float), ["IN_TEST"] * 20)
    v = ventanas.construir(largo, C=5, H=3, min_ctx=5)
    assert len(v) == 20 - 5 - 3 + 1
    for x, y, d0 in zip(v.x, v.y, v.meta["dia0"]):
        assert x[-1] == d0 - 1 and y[0] == d0


def test_huecos_del_contexto_se_rellenan_y_quedan_marcados():
    dias = np.arange(0, 10)
    valores = np.arange(10, dtype=float)
    largo = _serie(dias, valores, ["IN_TEST"] * 10).drop(index=3)  # día 3 sin medición
    v = ventanas.construir(largo, C=5, H=2, min_ctx=3)
    w = v.filtrar(v.meta["dia0"] == 5)
    assert w.mx[0].tolist() == [1, 1, 1, 0, 1]
    assert w.x[0][3] == 2.0  # rellenado con el último observado


def test_relleno_al_inicio_permite_ventanas_cortas_sin_fuga():
    dias = np.arange(-12, 0)
    largo = _serie(dias, np.arange(12, dtype=float), ["PRE_TEST"] * 12)
    sin = ventanas.construir(largo, C=14, H=7, min_ctx=5, fases_objetivo={"PRE_TEST"})
    con = ventanas.construir(largo, C=14, H=7, min_ctx=5, fases_objetivo={"PRE_TEST"}, relleno_inicio=True)
    assert len(sin) == 0 and len(con) > 0
    for x, mx, y, my, d0 in zip(con.x, con.mx, con.y, con.my, con.meta["dia0"]):
        assert mx.sum() >= 5 and mx[-1] == 1
        assert x[-1] == (d0 - 1) - (-12)  # el valor del día anterior al objetivo
        assert y[0] == d0 - (-12)


def test_fases_objetivo_y_sin_cruzar_de_fase():
    dias = np.arange(-5, 6)
    fases = ["PRE_TEST"] * 5 + ["IN_TEST"] * 6
    largo = _serie(dias, np.ones(11), fases)
    v = ventanas.construir(largo, C=3, H=2, min_ctx=1, fases_objetivo={"IN_TEST"})
    assert set(v.meta["fase0"]) == {"IN_TEST"}
    pre = ventanas.construir(largo, C=3, H=2, min_ctx=1, fases_objetivo={"PRE_TEST"})
    assert pre.meta["dia0"].max() <= -2  # el objetivo de 2 días no cruza al reposo


def test_baselines_y_mae_con_mascara():
    dias = np.arange(0, 12)
    largo = _serie(dias, np.r_[np.ones(8), [5.0, 5.0, 9.0, 9.0]], ["IN_TEST"] * 12)
    v = ventanas.construir(largo, C=8, H=2, min_ctx=8)
    first = v.filtrar(v.meta["dia0"] == 8)
    assert baselines.persistencia(first)[0].tolist() == [1.0, 1.0]
    assert baselines.mae(baselines.media7(first), first)[0] == pytest.approx(4.0)


def test_delta_personal_usa_solo_los_primeros_k_dias():
    r = pd.DataFrame({"sujeto": "S1", "variable": "peso", "dia": [0, 1, 2, 30, 31],
                      "res": [2.0, 2.0, 2.0, 50.0, 50.0]})
    assert expectativa.delta_personal(r, "res", 0).tolist() == [0.0] * 5
    d = expectativa.delta_personal(r, "res", 3)
    assert d.iloc[0] == pytest.approx(2.0 * 3 / (3 + expectativa.KAPPA))


def test_modelo_tierra_espera_la_linea_base_del_pre_reposo():
    largo = pd.concat([
        _serie([-3, -2, -1], [70.0, 72.0, 74.0], ["PRE_TEST"] * 3),
        _serie([0, 40], [80.0, 80.0], ["IN_TEST"] * 2),
    ])
    lb = expectativa.linea_base(largo)
    r = expectativa._en_reposo(largo, lb)
    pred = expectativa.predecir(r, None, 0)
    assert pred.tolist() == [72.0, 72.0]


def test_media3_es_por_sujeto_y_variable_y_ordenada_por_dia():
    r = pd.DataFrame({"sujeto": ["A"] * 4 + ["B"] * 3, "variable": "pulso",
                      "dia": [3, 0, 1, 2, 0, 1, 2]})
    res = pd.Series([4.0, 1.0, 2.0, 3.0, 10.0, 10.0, 10.0])
    m = expectativa.media3(r, res)
    assert np.isnan(m.iloc[1]) and np.isnan(m.iloc[2])
    assert m.iloc[3] == pytest.approx(2.0) and m.iloc[0] == pytest.approx(3.0)
    assert m.iloc[6] == pytest.approx(10.0)


def test_desplazamiento_pareado():
    a = pd.concat([_serie([-2, -1], [70.0, 70.0], ["PRE_TEST"] * 2),
                   _serie([30, 31], [73.0, 73.0], ["IN_TEST"] * 2)])
    t = expectativa.desplazamiento(a)
    assert t.loc[0, "reposo_menos_pre"] == pytest.approx(3.0)
