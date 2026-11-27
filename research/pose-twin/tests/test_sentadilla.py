"""Sentadilla de lado con señales sintéticas: conteo, medidas, huecos, abstención, guardado e instrucciones."""
import csv
import json
import math

import numpy as np
import pytest

from pose_twin import dibujo
from pose_twin import sentadilla as Q
from tests.sinteticos import doblar_rodillas, pose_base, pose_falsa, procesador_falso, senal


def correr(cuadros, prep=0.0, fin=None, terminar=True):
    s = Q.SerieSentadilla(segundos_preparacion=prep, segundos_fin=fin)
    for c in cuadros:
        s.paso(c["angulos"], c["t"])
    if terminar:
        s.terminar()
    return s


TRES = [("pie", 1.5), ("rep", 2.0, 90), ("pie", 0.5), ("rep", 3.0, 80), ("pie", 0.5), ("rep", 2.0, 100), ("pie", 1)]


@pytest.mark.parametrize("ruido, tolerancia", [(0.0, 1.5), (2.0, 5.0)])
def test_cuenta_y_mide(ruido, tolerancia):
    s = correr(senal(TRES, ruido=ruido, semilla=3))
    assert len(s.repeticiones) == 3 and not s.descartadas
    for r, minimo, dur in zip(s.repeticiones, (90, 80, 100), (2.0, 3.0, 2.0)):
        assert r["rodilla_min"] == pytest.approx(minimo, abs=tolerancia)
        assert r["cadera_min"] == pytest.approx(175 - (170 - minimo) * 0.9, abs=tolerancia)
        total = r["bajada_s"] + r["fondo_s"] + r["subida_s"]
        assert 0.6 * dur < total < dur  # se mide entre los cruces de salida, algo menos que el tramo completo
        if not ruido:
            assert r["bajada_s"] == pytest.approx(r["subida_s"], abs=0.1)
            assert r["calidad"] == "buena" and r["dif_rodilla"] == pytest.approx(0.0, abs=0.1)
    res = s.resumen()
    assert res["rodilla_min"]["n"] == 3 and res["rodilla_min"]["media"] == pytest.approx(90, abs=tolerancia)
    assert res["rodilla_min"]["de"] == pytest.approx(10, abs=tolerancia)


def test_movimiento_pequeno_no_cuenta():
    s = correr(senal([("pie", 1.5), ("rep", 2, 148), ("pie", 1), ("rep", 2, 144), ("pie", 1)], ruido=0.5))
    assert not s.repeticiones and not s.descartadas


def test_repeticion_incompleta_no_cuenta():
    s = correr(senal([("pie", 1.5), ("rep", 2, 90), ("pie", 0.5), ("media", 2, 90)]))
    assert len(s.repeticiones) == 1
    assert [d["motivo"] for d in s.descartadas] == ["incompleta: no volvio a quedar de pie"]


def test_hueco_corto_baja_la_calidad_y_largo_descarta():
    corto = senal([("pie", 1.5), ("rep", 3, 90), ("pie", 1)])
    for c in corto[75:96]:  # 0,7 s sin ver las piernas en plena bajada
        c["angulos"] = {k: None for k in c["angulos"]}
    s = correr(corto)
    assert len(s.repeticiones) == 1 and s.repeticiones[0]["calidad"] in ("regular", "baja")
    assert s.repeticiones[0]["cobertura"] < 0.9
    assert s.repeticiones[0]["dif_rodilla"] is None  # no se vio lo suficiente para comparar lados

    largo = senal([("pie", 1.5), ("rep", 4, 90), ("pie", 1), ("rep", 2, 90), ("pie", 1)])
    for c in largo[85:130]:  # 1,5 s
        c["angulos"] = {k: None for k in c["angulos"]}
    s = correr(largo)
    assert len(s.repeticiones) == 1 and [d["motivo"] for d in s.descartadas] == ["se perdio la vista"]


def test_salto_de_tiempo_sin_cuadros_descarta():
    c = senal([("pie", 1.5), ("rep", 4, 90), ("pie", 1)])
    s = correr(c[:90] + c[140:])
    assert not s.repeticiones and s.descartadas[0]["motivo"] == "se perdio la vista"


def test_pico_de_un_cuadro_no_fija_el_minimo_ni_cuenta():
    c = senal([("pie", 1.5), ("rep", 2, 100), ("pie", 2)])
    c[60]["angulos"].update(rodilla_izq=20.0, rodilla_der=20.0)
    c[130]["angulos"].update(rodilla_izq=60.0, rodilla_der=60.0)
    s = correr(c)
    assert len(s.repeticiones) == 1 and s.repeticiones[0]["rodilla_min"] > 95


@pytest.mark.parametrize("lado", ["izq", "der"])
def test_un_solo_lado_visible_se_abstiene_en_la_diferencia(lado):
    s = correr(senal(TRES, lados=lado))
    assert len(s.repeticiones) == 3
    assert all(r["lado"] == lado and r["dif_rodilla"] is None and r["dif_cadera"] is None for r in s.repeticiones)
    assert s.resumen()["dif_rodilla"] == {"n": 0, "media": None, "de": None, "min": None, "max": None}


def test_diferencia_entre_lados():
    s = correr(senal(TRES, desfase=8.0))
    assert [r["dif_rodilla"] for r in s.repeticiones] == [pytest.approx(-8.0, abs=0.1)] * 3


def test_sin_estar_de_pie_no_empieza():
    s = correr(senal([("media", 4, 90)])[60:])
    assert s.referencia is None and not s.repeticiones


def test_cuenta_regresiva_ignora_el_movimiento_y_cierra_sola():
    tramos = [("rep", 2, 80), ("pie", 3), ("rep", 2, 90), ("pie", 12), ("rep", 2, 90)]
    s = Q.SerieSentadilla(segundos_preparacion=3.0, segundos_fin=8.0)
    fases = []
    for c in senal(tramos):
        s.paso(c["angulos"], c["t"])
        fases.append(s.fase)
    assert fases[0] == "preparando" and s.terminada and len(s.repeticiones) == 1


def test_guardar_json_y_csv_sin_pisar(tmp_path):
    r = correr(senal(TRES, lados="izq")).resultado()
    a, b = Q.guardar(r, tmp_path), Q.guardar(r, tmp_path)
    assert a != b and a.exists() and b.with_suffix(".csv").exists()
    datos = json.loads(a.read_text(encoding="utf-8"))
    assert datos["nota"] == "no validado, no es medicion medica" and len(datos["repeticiones"]) == 3
    filas = list(csv.DictReader(a.with_suffix(".csv").open(encoding="utf-8")))
    assert len(filas) == 3 and filas[0]["dif_rodilla"] == "" and filas[0]["nota"] == Q.NOTA
    assert "3 repeticiones" in Q.texto(r)


def test_instrucciones_ascii_en_todas_las_fases():
    s = Q.SerieSentadilla(segundos_preparacion=2.0, segundos_fin=None)
    vistos = {}
    img = np.zeros((360, 640, 3), np.uint8)
    base = {"pose": None, "angulos": {}, "calidad": "sin persona", "vis_media": 0.0, "fps": 30.0,
            "latencia_ms": 1.0, "enderezar": False, "rot_grados": 0.0, "identidad": 0, "n_candidatas": 0}
    cuadros = senal([("pie", 3.5), ("rep", 2, 90), ("pie", 1)])
    for i, c in enumerate(cuadros + [None]):
        if c is None:
            s.terminar()
        else:
            s.paso(c["angulos"], c["t"])
        e = {**base, "sentadilla": s.estado(cuadros[-1]["t"] if c is None else c["t"])}
        if s.fase not in vistos or i % 20 == 0:
            texto = dibujo.pasos(e, 0.6)
            vistos.setdefault(s.fase, texto)
            assert texto.isascii()
            anotada = dibujo.dibujar(img.copy(), e, 0.6)
            assert dibujo.guiar(anotada, e, 0.6).shape == (460, 640, 3)
    assert set(vistos) == {"preparando", "buscando", "listo", "abajo", "fin"}
    assert "DE LADO" in vistos["preparando"] and "1 repeticiones" in vistos["fin"]


def test_procesador_guarda_la_serie(monkeypatch, tmp_path):
    proc, reloj, salida = procesador_falso(monkeypatch, tmp_path)
    proc.alternar_sentadilla(segundos_preparacion=1.0, segundos_fin=None)
    img = np.zeros((4, 4, 3), np.uint8)
    vis = np.ones(33)
    vis[[24, 26, 28]] = 0.2  # lado derecho oculto, como de lado
    for n in range(1, 241):
        t = n / 30
        reloj.t = t
        flexion = 90 * (1 - math.cos(2 * math.pi * (t - 3) / 3)) / 2 if 3 <= t <= 6 else 0
        salida.pose = pose_falsa(doblar_rodillas(pose_base(), flexion), vis)
        _, e = proc.paso(img, int(t * 1000), 30.0)
    proc.iniciar_calibracion()
    assert not proc.calibrador.activo and proc.serie_activa  # no se calibra durante una serie
    proc.alternar_sentadilla()
    assert proc.serie.terminada and proc.ruta_serie.exists()
    r = json.loads(proc.ruta_serie.read_text(encoding="utf-8"))
    assert len(r["repeticiones"]) == 1 and r["repeticiones"][0]["dif_rodilla"] is None
    assert r["repeticiones"][0]["rodilla_min"] == pytest.approx(90, abs=8)
    proc.cerrar()
    assert len(list((tmp_path / "sentadillas").glob("*.json"))) == 1  # no se guarda dos veces
