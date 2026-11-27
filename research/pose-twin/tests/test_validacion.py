"""Pruebas de la validación contra goniómetro. TODOS los datos son SINTÉTICOS: no son resultados."""
import csv
import json
import sys

import numpy as np
import pytest

from pose_twin import validacion as v
from pose_twin.geometria import angulo_vertice
from pose_twin.sesion import RegistroCSV


# ---- ayudas ---------------------------------------------------------------------

def _sesion(ruta, interior, columna="rodilla_izq", n=30, vacios=0):
    """CSV de sesión sintético con las columnas reales; los primeros `vacios` cuadros se abstienen."""
    with open(ruta, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=RegistroCSV.COLUMNAS, restval="")
        w.writeheader()
        for i in range(n):
            w.writerow({"t_s": f"{i / 10:.3f}", "cuadro": i + 1,
                        columna: "" if i < vacios else f"{interior:.2f}"})
    return ruta


def _escribir_hoja(ruta, filas, sep=","):
    with open(ruta, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=v.COLUMNAS, delimiter=sep, restval="")
        w.writeheader()
        w.writerows(filas)
    return ruta


def _fila(archivo, gon, rep=1, **extra):
    return {"articulacion": "rodilla", "lado": "izq", "angulo_objetivo_flexion": 90, "repeticion": rep,
            "goniometro_flexion": gon, "archivo": archivo, **extra}


# ---- convención -----------------------------------------------------------------

@pytest.mark.parametrize("flexion", [0, 30, 60, 90, 120])
def test_flexion_desde_geometria(flexion):
    cadera, rodilla = (0.0, -1.0), (0.0, 0.0)
    r = np.radians(flexion)
    tobillo = (np.sin(r), np.cos(r))  # flexión 0: la pierna sigue la línea del muslo
    interior = angulo_vertice(cadera, rodilla, tobillo)
    assert interior == pytest.approx(180 - flexion, abs=1e-6)
    assert v.interior_a_flexion(interior) == pytest.approx(flexion, abs=1e-6)


def test_articulaciones_existen_en_geometria_y_sin_hombro():
    for art in v.ARTICULACIONES:
        for lado in v.LADOS:
            assert f"{art}_{lado}" in v.ANGULOS
    assert "hombro" not in v.ARTICULACIONES


# ---- plantilla ------------------------------------------------------------------

def test_plantilla_completa_aleatorizada_y_reproducible(tmp_path):
    hoja = v.crear_plantilla(tmp_path / "h.csv", semilla=7)
    filas = v._leer_csv(hoja)
    assert list(filas[0]) == v.COLUMNAS
    assert len(filas) == 2 * 4 * 3
    combos = {(f["lado"], f["angulo_objetivo_flexion"], f["repeticion"]) for f in filas}
    assert len(combos) == 24
    assert [f["lado"] for f in filas] == ["izq"] * 12 + ["der"] * 12
    objetivos = [int(f["angulo_objetivo_flexion"]) for f in filas[:12]]
    assert objetivos != sorted(objetivos)
    assert all(f["goniometro_flexion"] == "" and f["archivo"] == "" for f in filas)
    assert v.filas_plantilla(["rodilla"], v.LADOS, v.OBJETIVOS, 3, 7) == v.filas_plantilla(
        ["rodilla"], v.LADOS, v.OBJETIVOS, 3, 7)
    crit = json.loads(v.ruta_criterio(hoja).read_text(encoding="utf-8"))
    assert crit["criterio_mae_deg"] == 5.0 and crit["semilla"] == 7


def test_plantilla_rodilla_primero(tmp_path):
    filas = v.filas_plantilla(["codo", "rodilla"], ["izq"], [30], 1, 1)
    assert [f["articulacion"] for f in filas] == ["rodilla", "codo"]


def test_plantilla_no_sobrescribe(tmp_path):
    hoja = v.crear_plantilla(tmp_path / "h.csv", semilla=1)
    hoja.write_text("datos anotados", encoding="utf-8")
    with pytest.raises(v.ErrorValidacion, match="Ya existe"):
        v.crear_plantilla(hoja)
    assert hoja.read_text(encoding="utf-8") == "datos anotados"


def test_plantilla_rechaza_hombro(tmp_path):
    with pytest.raises(v.ErrorValidacion, match="hombro"):
        v.crear_plantilla(tmp_path / "h.csv", articulaciones=["hombro"])


# ---- tramos ---------------------------------------------------------------------

def test_mediana_del_tramo_en_flexion():
    filas = [{"t_s": str(t), "rodilla_izq": str(a)} for t, a in
             [(0, 180), (1, 91), (2, 90), (3, 40), (4, 89), (5, 180)]]
    t = v.extraer_tramo(filas, "rodilla_izq", 1, 4, min_cuadros=3, min_fraccion=0.5)
    assert t.cuadros == 4 and t.validos == 4
    assert t.flexion == pytest.approx(180 - 89.5)


@pytest.mark.parametrize("validos,esperado_abstencion", [(9, True), (10, False)])
def test_abstencion_por_pocos_cuadros(validos, esperado_abstencion):
    filas = [{"t_s": str(i), "rodilla_izq": "90" if i < validos else ""} for i in range(15)]
    t = v.extraer_tramo(filas, "rodilla_izq", None, None, 10, 0.5)
    assert (t.flexion is None) is esperado_abstencion


def test_abstencion_por_fraccion():
    filas = [{"t_s": str(i), "rodilla_izq": "90" if i < 12 else ""} for i in range(30)]
    assert v.extraer_tramo(filas, "rodilla_izq", None, None, 10, 0.5).flexion is None


@pytest.mark.parametrize("ini,fin,msg", [(100, 200, "no hay cuadros"), (3, 1, "mayor")])
def test_tramo_invalido(ini, fin, msg):
    filas = [{"t_s": "0", "rodilla_izq": "90"}]
    with pytest.raises(v.ErrorValidacion, match=msg):
        v.extraer_tramo(filas, "rodilla_izq", ini, fin, 1, 0.5)


def test_numeros_y_tiempos():
    assert v.numero("92,5", "x") == 92.5
    assert v.numero("  ", "x") is None
    assert v.segundos("1:05", "t") == 65
    for malo in ("abc", "nan"):
        with pytest.raises(v.ErrorValidacion):
            v.numero(malo, "x")


# ---- métricas -------------------------------------------------------------------

def test_metricas_a_mano():
    m = v.metricas([2.0, -4.0, 5.0])
    assert m["mae"] == pytest.approx(11 / 3)
    assert m["sesgo"] == pytest.approx(1.0)
    de = np.sqrt((1 + 25 + 16) / 2)
    assert m["de"] == pytest.approx(de)
    assert (m["loa_inf"], m["loa_sup"]) == pytest.approx((1 - 1.96 * de, 1 + 1.96 * de))


def test_metricas_con_cero_o_una_muestra():
    assert v.metricas([])["mae"] is None
    m = v.metricas([3.0])
    assert m["mae"] == 3 and m["de"] is None and m["loa_inf"] is None


# ---- cálculo completo -----------------------------------------------------------

def test_calcular_de_punta_a_punta(tmp_path):
    hoja = v.crear_plantilla(tmp_path / "h.csv", semilla=3)
    _sesion(tmp_path / "a.csv", 88.0)   # flexión 92
    _sesion(tmp_path / "b.csv", 94.0)   # flexión 86
    _sesion(tmp_path / "c.csv", 90.0, vacios=28)  # abstención
    _escribir_hoja(hoja, [
        _fila("a.csv", "90", 1), _fila("b.csv", "90", 2), _fila("c.csv", "90", 3),
        _fila("", "", 1, lado="der"), _fila("no_existe.csv", "90", 2, lado="der"),
    ])
    ruta, res = v.calcular(hoja)
    assert [r["estado"] for r in res] == ["ok", "ok", "abstencion", "pendiente", "error"]
    assert [r["error"] for r in res[:2]] == pytest.approx([2.0, -4.0])
    tabla, agrupada = v.repetibilidad(res)
    assert tabla[0]["n"] == 2 and agrupada == pytest.approx(np.std([2, -4], ddof=1))
    txt = ruta.read_text(encoding="utf-8")
    for trozo in ("CUMPLE (parcial", "no un estándar", "no son independientes", "Una sola persona",
                  "Abstenciones: 1", "no encuentro el archivo", "Criterio registrado"):
        assert trozo in txt
    assert (ruta.parent / "graficos.png").stat().st_size > 1000


def test_hoja_de_excel_en_espanol_y_tramo(tmp_path):
    _sesion(tmp_path / "a.csv", 120.0)
    hoja = _escribir_hoja(tmp_path / "h.csv", [_fila("a.csv", "58,5", inicio_s="0,5", fin_s="0:02")], sep=";")
    ruta, res = v.calcular(hoja)
    assert res[0]["estado"] == "ok" and res[0]["cuadros"] == 16
    assert res[0]["error"] == pytest.approx(1.5)
    assert "no consta que se fijara antes de medir" in ruta.read_text(encoding="utf-8")


def test_aviso_si_anotan_angulo_interior(tmp_path):
    _sesion(tmp_path / "a.csv", 150.0)  # flexión 30, pero anotan 150
    hoja = _escribir_hoja(tmp_path / "h.csv", [_fila("a.csv", "150", angulo_objetivo_flexion=30)])
    _, res = v.calcular(hoja)
    assert "flexión" in res[0]["aviso"]


def test_criterio_cambiado_se_declara_y_no_cumple(tmp_path):
    hoja = v.crear_plantilla(tmp_path / "h.csv", semilla=1)
    _sesion(tmp_path / "a.csv", 87.0)  # error +3
    _escribir_hoja(hoja, [_fila("a.csv", "90")])
    ruta, res = v.calcular(hoja, criterio_mae=2.0)
    assert v.veredicto(res, "rodilla", 2.0) == "NO CUMPLE"
    assert v.veredicto(res, "rodilla", 3.0) == "CUMPLE"
    assert "se cambió al calcular" in ruta.read_text(encoding="utf-8")


def test_sin_datos_no_deja_grafico_viejo(tmp_path):
    hoja = v.crear_plantilla(tmp_path / "h.csv", semilla=1)
    salida = tmp_path / "res"
    salida.mkdir()
    (salida / "graficos.png").write_bytes(b"viejo")
    ruta, res = v.calcular(hoja, salida)
    assert not (salida / "graficos.png").exists()
    assert "SIN DATOS" in ruta.read_text(encoding="utf-8")


def test_video_usa_el_procesador_una_sola_vez(tmp_path, monkeypatch):
    (tmp_path / "toma.mp4").write_bytes(b"sintetico")
    llamadas = []

    def falso(video, destino, *a):
        llamadas.append(video)
        destino.parent.mkdir(parents=True, exist_ok=True)
        return _sesion(destino, 90.0)

    monkeypatch.setattr(v, "procesar_video", falso)
    hoja = _escribir_hoja(tmp_path / "h.csv", [_fila("toma.mp4", "90", 1), _fila("toma.mp4", "91", 2)])
    _, res = v.calcular(hoja)
    assert len(llamadas) == 1
    assert [r["estado"] for r in res] == ["ok", "ok"]


def test_grafico_sin_matplotlib_usa_cv2(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "matplotlib.figure", None)  # simula que no está instalado
    res = [{"estado": "ok", "goniometro": g, "estimado": g + e} for g, e in [(30, 2), (60, -1), (90, 3)]]
    ruta = tmp_path / "g.png"
    assert v.graficar(res, ruta, "DATOS SINTÉTICOS") == "cv2"
    assert ruta.read_bytes().startswith(b"\x89PNG")


def test_cli(tmp_path, capsys):
    hoja = tmp_path / "h.csv"
    assert v.main(["plantilla", "--hoja", str(hoja), "--semilla", "5"]) == 0
    assert v.main(["plantilla", "--hoja", str(hoja)]) == 2
    assert v.main(["calcular", "--hoja", str(hoja)]) == 0
    assert "pendientes 24" in capsys.readouterr().out
