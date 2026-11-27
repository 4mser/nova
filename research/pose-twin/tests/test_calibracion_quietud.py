"""Calibración: rechaza capturas con movimiento sin pisar el perfil anterior y avisa si hay pocos cuadros."""
import json
import math

import numpy as np
import pytest

from pose_twin import dibujo
from pose_twin import perfil as P
from pose_twin.geometria import ANGULOS
from tests.sinteticos import doblar_rodillas, pose_base, pose_falsa, procesador_falso


def perfil_de(**cambios):
    quieto = {"mediana": 170.0, "mad": 2.0, "p5": 166.0, "p95": 173.0, "n": 60}
    return {"angulos": {k: {**quieto, **cambios.get(k, {})} for k in ANGULOS}}


@pytest.mark.parametrize("cambios", [
    {},
    {"codo_der": {"mad": 9.5, "p5": 112.0, "p95": 149.0}},  # brazos algo inquietos, piernas quietas
    {"hombro_izq": {"mad": 14.9}, "rodilla_izq": {"mad": 10.0, "p5": 150.0, "p95": 170.0}},  # justo en el límite
    {"rodilla_izq": {"mad": 40.0, "p5": 40.0, "n": 9}},  # casi sin datos: no se juzga
])
def test_capturas_quietas_se_aceptan(cambios):
    assert P.movimiento(perfil_de(**cambios)) is None


@pytest.mark.parametrize("cambios, texto", [
    ({"rodilla_der": {"p5": 50.0, "p95": 165.0}}, "rodilla der: rango"),
    ({"cadera_izq": {"p5": 150.0, "p95": 170.1}}, "cadera izq: rango"),
    ({"rodilla_izq": {"mad": 10.1}}, "rodilla izq: dispersion"),
    ({"codo_izq": {"mad": 16.7}}, "codo izq: dispersion"),
])
def test_capturas_con_movimiento_se_rechazan(cambios, texto):
    assert texto in P.movimiento(perfil_de(**cambios))


def test_abstenciones_no_rompen_la_regla():
    p = perfil_de()
    p["angulos"]["codo_izq"] = None
    assert P.movimiento(p) is None


def _calibrar(proc, reloj, salida, fps, flexion, rng):
    proc.iniciar_calibracion()
    t0, img = reloj.t, np.zeros((4, 4, 3), np.uint8)
    n = 0
    while proc.calibrador.activo or proc._calib_pendiente:
        n += 1
        reloj.t = t0 + n / fps
        mundo = doblar_rodillas(pose_base(), flexion(reloj.t - t0)) + rng.normal(0, .005, (33, 3))
        salida.pose = pose_falsa(mundo, np.ones(33))
        _, estado = proc.paso(img, int(reloj.t * 1000), fps)
    return estado


def test_movimiento_no_sobrescribe_el_perfil(monkeypatch, tmp_path):
    proc, reloj, salida = procesador_falso(monkeypatch, tmp_path, nombre_perfil="x", segundos_preparacion=1.0,
                                           segundos_calibracion=6.0)
    rng = np.random.default_rng(1)
    estado = _calibrar(proc, reloj, salida, 30, lambda t: 0.0, rng)
    assert estado["resultado_calibracion"] == "Calibracion guardada. Ya puedes moverte."
    antes = (tmp_path / "x.json").read_bytes()
    perfil = proc.perfil

    sentadillas = lambda t: 55 * (1 - math.cos(2 * math.pi * t / 3))  # dos sentadillas durante la captura
    estado = _calibrar(proc, reloj, salida, 30, sentadillas, rng)
    texto = estado["resultado_calibracion"]
    assert texto.startswith("No se pudo calibrar, te moviste") and "rodilla" in texto
    assert "perfil anterior se mantiene" in texto and "pulsa C" in texto and texto.isascii()
    assert "cuadros/s" not in texto
    assert proc.perfil is perfil and (tmp_path / "x.json").read_bytes() == antes
    assert dibujo.pasos(estado, 0.6) == texto


def test_primera_captura_con_movimiento_no_crea_perfil(monkeypatch, tmp_path):
    proc, reloj, salida = procesador_falso(monkeypatch, tmp_path, nombre_perfil="x", segundos_calibracion=6.0)
    estado = _calibrar(proc, reloj, salida, 30, lambda t: 40 * (t % 2), np.random.default_rng(2))
    assert proc.perfil is None and not (tmp_path / "x.json").exists()
    assert "anterior" not in estado["resultado_calibracion"]


@pytest.mark.parametrize("fps, avisa", [(10, True), (14, True), (16, False)])
def test_aviso_de_pocos_cuadros_no_bloquea(monkeypatch, tmp_path, fps, avisa):
    proc, reloj, salida = procesador_falso(monkeypatch, tmp_path, nombre_perfil="x", segundos_calibracion=6.0)
    estado = _calibrar(proc, reloj, salida, fps, lambda t: 0.0, np.random.default_rng(3))
    assert json.loads((tmp_path / "x.json").read_text(encoding="utf-8"))["muestras"] >= 15
    texto = estado["resultado_calibracion"]
    assert texto.startswith("Calibracion guardada") and ("poca luz" in texto) is avisa and texto.isascii()
