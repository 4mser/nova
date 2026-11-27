"""Pruebas de la demo: guion, tiempo real, grabación sin cámara, orientación 3D y generación sobre la muestra."""
from pathlib import Path

import cv2
import numpy as np
import pytest

from pose_twin import demo
from pose_twin.fuente import ErrorFuente

RAIZ = Path(__file__).resolve().parents[1]
MUESTRA = RAIZ / "data" / "muestras" / "sentadilla.webm"


class GrabadorMemoria:
    """Sustituye al Grabador: guarda en memoria el primer píxel de cada cuadro y crea un archivo vacío."""

    def __init__(self, ruta, fps, tam):
        self.ruta, self.fps, self.tam = Path(ruta), fps, tam
        self.cuadros: list[int] = []
        self.cerrado = False
        self.ruta.write_bytes(b"x")

    def escribir(self, img):
        self.cuadros.append(int(img[0, 0, 0]))

    def cerrar(self):
        self.cerrado = True
        return self.ruta


class Reloj:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


class CamaraFalsa:
    es_archivo = False
    fps = 30.0

    def __init__(self, reloj, fps_real=10.0, falla_en=None):
        self.reloj, self.fps_entrega, self.falla_en = reloj, fps_real, falla_en

    def leer(self):
        self.reloj.t += 1.0 / self.fps_entrega
        if self.falla_en is not None and self.reloj.t >= self.falla_en:
            return False, None, None
        return True, np.full((48, 64, 3), int(self.reloj.t * 10) % 250, np.uint8), None


class VentanaFalsa:
    def __init__(self, teclas=None):
        self.teclas = teclas or {}
        self.n = 0

    def mostrar(self, img, espera_ms=1):
        self.n += 1
        return self.teclas.get(self.n, -1)


def _grabar(tmp_path, fps_real=10.0, teclas=None, falla_en=None, **kw):
    reloj = Reloj()
    creados = []

    def crear(*a):
        creados.append(GrabadorMemoria(*a))
        return creados[-1]

    kw.setdefault("preparacion", 2.0)
    kw.setdefault("cuenta", 1.0)
    ruta = tmp_path / "demo_x.mp4"
    demo.bucle_grabacion(CamaraFalsa(reloj, fps_real, falla_en), VentanaFalsa(teclas), ruta, 10.0,
                         reloj=reloj, crear_grabador=crear, **kw)
    return ruta, creados, reloj


def test_guion_cubre_toda_la_duracion_sin_huecos():
    lista = demo.tramos(30)
    assert lista[0][0] == 0 and lista[-1][1] == 30
    assert all(a[1] == b[0] for a, b in zip(lista, lista[1:]))
    assert [demo.tramo_en(t, 30) for t in (0, 7, 15, 29.9, 31)] == [0, 1, 2, 3, 3]
    assert "SENTADILLAS" in lista[-1][2]


def test_textos_en_pantalla_son_ascii():
    assert demo.ROTULO.isascii()
    assert all(t.isascii() and d.isascii() for _, t, d in demo.GUION)


@pytest.mark.parametrize("fps_camara", [5, 10, 30, 47])
def test_video_dura_lo_mismo_que_la_toma(tmp_path, fps_camara):
    g = GrabadorMemoria(tmp_path / "a.mp4", 30, (4, 4))
    e = demo.EscritorTiempoReal(g, 30)
    for i in range(fps_camara * 4):
        e.agregar(np.full((4, 4, 3), i % 250, np.uint8), i / fps_camara)
    e.terminar(4.0)
    assert len(g.cuadros) == 120


def test_cada_hueco_recibe_el_cuadro_vigente(tmp_path):
    g = GrabadorMemoria(tmp_path / "a.mp4", 10, (4, 4))
    e = demo.EscritorTiempoReal(g, 10)
    for valor, t in ((1, 0.0), (2, 0.3), (3, 0.5)):
        e.agregar(np.full((4, 4, 3), valor, np.uint8), t)
    e.terminar(0.7)
    assert g.cuadros == [1, 1, 1, 2, 2, 3, 3]


def test_fps_de_grabacion():
    assert [demo.fps_de_grabacion(f) for f in (0, 4, 9.8, 29.97, 60)] == [30, 10, 10, 30, 30]


@pytest.mark.parametrize("fps_real", [10.0, 8.0])
def test_grabacion_con_camara_lenta_a_velocidad_real(tmp_path, fps_real):
    ruta, creados, reloj = _grabar(tmp_path, fps_real)
    g = creados[0]
    assert g.fps == 10.0 and g.cerrado and ruta.exists()
    assert len(g.cuadros) / g.fps == pytest.approx(10.0)
    assert reloj.t == pytest.approx(13.0, abs=0.5)  # 2 s de preparación + 1 de cuenta + 10 grabados
    assert g.cuadros[0] >= 29  # nada de la preparación queda grabado


def test_espacio_adelanta_la_preparacion(tmp_path):
    _, _, reloj = _grabar(tmp_path, teclas={1: ord(" ")}, preparacion=60.0)
    assert reloj.t < 12.0


def test_cancelar_borra_lo_grabado(tmp_path):
    with pytest.raises(demo.Cancelado):
        _grabar(tmp_path, teclas={60: ord("q")})
    assert not (tmp_path / "demo_x.mp4").exists()


def test_cancelar_antes_de_grabar_no_crea_video(tmp_path):
    with pytest.raises(demo.Cancelado):
        _grabar(tmp_path, teclas={2: ord("q")})
    assert not list(tmp_path.iterdir())


def test_camara_que_se_corta_no_deja_video(tmp_path):
    with pytest.raises(ErrorFuente):
        _grabar(tmp_path, falla_en=6.0)
    assert not (tmp_path / "demo_x.mp4").exists()


def test_camara_se_libera_aunque_se_cancele(tmp_path, monkeypatch):
    cerrados = []

    class Fuente(CamaraFalsa):
        def cerrar(self):
            cerrados.append("camara")

    class Ventana(VentanaFalsa):
        def __init__(self):
            super().__init__({1: ord("q")})

        def cerrar(self):
            cerrados.append("ventana")

    monkeypatch.setattr(demo, "abrir_fuente", lambda *a, **k: Fuente(Reloj()))
    monkeypatch.setattr(demo, "VentanaCV", Ventana)
    assert demo.main(["grabar", "--out", str(tmp_path / "demo_y.mp4")]) == 1
    assert cerrados == ["camara", "ventana"]


def test_vista_previa_en_espejo_no_toca_el_cuadro():
    cuadro = np.zeros((480, 640, 3), np.uint8)
    cuadro[:, :100] = 255
    original = cuadro.copy()
    vista = demo.pantalla_grabacion(cuadro, "T", "d", "p")
    assert vista[200, -20, 0] == 255 and vista[200, 20, 0] == 0
    assert np.array_equal(cuadro, original)


def test_orientacion_de_frente_coincide_con_la_imagen():
    # puntos de MediaPipe: (derecha de la imagen, abajo) respecto de las caderas
    mundo = np.array([[0.0, 0.0, 0.0], [0.3, 0.0, 0.0], [0.0, -0.5, 0.0]])
    escena = demo.a_escena(mundo)
    escena[:, 1] += demo.ALTURA_CENTRO_M
    px, _ = demo.proyectar(escena, 0.0, 0.0, 100.0, (200.0, 200.0))
    assert px[1, 0] > px[0, 0] and px[1, 1] == pytest.approx(px[0, 1])  # derecha sigue a la derecha
    assert px[2, 1] < px[0, 1]  # arriba sigue arriba


def test_a_escena_no_refleja_y_lo_cercano_queda_delante():
    assert np.linalg.det(demo.a_escena(np.eye(3))) == pytest.approx(1.0)
    cerca_lejos = demo.a_escena(np.array([[0.0, 0.0, -0.3], [0.0, 0.0, 0.3]]))  # z negativo = hacia la cámara
    _, prof = demo.proyectar(cerca_lejos, 0.0, 0.0, 100.0, (0.0, 0.0))
    assert prof[0] > prof[1]


def test_giro_suave_desde_la_vista_de_camara():
    angulos = [demo.azimut_en(i / 30) for i in range(600)]
    assert angulos[0] == 0 and max(map(abs, angulos)) <= demo.GIRO_GRADOS + 1e-9
    assert max(abs(b - a) for a, b in zip(angulos, angulos[1:])) < 1.0


def test_colores_por_lado_de_la_persona():
    assert demo.color_hueso(11, 13) == demo.COLOR_IZQ
    assert demo.color_hueso(12, 14) == demo.COLOR_DER
    assert demo.color_hueso(11, 12) == demo.COLOR_CENTRO
    assert demo.color_hueso(0, 2) == demo.COLOR_CENTRO and demo.color_hueso(2, 7) == demo.COLOR_IZQ
    assert demo.color_hueso(5, 8) == demo.COLOR_DER


def test_puntos_poco_visibles_tenues_u_ocultos():
    assert [demo.estilo(v, 0.6) for v in (0.9, 0.45, 0.1)] == ["solido", "tenue", "oculto"]
    mundo = np.random.default_rng(0).uniform(-0.5, 0.5, (33, 3))
    vacio = demo.panel_3d(mundo, np.zeros(33), None, 0.0, 400, 400, 0.6)
    lleno = demo.panel_3d(mundo, np.ones(33), None, 0.0, 400, 400, 0.6)
    brillantes = lambda p: int((p[60:].max(axis=2) > 180).sum())  # noqa: E731  (sin el texto de arriba)
    assert brillantes(vacio) == 0 and brillantes(lleno) > 100


def test_suelo_usa_el_pie_visible_mas_bajo():
    escena = np.zeros((33, 3))
    escena[31, 1], escena[32, 1] = -0.9, -1.5
    vis = np.zeros(33)
    suelo = demo.Suelo()
    assert suelo.actualizar(escena, vis, 0.6) is None
    vis[31] = 1.0
    assert suelo.actualizar(escena, vis, 0.6) == pytest.approx(0.9)  # el 32 no se ve: no cuenta
    assert suelo.actualizar(escena, np.zeros(33), 0.6) == pytest.approx(0.9)


def test_componer_sin_persona():
    img = np.zeros((720, 1280, 3), np.uint8)
    cuadro = demo.componer(img, None, None, None, {}, "sin persona", 1.0)
    assert cuadro.shape == (demo.ALTO, demo.ANCHO, 3)


def test_ultima_grabacion_ignora_otras_y_temporales(tmp_path):
    assert demo.ultima_grabacion(tmp_path) is None
    for n in ("demo_20260101_000000.mp4", "demo_20260102_000000.mp4", "demo_20260103_000000.tmp.mp4",
              "grabacion_20270101_000000.mp4"):
        (tmp_path / n).write_bytes(b"x")
    assert demo.ultima_grabacion(tmp_path).name == "demo_20260102_000000.mp4"


def test_generar_sin_grabaciones_da_error_claro(monkeypatch, capsys):
    monkeypatch.setattr(demo, "ultima_grabacion", lambda: None)
    assert demo.main(["generar"]) == 2
    assert "grabar" in capsys.readouterr().err


def test_generar_no_pisa_la_entrada(tmp_path):
    ruta = tmp_path / "v.mp4"
    ruta.write_bytes(b"x")
    with pytest.raises(ErrorFuente):
        demo.generar(ruta, ruta)
    assert ruta.read_bytes() == b"x"


@pytest.mark.slow
@pytest.mark.skipif(not MUESTRA.exists(), reason="falta data/muestras/sentadilla.webm (ver README)")
def test_generar_sobre_la_muestra(tmp_path):
    salida = tmp_path / "demo.mp4"
    r = demo.generar(MUESTRA, salida, modelo="full", max_cuadros=15)
    assert r["cuadros"] == 15 and r["detectados"] > 0
    cap = cv2.VideoCapture(str(salida))
    try:
        assert (cap.get(cv2.CAP_PROP_FRAME_WIDTH), cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) == (demo.ANCHO, demo.ALTO)
        assert int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) == 15
    finally:
        cap.release()
    assert not salida.with_suffix(".tmp.mp4").exists()
