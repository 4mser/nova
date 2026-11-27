import math

import numpy as np
import pytest

from pose_twin.filtros import FiltroAngulos, OneEuro
from pose_twin.geometria import (
    ANGULOS, aplicar_afin, angulo_torso, angulo_vertice, angulos_articulares, desrotar_mundo, iou,
    longitudes_segmentos, rotacion_lienzo,
)


def pose_de_pie(escala=1.0, desplazamiento=(0.0, 0.0)):
    """33 puntos sintéticos de una persona de pie con brazos en T (píxeles, y hacia abajo)."""
    p = np.zeros((33, 2))
    p[11], p[12] = (60, 100), (40, 100)  # hombros (11 = izquierdo de la persona, a la derecha de la imagen)
    p[13], p[14] = (80, 100), (20, 100)  # codos en T
    p[15], p[16] = (100, 100), (0, 100)  # muñecas
    p[23], p[24] = (57, 160), (43, 160)  # caderas
    p[25], p[26] = (57, 210), (43, 210)  # rodillas
    p[27], p[28] = (57, 260), (43, 260)  # tobillos
    p[0] = (50, 80)
    return p * escala + np.asarray(desplazamiento)


@pytest.mark.parametrize("a,v,b,esperado", [
    ((1, 0), (0, 0), (0, 1), 90.0),
    ((1, 0), (0, 0), (-1, 0), 180.0),
    ((1, 0), (0, 0), (1, 0), 0.0),
    ((1, 0, 0), (0, 0, 0), (1, 1, 0), 45.0),
    ((0, 0, 2), (0, 0, 0), (0, 3, 0), 90.0),
])
def test_angulo_vertice(a, v, b, esperado):
    assert angulo_vertice(a, v, b) == pytest.approx(esperado, abs=1e-6)


def test_angulo_vertice_degenerado_es_nan():
    assert math.isnan(angulo_vertice((0, 0), (0, 0), (1, 0)))


def test_angulos_de_pie_en_t():
    p = pose_de_pie()
    ang = angulos_articulares(np.hstack([p, np.zeros((33, 1))]), np.ones(33))
    assert set(ang) == set(ANGULOS)
    assert ang["codo_izq"] == pytest.approx(180, abs=1e-6)
    assert ang["rodilla_der"] == pytest.approx(180, abs=1e-6)
    assert ang["hombro_izq"] == pytest.approx(90 + math.degrees(math.atan2(3, 60)), abs=1e-6)


def test_abstencion_por_visibilidad_baja():
    p = pose_de_pie()
    vis = np.ones(33)
    vis[15] = 0.2  # muñeca izquierda poco visible
    ang = angulos_articulares(p, vis, umbral=0.6)
    assert ang["codo_izq"] is None  # usa la muñeca 15
    assert ang["codo_der"] is not None
    assert ang["hombro_izq"] is not None  # no usa la muñeca


def test_abstencion_en_el_umbral_exacto_no_se_abstiene():
    vis = np.full(33, 0.6)
    assert all(v is not None for v in angulos_articulares(pose_de_pie(), vis, umbral=0.6).values())


@pytest.mark.parametrize("grados", [0, 15, -30, 90, 135, 180, -90, 271.5])
def test_rotacion_ida_y_vuelta(grados):
    rot = rotacion_lienzo(640, 480, grados)
    p = np.random.default_rng(0).uniform([0, 0], [640, 480], size=(50, 2))
    q = aplicar_afin(rot.M, p)
    assert np.all(q >= -1e-6) and np.all(q[:, 0] <= rot.ancho + 1e-6) and np.all(q[:, 1] <= rot.alto + 1e-6)
    np.testing.assert_allclose(aplicar_afin(rot.Minv, q), p, atol=1e-9)


def test_rotacion_coincide_con_opencv():
    cv2 = pytest.importorskip("cv2")
    rot = rotacion_lienzo(300, 200, 37.0)
    ref = cv2.getRotationMatrix2D((150, 100), 37.0, 1.0)
    np.testing.assert_allclose(rot.M[:, :2], ref[:, :2], atol=1e-12)


def test_lienzo_cuadrado_no_depende_del_angulo():
    tams = {(rotacion_lienzo(640, 360, a, cuadrado=True).ancho, rotacion_lienzo(640, 360, a, cuadrado=True).alto)
            for a in (0, 33, 90, 180)}
    assert len(tams) == 1


@pytest.mark.parametrize("inclinacion", [0, 25, -40, 90, 180, -120])
def test_enderezar_deja_el_torso_vertical(inclinacion):
    p = pose_de_pie(desplazamiento=(200, 100))
    centro = p[[23, 24]].mean(axis=0)
    # inclina la persona `inclinacion` grados en sentido horario (visto en pantalla)
    r = math.radians(inclinacion)
    R = np.array([[math.cos(r), -math.sin(r)], [math.sin(r), math.cos(r)]])
    inclinada = (p - centro) @ R.T + centro
    t = angulo_torso(inclinada)
    assert t == pytest.approx(((inclinacion + 180) % 360) - 180 if inclinacion != 180 else 180, abs=1e-6)
    rot = rotacion_lienzo(640, 480, t)
    assert angulo_torso(aplicar_afin(rot.M, inclinada)) == pytest.approx(0, abs=1e-6)


def test_desrotar_mundo_recupera_angulos_y_ejes():
    rot = rotacion_lienzo(640, 480, 70)
    mundo = np.random.default_rng(1).normal(size=(33, 3))
    girado = mundo.copy()
    girado[:, :2] = mundo[:, :2] @ rot.M[:, :2].T
    np.testing.assert_allclose(desrotar_mundo(girado, rot), mundo, atol=1e-12)
    # los ángulos articulares 3D no cambian con la rotación
    a1 = angulos_articulares(mundo, np.ones(33))
    a2 = angulos_articulares(girado, np.ones(33))
    for k in a1:
        assert a1[k] == pytest.approx(a2[k], abs=1e-9)


def test_longitudes_segmentos():
    p = pose_de_pie()
    mundo = np.hstack([p, np.zeros((33, 1))])
    L = longitudes_segmentos(mundo)
    assert L["brazo_izq"] == pytest.approx(20)
    assert L["ancho_hombros"] == pytest.approx(20)
    assert L["torso"] == pytest.approx(60)


def test_iou():
    assert iou((0, 0, 10, 10), (0, 0, 10, 10)) == pytest.approx(1)
    assert iou((0, 0, 10, 10), (20, 20, 30, 30)) == 0
    assert iou((0, 0, 10, 10), (5, 0, 15, 10)) == pytest.approx(50 / 150)


def test_one_euro_suaviza_ruido_y_sigue_escalones():
    rng = np.random.default_rng(2)
    f = OneEuro(min_corte=1.0, beta=0.02)
    t = np.arange(0, 3, 1 / 30)
    ruido = 90 + rng.normal(0, 3, size=len(t))
    salida = np.array([f(x, ti) for x, ti in zip(ruido, t)])
    assert np.std(salida[30:]) < 0.5 * np.std(ruido[30:])
    f.reiniciar()
    escalon = [f(0.0 if ti < 1 else 100.0, ti) for ti in t]
    assert escalon[-1] == pytest.approx(100, abs=2)


def test_filtro_angulos_reinicia_con_abstencion():
    f = FiltroAngulos()
    f({"codo": 10.0}, 0.0)
    assert f({"codo": None}, 0.033)["codo"] is None
    assert f({"codo": 170.0}, 0.066)["codo"] == pytest.approx(170.0)  # sin arrastre del valor viejo
