"""Pruebas de la fluidez en vivo: diagnóstico por etapa, cierre sin persona, captura en hilo y opciones de cámara."""
import time

import cv2
import numpy as np
import pytest

from pose_twin import fuente as fuente_mod
from pose_twin.__main__ import construir_parser
from pose_twin.diagnostico import Ausencia, Cronometro
from pose_twin.fuente import FuenteCamaraHilo, abrir_fuente


# ---- Cronometro -------------------------------------------------------------------

def test_cronometro_resume_por_grupo_y_etapa(tmp_path):
    c = Cronometro(activo=True)
    for i in range(10):
        c.medir("inferencia", 20.0 + i)
        with c.etapa("dibujo"):
            pass
        c.medir("dibujo", 1.0)
        c.cerrar_cuadro(persona=i % 2 == 0, latencia_ms=30.0)
    r = c.resumen()
    assert set(r) == {"con persona", "sin persona"}
    assert r["con persona"]["n"] == 5
    med, p95 = r["con persona"]["inferencia"]
    assert med == pytest.approx(24.0) and p95 >= med
    assert r["con persona"]["dibujo"][0] >= 1.0
    assert r["sin persona"]["latencia"] == (30.0, 30.0)
    assert "inferencia" in c.texto() and "latencia" in c.texto()
    ruta = c.guardar_csv(tmp_path / "d.csv")
    lineas = ruta.read_text(encoding="utf-8").splitlines()
    assert len(lineas) == 11 and lineas[0].startswith("t_s,persona,captura")


def test_cronometro_inactivo_no_guarda_pero_reinicia():
    c = Cronometro(activo=False)
    c.medir("captura", 5.0)
    assert c.cerrar_cuadro(True) == {"captura": 5.0}
    assert c.cerrar_cuadro(True) == {}
    assert c.filas == [] and c.texto().startswith("Diagnóstico: sin cuadros")


# ---- cierre por ausencia ----------------------------------------------------------

def test_ausencia_cierra_tras_minutos_sin_persona():
    a = Ausencia(5, ahora=0.0)
    assert not a.ver(False, ahora=299.0)
    assert a.ver(False, ahora=300.0)


def test_ausencia_se_reinicia_al_ver_persona_y_0_desactiva():
    a = Ausencia(1, ahora=0.0)
    assert not a.ver(True, ahora=50.0)
    assert not a.ver(False, ahora=100.0)  # 50 s desde la última persona
    assert a.ver(False, ahora=110.0)
    nunca = Ausencia(0, ahora=0.0)
    assert not nunca.ver(False, ahora=1e9)
    assert not Ausencia(None, ahora=0.0).ver(False, ahora=1e9)


# ---- captura en hilo --------------------------------------------------------------

class CapFalsa:
    """Imita cv2.VideoCapture: entrega cuadros numerados cada `dt` segundos."""

    def __init__(self, dt=0.005, n=None, fallar_desde=None):
        self.dt, self.n, self.fallar_desde = dt, n, fallar_desde
        self.i = 0
        self.sets: list[tuple[int, float]] = []
        self.liberada = False
        self.abierta = True

    def isOpened(self):
        return self.abierta

    def read(self):
        time.sleep(self.dt)
        if self.fallar_desde is not None and self.i >= self.fallar_desde:
            return False, None
        self.i += 1
        return True, np.full((4, 4, 3), self.i % 256, np.uint8)

    def get(self, prop):
        return {cv2.CAP_PROP_FPS: 30.0, cv2.CAP_PROP_FRAME_WIDTH: 640.0, cv2.CAP_PROP_FRAME_HEIGHT: 480.0}.get(prop, 0.0)

    def set(self, prop, val):
        self.sets.append((prop, val))
        return True

    def release(self):
        self.liberada = True


def test_hilo_entrega_el_ultimo_cuadro_y_cuenta_descartados():
    cap = CapFalsa(dt=0.002)
    f = FuenteCamaraHilo(cap, "falsa")
    try:
        ok, img, t = f.leer()
        assert ok and img is not None and t is None
        assert f.ultimo_t_captura is not None and f.ultimo_t_captura <= time.perf_counter()
        time.sleep(0.1)  # el bucle "procesa" y mientras llegan varios cuadros
        ok, img2, _ = f.leer()
        assert ok and int(img2[0, 0, 0]) != int(img[0, 0, 0])
        assert f.descartados >= 3  # solo se entrega el último
        assert f.fps_entrega > 30
    finally:
        f.cerrar()
    assert cap.liberada


def test_hilo_no_repite_cuadros_y_termina_si_la_camara_falla():
    cap = CapFalsa(dt=0.001, fallar_desde=3)
    f = FuenteCamaraHilo(cap, "falsa", max_fallos=5)
    try:
        vistos = []
        for _ in range(10):
            ok, img, _ = f.leer(espera_s=0.5)
            if not ok:
                break
            if img is not None:
                vistos.append(int(img[0, 0, 0]))
        assert not ok  # la fuente avisa el fin
        assert len(vistos) == len(set(vistos)) and len(vistos) <= 3
    finally:
        f.cerrar()


def test_hilo_restaura_exposicion_automatica_al_cerrar():
    cap = CapFalsa()
    f = FuenteCamaraHilo(cap, "falsa", restaurar_exposicion=True)
    f.cerrar()
    assert (cv2.CAP_PROP_AUTO_EXPOSURE, 0.75) in cap.sets and cap.liberada


# ---- opciones de cámara -----------------------------------------------------------

def test_abrir_camara_con_exposicion_backend_y_hilo(monkeypatch):
    creadas = []

    def fabrica(indice, backend):
        cap = CapFalsa()
        cap.backend = backend
        creadas.append(cap)
        return cap

    monkeypatch.setattr(cv2, "VideoCapture", fabrica)
    f = abrir_fuente("0", backend="msmf", fourcc="MJPG", fps_camara=30, exposicion=-5)
    try:
        assert isinstance(f, FuenteCamaraHilo) and f.restaurar_exposicion
        cap = creadas[0]
        assert cap.backend == cv2.CAP_MSMF and len(creadas) == 1
        props = [p for p, _ in cap.sets]
        assert (cv2.CAP_PROP_AUTO_EXPOSURE, 0.25) in cap.sets and (cv2.CAP_PROP_EXPOSURE, -5) in cap.sets
        assert (cv2.CAP_PROP_FPS, 30) in cap.sets and cv2.CAP_PROP_FOURCC in props
        # renegocia el tamaño después de fijar la exposición
        assert props.index(cv2.CAP_PROP_FRAME_WIDTH) > props.index(cv2.CAP_PROP_EXPOSURE)
    finally:
        f.cerrar()
    assert (cv2.CAP_PROP_AUTO_EXPOSURE, 0.75) in creadas[0].sets


def test_abrir_camara_directa_sin_configurar_no_toca_la_camara(monkeypatch):
    monkeypatch.setattr(cv2, "VideoCapture", lambda i, b: CapFalsa())
    f = abrir_fuente("0", captura="directa")
    try:
        assert type(f) is fuente_mod.FuenteCaptura and f.cap.sets == []
    finally:
        f.cerrar()


def test_backend_desconocido_da_error_claro():
    with pytest.raises(fuente_mod.ErrorFuente, match="Backend desconocido"):
        fuente_mod._abrir_camara(0, backend="v4l9")


def test_parser_acepta_las_opciones_nuevas():
    a = construir_parser().parse_args(["live", "--modelo", "lite", "--diagnostico", "--cerrar-sin-persona", "2",
                                       "--backend", "dshow", "--exposicion", "-5", "--captura", "directa"])
    assert a.modelo == "lite" and a.diagnostico and a.cerrar_sin_persona == 2.0
    assert a.backend == "dshow" and a.exposicion == -5.0 and a.captura == "directa"
    d = construir_parser().parse_args(["live"])
    assert d.cerrar_sin_persona == 5.0 and d.captura == "hilo" and not d.diagnostico


def test_modelo_ausente_indica_de_donde_descargarlo(monkeypatch, tmp_path):
    from pose_twin import motor

    monkeypatch.setattr(motor, "CARPETA_MODELOS", tmp_path / "a")
    monkeypatch.setattr(motor, "CARPETA_MODELOS_LOCAL", tmp_path / "b")
    with pytest.raises(motor.ErrorModelo, match="pose_landmarker_lite/float16"):
        motor.ruta_modelo("lite")


# ---- bucle en vivo: cierre automático ---------------------------------------------

def test_vivo_se_cierra_solo_sin_persona(monkeypatch, capsys):
    from pose_twin import vivo

    cap = CapFalsa(dt=0.01)
    monkeypatch.setattr(vivo, "abrir_fuente", lambda *a, **k: FuenteCamaraHilo(cap, "falsa"))
    args = construir_parser().parse_args(["live", "--modelo", "full", "--sin-ventana", "--sin-csv",
                                          "--diagnostico", "--cerrar-sin-persona", "0.005"])  # 0,3 s
    t0 = time.monotonic()
    assert vivo.ejecutar_vivo(args) == 0
    assert time.monotonic() - t0 < 20
    salida = capsys.readouterr().out
    assert "Sin persona durante" in salida and "sin persona (" in salida
    assert cap.liberada
    # el diagnóstico deja un CSV de tiempos: se borra para no ensuciar data/sesiones
    for linea in salida.splitlines():
        if linea.startswith("Tiempos por cuadro: "):
            from pathlib import Path

            Path(linea.split(": ", 1)[1]).unlink(missing_ok=True)
