import json

import numpy as np
import pytest

from pose_twin import perfil as P
from pose_twin.seleccion import Candidata, Seguidor
from tests.test_geometria import pose_de_pie


def cand(escala=1.0, dx=0.0, dy=0.0, vis=1.0):
    return Candidata(pose_de_pie(escala, (dx, dy)), np.full(33, vis))


def test_primera_seleccion_prefiere_la_mas_grande_y_centrada():
    s = Seguidor()
    pequena = cand(0.5, 20, 20)
    grande = cand(1.5, 250, 100)
    assert s.elegir([pequena, grande], 640, 480) == 1
    assert s.identidad == 1


def test_mantiene_identidad_aunque_aparezca_otra_mas_grande():
    s = Seguidor()
    s.elegir([cand(1.0, 100, 50)], 640, 480)
    # cuadro siguiente: la seguida se movió un poco; entra otra persona más grande lejos
    otra = cand(1.8, 400, 0)
    seguida = cand(1.0, 108, 52)
    assert s.elegir([otra, seguida], 640, 480) == 1
    assert s.identidad == 1


def test_rechaza_salto_y_libera_tras_varios_cuadros():
    s = Seguidor(compuerta=0.6, max_perdidos=3)
    s.elegir([cand(1.0, 0, 0)], 1000, 1000)
    lejos = cand(1.0, 700, 600)
    for _ in range(4):
        assert s.elegir([lejos], 1000, 1000) is None
    # tras superar max_perdidos se libera y vuelve a fijar (nueva identidad)
    assert s.elegir([lejos], 1000, 1000) == 0
    assert s.identidad == 2


def test_sin_candidatas_no_falla():
    s = Seguidor()
    assert s.elegir([], 640, 480) is None
    assert not s.fijado


def test_calidad():
    idx = list(range(12))
    assert P.calidad(np.full(33, 0.95), idx)[0] == "buena"
    assert P.calidad(np.full(33, 0.7), idx)[0] == "regular"
    assert P.calidad(np.full(33, 0.2), idx)[0] == "baja"


def _muestras(n=40, ruido=0.0, seed=0):
    rng = np.random.default_rng(seed)
    base = np.hstack([pose_de_pie(0.01), np.zeros((33, 1))])  # ~metros
    segs, angs = [], []
    from pose_twin.geometria import angulos_articulares, longitudes_segmentos

    for _ in range(n):
        m = base + rng.normal(0, ruido, size=base.shape)
        segs.append(longitudes_segmentos(m))
        angs.append(angulos_articulares(m, np.ones(33)))
    return base, segs, angs


def test_perfil_estadisticas_y_guardado(tmp_path):
    base, segs, angs = _muestras(ruido=0.002)
    perfil = P.construir_perfil("Niko prueba", segs, angs)
    assert perfil["muestras"] == 40
    assert perfil["segmentos"]["brazo_izq"]["mediana_m"] == pytest.approx(0.20, abs=0.01)
    assert perfil["segmentos"]["torso"]["proporcion_torso"] == pytest.approx(1.0)
    assert perfil["segmentos"]["brazo_izq"]["mad_m"] > 0
    assert perfil["angulos"]["codo_izq"]["p5"] <= perfil["angulos"]["codo_izq"]["mediana"] <= perfil["angulos"]["codo_izq"]["p95"]
    ruta = P.guardar(perfil, tmp_path)
    assert ruta.name == "Niko_prueba.json"
    assert json.loads(ruta.read_text(encoding="utf-8"))["nombre"] == "Niko prueba"
    assert P.cargar("Niko prueba", tmp_path)["muestras"] == 40
    assert P.cargar("no-existe", tmp_path) is None


def test_perfil_diferencias():
    base, segs, angs = _muestras()
    perfil = P.construir_perfil("x", segs, angs)
    d = P.diferencias(perfil, {"codo_izq": 150.0, "codo_der": None}, base)
    assert d["angulos"]["codo_izq"] == pytest.approx(150.0 - perfil["angulos"]["codo_izq"]["mediana"])
    assert d["angulos"]["codo_der"] is None
    assert d["segmentos"]["brazo_izq"] == pytest.approx(0.0, abs=1e-6)
    largo = base.copy()
    largo[13, 0] += 0.02  # codo más lejos: brazo 10% más largo
    assert P.diferencias(perfil, {}, largo)["segmentos"]["brazo_izq"] == pytest.approx(10.0, abs=0.01)


def test_calibrador_exige_muestras_buenas():
    base, segs, angs = _muestras(n=5)
    c = P.Calibrador(segundos=1.0, min_muestras=10)
    c.iniciar(0.0)
    for a in angs:
        c.agregar(base, a, "buena")
    c.agregar(base, angs[0], "regular")  # no cuenta
    assert len(c.segmentos) == 5
    assert c.terminado(1.5)
    with pytest.raises(ValueError, match="insuficiente"):
        c.construir("x")


@pytest.mark.parametrize("malo", ["", "   ", "///"])
def test_nombre_perfil_invalido(malo):
    with pytest.raises(ValueError):
        P.nombre_seguro(malo)


def test_nombre_perfil_no_escapa_de_la_carpeta():
    assert "/" not in P.nombre_seguro("../../etc/passwd") and "\\" not in P.nombre_seguro("..\\x")
