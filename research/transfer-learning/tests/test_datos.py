import numpy as np
import pandas as pd
import pytest

from nova_tl import datos


def test_eje_dias_pre_cuenta_atras_in_desde_cero_post_despues_del_reposo():
    crudo = pd.DataFrame({
        "sujeto": ["A"] * 7,
        "fase": ["PRE_TEST", "PRE_TEST", "IN_TEST", "IN_TEST", "IN_TEST", "POST_TEST", "POST_TEST"],
        "dia_br": [2, 1, 1, 2, 3, 0, 1],
    })
    dia = datos.eje_dias(crudo)
    assert dia.tolist() == [-2, -1, 0, 1, 2, 3, 4]


def test_eje_dias_post_usa_el_largo_del_reposo_de_cada_sujeto():
    crudo = pd.DataFrame({
        "sujeto": ["A", "A", "B", "B", "B"],
        "fase": ["IN_TEST", "POST_TEST", "IN_TEST", "IN_TEST", "POST_TEST"],
        "dia_br": [1, 0, 1, 2, 0],
    })
    assert datos.eje_dias(crudo).tolist() == [0, 1, 0, 1, 2]


def test_a_numero_convierte_textos_y_deja_vacio_lo_no_reportado():
    s = pd.Series(["72.1", "Not reported", None, "118 mmHg", 60])
    out = datos.a_numero(s)
    assert out.iloc[0] == pytest.approx(72.1)
    assert np.isnan(out.iloc[1]) and np.isnan(out.iloc[2])
    assert out.iloc[3] == 118 and out.iloc[4] == 60


def test_coalescer_toma_la_primera_columna_con_dato():
    df = pd.DataFrame({"Pulse": [np.nan, 70, np.nan], "Pulse (bpm)": [65, 99, np.nan]})
    assert datos.coalescer(df, ["Pulse", "Pulse (bpm)"]).tolist()[:2] == [65, 70]


def test_limpiar_rangos_descarta_errores_de_sensor():
    largo = pd.DataFrame({
        "variable": ["pulso", "pulso", "peso", "fr", "temp"],
        "valor": [16, 62, 0, 116, 36.6],
    })
    out = datos.limpiar_rangos(largo)
    assert out["valor"].tolist() == [62, 36.6]


def test_vitales_de_campana_1_quita_duplicados_exactos_y_pasa_a_celsius():
    crudo = pd.DataFrame({
        "Subject": ["C1G0001"] * 3,
        "Date": ["8/30/2004", "8/30/2004", "8/31/2004"],
        "Test_Phase": ["PRE_TEST"] * 3,
        "BR_Day": [2, 2, 1],
        "Pulse (bpm)": [62, 62, 59],
        "Blood Pressure, systolic": [108, 108, 105],
        "Blood Pressure, diastolic": [68, 68, 62],
        "Respiration rate (rpm)": [18, 18, 12],
        "Temperature, body (Fahrenheit)": [98.6, 98.6, 97.7],
        "Weight (kg)": [70.0, 70.0, 69.8],
        "Temperature, ambient": ["72.5", "72.5", "Not reported"],
    })
    ancho = datos.vitales_reposo(crudo, "C1")
    assert len(ancho) == 2
    assert ancho["temp"].iloc[0] == pytest.approx(37.0, abs=0.01)
    assert ancho["t_amb_c"].iloc[0] == pytest.approx((72.5 - 32) / 1.8, abs=0.01)
    assert np.isnan(ancho["t_amb_c"].iloc[1])
    assert ancho["sujeto"].iloc[0] == "C1_C1G0001"
    assert ancho["dia"].tolist() == [-2, -1]


def test_vitales_mismo_sujeto_y_dia_se_queda_con_la_primera_lectura():
    crudo = pd.DataFrame({
        "Subject": [7352, 7352],
        "Date": [None, None],
        "Test_Phase": ["IN_TEST", "IN_TEST"],
        "BR_Day": [5, 5],
        "Pulse": [65, 85],
    })
    ancho = datos.vitales_reposo(crudo, "C3")
    assert ancho["pulso"].tolist() == [65]


def test_a_largo_deja_solo_valores_observados():
    ancho = pd.DataFrame({
        "fuente": ["reposo"] * 2, "campana": ["C3"] * 2, "sujeto": ["C3_1"] * 2,
        "dia": [0, 1], "fase": ["IN_TEST"] * 2, "pulso": [60, np.nan], "peso": [70.0, 70.1],
    })
    largo = datos.a_largo(ancho, ["pulso", "peso"])
    assert len(largo) == 3
    assert set(largo.columns) >= {"sujeto", "dia", "fase", "variable", "valor"}
